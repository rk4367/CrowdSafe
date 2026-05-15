import os
import logging
from typing import Dict, Any, List, Tuple, Optional

import numpy as np
import cv2

try:
    from ultralytics import YOLO  # type: ignore
    ULTRALYTICS_AVAILABLE = True
except Exception:
    ULTRALYTICS_AVAILABLE = False

logger = logging.getLogger(__name__)


class FireSmokeDetector:
    """
    Lightweight YOLO-based fire/smoke detector with separate thresholds.
    - Loads model path from FIRE_SMOKE_MODEL_PATH (defaults to ../fire/best.pt relative to backend/)
    - Uses confidence thresholds:
        - FIRE_CONF (default 0.35) for fire detection
        - SMOKE_CONF (default 0.35) for smoke detection
    - Provides process_frame(frame) -> {'fire': int, 'smoke': int, 'boxes': [...]}
    """

    def __init__(self, model_path: Optional[str] = None, 
                 fire_conf: Optional[float] = None,
                 smoke_conf: Optional[float] = None):
        self.enabled = ULTRALYTICS_AVAILABLE
        self.fire_conf = float(os.getenv("FIRE_CONF", fire_conf if fire_conf is not None else 0.55))
        self.smoke_conf = float(os.getenv("SMOKE_CONF", smoke_conf if smoke_conf is not None else 0.999))
        self.model = None

        if not self.enabled:
            logger.warning("[FireSmokeDetector] Ultralytics/YOLO not available; detector disabled")
            return

        if model_path is None:
            backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            # New default: backend/data/fire/best.pt
            default_path_new = os.path.normpath(os.path.join(backend_dir, "data", "fire", "best.pt"))
            # Legacy fallback: ../fire/best.pt (project root fire folder)
            default_path_legacy = os.path.normpath(os.path.join(backend_dir, "..", "fire", "best.pt"))
            env_path = os.getenv("FIRE_SMOKE_MODEL_PATH")
            # Choose by priority: ENV -> new default -> legacy
            if env_path:
                model_path = env_path
            elif os.path.exists(default_path_new):
                model_path = default_path_new
            else:
                model_path = default_path_legacy

        if not os.path.isabs(model_path):
            model_path = os.path.abspath(model_path)

        if not os.path.exists(model_path):
            logger.warning(f"[FireSmokeDetector] Model file not found at {model_path}; detector disabled")
            self.enabled = False
            return

        try:
            self.model = YOLO(model_path)
            logger.info(f"[FireSmokeDetector] Loaded YOLO model from {model_path}")
            logger.info(f"[FireSmokeDetector] Thresholds - Fire: {self.fire_conf}, Smoke: {self.smoke_conf}")
            logger.info(f"[FireSmokeDetector] Model classes: {self.model.names}")
        except Exception as e:
            logger.warning(f"[FireSmokeDetector] Failed to load model: {e}")
            self.enabled = False

    def process_frame(self, frame: np.ndarray) -> Dict[str, Any]:
        """Return detection counts and boxes; empty if disabled or frame invalid."""
        if not self.enabled or self.model is None or frame is None or frame.size == 0:
            return {"fire": 0, "smoke": 0, "boxes": []}

        try:
            # Use the lower threshold for initial inference to catch all potential detections
            # This ensures we don't miss smoke with lower confidence
            min_conf = min(self.fire_conf, self.smoke_conf)
            
            # Ultralytics handles BGR frames fine
            results = self.model.predict(
                frame, imgsz=int(os.getenv("FIRE_SMOKE_IMGSZ", 384)),
                conf=min_conf, verbose=False
            )[0]

            fire_count = 0
            smoke_count = 0
            boxes: List[Dict[str, Any]] = []

            for box in results.boxes:
                xyxy = [int(v) for v in box.xyxy[0].tolist()]
                cls_idx = int(getattr(box.cls[0], "item", lambda: box.cls[0])())
                model_names = self.model.names
                if isinstance(model_names, dict):
                    original_label = model_names.get(cls_idx, str(cls_idx))
                elif isinstance(model_names, (list, tuple)):
                    original_label = model_names[cls_idx] if 0 <= cls_idx < len(model_names) else str(cls_idx)
                else:
                    original_label = str(cls_idx)
                conf = float(getattr(box.conf[0], "item", lambda: box.conf[0])())
                label = str(original_label).strip().lower()

                if label in {"smoke", "smokes"}:
                    if conf >= self.smoke_conf:  
                        smoke_count += 1
                        boxes.append({"bbox": xyxy, "label": "smoke", "conf": conf})
                elif label in {"fire", "flame", "flames"}:
                    if conf >= self.fire_conf: 
                        fire_count += 1
                        boxes.append({"bbox": xyxy, "label": "fire", "conf": conf})
                # Handle any other classes the model might output
                else:
                    boxes.append({"bbox": xyxy, "label": original_label, "conf": conf})

            return {"fire": fire_count, "smoke": smoke_count, "boxes": boxes}
        except Exception as e:
            logger.debug(f"[FireSmokeDetector] Inference error (non-critical): {e}")
            return {"fire": 0, "smoke": 0, "boxes": []}


_detector: Optional[FireSmokeDetector] = None


def get_fire_smoke_detector() -> FireSmokeDetector:
    global _detector
    if _detector is None:
        _detector = FireSmokeDetector()
    return _detector