"""
CrowdSafe Backend - Flask Application
Main entry point for the backend API server
"""

from flask import Flask
from flask_cors import CORS  # type: ignore[import-untyped]
from dotenv import load_dotenv
import os
import io
import threading
import time
import random
import numpy as np
from concurrent.futures import ThreadPoolExecutor, as_completed
from google.cloud.firestore import FieldFilter
from google.api_core.exceptions import ResourceExhausted, TooManyRequests
import zoneinfo
from datetime import datetime, timezone, timedelta
import pytz  # type: ignore[import-untyped]
from utils.time import utc_now

# Load environment variables
load_dotenv()

# Initialize Flask app
app = Flask(__name__)
CORS(app, origins=os.getenv('CORS_ORIGINS', 'http://localhost:5173').split(','))

# Configuration
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'dev-secret-key-change-in-production')
app.config['FIREBASE_CREDENTIALS_PATH'] = os.getenv('FIREBASE_CREDENTIALS_PATH', '../firebase-credentials.json')
# FIREBASE_PROJECT_ID must be set in .env — no hardcoded fallback
app.config['FIREBASE_PROJECT_ID'] = os.getenv('FIREBASE_PROJECT_ID')
if not app.config['FIREBASE_PROJECT_ID']:
    print("[WARNING] FIREBASE_PROJECT_ID is not set in .env — some features may fail.")

# Initialize Firebase Admin SDK
from utils.firebase import initialize_firebase
try:
    initialize_firebase()
    print("[OK] Firebase Admin SDK initialized successfully")
except Exception as e:
    print(f"[WARNING] Firebase initialization failed: {e}")
    print("  Make sure FIREBASE_CREDENTIALS_PATH is set correctly in .env")

# Initialize Cloudinary
try:
    import cloudinary  # type: ignore
    # Support both CLOUDINARY_URL and individual credentials
    cloudinary_url = os.getenv('CLOUDINARY_URL')
    if cloudinary_url:
        cloudinary.config(cloudinary_url=cloudinary_url)
        print("[OK] Cloudinary configured using CLOUDINARY_URL")
    else:
        cloud_name = os.getenv('CLOUDINARY_CLOUD_NAME')
        api_key = os.getenv('CLOUDINARY_API_KEY')
        api_secret = os.getenv('CLOUDINARY_API_SECRET')
        if cloud_name and api_key and api_secret:
            cloudinary.config(
                cloud_name=cloud_name,
                api_key=api_key,
                api_secret=api_secret
            )
            print(f"[OK] Cloudinary configured: cloud_name={cloud_name}")
        else:
            print("[WARNING] Cloudinary not configured. Image uploads will fail.")
            print("  Set CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME, API_KEY, and API_SECRET")
except ImportError:
    print("[WARNING] Cloudinary package not installed. Image uploads will fail.")
    print("  Install with: pip install cloudinary")

# Import routes
from routes.auth import auth_bp
from routes.cctv import cctv_bp
from routes.alerts import alerts_bp
missing_bp = None  # initialised below if InsightFace is available
try:
    from routes.missing import missing_bp  # type: ignore[assignment]
    MISSING_BP_AVAILABLE = True
except Exception as e:
    print(f"[WARNING] Missing blueprint not loaded: {e}")
    print("  InsightFace dependencies may be unavailable. Skipping missing person routes.")
    print("  Install with: pip install insightface onnxruntime")
    MISSING_BP_AVAILABLE = False

# Register blueprints
app.register_blueprint(auth_bp, url_prefix='/api/auth')
app.register_blueprint(cctv_bp, url_prefix='/api/cctv')
app.register_blueprint(alerts_bp, url_prefix='/api/alerts')
if MISSING_BP_AVAILABLE:
    assert missing_bp is not None  # type-narrowing: True only when import succeeded
    app.register_blueprint(missing_bp, url_prefix='/api/missing')

# Background task for continuous crowd detection
def _is_quota_error(err: Exception) -> bool:
    """Return True when Firestore/API quota is exhausted."""
    if isinstance(err, (ResourceExhausted, TooManyRequests)):
        return True
    msg = str(err).lower()
    return "quota exceeded" in msg or "resource_exhausted" in msg or "429" in msg


