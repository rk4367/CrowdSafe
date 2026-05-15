"""
IP Camera Stream Handler
Handles MJPEG streams from IP cameras (HTTP-based)
"""

import cv2
import urllib.request
import urllib.parse
import numpy as np
import time

class MJPEGStream:
    """Custom MJPEG stream handler for HTTP-based camera feeds"""
    
    def __init__(self, url, timeout=8):
        self.url = url
        self.stream = None
        self.bytes = b''
        self.timeout = timeout
        self.read_timeout = 0.8  # Reduced timeout for faster processing
        self._connect(url)

    def _connect(self, url):
        """Connect to MJPEG stream (matches reference implementation with duplicate path fix)"""
        # Parse URL to avoid duplicate path segments
        from urllib.parse import urlparse, urlunparse
        
        parsed = urlparse(url)
        base_path = parsed.path.rstrip('/')
        
        # Build candidates avoiding duplicate paths
        candidates = []
        
        # Original URL
        candidates.append(url)
        
        # Only try additional paths if the original doesn't already contain them
        if not any(path in base_path for path in ['/video', '/mjpeg', '/mjpegstream', '/stream']):
            candidates.extend([
                urlunparse((parsed.scheme, parsed.netloc, base_path + '/video', parsed.params, parsed.query, parsed.fragment)),
                urlunparse((parsed.scheme, parsed.netloc, base_path + '/mjpeg', parsed.params, parsed.query, parsed.fragment)),
                urlunparse((parsed.scheme, parsed.netloc, base_path + '/mjpegstream', parsed.params, parsed.query, parsed.fragment)),
                urlunparse((parsed.scheme, parsed.netloc, base_path + '/stream', parsed.params, parsed.query, parsed.fragment)),
                urlunparse((parsed.scheme, parsed.netloc, base_path + '/axis-cgi/mjpg/video.cgi', parsed.params, parsed.query, parsed.fragment)),
                urlunparse((parsed.scheme, parsed.netloc, base_path + '/?action=stream', parsed.params, parsed.query, parsed.fragment))
            ])
        
        for u in candidates:
            try:
                print(f"[MJPEGStream] Connecting to {u}...")
                response = urllib.request.urlopen(u, timeout=self.timeout)
                content_type = response.headers.get('Content-Type', '')
                print(f"[MJPEGStream] Content-Type: {content_type}")
                if 'text/html' in content_type:
                    response.close()
                    continue
                self.stream = response
                self.url = u
                print(f"[MJPEGStream] Successfully connected to stream: {u}")
                return
            except Exception as e:
                print(f"[MJPEGStream] Failed to open {u}: {e}")
        
        print(f"[MJPEGStream] Failed to connect to any candidate URL")
        self.stream = None

    def isOpened(self):
        """Check if stream is open"""
        return self.stream is not None

    def read(self):
        """Read a frame from the MJPEG stream with improved error handling"""
        if not self.isOpened():
            return False, None
        
        deadline = time.time() + self.read_timeout
        try:
            while time.time() < deadline:
                chunk = self.stream.read(4096)
                if not chunk:
                    break
                self.bytes += chunk
                a = self.bytes.find(b'\xff\xd8')
                b = self.bytes.find(b'\xff\xd9')
                if a != -1 and b != -1:
                    jpg = self.bytes[a:b+2]
                    self.bytes = self.bytes[b+2:]
                    img = cv2.imdecode(np.frombuffer(jpg, dtype=np.uint8), cv2.IMREAD_COLOR)
                    if img is not None:
                        return True, img
            return False, None
        except (TimeoutError, ConnectionError, OSError) as e:
            # Network/connection errors - close stream and don't reconnect automatically
            # Reconnection should be handled at a higher level
            print(f"[MJPEGStream] Connection error reading frame: {e}")
            try:
                if self.stream:
                    self.stream.close()
            except Exception:
                pass
            self.stream = None
            return False, None
        except Exception as e:
            # Other errors
            print(f"[MJPEGStream] Error reading frame: {e}")
            return False, None

    def release(self):
        """Close the stream"""
        if self.stream:
            try:
                self.stream.close()
            except:
                pass
            self.stream = None

    def get(self, prop):
        """Compatibility method for cv2.VideoCapture interface"""
        # Return default values for compatibility
        return 0.0

