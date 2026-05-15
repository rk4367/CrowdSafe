/**
 * Login Page
 * Enforces role-based portal validation:
 *   - Citizen portal accepts ONLY citizen credentials
 *   - Authority portal accepts ONLY authority credentials
 * Auth logic reads ?role= param from URL to pre-select portal.
 */

import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { loginUser, logoutUser } from '../config/firebase';
import { auth } from '../config/firebase';
import { fetchSignInMethodsForEmail } from 'firebase/auth';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Lock,
  Mail,
  ChevronRight,
  Eye,
  EyeOff,
  Shield,
  Activity,
  Users,
  AlertTriangle,
} from 'lucide-react';
import BrandLogo from '../components/common/BrandLogo';

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: { y: 0, opacity: 1, transition: { duration: 0.4 } },
};

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.1 },
  },
};

const highlights = [
  { icon: Shield, text: 'RBAC — Citizen & Authority access' },
  { icon: Activity, text: '24/7 real-time crowd monitoring' },
  { icon: Users, text: 'Automated missing-person detection' },
];

// Portal config
const PORTALS = {
  citizen: {
    label: 'Citizen Portal',
    heading: 'Welcome back, Citizen',
    description: 'Sign in to access the crowd map, alerts, and missing person tools.',
    accent: 'cyan',
    activeBg: 'bg-cyan-500',
    activeText: 'text-white',
    badge: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    ring: 'focus:ring-cyan-500',
  },
  authority: {
    label: 'Authority Portal',
    heading: 'Welcome back, Authority',
    description: 'Sign in to access CCTV management, alerts, analytics, and face-search tools.',
    accent: 'indigo',
    activeBg: 'bg-blue-600',
    activeText: 'text-white',
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
    ring: 'focus:ring-blue-500',
  },
};

// Maps Firebase auth error codes → user-friendly messages
function getFriendlyError(err) {
  const code = err?.code || '';
  switch (code) {
    case 'auth/user-not-found':
      return 'No account found with this email address. Please register first.';
    case 'auth/wrong-password':
      return 'Incorrect password. Please try again.';
    // Newer Firebase SDK merges user-not-found + wrong-password:
    // handled separately in handleSubmit via fetchSignInMethodsForEmail
    case 'auth/invalid-credential':
      return 'Incorrect email or password. Please check and try again.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Please wait a moment and try again.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact support.';
    case 'auth/network-request-failed':
      return 'Network error. Please check your internet connection.';
    case 'auth/email-already-in-use':
      return 'This email is already registered. Try logging in instead.';
    default:
      return err?.message || 'Something went wrong. Please try again.';
  }
}