def _quota_backoff_seconds(base_interval: int, consecutive_errors: int, max_backoff: int = 300) -> float:
    """
    Exponential backoff with jitter for quota failures.
    Keeps background threads from hot-looping against Firestore.
    """
    exp = max(0, min(consecutive_errors, 6))
    delay = min(max_backoff, base_interval * (2 ** exp))
    return delay + random.uniform(0, 1.0)


def _should_start_background_threads() -> bool:
    """
    Avoid duplicate background threads in Flask debug reloader parent process.
    """
    is_dev = os.getenv('FLASK_ENV') == 'development'
    if not is_dev:
        return True
    return os.getenv('WERKZEUG_RUN_MAIN') == 'true'


def process_single_camera(camera_doc, db, enable_face_recognition: bool = True):
    """Process a single camera - designed for parallel execution"""
    import logging
    from datetime import datetime
    from routes.cctv import capture_frame_from_stream, process_frame_with_detector, check_stream_status
    
    logger = logging.getLogger(__name__)
    
    def _same_value(a, b):
        return (a is None and b is None) or a == b

    def _has_meaningful_change(prev: dict, new_data: dict) -> bool:
        tracked = ['status', 'count', 'crowd_level', 'last_error', 'faces_detected', 'missing_persons_detected']
        for key in tracked:
            if key in new_data and not _same_value(prev.get(key), new_data.get(key)):
                return True
        return False

    try:
        camera_data = camera_doc.to_dict()
        camera_id = camera_doc.id
        stream_url = camera_data.get('stream_url')
        current_status = camera_data.get('status', 'inactive')
        last_updated = camera_data.get('last_updated')
        
        # Only process cameras with stream URLs
        if not stream_url:
            return {'camera_id': camera_id, 'status': 'skipped', 'reason': 'no_stream_url'}
        
        # Skip stream status check if camera was recently active (within last 5 seconds)
        # This reduces unnecessary network calls
        should_check_status = True
        if current_status == 'active' and last_updated:
            try:
                # Handle different date formats
                if isinstance(last_updated, str):
                    # Try parsing ISO format string
                    if 'T' in last_updated:
                        last_updated_dt = datetime.fromisoformat(last_updated.replace('Z', '+00:00'))
                    else:
                        last_updated_dt = datetime.strptime(last_updated, '%Y-%m-%d %H:%M:%S')
                elif hasattr(last_updated, 'timestamp'):
                    # Firestore timestamp object
                    last_updated_dt = last_updated
                else:
                    last_updated_dt = last_updated
                
                now_utc = utc_now()

                time_since_update: float = float('inf')  # default: assume stale
                try:
                    # 2. If the stored time has no timezone, tell Python it is utc
                    if last_updated_dt.tzinfo is None:
                        last_updated_dt = last_updated_dt.replace(tzinfo=pytz.utc)

                    # 3. Now the subtraction will work because both are "aware"
                    time_since_update = (now_utc - last_updated_dt).total_seconds()

                    if time_since_update < 5:
                        should_check_status = False
                except Exception as e:
                    print(f"Time check failed: {e}")

                # Re-check outside inner try (time_since_update is always defined above)
                if time_since_update < 5:
                    should_check_status = False
            except:
                pass  # If parsing fails, check status anyway
        
        # Check stream status only if needed
        if should_check_status:
            status, error_msg = check_stream_status(stream_url)
        else:
            status = 'active'  # Assume still active if recently updated
            error_msg = None
        
        camera_ref = db.collection('cctv_cameras').document(camera_id)
        
        # Process only if stream is active
        if status == 'active':
            # Capture and process frame
            success, frame, frame_error = capture_frame_from_stream(stream_url)
            
            if not success or frame is None:
                # Update status to inactive if frame capture failed
                fail_update = {
                    'status': 'inactive',
                    'count': 0,
                    'crowd_level': 'low',
                    'last_error': frame_error or 'Failed to capture frame',
                    'last_updated': utc_now()
                }
                if _has_meaningful_change(camera_data, fail_update):
                    camera_ref.update(fail_update)
                return {'camera_id': camera_id, 'status': 'failed', 'reason': 'frame_capture_failed'}
            
            # Process frame with crowd detector; face recognition is gated by active missing-person searches.
            proc_success, results, proc_error = process_frame_with_detector(frame, camera_id=camera_id, enable_face_recognition=enable_face_recognition)
            
            if proc_success and results:
                # Update camera with crowd detection results
                update_data = {
                    'count': int(results.get('count', 0)),
                    'crowd_level': str(results.get('level', 'low')),
                    'status': 'active',
                    'last_updated': utc_now(),
                    'last_error': None
                }
                
                # Add face detection data if available
                if 'faces_detected' in results:
                    update_data['faces_detected'] = int(results.get('faces_detected', 0))
                if 'missing_persons_in_crowd' in results and results['missing_persons_in_crowd']:
                    update_data['missing_persons_detected'] = len(results['missing_persons_in_crowd'])
                
                if _has_meaningful_change(camera_data, update_data):
                    camera_ref.update(update_data)
                return {
                    'camera_id': camera_id,
                    'status': 'success',
                    'count': update_data['count'],
                    'level': update_data['crowd_level']
                }
            else:
                return {'camera_id': camera_id, 'status': 'failed', 'reason': f'processing_error: {proc_error}'}
        else:
            # Stream is inactive - update status and reset crowd detection values
            inactive_update = {
                'status': 'inactive',
                'count': 0,
                'crowd_level': 'low',
                'last_error': error_msg or 'Stream is not accessible',
                'last_updated': utc_now()
            }
            if _has_meaningful_change(camera_data, inactive_update):
                camera_ref.update(inactive_update)
            return {'camera_id': camera_id, 'status': 'inactive', 'reason': error_msg}
    
    except Exception as e:
        logger.error(f"[Background Task] Error processing camera {camera_doc.id}: {e}", exc_info=True)
        return {'camera_id': camera_doc.id, 'status': 'error', 'reason': str(e)}


