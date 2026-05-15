"""
Crowd Detection Model (PyTorch-based)
Uses LightweightCrowdNet model for density map prediction
Based on working reference implementation in cd_model/crowd_counter.py
"""

import torch
import torch.nn as nn
import cv2
import numpy as np
from typing import Dict, Any, Optional
import os
import logging
import threading

# Setup logging
logger = logging.getLogger(__name__)

# ===== MODEL ARCHITECTURE (Matching reference exactly) =====
class LightweightCrowdNet(nn.Module):
    """PyTorch model for crowd density estimation - matches reference implementation"""
    
    def __init__(self):
        super(LightweightCrowdNet, self).__init__()
        
        self.features = nn.Sequential(
            nn.Conv2d(3, 32, 3, stride=2, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),
            
            self._depthwise_block(32, 64, stride=2),
            self._depthwise_block(64, 128, stride=2),
            self._depthwise_block(128, 128, stride=1),
            self._depthwise_block(128, 256, stride=2),
            self._depthwise_block(256, 256, stride=1),
        )
        
        self.density_head = nn.Sequential(
            nn.Conv2d(256, 128, 1),
            nn.ReLU(inplace=True),
            nn.Conv2d(128, 64, 1),
            nn.ReLU(inplace=True),
            nn.Conv2d(64, 1, 1),
            nn.ReLU(inplace=True)
        )
    
    def _depthwise_block(self, in_channels, out_channels, stride):
        return nn.Sequential(
            nn.Conv2d(in_channels, in_channels, 3, stride=stride, 
                     padding=1, groups=in_channels),
            nn.BatchNorm2d(in_channels),
            nn.ReLU(inplace=True),
            nn.Conv2d(in_channels, out_channels, 1),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
        )
    
    def forward(self, x):
        x = self.features(x)
        x = self.density_head(x)
        return x

