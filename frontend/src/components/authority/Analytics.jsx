/**
 * Analytics Component
 * Displays statistics and charts for authorities
 */

import { useState, useEffect } from 'react';
import { Bar } from 'react-chartjs-2';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../config/firebase';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend
);

export default function Analytics() {
  const [cameras, setCameras] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [missingPersons, setMissingPersons] = useState([]);
  const [loading, setLoading] = useState(true);

  const getTimeMs = (row) => {
    const t = row?.updated_at ?? row?.last_updated ?? row?.created_at;
    if (!t) return 0;
    if (typeof t?.toMillis === 'function') return t.toMillis();
    if (typeof t === 'number') return t;
    const ms = new Date(t).getTime();
    return Number.isFinite(ms) ? ms : 0;
  };
  
  useEffect(() => {
    const unsubCameras = onSnapshot(
      collection(db, 'cctv_cameras'),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => getTimeMs(b) - getTimeMs(a));
        setCameras(list);
      },
      (err) => console.error('Error listening to cameras:', err)
    );
    const unsubAlerts = onSnapshot(
      collection(db, 'alerts'),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => getTimeMs(b) - getTimeMs(a));
        setAlerts(list);
      },
      (err) => console.error('Error listening to alerts:', err)
    );
    const unsubMissing = onSnapshot(
      collection(db, 'missing_persons'),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => getTimeMs(b) - getTimeMs(a));
        setMissingPersons(list);
      },
      (err) => console.error('Error listening to missing persons:', err)
    );

    // First snapshot callback will flip loading off; keep a tiny guard for empty collections.
    const t = setTimeout(() => setLoading(false), 500);
    return () => {
      clearTimeout(t);
      unsubCameras();
      unsubAlerts();
      unsubMissing();
    };
  }, []);
  
  if (loading) {
    return (
      <div className="flex justify-center items-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }
  
  // Crowd level distribution
  const crowdLevelData = {
    labels: ['Low', 'Medium', 'High', 'Critical'],
    datasets: [{
      label: 'Cameras',
      data: [
        cameras.filter(c => c.crowd_level === 'low').length,
        cameras.filter(c => c.crowd_level === 'medium').length,
        cameras.filter(c => c.crowd_level === 'high').length,
        cameras.filter(c => c.crowd_level === 'critical').length
      ],
      backgroundColor: ['#10B981', '#F59E0B', '#F97316', '#EF4444']
    }]
  };
  
  // Alert severity distribution
  const alertSeverityData = {
    labels: ['Info', 'Warning', 'Critical'],
    datasets: [{
      label: 'Alerts',
      data: [
        alerts.filter(a => a.severity === 'info').length,
        alerts.filter(a => a.severity === 'warning').length,
        alerts.filter(a => a.severity === 'critical').length
      ],
      backgroundColor: ['#3B82F6', '#F59E0B', '#EF4444']
    }]
  };
  
  // Missing person status
  const missingStatusData = {
    labels: ['Searching', 'Detected', 'Rescan Requested', 'Confirmed By Citizen', 'Match Confirmed'],
    datasets: [{
      label: 'Missing Persons',
      data: [
        missingPersons.filter(m => m.status === 'SEARCHING').length,
        missingPersons.filter(m => m.status === 'DETECTED').length,
        missingPersons.filter(m => m.status === 'RESCAN_REQUESTED').length,
        missingPersons.filter(m => m.status === 'CONFIRMED_BY_CITIZEN').length,
        missingPersons.filter(m => m.status === 'MATCH_CONFIRMED').length
      ],
      backgroundColor: ['#F59E0B', '#3B82F6', '#F97316', '#A855F7', '#10B981']
    }]
  };
  
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Analytics Dashboard</h2>
      
      {/* Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h3 className="text-sm font-medium text-gray-600 mb-2">Total Cameras</h3>
          <p className="text-3xl font-bold text-blue-600">{cameras.length}</p>
        </div>
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h3 className="text-sm font-medium text-gray-600 mb-2">Active Alerts</h3>
          <p className="text-3xl font-bold text-orange-600">{alerts.filter(a => !a.resolved).length}</p>
        </div>
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h3 className="text-sm font-medium text-gray-600 mb-2">Missing Persons</h3>
          <p className="text-3xl font-bold text-red-600">{missingPersons.filter(m => m.status !== 'found').length}</p>
        </div>
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h3 className="text-sm font-medium text-gray-600 mb-2">Critical Areas</h3>
          <p className="text-3xl font-bold text-red-600">{cameras.filter(c => c.crowd_level === 'critical').length}</p>
        </div>
      </div>
      
      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h3 className="text-xl font-semibold mb-4">Crowd Level Distribution</h3>
          <Bar data={crowdLevelData} options={{ responsive: true }} />
        </div>
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h3 className="text-xl font-semibold mb-4">Alert Severity Distribution</h3>
          <Bar data={alertSeverityData} options={{ responsive: true }} />
        </div>
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h3 className="text-xl font-semibold mb-4">Missing Person Status</h3>
          <Bar data={missingStatusData} options={{ responsive: true }} />
        </div>
      </div>
    </div>
  );
}