def process_all_cameras_continuously():
    """Background task that continuously processes all active cameras in parallel"""
    import logging
    from datetime import datetime
    
    # Delay imports to avoid circular dependencies
    time.sleep(2)  # Minimal delay to allow Flask app to initialize
    
    logger = logging.getLogger(__name__)
    processing_interval = int(os.getenv('CROWD_PROCESSING_INTERVAL', 20))  # Default 20 seconds
    max_workers = int(os.getenv('CROWD_PROCESSING_WORKERS', 4))  # Number of parallel workers
    quota_error_count = 0
    
    logger.info(f"[Background Task] Starting continuous crowd detection (interval: {processing_interval}s, workers: {max_workers})")
    
    while True:
        try:
            start_time = time.time()
            
            # Import here to avoid circular dependency issues
            from utils.firebase import get_firestore
            
            logger.info("[Background Task] Processing cameras for crowd detection...")
            
            # Get all cameras from Firestore
            db = get_firestore()
            assert db is not None, "Firestore client is not initialized"

            # CRITICAL: enable missing-person face recognition ONLY when there is an active search.
            enable_face_recognition = False
            try:
                mp_ref = db.collection('missing_persons')
                active = list(mp_ref.where('search_active', '==', True).limit(1).stream())
                enable_face_recognition = len(active) > 0
            except Exception:
                enable_face_recognition = False
            cameras_ref = db.collection('cctv_cameras')
            cameras = list(cameras_ref.stream())  # Convert to list for parallel processing
            
            if not cameras:
                logger.debug("[Background Task] No cameras found")
                time.sleep(processing_interval)
                continue
            
            processed_count = 0
            success_count = 0
            active_cameras_count = 0
            
            # Process cameras in parallel using ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                # Submit all camera processing tasks
                future_to_camera = {
                    executor.submit(process_single_camera, camera_doc, db, enable_face_recognition): camera_doc.id
                    for camera_doc in cameras
                }
                
                # Collect results as they complete
                for future in as_completed(future_to_camera):
                    camera_id = future_to_camera[future]
                    try:
                        result = future.result()
                        processed_count += 1
                        
                        if result['status'] == 'success':
                            success_count += 1
                            active_cameras_count += 1
                            logger.debug(f"[Background Task] Camera {camera_id}: count={result.get('count', 0)}, level={result.get('level', 'unknown')}")
                        elif result['status'] == 'inactive':
                            logger.debug(f"[Background Task] Camera {camera_id}: inactive - {result.get('reason', '')}")
                        elif result['status'] == 'failed':
                            logger.warning(f"[Background Task] Camera {camera_id}: failed - {result.get('reason', '')}")
                    except Exception as e:
                        logger.error(f"[Background Task] Error getting result for camera {camera_id}: {e}")
            
            elapsed_time = time.time() - start_time
            logger.info(f"[Background Task] Completed in {elapsed_time:.2f}s: {active_cameras_count} active, {processed_count} processed, {success_count} successful")
            quota_error_count = 0
            
            # Calculate sleep time to maintain consistent interval
            sleep_time = max(0, processing_interval - elapsed_time)
            if sleep_time > 0:
                time.sleep(sleep_time)
        
        except Exception as e:
            if _is_quota_error(e):
                quota_error_count += 1
                sleep_for = _quota_backoff_seconds(processing_interval, quota_error_count)
                logger.warning(
                    f"[Background Task] Firestore quota exceeded. Backing off for {sleep_for:.1f}s "
                    f"(consecutive errors: {quota_error_count})"
                )
                time.sleep(sleep_for)
            else:
                quota_error_count = 0
                logger.error(f"[Background Task] Error in background processing loop: {e}", exc_info=True)
                time.sleep(processing_interval)  # Wait for interval before retrying

