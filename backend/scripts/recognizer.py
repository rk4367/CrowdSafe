#!/usr/bin/env python3
"""
CCTV Face Recognition System
Standalone CLI tool for recognizing faces from reference images in live CCTV camera streams
"""

import cv2
import os
import sys
import logging
import time
import argparse
import json
import threading
from typing import Optional, List, Dict
from datetime import datetime
from utils.time import utc_now
import numpy as np

# Add backend to path for imports
_backend_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend_root not in sys.path:
    sys.path.insert(0, _backend_root)

# Import from backend models
from models.face_recognition import FaceRecognizer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s"
)
logger = logging.getLogger(__name__)

# Optional MJPEG stream handler (if available)
try:
    from models.ip_camera import MJPEGStream
    MJPEG_AVAILABLE = True
except ImportError:
    MJPEG_AVAILABLE = False
    logger.warning("MJPEGStream not available. Standard OpenCV streams will be used.")


class CCTVCamera:
    """Wrapper for CCTV camera stream"""
    
    def __init__(self, camera_id: str, stream_url: str, name: Optional[str] = None):
        self.camera_id = camera_id
        self.stream_url = stream_url
        self.name = name or camera_id
        self.cap = None
        self.last_error = None
        
    def connect(self) -> bool:
        """Connect to CCTV camera stream with low-latency settings"""
        try:
            self.cap = cv2.VideoCapture(self.stream_url)
            
            # Optimize for low latency
            self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # Minimal buffer - always get latest frame
            self.cap.set(cv2.CAP_PROP_FPS, 30)  # Set FPS hint
            
            if not self.cap.isOpened():
                # Try MJPEG stream handler if available
                if MJPEG_AVAILABLE and ("mjpeg" in self.stream_url.lower() or "http" in self.stream_url.lower()):
                    try:
                        self.mjpeg_stream = MJPEGStream(self.stream_url)
                        logger.info(f"MJPEG stream handler created for {self.name}")
                        return True
                    except Exception as e:
                        logger.warning(f"Failed to create MJPEG stream: {e}")
                        pass
                
                self.last_error = f"Could not open stream: {self.stream_url}"
                logger.error(self.last_error)
                return False
            
            # Test if we can read a frame
            ret, frame = self.cap.read()
            if not ret:
                self.last_error = "Stream opened but cannot read frames"
                logger.error(self.last_error)
                return False
            
            logger.info(f"Successfully connected to camera: {self.name} (low-latency mode)")
            return True
            
        except Exception as e:
            self.last_error = str(e)
            logger.error(f"Error connecting to {self.name}: {e}")
            return False
    
    def read_frame(self):
        """Read a frame from the camera"""
        try:
            if hasattr(self, 'mjpeg_stream'):
                frame = self.mjpeg_stream.read_frame()
                if frame is not None:
                    return True, frame
                return False, None
            
            if self.cap and self.cap.isOpened():
                ret, frame = self.cap.read()
                return ret, frame
            
            return False, None
            
        except Exception as e:
            logger.error(f"Error reading frame from {self.name}: {e}")
            return False, None
    
    def release(self):
        """Release camera resources"""
        if self.cap:
            self.cap.release()
        if hasattr(self, 'mjpeg_stream'):
            self.mjpeg_stream.close()


