/**
 * Register Page
 * Redesigned to match landing page aesthetic — split layout, glassmorphism, framer-motion.
 * Auth logic is unchanged.
 */

import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { registerUser } from '../config/firebase';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Lock,
  Mail,
  User,
  ChevronRight,
  Eye,
  EyeOff,
  Shield,
  Users,
  Bell,
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
    transition: { staggerChildren: 0.07, delayChildren: 0.1 },
  },
};

const roleCards = [
  {
    value: 'citizen',
    label: 'Citizen',
    description: 'View crowd maps, receive alerts, report missing persons.',
    icon: Users,
    accent: 'cyan',
  },
  {
    value: 'authority',
    label: 'Authority',
    description: 'Manage CCTV, publish alerts, run face-search workflows.',
    icon: Shield,
    accent: 'indigo',
  },
];

const highlights = [
  { icon: Shield, text: 'RBAC — Citizen & Authority access' },
  { icon: Bell, text: 'Real-time alerts & notifications' },
  { icon: Users, text: 'Collaborative safety workflows' },
];

export default function Register() {
  const [searchParams] = useSearchParams();
  // Pre-select role from URL param (?role=authority or ?role=citizen)
  const initialRole = searchParams.get('role') === 'authority' ? 'authority' : 'citizen';

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    role: initialRole,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    try {
      const { role } = await registerUser(
        formData.email,
        formData.password,
        formData.name,
        formData.role,
      );
      if (role === 'authority') {
        navigate('/authority/dashboard');
      } else {
        navigate('/citizen/dashboard');
      }
    } catch (err) {
      setError(err.message || 'Failed to register. Please try again.');
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
        className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative"
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
            Join the{' '}
            <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              Safety Network
            </span>
          </motion.h2>

          <motion.p variants={itemVariants} className="mt-4 text-base text-slate-600 leading-relaxed">
            Choose your role and start contributing to a smarter, safer community — in real time.
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
      <div className="w-full lg:w-1/2 flex flex-col items-center justify-center px-6 py-12 sm:px-12 overflow-y-auto">
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
            <div className="mb-8">
              <h1 className="text-2xl font-extrabold text-slate-900">Create your account</h1>
              <p className="mt-1.5 text-sm text-slate-500">Get started with CrowdSafe in seconds</p>
            </div>

            {/* Error */}
            {error && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mb-6 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
              >
                {error}
              </motion.div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Role selector — visual cards */}
              <motion.div variants={itemVariants}>
                <label className="block text-sm font-semibold text-slate-700 mb-3">
                  I am registering as
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {roleCards.map(({ value, label, description, icon: Icon, accent }) => {
                    const selected = formData.role === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setFormData({ ...formData, role: value })}
                        className={`relative flex flex-col items-start gap-2 p-4 rounded-xl border-2 text-left transition-all focus:outline-none ${
                          selected
                            ? accent === 'indigo'
                              ? 'border-indigo-500 bg-indigo-50 shadow-md shadow-indigo-100'
                              : 'border-cyan-500 bg-cyan-50 shadow-md shadow-cyan-100'
                            : 'border-slate-200 bg-slate-50 hover:border-slate-300'
                        }`}
                      >
                        <div
                          className={`p-2 rounded-lg ${
                            selected
                              ? accent === 'indigo'
                                ? 'bg-indigo-100'
                                : 'bg-cyan-100'
                              : 'bg-white'
                          }`}
                        >
                          <Icon
                            className={`w-4 h-4 ${
                              selected
                                ? accent === 'indigo'
                                  ? 'text-indigo-600'
                                  : 'text-cyan-600'
                                : 'text-slate-400'
                            }`}
                          />
                        </div>
                        <div>
                          <p className={`text-sm font-semibold ${selected ? 'text-slate-900' : 'text-slate-600'}`}>
                            {label}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5 leading-snug">{description}</p>
                        </div>
                        {selected && (
                          <span
                            className={`absolute top-2 right-2 w-2 h-2 rounded-full ${
                              accent === 'indigo' ? 'bg-indigo-500' : 'bg-cyan-500'
                            }`}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </motion.div>

              {/* Full Name */}
              <motion.div variants={itemVariants}>
                <label htmlFor="name" className="block text-sm font-semibold text-slate-700 mb-2">
                  Full Name
                </label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    required
                    placeholder="John Doe"
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-white transition-all"
                  />
                </div>
              </motion.div>

              {/* Email */}
              <motion.div variants={itemVariants}>
                <label htmlFor="email" className="block text-sm font-semibold text-slate-700 mb-2">
                  Email address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    required
                    placeholder="you@example.com"
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-white transition-all"
                  />
                </div>
              </motion.div>

              {/* Password */}
              <motion.div variants={itemVariants}>
                <label htmlFor="password" className="block text-sm font-semibold text-slate-700 mb-2">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    id="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    required
                    minLength={6}
                    placeholder="Min. 6 characters"
                    className="w-full pl-10 pr-12 py-3 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-white transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </motion.div>

              {/* Confirm Password */}
              <motion.div variants={itemVariants}>
                <label htmlFor="confirmPassword" className="block text-sm font-semibold text-slate-700 mb-2">
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    id="confirmPassword"
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleChange}
                    required
                    minLength={6}
                    placeholder="Re-enter password"
                    className={`w-full pl-10 pr-12 py-3 rounded-xl border bg-slate-50 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:bg-white transition-all ${
                      formData.confirmPassword && formData.password !== formData.confirmPassword
                        ? 'border-red-300 focus:ring-red-400'
                        : 'border-slate-200 focus:ring-blue-500 focus:border-transparent'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {formData.confirmPassword && formData.password !== formData.confirmPassword && (
                  <p className="mt-1.5 text-xs text-red-600">Passwords do not match</p>
                )}
              </motion.div>

              {/* Submit */}
              <motion.div variants={itemVariants} className="pt-2">
                <motion.button
                  type="submit"
                  disabled={loading}
                  whileHover={!loading ? { scale: 1.02 } : {}}
                  whileTap={!loading ? { scale: 0.98 } : {}}
                  className="group w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3.5 text-sm font-semibold text-white hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                      Creating account...
                    </>
                  ) : (
                    <>
                      Create Account
                      <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </motion.button>
              </motion.div>
            </form>
          </motion.div>

          {/* Login link */}
          <motion.p
            variants={itemVariants}
            className="mt-6 text-center text-sm text-slate-500"
          >
            Already have an account?{' '}
            <Link
              to={`/login?role=${formData.role}`}
              className="font-semibold text-blue-600 hover:text-blue-700 transition-colors"
            >
              Sign in here
            </Link>
          </motion.p>
        </motion.div>
      </div>
    </div>
  );
}
