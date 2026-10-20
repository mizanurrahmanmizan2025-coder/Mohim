import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Brain, CheckCircle2, ChevronDown, Loader2, XCircle } from 'lucide-react';

const ICON = {
  active: <Loader2 size={15} className="animate-spin text-blue-500" />,
  done: <CheckCircle2 size={15} className="text-emerald-500" />,
  warn: <AlertTriangle size={15} className="text-amber-500" />,
  error: <XCircle size={15} className="text-red-500" />,
};

/** Live step-by-step log ("Understanding your request → Code Expert", "Generating code · Gemini" …). */
export default function ProgressSteps({ steps = [], live = false }) {
  const [open, setOpen] = useState(live);
  const wasLive = useRef(live);

  useEffect(() => {
    if (wasLive.current && !live) {
      const t = setTimeout(() => setOpen(false), 900); // collapse shortly after finishing
      wasLive.current = false;
      return () => clearTimeout(t);
    }
    if (live) { setOpen(true); wasLive.current = true; }
    return undefined;
  }, [live]);

  if (!steps.length) return null;

  const current = [...steps].reverse().find((s) => s.status === 'active');
  const warnings = steps.filter((s) => s.status === 'warn').length;
  const failed = steps.some((s) => s.status === 'error');
  const doneCount = steps.filter((s) => s.status === 'done').length;

  const header = live
    ? current ? `${current.label}…` : 'Working…'
    : failed ? 'Stopped' : `Completed ${doneCount} step${doneCount === 1 ? '' : 's'}${warnings ? ` · ${warnings} fallback${warnings > 1 ? 's' : ''}` : ''}`;

  return (
    <div className="not-prose mb-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full py-1 pr-2 text-sm text-gray-600 transition hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
      >
        {live ? ICON.active : failed ? ICON.error : ICON.done}
        <span className={live ? 'shimmer-text font-medium' : ''}>{header}</span>
        <ChevronDown size={14} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.ol
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="ml-[7px] mt-1 overflow-hidden border-l-2 border-gray-200 pl-4 dark:border-gray-700"
          >
            <AnimatePresence initial={false}>
              {steps.map((s) => (
                <motion.li
                  key={s.id}
                  layout
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="relative py-1 text-[13px]"
                >
                  <span className="absolute -left-[27px] top-[7px] rounded-full bg-white dark:bg-surface-dark">{ICON[s.status] || ICON.done}</span>
                  <span className={s.status === 'warn' ? 'text-amber-700 dark:text-amber-300' : s.status === 'active' ? 'font-medium' : 'text-gray-600 dark:text-gray-400'}>
                    {s.label}
                  </span>
                  {s.detail && <span className="ml-1.5 break-words text-xs text-gray-500">· {s.detail}</span>}
                </motion.li>
              ))}
            </AnimatePresence>
          </motion.ol>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Collapsible reasoning stream (shown when a model emits thinking tokens). */
export function ThinkingBox({ text, live }) {
  const [open, setOpen] = useState(live);
  const boxRef = useRef(null);
  useEffect(() => { if (!live) setOpen(false); }, [live]);
  useEffect(() => { if (open && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight; }, [text, open]);
  if (!text?.trim()) return null;

  return (
    <div className="not-prose mb-3 rounded-2xl bg-surface-card/70 dark:bg-surface-darkcard/70">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-gray-600 dark:text-gray-400">
        <Brain size={14} className={live ? 'animate-pulse text-violet-500' : 'text-violet-500'} />
        <span className={live ? 'shimmer-text' : ''}>{live ? 'Thinking…' : 'Show thinking'}</span>
        <ChevronDown size={14} className={`ml-auto transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div ref={boxRef} className="max-h-40 overflow-y-auto whitespace-pre-wrap px-3 pb-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          {text}
        </div>
      )}
    </div>
  );
}
