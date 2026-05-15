/**
 * Main App Component
 * Sets up routing and authentication context
 */

import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import ProtectedRoute from './components/common/ProtectedRoute';
import Login from './pages/Login';
import Register from './pages/Register';
import Home from './pages/Home';
import CitizenDashboard from './pages/CitizenDashboard';
import AuthorityDashboard from './pages/AuthorityDashboard';
import Unauthorized from './pages/Unauthorized';

function App() {
  const { user, role, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }
  
  return (
    <Router>
      <Routes>
        {/* Public routes */}
        <Route path="/" element={<Home />} />
        <Route path="/login" element={
          user ? <Navigate to={role === 'authority' ? '/authority/dashboard' : '/citizen/dashboard'} /> : <Login />
        } />
        <Route path="/register" element={
          user ? <Navigate to={role === 'authority' ? '/authority/dashboard' : '/citizen/dashboard'} /> : <Register />
        } />
        
        {/* Protected routes */}
        <Route path="/citizen/dashboard/*" element={
          <ProtectedRoute requiredRole="citizen">
            <CitizenDashboard />
          </ProtectedRoute>
        } />
        <Route path="/authority/dashboard/*" element={
          <ProtectedRoute requiredRole="authority">
            <AuthorityDashboard />
          </ProtectedRoute>
        } />
        
        {/* Unauthorized page */}
        <Route path="/unauthorized" element={<Unauthorized />} />
        
        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Router>
  );
}

export default App;

