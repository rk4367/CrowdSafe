import { Link } from 'react-router-dom';
import {
  Activity,
  Bell,
  Camera,
  CheckCircle2,
  Map,
  Search,
  Users,
  ChevronRight
} from 'lucide-react';
import { motion } from 'framer-motion';
import BrandLogo from '../components/common/BrandLogo';

const citizenFeatures = [
  { title: 'Live Crowd Map', description: 'View crowd density by location and city filters.', icon: Map },
  { title: 'Public Alerts', description: 'Track authority-published active alerts in real time.', icon: Bell },
  { title: 'Missing Person Reporting', description: 'Submit reports with photos and last-seen details.', icon: Search },
];

const authorityFeatures = [
  { title: 'CCTV Integration', description: 'Manage streams, camera locations, and health checks.', icon: Camera },
  { title: 'Real-Time Alerts', description: 'Create, publish, and resolve public safety alerts.', icon: Activity },
  { title: 'Face Search Workflow', description: 'Review detections and control rescan/confirm flow.', icon: Users },
];

const platformStats = [
  { value: '24/7', label: 'Background Monitoring' },
  { value: '4 CV Pipelines', label: 'Crowd, Fire, Smoke, Face' },
  { value: 'Realtime', label: 'Firestore Dashboard Sync' },
  { value: 'RBAC', label: 'Citizen + Authority Access' },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: { y: 0, opacity: 1 }
};

