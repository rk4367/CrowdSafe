import { useEffect, useMemo, useState } from 'react';
import { Clock, MapPin, CheckCircle, CameraOff, Radio, Plus, XCircle } from 'lucide-react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { apiService } from '../../services/api';
import { db } from '../../config/firebase';
import { formatToIST } from '../../utils/time';

const STATUS_FILTERS = ['ACTIVE', 'RESOLVED', 'PUBLIC'];

const normalizeType = (type) => String(type || '').toUpperCase();
const isVisualAlertType = (alert) => {
  const t = normalizeType(alert?.type);
  return t === 'FIRE' || t === 'SMOKE';
};

const getAlertStatus = (alert) => {
  if (alert.status) return String(alert.status).toUpperCase();
  return alert.resolved ? 'RESOLVED' : 'ACTIVE';
};

const getAlertLocation = (alert) => alert.location || alert.location_name || 'Unknown Location';
const isPublished = (alert) => alert.published === true;
const isPublicActive = (alert) => isPublished(alert) && getAlertStatus(alert) === 'ACTIVE';

export default function AlertsManagement() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ACTIVE');
  const [resolvingIds, setResolvingIds] = useState({});
  const [publishingIds, setPublishingIds] = useState({});
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [timestamp, setTimestamp] = useState(Date.now());
  const [formData, setFormData] = useState({
    type: 'general',
    severity: 'info',
    location_name: '',
    latitude: '',
    longitude: '',
    message: '',
  });

  useEffect(() => {
    const queryRef = query(
      collection(db, 'alerts'),
      orderBy('created_at', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(
      queryRef,
      (snapshot) => {
        const nextAlerts = snapshot.docs
          .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        setAlerts(nextAlerts);
        setLoading(false);
      },
      (error) => {
        console.error('Alerts listener failed:', error);
        setAlerts([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setTimestamp(Date.now());
    }, 15000); // 15 seconds refresh for CCTV images

    return () => clearInterval(interval);
  }, []);

  const getAlertSortTime = (alert) => {
    const ts = alert.updated_at || alert.created_at;
    if (!ts) return 0;
    if (typeof ts?.toDate === 'function') return ts.toDate().getTime();
    if (typeof ts?.seconds === 'number') return ts.seconds * 1000;
    if (typeof ts?._seconds === 'number') return ts._seconds * 1000;
    return new Date(ts).getTime() || 0;
  };

  const filteredAlerts = useMemo(() => {
    let result;
    if (statusFilter === 'PUBLIC') result = alerts.filter((alert) => isPublicActive(alert));
    else result = alerts.filter((alert) => getAlertStatus(alert) === statusFilter);
    // Always sort latest activity first
    return [...result].sort((a, b) => getAlertSortTime(b) - getAlertSortTime(a));
  }, [alerts, statusFilter]);

  const stats = useMemo(() => {
    const active = alerts.filter((a) => getAlertStatus(a) === 'ACTIVE').length;
    const resolved = alerts.filter((a) => getAlertStatus(a) === 'RESOLVED').length;
    const fire = alerts.filter((a) => normalizeType(a.type) === 'FIRE').length;
    const publicActive = alerts.filter((a) => isPublicActive(a)).length;
    return { active, resolved, fire, publicActive };
  }, [alerts]);

  const handleResolve = async (alertId) => {
    try {
      setResolvingIds((prev) => ({ ...prev, [alertId]: true }));
      await apiService.resolveAlert(alertId);
    } catch (error) {
      console.error('Failed to resolve alert:', error);
    } finally {
      setResolvingIds((prev) => ({ ...prev, [alertId]: false }));
    }
  };

  const handlePublish = async (alertId) => {
    try {
      setPublishingIds((prev) => ({ ...prev, [alertId]: true }));
      await apiService.publishAlert(alertId);
    } catch (error) {
      console.error('Failed to publish alert:', error);
    } finally {
      setPublishingIds((prev) => ({ ...prev, [alertId]: false }));
    }
  };

  const resetForm = () => {
    setFormData({
      type: 'general',
      severity: 'info',
      location_name: '',
      latitude: '',
      longitude: '',
      message: '',
    });
    setCreateError('');
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleCreateAlert = async (e) => {
    e.preventDefault();
    setCreateError('');
    try {
      setCreateSubmitting(true);
      await apiService.createAlert(formData);
      resetForm();
      setIsCreating(false);
    } catch (error) {
      setCreateError(error?.response?.data?.error || 'Failed to create alert');
    } finally {
      setCreateSubmitting(false);
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
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Alert Center</h2>
          <p className="text-gray-500 mt-1">Real-time CCTV fire/smoke visual monitoring</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-4 lg:mt-0">
          <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 whitespace-nowrap">
            {stats.fire} FIRE
          </span>
          <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-700 whitespace-nowrap">
            {stats.active} ACTIVE
          </span>
          <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 whitespace-nowrap">
            {stats.resolved} RESOLVED
          </span>
          <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 whitespace-nowrap">
            {stats.publicActive} PUBLIC
          </span>
          <button
            onClick={() => setIsCreating((prev) => !prev)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 shadow-sm hover:shadow active:scale-[0.98] transition-all whitespace-nowrap"
          >
            <Plus className="w-4 h-4 shrink-0" />
            Create Alert
          </button>
        </div>
      </div>

      {isCreating && (
        <form onSubmit={handleCreateAlert} className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">Create Manual Alert</h3>
            <button
              type="button"
              onClick={() => {
                setIsCreating(false);
                resetForm();
              }}
              className="text-gray-500 hover:text-gray-700"
            >
              <XCircle className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <select
              name="type"
              value={formData.type}
              onChange={handleFormChange}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="general">General</option>
              <option value="emergency">Emergency</option>
              <option value="crowd">Crowd</option>
              <option value="fire">Fire</option>
              <option value="smoke">Smoke</option>
            </select>
            <select
              name="severity"
              value={formData.severity}
              onChange={handleFormChange}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
            <input
              name="location_name"
              value={formData.location_name}
              onChange={handleFormChange}
              placeholder="Location name"
              required
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
            <input
              name="latitude"
              value={formData.latitude}
              onChange={handleFormChange}
              type="number"
              step="any"
              placeholder="Latitude"
              required
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
            <input
              name="longitude"
              value={formData.longitude}
              onChange={handleFormChange}
              type="number"
              step="any"
              placeholder="Longitude"
              required
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
            <input
              name="message"
              value={formData.message}
              onChange={handleFormChange}
              placeholder="Alert message"
              required
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm md:col-span-2 lg:col-span-3"
            />
          </div>

          {createError && (
            <p className="text-sm text-red-600">{createError}</p>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={createSubmitting}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {createSubmitting ? 'Creating...' : 'Create Alert'}
            </button>
          </div>
        </form>
      )}

      <div className="inline-flex flex-wrap bg-gray-100/80 p-1.5 rounded-xl gap-1 border border-gray-200/50">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter}
            onClick={() => setStatusFilter(filter)}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
              statusFilter === filter
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-200/50'
            }`}
          >
            {filter}
          </button>
        ))}
      </div>
      {filteredAlerts.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center">
          <CameraOff className="w-10 h-10 text-gray-400 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-gray-900">No visual alerts found</h3>
          <p className="text-sm text-gray-500 mt-1">Incoming FIRE/SMOKE detections will appear here automatically.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filteredAlerts.map((alert) => {
            const status = getAlertStatus(alert);
            const type = normalizeType(alert.type);
            const canResolve = status === 'ACTIVE';
            const canPublish = status === 'ACTIVE' && !isPublished(alert);
            const visualType = isVisualAlertType(alert);
            return (
              <article key={alert.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <div className="h-48 bg-gray-100">
                  {alert.image_url ? (
                    <img src={`${alert.image_url}${alert.image_url.includes('?') ? '&' : '?'}t=${timestamp}`} alt={`${type} detection`} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-500 text-sm">
                      {visualType ? 'No CCTV image available' : 'Manual alert (no image)'}
                    </div>
                  )}
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex justify-between items-start gap-2">
                    <span className={`px-2.5 py-1 rounded text-xs font-semibold ${
                      type === 'FIRE' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
                    }`}>
                      {type || 'UNKNOWN'}
                    </span>
                    <span className={`px-2.5 py-1 rounded text-xs font-semibold ${
                      status === 'ACTIVE' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'
                    }`}>
                      {status}
                    </span>
                  </div>

                  <p className="text-sm font-semibold text-gray-900 flex items-start gap-1.5">
                    <MapPin className="w-4 h-4 text-gray-500 shrink-0 mt-0.5" />
                    <span className="break-words line-clamp-2">{getAlertLocation(alert)}</span>
                  </p>

                  <div className="text-sm text-gray-600 flex items-start gap-1.5">
                    <Clock className="w-4 h-4 text-gray-500 shrink-0 mt-0.5" />
                    <div className="flex flex-col sm:flex-row sm:items-center sm:flex-wrap gap-x-1">
                      <span className="font-medium text-gray-700">
                        {status === 'ACTIVE' ? 'Last detected:' : 'Detected at:'}
                      </span>
                      <span className="break-words">
                        {formatToIST(alert.updated_at || alert.created_at)}
                      </span>
                    </div>
                  </div>
                  {status === 'RESOLVED' && alert.resolved_at && (
                    <div className="text-sm text-green-600 flex items-start gap-1.5">
                      <CheckCircle className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                      <div className="flex flex-col sm:flex-row sm:items-center sm:flex-wrap gap-x-1">
                        <span className="font-medium text-green-700">Resolved at:</span>
                        <span className="break-words">{formatToIST(alert.resolved_at)}</span>
                      </div>
                    </div>
                  )}

                  {alert.message && (
                    <p className="text-sm text-gray-600 line-clamp-2">{alert.message}</p>
                  )}

                  {canResolve && (
                    <div className="flex flex-col sm:flex-row gap-2 pt-1 w-full">
                      <button
                        onClick={() => handleResolve(alert.id)}
                        disabled={Boolean(resolvingIds[alert.id])}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 text-sm font-semibold transition-all hover:shadow-sm active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                      >
                        <CheckCircle className="w-4 h-4 shrink-0" />
                        <span className="truncate">{resolvingIds[alert.id] ? 'Resolving...' : 'Mark Resolved'}</span>
                      </button>
                      {canPublish && (
                        <button
                          onClick={() => handlePublish(alert.id)}
                          disabled={Boolean(publishingIds[alert.id])}
                          className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-sm font-semibold transition-all hover:shadow-sm active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                        >
                          <Radio className="w-4 h-4 shrink-0" />
                          <span className="truncate">{publishingIds[alert.id] ? 'Publishing...' : 'Public'}</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
