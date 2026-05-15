/**
 * Missing Person Management Component
 * Allows authorities to view and update missing person status
 */

import { useState, useEffect, useMemo } from 'react';
import { apiService } from '../../services/api';
import { formatToIST } from '../../utils/time';
import { Bell, ChevronDown, Search, X } from 'lucide-react';
import { collection, onSnapshot, query, where, limit } from 'firebase/firestore';
import { db } from '../../config/firebase';

export default function MissingPersonManagement() {
  const [newCases, setNewCases] = useState([]);
  const [historyCases, setHistoryCases] = useState([]);
  const [detectionCases, setDetectionCases] = useState([]);
  const [filterStatus, setFilterStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [activeTab, setActiveTab] = useState('new');
  const [actionLoading, setActionLoading] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCity, setSelectedCity] = useState('all');
  const [notificationsSource, setNotificationsSource] = useState('firestore'); // firestore | api
  const [imagePreview, setImagePreview] = useState(null); // { src, title }
  const [caseSyncWarning, setCaseSyncWarning] = useState('');

  const getTimeMs = (row) => {
    const t =
      row?.updated_at ??
      row?.last_updated ??
      row?.created_at ??
      row?.detected_at ??
      row?.detection_time;
    if (!t) return 0;
    if (typeof t?.toMillis === 'function') return t.toMillis();
    if (typeof t === 'number') return t;
    const ms = new Date(t).getTime();
    return Number.isFinite(ms) ? ms : 0;
  };
  
  useEffect(() => {
    // Strict separation (query-driven):
    // - New Cases: anything still in-flight (until authority final confirmation)
    // - History: only MATCH_CONFIRMED
    // - Detection badge/actions: DETECTED + RESCAN_REQUESTED (+ CONFIRMED_BY_CITIZEN for Confirm Match)

    const unsubNew = onSnapshot(
      query(
        collection(db, 'missing_persons'),
        where('status', 'in', ['SEARCHING', 'DETECTED', 'RESCAN_REQUESTED', 'CONFIRMED_BY_CITIZEN'])
      ),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => getTimeMs(b) - getTimeMs(a));
        setNewCases(list);
        setLoading(false);
      },
      (err) => {
        console.error('Error listening to new cases:', err);
        setLoading(false);
      }
    );

    const unsubHistory = onSnapshot(
      query(collection(db, 'missing_persons'), where('status', '==', 'MATCH_CONFIRMED')),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => getTimeMs(b) - getTimeMs(a));
        setHistoryCases(list);
      },
      (err) => console.error('Error listening to history cases:', err)
    );

    const unsubDetectionCases = onSnapshot(
      query(collection(db, 'missing_persons'), where('status', 'in', ['DETECTED', 'RESCAN_REQUESTED', 'CONFIRMED_BY_CITIZEN'])),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => getTimeMs(b) - getTimeMs(a));
        setDetectionCases(list);
      },
      (err) => console.error('Error listening to detection cases:', err)
    );

    const qNotifs = query(
      collection(db, 'notifications'),
      where('type', '==', 'missing_person_detected'),
      limit(200)
    );

    const loadNotifsViaApi = async () => {
      try {
        const res = await apiService.getMissingPersonNotifications();
        const list = (res.data?.notifications || [])
          .filter((n) => n.type === 'missing_person_detected')
          .sort((a, b) => getTimeMs(b) - getTimeMs(a))
          .slice(0, 50);
        setNotifications(list);
        setNotificationsSource('api');
      } catch (e) {
        // ignore
      }
    };

    // 15s polling fallback for environments where realtime listeners can lag.
    const loadCasesViaApi = async () => {
      try {
        const [allRes, confirmedRes] = await Promise.allSettled([
          apiService.getMissingPersons('all'),
          apiService.getMissingPersons('MATCH_CONFIRMED')
        ]);

        const allCases = allRes.status === 'fulfilled' ? (allRes.value?.data?.missing_persons || []) : [];
        const confirmedCases = confirmedRes.status === 'fulfilled' ? (confirmedRes.value?.data?.missing_persons || []) : [];
        const inFlight = allCases.filter((p) =>
          ['SEARCHING', 'DETECTED', 'RESCAN_REQUESTED', 'CONFIRMED_BY_CITIZEN'].includes(p.status)
        );
        const detectionOnly = allCases.filter((p) =>
          ['DETECTED', 'RESCAN_REQUESTED', 'CONFIRMED_BY_CITIZEN'].includes(p.status)
        );

        if (allRes.status === 'fulfilled') {
          setNewCases(inFlight);
          setDetectionCases(detectionOnly);
        }
        if (confirmedRes.status === 'fulfilled') {
          setHistoryCases(confirmedCases);
        }

        if (allRes.status === 'rejected' || confirmedRes.status === 'rejected') {
          setCaseSyncWarning('Some data is temporarily unavailable. Live actions still work, and lists will auto-refresh.');
        } else {
          setCaseSyncWarning('');
        }
      } catch (_) {
        setCaseSyncWarning('Unable to refresh case data right now. Retrying automatically.');
      }
    };

    const unsubNotifs = onSnapshot(
      qNotifs,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => getTimeMs(b) - getTimeMs(a))
          .slice(0, 50);
        setNotifications(list);
        setNotificationsSource('firestore');
      },
      (err) => {
        console.error('Error listening to notifications:', err);
        // Fallback (covers missing rules / permission issues / indexes)
        loadNotifsViaApi();
      }
    );

    loadCasesViaApi();
    loadNotifsViaApi();
    const fallbackInterval = setInterval(() => {
      loadCasesViaApi();
      loadNotifsViaApi();
    }, 15000);

    return () => {
      unsubNew();
      unsubHistory();
      unsubDetectionCases();
      unsubNotifs();
      clearInterval(fallbackInterval);
    };
  }, []);
  
  const handleStatusUpdate = async (id, newStatus) => {
    try {
      await apiService.updateMissingStatus(id, newStatus);
    } catch (error) {
      console.error('Error updating status:', error);
    }
  };

  const handleAcceptCase = async (id) => {
    setActionLoading((prev) => ({ ...prev, [`accept-${id}`]: true }));
    setNewCases((prev) => prev.map((p) => (p.id === id ? { ...p, search_active: true } : p)));
    try {
      await apiService.acceptMissingCase(id);
    } catch (error) {
      console.error('Error accepting case:', error);
      alert('Failed to accept case');
      setNewCases((prev) => prev.map((p) => (p.id === id ? { ...p, search_active: false } : p)));
    } finally {
      setActionLoading((prev) => ({ ...prev, [`accept-${id}`]: false }));
    }
  };

  const handleInformCitizen = async (detectionId) => {
    setActionLoading((prev) => ({ ...prev, [`inform-${detectionId}`]: true }));
    try {
      await apiService.informCitizen(detectionId);
      alert('Citizen informed.');
    } catch (error) {
      console.error('Error informing citizen:', error);
      alert('Failed to inform citizen');
    } finally {
      setActionLoading((prev) => ({ ...prev, [`inform-${detectionId}`]: false }));
    }
  };

  const handleAuthorityRescan = async (personId) => {
    setActionLoading((prev) => ({ ...prev, [`rescan-${personId}`]: true }));
    setNewCases((prev) => prev.map((p) => (p.id === personId ? { ...p, status: 'SEARCHING', search_active: true } : p)));
    try {
      await apiService.authorityRescan(personId);
    } catch (error) {
      console.error('Error starting rescan:', error);
      alert('Failed to start rescan');
    } finally {
      setActionLoading((prev) => ({ ...prev, [`rescan-${personId}`]: false }));
    }
  };

  const handleAuthorityConfirmMatch = async (personId) => {
    setActionLoading((prev) => ({ ...prev, [`confirm-${personId}`]: true }));
    setNewCases((prev) => prev.map((p) => (p.id === personId ? { ...p, status: 'MATCH_CONFIRMED', search_active: false } : p)));
    try {
      await apiService.authorityConfirmMatch(personId);
      alert('Match confirmed. Searching stopped.');
    } catch (error) {
      console.error('Error confirming match:', error);
      alert('Failed to confirm match');
    } finally {
      setActionLoading((prev) => ({ ...prev, [`confirm-${personId}`]: false }));
    }
  };
  
  const handleConfirmDetection = async (detectionId) => {
    try {
      await apiService.confirmDetection(detectionId);
      alert('Detection confirmed! The citizen has been notified.');
    } catch (error) {
      console.error('Error confirming detection:', error);
      alert('Failed to confirm detection');
    }
  };
  
  const getStatusColor = (status) => {
    switch (status) {
      case 'MATCH_CONFIRMED': return 'bg-green-100 text-green-800';
      case 'SEARCHING': return 'bg-yellow-100 text-yellow-800';
      case 'DETECTED': return 'bg-blue-100 text-blue-800';
      case 'CONFIRMED_BY_CITIZEN': return 'bg-purple-100 text-purple-800';
      case 'RESCAN_REQUESTED': return 'bg-orange-100 text-orange-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const cities = useMemo(() => {
    const set = new Set();
    const base = activeTab === 'history' ? historyCases : newCases;
    base.forEach(p => {
      if (p.last_seen_city) set.add(p.last_seen_city);
    });
    return Array.from(set).sort();
  }, [newCases, historyCases, activeTab]);

  const filteredPersons = useMemo(() => {
    let list = activeTab === 'history' ? [...historyCases] : [...newCases];
    if (filterStatus !== 'all') {
      list = list.filter(p => p.status === filterStatus);
    }
    if (selectedCity !== 'all') {
      list = list.filter(p => (p.last_seen_city || '').toLowerCase() === selectedCity.toLowerCase());
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p => {
        const name = (p.name || '').toLowerCase();
        const loc = (p.last_seen_location || '').toLowerCase();
        const city = (p.last_seen_city || '').toLowerCase();
        return name.includes(q) || loc.includes(q) || city.includes(q);
      });
    }
    return list;
  }, [newCases, historyCases, activeTab, filterStatus, searchQuery, selectedCity]);

  const personById = useMemo(() => {
    const m = new Map();
    detectionCases.forEach(p => m.set(p.id, p));
    historyCases.forEach(p => m.set(p.id, p));
    newCases.forEach(p => m.set(p.id, p));
    return m;
  }, [detectionCases, historyCases, newCases]);

  const ImagePanel = ({ title, src, fallbackText }) => {
    const hasSrc = Boolean(src);
    return (
      <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
          <p className="text-xs font-semibold text-gray-600">{title}</p>
        </div>
        <div className="p-3">
          {hasSrc ? (
            <button
              type="button"
              onClick={() => setImagePreview({ src, title })}
              className="w-full group relative rounded-lg overflow-hidden bg-gray-100 ring-1 ring-gray-200 hover:ring-blue-300 transition"
              title="Click to zoom"
            >
              <div className="w-full aspect-[16/9]">
                <img
                  src={src}
                  alt={title}
                  loading="lazy"
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition bg-gradient-to-t from-black/35 via-black/0 to-black/0" />
              <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition">
                <span className="text-[11px] px-2 py-1 rounded bg-black/70 text-white">Zoom</span>
              </div>
            </button>
          ) : (
            <div className="w-full aspect-[16/9] rounded-lg bg-gray-100 ring-1 ring-gray-200 flex items-center justify-center text-gray-500 text-sm">
              {fallbackText || 'No image'}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Badge logic (status-driven, real-time): Authority sees DETECTED or RESCAN_REQUESTED
  const detectionBadgeCount = useMemo(() => {
    return detectionCases.filter((p) => p.status === 'DETECTED' || p.status === 'RESCAN_REQUESTED').length;
  }, [detectionCases]);

  // Only show detection notifications that are still actionable/relevant in current lifecycle.
  // IMPORTANT:
  // - Notifications and missing_persons snapshots can arrive in either order.
  // - Some older docs may have legacy/lowercase status values.
  // So we normalize status and avoid over-filtering.
  const activeDetectionNotifications = useMemo(() => {
    return notifications.filter((n) => {
      const person = personById.get(n.person_id);
      const status = person?.status;
      const normalizedStatus = typeof status === 'string' ? status.trim().toUpperCase() : '';

      // If person doc not loaded yet, still show notification so UI isn't empty.
      if (!normalizedStatus) return n?.confirmed !== true;

      return (
        normalizedStatus === 'DETECTED' ||
        normalizedStatus === 'RESCAN_REQUESTED' ||
        normalizedStatus === 'CONFIRMED_BY_CITIZEN'
      );
    });
  }, [notifications, personById]);
  
  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      {imagePreview?.src && (
        <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-5xl bg-white rounded-2xl overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <p className="font-semibold text-gray-900 text-sm">{imagePreview.title || 'Preview'}</p>
              <button
                type="button"
                onClick={() => setImagePreview(null)}
                className="p-2 rounded-lg hover:bg-gray-100"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="bg-black">
              <img
                src={imagePreview.src}
                alt={imagePreview.title || 'Preview'}
                className="w-full max-h-[75vh] object-contain"
              />
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-gray-900">Missing Persons Management</h2>
        <p className="text-gray-600">Review, verify, and search for reported missing persons</p>
        {caseSyncWarning && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {caseSyncWarning}
          </p>
        )}
      </div>

      <div className="border-b">
        <div className="flex items-center justify-between">
          <div className="flex gap-6">
            <button
              onClick={() => setActiveTab('new')}
              className={`py-3 -mb-px ${activeTab === 'new' ? 'border-b-2 border-emerald-500 text-emerald-600 font-medium' : 'text-gray-600 hover:text-emerald-600'}`}
            >
              New Cases
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`py-3 -mb-px ${activeTab === 'history' ? 'border-b-2 border-emerald-500 text-emerald-600 font-medium' : 'text-gray-600 hover:text-emerald-600'}`}
            >
              History
            </button>
          </div>
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 relative flex items-center gap-2"
          >
            <Bell className="w-4 h-4" />
            Detections
            <ChevronDown className={`w-4 h-4 transition-transform ${showNotifications ? 'rotate-180' : ''}`} />
            {detectionBadgeCount > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center">
                {detectionBadgeCount}
              </span>
            )}
          </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name or location..."
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg"
          />
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedCity}
            onChange={(e) => setSelectedCity(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg"
          >
            <option value="all">All Cities</option>
            {cities.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg"
          >
            <option value="all">All Status</option>
            <option value="SEARCHING">Searching</option>
            <option value="DETECTED">Detected</option>
            <option value="CONFIRMED_BY_CITIZEN">Confirmed by Citizen</option>
            <option value="RESCAN_REQUESTED">Rescan Requested</option>
            <option value="MATCH_CONFIRMED">Match Confirmed</option>
          </select>
        </div>
      </div>
      
      {showNotifications && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-xl font-bold">Face Detection Notifications</h3>
              <p className="text-xs text-gray-500 mt-1">
                Source: <span className="font-medium">{notificationsSource}</span>
              </p>
            </div>
          </div>
          {notifications.length === 0 ? (
            <p className="text-gray-600">No detections yet.</p>
          ) : (
            <div className="space-y-4">
              {activeDetectionNotifications.length === 0 ? (
                <p className="text-gray-600">No active detections.</p>
              ) : activeDetectionNotifications.map((notif) => (
                <div
                  key={notif.id}
                  className="border rounded-xl p-4 bg-yellow-50 border-yellow-300"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="font-semibold text-lg">
                          {notif.person_name} Detected
                        </h4>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          notif.detection_status === 'detected' 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {notif.detection_status === 'detected' ? 'Confirmed Match' : 'Possible Match'}
                        </span>
                      </div>
                      
                      {/* Identification Details */}
                      {notif.person_details && (
                        <div className="mb-3 p-3 bg-white rounded border">
                          <p className="text-xs font-medium text-gray-500 mb-1">IDENTIFICATION DETAILS:</p>
                          <p className="text-sm text-gray-700">
                            {notif.person_details.age && `${notif.person_details.age} years old`}
                            {notif.person_details.gender && ` • ${notif.person_details.gender}`}
                          </p>
                          {notif.person_details.description && (
                            <p className="text-sm text-gray-700 mt-1">
                              {notif.person_details.description}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Images */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                        <ImagePanel
                          title="Missing Person Image"
                          src={notif.missing_person_image || notif.person_details?.photo_url}
                          fallbackText="No image"
                        />
                        <ImagePanel
                          title="CCTV Captured Image"
                          src={notif.cctv_image}
                          fallbackText="No capture yet"
                        />
                      </div>
                      
                      {/* Detection Status */}
                      <div className="mb-2">
                        <p className="text-sm font-medium text-gray-700">
                          Detection Status: <span className="font-semibold text-blue-600">
                            {notif.detection_status === 'detected' ? 'Confirmed Detection' : 'Possible Match'}
                          </span>
                        </p>
                      </div>
                      
                      {/* Location */}
                      {notif.location && (
                        <div className="mb-2">
                          <p className="text-sm font-medium text-gray-700">📍 Location:</p>
                          <p className="text-sm text-gray-600">
                            {notif.location.name && `${notif.location.name}, `}
                            {notif.location.city || ''}
                            {notif.location.latitude && notif.location.longitude && (
                              <span className="text-gray-500 ml-2">
                                ({notif.location.latitude.toFixed(4)}, {notif.location.longitude.toFixed(4)})
                              </span>
                            )}
                          </p>
                        </div>
                      )}
                      
                      {/* Time */}
                      <div className="mb-2">
                        <p className="text-sm font-medium text-gray-700">🕐 Detection Time:</p>
                        <p className="text-sm text-gray-600">
                          {formatToIST(notif.detection_time || notif.detected_at || notif.detected_at)}
                        </p>
                      </div>
                      
                      {/* Camera Info */}
                      <p className="text-sm text-gray-600">
                        📹 Camera: {notif.camera_name || notif.camera_id}
                      </p>
                      
                      {/* Confidence */}
                      <p className="text-sm text-gray-600 mt-1">
                        Confidence: <span className="font-semibold">
                          {notif.confidence_percentage?.toFixed(1) || (notif.confidence * 100).toFixed(1)}%
                        </span>
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 ml-4">
                      {(() => {
                        const person = personById.get(notif.person_id);
                        const personStatus = person?.status;
                        const canConfirm = personStatus === 'CONFIRMED_BY_CITIZEN';
                        const canRescan = personStatus === 'RESCAN_REQUESTED';
                        const canInform = personStatus === 'DETECTED' && notif.visible_to_citizen !== true;
                        const statusReady = Boolean(personStatus);

                        return (
                          <>
                            {canInform && (
                              <button
                                onClick={() => handleInformCitizen(notif.id)}
                                disabled={Boolean(actionLoading[`inform-${notif.id}`])}
                                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                              >
                                {actionLoading[`inform-${notif.id}`] ? 'Informing...' : 'Inform to citizen'}
                              </button>
                            )}
                            {!statusReady && (
                              <span className="px-4 py-2 bg-gray-100 text-gray-700 rounded text-sm font-medium text-center">
                                Loading…
                              </span>
                            )}
                            {personStatus === 'RESCAN_REQUESTED' && (
                              <button
                                onClick={() => handleAuthorityRescan(notif.person_id)}
                                disabled={Boolean(actionLoading[`rescan-${notif.person_id}`])}
                                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                              >
                                {actionLoading[`rescan-${notif.person_id}`] ? 'Starting...' : 'Re-scan'}
                              </button>
                            )}
                            {personStatus === 'DETECTED' && (
                              <button
                                onClick={() => handleAuthorityRescan(notif.person_id)}
                                disabled={Boolean(actionLoading[`rescan-${notif.person_id}`])}
                                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                              >
                                {actionLoading[`rescan-${notif.person_id}`] ? 'Starting...' : 'Re-scan'}
                              </button>
                            )}
                            {canConfirm && (
                              <button
                                onClick={() => handleAuthorityConfirmMatch(notif.person_id)}
                                disabled={Boolean(actionLoading[`confirm-${notif.person_id}`])}
                                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                              >
                                {actionLoading[`confirm-${notif.person_id}`] ? 'Confirming...' : 'Confirm Match'}
                              </button>
                            )}
                            {personStatus === 'MATCH_CONFIRMED' && (
                              <span className="px-4 py-2 bg-green-100 text-green-800 rounded text-sm font-medium text-center">
                                Match Confirmed
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6">
        <div className="space-y-4">
          {filteredPersons.length === 0 ? (
            <div className="text-center py-12">
              <div className="mx-auto w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
                <span className="text-3xl">✅</span>
              </div>
              <h3 className="text-xl font-semibold mb-1">No Missing Persons</h3>
              <p className="text-gray-600">No missing person reports found.</p>
            </div>
          ) : (
            filteredPersons.map((person) => (
              <div key={person.id} className="border border-gray-200 rounded-xl p-4 hover:shadow-sm transition bg-white">
                <div className="flex gap-4">
                  {person.photo_url && (
                    <button
                      type="button"
                      onClick={() => setImagePreview({ src: person.photo_url, title: `${person.name} (Missing Person Image)` })}
                      className="w-24 h-24 rounded-xl overflow-hidden bg-gray-100 ring-1 ring-gray-200 hover:ring-blue-300 transition"
                      title="Click to zoom"
                    >
                      <img
                        src={person.photo_url}
                        alt={person.name}
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                    </button>
                  )}
                  <div className="flex-1">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h3 className="font-semibold text-lg">{person.name}</h3>
                        <p className="text-sm text-gray-600">
                          {person.age && `${person.age} years old`} {person.gender && `• ${person.gender}`}
                        </p>
                      </div>
                      {(() => {
                        const displayStatus =
                          activeTab === 'history' && person.status === 'MATCH_CONFIRMED'
                            ? 'CONFIRMED_BY_CITIZEN'
                            : person.status;
                        return (
                          <span className={`px-3 py-1 rounded text-sm font-medium ${getStatusColor(displayStatus)}`}>
                            {displayStatus}
                          </span>
                        );
                      })()}
                    </div>
                    <p className="text-sm mb-2">{person.description}</p>
                    <p className="text-xs text-gray-600 mb-2">
                      📍 Last seen: {person.last_seen_location}, {person.last_seen_city}
                    </p>
                    <p className="text-xs text-gray-600">
                      📞 Contact: {person.contact_phone} | 🕐 Reported: {formatToIST(person.created_at)}
                    </p>
                    <div className="mt-3 flex gap-2">
                      {person.search_active !== true && person.status === 'SEARCHING' && (
                        <button
                          onClick={() => {
                            if (window.confirm(`Accept this missing person report and start face recognition scanning on CCTV cameras in ${person.last_seen_city}?`)) {
                              handleAcceptCase(person.id);
                            }
                          }}
                          disabled={Boolean(actionLoading[`accept-${person.id}`])}
                          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {actionLoading[`accept-${person.id}`] ? 'Starting...' : '✓ Accept & Start Searching'}
                        </button>
                      )}
                      {person.search_active === true && person.status === 'SEARCHING' && (
                        <div className="flex items-center gap-2">
                          <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded text-sm font-medium">
                            🔍 Actively Searching
                          </span>
                        </div>
                      )}
                      {person.status === 'RESCAN_REQUESTED' && (
                        <button
                          onClick={() => handleAuthorityRescan(person.id)}
                          disabled={Boolean(actionLoading[`rescan-${person.id}`])}
                          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {actionLoading[`rescan-${person.id}`] ? 'Starting...' : 'Re-scan'}
                        </button>
                      )}
                      {person.status === 'CONFIRMED_BY_CITIZEN' && (
                        <button
                          onClick={() => handleAuthorityConfirmMatch(person.id)}
                          disabled={Boolean(actionLoading[`confirm-${person.id}`])}
                          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {actionLoading[`confirm-${person.id}`] ? 'Confirming...' : 'Confirm Match'}
                        </button>
                      )}
                      {person.status === 'MATCH_CONFIRMED' && (
                        <span className="px-3 py-1 bg-green-100 text-green-800 rounded text-sm font-medium">
                          ✅ Match Confirmed
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

