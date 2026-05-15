"""
Missing Person Routes
Handles missing person reporting and tracking
"""

from flask import Blueprint, request, jsonify
from middleware.auth import require_auth
from middleware.roles import require_role
from utils.firebase import get_firestore
from models.face_recognition import get_recognizer
try:
    from models.face_recognition import INSIGHTFACE_AVAILABLE
except ImportError:
    INSIGHTFACE_AVAILABLE = False
from datetime import datetime
import pytz  # type: ignore
from utils.time import utc_now, to_utc_iso
import cv2
import numpy as np
import io
import os
import requests  # type: ignore
import logging
from PIL import Image
from google.cloud.firestore import FieldFilter
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)
try:
    import cloudinary  # type: ignore
    import cloudinary.uploader  # type: ignore
    CLOUDINARY_AVAILABLE = True
except ImportError:
    CLOUDINARY_AVAILABLE = False
    print("[WARNING] Cloudinary not installed. Image uploads will fail.")
    print("  Install with: pip install cloudinary")

missing_bp = Blueprint('missing', __name__)
missing_report_executor = ThreadPoolExecutor(max_workers=4)


def _process_missing_report_async(person_id, name, photo_data):
    """Upload image + register embedding without blocking HTTP response."""
    db = get_firestore()
    person_ref = db.collection('missing_persons').document(person_id)
    try:
        if not CLOUDINARY_AVAILABLE:
            person_ref.update({
                'upload_status': 'failed',
                'upload_error': 'Cloudinary is not installed',
                'updated_at': utc_now(),
                'last_updated': utc_now(),
            })
            return

        # Upload to Cloudinary
        photo_filename = f'missing_persons/{utc_now().strftime("%Y%m%d_%H%M%S")}_{name.replace(" ", "_")}'
        upload_result = cloudinary.uploader.upload(
            io.BytesIO(photo_data),
            folder='missing_persons',
            public_id=photo_filename,
            resource_type='image',
            overwrite=False
        )
        photo_url = upload_result.get('secure_url') or upload_result.get('url')
        if not photo_url:
            raise RuntimeError('Failed to get photo URL from Cloudinary')

        person_ref.update({
            'photo_url': photo_url,
            'image_url': photo_url,
            'upload_status': 'completed',
            'updated_at': utc_now(),
            'last_updated': utc_now(),
        })

        # Face encoding in background (best-effort)
        recognizer = get_recognizer()
        if recognizer is None or recognizer.face_analyzer is None:
            logger.warning(f"Face recognizer not available. Face encoding skipped for person {person_id}")
            return

        logger.info(f"Registering face for missing person: {name} (ID: {person_id})")
        image = Image.open(io.BytesIO(photo_data))
        image_array = np.array(image)
        if len(image_array.shape) == 3:
            image_bgr = cv2.cvtColor(image_array, cv2.COLOR_RGB2BGR)
        else:
            image_bgr = image_array

        emb, bbox = recognizer.extract_embedding(image_bgr)
        if emb is not None:
            person_ref.update({
                'face_embedding': emb.tolist(),
                'face_bbox': list(bbox) if bbox else None,
                'face_embedding_model': 'insightface/buffalo_l',
                'face_embedding_updated_at': utc_now()
            })
            logger.info(f"Stored face embedding in Firestore for person {person_id} (len={len(emb)})")

        success = recognizer.add_person_from_array(person_id, image_bgr)
        if success:
            recognizer.reload_database()
            stats = recognizer.get_face_stats()
            logger.info(
                f"Successfully registered face for {name} (ID: {person_id}). "
                f"Database now has {stats['total_people']} people with {stats['total_embeddings']} embeddings."
            )
        else:
            logger.error(f"Failed to add face encoding for person {person_id} ({name})")
    except Exception as e:
        import traceback
        logger.error(f"Background missing report processing failed for {person_id}: {e}\n{traceback.format_exc()}")
        try:
            person_ref.update({
                'upload_status': 'failed',
                'upload_error': str(e),
                'updated_at': utc_now(),
                'last_updated': utc_now(),
            })
        except Exception:
            pass