# ===== CROWD DETECTOR CLASS (Based on working reference) =====
class CrowdDetector:
    """
    Detect crowd density using PyTorch model
    Matches the working reference implementation structure exactly
    """
    
    def __init__(self, model_path=None, input_size=256, device='auto'):
        """Initialize crowd detector with PyTorch model"""
        logger.info("[CrowdDetector] Initializing CrowdDetector...")
        
        # Set thresholds FIRST (required by project specifications)
        # Low: 0 to 100 people
        # Medium: 101 to 250 people
        # High: 251 to 400 people
        # Critical: More than 400 people
        self.LOW_THRESHOLD = 101
        self.MEDIUM_THRESHOLD = 251
        self.HIGH_THRESHOLD = 401
        
        # Initialize common attributes
        # Use smaller input size for faster processing (can be overridden via env)
        import os
        self.input_size = int(os.getenv('CROWD_DETECTION_INPUT_SIZE', input_size))
        self.device = self._get_device(device)
        
        # Enable PyTorch optimizations for faster inference
        self._enable_optimizations()
        
        # Find model file if not provided
        if model_path is None:
            model_path = self._find_model_file()
        
        if model_path is None:
            raise FileNotFoundError(
                "Model file 'mall_shanghai_finetuned.pth' not found. "
                "Please ensure the model file exists in backend/, backend/models/, or cd_model/ directory."
            )
        
        self.model_path = model_path
        logger.info(f"[CrowdDetector] Using model: {model_path}")
        
        # Load model (matches reference implementation exactly)
        self.model = self._load_model()
        logger.info(f"[CrowdDetector] Model loaded successfully")
        logger.info(f"[CrowdDetector] Using device: {self.device}")
        logger.info(f"[CrowdDetector] Input size: {self.input_size}x{self.input_size}")
    
    def _get_device(self, device_str):
        """Get PyTorch device (matches reference)"""
        if device_str == 'auto':
            device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
            if device.type == 'cuda':
                logger.info("[CrowdDetector] Using GPU for faster processing")
            else:
                logger.info("[CrowdDetector] Using CPU (GPU not available)")
            return device
        return torch.device(device_str)
    
    def _enable_optimizations(self):
        """Enable PyTorch optimizations for faster inference"""
        try:
            # Enable optimizations if available
            if hasattr(torch.backends, 'cudnn'):
                torch.backends.cudnn.benchmark = True  # Optimize for consistent input sizes
                logger.debug("[CrowdDetector] Enabled cuDNN optimizations")
        except:
            pass  # Optimizations not critical
    
    def _find_model_file(self):
        """Find model file in common locations"""
        backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        models_dir = os.path.dirname(os.path.abspath(__file__))
        
        possible_paths = [
            os.path.join(backend_dir, 'data', 'mall_shanghai_finetuned.pth'),
            os.path.join(backend_dir, 'mall_shanghai_finetuned.pth'),
            os.path.join(models_dir, 'mall_shanghai_finetuned.pth'),
        ]
        
        for path in possible_paths:
            abs_path = os.path.abspath(path)
            if os.path.exists(abs_path):
                logger.info(f"[CrowdDetector] Found model at: {abs_path}")
                return abs_path
        
        logger.error(f"[CrowdDetector] Model not found in: {possible_paths}")
        return None
    
    def _load_model(self):
        """Load PyTorch model (matches reference implementation exactly)"""
        if not os.path.exists(self.model_path):
            raise FileNotFoundError(f"Model not found: {self.model_path}")
        
        try:
            # Create model instance
            model = LightweightCrowdNet().to(self.device)
            
            # Load weights
            logger.info(f"[CrowdDetector] Loading model weights from: {self.model_path}")
            state_dict = torch.load(self.model_path, map_location=self.device)
            model.load_state_dict(state_dict)
            model.eval()
            
            # Note: JIT optimization removed as it may not work with all model architectures
            # The model is already optimized with eval() mode
            
            logger.info(f"[CrowdDetector] Model weights loaded successfully")
            return model
        except FileNotFoundError:
            raise
        except Exception as e:
            error_msg = f"Failed to load model from {self.model_path}: {str(e)}"
            logger.error(f"[CrowdDetector] {error_msg}")
            raise RuntimeError(error_msg) from e
    
    def predict(self, frame: np.ndarray) -> Dict[str, Any]:
        """
        Predict crowd count from frame (matches reference implementation exactly)
        
        Args:
            frame: Input frame in BGR format (OpenCV format)
            
        Returns:
            Dictionary with 'count', 'count_float', 'density_map', and 'density_category'
        """
        try:
            # Preprocess (matching reference code exactly)
            img_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            img_resized = cv2.resize(img_rgb, (self.input_size, self.input_size))
            img_normalized = img_resized.astype(np.float32) / 255.0
            
            # Convert to tensor: [H, W, C] -> [C, H, W] -> [1, C, H, W]
            img_tensor = torch.from_numpy(img_normalized).permute(2, 0, 1).unsqueeze(0)
            img_tensor = img_tensor.to(self.device)
            
            # Predict (matches reference exactly)
            with torch.no_grad():
                density_map = self.model(img_tensor)
                count = density_map.sum().item()
            
            # Get density map as numpy array (matches reference)
            density_np = density_map.squeeze().cpu().numpy()
            
            # Get density category using project-required thresholds
            density_category = self._get_density_category(count)
            
            logger.debug(f"[CrowdDetector] Prediction: count={count:.2f}, category={density_category}")
            
            return {
                'count': int(count),  # Matches reference: int(count) not round
                'density_map': density_np,
                'density_category': density_category,
                'count_float': count  # Keep original float for reference
            }
            
        except Exception as e:
            logger.error(f"[CrowdDetector] Error in crowd prediction: {e}", exc_info=True)
            return {
                'count': 0,
                'density_map': np.zeros((self.input_size, self.input_size)),
                'density_category': 'ERROR',
                'count_float': 0.0
            }
    
    def _get_density_category(self, count: float) -> str:
        """
        Get density category based on project-required thresholds
        
        Args:
            count: Crowd count (float)
            
        Returns:
            'low', 'medium', 'high', or 'critical'
        """
        if count < self.LOW_THRESHOLD:  # 0-100
            return 'low'
        elif count < self.MEDIUM_THRESHOLD:  # 101-250
            return 'medium'
        elif count < self.HIGH_THRESHOLD:  # 251-400
            return 'high'
        else:  # >400
            return 'critical'
    
    def process_frame(self, frame: np.ndarray) -> Dict[str, Any]:
        """
        Process a frame and return comprehensive results (for API compatibility)
        
        Args:
            frame: Input frame (BGR format)
            
        Returns:
            Dictionary with detection results compatible with API expectations
        """
        if frame is None or frame.size == 0:
            logger.warning("[CrowdDetector] Invalid frame input")
            return {
                'count': 0,
                'level': 'low',
                'density_score': 0.0,
                'boxes': [],
                'weights': [],
                'density_map': None
            }
        
        logger.debug(f"[CrowdDetector] Processing frame: shape={frame.shape}")
        
        # Use the predict method (matches reference)
        result = self.predict(frame)
        
        count = result['count']
        level = result['density_category']  # Already 'low', 'medium', 'high', or 'critical'
        
        # Calculate density score (0.0 to 1.0) normalized to critical threshold (400)
        max_expected = 400
        density_score = min(count / max_expected, 1.0) if max_expected > 0 else 0.0
        
        logger.info(f"[CrowdDetector] Result: count={count}, level={level}, score={density_score:.2f}")
        
        return {
            'count': count,
            'level': level,
            'density_score': density_score,
            'boxes': [],  # Density map model doesn't provide bounding boxes
            'weights': [],
            'density_map': result.get('density_map')
        }

# Global instance (singleton pattern) with thread safety
_detector: Optional[CrowdDetector] = None
_detector_lock = threading.Lock()

class NoopCrowdDetector:
    def process_frame(self, frame: np.ndarray) -> Dict[str, Any]:
        return {
            'count': 0,
            'level': 'low',
            'density_score': 0.0,
            'boxes': [],
            'weights': [],
            'density_map': None
        }

def get_detector() -> CrowdDetector:
    """
    Get singleton instance of CrowdDetector (thread-safe)
    
    Returns:
        CrowdDetector instance
        
    Raises:
        FileNotFoundError: If model file is not found
        Exception: If detector initialization fails
    """
    global _detector
    if _detector is None:
        with _detector_lock:
            # Double-check pattern to avoid race condition
            if _detector is None:
                try:
                    _detector = CrowdDetector()
                    logger.info("[CrowdDetector] Detector initialized successfully")
                except FileNotFoundError as e:
                    logger.warning(f"[CrowdDetector] Model file not found, using NoopCrowdDetector: {e}")
                    _detector = NoopCrowdDetector()  # type: ignore
                except Exception as e:
                    logger.error(f"[CrowdDetector] Failed to initialize detector: {e}", exc_info=True)
                    raise
    return _detector
