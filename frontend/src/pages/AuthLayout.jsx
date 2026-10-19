import { motion } from 'framer-motion';
import { Sparkle } from '../components/Logo.jsx';

export default function AuthLayout({ title, subtitle, children }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-surface-side px-4 py-10 dark:bg-surface-dark">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md rounded-3xl bg-white p-8 shadow-xl shadow-black/5 dark:bg-surface-darkside">
        <Sparkle className="mb-6 h-10 w-10" />
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mb-6 mt-1 text-sm text-gray-500">{subtitle}</p>
        {children}
      </motion.div>
    </div>
  );
}