@missing_bp.route('/list', methods=['GET'])
@require_auth
def list_missing_persons():
    """List all missing persons"""
    try:
        db = get_firestore()
        missing_ref = db.collection('missing_persons')
        
        # Filter by status if provided
        status = request.args.get('status', 'all')
        if status != 'all':
            missing_query = missing_ref.where(filter=FieldFilter('status', '==', status))
        else:
            missing_query = missing_ref

        def _sort_ts(item):
            ts = item.get('created_at')
            if isinstance(ts, datetime):
                return ts
            if isinstance(ts, str):
                try:
                    return datetime.fromisoformat(ts.replace('Z', '+00:00'))
                except Exception:
                    return datetime.min.replace(tzinfo=pytz.utc)
            return datetime.min.replace(tzinfo=pytz.utc)

        # Query fallback:
        # filtered + ordered queries can require composite indexes in Firestore.
        # Keep endpoint reliable by sorting in Python if ordered query fails.
        try:
            missing_persons = list(missing_query.order_by('created_at', direction='DESCENDING').stream())
        except Exception as query_error:
            logger.warning(f"[Missing Persons List] Falling back to in-memory sort: {query_error}")
            missing_persons = list(missing_query.stream())
            missing_persons.sort(key=lambda doc: _sort_ts(doc.to_dict() or {}), reverse=True)
        
        person_list = []
        for person in missing_persons:
            person_data = person.to_dict()
            person_data['id'] = person.id
            
            # Convert timestamps
            if 'created_at' in person_data:
                person_data['created_at'] = to_utc_iso(person_data['created_at']) if hasattr(person_data['created_at'], 'isoformat') else str(person_data['created_at'])
            if 'updated_at' in person_data:
                person_data['updated_at'] = to_utc_iso(person_data['updated_at']) if hasattr(person_data['updated_at'], 'isoformat') else str(person_data['updated_at'])
            
            person_list.append(person_data)
        
        return jsonify({
            'success': True,
            'missing_persons': person_list
        }), 200
        
    except Exception as e:
        return jsonify({'success': False, 'data': None, 'error': f'Failed to list missing persons: {str(e)}'}), 500

@missing_bp.route('/report', methods=['POST'])
@require_auth
def report_missing_person():
    """
    Report missing person
    
    Request Body (multipart/form-data):
        - name: Full name (required)
        - age: Age (optional)
        - gender: Gender (optional)
        - description: Physical description (required)
        - photo: Photo file (required)
        - last_seen_location: Last seen location (required)
        - last_seen_city: City (required)
        - contact_phone: Contact phone (required)
    """
    try:
        # Get form data (Flask handles multipart/form-data automatically)
        name = request.form.get('name', '').strip()
        age = request.form.get('age', '').strip()
        gender = request.form.get('gender', '').strip()
        description = request.form.get('description', '').strip()
        last_seen_location = request.form.get('last_seen_location', '').strip()
        last_seen_city = request.form.get('last_seen_city', '').strip()
        contact_phone = request.form.get('contact_phone', '').strip()
        photo_file = request.files.get('photo')
        
        # Validate required fields
        if not name:
            return jsonify({'error': 'Missing required field: name'}), 400
        if not description:
            return jsonify({'error': 'Missing required field: description'}), 400
        if not last_seen_location:
            return jsonify({'error': 'Missing required field: last_seen_location'}), 400
        if not last_seen_city:
            return jsonify({'error': 'Missing required field: last_seen_city'}), 400
        if not contact_phone:
            return jsonify({'error': 'Missing required field: contact_phone'}), 400
        if not photo_file:
            return jsonify({'error': 'Missing required field: photo'}), 400
        
        photo_data = photo_file.read()
        if not photo_data:
            return jsonify({'error': 'Photo file is empty'}), 400
        
        # Prepare missing person data
        # NOTE: search_active is the ONLY gate for running detection.
        # Status is for UI + lifecycle tracking; before authority accepts, search_active stays False.
        person_data = {
            'id': None,  # filled in after document creation (kept for schema parity)
            'name': name,
            'age': int(age) if age else None,
            'gender': gender if gender else None,
            'description': description,
            'photo_url': None,
            'image_url': None,
            'upload_status': 'processing',
            'last_seen_location': last_seen_location,
            'last_seen_city': last_seen_city,
            'contact_phone': contact_phone,
            'status': 'SEARCHING',
            'search_active': False,
            'cctv_image': None,
            'notification_sent': False,
            'reported_by': getattr(request, 'user', {}).get('uid'),
            'created_at': utc_now(),
            'updated_at': utc_now(),
            'last_updated': utc_now(),
        }
        
        # Save to Firestore
        db = get_firestore()
        person_ref = db.collection('missing_persons').document()
        person_data['id'] = person_ref.id
        person_ref.set(person_data)

        # Fast response: process upload + face registration in background
        missing_report_executor.submit(_process_missing_report_async, person_ref.id, name, photo_data)

        return jsonify({
            'success': True,
            'data': {
                'person_id': person_ref.id,
                'message': 'Missing person report submitted successfully. Image processing is running in background.',
                'status': 'submitted'
            },
            'error': None
        }), 202
        
    except Exception as e:
        return jsonify({'success': False, 'data': None, 'error': f'Failed to report missing person: {str(e)}'}), 500

