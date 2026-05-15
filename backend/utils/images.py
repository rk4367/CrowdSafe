import io
import logging
from typing import Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

try:
    import cloudinary.uploader  # type: ignore
    CLOUDINARY_UPLOADER_AVAILABLE = True
except ImportError:
    CLOUDINARY_UPLOADER_AVAILABLE = False


def upload_bgr_frame_to_cloudinary(
    frame_bgr: np.ndarray,
    *,
    folder: str,
    public_id: str,
    crop_bbox: Optional[Tuple[int, int, int, int]] = None,
) -> Optional[str]:
    """
    Upload a cv2 BGR frame (optionally cropped) to Cloudinary and return the URL.
    Returns None if upload fails or Cloudinary isn't available.
    """
    if not CLOUDINARY_UPLOADER_AVAILABLE:
        return None
    if frame_bgr is None or not isinstance(frame_bgr, np.ndarray) or frame_bgr.size == 0:
        return None

    try:
        img = frame_bgr
        if crop_bbox:
            x1, y1, x2, y2 = crop_bbox
            h, w = img.shape[:2]
            x1 = max(0, min(x1, w - 1))
            x2 = max(0, min(x2, w))
            y1 = max(0, min(y1, h - 1))
            y2 = max(0, min(y2, h))
            if x2 > x1 and y2 > y1:
                img = img[y1:y2, x1:x2]

        import cv2

        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if not ok:
            return None

        upload_result = cloudinary.uploader.upload(
            io.BytesIO(buf.tobytes()),
            folder=folder,
            public_id=public_id,
            resource_type="image",
            overwrite=True,
        )
        return upload_result.get("secure_url") or upload_result.get("url")
    except Exception as e:
        logger.warning(f"Cloudinary upload failed: {e}")
        return None


def delete_cloudinary_image(image_url: str) -> bool:
    """
    Extract public_id from a Cloudinary URL and delete the image.
    Returns True if successfully deleted, False otherwise.
    """
    if not CLOUDINARY_UPLOADER_AVAILABLE or not image_url:
        return False
    
    try:
        # Extract public_id from URL: e.g. https://res.cloudinary.com/.../folder/filename.jpg
        # We split by 'upload/' and then remove the version number and extension.
        if 'upload/' not in image_url:
            return False
            
        parts = image_url.split('upload/')[-1].split('/')
        # Skip the version number if it starts with 'v' and is numeric
        if len(parts) > 1 and parts[0].startswith('v') and parts[0][1:].isdigit():
            parts = parts[1:]
            
        public_id_with_ext = '/'.join(parts)
        public_id = public_id_with_ext.rsplit('.', 1)[0]
        
        if not public_id:
            return False
            
        import cloudinary.uploader  # type: ignore
        cloudinary.uploader.destroy(public_id)
        return True
    except Exception as e:
        logger.warning(f"Failed to delete Cloudinary image: {e}")
        return False
