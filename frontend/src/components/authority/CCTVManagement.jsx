/**
 * CCTV Management Component
 * Allows authorities to manage CCTV cameras
 */

import { useState, useEffect, useRef } from 'react';
import { apiService } from '../../services/api';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { MapPin, ChevronDown, X, Search } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '../../config/firebase';

const CAMERA_CACHE_KEY = 'crowdsafe_authority_cameras_cache';

const mapContainerStyle = {
  width: '100%',
  height: '400px',
  position: 'relative',
  zIndex: 0
};

// Map Controller component to handle zooming to camera location
function MapController({ cameraToZoom, camerasForMap }) {
  const map = useMap();
  const prevCameraToZoomRef = useRef(null);
  const hasInitializedRef = useRef(false);
  
  useEffect(() => {
    // If there's a camera to zoom to, zoom to it (priority)
    if (cameraToZoom && 
        typeof cameraToZoom.latitude === 'number' && 
        typeof cameraToZoom.longitude === 'number' &&
        !isNaN(cameraToZoom.latitude) && 
        !isNaN(cameraToZoom.longitude) &&
        cameraToZoom.latitude >= -90 && cameraToZoom.latitude <= 90 &&
        cameraToZoom.longitude >= -180 && cameraToZoom.longitude <= 180) {
      
      // Check if this is a new camera to zoom to (not the same as previous)
      const isNewCamera = !prevCameraToZoomRef.current || 
        prevCameraToZoomRef.current.latitude !== cameraToZoom.latitude ||
        prevCameraToZoomRef.current.longitude !== cameraToZoom.longitude;
      
      if (isNewCamera) {
        // Zoom to the camera location with smooth animation
        map.flyTo([cameraToZoom.latitude, cameraToZoom.longitude], 15, {
          duration: 1.5
        });
        prevCameraToZoomRef.current = cameraToZoom;
        hasInitializedRef.current = true;
      }
      return; // Don't do initial zoom if we're zooming to a camera
    }
    
    // Initial zoom out - fit all cameras in view (only if no camera to zoom to)
    if (camerasForMap && camerasForMap.length > 0 && !cameraToZoom) {
      const validCameras = camerasForMap.filter(c => 
        c && 
        typeof c.latitude === 'number' && 
        typeof c.longitude === 'number' &&
        !isNaN(c.latitude) && 
        !isNaN(c.longitude) &&
        c.latitude >= -90 && c.latitude <= 90 &&
        c.longitude >= -180 && c.longitude <= 180
      );
      
      if (validCameras.length > 0) {
        // Only do initial zoom if we haven't initialized yet
        if (!hasInitializedRef.current) {
          const bounds = validCameras.map(c => [c.latitude, c.longitude]);
          if (bounds.length === 1) {
            map.setView([validCameras[0].latitude, validCameras[0].longitude], 8);
          } else {
            // Fit all cameras in view with padding and max zoom of 8 for zoomed out view
            map.fitBounds(bounds, {
              padding: [50, 50],
              maxZoom: 8
            });
          }
          hasInitializedRef.current = true;
        }
      }
    }
  }, [map, cameraToZoom, camerasForMap]);
  
  return null;
}

