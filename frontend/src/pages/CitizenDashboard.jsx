/**
 * Citizen Dashboard
 * Main dashboard for citizens with crowd map, alerts, route planner, and missing person reporting
 */

import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { logoutUser, db } from '../config/firebase';
import { useNavigate, useLocation } from 'react-router-dom';
import { MapPin, Bell, User, LogOut, ChevronDown, Search } from 'lucide-react';
import BrandLogo from '../components/common/BrandLogo';
import { doc, getDoc, collection, onSnapshot, query, where, limit } from 'firebase/firestore';
import CrowdMap from '../components/citizen/CrowdMap';
import AlertsPanel from '../components/citizen/AlertsPanel';
import MissingPersonReport from '../components/citizen/MissingPersonReport';
import MissingPersonFound from '../components/citizen/MissingPersonFound';
import MissingPersonHistory from '../components/citizen/MissingPersonHistory';
import MyAccount from '../components/MyAccount';
// NOTE: Cameras are now real-time via Firestore listeners (no polling).


export default function CitizenDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Derive active tab from URL — e.g. /citizen/dashboard/alerts → 'alerts'
  const VALID_TABS = ['alerts', 'missing'];
  const pathAfterBase = location.pathname.replace(/\/citizen\/dashboard\/?/, '');
  const segments = pathAfterBase.split('/').filter(Boolean);
  const activeTab = VALID_TABS.includes(segments[0]) ? segments[0] : 'dashboard';

  // Derive missing sub-tab from URL — e.g. /citizen/dashboard/missing/found → 'found'
  const VALID_SUBTABS = ['found', 'history'];
  const missingSubTab = VALID_SUBTABS.includes(segments[1]) ? segments[1] : 'report';

  // Navigation helpers
  const setActiveTab = (id) => {
    if (id === 'dashboard') {
      navigate('/citizen/dashboard');
    } else {
      navigate(`/citizen/dashboard/${id}`);
    }
  };

  const setMissingSubTab = (subtab) => {
    if (subtab === 'report' || !subtab) {
      navigate('/citizen/dashboard/missing');
    } else {
      navigate(`/citizen/dashboard/missing/${subtab}`);
    }
  };

  const [alertCount, setAlertCount] = useState(0);
  const [missingBadgeCount, setMissingBadgeCount] = useState(0);
  const [cameras, setCameras] = useState([]);
  const [cities, setCities] = useState([]);
  const [selectedCity, setSelectedCity] = useState('');
  const [loadingCameras, setLoadingCameras] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showMyAccount, setShowMyAccount] = useState(false);
  const [userName, setUserName] = useState('');
  const userMenuRef = useRef(null);
  const [cityDropdownOpen, setCityDropdownOpen] = useState(false);
  const [citySearchQuery, setCitySearchQuery] = useState('');
  const cityDropdownRef = useRef(null);

  const isActiveAlert = (alert) => {
    const status = alert?.status ? String(alert.status).toUpperCase() : (alert?.resolved ? 'RESOLVED' : 'ACTIVE');
    return status === 'ACTIVE';
  };
  
  const handleLogout = async () => {
    try {
      await logoutUser();
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  // Throttled camera fetch to reduce Firestore read pressure.
  useEffect(() => {
    if (activeTab === 'dashboard') {
      setLoadingCameras(true);
      const qCameras = query(collection(db, 'cctv_cameras'));
      const unsub = onSnapshot(
        qCameras,
        (snap) => {
          const cameraList = snap.docs.map((d) => {
            const data = d.data() || {};
            const cityRaw = data.city ? String(data.city).trim() : '';
            const city = cityRaw ? cityRaw.replace(/\w\S*/g, (w) => (w.replace(/^\w/, (c) => c.toUpperCase()))) : '';
            return { id: d.id, ...data, city };
          });
          setCameras(cameraList);
          const uniqueCities = [...new Set(
            cameraList.map((c) => c.city).filter((city) => city && city !== '')
          )].sort();
          setCities(uniqueCities);
          setSelectedCity((prevCity) => (prevCity && !uniqueCities.includes(prevCity) ? '' : prevCity));
          setLoadingCameras(false);
        },
        (err) => {
          console.error('Error listening to cameras:', err);
          setCameras([]);
          setCities([]);
          setSelectedCity('');
          setLoadingCameras(false);
        }
      );

      return () => unsub();
    }
  }, [activeTab]);

  // Close user menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setShowUserMenu(false);
      }
    };

    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showUserMenu]);

  // Load unresolved alerts count in real-time
  useEffect(() => {
    const alertsQuery = query(
      collection(db, 'alerts'),
      where('published', '==', true),
      limit(20)
    );
    const unsub = onSnapshot(alertsQuery, (snap) => {
      const count = snap.docs
        .map((d) => d.data() || {})
        .filter(isActiveAlert)
        .length;
      setAlertCount(count);
    });
    return () => unsub();
  }, []);

  // Missing person badge count (status-driven, real-time)
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'missing_persons'),
      where('reported_by', '==', user.uid),
      where('status', '==', 'DETECTED'),
      where('notification_sent', '==', true),
      limit(50)
    );
    const unsub = onSnapshot(q, (snap) => setMissingBadgeCount(snap.size));
    return () => unsub();
  }, [user]);

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

  // Load user name from Firestore
  useEffect(() => {
    const loadUserName = async () => {
      if (user) {
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            const name = userData.name || user.email?.split('@')[0] || 'User';
            setUserName(name);
          } else {
            const name = user.email?.split('@')[0] || 'User';
            setUserName(name);
          }
        } catch (err) {
          console.error('Error loading user name:', err);
          const name = user.email?.split('@')[0] || 'User';
          setUserName(name);
        }
      }
    };
    loadUserName();
  }, [user]);

  // Get username from email
  const getUsername = () => {
    if (userName) {
      return userName;
    }
    if (user?.email) {
      return user.email.split('@')[0];
    }
    return 'User';
  };

  const NavCard = ({ id, title, description, icon: Icon, colorClass, bgClass, badgeCount, badgeColor = 'bg-red-500' }) => (
    <div 
      onClick={() => setActiveTab(id)}
      className={`relative bg-white rounded-xl p-6 border transition-all cursor-pointer flex items-start gap-4 ${
        activeTab === id 
          ? 'border-blue-500 shadow-md ring-1 ring-blue-500' 
          : 'border-gray-100 shadow-sm hover:shadow-md hover:border-blue-200'
      }`}
    >
      {typeof badgeCount === 'number' && (
        <span className={`absolute top-3 right-3 ${badgeColor} text-white text-xs font-semibold w-5 h-5 rounded-full flex items-center justify-center`}>
          {badgeCount}
        </span>
      )}
      <div className={`p-3 rounded-lg ${bgClass}`}>
        <Icon className={`w-6 h-6 ${colorClass}`} />
      </div>
      <div>
        <h3 className={`font-semibold ${activeTab === id ? 'text-blue-600' : 'text-gray-900'}`}>{title}</h3>
        <p className="text-sm text-gray-500 mt-1">{description}</p>
      </div>
    </div>
  );
  
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center cursor-pointer" onClick={() => setActiveTab('dashboard')}>
              <div>
                <BrandLogo titleClassName="text-xl" iconClassName="text-xl" />
                <span className="inline-block px-2 py-0.5 bg-green-100 text-green-800 text-xs font-medium rounded">
                  Citizen Dashboard
                </span>
              </div>
            </div>
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center justify-center w-10 h-10 rounded-full border-2 border-gray-300 hover:border-gray-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <User className="w-6 h-6 text-gray-600" />
              </button>
              
              {showUserMenu && (
                <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
                  <div className="px-4 py-3 border-b border-gray-200">
                    <p className="text-sm font-semibold text-gray-900">{getUsername()}</p>
                    <p className="text-sm text-gray-600 truncate">{user?.email}</p>
                  </div>
                  <div className="py-1">
                    <button
                      onClick={() => {
                        setShowUserMenu(false);
                        setShowMyAccount(true);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                    >
                      <User className="w-4 h-4" />
                      <span>My Account</span>
                    </button>
                    <button
                      onClick={() => {
                        setShowUserMenu(false);
                        handleLogout();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Sign out</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Navigation Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <NavCard 
            id="dashboard"
            title="Live Crowd Map"
            description="View real-time crowd density in your area"
            icon={MapPin}
            colorClass="text-blue-600"
            bgClass="bg-blue-50"
          />
          <NavCard 
            id="alerts"
            title="Alert Center"
            description="Stay informed about crowd conditions"
            icon={Bell}
            colorClass="text-blue-600"
            bgClass="bg-blue-50"
            badgeCount={alertCount}
            badgeColor="bg-orange-500"
          />
          <NavCard 
            id="missing"
            title="Report Missing"
            description="Report or search for missing individuals"
            icon={User}
            colorClass="text-red-600"
            bgClass="bg-red-50"
            badgeCount={missingBadgeCount}
            badgeColor="bg-red-500"
          />
        </div>

        {/* Content Area */}
        <div className="min-h-[600px]">
          {activeTab === 'dashboard' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-gray-900">Live Crowd Map</h2>
                <div className="flex items-center space-x-2">
                  {loadingCameras && (
                    <span className="text-xs text-gray-500">Loading...</span>
                  )}
                  <div className="relative" ref={cityDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setCityDropdownOpen(!cityDropdownOpen)}
                      disabled={cities.length === 0 || loadingCameras}
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
                </div>
              </div>
              <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden h-[600px]">
                <CrowdMap minimal={true} selectedCity={selectedCity} cameras={cameras} />
              </div>
            </div>
          )}
          
          {activeTab === 'alerts' && <AlertsPanel />}
          
          
          {activeTab === 'missing' && (
            <div className="space-y-6">
              <div className="flex gap-4 border-b">
                <button
                  onClick={() => setMissingSubTab('report')}
                  className={`px-4 py-2 ${
                    missingSubTab === 'report'
                      ? 'border-b-2 border-blue-600 text-blue-600 font-medium'
                      : 'text-gray-600 hover:text-blue-600'
                  }`}
                >
                  Report Missing Person
                </button>
                <button
                  onClick={() => setMissingSubTab('found')}
                  className={`px-4 py-2 ${
                    missingSubTab === 'found'
                      ? 'border-b-2 border-blue-600 text-blue-600 font-medium'
                      : 'text-gray-600 hover:text-blue-600'
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    <span className="relative inline-flex">
                      <Bell className={`w-4 h-4 ${missingSubTab === 'found' ? 'text-blue-600' : 'text-gray-500'}`} />
                      <span
                        aria-label="Unread notifications"
                        className={`absolute -top-1 -right-1 w-4 h-4 rounded-full text-[10px] font-semibold flex items-center justify-center ${
                          missingBadgeCount > 0 ? 'bg-blue-600 text-white' : 'bg-gray-300 text-gray-700'
                        }`}
                      >
                        {missingBadgeCount > 9 ? '9+' : missingBadgeCount}
                      </span>
                    </span>
                    <span>Found Notifications</span>
                  </span>
                </button>
                <button
                  onClick={() => setMissingSubTab('history')}
                  className={`px-4 py-2 ${
                    missingSubTab === 'history'
                      ? 'border-b-2 border-blue-600 text-blue-600 font-medium'
                      : 'text-gray-600 hover:text-blue-600'
                  }`}
                >
                  Found History
                </button>
              </div>
              {missingSubTab === 'report' && <MissingPersonReport />}
              {missingSubTab === 'found' && <MissingPersonFound />}
              {missingSubTab === 'history' && <MissingPersonHistory />}
            </div>
          )}
        </div>
      </main>

      {/* My Account Modal */}
      <MyAccount isOpen={showMyAccount} onClose={() => setShowMyAccount(false)} />
    </div>
  );
}
