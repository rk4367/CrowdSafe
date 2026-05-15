"""
Backward-compatible fire/smoke detection module.
Delegates to the FireSmokeDetector implementation.
"""

from .fire_smoke_detector import FireSmokeDetector, get_fire_smoke_detector

__all__ = ["FireSmokeDetector", "get_fire_smoke_detector"]
