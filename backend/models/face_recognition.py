"""
Face Recognition Model
Uses InsightFace for face recognition and matching
Based on FR folder implementation - EXACT MATCH
"""

import cv2
import numpy as np
import pickle
import os
import logging
import time
import threading
import warnings
from datetime import datetime
from utils.time import utc_now
from typing import List, Dict, Optional, Tuple
from collections import deque

# Suppress FutureWarnings from InsightFace library (deprecated APIs in third-party code)
warnings.filterwarnings('ignore', category=FutureWarning, module='insightface')

try:
    from insightface.app import FaceAnalysis
    INSIGHTFACE_AVAILABLE = True
except ImportError:
    INSIGHTFACE_AVAILABLE = False
    print("[WARNING] InsightFace not installed. Face recognition will not work.")
    print("  Install with: pip install insightface onnxruntime")

logger = logging.getLogger(__name__)


class SimpleFaceTracker:
    """Ultra-lightweight tracker for face tracking - EXACT COPY FROM FR"""
    
    def __init__(self, max_disappeared=10, iou_threshold=0.1):
        self.tracks = {}
        self.next_id = 0
        self.max_disappeared = max_disappeared
        self.iou_threshold = iou_threshold
        
    def _iou(self, box1, box2):
        """Fast IoU calculation"""
        x1 = max(box1[0], box2[0])
        y1 = max(box1[1], box2[1])
        x2 = min(box1[2], box2[2])
        y2 = min(box1[3], box2[3])
        
        if x2 < x1 or y2 < y1:
            return 0.0
        
        intersection = (x2 - x1) * (y2 - y1)
        area1 = (box1[2] - box1[0]) * (box1[3] - box1[1])
        area2 = (box2[2] - box2[0]) * (box2[3] - box2[1])
        union = area1 + area2 - intersection
        
        return intersection / union if union > 0 else 0.0
    
    def update(self, detections):
        """Simple overlap-based tracking"""
        updated_tracks = {}
        
        if len(detections) == 0:
            for track_id, track in self.tracks.items():
                track['disappeared'] += 1
                if track['disappeared'] <= self.max_disappeared:
                    updated_tracks[track_id] = track
            self.tracks = updated_tracks
            return detections
        
        matched_tracks = set()
        matched_detections = set()
        
        for track_id, track in self.tracks.items():
            best_iou = 0
            best_det_idx = -1
            
            for i, det in enumerate(detections):
                if i in matched_detections:
                    continue
                
                iou = self._iou(track['bbox'], det['bbox'])
                if iou > best_iou and iou > self.iou_threshold:
                    best_iou = iou
                    best_det_idx = i
            
            if best_det_idx != -1:
                det = detections[best_det_idx]
                track['bbox'] = det['bbox']
                track['label'] = det['label']
                track['confidence'] = det['confidence']
                track['disappeared'] = 0
                track['age'] += 1
                
                if 'embeddings' not in track:
                    track['embeddings'] = deque(maxlen=3)
                track['embeddings'].append(det['embedding'])
                
                det['track_id'] = track_id
                det['track_age'] = track['age']
                
                updated_tracks[track_id] = track
                matched_tracks.add(track_id)
                matched_detections.add(best_det_idx)
            else:
                track['disappeared'] += 1
                if track['disappeared'] <= self.max_disappeared:
                    updated_tracks[track_id] = track
        
        for i, det in enumerate(detections):
            if i in matched_detections:
                continue
            
            track_id = self.next_id
            self.next_id += 1
            
            new_track = {
                'bbox': det['bbox'],
                'label': det['label'],
                'confidence': det['confidence'],
                'disappeared': 0,
                'age': 0,
                'embeddings': deque([det['embedding']], maxlen=3)
            }
            
            updated_tracks[track_id] = new_track
            det['track_id'] = track_id
            det['track_age'] = 0
        
        self.tracks = updated_tracks
        return detections
    
    def get_track_embedding(self, track_id):
        """Get average embedding for a track"""
        track = self.tracks.get(track_id)
        if track and 'embeddings' in track and track['embeddings']:
            embeddings = list(track['embeddings'])
            return np.mean(embeddings, axis=0)
        return None


