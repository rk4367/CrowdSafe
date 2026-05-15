"""
CCTV Management Routes
Handles camera management (Authority only)
"""
from flask import Blueprint, request, jsonify
from middleware.auth import require_auth
from middleware.roles import require_role
from utils.firebase import get_firestore
from models.crowd_detection import get_detector
from models.fire_smoke_detector import get_fire_smoke_detector
from models.ip_camera import MJPEGStream
import cv2
import numpy as np
from datetime import datetime
from utils.time import utc_now, to_utc_iso
import time
import traceback
from urllib.parse import urlparse
from typing import Dict, Any, Optional, Tuple
import logging
from google.api_core.exceptions import ResourceExhausted, TooManyRequests
from google.cloud.firestore import FieldFilter

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

cctv_bp = Blueprint('cctv', __name__)

# Constants
ALLOWED_FIELDS = ['name', 'ip_address', 'stream_url', 'location_name', 'city', 'status', 'latitude', 'longitude']
REQUIRED_FIELDS = ['name', 'location_name', 'city', 'latitude', 'longitude']
MAX_FRAME_CAPTURE_ATTEMPTS = 2  # Reduced for faster processing
FRAME_SKIP_COUNT = 0  # No frame skipping for faster capture
STREAM_TIMEOUT = 5  # Reduced timeout for faster failure detection
MIN_FRAME_DIMENSION = 10


def is_quota_error(error: Exception) -> bool:
    """Detect Firestore/API quota throttling errors."""
    if isinstance(error, (ResourceExhausted, TooManyRequests)):
        return True
    message = str(error).lower()
    return "quota exceeded" in message or "resource_exhausted" in message or "429" in message


