/**
 * Protected Route Component
 * Ensures only authenticated users (and optionally specific roles) can access routes
 */

import { Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

export default function ProtectedRoute({ children, requiredRole }) {
  const { user, role, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }
  
  if (!user) {
    return <Navigate to="/login" />;
  }
  
  // Check role if required
  if (requiredRole && role !== requiredRole) {
    return <Navigate to="/unauthorized" />;
  }
  
  return children;
}