# Start background processing thread
_background_thread = None

def start_background_processing():
    """Start the background crowd detection processing thread"""
    global _background_thread
    if _background_thread is None or not _background_thread.is_alive():
        _background_thread = threading.Thread(target=process_all_cameras_continuously, daemon=True)
        _background_thread.start()
        print("[OK] Background crowd detection processing started")

# Start background processing when app initializes
if _should_start_background_threads():
    start_background_processing()
else:
    print("[INFO] Skipping background threads in Flask reloader parent process")

# Background task for missing person face recognition scanning
def scan_missing_persons_continuously():
    """Background task that continuously scans CCTV cameras for missing persons with status 'searching' - OPTIMIZED"""
    import logging
    from datetime import datetime
    
    time.sleep(3)  # Reduced delay to allow Flask app to initialize
    
    # Import here to avoid circular dependencies at module load time
    from utils.firebase import get_firestore
    from models.face_recognition import get_recognizer
    from routes.cctv import capture_frame_from_stream
    
    logger = logging.getLogger(__name__)
    # Reduced scanning interval from 30s to 10s for faster detection
    scanning_interval = int(os.getenv('MISSING_PERSON_SCAN_INTERVAL', 10))  # Default 10 seconds
    max_workers = int(os.getenv('MISSING_PERSON_SCAN_WORKERS', 4))  # Parallel workers for camera processing
    quota_error_count = 0
    
    logger.info(f"[Missing Person Scanner] Starting optimized face recognition scanning (interval: {scanning_interval}s, workers: {max_workers})")
    
    # Cache recognizer instance to avoid re-initialization
    recognizer = None
    
    def get_cached_recognizer():
        """Get or create recognizer instance, reloading database periodically"""
        nonlocal recognizer
        # Always get the global recognizer to ensure we have the latest instance
        recognizer = get_recognizer(reload_db=True)
        return recognizer
    
    def process_camera_for_person(camera_id, camera_data, person_id, person_data, person_name, db, frame=None):
        """Process a single camera for a single person - designed for parallel execution"""
        try:
            # Use provided frame or capture new one
            if frame is None:
                stream_url = camera_data.get('stream_url')
                if not stream_url:
                    return None
                
                success, captured_frame, error_msg = capture_frame_from_stream(stream_url)
                
                if not success or captured_frame is None:
                    return None
                
                frame = captured_frame
            
            # Get recognizer (cached)
            rec = get_cached_recognizer()
            if rec is None or rec.face_analyzer is None:
                logger.debug(f"[Missing Person Scanner] Recognizer not available for camera {camera_id}")
                return None
            
            # Verify person is registered - if not, try to register from photo
            if not rec.verify_person_registered(person_id):
                logger.warning(f"[Missing Person Scanner] Person {person_id} ({person_name}) not registered in database!")
                logger.info(f"[Missing Person Scanner] Attempting to auto-register person {person_id} from photo URL...")
                
                # Try to auto-register from photo URL
                photo_url = person_data.get('photo_url')
                if photo_url:
                    try:
                        import requests  # type: ignore[import-untyped]
                        import io
                        response = requests.get(photo_url, timeout=10)
                        if response.status_code == 200:
                            from PIL import Image
                            image = Image.open(io.BytesIO(response.content))
                            image_array = np.array(image)
                            
                            if len(image_array.shape) == 3:
                                import cv2
                                image_bgr = cv2.cvtColor(image_array, cv2.COLOR_RGB2BGR)
                            else:
                                image_bgr = image_array
                            
                            success = rec.add_person_from_array(person_id, image_bgr)
                            if success:
                                rec.reload_database()
                                is_now_registered = rec.verify_person_registered(person_id)
                                if is_now_registered:
                                    logger.info(f"[Missing Person Scanner] Successfully auto-registered person {person_id}")
                                else:
                                    logger.error(f"[Missing Person Scanner] Auto-registration appeared successful but person still not found")
                                    return None
                            else:
                                logger.error(f"[Missing Person Scanner] Auto-registration failed for person {person_id}")
                                return None
                        else:
                            logger.error(f"[Missing Person Scanner] Failed to download photo for auto-registration. Status: {response.status_code}")
                            return None
                    except Exception as e:
                        logger.error(f"[Missing Person Scanner] Error during auto-registration: {e}")
                        return None
                else:
                    logger.error(f"[Missing Person Scanner] No photo_url available for auto-registration")
                    return None
            
            # Detect and recognize faces - force detection, no throttling
            # IMPORTANT: Only search for this specific person (target_person_id)
            logger.debug(f"[Missing Person Scanner] Scanning camera {camera_id} for {person_name} (ID: {person_id}) ONLY")
            logger.debug(f"[Missing Person Scanner] Frame shape: {frame.shape}, database has {len(rec.face_database)} people")
            target_embedding = person_data.get('face_embedding')
            results = rec.detect_and_recognize(
                frame,
                force_detection=True,
                target_person_id=person_id,
                target_embedding=target_embedding
            )
            logger.debug(f"[Missing Person Scanner] Detected {len(results)} faces on camera {camera_id}")
            
            # Log all detected faces
            for i, result in enumerate(results):
                detected_person_id = result.get('label')
                confidence = result.get('confidence', 0.0)
                logger.debug(f"[Missing Person Scanner] Face {i+1}: label={detected_person_id}, confidence={confidence:.4f}, matches_target={detected_person_id == person_id}")
            
            # Check if person_id is detected
            for result in results:
                detected_person_id = result.get('label')
                confidence = result.get('confidence', 0.0)
                
                # Check if this matches our searching person
                match_threshold = float(getattr(rec, "threshold", 0.5))
                if detected_person_id == person_id and confidence >= match_threshold:
                    logger.info(f"[Missing Person Scanner] MATCH FOUND: {person_name} detected on camera {camera_id} with confidence {confidence:.2f}")
                    
                    # Create/update ONE notification per person (no duplicates)
                    # We'll update the same document whenever we see a better/newer detection.
                    # Create detection notification payload
                    location = {
                        'name': camera_data.get('location_name', ''),
                        'city': camera_data.get('city', ''),
                        'latitude': camera_data.get('latitude', 0),
                        'longitude': camera_data.get('longitude', 0),
                        'address': f"{camera_data.get('location_name', '')}, {camera_data.get('city', '')}"
                    }
                    
                    person_details = {
                        'name': person_name,
                        'age': person_data.get('age'),
                        'gender': person_data.get('gender'),
                        'description': person_data.get('description', ''),
                        'photo_url': person_data.get('photo_url', ''),
                        'last_seen_location': person_data.get('last_seen_location', ''),
                        'last_seen_city': person_data.get('last_seen_city', '')
                    }
                    
                    detection_status = 'detected' if confidence > 0.7 else 'possible_match'

                    notifications_ref = db.collection('notifications')
                    notif_id = f"missing_person_detected_{person_id}"
                    notif_ref = notifications_ref.document(notif_id)
                    
                    now = utc_now()

                    try:
                        existing_doc = notif_ref.get()
                        existing_data = existing_doc.to_dict() if existing_doc.exists else {}

                        # If already confirmed, don't keep re-alerting
                        if existing_data.get('confirmed') is True:
                            logger.info(
                                f"[Missing Person Scanner] Detection for {person_id} already confirmed; skipping update"
                            )
                            return {'person_id': person_id, 'camera_id': camera_id, 'confidence': confidence}

                        # Upload CCTV capture
                        cctv_image_url = None
                        try:
                            from utils.images import upload_bgr_frame_to_cloudinary
                            bbox = result.get('bbox')
                            crop_bbox = None
                            if bbox and isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
                                crop_bbox = (bbox[0], bbox[1], bbox[2], bbox[3])
                            cctv_image_url = upload_bgr_frame_to_cloudinary(
                                frame,
                                folder="cctv_detections",
                                public_id=f"missing_{person_id}_{now.strftime('%Y%m%d_%H%M%S')}",
                                crop_bbox=crop_bbox,
                            )
                        except Exception as _img_e:
                            logger.debug(f"[Missing Person Scanner] CCTV image upload skipped: {_img_e}")

                        # Update missing person status
                        try:
                            db.collection('missing_persons').document(person_id).update({
                                'status': 'DETECTED',
                                'search_active': False,
                                'notification_sent': False,
                                'cctv_image': cctv_image_url,
                                'last_detection_at': now,
                                'last_updated': now,
                                'updated_at': now,
                            })
                        except Exception as _mp_e:
                            logger.debug(f"[Missing Person Scanner] Failed to update missing person state: {_mp_e}")

                        payload = {
                            'type': 'missing_person_detected',
                            'person_id': person_id,
                            'person_name': person_name,
                            'person_details': person_details,
                            'missing_person_image': person_data.get('image_url') or person_data.get('photo_url') or person_details.get('photo_url', ''),
                            'cctv_image': cctv_image_url,
                            'camera_id': camera_id,
                            'camera_name': camera_data.get('name', camera_id),
                            'location': location,
                            'detection_status': detection_status,
                            'confidence': float(confidence),
                            'confidence_percentage': float(confidence * 100),
                            'bbox': result.get('bbox'),
                            'detected_at': now,
                            'detection_time': now.isoformat().replace("+00:00", "Z"),
                            'updated_at': now,
                            'user_id': person_data.get('reported_by'),
                            'visible_to_citizen': existing_data.get('visible_to_citizen', False),
                            'read': False,
                            'confirmed': existing_data.get('confirmed', False),
                            'created_at': existing_data.get('created_at', now),
                        }
                        notif_ref.set(payload, merge=True)
                        logger.info(
                            f"[Missing Person Scanner] Upserted detection notification for {person_name} - Status: {detection_status}, Confidence: {confidence:.2%}"
                        )
                        return {'person_id': person_id, 'camera_id': camera_id, 'confidence': confidence}
                    except Exception as notif_err:
                        logger.error(f"[Missing Person Scanner] Failed to upsert notification: {notif_err}")
                        return None
            
            return None
            
        except Exception as e:
            logger.error(f"[Missing Person Scanner] Error scanning camera {camera_id} for {person_name}: {e}", exc_info=True)
            return None
    
    while True:
        try:
            start_time = time.time()
            
            db = get_firestore()
            assert db is not None, "Firestore client is not initialized"

            # Get all missing persons with active search lifecycle
            missing_persons_ref = db.collection('missing_persons')
            searching_persons = missing_persons_ref.where(filter=FieldFilter('search_active', '==', True)).stream()
            
            searching_list = list(searching_persons)
            
            if not searching_list:
                logger.debug("[Missing Person Scanner] No persons with status 'searching'")
                time.sleep(scanning_interval)
                continue
            
            # Get all active CCTV cameras (cache once per scan cycle)
            cameras_ref = db.collection('cctv_cameras')
            cameras = cameras_ref.where(filter=FieldFilter('status', '==', 'active')).stream()
            
            cameras_list = list(cameras)
            
            if not cameras_list:
                logger.debug("[Missing Person Scanner] No active cameras found")
                time.sleep(scanning_interval)
                continue
            
            logger.info(f"[Missing Person Scanner] Scanning {len(cameras_list)} camera(s) for {len(searching_list)} missing person(s)")
            
            # Cache frames per camera to avoid re-capturing for each person
            camera_frames = {}  # camera_id -> (frame, timestamp)
            frame_cache_timeout = 5  # Cache frames for 5 seconds
            
            # Process all person-camera combinations in parallel
            matches_found = []
            
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = []
                
                for person_doc in searching_list:
                    person_data = person_doc.to_dict()
                    person_id = person_doc.id
                    person_name = person_data.get('name', 'Unknown')
                    last_seen_city = person_data.get('last_seen_city', '')
                    
                    # Filter cameras by city if available
                    relevant_cameras = []
                    for camera_doc in cameras_list:
                        camera_data = camera_doc.to_dict()
                        camera_city = camera_data.get('city', '')
                        
                        if not last_seen_city or camera_city.lower() == last_seen_city.lower():
                            relevant_cameras.append((camera_doc.id, camera_data))
                    
                    if not relevant_cameras:
                        logger.debug(f"[Missing Person Scanner] No relevant cameras for {person_name} in {last_seen_city}")
                        continue
                    
                    # First, capture frames for all relevant cameras (parallel)
                    current_time = time.time()
                    camera_frames_to_process = {}
                    
                    for camera_id, camera_data in relevant_cameras:
                        # Check cache first
                        if camera_id in camera_frames:
                            cached_frame, cache_time = camera_frames[camera_id]
                            if current_time - cache_time < frame_cache_timeout:
                                camera_frames_to_process[camera_id] = cached_frame.copy()
                                continue
                        
                        # Need to capture new frame
                        stream_url = camera_data.get('stream_url')
                        if stream_url:
                            success, frame, error_msg = capture_frame_from_stream(stream_url)
                            if success and frame is not None:
                                camera_frames[camera_id] = (frame.copy(), current_time)
                                camera_frames_to_process[camera_id] = frame.copy()
                    
                    # Now process all cameras for this person in parallel
                    for camera_id, camera_data in relevant_cameras:
                        if camera_id not in camera_frames_to_process:
                            continue
                        
                        frame = camera_frames_to_process[camera_id]
                        future = executor.submit(
                            process_camera_for_person,
                            camera_id, camera_data, person_id, person_data, person_name, db, frame
                        )
                        futures.append((future, person_name, camera_id))
                
                # Collect results as they complete
                for future, person_name, camera_id in futures:
                    try:
                        result = future.result(timeout=30)  # 30 second timeout per camera
                        if result:
                            matches_found.append(result)
                    except Exception as e:
                        logger.error(f"[Missing Person Scanner] Error processing camera {camera_id} for {person_name}: {e}")
            
            elapsed_time = time.time() - start_time
            if matches_found:
                logger.info(f"[Missing Person Scanner] Completed scan in {elapsed_time:.2f}s - Found {len(matches_found)} match(es)")
            else:
                logger.debug(f"[Missing Person Scanner] Completed scan in {elapsed_time:.2f}s - No matches")
            quota_error_count = 0
            
            # Calculate sleep time to maintain consistent interval
            sleep_time = max(0, scanning_interval - elapsed_time)
            if sleep_time > 0:
                time.sleep(sleep_time)
        
        except Exception as e:
            if _is_quota_error(e):
                quota_error_count += 1
                sleep_for = _quota_backoff_seconds(scanning_interval, quota_error_count)
                logger.warning(
                    f"[Missing Person Scanner] Firestore quota exceeded. Backing off for {sleep_for:.1f}s "
                    f"(consecutive errors: {quota_error_count})"
                )
                time.sleep(sleep_for)
            else:
                quota_error_count = 0
                logger.error(f"[Missing Person Scanner] Error in scanning loop: {e}", exc_info=True)
                time.sleep(scanning_interval)

# Start missing person scanning thread
_missing_person_thread = None

def start_missing_person_scanning():
    """Start the background missing person scanning thread"""
    global _missing_person_thread
    if _missing_person_thread is None or not _missing_person_thread.is_alive():
        _missing_person_thread = threading.Thread(target=scan_missing_persons_continuously, daemon=True)
        _missing_person_thread.start()
        print("[OK] Background missing person face recognition scanning started")

# Start missing person scanning when app initializes
if _should_start_background_threads():
    start_missing_person_scanning()

# Health check endpoint
@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return {'status': 'healthy', 'service': 'CrowdSafe API'}, 200

# Error handlers
@app.errorhandler(404)
def not_found(error):
    return {'error': 'Not found'}, 404

@app.errorhandler(500)
def internal_error(error):
    return {'error': 'Internal server error'}, 500

if __name__ == '__main__':
    port = int(os.getenv('FLASK_PORT', 5000))
    debug = os.getenv('FLASK_ENV') == 'development'
    app.run(host='0.0.0.0', port=port, debug=debug)
