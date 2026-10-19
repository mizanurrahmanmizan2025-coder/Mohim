import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Copy, Globe, Lock, Search, X } from 'lucide-react';
import { api } from '../utils/api.js';
import { copyText, getModeMeta } from '../utils/helpers.js';

/* ───── Base modal ───── */
export function Modal({ open, onClose, title, children, wide = false }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
            className={`max-h-[90vh] w-full overflow-hidden rounded-t-3xl bg-white shadow-2xl dark:bg-surface-darkside sm:rounded-3xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-md'}`}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
              <h3 className="text-base font-semibold">{title}</h3>
              <button className="btn-icon h-8 w-8" onClick={onClose}><X size={18} /></button>
            </div>
            <div className="max-h-[calc(90vh-64px)] overflow-y-auto p-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ───── Public link sharing ───── */
export function ShareModal({ open, onClose, chat, onToggle }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const link = chat?.shareId ? `${window.location.origin}/share/${chat.shareId}` : '';

  const toggle = async (enabled) => {
    setBusy(true);
    try { await onToggle(enabled); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Share chat">
      {!chat?._id ? (
        <p className="text-sm text-gray-500">Send a message first, then you can share this chat.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-2xl bg-surface-card p-4 dark:bg-surface-darkcard">
            {chat.isPublic ? <Globe className="text-emerald-500" /> : <Lock className="text-gray-500" />}
            <div className="flex-1 text-sm">
              <div className="font-medium">{chat.isPublic ? 'Anyone with the link can view' : 'Private'}</div>
              <div className="text-xs text-gray-500">Shared chats are read-only. Messages you send later are included.</div>
            </div>
            <button disabled={busy} onClick={() => toggle(!chat.isPublic)} className={chat.isPublic ? 'btn-ghost text-red-500' : 'btn-primary'}>
              {chat.isPublic ? 'Make private' : 'Create link'}
            </button>
          </div>
          {chat.isPublic && link && (
            <div className="flex gap-2">
              <input readOnly value={link} className="input" onFocus={(e) => e.target.select()} />
              <button
                className="btn-primary shrink-0"
                onClick={async () => { if (await copyText(link)) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ───── Prompt library / templates ───── */
export function PromptLibraryModal({ open, onClose, onPick }) {
  const [templates, setTemplates] = useState([]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');

  useEffect(() => {
    if (open && !templates.length) api.get('/templates').then((r) => setTemplates(r.templates)).catch(() => {});
  }, [open, templates.length]);

  const cats = useMemo(() => ['All', ...new Set(templates.map((t) => t.category))], [templates]);
  const list = templates.filter(
    (t) => (cat === 'All' || t.category === cat) && (t.title + t.prompt).toLowerCase().includes(q.toLowerCase())
  );

  return (
    <Modal open={open} onClose={onClose} title="Prompt library" wide>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates" className="input pl-9" />
        </div>
        <div className="flex flex-wrap gap-1">
          {cats.map((c) => (
            <button key={c} onClick={() => setCat(c)} className={`rounded-full px-3 py-1.5 text-xs ${cat === c ? 'bg-blue-600 text-white' : 'bg-surface-card dark:bg-surface-darkcard'}`}>
              {c}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {list.map((t) => {
          const m = getModeMeta(t.mode);
          return (
            <button
              key={t._id}
              onClick={() => { onPick(t); onClose(); }}
              className="rounded-2xl bg-surface-card p-4 text-left transition hover:bg-surface-hover dark:bg-surface-darkcard dark:hover:bg-surface-darkhover"
            >
              <div className={`mb-1 flex items-center gap-1.5 text-xs ${m.color}`}><m.icon size={14} /> {m.label}</div>
              <div className="font-medium">{t.title}</div>
              <div className="mt-1 line-clamp-2 text-xs text-gray-500">{t.prompt}</div>
            </button>
          );
        })}
        {!list.length && <p className="text-sm text-gray-500">No templates found.</p>}
      </div>
    </Modal>
  );
}

/* ───── Simple confirm ───── */
export function ConfirmModal({ open, onClose, onConfirm, title, message, danger = true, confirmText = 'Confirm' }) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="mb-5 text-sm text-gray-600 dark:text-gray-300">{message}</p>
      <div className="flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className={danger ? 'btn-primary bg-red-600 hover:bg-red-700' : 'btn-primary'} onClick={() => { onConfirm(); onClose(); }}>
          {confirmText}
        </button>
      </div>
    </Modal>
  );
}
