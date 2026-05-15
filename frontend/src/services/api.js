/**
 * API Service
 * Centralized API calls with authentication
 */

import axios from 'axios';
import { getAuthToken } from '../config/firebase';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' }
});

// Add auth token to requests
api.interceptors.request.use(async (config) => {
  const token = await getAuthToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  
  // If data is FormData, remove Content-Type header to let browser set it with boundary
  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  
  return config;
});

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => {
    // Normalize backend shape:
    // { success: true, data: {...}, error: null } -> allow direct access (response.data.<field>)
    const payload = response?.data;
    if (payload && typeof payload === 'object' && 'success' in payload && 'data' in payload) {
      const data = payload.data;
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        response.data = { ...payload, ...data };
      }
    }
    return response;
  },
  (error) => {
    // Log network errors for debugging
    if (!error.response) {
      console.error('Network Error:', {
        message: error.message,
        code: error.code,
        config: {
          url: error.config?.url,
          method: error.config?.method,
          baseURL: error.config?.baseURL
        }
      });
    }
    
    if (error.response?.status === 401) {
      // Handle unauthorized - redirect to login
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const apiService = {
  // Auth
  register: (data) => api.post('/api/auth/register', data),
  verify: () => api.post('/api/auth/verify'),
  
  // Alerts
  getAlerts: () => api.get('/api/alerts/list'),
  createAlert: (data) => api.post('/api/alerts/create', data),
  publishAlert: (id) => api.put(`/api/alerts/publish/${id}`),
  resolveAlert: (id) => api.put(`/api/alerts/resolve/${id}`),
  
  // CCTV
  getCameras: () => api.get('/api/cctv/list'),
  addCamera: (data) => api.post('/api/cctv/add', data),
  updateCamera: (id, data) => api.put(`/api/cctv/update/${id}`, data),
  deleteCamera: (id) => api.delete(`/api/cctv/delete/${id}`),
  processCamera: (id) => api.post(`/api/cctv/process/${id}`),
  getCameraStatus: (id, checkStream = false) => api.get(`/api/cctv/status/${id}`, { params: { check_stream: checkStream } }),
  checkCameraStatus: (id) => api.post(`/api/cctv/check-status/${id}`),
  checkAllCameraStatus: () => api.post('/api/cctv/check-all-status'),
  
  // Missing Persons
  getMissingPersons: (status) => {
    const params = status ? { status } : {};
    return api.get('/api/missing/list', { params });
  },
  reportMissing: (formData) => {
    // Don't set Content-Type - let browser set it with boundary for FormData
    // Axios will automatically detect FormData and set the correct headers
    return api.post('/api/missing/report', formData);
  },
  updateMissingStatus: (id, status) => api.put(`/api/missing/update-status/${id}`, { status }),
  acceptMissingCase: (personId) => api.put(`/api/missing/cases/${personId}/accept`),
  informCitizen: (detectionId) => api.put(`/api/missing/detections/${detectionId}/inform-citizen`),
  citizenConfirmFound: (personId) => api.put(`/api/missing/cases/${personId}/citizen/confirm-found`),
  citizenRescan: (personId) => api.put(`/api/missing/cases/${personId}/citizen/rescan`),
  authorityConfirmMatch: (personId) => api.put(`/api/missing/cases/${personId}/authority/confirm-match`),
  authorityRescan: (personId) => api.put(`/api/missing/cases/${personId}/authority/rescan`),
  
  // Missing Person Notifications
  getMissingPersonNotifications: () => api.get('/api/missing/notifications'),
  confirmDetection: (id) => api.put(`/api/missing/detections/${id}/confirm`),
  confirmDetectionByCitizen: (id) => api.put(`/api/missing/detections/${id}/confirm-by-citizen`),
  
  // Routes
};

export default api;
