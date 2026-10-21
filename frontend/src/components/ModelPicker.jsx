import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Code2, Eye, Search } from 'lucide-react';
import { useChat } from '../context/ChatContext.jsx';

const GROUP_ORDER = ['Recommended', 'OpenRouter · free', 'Hugging Face', 'Auto'];

/**
 * Model Switcher for the input bar (opens upwards).
 * The picked model answers first; if it's busy or rate-limited, the next model in the
 * chain answers automatically — the chat never breaks.
 */
export default function ModelPicker({ compact = false }) {
  const { models, model, setModel } = useChat();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setTimeout(() => searchRef.current?.focus(), 50);
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    const filtered = models.filter((m) => !term || `${m.label} ${m.model || ''} ${m.providerLabel || ''}`.toLowerCase().includes(term));
    const map = new Map();
    for (const m of filtered) {
      if (!map.has(m.group)) map.set(m.group, []);
      map.get(m.group).push(m);
    }
    return [...map.entries()].sort((a, b) => GROUP_ORDER.indexOf(a[0]) - GROUP_ORDER.indexOf(b[0]));
  }, [models, q]);

  if (!models.length) return null;
  const current = models.find((m) => m.id === model) || models[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-gray-700 transition hover:bg-surface-hover dark:text-gray-200 dark:hover:bg-surface-darkhover"
        title={`Model: ${current.label}${current.providerLabel ? ` (${current.providerLabel})` : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span aria-hidden>{current.icon}</span>
        <span className={`truncate ${compact ? 'hidden max-w-[110px] sm:inline' : 'max-w-[140px]'}`}>{current.label}</span>
        <ChevronDown size={15} className={`text-gray-500 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.14 }}
            className="absolute bottom-12 right-0 z-40 flex max-h-[min(70vh,520px)] w-[min(92vw,340px)] origin-bottom-right flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-surface-darkside"
          >
            {models.length > 8 && (
              <div className="border-b border-gray-100 p-2 dark:border-gray-700">
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    ref={searchRef}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search models"
                    className="w-full rounded-xl bg-surface-card py-2 pl-9 pr-3 text-sm outline-none dark:bg-surface-darkcard"
                  />
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-1.5">
              {groups.map(([group, list]) => (
                <div key={group} className="py-0.5">
                  <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{group}</div>
                  {list.map((m) => {
                    const active = m.id === current.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => { setModel(m.id); setOpen(false); setQ(''); }}
                        className={`flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left transition hover:bg-surface-hover dark:hover:bg-surface-darkhover ${active ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                      >
                        <span className="mt-0.5 w-5 shrink-0 text-center" aria-hidden>{m.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                            <span className="truncate">{m.label}</span>
                            {m.badge && <span className="rounded-full bg-amber-100 px-1.5 py-px text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">{m.badge}</span>}
                            {m.free && <span className="rounded-full bg-emerald-100 px-1.5 py-px text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">FREE</span>}
                            {m.code && <Code2 size={13} className="text-emerald-500" aria-label="Good for code" />}
                            {m.vision && <Eye size={13} className="text-violet-500" aria-label="Reads images & PDFs" />}
                          </span>
                          <span className="block truncate text-xs text-gray-500">
                            {m.hint || (m.auto ? '' : `${m.providerLabel}${m.context ? ` · ${Math.round(m.context / 1000)}k context` : ''}`)}
                          </span>
                        </span>
                        {active && <Check size={16} className="mt-0.5 shrink-0 text-blue-600" />}
                      </button>
                    );
                  })}
                </div>
              ))}
              {!groups.length && <p className="px-3 py-6 text-center text-sm text-gray-500">No models match “{q}”</p>}
            </div>

            <p className="border-t border-gray-100 px-3 py-2 text-[11px] leading-snug text-gray-500 dark:border-gray-700">
              If the selected model is busy or rate-limited, the next available model answers automatically.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