def validate_camera_data(data: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
    """
    Validate camera data
    
    Returns:
        Tuple of (is_valid, error_message)
    """
    if not data:
        return False, 'Request body is empty or not valid JSON'
    
    # Check required fields
    for field in REQUIRED_FIELDS:
        if field not in data or not str(data[field]).strip():
            return False, f'Missing or empty required field: {field}'
    
    # Validate coordinates
    try:
        lat = float(data['latitude'])
        lon = float(data['longitude'])
        if not (-90 <= lat <= 90):
            return False, 'Latitude must be between -90 and 90'
        if not (-180 <= lon <= 180):
            return False, 'Longitude must be between -180 and 180'
    except (ValueError, TypeError):
        return False, 'Latitude and Longitude must be valid numbers'
    
    return True, None


def extract_ip_from_url(url: str) -> str:
    """Extract IP address or hostname from URL"""
    try:
        parsed = urlparse(url)
        return parsed.hostname or ''
    except Exception as e:
        logger.warning(f"Failed to parse URL {url}: {e}")
        return ''


def check_stream_status(stream_url: str) -> Tuple[str, Optional[str]]:
    """
    Dynamically check if a stream is accessible
    
    Args:
        stream_url: URL of the video stream
        
    Returns:
        Tuple of (status, error_message)
        status: 'active' if stream is accessible, 'inactive' otherwise
        error_message: Error description if stream is not accessible
    """
    if not stream_url or not stream_url.strip():
        return 'inactive', 'No stream URL provided'
    
    try:
        success, frame, error_msg = capture_frame_from_stream(stream_url)
        if success and frame is not None:
            return 'active', None
        else:
            return 'inactive', error_msg or 'Failed to connect to stream'
    except Exception as e:
        logger.warning(f"Error checking stream status for {stream_url}: {e}")
        return 'inactive', str(e)


def prepare_camera_data(data: Dict[str, Any], check_status: bool = True) -> Dict[str, Any]:
    """
    Prepare and normalize camera data for storage
    
    Args:
        data: Raw input data
        check_status: Whether to dynamically check stream status
        
    Returns:
        Normalized camera data dictionary
    """
    # Handle IP address and stream URL
    ip_address = str(data.get('ip_address', '')).strip()
    stream_url = str(data.get('stream_url', '')).strip()
    
    # If IP address looks like a URL, treat it as stream_url
    if ip_address and (ip_address.startswith('http://') or ip_address.startswith('https://')):
        if not stream_url:
            stream_url = ip_address
        ip_address = ''
    
    # Extract IP from stream URL if IP is not provided
    if stream_url and not ip_address:
        ip_address = extract_ip_from_url(stream_url)
    
    # Dynamically check stream status if URL is provided
    status = 'inactive'
    last_error = None
    if check_status and stream_url:
        status, last_error = check_stream_status(stream_url)
        logger.info(f"Stream status check for {stream_url}: {status}")
    
    # Build camera data
    camera_data = {
        'name': str(data['name']).strip(),
        'ip_address': ip_address,
        'stream_url': stream_url,
        'location_name': str(data['location_name']).strip(),
        'city': str(data['city']).strip(),
        'latitude': float(data['latitude']),
        'longitude': float(data['longitude']),
        'status': status,
        'crowd_level': 'low',
        'count': 0,
        'last_updated': utc_now(),
        'created_at': utc_now()
    }
    
    if last_error:
        camera_data['last_error'] = last_error
    
    return camera_data


def capture_frame_from_stream(stream_url: str) -> Tuple[bool, Optional[np.ndarray], Optional[str]]:
    """
    Capture a frame from a video stream
    
    Args:
        stream_url: URL of the video stream
        
    Returns:
        Tuple of (success, frame, error_message)
    """
    cap = None
    frame = None
    
    try:
        # Reduced logging for performance
        logger.debug(f"Attempting to connect to stream: {stream_url}")
        
        # Determine stream type
        is_http_stream = stream_url.startswith('http://') or stream_url.startswith('https://')
        
        # Initialize appropriate capture method
        if is_http_stream:
            cap = MJPEGStream(stream_url, timeout=STREAM_TIMEOUT)
        else:
            cap = cv2.VideoCapture(stream_url)
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        
        # Check if stream opened successfully
        if not cap.isOpened():
            return False, None, 'Failed to open camera stream. Check if URL is accessible.'
        
        # Capture frame based on stream type
        if is_http_stream:
            # For MJPEG streams, try multiple attempts (reduced for speed)
            success = False
            for attempt in range(MAX_FRAME_CAPTURE_ATTEMPTS):
                ret, frame = cap.read()
                if ret and frame is not None and frame.size > 0:
                    success = True
                    break
                if attempt < MAX_FRAME_CAPTURE_ATTEMPTS - 1:  # Don't sleep on last attempt
                    time.sleep(0.02)  # Minimal sleep time for faster processing
            
            if not success:
                return False, None, 'Failed to capture valid frame from MJPEG stream after multiple attempts'
        else:
            # For other streams, minimal frame skipping for speed
            for i in range(FRAME_SKIP_COUNT):
                ret_temp, _ = cap.read()
                if not ret_temp:
                    break
                time.sleep(0.01)  # Minimal sleep time for faster processing
            
            ret, frame = cap.read()
            if not ret or frame is None:
                return False, None, 'Failed to capture frame from stream. Stream may be offline or format not supported.'
        
        # Validate frame
        if frame is None or frame.size == 0:
            return False, None, 'Captured frame is empty'
        
        if len(frame.shape) < 2 or frame.shape[0] < MIN_FRAME_DIMENSION or frame.shape[1] < MIN_FRAME_DIMENSION:
            return False, None, f'Invalid frame format or dimensions too small (minimum {MIN_FRAME_DIMENSION}x{MIN_FRAME_DIMENSION})'
        
        return True, frame, None
        
    except cv2.error as e:
        error_msg = f'OpenCV error accessing stream: {str(e)}'
        logger.error(error_msg)
        return False, None, error_msg
    except Exception as e:
        error_msg = f'Failed to access camera stream: {str(e)}'
        logger.error(error_msg)
        logger.error(traceback.format_exc())
        return False, None, error_msg
    finally:
        if cap is not None:
            try:
                cap.release()
            except Exception as e:
                logger.warning(f"Error releasing capture: {e}")


def process_frame_with_detector(frame: np.ndarray, camera_id: Optional[str] = None, enable_face_recognition: bool = True) -> Tuple[bool, Optional[Dict[str, Any]], Optional[str]]:
    """
    Process frame with crowd detector AND face recognition
    
    Args:
        frame: Video frame to process
        camera_id: Optional camera ID for face recognition context
        enable_face_recognition: Whether to run face recognition (default: True)
        
    Returns:
        Tuple of (success, results, error_message)
    """
    try:
        logger.info(f"Processing frame: shape={frame.shape}, dtype={frame.dtype}")
        
        detector = get_detector()
        results = detector.process_frame(frame)
        
        # Ensure results have required fields
        if 'count' not in results:
            results['count'] = 0
        if 'level' not in results:
            results['level'] = 'low'
        if 'boxes' not in results:
            results['boxes'] = []
        
        # Run face recognition only when there are active missing-person searches.
        # CRITICAL: do not run missing-person detection continuously.
        detected_faces = []
        missing_persons_detected = []
        
        if enable_face_recognition:
            try:
                from datetime import datetime
                db = get_firestore()
                missing_persons_ref = db.collection('missing_persons')
                # Only consider persons with search_active == True.
                # Status is authoritative for UI, but search_active gates compute.
                searching_persons = list(missing_persons_ref.where('search_active', '==', True).stream())
                searching_list = []
                for p in searching_persons:
                    data = p.to_dict() or {}
                    # Don't scan if case is already fully resolved
                    if data.get('status') == 'MATCH_CONFIRMED':
                        continue
                    searching_list.append((p.id, data))
                if searching_list:
                    from models.face_recognition import get_recognizer
                    recognizer = get_recognizer(reload_db=True)
                    if recognizer and recognizer.face_analyzer is not None:
                        stats = recognizer.get_face_stats()
                        logger.debug(f"[Crowd+Face Detection] Face recognition enabled. Database has {stats['total_people']} people, {stats['total_embeddings']} embeddings")
                        detected_faces = []
                        # 1. Run detection ONCE per frame! This is the heavy lifting.
                        face_results = recognizer.detect_and_recognize(frame, force_detection=True)
                        if face_results:
                            detected_faces = [{
                                'bbox': r.get('bbox'),
                                'label': r.get('label', 'Unknown'),
                                'confidence': r.get('confidence', 0.0)
                            } for r in face_results]
                            
                            # 2. Iterate over detected faces
                            for face_result in face_results:
                                emb = face_result.get('embedding')
                                
                                # 3. Check against all active missing persons
                                for person_id, person_data in searching_list:
                                    if person_data.get('search_active') is not True:
                                        continue
                                        
                                    detected_person_id = face_result.get('label')
                                    confidence = face_result.get('confidence', 0.0)
                                    match_threshold = float(getattr(recognizer, "threshold", 0.5))
                                    
                                    # If internal DB didn't match this person, try Firestore embedding manually
                                    if detected_person_id != person_id and emb is not None:
                                        target_embedding = person_data.get('face_embedding')
                                        if target_embedding:
                                            try:
                                                te = np.array(target_embedding, dtype=np.float32)
                                                enorm = np.linalg.norm(emb)
                                                tnorm = np.linalg.norm(te)
                                                if enorm > 0 and tnorm > 0:
                                                    score = float(np.dot(te, emb) / (tnorm * enorm))
                                                    if score > confidence:
                                                        confidence = score
                                                        if score >= match_threshold:
                                                            detected_person_id = person_id
                                            except Exception as e:
                                                logger.debug(f"[Crowd+Face Detection] Manual embedding match error: {e}")
                                                
                                    logger.debug(f"[Crowd+Face Detection] Checking face for searching person {person_id}: label={detected_person_id}, confidence={confidence:.4f}")
                                    if detected_person_id == person_id and confidence >= match_threshold:
                                        logger.info(f"[Crowd+Face Detection] MATCH! Person {person_id} ({person_data.get('name', 'Unknown')}) detected with confidence {confidence:.4f}")
                                        if camera_id:
                                            camera_ref = db.collection('cctv_cameras').document(camera_id)
                                            camera_doc = camera_ref.get()
                                            camera_data = camera_doc.to_dict() if camera_doc.exists else {}
                                            location = {
                                                'name': camera_data.get('location_name', ''),
                                                'city': camera_data.get('city', ''),
                                                'latitude': camera_data.get('latitude', 0),
                                                'longitude': camera_data.get('longitude', 0),
                                                'address': f"{camera_data.get('location_name', '')}, {camera_data.get('city', '')}"
                                            }
                                            person_details = {
                                                'name': person_data.get('name', 'Unknown'),
                                                'age': person_data.get('age'),
                                                'gender': person_data.get('gender'),
                                                'description': person_data.get('description', ''),
                                                'photo_url': person_data.get('photo_url', ''),
                                                'last_seen_location': person_data.get('last_seen_location', ''),
                                                'last_seen_city': person_data.get('last_seen_city', '')
                                            }
                                            detection_status = 'detected' if confidence > 0.7 else 'possible_match'
                                            notifications_ref = db.collection('notifications')
                                            notif_id = f"missing_person_detected_{detected_person_id}"
                                            notif_ref = notifications_ref.document(notif_id)
                                            now = utc_now()
                                            try:
                                                # Throttle duplicate detections (per person) to avoid overload
                                                # Default 15 seconds
                                                throttle_s = 15
                                                last_det = person_data.get('last_detection_at')
                                                try:
                                                    if hasattr(last_det, "timestamp"):
                                                        last_det_s = float(last_det.timestamp())
                                                    elif isinstance(last_det, str):
                                                        import datetime as _dt
                                                        last_det_s = _dt.datetime.fromisoformat(last_det.replace("Z", "+00:00")).timestamp()
                                                    else:
                                                        last_det_s = None
                                                except Exception:
                                                    last_det_s = None
    
                                                if last_det_s is not None and (now.timestamp() - last_det_s) < throttle_s:
                                                    continue
    
                                                # Upload CCTV capture (cropped face if bbox present, else whole frame)
                                                cctv_image_url = None
                                                try:
                                                    from utils.images import upload_bgr_frame_to_cloudinary
                                                    bbox = face_result.get('bbox')
                                                    crop_bbox = None
                                                    if bbox and isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
                                                        crop_bbox = (bbox[0], bbox[1], bbox[2], bbox[3])
                                                    cctv_image_url = upload_bgr_frame_to_cloudinary(
                                                        frame,
                                                        folder="cctv_detections",
                                                        public_id=f"missing_{detected_person_id}_{now.strftime('%Y%m%d_%H%M%S')}",
                                                        crop_bbox=crop_bbox,
                                                    )
                                                except Exception as _img_e:
                                                    logger.debug(f"[Crowd+Face Detection] CCTV image upload skipped: {_img_e}")
    
                                                existing_doc = notif_ref.get()
                                                existing_data = existing_doc.to_dict() if existing_doc.exists else {}
                                                if existing_data.get('confirmed') is True:
                                                    logger.info(f"[Crowd+Face Detection] Detection for {detected_person_id} already confirmed; skipping update")
                                                else:
                                                    # Pause scanning for this case until authority triggers rescan.
                                                    try:
                                                        db.collection('missing_persons').document(detected_person_id).update({
                                                            'status': 'DETECTED',
                                                            'search_active': False,
                                                            # Authority reviews first; citizen sees only after explicit inform action.
                                                            'notification_sent': False,
                                                            'cctv_image': cctv_image_url,
                                                            'last_detection_at': now,
                                                            'last_updated': now,
                                                            'updated_at': now,
                                                        })
                                                    except Exception as _mp_e:
                                                        logger.debug(f"[Crowd+Face Detection] Failed to update missing person state: {_mp_e}")
    
                                                    payload = {
                                                        'type': 'missing_person_detected',
                                                        'person_id': detected_person_id,
                                                        'person_name': person_data.get('name', 'Unknown'),
                                                        'person_details': person_details,
                                                        'missing_person_image': person_data.get('image_url') or person_data.get('photo_url') or person_details.get('photo_url', ''),
                                                        'cctv_image': cctv_image_url,
                                                        'camera_id': camera_id,
                                                        'camera_name': camera_data.get('name', camera_id),
                                                        'location': location,
                                                        'detection_status': detection_status,
                                                        'confidence': float(confidence),
                                                        'confidence_percentage': float(confidence * 100),
                                                        'bbox': face_result.get('bbox'),
                                                        'detected_at': now,
                                                        'detection_time': now.isoformat().replace("+00:00", "Z"),
                                                        'updated_at': now,
                                                        'user_id': person_data.get('reported_by'),
                                                        # Authority reviews first; citizen sees only after inform action.
                                                        'visible_to_citizen': existing_data.get('visible_to_citizen', False),
                                                        'read': False,
                                                        'confirmed': existing_data.get('confirmed', False),
                                                        'created_at': existing_data.get('created_at', now),
                                                    }
                                                    notif_ref.set(payload, merge=True)
                                                    logger.info(f"[Crowd+Face Detection] Upserted detection notification for {person_data.get('name')} (person_id={detected_person_id})")
                                            except Exception as notif_err:
                                                logger.warning(f"[Crowd+Face Detection] Failed to upsert notification: {notif_err}")
                                            missing_persons_detected.append({
                                                'person_id': detected_person_id,
                                                'person_name': person_data.get('name', 'Unknown'),
                                                'confidence': float(confidence)
                                            })
                    
                    logger.debug(f"[Crowd+Face Detection] Detected {len(detected_faces)} faces, {len(missing_persons_detected)} missing persons")
                    
            except ImportError:
                logger.debug("[Crowd+Face Detection] Face recognition not available (InsightFace not installed)")
            except Exception as e:
                logger.warning(f"[Crowd+Face Detection] Face recognition error (non-critical): {e}")
                # Don't fail crowd detection if face recognition fails
        
        # Add face detection results to crowd detection results
        results['faces_detected'] = len(detected_faces)
        results['faces'] = detected_faces
        results['missing_persons_in_crowd'] = missing_persons_detected
        try:
            fire_detector = get_fire_smoke_detector()
            fire_out = fire_detector.process_frame(frame)
            fire_count = int(fire_out.get('fire', 0))
            smoke_count = int(fire_out.get('smoke', 0))
            results['fire'] = fire_count
            results['smoke'] = smoke_count
            results['fire_smoke_boxes'] = fire_out.get('boxes', [])
            logger.info(f"[FireSmoke] camera={camera_id or 'N/A'} fire={fire_count} smoke={smoke_count}")
            if camera_id:
                db = get_firestore()
                
                types_to_update = set()
                if fire_count > 0:
                    types_to_update.add("FIRE")
                if smoke_count > 0:
                    types_to_update.add("SMOKE")
                
                # Keep updating frames for ACTIVE alerts even if no fire/smoke currently detected
                try:
                    active_alerts = db.collection('alerts').where(filter=FieldFilter('camera_id', '==', camera_id)).where(filter=FieldFilter('status', '==', 'ACTIVE')).stream()
                    for doc_snap in active_alerts:
                        t = doc_snap.to_dict().get('type')
                        if t in ["FIRE", "SMOKE"]:
                            types_to_update.add(t)
                except Exception as e:
                    logger.warning(f"[FireSmoke] Failed to fetch active alerts: {e}")

                if types_to_update:
                    from utils.images import upload_bgr_frame_to_cloudinary, delete_cloudinary_image
                    camera_ref = db.collection('cctv_cameras').document(camera_id)
                    camera_doc = camera_ref.get()
                    cam = camera_doc.to_dict() if camera_doc.exists else {}
                    location_name = str(cam.get('location_name') or '').strip()
                    camera_name = str(cam.get('name') or camera_id)
                    now = utc_now()

                    for alert_type in types_to_update:
                        # Determine if this specific type is actively detected in the current frame
                        is_currently_detected = (alert_type == "FIRE" and fire_count > 0) or (alert_type == "SMOKE" and smoke_count > 0)
                        msg = f'{alert_type} detected by camera {camera_name}' if is_currently_detected else f'Ongoing alert: Monitoring live feed (no {alert_type} currently detected)'

                        alerts_ref = db.collection('alerts')
                        alert_doc_id = f"fire_smoke_{camera_id}_{alert_type}"
                        alert_ref = alerts_ref.document(alert_doc_id)
                        existing_doc = alert_ref.get()

                        # IMPORTANT: Only upload a new image when this specific type is currently
                        # detected. If FIRE is not detected but SMOKE is, we must NOT overwrite
                        # the FIRE alert's image with the current (smoke) frame — that causes the
                        # image swap bug. Instead keep the last captured image for inactive alerts.
                        image_url: Optional[str] = None
                        if is_currently_detected:
                            import cv2
                            frame_to_upload = frame.copy()
                            boxes = results.get('fire_smoke_boxes', [])
                            for b in boxes:
                                label = str(b.get('label', '')).lower()
                                conf = float(b.get('conf', 0))
                                bbox = b.get('bbox')
                                
                                is_match = False
                                color = (255, 255, 255)
                                if alert_type == "FIRE" and label in ('fire', 'flame', 'flames'):
                                    is_match = True
                                    color = (0, 0, 255)  # Red for fire
                                elif alert_type == "SMOKE" and label in ('smoke', 'smokes'):
                                    is_match = True
                                    color = (128, 128, 128)  # Gray for smoke
                                    
                                if is_match and bbox and len(bbox) >= 4:
                                    x1, y1, x2, y2 = map(int, bbox)
                                    cv2.rectangle(frame_to_upload, (x1, y1), (x2, y2), color, 2)
                                    text = f"{alert_type} {conf:.2f}"
                                    cv2.putText(frame_to_upload, text, (x1, max(y1 - 10, 0)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

                            public_id = f"{alert_type.lower()}_{camera_id}_{int(now.timestamp())}"
                            image_url = upload_bgr_frame_to_cloudinary(
                                frame_to_upload,
                                folder="fire_smoke_alerts",
                                public_id=public_id,
                            )
                            if not image_url:
                                image_url = upload_bgr_frame_to_cloudinary(
                                    frame_to_upload,
                                    folder="fire_smoke_alerts",
                                    public_id=f"{public_id}_retry",
                                )
                            if not image_url:
                                logger.warning(f"[FireSmoke] Cloudinary upload failed for {alert_type}; keeping existing image")

                        # Build payload — only include image_url key when we have a new upload
                        # so that Firestore merge() leaves the existing image untouched otherwise.
                        payload: Dict[str, Any] = {
                            'type': alert_type,
                            'camera_id': camera_id,
                            'location': location_name,
                            'status': 'ACTIVE',
                            'updated_at': now,
                            'message': msg,
                            'resolved': False,
                            'location_name': location_name,
                        }
                        if image_url:
                            payload['image_url'] = image_url

                        if existing_doc.exists:
                            existing_data = existing_doc.to_dict() or {}
                            # If upload failed (or was skipped), fall back to the stored image
                            if not payload.get('image_url') and existing_data.get('image_url'):
                                payload['image_url'] = existing_data.get('image_url')
                            alert_ref.set(payload, merge=True)

                            # Clean up old image from Cloudinary to prevent storage exhaustion
                            new_img = payload.get('image_url')
                            old_img = existing_data.get('image_url')
                            if new_img and old_img and new_img != old_img:
                                delete_cloudinary_image(old_img)
                        elif is_currently_detected:
                            payload['created_at'] = now
                            payload['created_by'] = 'system'
                            alert_ref.set(payload)
        except Exception as e:
            logger.exception(f"[FireSmoke] detection/write failed: {e}")
        
        logger.info(f"Detection results: count={results['count']}, level={results['level']}, faces={len(detected_faces)}, missing_persons={len(missing_persons_detected)}")
        
        return True, results, None
        
    except Exception as e:
        error_msg = f'Failed to process frame with detector: {str(e)}'
        logger.error(error_msg)
        logger.error(traceback.format_exc())
        return False, None, error_msg


@cctv_bp.route('/list', methods=['GET'])
@require_auth
def list_cameras():
    """
    List all CCTV cameras
    
    Returns:
        JSON response with list of cameras
    """
    try:
        db = get_firestore()
        cameras_ref = db.collection('cctv_cameras')
        cameras = cameras_ref.stream()
        
        camera_list = []
        for camera in cameras:
            try:
                camera_data = camera.to_dict()
                camera_data['id'] = camera.id
                camera_list.append(camera_data)
            except Exception as e:
                logger.warning(f"Error processing camera {camera.id}: {e}")
                continue
        
        return jsonify({
            'success': True,
            'cameras': camera_list,
            'count': len(camera_list)
        }), 200
        
    except Exception as e:
        if is_quota_error(e):
            logger.warning("Firestore quota exceeded while listing cameras; returning temporary empty list")
            return jsonify({
                'success': True,
                'cameras': [],
                'count': 0,
                'degraded': True,
                'message': 'Camera data is temporarily unavailable due to Firestore quota limits. Please retry shortly.'
            }), 200
        logger.error(f"Failed to list cameras: {e}")
        logger.error(traceback.format_exc())
        return jsonify({
            'success': False,
            'error': f'Failed to list cameras: {str(e)}'
        }), 500


@cctv_bp.route('/add', methods=['POST'])
@require_auth
@require_role('authority')
def add_camera():
    """
    Add new CCTV camera (Authority only)
    
    Request Body:
        {
            "name": "Camera Name",
            "ip_address": "192.168.1.100",  # Optional if stream_url provided
            "stream_url": "rtsp://...",      # Or http://... for MJPEG
            "location_name": "Location Name",
            "city": "City Name",
            "latitude": 40.7128,
            "longitude": -74.0060
        }
    
    Returns:
        JSON response with created camera data
    """
    try:
        logger.info("Received request to add camera")
        logger.info(f"Content type: {request.content_type}")
        
        # Parse request data
        data = request.get_json()
        logger.info(f"Parsed JSON data: {data}")
        
        # Validate data
        is_valid, error_msg = validate_camera_data(data)
        if not is_valid:
            return jsonify({
                'success': False,
                'error': error_msg
            }), 400
        
        # Prepare camera data
        camera_data = prepare_camera_data(data)
        
        # Save to Firestore
        db = get_firestore()
        camera_ref = db.collection('cctv_cameras').document()
        camera_ref.set(camera_data)
        
        logger.info(f"Successfully added camera with ID: {camera_ref.id}")
        
        # Prepare response data (convert datetime to string for JSON serialization)
        response_data = camera_data.copy()
        response_data['id'] = camera_ref.id
        response_data['created_at'] = to_utc_iso(camera_data['created_at'])
        response_data['last_updated'] = to_utc_iso(camera_data['last_updated'])
        
        return jsonify({
            'success': True,
            'camera_id': camera_ref.id,
            'camera': response_data
        }), 201
        
    except Exception as e:
        logger.error(f"Failed to add camera: {e}")
        logger.error(traceback.format_exc())
        return jsonify({
            'success': False,
            'error': f'Failed to add camera: {str(e)}'
        }), 500


@cctv_bp.route('/update/<camera_id>', methods=['PUT'])
@require_auth
@require_role('authority')
def update_camera(camera_id):
    """
    Update camera information (Authority only)
    
    Args:
        camera_id: ID of the camera to update
        
    Returns:
        JSON response with success status
    """
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'success': False,
                'error': 'Request body is empty'
            }), 400
        
        db = get_firestore()
        camera_ref = db.collection('cctv_cameras').document(camera_id)
        camera_doc = camera_ref.get()
        
        if not camera_doc.exists:
            return jsonify({
                'success': False,
                'error': 'Camera not found'
            }), 404
        
        # Build update data with only allowed fields
        update_data = {}
        for field in ALLOWED_FIELDS:
            if field in data:
                value = data[field]
                # Validate and convert types
                if field in ['latitude', 'longitude']:
                    try:
                        value = float(value)
                        if field == 'latitude' and not (-90 <= value <= 90):
                            return jsonify({
                                'success': False,
                                'error': 'Latitude must be between -90 and 90'
                            }), 400
                        if field == 'longitude' and not (-180 <= value <= 180):
                            return jsonify({
                                'success': False,
                                'error': 'Longitude must be between -180 and 180'
                            }), 400
                    except (ValueError, TypeError):
                        return jsonify({
                            'success': False,
                            'error': f'{field} must be a valid number'
                        }), 400
                elif field == 'city':
                    value = str(value).strip().title()
                elif field == 'status':
                    if value not in ['active', 'inactive']:
                        return jsonify({
                            'success': False,
                            'error': 'Status must be either "active" or "inactive"'
                        }), 400
                
                update_data[field] = value
        
        if not update_data:
            return jsonify({
                'success': False,
                'error': 'No valid fields to update'
            }), 400
        
        update_data['last_updated'] = utc_now()
        
        camera_ref.update(update_data)
        
        logger.info(f"Successfully updated camera {camera_id}")
        
        return jsonify({
            'success': True,
            'message': 'Camera updated successfully',
            'updated_fields': list(update_data.keys())
        }), 200
        
    except Exception as e:
        logger.error(f"Failed to update camera: {e}")
        logger.error(traceback.format_exc())
        return jsonify({
            'success': False,
            'error': f'Failed to update camera: {str(e)}'
        }), 500


@cctv_bp.route('/delete/<camera_id>', methods=['DELETE'])
@require_auth
@require_role('authority')
def delete_camera(camera_id):
    """
    Delete camera (Authority only)
    
    Args:
        camera_id: ID of the camera to delete
        
    Returns:
        JSON response with success status
    """
    try:
        db = get_firestore()
        camera_ref = db.collection('cctv_cameras').document(camera_id)
        camera_doc = camera_ref.get()
        
        if not camera_doc.exists:
            return jsonify({
                'success': False,
                'error': 'Camera not found'
            }), 404
        
        camera_ref.delete()
        
        logger.info(f"Successfully deleted camera {camera_id}")
        
        return jsonify({
            'success': True,
            'message': 'Camera deleted successfully'
        }), 200
        
    except Exception as e:
        logger.error(f"Failed to delete camera: {e}")
        logger.error(traceback.format_exc())
        return jsonify({
            'success': False,
            'error': f'Failed to delete camera: {str(e)}'
        }), 500


@cctv_bp.route('/test-stream', methods=['POST'])
@require_auth
@require_role('authority')
def test_stream():
    """
    Test stream connection and detection (for debugging)
    
    Request Body:
        {
            "stream_url": "http://... or rtsp://..."
        }
    
    Returns:
        JSON response with test results
    """
    try:
        data = request.get_json()
        stream_url = data.get('stream_url')
        
        if not stream_url:
            return jsonify({
                'success': False,
                'error': 'stream_url is required'
            }), 400
        
        logger.info(f"Testing stream: {stream_url}")
        
        # Capture frame
        success, frame, error_msg = capture_frame_from_stream(stream_url)
        
        if not success or frame is None:
            return jsonify({
                'success': False,
                'stream_connected': False,
                'error': error_msg
            }), 500
        
        # Test detection AND face recognition
        success, results, error_msg = process_frame_with_detector(frame, enable_face_recognition=True)
        
        if not success:
            return jsonify({
                'success': False,
                'stream_connected': True,
                'error': error_msg
            }), 500
            
        if results is None:
            results = {}
        
        response_data = {
            'success': True,
            'stream_connected': True,
            'frame_shape': list(frame.shape),
            'frame_dtype': str(frame.dtype),
            'detection_results': {
                'count': results['count'],
                'level': results['level'],
                'boxes_detected': len(results.get('boxes', [])),
                'fire': results.get('fire', 0),
                'smoke': results.get('smoke', 0)
            }
        }
        
        # Add face recognition results if available
        if 'faces_detected' in results:
            response_data['face_recognition'] = {
                'faces_detected': results.get('faces_detected', 0),
                'missing_persons_in_crowd': len(results.get('missing_persons_in_crowd', []))
            }
            if results.get('missing_persons_in_crowd'):
                response_data['face_recognition']['detected_persons'] = results['missing_persons_in_crowd']
        
        return jsonify(response_data), 200
        
    except Exception as e:
        logger.error(f"Stream test failed: {e}")
        logger.error(traceback.format_exc())
        return jsonify({
            'success': False,
            'error': f'Test failed: {str(e)}'
        }), 500


@cctv_bp.route('/process/<camera_id>', methods=['POST'])
@require_auth
@require_role('authority')
def process_camera_feed(camera_id):
    """
    Process camera feed and update crowd data (Authority only)
    This endpoint would be called periodically by a background service
    
    Args:
        camera_id: ID of the camera to process
        
    Returns:
        JSON response with processing results
    """
    try:
        # Get camera data from Firestore
        db = get_firestore()
        camera_ref = db.collection('cctv_cameras').document(camera_id)
        camera_doc = camera_ref.get()
        
        if not camera_doc.exists:
            return jsonify({
                'success': False,
                'error': 'Camera not found'
            }), 404
        
        camera_data = camera_doc.to_dict()
        stream_url = camera_data.get('stream_url')
        
        if not stream_url:
            return jsonify({
                'success': False,
                'error': 'No stream URL configured for this camera'
            }), 400
        
        # Capture frame from stream
        success, frame, error_msg = capture_frame_from_stream(stream_url)
        
        if not success or frame is None:
            # Update camera status to indicate connection issue
            camera_ref.update({
                'status': 'inactive',
                'last_error': error_msg,
                'last_updated': utc_now()
            })
            return jsonify({
                'success': False,
                'error': error_msg,
                'status': 'inactive'
            }), 500
        
        # Process frame with detector AND face recognition
        success, results, error_msg = process_frame_with_detector(frame, camera_id=camera_id, enable_face_recognition=True)
        
        if not success:
            # Update status but keep it as inactive if processing fails
            camera_ref.update({
                'status': 'inactive',
                'last_error': error_msg,
                'last_updated': utc_now()
            })
            return jsonify({
                'success': False,
                'error': error_msg,
                'status': 'inactive'
            }), 500
            
        if results is None:
            results = {}
        
        # Update camera data in Firestore - status is active only if stream works
        update_data: Dict[str, Any] = {
            'count': int(results['count']),
            'crowd_level': str(results['level']),
            'status': 'active',  # Stream is working, so status is active
            'last_updated': utc_now()
        }
        
        # Add face detection data if available
        if 'faces_detected' in results:
            update_data['faces_detected'] = int(results.get('faces_detected', 0))
        if 'missing_persons_in_crowd' in results and results['missing_persons_in_crowd']:
            update_data['missing_persons_detected'] = len(results['missing_persons_in_crowd'])
        
        # Clear any previous error since stream is working
        update_data['last_error'] = None
        
        logger.info(f"Updating camera {camera_id} with: {update_data}")
        camera_ref.update(update_data)
        
        response_results = {
            'count': results['count'],
            'level': results['level'],
            'boxes_detected': len(results.get('boxes', []))
        }
        
        # Add face recognition results if available
        if 'faces_detected' in results:
            response_results['faces_detected'] = results.get('faces_detected', 0)
            response_results['missing_persons_in_crowd'] = len(results.get('missing_persons_in_crowd', []))
            if results.get('missing_persons_in_crowd'):
                response_results['detected_missing_persons'] = results['missing_persons_in_crowd']
        
        return jsonify({
            'success': True,
            'camera_id': camera_id,
            'results': response_results,
            'frame_info': {
                'shape': list(frame.shape),
                'dtype': str(frame.dtype)
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Failed to process camera feed: {e}")
        logger.error(traceback.format_exc())
        
        # Try to update camera status to indicate error
        try:
            db = get_firestore()
            camera_ref = db.collection('cctv_cameras').document(camera_id)
            camera_ref.update({
                'status': 'inactive',
                'last_error': str(e),
                'last_updated': utc_now()
            })
        except Exception as update_error:
            logger.error(f"Failed to update camera status: {update_error}")
        
        return jsonify({
            'success': False,
            'error': f'Failed to process camera feed: {str(e)}'
        }), 500


@cctv_bp.route('/status/<camera_id>', methods=['GET'])
@require_auth
def get_camera_status(camera_id):
    """
    Get current status and crowd data for a specific camera
    Optionally checks stream status dynamically if check_stream parameter is true
    
    Args:
        camera_id: ID of the camera
        check_stream: Query parameter to force stream status check (default: false)
        
    Returns:
        JSON response with camera status
    """
    try:
        db = get_firestore()
        camera_ref = db.collection('cctv_cameras').document(camera_id)
        camera_doc = camera_ref.get()
        
        if not camera_doc.exists:
            return jsonify({
                'success': False,
                'error': 'Camera not found'
            }), 404
        
        camera_data = camera_doc.to_dict()
        camera_data['id'] = camera_id
        
        # Check if we should dynamically verify stream status AND process crowd detection
        check_stream = request.args.get('check_stream', 'false').lower() == 'true'
        if check_stream and camera_data.get('stream_url'):
            logger.info(f"Dynamically checking stream status and processing crowd detection for camera {camera_id}")
            status, error_msg = check_stream_status(camera_data['stream_url'])
            
            # If stream is accessible, also process frame for crowd detection
            update_data: Dict[str, Any] = {
                'status': status,
                'last_updated': utc_now()
            }
            
            if status == 'active' and not error_msg:
                # Stream is working - capture and process frame for crowd detection
                try:
                    success, frame, frame_error = capture_frame_from_stream(camera_data['stream_url'])
                    if success and frame is not None:
                        # Process frame with detector AND face recognition
                        proc_success, results, proc_error = process_frame_with_detector(frame, camera_id=camera_id, enable_face_recognition=True)
                        if proc_success and results:
                            update_data['count'] = int(results.get('count', 0))
                            update_data['crowd_level'] = str(results.get('level', 'low'))
                            if 'faces_detected' in results:
                                update_data['faces_detected'] = int(results.get('faces_detected', 0))
                            if 'missing_persons_in_crowd' in results and results['missing_persons_in_crowd']:
                                update_data['missing_persons_detected'] = len(results['missing_persons_in_crowd'])
                            logger.info(f"Updated crowd detection: count={update_data['count']}, level={update_data['crowd_level']}, faces={results.get('faces_detected', 0)}")
                        else:
                            logger.warning(f"Frame processing failed: {proc_error}")
                    else:
                        logger.warning(f"Frame capture failed: {frame_error}")
                except Exception as e:
                    logger.error(f"Error during crowd detection processing: {e}", exc_info=True)
            else:
                # Stream is inactive - reset all crowd detection values
                update_data['count'] = 0
                update_data['crowd_level'] = 'low'
                logger.info(f"Camera {camera_id} is inactive - resetting crowd detection values")
            
            if error_msg:
                update_data['last_error'] = error_msg
            elif 'last_error' in camera_data:
                update_data['last_error'] = None
            
            camera_ref.update(update_data)
            camera_data.update(update_data)
            logger.info(f"Updated camera {camera_id}: status={status}, count={update_data.get('count', 'N/A')}, level={update_data.get('crowd_level', 'N/A')}")
        
        # Convert datetime objects to ISO format strings
        if 'created_at' in camera_data and camera_data['created_at']:
            camera_data['created_at'] = to_utc_iso(camera_data['created_at'])
        if 'last_updated' in camera_data and camera_data['last_updated']:
            camera_data['last_updated'] = to_utc_iso(camera_data['last_updated'])
        
        return jsonify({
            'success': True,
            'camera': camera_data
        }), 200
        
    except Exception as e:
        logger.error(f"Failed to get camera status: {e}")
        logger.error(traceback.format_exc())
        return jsonify({
            'success': False,
            'error': f'Failed to get camera status: {str(e)}'
        }), 500


@cctv_bp.route('/check-status/<camera_id>', methods=['POST'])
@require_auth
@require_role('authority')
def check_camera_status(camera_id):
    """
    Dynamically check and update camera stream status AND process crowd detection
    
    Args:
        camera_id: ID of the camera to check
        
    Returns:
        JSON response with updated status and crowd detection results
    """
    try:
        db = get_firestore()
        camera_ref = db.collection('cctv_cameras').document(camera_id)
        camera_doc = camera_ref.get()
        
        if not camera_doc.exists:
            return jsonify({
                'success': False,
                'error': 'Camera not found'
            }), 404
        
        camera_data = camera_doc.to_dict()
        stream_url = camera_data.get('stream_url')
        
        if not stream_url:
            return jsonify({
                'success': False,
                'error': 'No stream URL configured for this camera'
            }), 400
        
        # Check stream status dynamically
        logger.info(f"Checking stream status and processing crowd detection for camera {camera_id}: {stream_url}")
        status, error_msg = check_stream_status(stream_url)
        
        # Update camera status
        update_data: Dict[str, Any] = {
            'status': status,
            'last_updated': utc_now()
        }
        
        # If stream is active, process frame for crowd detection
        if status == 'active' and not error_msg:
            try:
                success, frame, frame_error = capture_frame_from_stream(stream_url)
                if success and frame is not None:
                    # Process frame with detector AND face recognition
                    proc_success, results, proc_error = process_frame_with_detector(frame, camera_id=camera_id, enable_face_recognition=True)
                    if proc_success and results:
                        update_data['count'] = int(results.get('count', 0))
                        update_data['crowd_level'] = str(results.get('level', 'low'))
                        if 'faces_detected' in results:
                            update_data['faces_detected'] = int(results.get('faces_detected', 0))
                        if 'missing_persons_in_crowd' in results and results['missing_persons_in_crowd']:
                            update_data['missing_persons_detected'] = len(results['missing_persons_in_crowd'])
                        logger.info(f"Updated crowd detection: count={update_data['count']}, level={update_data['crowd_level']}, faces={results.get('faces_detected', 0)}")
                    else:
                        logger.warning(f"Frame processing failed: {proc_error}")
                else:
                    logger.warning(f"Frame capture failed: {frame_error}")
            except Exception as e:
                logger.error(f"Error during crowd detection processing: {e}", exc_info=True)
        else:
            # Stream is inactive - reset all crowd detection values
            update_data['count'] = 0
            update_data['crowd_level'] = 'low'
            logger.info(f"Camera {camera_id} is inactive - resetting crowd detection values")
        
        if error_msg:
            update_data['last_error'] = error_msg
        elif 'last_error' in camera_data:
            update_data['last_error'] = None
        
        camera_ref.update(update_data)
        
        logger.info(f"Camera {camera_id} status updated: status={status}, count={update_data.get('count', 'N/A')}, level={update_data.get('crowd_level', 'N/A')}")
        
        return jsonify({
            'success': True,
            'camera_id': camera_id,
            'status': status,
            'error': error_msg,
            'count': update_data.get('count', camera_data.get('count', 0)),
            'crowd_level': update_data.get('crowd_level', camera_data.get('crowd_level', 'low')),
            'message': f'Stream is {status}'
        }), 200
        
    except Exception as e:
        logger.error(f"Failed to check camera status: {e}")
        logger.error(traceback.format_exc())
        return jsonify({
            'success': False,
            'error': f'Failed to check camera status: {str(e)}'
        }), 500


@cctv_bp.route('/check-all-status', methods=['POST'])
@require_auth
@require_role('authority')
def check_all_camera_status():
    """
    Dynamically check and update status for all cameras
    
    Returns:
        JSON response with status check results
    """
    try:
        db = get_firestore()
        cameras_ref = db.collection('cctv_cameras')
        cameras = cameras_ref.stream()
        
        results = {
            'total': 0,
            'checked': 0,
            'active': 0,
            'inactive': 0,
            'errors': []
        }
        
        for camera in cameras:
            camera_data = {}
            try:
                camera_data = camera.to_dict()
                camera_id = camera.id
                stream_url = camera_data.get('stream_url')
                
                results['total'] += 1
                
                if not stream_url:
                    results['errors'].append({
                        'camera_id': camera_id,
                        'name': camera_data.get('name', 'Unknown'),
                        'error': 'No stream URL configured'
                    })
                    continue
                
                # Check stream status
                status, error_msg = check_stream_status(stream_url)
                results['checked'] += 1
                
                if status == 'active':
                    results['active'] += 1
                else:
                    results['inactive'] += 1
                
                # Update camera status and process crowd detection if stream is active
                camera_ref = db.collection('cctv_cameras').document(camera_id)
                update_data: Dict[str, Any] = {
                    'status': status,
                    'last_updated': utc_now()
                }
                
                # If stream is active, process frame for crowd detection
                if status == 'active' and not error_msg:
                    try:
                        success, frame, frame_error = capture_frame_from_stream(stream_url)
                        if success and frame is not None:
                            # Process frame with detector AND face recognition
                            proc_success, proc_results, proc_error = process_frame_with_detector(frame, camera_id=camera_id, enable_face_recognition=True)
                            if proc_success and proc_results:
                                update_data['count'] = int(proc_results.get('count', 0))
                                update_data['crowd_level'] = str(proc_results.get('level', 'low'))
                                if 'faces_detected' in proc_results:
                                    update_data['faces_detected'] = int(proc_results.get('faces_detected', 0))
                                if 'missing_persons_in_crowd' in proc_results and proc_results['missing_persons_in_crowd']:
                                    update_data['missing_persons_detected'] = len(proc_results['missing_persons_in_crowd'])
                                logger.debug(f"Camera {camera_id}: count={update_data['count']}, level={update_data['crowd_level']}, faces={proc_results.get('faces_detected', 0)}")
                    except Exception as e:
                        logger.warning(f"Error processing crowd detection for camera {camera_id}: {e}")
                else:
                    # Stream is inactive - reset all crowd detection values
                    update_data['count'] = 0
                    update_data['crowd_level'] = 'low'
                    logger.info(f"Camera {camera_id} is inactive - resetting crowd detection values")
                
                if error_msg:
                    update_data['last_error'] = error_msg
                elif 'last_error' in camera_data:
                    update_data['last_error'] = None
                
                camera_ref.update(update_data)
                
            except Exception as e:
                logger.error(f"Error checking camera {camera.id}: {e}")
                results['errors'].append({
                    'camera_id': camera.id,
                    'name': camera_data.get('name', 'Unknown'),
                    'error': str(e)
                })
                continue
        
        return jsonify({
            'success': True,
            'results': results
        }), 200
        
    except Exception as e:
        logger.error(f"Failed to check all camera status: {e}")
        logger.error(traceback.format_exc())
        return jsonify({
            'success': False,
            'error': f'Failed to check all camera status: {str(e)}'
        }), 500


@cctv_bp.errorhandler(400)
def bad_request(error):
    """Handle 400 errors"""
    return jsonify({
        'success': False,
        'error': 'Bad request',
        'message': str(error)
    }), 400


@cctv_bp.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({
        'success': False,
        'error': 'Not found',
        'message': str(error)
    }), 404


@cctv_bp.errorhandler(500)
def internal_error(error):
    """Handle 500 errors"""
    logger.error(f"Internal server error: {error}")
    return jsonify({
        'success': False,
        'error': 'Internal server error',
        'message': 'An unexpected error occurred'
    }), 500