@missing_bp.route('/update-status/<person_id>', methods=['PUT'])
@require_auth
@require_role('authority')
def update_missing_status(person_id):
    """
    Update missing person status (Authority only)
    
    Request Body:
        {
            "status": "pending" | "searching" | "found"
        }
    
    When status changes to "searching", CCTV cameras start scanning for this person.
    When status changes to "found", scanning stops and citizen is notified.
    """
    try:
        data = request.get_json()
        
        if 'status' not in data:
            return jsonify({'error': 'Missing field: status'}), 400
        
        status = data['status']
        # Backward compatible endpoint for older UI. Maps to new lifecycle.
        valid_statuses = ['pending', 'searching', 'found', 'SEARCHING', 'DETECTED', 'CONFIRMED_BY_CITIZEN', 'MATCH_CONFIRMED', 'RESCAN_REQUESTED']
        
        if status not in valid_statuses:
            return jsonify({'error': f'Invalid status. Must be one of: {valid_statuses}'}), 400
        
        db = get_firestore()
        person_ref = db.collection('missing_persons').document(person_id)
        person_doc = person_ref.get()
        
        if not person_doc.exists:
            return jsonify({'error': 'Missing person not found'}), 404
        
        person_data = person_doc.to_dict()
        old_status = person_data.get('status', 'pending')
        
        # Normalize legacy status values
        legacy_map = {
            'pending': 'SEARCHING',
            'searching': 'SEARCHING',
            'found': 'MATCH_CONFIRMED',
        }
        normalized = legacy_map.get(status, status)

        update_payload = {
            'status': normalized,
            'updated_at': utc_now(),
            'last_updated': utc_now(),
        }
        # Maintain search_active as authoritative compute gate
        if normalized == 'SEARCHING':
            update_payload['search_active'] = True
        if normalized == 'MATCH_CONFIRMED':
            update_payload['search_active'] = False

        person_ref.update(update_payload)
        
        # If status changed to "SEARCHING", ensure face is registered in recognizer
        if normalized == 'SEARCHING' and old_status != 'SEARCHING':
            try:
                recognizer = get_recognizer(reload_db=True)
                if recognizer is None:
                    logger.error("Face recognizer is not initialized.")
                else:
                
                    # Check if already registered
                    is_already_registered = recognizer.verify_person_registered(person_id)
                    if is_already_registered:
                        logger.info(f"Person {person_id} ({person_data.get('name')}) is already registered in face database")
                    else:
                        logger.warning(f"Person {person_id} ({person_data.get('name')}) is NOT registered. Attempting to register now...")
                        photo_url = person_data.get('photo_url')
                    
                        if photo_url:
                            # Download photo and register face
                            import requests  # type: ignore
                            response = requests.get(photo_url, timeout=10)
                            if response.status_code == 200:
                                image = Image.open(io.BytesIO(response.content))
                                image_array = np.array(image)
                            
                                # Convert RGB to BGR for OpenCV
                                if len(image_array.shape) == 3:
                                    image_bgr = cv2.cvtColor(image_array, cv2.COLOR_RGB2BGR)
                                else:
                                    image_bgr = image_array
                            
                                # Register face
                                success = recognizer.add_person_from_array(person_id, image_bgr)
                                if success:
                                    # Force reload to ensure database is up-to-date
                                    recognizer.reload_database()
                                
                                    # Verify registration
                                    is_registered = recognizer.verify_person_registered(person_id)
                                    stats = recognizer.get_face_stats()
                                    if is_registered:
                                        logger.info(f"Successfully registered face for {person_data.get('name')} (ID: {person_id}). "
                                                  f"Database now has {stats['total_people']} people.")
                                    else:
                                        logger.error(f"CRITICAL: Person {person_id} was not found in database after registration!")
                                        # Try reloading one more time
                                        recognizer.reload_database()
                                        is_registered = recognizer.verify_person_registered(person_id)
                                        if is_registered:
                                            logger.info(f"Person {person_id} found after second reload")
                                        else:
                                            logger.error(f"Person {person_id} still not found after reload. Registration may have failed.")
                                else:
                                    logger.error(f"Failed to register face for {person_data.get('name')} (ID: {person_id}). "
                                               f"Check if photo contains a detectable face.")
                            else:
                                logger.error(f"Failed to download photo from {photo_url} for person {person_id}. Status: {response.status_code}")
                        else:
                            logger.error(f"No photo_url found for person {person_id}. Cannot register face.")
            except Exception as e:
                import traceback
                logger.error(f"Failed to register face when status changed to searching: {e}\n{traceback.format_exc()}")
        
        # In the new lifecycle, citizens are informed only via explicit "inform" action.
        # So we do not auto-notify here.
        
        return jsonify({
            'success': True,
            'data': {'message': f'Status updated to {normalized}'},
            'error': None
        }), 200
        
    except Exception as e:
        return jsonify({'success': False, 'data': None, 'error': f'Failed to update status: {str(e)}'}), 500


