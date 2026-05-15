import { useState, useEffect } from 'react';
import { formatToIST } from '../../utils/time';
import { db } from '../../config/firebase';
import { collection, onSnapshot, query, where, limit } from 'firebase/firestore';

const getAlertStatus = (alert) => {
  if (alert?.status) return String(alert.status).toUpperCase();
  return alert?.resolved ? 'RESOLVED' : 'ACTIVE';
};

export default function AlertsPanel() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const alertsQuery = query(
      collection(db, 'alerts'),
      where('published', '==', true),
      limit(20)
    );
    const unsub = onSnapshot(alertsQuery, (snap) => {
      const list = [];
      snap.forEach((doc) => {
        const data = doc.data();
        list.push({
          id: doc.id,
          ...data,
          created_at: data.created_at,
          published_at: data.published_at,
          resolved_at: data.resolved_at
        });
      });
      const activePublished = list.filter((alert) => getAlertStatus(alert) === 'ACTIVE');
      activePublished.sort((a, b) => {
        const aMs = typeof a.created_at?.toMillis === 'function' ? a.created_at.toMillis() : new Date(a.created_at).getTime();
        const bMs = typeof b.created_at?.toMillis === 'function' ? b.created_at.toMillis() : new Date(b.created_at).getTime();
        return bMs - aMs;
      });
      setAlerts(activePublished);
      setLoading(false);
    });
    return () => unsub();
  }, []);
  
  const getTypeColorStyle = (type) => {
    const t = String(type || '').toLowerCase();
    if (t === 'fire') return 'bg-red-50 border-red-500 text-red-900';
    if (t === 'smoke') return 'bg-orange-50 border-orange-500 text-orange-900';
    return 'bg-blue-50 border-blue-500 text-blue-900';
  };
  
  const getTypeIcon = (type) => {
    switch (type) {
      case 'crowd': return '👥';
      case 'fire': return '🔥';
      case 'smoke': return '💨';
      case 'emergency': return '🚨';
      default: return '⚠️';
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
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-7">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
          <span>📢</span> Public Alerts
        </h2>
        {alerts.length > 0 && (
          <span className="px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-200 shadow-sm flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
            {alerts.length} Active Alert{alerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      
      {alerts.length === 0 ? (
        <div className="text-center py-14 rounded-2xl border border-emerald-100 bg-emerald-50/40 hover:bg-emerald-50/60 transition-colors duration-300">
          <div className="text-6xl mb-4 transform hover:scale-110 transition-transform duration-300">🛡️</div>
          <h3 className="text-xl font-semibold mb-2 text-emerald-900">No Active Alerts</h3>
          <p className="text-emerald-700 text-sm font-medium">All clear! The area is currently safe. ✨</p>
        </div>
      ) : (
        <div className="space-y-4">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`relative overflow-hidden border-l-4 p-4 rounded-xl shadow-sm hover:shadow-md transition-all duration-200 ${getTypeColorStyle(alert.type)}`}
            >
              <div className="absolute right-[-10px] top-1/2 -translate-y-1/2 text-8xl opacity-[0.03] pointer-events-none select-none">
                {getTypeIcon(alert.type)}
              </div>
              <div className="flex items-start justify-between gap-3 relative z-10">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-2xl drop-shadow-sm">{getTypeIcon(alert.type)}</span>
                    <span className={`px-2.5 py-1 rounded text-xs font-semibold tracking-wide uppercase shadow-sm ${
                      String(alert.type).toLowerCase() === 'fire' ? 'bg-red-100 text-red-700 border border-red-200' :
                      String(alert.type).toLowerCase() === 'smoke' ? 'bg-orange-100 text-orange-700 border border-orange-200' :
                      'bg-blue-100 text-blue-700 border border-blue-200'
                    }`}>
                      {alert.type || 'UNKNOWN'}
                    </span>
                    <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold uppercase shadow-sm flex items-center gap-1 ${
                      alert.severity === 'critical' ? 'bg-red-600 text-white' :
                      alert.severity === 'warning' ? 'bg-orange-500 text-white' :
                      alert.severity === 'info' ? 'bg-blue-600 text-white' :
                      'bg-gray-600 text-white'
                    }`}>
                      {alert.severity === 'critical' && '⚡'}
                      {alert.severity}
                    </span>
                  </div>
                  <p className="text-sm mb-3 text-gray-800 leading-relaxed font-medium">{alert.message}</p>
                  <div className="text-xs text-gray-700 flex flex-wrap items-center gap-x-3 gap-y-2 mt-2">
                    <span className="flex items-center gap-1.5 px-2.5 py-1 bg-white/60 rounded-md border border-white/40 shadow-sm backdrop-blur-sm">
                      <span className="text-sm">📍</span>
                      <span className="font-semibold">{alert.location_name || 'Unknown location'}</span>
                    </span>
                    <span className="flex items-center gap-1.5 px-2.5 py-1 bg-white/60 rounded-md border border-white/40 shadow-sm backdrop-blur-sm">
                      <span className="text-sm">🕐</span>
                      <span className="font-semibold">{formatToIST(alert.created_at)}</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