export default function Login() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialPortal = searchParams.get('role') === 'authority' ? 'authority' : 'citizen';

  const [portal, setPortal] = useState(initialPortal);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const cfg = PORTALS[portal];

  const switchPortal = (p) => {
    setPortal(p);
    setSearchParams({ role: p });
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { role: userRole } = await loginUser(email, password);

      // ── Role validation: user's Firestore role MUST match selected portal ──
      if (userRole !== portal) {
        await logoutUser(); // sign out immediately
        const expected = PORTALS[portal].label;
        const actual = PORTALS[userRole]?.label ?? userRole;
        setError(
          `Access denied. This is the ${expected}. Your account is registered as ${actual}. Please switch to the correct portal.`
        );
        return;
      }

      // ── Role matches → navigate to correct dashboard ──
      if (userRole === 'authority') {
        navigate('/authority/dashboard');
      } else {
        navigate('/citizen/dashboard');
      }
    } catch (err) {
      // Firebase v10 throws auth/invalid-credential for BOTH wrong email AND wrong password.
      // Use fetchSignInMethodsForEmail to tell them apart and give a specific message.
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found') {
        try {
          const methods = await fetchSignInMethodsForEmail(auth, email);
          if (methods.length === 0) {
            // No Firebase Auth account with this email
            setError('No account found with this email address. Please register first.');
          } else {
            // Account exists but password is wrong
            setError('Incorrect password. Please try again.');
          }
        } catch {
          // fetchSignInMethodsForEmail blocked (email enumeration protection) → generic message
          setError('Incorrect email or password. Please check and try again.');
        }
      } else {
        setError(getFriendlyError(err));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-slate-50 flex overflow-hidden">
      {/* ── Background blobs ── */}
      <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-blue-200/40 rounded-full blur-3xl" />
        <div className="absolute top-[20%] right-[-5%] w-[30rem] h-[30rem] bg-indigo-200/30 rounded-full blur-[100px]" />
        <div className="absolute bottom-[-10%] left-[20%] w-[25rem] h-[25rem] bg-cyan-200/30 rounded-full blur-[80px]" />
      </div>

      {/* ── LEFT PANEL — Branding ── */}
      <motion.div
        initial={{ opacity: 0, x: -40 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.6 }}
        className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12"
      >
        <motion.button
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-blue-600 transition-colors group w-fit"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          Back to Home
        </motion.button>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="flex-1 flex flex-col justify-center max-w-md"
        >
          <motion.div variants={itemVariants} className="mb-8">
            <BrandLogo titleClassName="text-3xl" iconClassName="text-3xl" />
          </motion.div>

          <motion.h2
            variants={itemVariants}
            className="text-4xl font-extrabold text-slate-900 tracking-tight leading-tight"
          >
            Public Safety Through{' '}
            <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              Smart Intelligence
            </span>
          </motion.h2>

          <motion.p variants={itemVariants} className="mt-4 text-base text-slate-600 leading-relaxed">
            {cfg.description}
          </motion.p>

          <motion.div variants={containerVariants} className="mt-10 space-y-4">
            {highlights.map(({ icon: Icon, text }) => (
              <motion.div
                key={text}
                variants={itemVariants}
                className="flex items-center gap-3 p-3 rounded-xl bg-white/60 backdrop-blur-sm border border-white/50 shadow-sm"
              >
                <div className="p-2 rounded-lg bg-blue-50">
                  <Icon className="w-4 h-4 text-blue-600" />
                </div>
                <span className="text-sm font-medium text-slate-700">{text}</span>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="inline-flex items-center gap-2 rounded-full border border-blue-200/60 bg-blue-50/80 backdrop-blur-sm px-4 py-1.5 text-xs font-semibold text-blue-700 w-fit"
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-600" />
          </span>
          Real-Time Monitoring Active
        </motion.div>
      </motion.div>

      {/* ── RIGHT PANEL — Form ── */}
      <div className="w-full lg:w-1/2 flex flex-col items-center justify-center px-6 py-12 sm:px-12">
        {/* Mobile back button */}
        <motion.button
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          onClick={() => navigate('/')}
          className="lg:hidden self-start mb-8 inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-blue-600 transition-colors group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
          Back to Home
        </motion.button>

        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="w-full max-w-md"
        >
          {/* Mobile logo */}
          <motion.div variants={itemVariants} className="lg:hidden mb-8 flex justify-center">
            <BrandLogo titleClassName="text-2xl" iconClassName="text-2xl" />
          </motion.div>

          {/* Card */}
          <motion.div
            variants={itemVariants}
            className="rounded-2xl border border-white/60 bg-white/80 backdrop-blur-md shadow-xl shadow-slate-200/60 p-8 sm:p-10"
          >
            {/* ── Portal Toggle ── */}
            <div className="mb-8">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
                Select Your Portal
              </p>
              <div className="flex rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                <button
                  type="button"
                  onClick={() => switchPortal('citizen')}
                  className={`flex-1 py-2.5 px-4 text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2 ${
                    portal === 'citizen'
                      ? 'bg-cyan-500 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <Users className="w-4 h-4" />
                  Citizen
                </button>
                <button
                  type="button"
                  onClick={() => switchPortal('authority')}
                  className={`flex-1 py-2.5 px-4 text-sm font-semibold transition-all duration-200 flex items-center justify-center gap-2 ${
                    portal === 'authority'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <Shield className="w-4 h-4" />
                  Authority
                </button>
              </div>
            </div>

            {/* Heading */}
            <div className="mb-6">
              <h1 className="text-2xl font-extrabold text-slate-900">{cfg.heading}</h1>
              <p className="mt-1.5 text-sm text-slate-500">
                Sign in to your CrowdSafe account
              </p>
            </div>

            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="mb-6 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2"
                >
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-red-500" />
                  <span>{error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Email */}
              <div>
                <label htmlFor="email" className="block text-sm font-semibold text-slate-700 mb-2">
                  Email address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="email"
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="you@example.com"
                    className={`w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 ${cfg.ring} focus:border-transparent focus:bg-white transition-all`}
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label htmlFor="password" className="block text-sm font-semibold text-slate-700 mb-2">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="••••••••"
                    className={`w-full pl-10 pr-12 py-3 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 ${cfg.ring} focus:border-transparent focus:bg-white transition-all`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Submit */}
              <div className="pt-2">
                <motion.button
                  type="submit"
                  disabled={loading}
                  whileHover={!loading ? { scale: 1.02 } : {}}
                  whileTap={!loading ? { scale: 0.98 } : {}}
                  className={`group w-full flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-sm font-semibold text-white transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed ${
                    portal === 'citizen'
                      ? 'bg-cyan-500 hover:bg-cyan-600 shadow-cyan-500/25 hover:shadow-cyan-500/30'
                      : 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/25 hover:shadow-blue-500/30'
                  }`}
                >
                  {loading ? (
                    <>
                      <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                      Signing in...
                    </>
                  ) : (
                    <>
                      Sign In to {cfg.label}
                      <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </motion.button>
              </div>
            </form>
          </motion.div>

          {/* Register link */}
          <motion.p
            variants={itemVariants}
            className="mt-6 text-center text-sm text-slate-500"
          >
            Don&apos;t have an account?{' '}
            <Link
              to={`/register?role=${portal}`}
              className="font-semibold text-blue-600 hover:text-blue-700 transition-colors"
            >
              Register here
            </Link>
          </motion.p>
        </motion.div>
      </div>
    </div>
  );
}