@missing_bp.route('/notifications', methods=['GET'])
@require_auth
def get_notifications():
    """
    Get notifications for the current user
    - Authorities see detection notifications
    - Citizens see "found" notifications
    """
    try:
        db = get_firestore()
        user_id = getattr(request, 'user', {}).get('uid')
        
        # Get user role
        from utils.firebase import get_user_role
        user_role = get_user_role(user_id)
        
        notifications_ref = db.collection('notifications')
        
        notification_list = []
        
        # Use fallback approach to avoid Firestore composite index requirement
        # Query without order_by, then sort in Python
        try:
            if user_role == 'authority':
                notifications_query = notifications_ref.where(filter=FieldFilter('type', '==', 'missing_person_detected'))
            else:
                notifications_query = notifications_ref.where(filter=FieldFilter('user_id', '==', user_id))
            
            # Fetch more than needed since we'll filter and sort in memory
            notifications = notifications_query.limit(200).stream()
            
            # Convert to list and filter/sort in Python
            notification_list_raw = []
            for notif in notifications:
                notif_data = notif.to_dict()
                
                # Citizens see both detection and found notifications (filter in memory)
                if user_role == 'citizen':
                    notif_type = notif_data.get('type')
                    if notif_type not in ['missing_person_detected', 'missing_person_found']:
                        continue
                
                notif_data['id'] = notif.id
                notification_list_raw.append(notif_data)
            
            # Sort by dynamic timestamp (updated_at > detected_at > created_at)
            def get_timestamp(item):
                t = item.get('updated_at') or item.get('detected_at') or item.get('detection_time') or item.get('created_at')
                if t is None:
                    return datetime.min.replace(tzinfo=pytz.utc)
                if isinstance(t, datetime):
                    if t.tzinfo is None:
                        return t.replace(tzinfo=pytz.utc)
                    return t
                if isinstance(t, str):
                    try:
                        return datetime.fromisoformat(t.replace('Z', '+00:00'))
                    except:
                        return datetime.min.replace(tzinfo=pytz.utc)
                return datetime.min.replace(tzinfo=pytz.utc)
            
            notification_list_raw.sort(key=get_timestamp, reverse=True)
            notification_list = notification_list_raw[:50]
            
            # Convert timestamps for response
            for notif_data in notification_list:
                if 'created_at' in notif_data:
                    if isinstance(notif_data['created_at'], datetime):
                        notif_data['created_at'] = to_utc_iso(notif_data['created_at'])
                    elif not isinstance(notif_data['created_at'], str):
                        notif_data['created_at'] = str(notif_data['created_at'])
                        
        except Exception as query_error:
            logger.error(f"[Missing Person Notifications] Query failed: {query_error}")
            import traceback
            logger.error(traceback.format_exc())
            notification_list = []
        
        
        return jsonify({
            'success': True,
            'data': {'notifications': notification_list},
            'error': None
        }), 200
        
    except Exception as e:
        return jsonify({'success': False, 'data': None, 'error': f'Failed to get notifications: {str(e)}'}), 500