function FeatureList({ features, accentClass }) {
  return (
    <div className="space-y-4">
      {features.map((feature) => {
        const Icon = feature.icon;
        return (
          <motion.div 
            key={feature.title} 
            variants={itemVariants}
            className="flex items-start gap-4 p-3 rounded-xl hover:bg-slate-50 transition-colors"
          >
            <div className={`mt-0.5 rounded-xl p-2.5 ${accentClass}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-base font-semibold text-slate-900">{feature.title}</p>
              <p className="text-sm text-slate-600 mt-1">{feature.description}</p>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen w-full bg-slate-50 font-sans text-slate-900 overflow-hidden">
      {/* Background Blobs */}
      <div className="fixed top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-blue-200/40 rounded-full blur-3xl" />
        <div className="absolute top-[20%] right-[-5%] w-[30rem] h-[30rem] bg-indigo-200/30 rounded-full blur-[100px]" />
        <div className="absolute bottom-[-10%] left-[20%] w-[25rem] h-[25rem] bg-cyan-200/30 rounded-full blur-[80px]" />
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <motion.header 
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="flex flex-col gap-4 rounded-2xl border border-white/50 bg-white/70 backdrop-blur-md px-6 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sticky top-4 z-50"
        >
          <BrandLogo subtitle="Real-Time Crowd Management System" />
          <div className="flex w-full items-center gap-3 sm:w-auto">
            <Link
              to="/register?role=citizen"
              className="flex-1 rounded-xl border border-cyan-300 bg-cyan-50 px-4 py-2.5 text-center text-sm font-semibold text-cyan-700 hover:bg-cyan-100 transition-all sm:flex-none shadow-sm"
            >
              Register as Citizen
            </Link>
            <Link
              to="/register?role=authority"
              className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-blue-700 hover:shadow-md hover:shadow-blue-500/20 transition-all sm:flex-none"
            >
              Register as Authority
            </Link>
          </div>
        </motion.header>

        <main className="pt-12 sm:pt-16 lg:pt-20 pb-16">
          {/* Hero Section */}
          <motion.section 
            initial="hidden"
            animate="visible"
            variants={containerVariants}
            className="relative mx-auto max-w-4xl text-center z-10"
          >
            <motion.div variants={itemVariants} className="inline-flex items-center gap-2 rounded-full border border-blue-200/60 bg-blue-50/80 backdrop-blur-sm px-4 py-1.5 text-sm font-semibold text-blue-700 shadow-sm mb-8">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-500 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-600"></span>
              </span>
              Real-Time Monitoring Active
            </motion.div>
            
            <motion.h1 variants={itemVariants} className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl lg:text-7xl">
              Public Safety Through
              <span className="block mt-2 bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">Smart Crowd Intelligence</span>
            </motion.h1>
            
            <motion.p variants={itemVariants} className="mx-auto mt-6 max-w-2xl text-lg text-slate-600 leading-relaxed">
              CrowdSafe helps citizens and authorities collaborate using live CCTV analytics,
              emergency alerts, and structured missing-person workflows.
            </motion.p>
            
            <motion.div variants={itemVariants} className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row sm:gap-6">
              <Link
                to="/login?role=citizen"
                className="group flex w-full sm:w-auto items-center justify-center gap-2 rounded-2xl bg-white border border-slate-200 px-8 py-4 text-base font-semibold text-slate-800 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 transition-all shadow-sm hover:shadow-md"
              >
                Access Citizen Portal
                <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link
                to="/login?role=authority"
                className="group flex w-full sm:w-auto items-center justify-center gap-2 rounded-2xl bg-blue-600 px-8 py-4 text-base font-semibold text-white hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30"
              >
                Access Authority Dashboard
                <ChevronRight className="h-4 w-4 text-blue-200 group-hover:text-white group-hover:translate-x-1 transition-transform" />
              </Link>
            </motion.div>
          </motion.section>

          {/* Stats Section */}
          <motion.section 
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="mt-20 sm:mt-28 grid grid-cols-2 gap-4 sm:grid-cols-4"
          >
            {platformStats.map((item) => (
              <motion.div 
                key={item.label}
                whileHover={{ y: -5 }}
                className="rounded-2xl border border-white/60 bg-white/50 backdrop-blur-sm p-6 text-center shadow-sm hover:shadow-md transition-shadow"
              >
                <p className="text-3xl font-extrabold text-blue-600">{item.value}</p>
                <p className="mt-2 text-sm font-medium text-slate-600">{item.label}</p>
              </motion.div>
            ))}
          </motion.section>

          {/* Dashboards Feature Section */}
          <section className="mt-24 sm:mt-32">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-12"
            >
              <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Comprehensive Safety Platform</h2>
              <p className="mt-4 text-lg text-slate-600 max-w-2xl mx-auto">
                Two focused dashboards built seamlessly for different stakeholders to collaborate effectively during critical moments.
              </p>
            </motion.div>

            <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
              <motion.article 
                initial={{ opacity: 0, x: -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                whileHover={{ scale: 1.01 }}
                className="rounded-[2rem] border border-slate-200 bg-white p-8 sm:p-10 shadow-lg shadow-slate-200/50 relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-50 rounded-full blur-3xl -z-10 translate-x-1/2 -translate-y-1/2"></div>
                
                <h3 className="text-2xl font-bold text-slate-900">Citizens Dashboard</h3>
                <p className="mt-3 text-base text-slate-600">
                  Stay informed with real-time crowd awareness, report missing persons, and receive area-based safety alerts instantly.
                </p>
                <div className="mt-8">
                  <FeatureList
                    features={citizenFeatures}
                    accentClass="bg-cyan-100 text-cyan-700"
                  />
                </div>
                <Link
                  to="/login?role=citizen"
                  className="mt-10 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-800 transition-colors shadow-md"
                >
                  Explore Citizen Portal
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </motion.article>

              <motion.article 
                initial={{ opacity: 0, x: 30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                whileHover={{ scale: 1.01 }}
                className="rounded-[2rem] border border-slate-200 bg-white p-8 sm:p-10 shadow-lg shadow-slate-200/50 relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-50 rounded-full blur-3xl -z-10 translate-x-1/2 -translate-y-1/2"></div>
                
                <h3 className="text-2xl font-bold text-slate-900">Authorities Dashboard</h3>
                <p className="mt-3 text-base text-slate-600">
                  Operational controls for surveillance integration, active incident management, and advanced face-search matching logic.
                </p>
                <div className="mt-8">
                  <FeatureList
                    features={authorityFeatures}
                    accentClass="bg-indigo-100 text-indigo-700"
                  />
                </div>
                <Link
                  to="/login?role=authority"
                  className="mt-10 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700 transition-colors shadow-md shadow-blue-500/20"
                >
                  Explore Authority Tools
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </motion.article>
            </div>
          </section>

          {/* Workflow Section */}
          <motion.section 
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mt-24 sm:mt-32 grid grid-cols-1 gap-6 lg:grid-cols-3"
          >
            <article className="rounded-3xl border border-white/60 bg-white/50 backdrop-blur-sm p-8 shadow-sm hover:shadow-md transition-shadow">
              <h3 className="text-xl font-bold text-slate-900">How Monitoring Works</h3>
              <ul className="mt-5 space-y-4 text-base text-slate-600">
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-blue-600 shrink-0" />
                  <span>CCTV streams are checked and processed continuously via edge nodes.</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-blue-600 shrink-0" />
                  <span>Crowd levels update in Firestore for live dashboard syncing.</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-blue-600 shrink-0" />
                  <span>Fire and smoke events automatically generate actionable alert records.</span>
                </li>
              </ul>
            </article>

            <article className="rounded-3xl border border-white/60 bg-white/50 backdrop-blur-sm p-8 shadow-sm hover:shadow-md transition-shadow">
              <h3 className="text-xl font-bold text-slate-900">Missing Person Lifecycle</h3>
              <ul className="mt-5 space-y-4 text-base text-slate-600">
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-blue-600 shrink-0" />
                  <span>Citizen submits a detailed report with primary high-res photo.</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-blue-600 shrink-0" />
                  <span>Authority formally accepts case and begins automated multi-camera scan.</span>
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-blue-600 shrink-0" />
                  <span>Detection triggers validation flow (confirm vs. rescan) to final closure.</span>
                </li>
              </ul>
            </article>

            <article className="rounded-3xl border border-white/60 bg-white/50 backdrop-blur-sm p-8 shadow-sm hover:shadow-md transition-shadow bg-blue-50/50">
              <h3 className="text-xl font-bold text-slate-900">Why CrowdSafe?</h3>
              <ul className="mt-5 space-y-4 text-base text-slate-600">
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-blue-600 shrink-0" />
                  <span className="font-medium text-slate-800">Unified Experience:</span> Citizen and authority workflows exist symbiotically.
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-blue-600 shrink-0" />
                  <span className="font-medium text-slate-800">Real-Time Insight:</span> WebSockets/Firestore replace stale API polling.
                </li>
                <li className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-blue-600 shrink-0" />
                  <span className="font-medium text-slate-800">Hyper-Responsive:</span> Built for split-second decisions where response speed rules.
                </li>
              </ul>
            </article>
          </motion.section>
        </main>
      </div>
    </div>
  );
}
