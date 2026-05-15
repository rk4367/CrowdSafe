import { useMemo, useState, useEffect } from 'react';
import { formatToIST } from '../../utils/time';
import { apiService } from '../../services/api';
import { useAuth } from '../../hooks/useAuth';
import { db } from '../../config/firebase';
import { collection, onSnapshot, query, where, limit, getDocs } from 'firebase/firestore';
import { X } from 'lucide-react';


export default function MissingPersonFound() {
  const [detections, setDetections] = useState([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const [imagePreview, setImagePreview] = useState(null); // { src, title }
  const [actionLoading, setActionLoading] = useState({});
  const [feedWarning, setFeedWarning] = useState('');

  const sortByRecent = (list) => {
    return [...list].sort((a, b) => {
      const aMs = typeof a.updated_at?.toMillis === 'function' ? a.updated_at.toMillis() : new Date(a.updated_at || a.created_at).getTime();
      const bMs = typeof b.updated_at?.toMillis === 'function' ? b.updated_at.toMillis() : new Date(b.updated_at || b.created_at).getTime();
      return bMs - aMs;
    });
  };

  const normalizeDetectedCases = (docs) => {
    return sortByRecent(
      docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((row) => row.status === 'DETECTED' && row.notification_sent === true)
    ).slice(0, 50);
  };
  
  // Citizen: Found Notifications MUST show ONLY DETECTED cases (query-driven, real-time).
  useEffect(() => {
    if (!user) return;
    const qDetected = query(
      collection(db, 'missing_persons'),
      where('reported_by', '==', user.uid),
      limit(200)
    );
    const unsub = onSnapshot(
      qDetected,
      (snap) => {
        setDetections(normalizeDetectedCases(snap.docs));
        setFeedWarning('');
        setLoading(false);
      },
      () => {
        setFeedWarning('Live updates are temporarily unavailable. Retrying automatically.');
        setDetections([]);
        setLoading(false);
      }
    );

    const pollDetections = async () => {
      try {
        const snap = await getDocs(qDetected);
        setDetections(normalizeDetectedCases(snap.docs));
        setFeedWarning('');
      } catch (_) {
        setFeedWarning('Unable to refresh updates right now. Retrying automatically.');
      }
    };
    const pollInterval = setInterval(pollDetections, 15000);

    return () => {
      unsub();
      clearInterval(pollInterval);
    };
  }, [user]);
  
  
  const handleConfirmDetection = async (notificationId) => {
    setActionLoading((prev) => ({ ...prev, [`confirm-${notificationId}`]: true }));
    try {
      const person = detections.find(n => n.id === notificationId);
      if (!person?.id) return;
      if (!window.confirm('Confirm that this is the missing person?')) return;
      setDetections((prev) => prev.map((p) => (p.id === person.id ? { ...p, status: 'CONFIRMED_BY_CITIZEN' } : p)));
      await apiService.citizenConfirmFound(person.id);
      alert('Confirmed. Authority will finalize the match.');
    } catch (error) {
      console.error('Error confirming detection:', error);
      alert(error.response?.data?.error || 'Failed to confirm detection');
    } finally {
      setActionLoading((prev) => ({ ...prev, [`confirm-${notificationId}`]: false }));
    }
  };

  const handleRescan = async (notificationId) => {
    setActionLoading((prev) => ({ ...prev, [`rescan-${notificationId}`]: true }));
    try {
      const person = detections.find(n => n.id === notificationId);
      if (!person?.id) return;
      if (!window.confirm('Request a re-scan?')) return;
      setDetections((prev) => prev.map((p) => (p.id === person.id ? { ...p, status: 'RESCAN_REQUESTED' } : p)));
      await apiService.citizenRescan(person.id);
      alert('Re-scan requested. Authority will restart searching.');
    } catch (error) {
      console.error('Error requesting rescan:', error);
      alert('Failed to request rescan');
    } finally {
      setActionLoading((prev) => ({ ...prev, [`rescan-${notificationId}`]: false }));
    }
  };

  const detectedCount = useMemo(() => detections.length, [detections]);
  
  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

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

      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold text-gray-900">Missing Person Updates</h2>
        {detectedCount > 0 && (
          <span className="px-3 py-1 bg-red-500 text-white rounded-full text-sm font-semibold shadow-sm">
            {detectedCount} New
          </span>
        )}
      </div>
      {feedWarning && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {feedWarning}
        </p>
      )}
      
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-7">
        {detections.length === 0 ? (
          <div className="text-center py-14 rounded-2xl border border-blue-100 bg-blue-50/40">
            <div className="text-6xl mb-4">🔍</div>
            <h3 className="text-xl font-semibold mb-2 text-gray-900">No Updates Yet</h3>
            <p className="text-gray-600">You will be notified here when a reported missing person is detected or found.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {detections.map((person) => {
              const citizenCanAct = person.status === 'DETECTED';
              
              return (
                <div
                  key={person.id}
                  className="border rounded-2xl p-4 md:p-5 bg-amber-50/70 border-amber-200 shadow-sm"
                >
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-3 flex-wrap">
                        <span className="text-2xl">🔍</span>
                        <h4 className="font-semibold text-lg text-gray-900">
                          {(person.name || 'Missing person')} Detected!
                        </h4>
                        <span className="px-2.5 py-1 bg-amber-500 text-white text-xs rounded-full font-semibold">New</span>
                      </div>
                      
                      <div className="mb-4 p-3.5 bg-amber-100/80 rounded-xl border border-amber-200">
                        <p className="text-sm font-semibold text-amber-900 mb-1.5">⚠️ Possible Detection - Please Review</p>
                        <p className="text-sm text-amber-800 leading-relaxed">
                          Authority detected a possible match. Please confirm if this is correct.
                        </p>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                        <ImagePanel
                          title="Missing Person Image"
                          src={person.photo_url}
                          fallbackText="No image"
                        />
                        <ImagePanel
                          title="CCTV Captured Image"
                          src={person.cctv_image}
                          fallbackText="No capture yet"
                        />
                      </div>
                      
                      <p className="text-xs text-gray-600 mt-2">
                        Updated: {formatToIST(person.updated_at || person.last_updated || person.created_at)}
                      </p>
                      <p className="text-sm text-gray-500 mt-1">
                        Case ID: {person.id}
                      </p>
                    </div>
                    <div className="flex flex-col gap-2">
                      {citizenCanAct && (
                        <button
                          onClick={() => handleConfirmDetection(person.id)}
                          disabled={Boolean(actionLoading[`confirm-${person.id}`])}
                          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-semibold shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {actionLoading[`confirm-${person.id}`] ? 'Confirming...' : '✓ Confirm Found'}
                        </button>
                      )}
                      {citizenCanAct && (
                        <button
                          onClick={() => handleRescan(person.id)}
                          disabled={Boolean(actionLoading[`rescan-${person.id}`])}
                          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-semibold shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {actionLoading[`rescan-${person.id}`] ? 'Requesting...' : 'Re-scan'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