@missing_bp.route('/notifications/<notification_id>/read', methods=['PUT'])
@require_auth
def mark_notification_read(notification_id):
    """Mark a notification as read"""
    try:
        db = get_firestore()
        user_id = getattr(request, 'user', {}).get('uid')
        
        notif_ref = db.collection('notifications').document(notification_id)
        notif_doc = notif_ref.get()
        
        if not notif_doc.exists:
            return jsonify({'error': 'Notification not found'}), 404
        
        notif_data = notif_doc.to_dict()
        
        # Verify user owns this notification (for citizens) or is authority
        from utils.firebase import get_user_role
        user_role = get_user_role(user_id)
        
        if user_role != 'authority' and notif_data.get('user_id') != user_id:
            return jsonify({'error': 'Unauthorized'}), 403
        
        notif_ref.update({
            'read': True,
            'read_at': utc_now()
        })
        
        return jsonify({
            'success': True,
            'data': {'message': 'Notification marked as read'},
            'error': None
        }), 200
        
    except Exception as e:
        return jsonify({'success': False, 'data': None, 'error': f'Failed to mark notification as read: {str(e)}'}), 500


@missing_bp.route('/detections/<detection_id>/confirm', methods=['PUT'])
@require_auth
@require_role('authority')
def confirm_detection(detection_id):
    """
    Confirm a detection match (Authority only)
    This will mark the missing person as found and notify the citizen
    """
    try:
        db = get_firestore()
        
        # Get detection notification
        detection_ref = db.collection('notifications').document(detection_id)
        detection_doc = detection_ref.get()
        
        if not detection_doc.exists:
            return jsonify({'error': 'Detection not found'}), 404
        
        detection_data = detection_doc.to_dict()
        
        if detection_data.get('type') != 'missing_person_detected':
            return jsonify({'error': 'Invalid detection type'}), 400
        
        person_id = detection_data.get('person_id')
        if not person_id:
            return jsonify({'error': 'Person ID not found in detection'}), 400
        
        # Get person data
        person_ref = db.collection('missing_persons').document(person_id)
        person_doc = person_ref.get()
        
        if not person_doc.exists:
            return jsonify({'error': 'Missing person not found'}), 404
        
        person_data = person_doc.to_dict()
        
        # Legacy endpoint retained for compatibility; maps to final confirmation.
        # Final state stops searching permanently.
        person_ref.update({
            'status': 'MATCH_CONFIRMED',
            'search_active': False,
            'found_at': utc_now(),
            'found_location': detection_data.get('location', {}),
            'found_camera_id': detection_data.get('camera_id'),
            'updated_at': utc_now(),
            'last_updated': utc_now(),
        })
        
        # Mark detection as confirmed
        detection_ref.update({
            'confirmed': True,
            'confirmed_at': utc_now(),
            'confirmed_by': getattr(request, 'user', {}).get('uid')
        })
        
        # Create notification for citizen with comprehensive details
        found_location = detection_data.get('location', {})
        location_address = found_location.get('address', '') or \
            f"{found_location.get('name', '')}, {found_location.get('city', '')}".strip(', ')
        
        notification_data = {
            'type': 'missing_person_found',
            'person_id': person_id,
            'person_name': person_data.get('name', 'Unknown'),
            'status': 'found',
            'location': found_location,
            'location_address': location_address,
            'camera_id': detection_data.get('camera_id'),
            'camera_name': detection_data.get('camera_name', ''),
            'detected_at': detection_data.get('detected_at'),
            'found_at': utc_now(),
            'found_time': utc_now().isoformat().replace("+00:00", "Z"),
            'read': False,
            'created_at': utc_now(),
            'user_id': person_data.get('reported_by'),
            'message': f"{person_data.get('name', 'Unknown')} has been found at {location_address}"
        }
        db.collection('notifications').document().set(notification_data)
        
        return jsonify({
            'success': True,
            'data': {'message': 'Match confirmed. Searching stopped.'},
            'error': None
        }), 200
        
    except Exception as e:
        return jsonify({'success': False, 'data': None, 'error': f'Failed to confirm detection: {str(e)}'}), 500

