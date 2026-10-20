import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check, Languages, Lightbulb, LogOut, Menu, Moon, MoreVertical, Pencil, Plus, Shield, Sun, Trash2, X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useChat } from '../context/ChatContext.jsx';
import { MODES, currentTheme, formatDate, setTheme, timeAgoGroup } from '../utils/helpers.js';
import { VOICE_LANGS, getVoiceLang, setVoiceLang } from './VoiceInput.jsx';
import { ConfirmModal } from './Modals.jsx';

function ChatItem({ c, active, collapsed, onOpen }) {
  const { renameChat, deleteChat } = useChat();
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(c.title);
  const [confirm, setConfirm] = useState(false);

  if (collapsed) return null;

  const save = async () => {
    setEditing(false);
    if (title.trim() && title !== c.title) await renameChat(c._id, title.trim()).catch(() => setTitle(c.title));
  };

  return (
    <div className={`group relative flex items-center rounded-full ${active ? 'bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100' : 'hover:bg-surface-hover dark:hover:bg-surface-darkhover'}`}>
      {editing ? (
        <div className="flex w-full items-center gap-1 px-2 py-1">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} onBlur={save}
            className="w-full rounded-lg bg-white px-2 py-1 text-sm outline-none dark:bg-surface-dark" />
          <button onMouseDown={save} className="p-1"><Check size={14} /></button>
        </div>
      ) : (
        <button onClick={onOpen} className="flex-1 truncate px-4 py-2 text-left text-sm">{c.title}</button>
      )}
      {!editing && (
        <button onClick={() => setMenu((m) => !m)} className="mr-1 rounded-full p-1.5 opacity-0 hover:bg-black/10 group-hover:opacity-100 dark:hover:bg-white/10">
          <MoreVertical size={14} />
        </button>
      )}
      {menu && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
          <div className="absolute right-0 top-9 z-20 w-36 overflow-hidden rounded-xl bg-white py-1 text-sm shadow-lg dark:bg-surface-darkhover">
            <button onClick={() => { setMenu(false); setEditing(true); }} className="flex w-full items-center gap-2 px-3 py-2 hover:bg-surface-hover dark:hover:bg-white/10"><Pencil size={14} /> Rename</button>
            <button onClick={() => { setMenu(false); setConfirm(true); }} className="flex w-full items-center gap-2 px-3 py-2 text-red-500 hover:bg-surface-hover dark:hover:bg-white/10"><Trash2 size={14} /> Delete</button>
          </div>
        </>
      )}
      <ConfirmModal open={confirm} onClose={() => setConfirm(false)} onConfirm={() => deleteChat(c._id)} title="Delete chat?" message={`“${c.title}” will be permanently deleted.`} confirmText="Delete" />
    </div>
  );
}

