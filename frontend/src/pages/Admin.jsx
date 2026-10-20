import { Link } from 'react-router-dom';
import { ArrowLeft, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import AdminPanel from '../components/AdminPanel.jsx';
import Logo from '../components/Logo.jsx';
import { currentTheme, setTheme } from '../utils/helpers.js';

export default function Admin() {
  const [theme, setT] = useState(currentTheme());
  return (
    <div className="h-full overflow-y-auto bg-surface-side dark:bg-surface-dark">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-surface-side/90 px-4 py-3 backdrop-blur dark:bg-surface-dark/90 sm:px-8">
        <div className="flex items-center gap-3">
          <Link to="/" className="btn-icon" title="Back to chat"><ArrowLeft size={20} /></Link>
          <Logo />
          <span className="rounded-full bg-blue-600 px-2.5 py-0.5 text-xs font-medium text-white">Admin</span>
        </div>
        <button className="btn-icon" onClick={() => { const t = theme === 'dark' ? 'light' : 'dark'; setTheme(t); setT(t); }}>
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </header>
      <main className="mx-auto max-w-7xl px-4 pb-16 sm:px-8">
        <AdminPanel />
      </main>
    </div>
  );
}