class FaceRecognizer:
    """
    Face recognition for missing persons
    EXACT IMPLEMENTATION FROM FR FOLDER
    """
    
    def __init__(self, recognition_model='buffalo_l', threshold=0.3,
                 database_path=None, enable_tracking=True):
        """
        Initialize face recognizer with InsightFace
        
        Args:
            model_name: InsightFace model name (default: 'buffalo_l')
            threshold: Matching threshold (lower = stricter)
            database_path: Path to face database pickle file
            enable_tracking: Enable face tracking for better performance
        """
        self.threshold = threshold
        self.logger = logging.getLogger(self.__class__.__name__)
        
        # Face database - Use backend data directory
        if database_path is None:
            # Default to backend data directory
            data_dir = os.path.join(os.path.dirname(__file__), '..', 'data')
            os.makedirs(data_dir, exist_ok=True)
            database_path = os.path.join(data_dir, 'face_database.pkl')
        
        self.database_path = database_path
        self.face_database = {}
        self.embeddings = np.array([])
        self.labels = []
        self.embedding_norms = np.array([])
        
        # Tracking
        self.enable_tracking = enable_tracking
        if enable_tracking:
            self.tracker = SimpleFaceTracker(max_disappeared=5, iou_threshold=0.3)
            self.recognition_cache = {}
            self.cache_duration = 60
        
        # Thread safety lock for database operations
        self._db_lock = threading.Lock()
        
        # Performance optimization
        self.last_detection_time = 0
        self.min_detection_interval = 0.1  # Reduced from 0.5s to 0.1s for faster detection
        
        if INSIGHTFACE_AVAILABLE:
            try:
                providers = ['CPUExecutionProvider']
                try:
                    import onnxruntime
                    if 'CUDAExecutionProvider' in onnxruntime.get_available_providers():
                        providers = ['CUDAExecutionProvider', 'CPUExecutionProvider']
                except:
                    pass
                
                self.face_analyzer = FaceAnalysis(name=recognition_model, providers=providers)
                self.face_analyzer.prepare(ctx_id=-1)
                self.logger.info(f"InsightFace initialized with model: {recognition_model}")
                self._load_database()
            except Exception as e:
                self.logger.error(f"Error initializing InsightFace: {e}")
                self.face_analyzer = None
        else:
            self.logger.warning("InsightFace not installed")
            self.face_analyzer = None
    
    @staticmethod
    def _ensure_bgr(image: np.ndarray) -> np.ndarray:
        """
        Ensure image is uint8 BGR (H, W, 3) for InsightFace.
        InsightFace FaceAnalysis.get expects BGR, not RGB.
        """
        if image is None:
            return image
        if not isinstance(image, np.ndarray):
            image = np.array(image)
        if image.size == 0:
            return image

        # Convert dtype
        if image.dtype != np.uint8:
            image = np.clip(image, 0, 255).astype(np.uint8)

        # Grayscale -> BGR
        if len(image.shape) == 2:
            return cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)

        if len(image.shape) != 3:
            return image

        # RGBA -> BGR
        if image.shape[2] == 4:
            return cv2.cvtColor(image, cv2.COLOR_RGBA2BGR)

        # RGB is common from PIL; but OpenCV reads BGR already.
        # We can't reliably auto-detect RGB vs BGR without metadata, so we keep as-is.
        return image

    @staticmethod
    def _pick_best_face(faces) -> Optional[object]:
        """Pick best face from InsightFace detections (highest score, then largest area)."""
        if not faces:
            return None
        best = None
        best_key = None
        for f in faces:
            try:
                x1, y1, x2, y2 = f.bbox
                area = max(0.0, (x2 - x1)) * max(0.0, (y2 - y1))
                score = float(getattr(f, "det_score", 0.0))
                key = (score, area)
            except Exception:
                key = (0.0, 0.0)
            if best is None or key > best_key:
                best = f
                best_key = key
        return best

    def extract_embedding(self, image_bgr: np.ndarray) -> Tuple[Optional[np.ndarray], Optional[Tuple[int, int, int, int]]]:
        """
        Extract a single best face embedding from an image (BGR).
        Returns (embedding, bbox) where bbox is (x1,y1,x2,y2) in image coords.
        """
        if self.face_analyzer is None:
            self.logger.error("Cannot extract embedding: face_analyzer is None")
            return None, None

        img = self._ensure_bgr(image_bgr)
        if img is None or img.size == 0:
            self.logger.warning("Cannot extract embedding: empty image")
            return None, None

        try:
            faces = self.face_analyzer.get(img)
        except Exception as e:
            self.logger.error(f"Error during face detection in extract_embedding: {e}", exc_info=True)
            return None, None

        if not faces:
            self.logger.info("Faces detected: 0")
            return None, None

        best = self._pick_best_face(faces)
        if best is None:
            self.logger.info("Faces detected: 0 (no valid face objects)")
            return None, None

        emb = best.normed_embedding
        x1, y1, x2, y2 = map(int, [best.bbox[0], best.bbox[1], best.bbox[2], best.bbox[3]])
        self.logger.info(f"Faces detected: {len(faces)} | Encodings generated: 1")
        return emb, (x1, y1, x2, y2)
    
    def _load_database(self):
        """Load or create database - EXACT FROM FR"""
        if os.path.exists(self.database_path):
            try:
                file_size = os.path.getsize(self.database_path)
                self.logger.debug(f"Loading database from {self.database_path} ({file_size} bytes)")
                with open(self.database_path, "rb") as f:
                    self.face_database = pickle.load(f)
                self._rebuild_index()
                self.logger.info(f"Loaded {len(self.face_database)} people from database")
            except Exception as e:
                self.logger.warning(f"Failed to load database: {e}")
                import traceback
                self.logger.warning(traceback.format_exc())
                self.face_database = {}
        else:
            self.logger.info(f"Database file does not exist at {self.database_path}, starting with empty database")
            self.face_database = {}
    
    def reload_database(self):
        """Reload database from disk - useful after external updates (thread-safe)"""
        # Use lock to prevent concurrent reloads
        if not hasattr(self, '_db_lock'):
            self._db_lock = threading.Lock()
        
        with self._db_lock:
            self.logger.info(f"Reloading face database from {self.database_path}...")
            old_count = len(self.face_database)
            self._load_database()
            new_count = len(self.face_database)
            if new_count != old_count:
                self.logger.info(f"Database reloaded. Count changed from {old_count} to {new_count} people")
            else:
                self.logger.debug(f"Database reloaded. Still has {new_count} people")
    
    def _rebuild_index(self):
        """Rebuild embedding index - EXACT FROM FR"""
        self.embeddings = []
        self.labels = []
        
        for name, data in self.face_database.items():
            for e in data.get("embeddings", []):
                # Ensure embedding is numpy array
                if isinstance(e, list):
                    e = np.array(e, dtype=np.float32)
                self.embeddings.append(e)
                self.labels.append(name)
        
        if self.embeddings:
            self.embeddings = np.array(self.embeddings, dtype=np.float32)
            self.labels = np.array(self.labels)
            # Calculate norms for cosine similarity
            self.embedding_norms = np.linalg.norm(self.embeddings, axis=1)
            # Debug: log embedding stats
            if len(self.embeddings) > 0:
                self.logger.debug(f"Rebuilt index: {len(self.embeddings)} embeddings, shape: {self.embeddings.shape}, "
                                f"avg norm: {np.mean(self.embedding_norms):.4f}")
    
    def recognize_face(self, embedding, target_person_id=None, target_embedding: Optional[np.ndarray] = None):
        """
        Fast recognition with threshold - EXACT FROM FR
        
        Args:
            embedding: Face embedding to recognize
            target_person_id: Optional - if provided, only match against this specific person
                             This allows searching for a specific missing person only
        """
        if self.embeddings.size == 0:
            self.logger.warning("[Face Recognition] No embeddings in database for recognition! Database is empty.")
            return "Unknown", 0.0
        
        # Ensure embedding is numpy array
        if isinstance(embedding, list):
            embedding = np.array(embedding, dtype=np.float32)
        
        norm = np.linalg.norm(embedding)
        if norm == 0:
            self.logger.warning("Zero norm embedding detected")
            return "Unknown", 0.0
        
        # If target_person_id is specified, only search for that person
        if target_person_id:
            # Fallback path: match against a single provided embedding (e.g., from Firestore)
            if target_person_id not in self.face_database:
                if target_embedding is not None:
                    te = target_embedding
                    if isinstance(te, list):
                        te = np.array(te, dtype=np.float32)
                    tnorm = np.linalg.norm(te)
                    if tnorm == 0:
                        return "Unknown", 0.0
                    score = float(np.dot(te, embedding) / (tnorm * norm))
                    if score >= self.threshold:
                        self.logger.info(f"[Face Recognition] MATCH FOUND (firestore embedding): {target_person_id} score={score:.4f}")
                        return target_person_id, score
                    return "Unknown", score

                self.logger.debug(f"[Face Recognition] Target person {target_person_id} not in database")
                return "Unknown", 0.0
            
            # Get embeddings only for the target person
            target_embeddings = []
            for e in self.face_database[target_person_id].get("embeddings", []):
                if isinstance(e, list):
                    e = np.array(e, dtype=np.float32)
                target_embeddings.append(e)
            
            if not target_embeddings:
                self.logger.warning(f"[Face Recognition] No embeddings found for target person {target_person_id}")
                return "Unknown", 0.0
            
            target_embeddings = np.array(target_embeddings, dtype=np.float32)
            target_norms = np.linalg.norm(target_embeddings, axis=1)
            
            # Calculate similarity only against target person
            sims = np.dot(target_embeddings, embedding) / (target_norms * norm)
            idx = np.argmax(sims)
            score = sims[idx]
            matched_label = target_person_id
            
            self.logger.debug(f"[Face Recognition] Targeted search for {target_person_id}: score={score:.4f}, threshold={self.threshold}")
            
            if score >= self.threshold:
                self.logger.info(f"[Face Recognition] MATCH FOUND: {matched_label} with confidence {score:.4f}")
                return matched_label, float(score)
            else:
                self.logger.debug(f"[Face Recognition] No match for {target_person_id}: score {score:.4f} < threshold {self.threshold}")
                return "Unknown", float(score)
        
        # Original behavior: search against all registered persons
        # FASTER: Use matrix multiplication for cosine similarity
        # Since embeddings are normalized (normed_embedding), cosine similarity = dot product
        sims = np.dot(self.embeddings, embedding) / (self.embedding_norms * norm)
        
        idx = np.argmax(sims)
        score = sims[idx]
        matched_label = self.labels[idx]
        
        # Debug logging for recognition attempts
        self.logger.debug(f"[Face Recognition] Recognition attempt: best match={matched_label}, score={score:.4f}, threshold={self.threshold}, database_size={len(self.face_database)}")
        
        # LOWER THRESHOLD for better initial recognition
        if score >= self.threshold:
            self.logger.info(f"[Face Recognition] MATCH FOUND: {matched_label} with confidence {score:.4f}")
            return matched_label, float(score)
        
        self.logger.debug(f"[Face Recognition] No match above threshold: best score {score:.4f} < threshold {self.threshold}. Returning Unknown.")
        return "Unknown", float(score)
    
    def detect_and_recognize(
        self,
        frame: np.ndarray,
        force_detection: bool = False,
        target_person_id: Optional[str] = None,
        target_embedding: Optional[np.ndarray] = None
    ) -> List[Dict]:
        """
        Detect and recognize faces in frame - EXACT FROM FR
        
        Args:
            frame: Input frame (BGR format)
            force_detection: Force face detection (skip interval check)
            target_person_id: Optional - if provided, only match against this specific person
                             This allows searching for a specific missing person only
            
        Returns:
            List of detection results with bbox, label, confidence, embedding
        """
        # Validate inputs
        if self.face_analyzer is None:
            self.logger.debug("Face analyzer not initialized, skipping detection")
            return []
        
        if frame is None or frame.size == 0:
            self.logger.warning("Empty or invalid frame provided")
            return []
        
        if len(frame.shape) != 3 or frame.shape[2] != 3:
            self.logger.warning(f"Invalid frame shape: {frame.shape}, expected (H, W, 3)")
            return []
        
        current_time = time.time()
        
        # SKIP detection if too soon (unless forced)
        # When force_detection=True, skip throttling for missing person scanning
        if not force_detection and (current_time - self.last_detection_time) < self.min_detection_interval:
            return []
        
        # Only update last_detection_time if not forced (to allow rapid forced scans)
        if not force_detection:
            self.last_detection_time = current_time
        
        # FAST detection: resize while keeping aspect ratio for speed
        # (avoid fixed WxH that can distort faces)
        frame_bgr = self._ensure_bgr(frame)
        if frame_bgr is None or frame_bgr.size == 0:
            self.logger.warning("Empty or invalid frame provided (after preprocessing)")
            return []

        h, w = frame_bgr.shape[:2]
        max_side = max(h, w)
        # Target max side around 640px for detection (good speed/accuracy trade-off)
        if max_side > 640:
            scale = 640.0 / max_side
            small_frame = cv2.resize(frame_bgr, (int(w * scale), int(h * scale)))
        else:
            scale = 1.0
            small_frame = frame_bgr
        
        # Detect faces with error handling
        try:
            # IMPORTANT: InsightFace expects BGR input
            faces = self.face_analyzer.get(small_frame)
            self.logger.debug(
                f"[Face Recognition] Faces detected: {len(faces)} | frame={frame_bgr.shape} resized={small_frame.shape} scale={scale:.4f}"
            )
        except Exception as e:
            self.logger.error(f"Error during face detection: {e}")
            import traceback
            self.logger.error(traceback.format_exc())
            return []
        
        if len(faces) == 0:
            self.logger.debug("[Face Recognition] No faces detected in frame by InsightFace")
            return []
        
        results = []
        
        for f in faces:
            # Scale coordinates back up
            if scale != 1.0:
                inv = 1.0 / scale
                x1, y1, x2, y2 = map(int, [f.bbox[0] * inv, f.bbox[1] * inv, f.bbox[2] * inv, f.bbox[3] * inv])
            else:
                x1, y1, x2, y2 = map(int, [f.bbox[0], f.bbox[1], f.bbox[2], f.bbox[3]])
            
            # CRITICAL: Use normed_embedding like FR folder does
            emb = f.normed_embedding
            
            results.append({
                "bbox": (x1, y1, x2, y2),
                "label": "Unknown",
                "confidence": 0.0,
                "embedding": emb
            })
        
        # Apply simple tracking - EXACT FROM FR
        if self.enable_tracking and results:
            results = self.tracker.update(results)
            
            # SMART recognition: Only recognize new or changed tracks - EXACT FROM FR
            for det in results:
                track_id = det.get('track_id')
                
                if track_id is None:
                    # New detection - recognize immediately
                    embedding = det['embedding']
                    emb_norm = np.linalg.norm(embedding)
                    self.logger.debug(f"[Face Recognition] Recognizing new face (track_id=None), embedding norm: {emb_norm:.4f}")
                    
                    # Check if database has any embeddings
                    if self.embeddings.size == 0:
                        self.logger.warning("[Face Recognition] Database is empty! No persons registered.")
                    
                    # Use targeted recognition if target_person_id is provided
                    label, conf = self.recognize_face(
                        embedding,
                        target_person_id=target_person_id,
                        target_embedding=target_embedding
                    )
                    det['label'] = label
                    det['confidence'] = float(conf)
                    if label != "Unknown":
                        self.logger.info(f"[Face Recognition] NEW DETECTION: Recognized {label} with confidence {conf:.4f}")
                    else:
                        self.logger.debug(f"[Face Recognition] Face recognized as Unknown (best match score: {conf:.4f}, threshold: {self.threshold})")
                else:
                    # Existing track - check cache
                    cache_key = track_id
                    
                    # ALWAYS use cache if available (don't expire based on time)
                    if cache_key in self.recognition_cache:
                        cache_data = self.recognition_cache[cache_key]
                        
                        # Only re-recognize if confidence was low (< 0.7)
                        if cache_data['confidence'] > 0.7:
                            det['label'] = cache_data['label']
                            det['confidence'] = cache_data['confidence']
                            continue
                    
                    # Re-recognize (use track's average embedding)
                    track_emb = self.tracker.get_track_embedding(track_id)
                    if track_emb is not None:
                        label, conf = self.recognize_face(
                            track_emb,
                            target_person_id=target_person_id,
                            target_embedding=target_embedding
                        )
                    else:
                        label, conf = self.recognize_face(
                            det['embedding'],
                            target_person_id=target_person_id,
                            target_embedding=target_embedding
                        )
                    
                    det['label'] = label
                    det['confidence'] = float(conf)
                    
                    # Update cache (always, regardless of confidence)
                    self.recognition_cache[cache_key] = {
                        'label': label,
                        'confidence': float(conf),
                        'timestamp': current_time
                    }
        
        return results
    
    def register_face(self, face_img: np.ndarray, label: str, embedding: Optional[np.ndarray] = None) -> bool:
        """
        Register a face in the database - EXACT FROM FR
        
        Args:
            face_img: Face image (BGR format)
            label: Person identifier (person_id)
            embedding: Optional pre-computed embedding
            
        Returns:
            True if successful
        """
        if self.face_analyzer is None:
            self.logger.error(f"Cannot register face for {label}: face_analyzer is None")
            return False
        
        if embedding is None:
            face_bgr = self._ensure_bgr(face_img)
            try:
                # IMPORTANT: InsightFace expects BGR input
                faces = self.face_analyzer.get(face_bgr)
            except Exception as e:
                self.logger.error(f"Error during face detection in register_face: {e}")
                return False
            if not faces:
                self.logger.warning(f"No face detected in image for {label}")
                return False
            best_face = self._pick_best_face(faces)
            if best_face is None:
                self.logger.warning(f"No valid face detected in image for {label}")
                return False
            emb = best_face.normed_embedding
            self.logger.info(
                f"Encodings generated: 1 | label={label} | emb_shape={emb.shape} | emb_norm={np.linalg.norm(emb):.4f}"
            )
        else:
            emb = embedding
        
        # Ensure embedding is numpy array
        if isinstance(emb, list):
            emb = np.array(emb, dtype=np.float32)
        
        if np.all(emb == 0):
            self.logger.warning(f"Zero embedding detected for {label}")
            return False
        
        if label not in self.face_database:
            self.face_database[label] = {
                "embeddings": [],
                "registered_at": utc_now().isoformat().replace("+00:00", "Z")
            }
        
        # Store as list like FR folder does
        self.face_database[label]["embeddings"].append(emb.tolist())
        self.logger.info(f"Registered face for {label}. Total embeddings for this person: {len(self.face_database[label]['embeddings'])}")
        
        self._rebuild_index()
        self.logger.info(f"Rebuilt index. Total people: {len(self.face_database)}, Total embeddings: {len(self.embeddings)}")
        
        # Save database atomically (write to temp file, then rename)
        try:
            os.makedirs(os.path.dirname(self.database_path), exist_ok=True)
            
            # Use lock to prevent concurrent writes
            if not hasattr(self, '_db_lock'):
                self._db_lock = threading.Lock()
            
            with self._db_lock:
                # Write to temporary file first
                temp_path = self.database_path + '.tmp'
                with open(temp_path, "wb") as f:
                    pickle.dump(self.face_database, f)
                
                # Verify temp file
                if os.path.exists(temp_path):
                    temp_size = os.path.getsize(temp_path)
                    if temp_size == 0:
                        self.logger.error("Temporary database file is empty after save!")
                        os.remove(temp_path)
                        return False
                    
                    # Atomic rename (works on Windows and Unix)
                    if os.path.exists(self.database_path):
                        os.replace(temp_path, self.database_path)
                    else:
                        os.rename(temp_path, self.database_path)
                    
                    # Verify final file
                    if os.path.exists(self.database_path):
                        file_size = os.path.getsize(self.database_path)
                        self.logger.info(f"Database saved atomically: {self.database_path} ({file_size} bytes)")
                    else:
                        self.logger.error(f"Database file was not created at {self.database_path}")
                        return False
                else:
                    self.logger.error(f"Temporary database file was not created at {temp_path}")
                    return False
        except Exception as e:
            self.logger.error(f"Failed to save database: {e}")
            import traceback
            self.logger.error(traceback.format_exc())
            # Clean up temp file if it exists
            temp_path = self.database_path + '.tmp'
            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except:
                    pass
            return False
        
        return True
    
    def add_person_from_array(self, person_id: str, image_array: np.ndarray) -> bool:
        """
        Add person from image array - Uses normed_embedding like FR
        
        Args:
            person_id: Unique person identifier
            image_array: Image as numpy array (BGR format)
            
        Returns:
            True if successful
        """
        if self.face_analyzer is None:
            return False
        
        # Extract face embedding first
        image_bgr = self._ensure_bgr(image_array)
        try:
            # IMPORTANT: InsightFace expects BGR input
            faces = self.face_analyzer.get(image_bgr)
        except Exception as e:
            self.logger.error(f"Error during face detection in add_person_from_array: {e}")
            return False
        
        if len(faces) == 0:
            self.logger.warning(f"No face found in image for person: {person_id}")
            return False
        
        best_face = self._pick_best_face(faces)
        if best_face is None:
            self.logger.warning(f"No valid face found in image for person: {person_id}")
            return False
        embedding = best_face.normed_embedding
        return self.register_face(image_array, person_id, embedding)
    
    def remove_person(self, person_id: str) -> bool:
        """
        Remove person from known faces
        
        Args:
            person_id: Person identifier to remove
            
        Returns:
            True if removed, False if not found
        """
        if person_id in self.face_database:
            del self.face_database[person_id]
            self._rebuild_index()
            
            # Save database atomically
            try:
                with self._db_lock:
                    # Write to temporary file first
                    temp_path = self.database_path + '.tmp'
                    with open(temp_path, "wb") as f:
                        pickle.dump(self.face_database, f)
                    
                    # Atomic rename
                    if os.path.exists(self.database_path):
                        os.replace(temp_path, self.database_path)
                    else:
                        os.rename(temp_path, self.database_path)
            except Exception as e:
                self.logger.warning(f"Failed to save database: {e}")
                # Clean up temp file
                temp_path = self.database_path + '.tmp'
                if os.path.exists(temp_path):
                    try:
                        os.remove(temp_path)
                    except:
                        pass
            
            return True
        return False
    
    def get_known_persons(self) -> List[str]:
        """Get list of known person IDs"""
        return list(self.face_database.keys())
    
    def clear_database(self):
        """Clear the face database"""
        self.face_database = {}
        self.embeddings = np.array([])
        self.labels = []
        self.embedding_norms = np.array([])
        self.logger.info("Database cleared")
    
    def get_face_stats(self):
        """Get face database statistics - for compatibility"""
        return {
            'total_people': len(self.face_database),
            'total_embeddings': sum(len(data.get('embeddings', [])) for data in self.face_database.values()),
            'known_person_ids': list(self.face_database.keys())
        }
    
    def verify_person_registered(self, person_id: str) -> bool:
        """Verify if a person is registered in the database"""
        is_registered = person_id in self.face_database
        if is_registered:
            emb_count = len(self.face_database[person_id].get('embeddings', []))
            self.logger.info(f"Person {person_id} is registered with {emb_count} embeddings")
        else:
            self.logger.warning(f"Person {person_id} is NOT registered in database")
        return is_registered