export default function Sidebar({ open, setOpen, mobileOpen, setMobileOpen, onOpenLibrary }) {
  const { user, logout } = useAuth();
  const { chats, chat, mode, newChat } = useChat();
  const navigate = useNavigate();
  const [theme, setThemeState] = useState(currentTheme());
  const [lang, setLang] = useState(getVoiceLang());
  const collapsed = !open && !mobileOpen;

  const groups = chats.reduce((acc, c) => {
    const g = timeAgoGroup(c.updatedAt);
    (acc[g] = acc[g] || []).push(c);
    return acc;
  }, {});

  const close = () => setMobileOpen(false);
  const pickMode = (key) => { newChat(key); close(); };

  const content = (
    <div className="flex h-full flex-col">
      {/* top */}
      <div className="flex items-center gap-1 p-3">
        <button className="btn-icon hidden md:inline-flex" onClick={() => setOpen((o) => !o)} title="Toggle sidebar"><Menu size={20} /></button>
        <button className="btn-icon md:hidden" onClick={close}><X size={20} /></button>
      </div>

      <div className="px-3">
        <button
          onClick={() => pickMode(mode)}
          className={`flex items-center gap-3 rounded-full bg-surface-hover py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-300/60 dark:bg-surface-darkhover dark:text-gray-200 dark:hover:bg-gray-700 ${collapsed ? 'h-10 w-10 justify-center px-0' : 'px-4'}`}
          title="New chat"
        >
          <Plus size={18} /> {!collapsed && 'New chat'}
        </button>
      </div>

      {/* modes */}
      <nav className="mt-4 space-y-0.5 px-3">
        {!collapsed && <div className="px-4 pb-1 text-xs font-medium text-gray-500">Modes</div>}
        {MODES.map((m) => (
          <button
            key={m.key}
            onClick={() => pickMode(m.key)}
            title={m.label}
            className={`flex w-full items-center gap-3 rounded-full py-2 text-sm transition ${collapsed ? 'justify-center px-0' : 'px-4'} ${mode === m.key && !chat?._id ? 'bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100' : 'hover:bg-surface-hover dark:hover:bg-surface-darkhover'}`}
          >
            <m.icon size={18} className={m.color} /> {!collapsed && m.label}
          </button>
        ))}
        <button
          onClick={() => { onOpenLibrary(); close(); }}
          title="Prompt library"
          className={`flex w-full items-center gap-3 rounded-full py-2 text-sm transition hover:bg-surface-hover dark:hover:bg-surface-darkhover ${collapsed ? 'justify-center px-0' : 'px-4'}`}
        >
          <Lightbulb size={18} className="text-yellow-500" /> {!collapsed && 'Prompt Library'}
        </button>
      </nav>

      {/* history */}
      <div className="mt-4 flex-1 overflow-y-auto px-3">
        {!collapsed && Object.entries(groups).map(([g, list]) => (
          <div key={g} className="mb-3">
            <div className="px-4 pb-1 text-xs font-medium text-gray-500">{g}</div>
            {list.map((c) => (
              <ChatItem key={c._id} c={c} active={chat?._id === c._id} collapsed={collapsed}
                onOpen={() => { navigate(`/c/${c._id}`); close(); }} />
            ))}
          </div>
        ))}
      </div>

      {/* bottom */}
      <div className="space-y-0.5 border-t border-gray-200 p-3 dark:border-gray-800">
        {user?.role === 'admin' && (
          <Link to="/admin" title="Admin dashboard" className={`flex items-center gap-3 rounded-full py-2 text-sm hover:bg-surface-hover dark:hover:bg-surface-darkhover ${collapsed ? 'justify-center' : 'px-4'}`}>
            <Shield size={18} className="text-blue-500" /> {!collapsed && 'Admin dashboard'}
          </Link>
        )}
        <button
          onClick={() => { const t = theme === 'dark' ? 'light' : 'dark'; setTheme(t); setThemeState(t); }}
          title="Toggle theme"
          className={`flex w-full items-center gap-3 rounded-full py-2 text-sm hover:bg-surface-hover dark:hover:bg-surface-darkhover ${collapsed ? 'justify-center' : 'px-4'}`}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />} {!collapsed && (theme === 'dark' ? 'Light mode' : 'Dark mode')}
        </button>
        {!collapsed && (
          <label className="flex items-center gap-3 rounded-full px-4 py-2 text-sm">
            <Languages size={18} />
            <select value={lang} onChange={(e) => { setLang(e.target.value); setVoiceLang(e.target.value); }} className="flex-1 bg-transparent outline-none" title="Voice language">
              {VOICE_LANGS.map((l) => <option key={l.code} value={l.code} className="text-black">{l.label} voice</option>)}
            </select>
          </label>
        )}
        <div className={`flex items-center gap-3 rounded-2xl py-2 ${collapsed ? 'justify-center' : 'px-2'}`}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-500 text-sm font-semibold text-white">
            {user?.name?.[0]?.toUpperCase() || 'U'}
          </div>
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1 text-xs">
                <div className="truncate font-medium">{user?.name}</div>
                <div className="truncate text-gray-500">
                  {user?.role === 'admin' ? 'Super admin' : user?.expiryDate ? `Valid until ${formatDate(user.expiryDate)}` : 'Lifetime access'}
                </div>
              </div>
              <button className="btn-icon h-8 w-8" onClick={logout} title="Log out"><LogOut size={16} /></button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* desktop */}
      <motion.aside
        animate={{ width: open ? 280 : 72 }}
        transition={{ type: 'spring', stiffness: 300, damping: 32 }}
        className="hidden h-full shrink-0 overflow-hidden bg-surface-side dark:bg-surface-darkside md:block"
      >
        {content}
      </motion.aside>

      {/* mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div className="fixed inset-0 z-40 bg-black/40 md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} />
            <motion.aside
              className="fixed inset-y-0 left-0 z-50 w-[85%] max-w-[300px] bg-surface-side dark:bg-surface-darkside md:hidden"
              initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            >
              {content}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
