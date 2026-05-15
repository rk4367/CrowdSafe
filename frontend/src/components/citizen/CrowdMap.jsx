/**
 * Crowd Map Component
 * Displays a map with crowd density markers
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { LatLngBounds } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { formatToIST } from '../../utils/time';

const mapContainerStyle = {
  width: '100%',
  height: '600px'
};

// Enforced global standard: display everything in IST
const FORCE_TIMEZONE = 'Asia/Kolkata';

// Get timezone based on camera location
const getTimezoneForLocation = (camera) => {
  // If a forced timezone is configured, use it for all cameras
  if (FORCE_TIMEZONE) {
    return FORCE_TIMEZONE;
  }
  // Common timezone mappings for major cities/countries
  const timezoneMap = {
    // India
    'mumbai': 'Asia/Kolkata',
    'delhi': 'Asia/Kolkata',
    'bangalore': 'Asia/Kolkata',
    'kolkata': 'Asia/Kolkata',
    'chennai': 'Asia/Kolkata',
    'hyderabad': 'Asia/Kolkata',
    'pune': 'Asia/Kolkata',
    'ahmedabad': 'Asia/Kolkata',
    'jaipur': 'Asia/Kolkata',
    'surat': 'Asia/Kolkata',
    'lucknow': 'Asia/Kolkata',
    'kanpur': 'Asia/Kolkata',
    'nagpur': 'Asia/Kolkata',
    'indore': 'Asia/Kolkata',
    'thane': 'Asia/Kolkata',
    'bhopal': 'Asia/Kolkata',
    'visakhapatnam': 'Asia/Kolkata',
    'patna': 'Asia/Kolkata',
    'vadodara': 'Asia/Kolkata',
    'ghaziabad': 'Asia/Kolkata',
    'ludhiana': 'Asia/Kolkata',
    'agra': 'Asia/Kolkata',
    'nashik': 'Asia/Kolkata',
    'faridabad': 'Asia/Kolkata',
    'meerut': 'Asia/Kolkata',
    'rajkot': 'Asia/Kolkata',
    'varanasi': 'Asia/Kolkata',
    'srinagar': 'Asia/Kolkata',
    'amritsar': 'Asia/Kolkata',
    'new delhi': 'Asia/Kolkata',
    'calcutta': 'Asia/Kolkata',
    'bombay': 'Asia/Kolkata',
    'madras': 'Asia/Kolkata',
    // Russia
    'moscow': 'Europe/Moscow',
    'saint petersburg': 'Europe/Moscow',
    'novosibirsk': 'Asia/Novosibirsk',
    'yekaterinburg': 'Asia/Yekaterinburg',
    'kazan': 'Europe/Moscow',
    'nizhny novgorod': 'Europe/Moscow',
    'chelyabinsk': 'Asia/Yekaterinburg',
    'omsk': 'Asia/Omsk',
    'samara': 'Europe/Samara',
    'rostov-on-don': 'Europe/Moscow',
    'ufa': 'Asia/Yekaterinburg',
    'krasnoyarsk': 'Asia/Krasnoyarsk',
    'voronezh': 'Europe/Moscow',
    'perm': 'Asia/Yekaterinburg',
    'volgograd': 'Europe/Volgograd',
    // USA
    'new york': 'America/New_York',
    'los angeles': 'America/Los_Angeles',
    'chicago': 'America/Chicago',
    'houston': 'America/Chicago',
    'phoenix': 'America/Phoenix',
    'philadelphia': 'America/New_York',
    'san antonio': 'America/Chicago',
    'san diego': 'America/Los_Angeles',
    'dallas': 'America/Chicago',
    'san jose': 'America/Los_Angeles',
    // UK
    'london': 'Europe/London',
    'birmingham': 'Europe/London',
    'manchester': 'Europe/London',
    'glasgow': 'Europe/London',
    'liverpool': 'Europe/London',
    // China
    'beijing': 'Asia/Shanghai',
    'shanghai': 'Asia/Shanghai',
    'guangzhou': 'Asia/Shanghai',
    'shenzhen': 'Asia/Shanghai',
    'chengdu': 'Asia/Shanghai',
    // Japan
    'tokyo': 'Asia/Tokyo',
    'osaka': 'Asia/Tokyo',
    'yokohama': 'Asia/Tokyo',
    // Australia
    'sydney': 'Australia/Sydney',
    'melbourne': 'Australia/Melbourne',
    'brisbane': 'Australia/Brisbane',
    // Germany
    'berlin': 'Europe/Berlin',
    'munich': 'Europe/Berlin',
    'hamburg': 'Europe/Berlin',
    // France
    'paris': 'Europe/Paris',
    'lyon': 'Europe/Paris',
    'marseille': 'Europe/Paris',
    // Canada
    'toronto': 'America/Toronto',
    'vancouver': 'America/Vancouver',
    'montreal': 'America/Toronto',
  };

  // Try to get timezone from city name
  if (camera.city) {
    const cityKey = camera.city.toLowerCase().trim();
    if (timezoneMap[cityKey]) {
      return timezoneMap[cityKey];
    }
  }

  // Estimate timezone from longitude (rough approximation)
  // Each 15 degrees of longitude ≈ 1 hour time difference
  if (camera.longitude !== undefined && camera.longitude !== null) {
    const lng = camera.longitude;
    // UTC offset estimation based on longitude
    const offsetHours = Math.round(lng / 15);
    
    // Common timezone offsets (simplified)
    if (offsetHours >= 5 && offsetHours <= 6) {
      return 'Asia/Kolkata'; // India
    } else if (offsetHours >= 2 && offsetHours <= 4) {
      return 'Europe/Moscow'; // Russia (Moscow time)
    } else if (offsetHours >= 7 && offsetHours <= 9) {
      return 'Asia/Shanghai'; // China
    } else if (offsetHours >= 9 && offsetHours <= 10) {
      return 'Asia/Tokyo'; // Japan
    } else if (offsetHours >= -5 && offsetHours <= -4) {
      return 'America/New_York'; // US East
    } else if (offsetHours >= -8 && offsetHours <= -7) {
      return 'America/Los_Angeles'; // US West
    } else if (offsetHours >= 0 && offsetHours <= 1) {
      return 'Europe/London'; // UK
    }
  }

  // Default fallback
  return FORCE_TIMEZONE || 'UTC';
};

// Format date according to location timezone
const formatDateForLocation = (dateValue, camera) => {
  if (!dateValue) return 'Never';
  return formatToIST(dateValue) || 'Unknown';
};

// Calculate default center dynamically from cameras, or use a neutral center
const getDefaultCenter = (cameras) => {
  if (!cameras || !Array.isArray(cameras)) {
    return { lat: 20.0, lng: 77.0 };
  }
  
  const validCameras = cameras.filter(
    camera => camera && 
    typeof camera.latitude === 'number' && 
    typeof camera.longitude === 'number' &&
    !isNaN(camera.latitude) && 
    !isNaN(camera.longitude) &&
    camera.latitude >= -90 && camera.latitude <= 90 &&
    camera.longitude >= -180 && camera.longitude <= 180
  );
  
  if (validCameras.length === 0) {
    // No cameras - use a neutral center (world center)
    return { lat: 20.0, lng: 77.0 };
  }
  
  // Calculate center from all cameras
  const avgLat = validCameras.reduce((sum, c) => sum + c.latitude, 0) / validCameras.length;
  const avgLng = validCameras.reduce((sum, c) => sum + c.longitude, 0) / validCameras.length;
  
  // Validate calculated center
  if (isNaN(avgLat) || isNaN(avgLng)) {
    return { lat: 20.0, lng: 77.0 };
  }
  
  return { lat: avgLat, lng: avgLng };
};

// Component to control map view based on selected city
function MapController({ cameras, selectedCity }) {
  const map = useMap();
  const prevSelectedCityRef = useRef(selectedCity);
  const prevCamerasLengthRef = useRef(cameras.length);
  const hasInitializedRef = useRef(false);
  
  useEffect(() => {
    // Validate cameras array
    if (!cameras || !Array.isArray(cameras)) {
      map.setView([20.0, 77.0], 5);
      return;
    }
    
    // Get cameras with valid coordinates
    const validCameras = cameras.filter(
      camera => camera && 
      typeof camera.latitude === 'number' && 
      typeof camera.longitude === 'number' &&
      !isNaN(camera.latitude) && 
      !isNaN(camera.longitude) &&
      camera.latitude >= -90 && camera.latitude <= 90 &&
      camera.longitude >= -180 && camera.longitude <= 180
    );
    
    // Check if this is the first time we have cameras
    const isFirstLoad = !hasInitializedRef.current && validCameras.length > 0;
    
    // On initial mount, wait for cameras to load before updating map
    if (!hasInitializedRef.current) {
      if (validCameras.length > 0) {
        hasInitializedRef.current = true;
        // Don't set prev values yet - we want to trigger the map update
      } else {
        // No cameras yet, skip update
        return;
      }
    }
    
    // Only update map if city selection changed, cameras were added/removed, or this is first load
    const cityChanged = prevSelectedCityRef.current !== selectedCity;
    const camerasChanged = prevCamerasLengthRef.current !== cameras.length;
    
    if (!cityChanged && !camerasChanged && !isFirstLoad) {
      return; // Skip update if nothing relevant changed
    }
    
    // Update prev values after checking
    prevSelectedCityRef.current = selectedCity;
    prevCamerasLengthRef.current = cameras.length;
    
    if (validCameras.length === 0) {
      // No cameras with valid coordinates, use neutral default view
      map.setView([20.0, 77.0], 5);
      return;
    }
    
    // Filter cameras by selected city (if a city is selected)
    // When "All Cities" is selected (empty string), show all cameras
    let camerasToShow = validCameras;
    if (selectedCity && selectedCity.trim() !== '') {
      camerasToShow = validCameras.filter(
        camera => camera.city && 
        camera.city.trim().toLowerCase() === selectedCity.trim().toLowerCase()
      );
    }
    
    if (camerasToShow.length === 0) {
      // No cameras for this city, use neutral default view
      map.setView([20.0, 77.0], 5);
      return;
    }
    
    // Calculate bounds from cameras
    const bounds = new LatLngBounds(
      camerasToShow.map(camera => [camera.latitude, camera.longitude])
    );
    
    // Handle single camera case - zoom to appropriate level
    if (camerasToShow.length === 1) {
      const camera = camerasToShow[0];
      map.flyTo([camera.latitude, camera.longitude], 15, {
        duration: 1.5
      });
      return;
    }
    
    // Fit map to bounds with padding
    // When "All Cities" is selected, use a wider zoom level
    const isAllCities = !selectedCity || selectedCity.trim() === '';
    map.flyToBounds(bounds, {
      padding: [50, 50],
      maxZoom: isAllCities ? 12 : 15,
      duration: 1.5
    });
  }, [map, cameras, selectedCity]);
  
  return null;
}

export default function CrowdMap({ minimal = false, selectedCity = '', cameras = [] }) {
  const [selectedCamera, setSelectedCamera] = useState(null);
  const [mapsError] = useState(null);
  
  // Calculate dynamic center from cameras
  const mapCenter = useMemo(() => {
    return getDefaultCenter(cameras);
  }, [cameras]);
  
  const getCrowdColor = (level) => {
    switch (level) {
      case 'low': return '🟢';
      case 'medium': return '🟡';
      case 'high': return '🟠';
      case 'critical': return '🔴';
      default: return '⚪';
    }
  };
  
  const getMarkerColor = (level, status) => {
    // If camera is inactive, show gray color
    if (status === 'inactive') {
      return '#6B7280'; // gray for inactive
    }
    switch (level) {
      case 'low': return '#10B981'; // green
      case 'medium': return '#F59E0B'; // yellow
      case 'high': return '#F97316'; // orange
      case 'critical': return '#EF4444'; // red
      default: return '#6B7280'; // gray
    }
  };

  // Filter cameras by selected city
  const filteredCameras = useMemo(() => {
    if (!selectedCity || selectedCity.trim() === '') {
      return cameras;
    }
    return cameras.filter(
      camera => camera.city && 
      camera.city.trim().toLowerCase() === selectedCity.trim().toLowerCase()
    );
  }, [cameras, selectedCity]);
  
  if (minimal) {
    return (
      <div className="relative w-full h-full">
        {mapsError && (
          <div className="absolute top-4 left-4 right-4 z-[1000] bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {mapsError}
          </div>
        )}
        
        <MapContainer 
          center={[mapCenter.lat, mapCenter.lng]} 
          zoom={cameras.length > 0 ? 10 : 5} 
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapController cameras={cameras} selectedCity={selectedCity} />
          
          {filteredCameras.filter(camera => 
            camera && 
            typeof camera.latitude === 'number' && 
            typeof camera.longitude === 'number' &&
            !isNaN(camera.latitude) && 
            !isNaN(camera.longitude)
          ).map((camera) => (
            <CircleMarker
              key={camera.id}
              center={[camera.latitude, camera.longitude]}
              radius={10}
              pathOptions={{
                color: '#FFFFFF',
                weight: 2,
                fillColor: getMarkerColor(camera.crowd_level, camera.status),
                fillOpacity: camera.status === 'inactive' ? 0.5 : 0.8
              }}
              eventHandlers={{
                click: () => setSelectedCamera(camera)
              }}
            >
              <Popup>
                <div className="p-1">
                  <h3 className="font-bold text-sm mb-1">{camera.name || 'Unnamed Camera'}</h3>
                  {camera.city && (
                    <p className="text-xs text-gray-600 mb-0.5">
                      <span className="font-medium">City:</span> {camera.city}
                    </p>
                  )}
                  {camera.location_name && (
                    <p className="text-xs text-gray-600 mb-0.5">
                      <span className="font-medium">Location:</span> {camera.location_name}
                    </p>
                  )}
                  <p className="text-xs mb-0.5">
                    <span className="font-medium">Status:</span>{' '}
                    <span className={`font-bold ${
                      camera.status === 'active' ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {camera.status === 'active' ? '🟢 Active' : '🔴 Inactive/Offline'}
                    </span>
                  </p>
                  {camera.status === 'active' ? (
                    <>
                      <p className="text-xs mb-0.5">
                        <span className="font-medium">Crowd Level:</span>{' '}
                        <span className={`font-bold ${
                          camera.crowd_level === 'critical' ? 'text-red-600' :
                          camera.crowd_level === 'high' ? 'text-orange-600' :
                          camera.crowd_level === 'medium' ? 'text-yellow-600' :
                          'text-green-600'
                        }`}>
                          {getCrowdColor(camera.crowd_level)} {(camera.crowd_level || 'low').toUpperCase()}
                        </span>
                      </p>
                      <p className="text-xs">
                        <span className="font-medium">Count:</span> {camera.count || 0} people
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-red-600 font-medium">
                      Stream is offline. Crowd data unavailable.
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    <span className="font-medium">Last updated:</span> {formatToIST(camera.last_updated)}
                  </p>
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>

        {/* Floating Legend */}
        <div className="absolute bottom-6 left-6 bg-white p-4 rounded-lg shadow-lg z-[999] min-w-[150px] border border-gray-100">
          <h4 className="font-bold text-gray-800 mb-3 uppercase text-xs tracking-wider">Crowd Density</h4>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-[#10B981] shadow-sm"></div>
              <span className="text-xs text-gray-700 font-medium">Low Density</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-[#F59E0B] shadow-sm"></div>
              <span className="text-xs text-gray-700 font-medium">Moderate</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-[#F97316] shadow-sm"></div>
              <span className="text-xs text-gray-700 font-medium">High Density</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-[#EF4444] shadow-sm"></div>
              <span className="text-xs text-gray-700 font-medium">Critical</span>
            </div>
          </div>
        </div>
      </div>
    );
  }
    
  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-2xl font-bold mb-4">Live Crowd Map</h2>
      
      {mapsError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {mapsError}
        </div>
      )}
      
      <div style={mapContainerStyle}>
        <MapContainer 
          center={[mapCenter.lat, mapCenter.lng]} 
          zoom={cameras.length > 0 ? 10 : 5} 
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapController cameras={cameras} selectedCity={selectedCity} />
          
          {filteredCameras.filter(camera => 
            camera && 
            typeof camera.latitude === 'number' && 
            typeof camera.longitude === 'number' &&
            !isNaN(camera.latitude) && 
            !isNaN(camera.longitude)
          ).map((camera) => (
            <CircleMarker
              key={camera.id}
              center={[camera.latitude, camera.longitude]}
              radius={10}
              pathOptions={{
                color: '#FFFFFF',
                weight: 2,
                fillColor: getMarkerColor(camera.crowd_level, camera.status),
                fillOpacity: camera.status === 'inactive' ? 0.5 : 0.8
              }}
              eventHandlers={{
                click: () => setSelectedCamera(camera)
              }}
            >
              <Popup>
                <div className="p-1">
                  <h3 className="font-bold text-sm mb-1">{camera.name || 'Unnamed Camera'}</h3>
                  {camera.city && (
                    <p className="text-xs text-gray-600 mb-0.5">
                      <span className="font-medium">City:</span> {camera.city}
                    </p>
                  )}
                  {camera.location_name && (
                    <p className="text-xs text-gray-600 mb-0.5">
                      <span className="font-medium">Location:</span> {camera.location_name}
                    </p>
                  )}
                  <p className="text-xs mb-0.5">
                    <span className="font-medium">Status:</span>{' '}
                    <span className={`font-bold ${
                      camera.status === 'active' ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {camera.status === 'active' ? '🟢 Active' : '🔴 Inactive/Offline'}
                    </span>
                  </p>
                  {camera.status === 'active' ? (
                    <>
                      <p className="text-xs mb-0.5">
                        <span className="font-medium">Crowd Level:</span>{' '}
                        <span className={`font-bold ${
                          camera.crowd_level === 'critical' ? 'text-red-600' :
                          camera.crowd_level === 'high' ? 'text-orange-600' :
                          camera.crowd_level === 'medium' ? 'text-yellow-600' :
                          'text-green-600'
                        }`}>
                          {getCrowdColor(camera.crowd_level)} {(camera.crowd_level || 'low').toUpperCase()}
                        </span>
                      </p>
                      <p className="text-xs">
                        <span className="font-medium">Count:</span> {camera.count || 0} people
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-red-600 font-medium">
                      Stream is offline. Crowd data unavailable.
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    <span className="font-medium">Last updated:</span> {formatToIST(camera.last_updated)}
                  </p>
                </div>
              </Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
      
      {/* Legend */}
      <div className="mt-4 flex flex-wrap gap-4">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-green-500"></div>
          <span className="text-sm">Low</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-yellow-500"></div>
          <span className="text-sm">Medium</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-orange-500"></div>
          <span className="text-sm">High</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-red-500"></div>
          <span className="text-sm">Critical</span>
        </div>
      </div>
    </div>
  );
}