class CCTVFaceRecognizer:
    """Main class for recognizing faces in CCTV feeds"""
    
    def __init__(
        self,
        recognition_threshold: float = 0.6,
        display_output: bool = True,
        database_path: Optional[str] = None,
        reference_image: Optional[str] = None,
        person_name: Optional[str] = None
    ):
        self.recognition_threshold = recognition_threshold
        self.display_output = display_output
        self.database_path = database_path
        self.reference_image = reference_image
        self.person_name = person_name
        
        # Initialize face recognizer with database path
        logger.info("Initializing face recognizer...")
        # Use backend data directory for face_database.pkl
        if database_path is None:
            backend_data_dir = os.path.join(_backend_root, "data")
            os.makedirs(backend_data_dir, exist_ok=True)
            database_path = os.path.join(backend_data_dir, "face_database.pkl")
        
        final_database_path = database_path or os.path.join(_backend_root, "data", "face_database.pkl")
        self.face_recognizer = FaceRecognizer(
            threshold=recognition_threshold,
            recognition_model='buffalo_l',
            database_path=final_database_path,
            enable_tracking=True
        )
        
        # Clear any pre-existing faces to ensure only the provided image is used
        self.face_recognizer.clear_database()
        logger.info("Cleared any pre-existing face database. Using only the provided reference image.")
        
        # Load face from reference image
        if reference_image and person_name:
            self._load_reference_image()
        
        # Active cameras with metadata
        self.cameras: Dict[str, CCTVCamera] = {}
        self.camera_metadata: Dict[str, Dict] = {}  # Store camera location and details
        
        # Detection results storage
        self.detection_results: List[Dict] = []
        
        # Recognition statistics
        self.stats = {
            'total_detections': 0,
            'matched_faces': 0,
            'unknown_faces': 0,
            'last_match_time': None,
            'matches_by_person': {}
        }
        
        # Store the expected person name for display
        self.expected_person_name = person_name
    
    def _load_reference_image(self):
        """Load a single reference image with person name"""
        if not self.reference_image or not os.path.exists(self.reference_image):
            logger.error(f"Reference image not found: {self.reference_image}")
            return False
        
        if not self.person_name:
            logger.error("Person name is required")
            return False
        
        try:
            img = cv2.imread(self.reference_image)
            if img is None:
                logger.error(f"Could not read image: {self.reference_image}")
                return False
            
            # Use backend's face recognizer method
            success = self.face_recognizer.add_person_from_array(self.person_name, img)
            
            if success:
                logger.info(f"Loaded reference image for {self.person_name} from {self.reference_image}")
                stats = self.face_recognizer.get_face_stats()
                logger.info(f"Total registered people: {stats['total_people']}")
                return True
            else:
                logger.error(f"Failed to register face for {self.person_name}")
                return False
                
        except Exception as e:
            logger.error(f"Error loading reference image: {e}")
            return False
    
    def add_camera(self, camera_id: str, stream_url: str,
                   location: Optional[Dict] = None, metadata: Optional[Dict] = None):
        """Add a CCTV camera to monitor with optional location and metadata"""
        camera = CCTVCamera(camera_id, stream_url, camera_id)
        if camera.connect():
            self.cameras[camera_id] = camera
            self.camera_metadata[camera_id] = {
                'name': camera_id,
                'location': location or {},
                'metadata': metadata or {},
                'camera_id': camera_id,
                'stream_url': stream_url
            }
            logger.info(f"Camera added: {camera_id}")
            return True
        else:
            logger.error(f"Failed to add camera {camera_id}: {camera.last_error}")
            return False
    
    def process_frame(self, frame, camera_id: str = None, camera_name: str = "Camera"):
        """
        Process a single frame and recognize faces
        
        Returns:
            tuple: (recognition_results, matched_results)
                - recognition_results: All detection/recognition results
                - matched_results: Only matched faces with full metadata
        """
        if frame is None:
            return [], []
        
        # Get camera metadata
        camera_info = self.camera_metadata.get(camera_id, {}) if camera_id else {}
        camera_name = camera_info.get('name', camera_name)
        location = camera_info.get('location', {})
        camera_metadata = camera_info.get('metadata', {})
        
        # Detect and recognize faces
        results = self.face_recognizer.detect_and_recognize(frame)
        
        # Update statistics
        self.stats['total_detections'] += len(results)
        
        matched_results = []
        detection_time = utc_now()
        
        # Filter results to only match the expected person name
        expected_name = self.expected_person_name

        
        for result in results:
            # Only process matches for the expected person name
            if result['label'] != 'Unknown' and expected_name:
                # Check if the matched label corresponds to our expected person
                # Since we cleared the database and only registered one person,
                # any match should be our person, but we verify anyway
                matched_person_name = result['label']
                
                # Only count as match if it matches our expected person name
                if matched_person_name == expected_name:
                    self.stats['matched_faces'] += 1
                    self.stats['last_match_time'] = detection_time.isoformat()
                    
                    self.stats['matches_by_person'].setdefault(matched_person_name, 0)
                    self.stats['matches_by_person'][matched_person_name] += 1
                    
                    # Create comprehensive detection result
                    detection_data = {
                        'person_name': matched_person_name,
                        'confidence': float(result['confidence']),
                        'bbox': result['bbox'],
                        'camera_id': camera_id or 'unknown',
                        'camera_name': camera_name,
                        'detection_date': detection_time.strftime('%Y-%m-%d'),
                        'detection_time': detection_time.strftime('%H:%M:%S'),
                        'detection_timestamp': detection_time.isoformat(),
                        'location': location,
                        'camera_metadata': camera_metadata,
                        'stream_url': camera_info.get('stream_url', ''),
                        'bbox_coordinates': {
                            'x1': int(result['bbox'][0]),
                            'y1': int(result['bbox'][1]),
                            'x2': int(result['bbox'][2]),
                            'y2': int(result['bbox'][3])
                        }
                    }
                    
                    matched_results.append(detection_data)
                    
                    # Store detection result
                    self.detection_results.append(detection_data)
                    # Keep only last 1000 detections
                    if len(self.detection_results) > 1000:
                        self.detection_results = self.detection_results[-1000:]
                    
                    logger.info(
                        f"MATCH FOUND: {matched_person_name} on {camera_name} "
                        f"at {detection_time.isoformat().replace('+00:00', 'Z')} "
                        f"(confidence: {result['confidence']:.2f})"
                    )
                else:
                    # This shouldn't happen if database is cleared, but log it if it does
                    logger.warning(f"Unexpected match: {matched_person_name} (expected: {expected_name}). Ignoring.")
                    # Mark as unknown to avoid false positives
                    result['label'] = 'Unknown'
                    result['confidence'] = 0.0
                    self.stats['unknown_faces'] += 1
            elif result['label'] != 'Unknown' and not expected_name:
                # If no expected name set, log warning and mark as unknown
                logger.warning(f"Match found but no expected person name set: {result['label']}. Ignoring.")
                result['label'] = 'Unknown'
                self.stats['unknown_faces'] += 1
            else:
                # Unknown face
                self.stats['unknown_faces'] += 1

        for result in results:
            track_id = result.get('track_id')
            if track_id is not None:
                logger.debug(f"Track {track_id}: {result.get('label')} (age: {result.get('track_age', 0)})")
        
        return results, matched_results
    
    def draw_results(self, frame, recognition_results: List[Dict], camera_name: str, matched_count: int):
        """
        Draw recognition results on frame
        
        Args:
            frame: Input frame
            recognition_results: Results from detect_and_recognize
            camera_name: Camera identifier
            matched_count: Number of matched faces
        """
        display_frame = frame.copy()
        expected_name = self.expected_person_name
        
        for result in recognition_results:
            x1, y1, x2, y2 = result['bbox']
            label = result['label']
            conf = result['confidence']
            
            # Only show matches for the expected person name
            # Filter out any unexpected matches (shouldn't happen, but safety check)
            if label != "Unknown" and expected_name:
                if label == expected_name:
                    color = (0, 255, 0)  # Green
                    # Show the expected person name
                    display_name = expected_name
                    text = f"{display_name} ({conf:.2f})"
                    thickness = 3
                else:
                    # Unexpected match - don't display it
                    continue
            else:
                color = (0, 0, 255)  # Red
                text = f"Unknown ({conf:.2f})"
                thickness = 2
            
            cv2.rectangle(display_frame, (x1, y1), (x2, y2), color, thickness)
            cv2.putText(
                display_frame,
                text,
                (x1, y1 - 10),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                color,
                2
            )
        
        # Draw camera name and stats with person name
        person_display = self.expected_person_name if self.expected_person_name else "Unknown"
        info_text = f"Camera: {camera_name} | Looking for: {person_display} | Matches: {matched_count}"
        cv2.putText(
            display_frame,
            info_text,
            (10, 30),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (255, 255, 255),
            2
        )
        
        return display_frame

    def run_single_camera(self, camera_id: str, target_fps: int = 10):
        """Run with separated video display and face recognition for low latency"""
        if camera_id not in self.cameras:
            return
        
        camera = self.cameras[camera_id]
        logger.info(f"Starting face recognition on {camera.name} (Target: {target_fps} FPS, low-latency mode)...")
        
        # Thread-safe frame buffer - always shows latest frame
        latest_frame = None
        latest_results = []
        latest_matched_count = 0
        frame_lock = threading.Lock()
        running = threading.Event()
        running.set()
        
        # Performance tracking
        frame_count = 0
        recognition_times = []
        display_fps_times = []
        
        def frame_reader_thread():
            """Separate thread for reading frames - always gets latest"""
            nonlocal latest_frame, frame_count
            frame_reader_count = 0
            while running.is_set():
                ret, frame = camera.read_frame()
                if ret and frame is not None:
                    with frame_lock:
                        latest_frame = frame.copy()
                        frame_reader_count += 1
                    # Skip frames in buffer to always get latest (non-blocking)
                    try:
                        # Try to skip buffered frames to get latest
                        for _ in range(1):  # Read and discard 1 frame to reduce latency
                            camera.read_frame()
                    except:
                        pass  # Ignore errors when skipping
                else:
                    time.sleep(0.01)
        
        def face_recognition_thread():
            """Separate thread for face recognition - doesn't block display"""
            nonlocal latest_results, latest_matched_count, recognition_times
            last_process_time = 0
            process_interval = 1.0 / max(target_fps, 5)  # Process at most target_fps
            
            while running.is_set():
                current_time = time.time()
                # Throttle recognition to avoid overwhelming CPU
                if current_time - last_process_time < process_interval:
                    time.sleep(0.01)
                    continue
                
                with frame_lock:
                    frame_to_process = latest_frame.copy() if latest_frame is not None else None
                
                if frame_to_process is not None:
                    start_time = time.time()
                    results, matched = self.process_frame(
                        frame_to_process, 
                        camera_id=camera_id, 
                        camera_name=camera.name
                    )
                    processing_time = (time.time() - start_time) * 1000
                    
                    # Update results
                    with frame_lock:
                        latest_results = results
                        latest_matched_count = len(matched)
                    
                    # Track performance
                    recognition_times.append(processing_time)
                    if len(recognition_times) > 30:
                        recognition_times.pop(0)
                
                last_process_time = current_time
                time.sleep(0.01)  # Small sleep to avoid tight loop
        
        # Start background threads
        reader_thread = threading.Thread(target=frame_reader_thread, daemon=True)
        recognition_thread = threading.Thread(target=face_recognition_thread, daemon=True)
        reader_thread.start()
        recognition_thread.start()
        
        # Main display loop - runs as fast as possible, never blocks
        try:
            last_display_time = time.time()
            while running.is_set():
                current_time = time.time()
                
                # Get latest frame and results (quick lock)
                with frame_lock:
                    display_frame = latest_frame.copy() if latest_frame is not None else None
                    results = latest_results.copy()
                    matched_count = latest_matched_count
                
                if display_frame is None:
                    time.sleep(0.01)
                    continue
                
                # Draw results on frame
                if self.display_output:
                    display_frame = self.draw_results(display_frame, results, camera.name, matched_count)
                    
                    # Calculate and display FPS
                    elapsed_display = current_time - last_display_time
                    if elapsed_display > 0:
                        display_fps = 1.0 / elapsed_display
                        display_fps_times.append(display_fps)
                        if len(display_fps_times) > 30:
                            display_fps_times.pop(0)
                        avg_fps = np.mean(display_fps_times) if display_fps_times else 0
                    else:
                        avg_fps = 0
                    
                    avg_recognition_time = np.mean(recognition_times) if recognition_times else 0
                    fps_text = f"Display FPS: {avg_fps:.1f} | Recognition: {avg_recognition_time:.1f}ms"
                    cv2.putText(
                        display_frame,
                        fps_text,
                        (10, display_frame.shape[0] - 10),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.5,
                        (0, 255, 0),
                        1
                    )
                    
                    cv2.imshow(f"Face Recognition - {camera.name}", display_frame)
                    last_display_time = current_time
                    
                    # Minimal wait - just enough to handle events
                    key = cv2.waitKey(1) & 0xFF
                    if key == ord('q'):
                        break
                else:
                    time.sleep(0.01)
        
        except KeyboardInterrupt:
            logger.info("Interrupted")
        finally:
            running.clear()
            time.sleep(0.1)  # Give threads time to stop
            camera.release()
            cv2.destroyAllWindows()
    
    def run_all_cameras(self, skip_frames: int = 2):
        """Run face recognition on all cameras (parallel processing)"""
        if not self.cameras:
            logger.error("No cameras configured")
            return
        
        logger.info(f"Starting face recognition on {len(self.cameras)} cameras...")
        
        threads = []
        try:
            for camera_id in self.cameras.keys():
                thread = threading.Thread(
                    target=self.run_single_camera,
                    args=(camera_id, skip_frames),
                    daemon=True
                )
                thread.start()
                threads.append(thread)
                logger.info(f"Started monitoring thread for camera: {camera_id}")
            
            # Wait for all threads
            for thread in threads:
                thread.join()
                
        except KeyboardInterrupt:
            logger.info("Stopping all cameras...")
        finally:
            self.cleanup()
    
    def cleanup(self):
        """Cleanup resources"""
        for camera in self.cameras.values():
            camera.release()
        
        if self.display_output:
            cv2.destroyAllWindows()
        
        logger.info("Cleanup complete")
    
    def get_statistics(self):
        """Get recognition statistics"""
        return self.stats.copy()
    
    def get_detection_results(self, limit: int = 100, person_name: Optional[str] = None,
                             camera_id: Optional[str] = None) -> List[Dict]:
        """
        Get detection results with optional filtering
        
        Args:
            limit: Maximum number of results to return
            person_name: Filter by person name
            camera_id: Filter by camera ID
            
        Returns:
            List of detection dictionaries
        """
        results = self.detection_results.copy()
        
        if person_name:
            results = [r for r in results if r.get('person_name') == person_name]
        
        if camera_id:
            results = [r for r in results if r.get('camera_id') == camera_id]
        
        return results[-limit:] if limit else results