@missing_bp.route('/detections/<detection_id>/confirm-by-citizen', methods=['PUT'])
@require_auth
def confirm_detection_by_citizen(detection_id):
    """
    Confirm a detection match by the citizen who reported the missing person
    This will mark the missing person as found and stop searching
    """
    try:
        db = get_firestore()
        user_id = getattr(request, 'user', {}).get('uid')
        
        # Get detection notification
        detection_ref = db.collection('notifications').document(detection_id)
        detection_doc = detection_ref.get()
        
        if not detection_doc.exists:
            return jsonify({'error': 'Detection not found'}), 404
        
        detection_data = detection_doc.to_dict()
        
        if detection_data.get('type') != 'missing_person_detected':
            return jsonify({'error': 'Invalid detection type'}), 400
        
        # Verify this citizen reported the missing person
        person_id = detection_data.get('person_id')
        if not person_id:
            return jsonify({'error': 'Person ID not found in detection'}), 400
        
        person_ref = db.collection('missing_persons').document(person_id)
        person_doc = person_ref.get()
        
        if not person_doc.exists:
            return jsonify({'error': 'Missing person not found'}), 404
        
        person_data = person_doc.to_dict()
        
        # Verify user is the one who reported
        if person_data.get('reported_by') != user_id:
            return jsonify({'error': 'Unauthorized: You did not report this missing person'}), 403
        
        # Legacy endpoint: citizen confirmation maps to CONFIRMED_BY_CITIZEN, not final stop.
        person_ref.update({
            'status': 'CONFIRMED_BY_CITIZEN',
            'found_at': utc_now(),
            'found_location': detection_data.get('location', {}),
            'found_camera_id': detection_data.get('camera_id'),
            'confirmed_by_citizen': True,
            'updated_at': utc_now(),
            'last_updated': utc_now(),
        })
        
        # Mark detection as confirmed by citizen
        detection_ref.update({
            'confirmed': True,
            'confirmed_by_citizen': True,
            'confirmed_at': utc_now(),
            'confirmed_by': user_id
        })
        
        # Create a "found" notification for the citizen
        found_location = detection_data.get('location', {})
        location_address = found_location.get('address', '') or \
            f"{found_location.get('name', '')}, {found_location.get('city', '')}".strip(', ')
        
        notification_data = {
            'type': 'missing_person_found',
            'person_id': person_id,
            'person_name': person_data.get('name', 'Unknown'),
            'status': 'found',
            'location': found_location,
            'location_address': location_address,
            'camera_id': detection_data.get('camera_id'),
            'camera_name': detection_data.get('camera_name', ''),
            'detected_at': detection_data.get('detected_at'),
            'found_at': utc_now(),
            'found_time': utc_now().isoformat().replace("+00:00", "Z"),
            'read': False,
            'created_at': utc_now(),
            'user_id': user_id,
            'confirmed_by_citizen': True,
            'message': f"{person_data.get('name', 'Unknown')} has been confirmed found at {location_address}. Searching has stopped."
        }
        db.collection('notifications').document().set(notification_data)
        
        logger.info(f"[Citizen Confirmation] Person {person_id} ({person_data.get('name')}) confirmed found by citizen {user_id}. Status updated to 'found'.")
        
        return jsonify({
            'success': True,
            'data': {'message': 'Detection confirmed by citizen.'},
            'error': None
        }), 200

    except Exception as e:
        import traceback
        logger.error(f"Failed to confirm detection by citizen: {e}\n{traceback.format_exc()}")
        return jsonify({'success': False, 'data': None, 'error': f'Failed to confirm detection: {str(e)}'}), 500


@missing_bp.route('/cases/<person_id>/accept', methods=['PUT'])
@require_auth
@require_role('authority')
def accept_missing_case(person_id):
    """Authority accepts report and starts searching (search_active=True)."""
    try:
        db = get_firestore()
        ref = db.collection('missing_persons').document(person_id)
        doc = ref.get()
        if not doc.exists:
            return jsonify({'error': 'Missing person not found'}), 404
        now = utc_now()
        ref.update({
            'status': 'SEARCHING',
            'search_active': True,
            'notification_sent': False,
            'updated_at': now,
            'last_updated': now,
        })
        return jsonify({'success': True, 'data': {'message': 'Case accepted. Searching started.'}, 'error': None}), 200
    except Exception as e:
        return jsonify({'success': False, 'data': None, 'error': f'Failed to accept case: {str(e)}'}), 500


