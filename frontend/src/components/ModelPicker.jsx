import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Code2, Eye, Sparkles } from 'lucide-react';
import { useChat } from '../context/ChatContext.jsx';

/** Model / version switcher. "Auto" = feature chains; a picked model is tried first, with fallback. */
export default function ModelPicker() {
  const { models, model, setModel } = useChat();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!models.length) return null;
  const current = models.find((m) => m.id === model) || models[0];

  // group by provider, Auto first
  const groups = models.reduce((acc, m) => {
    const g = m.auto ? '' : m.providerLabel;
    (acc[g] = acc[g] || []).push(m);
    return acc;
  }, {});

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition hover:bg-surface-hover dark:hover:bg-surface-darkhover"
        title="Choose model"
      >
        {current.auto && <Sparkles size={15} className="text-blue-500" />}
        <span className="max-w-[150px] truncate">{current.label}</span>
        <ChevronDown size={15} className={`text-gray-500 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className="absolute right-0 z-40 mt-1 max-h-[70vh] w-80 overflow-y-auto rounded-2xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-gray-700 dark:bg-surface-darkside"
          >
            {Object.entries(groups).map(([group, list]) => (
              <div key={group || 'auto'} className="py-0.5">
                {group && <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{group}</div>}
                {list.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { setModel(m.id); setOpen(false); }}
                    className={`flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-surface-hover dark:hover:bg-surface-darkhover ${m.id === current.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                  >
                    <span className="mt-0.5 w-4 shrink-0">{m.id === current.id && <Check size={16} className="text-blue-600" />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        {m.auto && <Sparkles size={14} className="text-blue-500" />}
                        {m.label}
                        {m.code && <Code2 size={13} className="text-emerald-500" title="Good for code" />}
                        {m.vision && <Eye size={13} className="text-violet-500" title="Reads images & PDFs" />}
                      </span>
                      {(m.hint || m.auto) && <span className="block text-xs text-gray-500">{m.auto ? m.hint : m.hint}</span>}
                    </span>
                  </button>
                ))}
              </div>
            ))}
            <p className="border-t border-gray-100 px-3 pb-1 pt-2 text-[11px] leading-snug text-gray-500 dark:border-gray-700">
              If the selected model is busy or rate-limited, the next available model answers automatically.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