# Global recognizer instance with thread safety and reload caching
_recognizer = None
_recognizer_lock = threading.Lock()
_last_db_reload_time = 0
_db_reload_cache_duration = 5.0  # Cache reloads for 5 seconds to reduce I/O

def get_recognizer(reload_db=False) -> Optional[FaceRecognizer]:
    """Get or create global recognizer instance (thread-safe)
    
    Args:
        reload_db: If True, reload database from disk even if recognizer exists
                   (cached for 5 seconds to reduce I/O overhead)
    """
    global _recognizer, _last_db_reload_time
    if _recognizer is None:
        with _recognizer_lock:
            # Double-check pattern to avoid race condition
            if _recognizer is None:
                try:
                    _recognizer = FaceRecognizer()
                    # Verify that face_analyzer was initialized successfully
                    if _recognizer.face_analyzer is None:
                        logger.error("FaceRecognizer initialized but face_analyzer is None. Face recognition will not work.")
                        logger.error("Please ensure InsightFace is installed: pip install insightface onnxruntime")
                except Exception as e:
                    logger.error(f"Failed to initialize FaceRecognizer: {e}")
                    return None
    elif reload_db:
        # Reload database if requested, but cache for a few seconds to reduce I/O
        import time
        current_time = time.time()
        if (current_time - _last_db_reload_time) > _db_reload_cache_duration:
            _recognizer.reload_database()
            _last_db_reload_time = current_time
        else:
            logger.debug(f"Skipping database reload (cached for {_db_reload_cache_duration}s)")
    return _recognizer