@missing_bp.route('/detections/<detection_id>/inform-citizen', methods=['PUT'])
@require_auth
@require_role('authority')
def inform_citizen(detection_id):
    """Authority informs citizen about a detection; makes notification visible to citizen."""
    try:
        db = get_firestore()
        det_ref = db.collection('notifications').document(detection_id)
        det_doc = det_ref.get()
        if not det_doc.exists:
            return jsonify({'error': 'Detection not found'}), 404
        det = det_doc.to_dict() or {}
        if det.get('type') != 'missing_person_detected':
            return jsonify({'error': 'Invalid detection type'}), 400

        person_id = det.get('person_id')
        if not person_id:
            return jsonify({'error': 'Person ID not found in detection'}), 400

        person_ref = db.collection('missing_persons').document(person_id)
        now = utc_now()
        # Update person lifecycle
        person_ref.update({
            'status': 'DETECTED',
            'notification_sent': True,
            'updated_at': now,
            'last_updated': now,
            # ensure compute stays paused until explicit rescan
            'search_active': False,
            'cctv_image': det.get('cctv_image'),
        })
        # Update notification visibility
        det_ref.update({
            'visible_to_citizen': True,
            'notification_sent': True,
            'informed_at': now,
            'updated_at': now,
        })
        return jsonify({'success': True, 'data': {'message': 'Citizen informed.'}, 'error': None}), 200
    except Exception as e:
        return jsonify({'success': False, 'data': None, 'error': f'Failed to inform citizen: {str(e)}'}), 500


@missing_bp.route('/cases/<person_id>/citizen/confirm-found', methods=['PUT'])
@require_auth
def citizen_confirm_found(person_id):
    """Citizen confirms a detection."""
    try:
        db = get_firestore()
        user_id = getattr(request, 'user', {}).get('uid')
        ref = db.collection('missing_persons').document(person_id)
        doc = ref.get()
        if not doc.exists:
            return jsonify({'error': 'Missing person not found'}), 404
        data = doc.to_dict() or {}
        if data.get('reported_by') != user_id:
            return jsonify({'error': 'Unauthorized'}), 403
        now = utc_now()
        ref.update({
            'status': 'CONFIRMED_BY_CITIZEN',
            'updated_at': now,
            'last_updated': now,
        })
        return jsonify({'success': True, 'data': {'message': 'Confirmed by citizen.'}, 'error': None}), 200
    except Exception as e:
        return jsonify({'success': False, 'data': None, 'error': f'Failed to confirm: {str(e)}'}), 500


@missing_bp.route('/cases/<person_id>/citizen/rescan', methods=['PUT'])
@require_auth
def citizen_rescan_request(person_id):
    """Citizen requests a rescan (authority must restart searching)."""
    try:
        db = get_firestore()
        user_id = getattr(request, 'user', {}).get('uid')
        ref = db.collection('missing_persons').document(person_id)
        doc = ref.get()
        if not doc.exists:
            return jsonify({'error': 'Missing person not found'}), 404
        data = doc.to_dict() or {}
        if data.get('reported_by') != user_id:
            return jsonify({'error': 'Unauthorized'}), 403
        now = utc_now()
        ref.update({
            'status': 'RESCAN_REQUESTED',
            'search_active': False,
            'updated_at': now,
            'last_updated': now,
        })
        return jsonify({'success': True, 'data': {'message': 'Rescan requested.'}, 'error': None}), 200
    except Exception as e:
        return jsonify({'success': False, 'data': None, 'error': f'Failed to request rescan: {str(e)}'}), 500


@missing_bp.route('/cases/<person_id>/authority/confirm-match', methods=['PUT'])
@require_auth
@require_role('authority')
def authority_confirm_match(person_id):
    """Authority final confirmation: stop searching permanently."""
    try:
        db = get_firestore()
        ref = db.collection('missing_persons').document(person_id)
        doc = ref.get()
        if not doc.exists:
            return jsonify({'error': 'Missing person not found'}), 404
        now = utc_now()
        ref.update({
            'status': 'MATCH_CONFIRMED',
            'search_active': False,
            'updated_at': now,
            'last_updated': now,
        })
        # Mark detection notification as confirmed/resolved if present
        notif_ref = db.collection('notifications').document(f"missing_person_detected_{person_id}")
        try:
            notif_ref.update({'confirmed': True, 'confirmed_at': now, 'updated_at': now})
        except Exception:
            pass
        return jsonify({'success': True, 'data': {'message': 'Match confirmed. Searching stopped.'}, 'error': None}), 200
    except Exception as e:
        return jsonify({'success': False, 'data': None, 'error': f'Failed to confirm match: {str(e)}'}), 500


