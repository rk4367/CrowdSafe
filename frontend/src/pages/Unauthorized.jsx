/**
 * Unauthorized Page
 * Shown when user tries to access restricted content
 */

import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function Unauthorized() {
  const { role } = useAuth();
  // Send each role to their own dashboard; unauthenticated users go to login
  const dashboardPath =
    role === 'authority'
      ? '/authority/dashboard'
      : role === 'citizen'
      ? '/citizen/dashboard'
      : '/login';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-red-600 mb-4">403</h1>
        <h2 className="text-2xl font-semibold text-gray-800 mb-4">Access Denied</h2>
        <p className="text-gray-600 mb-8">
          You don&apos;t have permission to access this page.
        </p>
        <Link
          to={dashboardPath}
          className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
        >
          Go to My Dashboard
        </Link>
      </div>
    </div>
  );
}