def show_statistics(stats):
    """Display recognition statistics"""
    print("\n" + "="*50)
    print("📊 RECOGNITION STATISTICS")
    print("="*50)
    print(f"Total detections: {stats['total_detections']}")
    print(f"Matched faces: {stats['matched_faces']}")
    print(f"Unknown faces: {stats['unknown_faces']}")
    
    if stats['last_match_time']:
        print(f"Last match: {stats['last_match_time']}")
    
    if stats['matches_by_person']:
        print("\nMatches by person:")
        for person, count in stats['matches_by_person'].items():
            print(f"  • {person}: {count} match(es)")


def get_user_input(prompt: str, default: str = None) -> str:
    """Get user input with optional default value"""
    if default:
        full_prompt = f"{prompt} (default: {default}): "
    else:
        full_prompt = f"{prompt}: "
    
    try:
        user_input = input(full_prompt).strip()
        return user_input if user_input else (default or "")
    except (KeyboardInterrupt, EOFError):
        logger.info("\nExiting...")
        sys.exit(0)


def main():
    """
    Main entry point for CCTV Face Recognition System
    
    Usage:
        python scripts/main.py --reference-image ./person.jpg --person-name "John Doe" --camera-url rtsp://... --camera-id camera_1
        Or run without arguments for interactive mode
    """
    parser = argparse.ArgumentParser(
        description='CCTV Face Recognition System - Identify missing persons in live CCTV streams',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Example:
  python scripts/main.py --reference-image ./person.jpg --person-name "John Doe" --camera-url rtsp://192.168.1.100:554/stream --camera-id camera_1
  
  Or run without arguments for interactive prompts
        """
    )
    parser.add_argument(
        '--reference-image',
        type=str,
        help='Path to reference image of the missing person'
    )
    parser.add_argument(
        '--person-name',
        type=str,
        help='Name of the person in the reference image'
    )
    parser.add_argument(
        '--camera-url',
        type=str,
        help='CCTV camera stream URL (RTSP, HTTP, or MJPEG)'
    )
    parser.add_argument(
        '--camera-id',
        type=str,
        help='Camera ID (unique identifier)'
    )
    parser.add_argument(
        '--location',
        type=str,
        help='Camera location (JSON string or file path)',
        default=None
    )
    parser.add_argument(
        '--threshold',
        type=float,
        help='Face recognition confidence threshold (0.0-1.0, default: 0.6)',
        default=0.6
    )
    parser.add_argument(
        '--skip-frames',
        type=int,
        help='Skip N frames between processing (higher = faster display, default: 5)',
        default=5
    )
    parser.add_argument(
        '--database',
        type=str,
        help='Path to face database pickle file (optional)',
        default=None
    )
    
    args = parser.parse_args()
    
    # Interactive mode if required arguments are missing
    if not args.reference_image or not args.person_name or not args.camera_url or not args.camera_id:
        print("\n" + "="*60)
        print("🎥 CCTV FACE RECOGNITION SYSTEM")
        print("="*60)
        print("Please provide the following information:\n")
        
        if not args.reference_image:
            args.reference_image = get_user_input("Reference image path")
            if not args.reference_image:
                logger.error("Reference image is required")
                return
        
        if not args.person_name:
            args.person_name = get_user_input("Person name")
            if not args.person_name:
                logger.error("Person name is required")
                return
        
        if not args.camera_url:
            print("\nCCTV Stream URL Examples:")
            print("  RTSP: rtsp://username:password@192.168.1.100:554/stream")
            print("  HTTP: http://192.168.1.100:8080/video")
            print("  MJPEG: http://192.168.1.100:8080/mjpg/video.mjpg")
            args.camera_url = get_user_input("\nCCTV camera stream URL")
            if not args.camera_url:
                logger.error("Camera URL is required")
                return
        
        if not args.camera_id:
            args.camera_id = get_user_input("Camera ID (unique identifier)")
            if not args.camera_id:
                logger.error("Camera ID is required")
                return
        
        print("\n" + "="*60)
    
    # Validate reference image exists
    if not os.path.exists(args.reference_image):
        logger.error(f"Reference image not found: {args.reference_image}")
        return
    
    # Parse location if provided
    location = {}
    if args.location:
        try:
            if os.path.exists(args.location):
                with open(args.location, 'r') as f:
                    location = json.load(f)
            else:
                location = json.loads(args.location)
        except Exception as e:
            logger.warning(f"Could not parse location: {e}")
    
    # Initialize recognizer with display enabled for live streaming
    logger.info("Initializing CCTV Face Recognition System...")
    recognizer = CCTVFaceRecognizer(
        recognition_threshold=0.45,
        display_output=True,  # Enable display to stream live footage
        database_path=args.database,
        reference_image=args.reference_image,
        person_name=args.person_name
    )
    
    # Add camera with metadata (using camera_id as name)
    success = recognizer.add_camera(
        args.camera_id,
        args.camera_url,
        location=location,
        metadata={}
    )
    
    if not success:
        logger.error(f"Failed to connect to camera: {args.camera_id}")
        return
    
    logger.info(f"Starting face recognition on {args.camera_id}...")
    logger.info("Press 'q' in video window or Ctrl+C to stop")
    
    try:
        recognizer.run_single_camera(args.camera_id, target_fps=16)
    except KeyboardInterrupt:
        logger.info("Stopping face recognition...")
    finally:
        recognizer.cleanup()
    
    # Print final statistics and detections
    stats = recognizer.get_statistics()
    detections = recognizer.get_detection_results(limit=100)
    
    logger.info("\n" + "="*50)
    logger.info("RECOGNITION STATISTICS")
    logger.info("="*50)
    logger.info(f"Total detections: {stats['total_detections']}")
    logger.info(f"Matched faces: {stats['matched_faces']}")
    logger.info(f"Unknown faces: {stats['unknown_faces']}")
    
    if detections:
        logger.info("\n" + "="*50)
        logger.info("DETECTION RESULTS")
        logger.info("="*50)
        for detection in detections:
            logger.info(f"\nPerson: {detection['person_name']}")
            logger.info(f"Camera: {detection['camera_name']}")
            logger.info(f"Date: {detection['detection_date']}")
            logger.info(f"Time: {detection['detection_time']}")
            logger.info(f"Location: {detection.get('location', {})}")
            logger.info(f"Confidence: {detection['confidence']:.2f}")
    else:
        logger.info("\nNo detections found.")


if __name__ == "__main__":
    main()

