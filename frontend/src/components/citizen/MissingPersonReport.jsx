/**
 * Missing Person Report Component
 * Allows citizens to report missing persons
 */

import { useState, useEffect } from 'react';
import { apiService } from '../../services/api';

const ACCEPTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/bmp'
];

const ACCEPTED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];

export default function MissingPersonReport() {
  const [formData, setFormData] = useState({
    name: '',
    age: '',
    gender: '',
    description: '',
    last_seen_location: '',
    last_seen_city: '',
    contact_phone: ''
  });
  const [photo, setPhoto] = useState(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [cities, setCities] = useState([]);
  const [cityQuery, setCityQuery] = useState('');
  const [cityOpen, setCityOpen] = useState(false);
  
  useEffect(() => {
    const loadCities = async () => {
      try {
        const res = await apiService.getCameras();
        const cams = res.data?.cameras || [];
        const unique = Array.from(
          new Set(
            cams
              .map(c => (c.city || '').trim())
              .filter(Boolean)
          )
        ).sort((a, b) => a.localeCompare(b));
        setCities(unique);
      } catch (_) {
        setCities([]);
      }
    };
    loadCities();
  }, []);
  
  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'contact_phone') {
      const digits = value.replace(/\D/g, '');
      setFormData({ ...formData, contact_phone: digits });
      return;
    }
    if (name === 'age') {
      if (value === '') {
        setFormData({ ...formData, age: '' });
        return;
      }
      const n = parseInt(value, 10);
      if (isNaN(n)) return;
      const clamped = Math.min(150, Math.max(0, n));
      setFormData({ ...formData, age: String(clamped) });
      return;
    }
    setFormData({ ...formData, [name]: value });
  };
  
  const handlePhotoChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const fileName = (file.name || '').toLowerCase();
      const hasAcceptedExtension = ACCEPTED_IMAGE_EXTENSIONS.some((ext) => fileName.endsWith(ext));
      const hasAcceptedMimeType = ACCEPTED_IMAGE_TYPES.includes((file.type || '').toLowerCase());

      if (!hasAcceptedMimeType && !hasAcceptedExtension) {
        setError('Please upload a valid image file (JPG, JPEG, PNG, WEBP, GIF, or BMP)');
        setPhoto(null);
        return;
      }

      setError('');
      compressImage(file)
        .then((compressed) => setPhoto(compressed))
        .catch(() => setPhoto(file));
    }
  };

  const compressImage = (file, quality = 0.6, maxDim = 1280) => new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith('image/')) {
      resolve(file);
      return;
    }

    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => {
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height >= width && height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(file);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file);
              return;
            }
            const compressedFile = new File([blob], file.name, {
              type: 'image/jpeg',
              lastModified: Date.now()
            });
            resolve(compressedFile);
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setLoading(true);
    
    try {
      const resolvedCityInput = (formData.last_seen_city || cityQuery || '').trim();
      let resolvedCity = resolvedCityInput;
      if (cities.length > 0) {
        const matchedCity = cities.find(
          (city) => city.toLowerCase() === resolvedCityInput.toLowerCase()
        );
        if (!matchedCity) {
          setError('Please select a city from the dropdown');
          setLoading(false);
          return;
        }
        // Normalize to canonical city value from available list.
        resolvedCity = matchedCity;
      }

      if (formData.age) {
        const ageNum = Number(formData.age);
        if (isNaN(ageNum) || ageNum < 0 || ageNum > 150) {
          setError('Age must be between 0 and 150');
          setLoading(false);
          return;
        }
      }
      if (!formData.contact_phone || !/^\d+$/.test(formData.contact_phone)) {
        setError('Contact Phone must contain digits only');
        setLoading(false);
        return;
      }
      
      const formDataToSend = new FormData();
      
      // Add all form fields (including empty ones for required fields)
      formDataToSend.append('name', formData.name || '');
      formDataToSend.append('description', formData.description || '');
      formDataToSend.append('last_seen_location', formData.last_seen_location || '');
      formDataToSend.append('last_seen_city', resolvedCity);
      formDataToSend.append('contact_phone', formData.contact_phone || '');
      
      // Add optional fields only if they have values
      if (formData.age) {
        formDataToSend.append('age', formData.age);
      }
      if (formData.gender) {
        formDataToSend.append('gender', formData.gender);
      }
      
      // Add photo (required)
      if (!photo) {
        setError('Photo is required');
        setLoading(false);
        return;
      }
      formDataToSend.append('photo', photo);
      
      await apiService.reportMissing(formDataToSend);
      
      setSuccess(true);
      // Reset form
      setFormData({
        name: '',
        age: '',
        gender: '',
        description: '',
        last_seen_location: '',
        last_seen_city: '',
        contact_phone: ''
      });
      setPhoto(null);
      setCityQuery('');
    } catch (error) {
      setError(error.response?.data?.error || 'Failed to report missing person');
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-2xl font-bold mb-4">Report Missing Person</h2>
      
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded mb-4">
          Missing person reported successfully. Authorities have been notified.
        </div>
      )}
      
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
              Full Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          
          <div>
            <label htmlFor="age" className="block text-sm font-medium text-gray-700 mb-2">
              Age
            </label>
            <input
              type="number"
              id="age"
              name="age"
              value={formData.age}
              onChange={handleChange}
              min={0}
              max={150}
              step={1}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>
        
        <div>
          <label htmlFor="gender" className="block text-sm font-medium text-gray-700 mb-2">
            Gender
          </label>
          <select
            id="gender"
            name="gender"
            value={formData.gender}
            onChange={handleChange}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Select...</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select>
        </div>
        
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
            Physical Description <span className="text-red-500">*</span>
          </label>
          <textarea
            id="description"
            name="description"
            value={formData.description}
            onChange={handleChange}
            required
            rows={3}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Height, build, clothing, distinguishing features..."
          />
        </div>
        
        <div>
          <label htmlFor="photo" className="block text-sm font-medium text-gray-700 mb-2">
            Photo <span className="text-red-500">*</span>
          </label>
          <input
            type="file"
            id="photo"
            name="photo"
            accept=".jpg,.jpeg,.png,.webp,.gif,.bmp,image/jpeg,image/png,image/webp,image/gif,image/bmp"
            onChange={handlePhotoChange}
            required
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        
        <div>
          <label htmlFor="last_seen_location" className="block text-sm font-medium text-gray-700 mb-2">
            Last Seen Location <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="last_seen_location"
            name="last_seen_location"
            value={formData.last_seen_location}
            onChange={handleChange}
            required
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="Street address or landmark"
          />
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              City <span className="text-red-500">*</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={cityQuery || formData.last_seen_city}
                onChange={(e) => {
                  setCityQuery(e.target.value);
                  setCityOpen(true);
                }}
                onFocus={() => setCityOpen(true)}
                onBlur={() => setTimeout(() => setCityOpen(false), 150)}
                placeholder="Search city..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => {
                  setFormData({ ...formData, last_seen_city: '' });
                  setCityQuery('');
                }}
                className="px-3 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 text-sm"
              >
                Clear
              </button>
            </div>
            <input type="hidden" name="last_seen_city" value={formData.last_seen_city} />
            {cityOpen && (
              <div className="absolute z-10 mt-2 w-full max-h-44 overflow-auto rounded-lg border border-gray-200 bg-white shadow">
                {cities
                  .filter((c) => (cityQuery ? c.toLowerCase().includes(cityQuery.toLowerCase()) : true))
                  .map((city) => (
                    <button
                      type="button"
                      key={city}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setFormData({ ...formData, last_seen_city: city });
                        setCityQuery(city);
                        setCityOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2 hover:bg-blue-50 ${formData.last_seen_city === city ? 'bg-blue-50' : ''}`}
                    >
                      {city}
                    </button>
                  ))}
                {cities.filter((c) => (cityQuery ? c.toLowerCase().includes(cityQuery.toLowerCase()) : true)).length === 0 && (
                  <div className="px-4 py-2 text-sm text-gray-500">No matches</div>
                )}
              </div>
            )}
          </div>
          
          <div>
            <label htmlFor="contact_phone" className="block text-sm font-medium text-gray-700 mb-2">
              Contact Phone <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              id="contact_phone"
              name="contact_phone"
              value={formData.contact_phone}
              onChange={handleChange}
              required
              inputMode="numeric"
              pattern="[0-9]*"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Enter digits only"
            />
          </div>
        </div>
        
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Submitting...' : 'Report Missing Person'}
        </button>
      </form>
    </div>
  );
}