export default function CCTVManagement() {
  const [cameras, setCameras] = useState([]);
  const [cities, setCities] = useState([]);
  const [selectedCity, setSelectedCity] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    ip_address: '',
    stream_url: '',
    location_name: '',
    city: '',
    latitude: '',
    longitude: ''
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [isDegradedMode, setIsDegradedMode] = useState(false);
  const [viewingCamera, setViewingCamera] = useState(null);
  const [gridView, setGridView] = useState(false);
  const [selectedCameras, setSelectedCameras] = useState([]);
  const [streamErrors, setStreamErrors] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [checkingStatus, setCheckingStatus] = useState({});
  const [statusCheckInterval, setStatusCheckInterval] = useState(null);
  const [cameraToZoom, setCameraToZoom] = useState(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [cityDropdownOpen, setCityDropdownOpen] = useState(false);
  const [citySearchQuery, setCitySearchQuery] = useState('');
  const cityDropdownRef = useRef(null);
  
  useEffect(() => {
    // Real-time CCTV cameras (no polling).
    const qCameras = query(collection(db, 'cctv_cameras'));
    const unsub = onSnapshot(
      qCameras,
      (snap) => {
        let camerasList = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        // Normalize city names
        camerasList = camerasList.map((camera) => ({
          ...camera,
          city: camera.city ? String(camera.city).trim().replace(/\w\S*/g, (w) => (w.replace(/^\w/, (c) => c.toUpperCase()))) : ''
        }));

        const uniqueCities = [...new Set(
          camerasList
            .map((camera) => camera.city)
            .filter((city) => city && city !== '')
        )].sort();

        setCities(uniqueCities);
        setCameras(camerasList);
        setIsDegradedMode(false);
        setLoading(false);
      },
      (err) => {
        console.error('Error listening to cameras:', err);
        setError('Unable to load live camera data right now. Please try again in a moment.');
        setCameras([]);
        setCities([]);
        setIsDegradedMode(true);
        setLoading(false);
      }
    );

    return () => {
      setStatusCheckInterval(null);
      unsub();
    };
  }, []);

  // Close city dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (cityDropdownRef.current && !cityDropdownRef.current.contains(event.target)) {
        setCityDropdownOpen(false);
        setCitySearchQuery('');
      }
    };

    if (cityDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [cityDropdownOpen]);
  
  // Component for MJPEG streams in grid view
  const GridStreamImage = ({ streamUrl, cameraName }) => {
    const imgRef = useRef(null);
    
    useEffect(() => {
      if (imgRef.current && streamUrl) {
        // Refresh MJPEG stream periodically
        const interval = setInterval(() => {
          if (imgRef.current) {
            const timestamp = new Date().getTime();
            imgRef.current.src = `${streamUrl}${streamUrl.includes('?') ? '&' : '?'}t=${timestamp}`;
          }
        }, 100); // Refresh every 100ms
        
        return () => clearInterval(interval);
      }
    }, [streamUrl]);
    
    return (
      <img 
        ref={imgRef}
        src={streamUrl}
        alt={cameraName}
        className="w-full h-full object-contain"
        onError={(e) => {
          e.target.style.display = 'none';
          e.target.parentElement.innerHTML = '<div class="text-white text-center p-4"><p class="text-sm">Stream unavailable</p></div>';
        }}
        crossOrigin="anonymous"
      />
    );
  };
  
  // Component for rendering video streams with fallbacks
  const StreamPlayer = ({ streamUrl, cameraName, onError }) => {
    const [streamType, setStreamType] = useState(null);
    const [actualStreamUrl, setActualStreamUrl] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(true);
    const [useCrossOrigin, setUseCrossOrigin] = useState(false);
    const imgRef = useRef(null);
    const videoRef = useRef(null);
    const retryCount = useRef(0);
    const endpointIndex = useRef(0);
    
    // Common IP camera video endpoints (in order of preference)
    const videoEndpointsRef = useRef(['/video', '/mjpeg', '/videofeed', '/video.mjpg', '/shot.jpg']);
    
    useEffect(() => {
      if (!streamUrl) {
        setStreamType(null);
        return;
      }
      
      // Reset state when URL changes
      setError(null);
      setLoading(true);
      setUseCrossOrigin(false);
      retryCount.current = 0;
      endpointIndex.current = 0;
      
      // Detect stream type (prefer direct MJPEG/video to avoid camera UI)
      if (streamUrl.startsWith('rtsp://')) {
        setStreamType('rtsp');
        setActualStreamUrl(streamUrl);
        setLoading(false);
      } else if (streamUrl.match(/\.(jpg|jpeg|png|gif)$/i)) {
        setStreamType('image');
        setActualStreamUrl(streamUrl);
        setLoading(false);
      } else if (streamUrl.includes('/mjpeg') || streamUrl.includes('/video') || streamUrl.includes('/videofeed')) {
        // Already has video endpoint
        setStreamType('mjpeg');
        setActualStreamUrl(streamUrl);
        setLoading(false);
      } else if (streamUrl.match(/^https?:\/\/\d+\.\d+\.\d+\.\d+:\d+$/)) {
        // IP camera URL without endpoint - try direct video endpoints first
        const baseUrl = streamUrl.replace(/\/$/, '');
        const endpoint = videoEndpointsRef.current[endpointIndex.current];
        setStreamType('mjpeg');
        setActualStreamUrl(`${baseUrl}${endpoint}`);
        setLoading(false);
      } else if (streamUrl.match(/^https?:\/\/\d+\.\d+\.\d+\.\d+:\d+\//)) {
        // IP camera URL with path - try as MJPEG first
        setStreamType('mjpeg');
        setActualStreamUrl(streamUrl);
        setLoading(false);
      } else if (streamUrl.includes('.m3u8')) {
        setStreamType('hls');
        setActualStreamUrl(streamUrl);
        setLoading(false);
      } else {
        setStreamType('video');
        setActualStreamUrl(streamUrl);
        setLoading(false);
      }
    }, [streamUrl]);
    
    // MJPEG stream handler - refresh image periodically
    useEffect(() => {
      if (streamType === 'mjpeg' && imgRef.current && actualStreamUrl && !error) {
        // Set initial source with cache busting
        const setInitialSrc = () => {
          if (imgRef.current) {
            const initialUrl = `${actualStreamUrl}${actualStreamUrl.includes('?') ? '&' : '?'}t=${new Date().getTime()}`;
            imgRef.current.src = initialUrl;
          }
        };
        
        // Set initial source after a brief delay to ensure ref is ready
        const timeoutId = setTimeout(setInitialSrc, 100);
        
        // Then refresh periodically for live stream
        const interval = setInterval(() => {
          if (imgRef.current && !error && actualStreamUrl) {
            const timestamp = new Date().getTime();
            const refreshUrl = `${actualStreamUrl}${actualStreamUrl.includes('?') ? '&' : '?'}t=${timestamp}`;
            // Force refresh by updating src
            imgRef.current.src = refreshUrl;
          }
        }, 200); // Refresh every 200ms for smooth video
        
        return () => {
          clearTimeout(timeoutId);
          clearInterval(interval);
        };
      }
    }, [streamType, actualStreamUrl, error]);
    
    // Show loading state only if stream type not detected yet
    if (!streamType) {
      return (
        <div className="p-8 text-center text-white">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-sm">Detecting stream type...</p>
        </div>
      );
    }
    
    // Show loading overlay if still loading (but stream type is detected)
    // The actual stream component will handle its own loading state
    
    const handleError = (errorMsg) => {
      setError(errorMsg);
      setLoading(false);
      if (onError) onError(errorMsg);
      
      // Try fallback methods
      if (streamType === 'mjpeg' && streamUrl.match(/^https?:\/\/\d+\.\d+\.\d+\.\d+:\d+$/)) {
        // Try next video endpoint
        endpointIndex.current++;
        if (endpointIndex.current < videoEndpointsRef.current.length) {
          const baseUrl = streamUrl.replace(/\/$/, '');
          const endpoint = videoEndpointsRef.current[endpointIndex.current];
          setActualStreamUrl(`${baseUrl}${endpoint}`);
          setLoading(true);
          setError(null);
          retryCount.current = 0;
          return;
        }
      }
      
      if (retryCount.current < 3) {
        retryCount.current++;
        if (streamType === 'video') {
          // Try as MJPEG
          setStreamType('mjpeg');
          setActualStreamUrl(streamUrl);
          setLoading(true);
        } else if (streamType === 'mjpeg') {
          // Try as direct image
          setStreamType('image');
          setActualStreamUrl(streamUrl);
          setLoading(true);
        } else if (streamType === 'image') {
          // All methods failed
          setError('Unable to load video stream. The camera may be offline or the URL is incorrect.');
        }
      }
    };
    
    if (error && retryCount.current >= 2) {
      return (
        <div className="p-8 text-center text-white">
          <p className="text-lg mb-4">Unable to load stream</p>
          <p className="text-sm text-gray-400 mb-2">Stream URL: {streamUrl}</p>
          <p className="text-sm text-gray-400 mb-4">{error}</p>
          <button
            onClick={() => {
              setError(null);
              retryCount.current = 0;
              setLoading(true);
              // Reset to initial stream type detection
              if (streamUrl) {
                setStreamType(null);
              }
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      );
    }
    
    switch (streamType) {
      case 'rtsp':
        return (
          <div className="p-8 text-center text-white">
            <p className="text-lg mb-4">RTSP streams require a streaming server</p>
            <p className="text-sm text-gray-400 mb-4">Stream URL: {streamUrl}</p>
            <p className="text-sm text-gray-400">
              To view RTSP streams, you need to set up a streaming server (e.g., using VLC, FFmpeg, or a dedicated streaming service)
            </p>
          </div>
        );
      
      case 'image':
        return (
          <img 
            ref={imgRef}
            src={actualStreamUrl || streamUrl} 
            alt={cameraName}
            className="w-full h-auto max-h-[70vh] object-contain"
            onLoad={() => {
              setLoading(false);
              if (error) setError(null);
            }}
            onError={() => handleError('Failed to load image')}
          />
        );
      
      case 'mjpeg':
        return (
          <>
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center z-10 bg-black bg-opacity-75">
                <div className="text-center text-white">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
                  <p className="text-sm">Loading stream...</p>
                </div>
              </div>
            )}
            <img 
              ref={imgRef}
              src={actualStreamUrl || streamUrl}
              alt={cameraName}
              {...(useCrossOrigin ? { crossOrigin: 'anonymous' } : {})}
              className="w-full h-auto max-h-[70vh] object-contain"
              style={{ 
                minHeight: '400px', 
                display: 'block',
                backgroundColor: '#000000',
                width: '100%'
              }}
              onLoad={(e) => {
                setLoading(false);
                if (error) setError(null);
                // Ensure image is visible
                if (imgRef.current) {
                  imgRef.current.style.display = 'block';
                  imgRef.current.style.opacity = '1';
                  // Log successful load for debugging
                  console.log('MJPEG stream loaded successfully:', actualStreamUrl || streamUrl);
                }
              }}
              onError={(e) => {
                console.error('MJPEG stream error:', e, 'URL:', actualStreamUrl || streamUrl);
                // Try with cache busting first
                if (retryCount.current === 0) {
                  retryCount.current++;
                  const url = actualStreamUrl || streamUrl;
                  const timestamp = new Date().getTime();
                  e.target.src = `${url}${url.includes('?') ? '&' : '?'}t=${timestamp}`;
                } else if (retryCount.current === 1) {
                  // Try toggling crossOrigin
                  retryCount.current++;
                  setUseCrossOrigin(!useCrossOrigin);
                  const url = actualStreamUrl || streamUrl;
                  const timestamp = new Date().getTime();
                  e.target.src = `${url}${url.includes('?') ? '&' : '?'}t=${timestamp}`;
                } else if (retryCount.current === 2) {
                  // Try with different endpoint
                  retryCount.current++;
                  const baseUrl = (actualStreamUrl || streamUrl).replace(/\/video.*$/, '');
                  e.target.src = `${baseUrl}/mjpeg?t=${new Date().getTime()}`;
                } else {
                  handleError('MJPEG stream not accessible. Check if the camera is online and the URL is correct.');
                }
              }}
            />
          </>
        );
      
      case 'hls':
        return (
          <video
            ref={videoRef}
            src={actualStreamUrl || streamUrl}
            controls
            autoPlay
            muted
            className="w-full h-auto max-h-[70vh]"
            onLoadedData={() => setLoading(false)}
            onError={() => handleError('HLS stream not supported. Try using hls.js library.')}
          >
            Your browser does not support HLS streaming.
          </video>
        );
      
      case 'video':
      default:
        return (
          <video
            ref={videoRef}
            src={actualStreamUrl || streamUrl}
            autoPlay
            muted
            playsInline
            className="w-full h-auto max-h-[70vh]"
            onLoadedData={() => setLoading(false)}
            onError={(e) => {
              console.error('Video load error:', e);
              // Try MJPEG as fallback first
              if (retryCount.current === 0) {
                retryCount.current++;
                setStreamType('mjpeg');
                setActualStreamUrl(streamUrl);
                setLoading(true);
              } else {
                handleError('Unable to load video stream. The URL may be an MJPEG stream, require authentication, or the camera may be offline.');
              }
            }}
          >
            Your browser does not support the video tag.
          </video>
        );
    }
  };
  
  const loadCameras = async (checkStreamStatus = false) => {
    try {
      const response = await apiService.getCameras();
      const payload = response?.data || {};
      let camerasList = payload.cameras || [];
      const degraded = payload.degraded === true;

      setIsDegradedMode(degraded);
      if (degraded) {
        setError(payload.message || 'Live camera data is temporarily unavailable. Showing last available data if present.');
        if (camerasList.length === 0) {
          try {
            const cachedRaw = localStorage.getItem(CAMERA_CACHE_KEY);
            const cached = cachedRaw ? JSON.parse(cachedRaw) : [];
            if (Array.isArray(cached) && cached.length > 0) {
              camerasList = cached;
            }
          } catch (cacheReadErr) {
            console.warn('Failed to read camera cache:', cacheReadErr);
          }
        }
      } else {
        // Clear stale quota message once live data is available again.
        if (error) setError('');
      }
      
      // Normalize city names
      camerasList = camerasList.map(camera => ({
        ...camera,
        city: camera.city ? camera.city.trim().replace(/\w\S*/g, (w) => (w.replace(/^\w/, (c) => c.toUpperCase()))) : ''
      }));
      
      // Extract unique cities from cameras
      const uniqueCities = [...new Set(
        camerasList
          .map(camera => camera.city)
          .filter(city => city && city !== '')
      )].sort();
      
      setCities(uniqueCities);
      
      // If checkStreamStatus is true, check each camera's status dynamically
      if (checkStreamStatus && !degraded) {
        const statusPromises = camerasList.map(async (camera) => {
          if (camera.stream_url) {
            try {
              const statusResponse = await apiService.getCameraStatus(camera.id, true);
              return statusResponse.data.camera || camera;
            } catch (error) {
              console.error(`Error checking status for camera ${camera.id}:`, error);
              return camera;
            }
          }
          return camera;
        });
        camerasList = await Promise.all(statusPromises);
      }
      
      setCameras(camerasList);
      if (!degraded) {
        try {
          localStorage.setItem(CAMERA_CACHE_KEY, JSON.stringify(camerasList));
        } catch (cacheWriteErr) {
          console.warn('Failed to write camera cache:', cacheWriteErr);
        }
      }
    } catch (error) {
      console.error('Error loading cameras:', error);
      setIsDegradedMode(true);
      setError('Unable to load live camera data right now. Please try again in a moment.');
    } finally {
      setLoading(false);
    }
  };
  
  const checkCameraStatus = async (cameraId) => {
    setCheckingStatus(prev => ({ ...prev, [cameraId]: true }));
    try {
      const response = await apiService.checkCameraStatus(cameraId);
      if (!response.data.success) {
        setError('Failed to check camera status. Please try again.');
      }
    } catch (error) {
      console.error('Error checking camera status:', error);
      alert(error.response?.data?.error || 'Failed to check camera status');
    } finally {
      setCheckingStatus(prev => ({ ...prev, [cameraId]: false }));
    }
  };
  
  const checkAllStatuses = async () => {
    setRefreshingAll(true);
    setError('');
    try {
      const response = await apiService.checkAllCameraStatus();
      if (response.data.success) {
        const results = response.data.results || {};
        // Show success message with summary
        const message = `Status check completed: ${results.active || 0} active, ${results.inactive || 0} inactive, ${results.checked || 0} checked`;
        console.log(message);
        // Optionally show a toast notification here if you have a toast system
      } else {
        setError('Failed to refresh camera statuses. Please try again.');
      }
    } catch (error) {
      console.error('Error checking all camera statuses:', error);
      const errorMessage = error.response?.data?.error || 'Failed to refresh camera statuses. Please check your connection and try again.';
      setError(errorMessage);
    } finally {
      setRefreshingAll(false);
    }
  };
  
  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    
    try {
      // Clean and prepare form data
      const dataToSend = {
        name: formData.name.trim(),
        location_name: formData.location_name.trim(),
        city: formData.city.trim(),
        ip_address: formData.ip_address.trim(),
        stream_url: formData.stream_url.trim()
      };
      
      if (formData.latitude !== '') {
        const lat = parseFloat(formData.latitude);
        if (!Number.isNaN(lat)) dataToSend.latitude = lat;
      }
      if (formData.longitude !== '') {
        const lng = parseFloat(formData.longitude);
        if (!Number.isNaN(lng)) dataToSend.longitude = lng;
      }
      
      // If IP address looks like a URL, move it to stream_url
      if (dataToSend.ip_address && (dataToSend.ip_address.startsWith('http://') || dataToSend.ip_address.startsWith('https://'))) {
        if (!dataToSend.stream_url) {
          dataToSend.stream_url = dataToSend.ip_address;
        }
        dataToSend.ip_address = '';
      }
      
      // Validate required fields
      if (!dataToSend.name) {
        setError('Camera name is required');
        setSubmitting(false);
        return;
      }
      if (!dataToSend.location_name) {
        setError('Location name is required');
        setSubmitting(false);
        return;
      }
      if (!dataToSend.city) {
        setError('City is required');
        setSubmitting(false);
        return;
      }
      
      // Check if we're editing an existing camera or adding a new one
      let response;
      if (editingId) {
        // Update existing camera
        response = await apiService.updateCamera(editingId, dataToSend);
      } else {
        // Add new camera
        response = await apiService.addCamera(dataToSend);
      }
      
      // Success - axios treats 2xx status codes as success
      // Store camera location for zooming
      if (dataToSend.latitude && dataToSend.longitude) {
        setCameraToZoom({
          latitude: dataToSend.latitude,
          longitude: dataToSend.longitude
        });
      }
      
      // Close form and refresh list
      setShowAddForm(false);
      setEditingId(null);
      setFormData({
        name: '',
        ip_address: '',
        stream_url: '',
        location_name: '',
        city: '',
        latitude: '',
        longitude: ''
      });
      
      // Clear cameraToZoom after a delay to allow map to zoom
      setTimeout(() => {
        setCameraToZoom(null);
      }, 2000);
    } catch (error) {
      console.error(editingId ? 'Update camera error:' : 'Add camera error:', error);
      
      // Handle different error types
      let errorMessage = editingId ? 'Failed to update camera' : 'Failed to add camera';
      
      if (error.response) {
        // Server responded with error status
        errorMessage = error.response.data?.error || error.response.data?.message || `Server error: ${error.response.status}`;
      } else if (error.request) {
        // Request was made but no response received
        errorMessage = 'Network Error: Could not connect to server. Please check if the backend server is running.';
      } else {
        // Something else happened
        errorMessage = error.message || errorMessage;
      }
      
      setError(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };
  
  const handleEdit = (camera) => {
    setFormData({
      name: camera.name || '',
      ip_address: camera.ip_address || '',
      stream_url: camera.stream_url || '',
      location_name: camera.location_name || '',
      city: camera.city || '',
      latitude: camera.latitude || '',
      longitude: camera.longitude || ''
    });
    setEditingId(camera.id);
    setShowAddForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this camera?')) {
      return;
    }
    
    try {
      await apiService.deleteCamera(id);
    } catch (error) {
      console.error('Error deleting camera:', error);
      const errorMessage =
        error.response?.data?.error ||
        error.response?.data?.message ||
        'Failed to delete camera. Please try again.';
      setError(errorMessage);
    }
  };
  
  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      {error && !showAddForm && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => setError('')}
            className="text-red-700 hover:text-red-900 font-bold"
          >
            ×
          </button>
        </div>
      )}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">CCTV Management</h2>
        <div className="flex gap-2">
          <button
            onClick={checkAllStatuses}
            disabled={refreshingAll}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            title="Check and refresh status for all cameras"
          >
            {refreshingAll ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>Refreshing...</span>
              </>
            ) : (
              <span>Refresh Camera Status</span>
            )}
          </button>
          <button
            onClick={() => {
              setShowAddForm(!showAddForm);
              if (showAddForm) {
                setEditingId(null);
                setFormData({
                  name: '',
                  ip_address: '',
                  stream_url: '',
                  location_name: '',
                  city: '',
                  latitude: '',
                  longitude: ''
                });
              }
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            {showAddForm ? 'Cancel' : '+ Add Camera'}
          </button>
        </div>
      </div>
      
      {showAddForm && (
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h3 className="text-xl font-semibold mb-4">{editingId ? 'Edit Camera' : 'Add New Camera'}</h3>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Camera Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  City <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="city"
                  value={formData.city}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Location Name (street name) <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="location_name"
                value={formData.location_name}
                onChange={handleChange}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Latitude <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="any"
                  name="latitude"
                  value={formData.latitude}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Longitude <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="any"
                  name="longitude"
                  value={formData.longitude}
                  onChange={handleChange}
                  required
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Stream URL
              </label>
              <input
                type="text"
                name="stream_url"
                value={formData.stream_url}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting 
                ? (editingId ? 'Updating Camera...' : 'Adding Camera...') 
                : (editingId ? 'Update Camera' : 'Add Camera')}
            </button>
          </form>
        </div>
      )}
      
      {/* Video Viewer Modal */}
      {viewingCamera && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4"
          style={{ zIndex: 9999 }}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-auto"
            style={{ zIndex: 10000, position: 'relative' }}
          >
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-2xl font-bold">{viewingCamera.name || 'Unnamed Camera'}</h3>
                  <p className="text-sm text-gray-600">
                    {[viewingCamera.location_name, viewingCamera.city].filter(Boolean).join(', ') || 'No location'}
                  </p>
                </div>
                <button
                  onClick={() => setViewingCamera(null)}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                >
                  Close
                </button>
              </div>
              
              {viewingCamera.stream_url ? (
                <div className="space-y-4">
                  <div className="bg-black rounded-lg overflow-hidden flex items-center justify-center relative" style={{ minHeight: '500px', width: '100%' }}>
                    <StreamPlayer 
                      streamUrl={viewingCamera.stream_url}
                      cameraName={viewingCamera.name}
                      onError={(error) => {
                        setStreamErrors(prev => ({ ...prev, [viewingCamera.id]: error }));
                      }}
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="font-medium">Stream URL:</span>
                      <p className="text-gray-600 break-all">{viewingCamera.stream_url}</p>
                    </div>
                    {viewingCamera.ip_address && (
                      <div>
                        <span className="font-medium">IP Address:</span>
                        <p className="text-gray-600">{viewingCamera.ip_address}</p>
                      </div>
                    )}
                    <div>
                      <span className="font-medium">Status:</span>
                      <span className={`ml-2 font-bold ${
                        viewingCamera.status === 'active' ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {viewingCamera.status}
                      </span>
                    </div>
                    <div>
                      <span className="font-medium">Crowd Level:</span>
                      {viewingCamera.status === 'active' ? (
                        <span className={`ml-2 font-bold ${
                          viewingCamera.crowd_level === 'critical' ? 'text-red-600' :
                          viewingCamera.crowd_level === 'high' ? 'text-orange-600' :
                          viewingCamera.crowd_level === 'medium' ? 'text-yellow-600' :
                          'text-green-600'
                        }`}>
                          {viewingCamera.crowd_level || 'low'}
                        </span>
                      ) : (
                        <span className="ml-2 font-bold text-gray-500">
                          N/A (Stream Offline)
                        </span>
                      )}
                    </div>
                    {viewingCamera.status === 'active' && (
                      <div>
                        <span className="font-medium">People Count:</span>
                        <span className="ml-2 font-bold text-gray-700">
                          {viewingCamera.count || 0}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-8 text-center text-gray-600">
                  <p className="text-lg mb-2">No stream URL configured for this camera</p>
                  <p className="text-sm">Please add a stream URL to view the camera feed</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* Grid View */}
      {gridView && selectedCameras.length > 0 && (
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-semibold">
              Multi-Camera View ({selectedCameras.length} camera{selectedCameras.length !== 1 ? 's' : ''})
            </h3>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setSelectedCameras(cameras.filter(c => c.stream_url && c.status === 'active'));
                }}
                className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
              >
                Select All Active
              </button>
              <button
                onClick={() => {
                  setGridView(false);
                }}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                Hide Grid View
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {selectedCameras.map((camera) => (
              <div key={camera.id} className="border rounded-lg overflow-hidden">
                <div className="bg-gray-800 p-2">
                  <h4 className="text-white text-sm font-semibold truncate">{camera.name || 'Unnamed Camera'}</h4>
                  <p className="text-gray-400 text-xs truncate">{camera.location_name || 'No location'}</p>
                </div>
                <div className="bg-black aspect-video flex items-center justify-center relative">
                  {camera.stream_url ? (
                    camera.stream_url.startsWith('rtsp://') ? (
                      <div className="text-white text-center p-4">
                        <p className="text-sm">RTSP stream</p>
                        <p className="text-xs text-gray-400 mt-2">Requires streaming server</p>
                      </div>
                    ) : camera.stream_url.match(/\.(jpg|jpeg|png|gif)$/i) ? (
                      <img 
                        src={camera.stream_url} 
                        alt={camera.name}
                        className="w-full h-full object-contain"
                        onError={(e) => {
                          e.target.style.display = 'none';
                          e.target.parentElement.innerHTML = '<div class="text-white text-center p-4"><p class="text-sm">Unable to load image</p></div>';
                        }}
                      />
                    ) : (camera.stream_url.includes('/mjpeg') || camera.stream_url.includes('/video') || camera.stream_url.match(/:\d+$/)) ? (
                      <GridStreamImage streamUrl={camera.stream_url} cameraName={camera.name} />
                    ) : (
                      <video
                        src={camera.stream_url}
                        controls
                        autoPlay
                        muted
                        playsInline
                        className="w-full h-full object-contain"
                        onError={(e) => {
                          // Try as MJPEG fallback
                          const img = document.createElement('img');
                          img.src = camera.stream_url;
                          img.className = 'w-full h-full object-contain';
                          img.alt = camera.name;
                          img.onerror = () => {
                            img.style.display = 'none';
                            const errorDiv = document.createElement('div');
                            errorDiv.className = 'text-white text-center p-4';
                            errorDiv.innerHTML = '<p class="text-sm">Stream unavailable</p>';
                            e.target.parentElement.appendChild(errorDiv);
                          };
                          e.target.parentElement.replaceChild(img, e.target);
                        }}
                      />
                    )
                  ) : (
                    <div className="text-white text-center p-4">
                      <p className="text-sm">No stream URL</p>
                    </div>
                  )}
                </div>
                <div className="p-2 bg-gray-100">
                  <div className="flex justify-between items-center text-xs">
                    <span className={`font-bold ${
                      camera.crowd_level === 'critical' ? 'text-red-600' :
                      camera.crowd_level === 'high' ? 'text-orange-600' :
                      camera.crowd_level === 'medium' ? 'text-yellow-600' :
                      'text-green-600'
                    }`}>
                      {camera.crowd_level}
                    </span>
                    <span className={`font-bold ${
                      camera.status === 'active' ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {camera.status}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Cameras List */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-semibold">All Cameras</h3>
          <div className="flex gap-2 items-center">
            {cameras.filter(c => c.stream_url).length > 0 && (
              <>
                {selectedCameras.length > 0 && (
                  <button
                    onClick={() => setGridView(!gridView)}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  >
                    {gridView ? 'Hide Grid View' : `Show Grid View (${selectedCameras.length})`}
                  </button>
                )}
                <div className="relative" ref={cityDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setCityDropdownOpen(!cityDropdownOpen)}
                    disabled={cities.length === 0}
                    className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed min-w-[180px] justify-between shadow-sm"
                  >
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-gray-500" />
                      <span className="text-sm font-medium text-gray-700">
                        {selectedCity || 'All Cities'}
                      </span>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${cityDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {cityDropdownOpen && cities.length > 0 && (
                    <div className="absolute top-full left-0 mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-80 overflow-hidden flex flex-col">
                      <div className="p-2 border-b border-gray-200">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            type="text"
                            placeholder="Search cities..."
                            value={citySearchQuery}
                            onChange={(e) => setCitySearchQuery(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            autoFocus
                          />
                        </div>
                      </div>
                      <div className="overflow-y-auto max-h-64">
                        <button
                          onClick={() => {
                            setSelectedCity('');
                            setCityDropdownOpen(false);
                            setCitySearchQuery('');
                          }}
                          className={`w-full px-4 py-2.5 text-left text-sm hover:bg-blue-50 transition-colors flex items-center justify-between ${
                            selectedCity === '' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4" />
                            <span>All Cities</span>
                          </div>
                          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">({cameras.length})</span>
                        </button>
                        {cities
                          .filter(city => 
                            city.toLowerCase().includes(citySearchQuery.toLowerCase())
                          )
                          .map(city => {
                            const cityCameraCount = cameras.filter(c => 
                              c.city && c.city.trim().toLowerCase() === city.trim().toLowerCase()
                            ).length;
                            return (
                              <button
                                key={city}
                                onClick={() => {
                                  setSelectedCity(city);
                                  setCityDropdownOpen(false);
                                  setCitySearchQuery('');
                                }}
                                className={`w-full px-4 py-2.5 text-left text-sm hover:bg-blue-50 transition-colors flex items-center justify-between ${
                                  selectedCity === city ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700'
                                }`}
                              >
                                <div className="flex items-center gap-2">
                                  <MapPin className="w-4 h-4" />
                                  <span>{city}</span>
                                </div>
                                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">({cityCameraCount})</span>
                              </button>
                            );
                          })}
                        {cities.filter(city => 
                          city.toLowerCase().includes(citySearchQuery.toLowerCase())
                        ).length === 0 && (
                          <div className="px-4 py-8 text-center text-gray-500 text-sm">
                            No cities found
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
          {(selectedCity 
            ? cameras.filter(c => c.city && c.city.trim().toLowerCase() === selectedCity.trim().toLowerCase())
            : cameras
          ).map((camera) => (
            <div key={camera.id} className="border rounded-lg p-4">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <h4 className="font-semibold text-lg">{camera.name || 'Unnamed Camera'}</h4>
                  <p className="text-sm text-gray-600">
                    {[camera.location_name, camera.city].filter(Boolean).join(', ') || 'No location'}
                  </p>
                  <p className="text-sm mt-2">
                    <span className="font-medium">Status:</span>{' '}
                    <span className={`font-bold ${
                      camera.status === 'active' ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {camera.status || 'unknown'}
                    </span>
                    {camera.last_error && (
                      <span className="text-xs text-red-500 ml-2" title={camera.last_error}>
                        (Error)
                      </span>
                    )}
                    {' | '}
                    <span className="font-medium">Crowd Level:</span>{' '}
                    {camera.status === 'active' ? (
                      <span className={`font-bold ${
                        camera.crowd_level === 'critical' ? 'text-red-600' :
                        camera.crowd_level === 'high' ? 'text-orange-600' :
                        camera.crowd_level === 'medium' ? 'text-yellow-600' :
                        'text-green-600'
                      }`}>
                        {(camera.crowd_level || 'low')}
                      </span>
                    ) : (
                      <span className="font-bold text-gray-500">
                        N/A (Stream Inactive/Offline)
                      </span>
                    )}
                  </p>
                  {camera.stream_url && (
                    <p className="text-xs text-gray-500 mt-1 truncate">
                      Stream: {camera.stream_url}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 ml-4 flex-wrap">
                  {camera.stream_url && (
                    <>
                      <button
                        onClick={() => setViewingCamera(camera)}
                        className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                      >
                        View Stream
                      </button>
                      <button
                        onClick={() => checkCameraStatus(camera.id)}
                        disabled={checkingStatus[camera.id]}
                        className="px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Check if stream is currently accessible"
                      >
                        {checkingStatus[camera.id] ? 'Checking...' : 'Check Status'}
                      </button>
                      {!selectedCameras.find(c => c.id === camera.id) ? (
                        <button
                          onClick={() => setSelectedCameras([...selectedCameras, camera])}
                          className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-sm"
                        >
                          Add to Grid
                        </button>
                      ) : (
                        <button
                          onClick={() => setSelectedCameras(selectedCameras.filter(c => c.id !== camera.id))}
                          className="px-3 py-1 bg-yellow-600 text-white rounded hover:bg-yellow-700 text-sm"
                        >
                          Remove
                        </button>
                      )}
                    </>
                  )}
                  <button
                    onClick={() => handleEdit(camera)}
                    className="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(camera.id)}
                    className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
          {(selectedCity
            ? cameras.filter(c => c.city && c.city.trim().toLowerCase() === selectedCity.trim().toLowerCase())
            : cameras
          ).length === 0 && (
            <div className="border border-dashed rounded-lg p-6 text-center text-gray-600">
              {isDegradedMode
                ? 'Camera data is temporarily unavailable due to Firebase quota limits. Please retry after some time.'
                : 'No cameras found. Add a camera to start monitoring.'}
            </div>
          )}
        </div>
      </div>
      
      {/* Cameras Map - Only show if cameras have coordinates */}
      {(() => {
        // Filter cameras by selected city for map
        const camerasForMap = selectedCity 
          ? cameras.filter(c => c.city && c.city.trim().toLowerCase() === selectedCity.trim().toLowerCase())
          : cameras;
        
        return camerasForMap.some(c => c.latitude && c.longitude) && !viewingCamera && (
          <div className="bg-white rounded-lg shadow-lg p-6 relative z-0">
            <h3 className="text-xl font-semibold mb-4">Camera Locations</h3>
            <div style={mapContainerStyle} className="relative z-0">
              <MapContainer
                center={
                  (() => {
                    if (!camerasForMap || !Array.isArray(camerasForMap)) {
                      return [20.0, 77.0];
                    }
                    const validCameras = camerasForMap.filter(c => 
                      c && 
                      typeof c.latitude === 'number' && 
                      typeof c.longitude === 'number' &&
                      !isNaN(c.latitude) && 
                      !isNaN(c.longitude) &&
                      c.latitude >= -90 && c.latitude <= 90 &&
                      c.longitude >= -180 && c.longitude <= 180
                    );
                    if (validCameras.length === 0) {
                      return [20.0, 77.0]; // Neutral center if no cameras
                    }
                    // Calculate center from all cameras
                    const avgLat = validCameras.reduce((sum, c) => sum + c.latitude, 0) / validCameras.length;
                    const avgLng = validCameras.reduce((sum, c) => sum + c.longitude, 0) / validCameras.length;
                    // Validate calculated center
                    if (isNaN(avgLat) || isNaN(avgLng)) {
                      return [20.0, 77.0];
                    }
                    return [avgLat, avgLng];
                  })()
                }
                zoom={camerasForMap.filter(c => c.latitude && c.longitude).length > 0 ? 8 : 5}
                style={{ height: '100%', width: '100%', position: 'relative', zIndex: 0 }}
                key={selectedCity} // Force re-render when city changes
              >
                <TileLayer
                  attribution="&copy; OpenStreetMap contributors"
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapController cameraToZoom={cameraToZoom} camerasForMap={camerasForMap} />
                {camerasForMap.filter(c => c.latitude && c.longitude).map((camera) => (
                  <Marker
                    key={camera.id}
                    position={[camera.latitude, camera.longitude]}
                  >
                    <Popup>
                      <div>
                        <div className="font-semibold">{camera.name || 'Unnamed Camera'}</div>
                        <div className="text-sm text-gray-600">
                          {[camera.location_name, camera.city].filter(Boolean).join(', ') || 'No location'}
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