@missing_bp.route('/cases/<person_id>/authority/rescan', methods=['PUT'])
@require_auth
@require_role('authority')
def authority_rescan(person_id):
    """Authority restarts searching after RESCAN_REQUESTED or manual rescan."""
    try:
        db = get_firestore()
        ref = db.collection('missing_persons').document(person_id)
        doc = ref.get()
        if not doc.exists:
            return jsonify({'error': 'Missing person not found'}), 404
        now = utc_now()
        ref.update({
            'status': 'SEARCHING',
            'search_active': True,
            'notification_sent': False,
            'updated_at': now,
            'last_updated': now,
        })
        # Reset detection notification visibility/confirmation so a new detection can be surfaced cleanly
        notif_ref = db.collection('notifications').document(f"missing_person_detected_{person_id}")
        try:
            notif_ref.set({
                'confirmed': False,
                'visible_to_citizen': False,
                'notification_sent': False,
                'updated_at': now,
            }, merge=True)
        except Exception:
            pass
        return jsonify({'success': True, 'data': {'message': 'Rescan started.'}, 'error': None}), 200
    except Exception as e:
        return jsonify({'success': False, 'data': None, 'error': f'Failed to rescan: {str(e)}'}), 500
        
    except Exception as e:
        import traceback
        logger.error(f"Failed to confirm detection by citizen: {e}\n{traceback.format_exc()}")
        return jsonify({'success': False, 'data': None, 'error': f'Failed to confirm detection: {str(e)}'}), 500

@missing_bp.route('/debug/test-face-detection', methods=['POST'])
@require_auth
@require_role('authority')
def test_face_detection():
    """Test face detection on a provided image"""
    try:
        from models.face_recognition import get_recognizer
        import cv2
        import numpy as np
        
        # Get image from request
        if 'image' not in request.files:
            return jsonify({'error': 'No image provided'}), 400
        
        image_file = request.files['image']
        image_data = image_file.read()
        
        # Convert to numpy array
        nparr = np.frombuffer(image_data, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if image is None:
            return jsonify({'error': 'Failed to decode image'}), 400
        
        recognizer = get_recognizer(reload_db=True)
        
        if recognizer is None or recognizer.face_analyzer is None:
            return jsonify({
                'success': False,
                'error': 'Face recognizer not available'
            }), 500
        
        # Detect faces
        results = recognizer.detect_and_recognize(image, force_detection=True)
        
        return jsonify({
            'success': True,
            'faces_detected': len(results),
            'results': [{
                'label': r.get('label', 'Unknown'),
                'confidence': float(r.get('confidence', 0.0)),
                'bbox': r.get('bbox')
            } for r in results],
            'database_stats': recognizer.get_face_stats()
        }), 200
        
    except Exception as e:
        import traceback
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        }), 500

@missing_bp.route('/debug/face-recognition-status', methods=['GET'])
@require_auth
@require_role('authority')
def debug_face_recognition_status():
    """Debug endpoint to check face recognition database status"""
    try:
        recognizer = get_recognizer()
        
        if recognizer is None:
            return jsonify({
                'success': False,
                'error': 'Face recognizer not initialized',
                'insightface_available': INSIGHTFACE_AVAILABLE
            }), 500
        
        if recognizer.face_analyzer is None:
            return jsonify({
                'success': False,
                'error': 'Face analyzer not initialized',
                'database_path': recognizer.database_path,
                'database_exists': os.path.exists(recognizer.database_path)
            }), 500
        
        stats = recognizer.get_face_stats()
        
        # Get list of missing persons from Firestore
        db = get_firestore()
        missing_persons_ref = db.collection('missing_persons')
        all_persons = missing_persons_ref.stream()
        
        person_status = []
        for person in all_persons:
            person_data = person.to_dict()
            person_id = person.id
            is_registered = recognizer.verify_person_registered(person_id)
            person_status.append({
                'person_id': person_id,
                'name': person_data.get('name', 'Unknown'),
                'status': person_data.get('status', 'unknown'),
                'is_registered_in_face_db': is_registered,
                'embeddings_count': len(recognizer.face_database.get(person_id, {}).get('embeddings', [])) if is_registered else 0
            })
        
        return jsonify({
            'success': True,
            'face_recognition': {
                'database_path': recognizer.database_path,
                'database_exists': os.path.exists(recognizer.database_path),
                'threshold': recognizer.threshold,
                'total_people': stats['total_people'],
                'total_embeddings': stats['total_embeddings'],
                'known_person_ids': stats.get('known_person_ids', [])
            },
            'missing_persons_status': person_status
        }), 200
        
    except Exception as e:
        import traceback
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        }), 500
