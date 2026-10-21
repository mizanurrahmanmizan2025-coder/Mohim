import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bug, FileUp, FolderUp, Globe, ImagePlus, ScanSearch } from 'lucide-react';

/** Gemini-style "+" action menu. Each item: { key, icon, label, hint, color } */
export const PLUS_ITEMS = [
  { key: 'upload', icon: FileUp, label: 'Upload files', hint: 'ZIP, PDF, Word, Excel, CSV, code', color: 'text-blue-500' },
  { key: 'folder', icon: FolderUp, label: 'Upload folder', hint: 'Review a whole project', color: 'text-amber-500' },
  { key: 'image-gen', icon: ImagePlus, label: 'Generate image', hint: 'Thumbnails, logos, art', color: 'text-pink-500' },
  { key: 'image-analyze', icon: ScanSearch, label: 'Analyze image', hint: 'OCR, describe, extract data', color: 'text-violet-500' },
  { key: 'search', icon: Globe, label: 'Web search', hint: 'Live answers with sources', color: 'text-cyan-500' },
  { key: 'code', icon: Bug, label: 'Code debugger', hint: 'Find and fix bugs', color: 'text-emerald-500' },
];

export default function PlusMenu({ open, onClose, onPick }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          role="menu"
          initial={{ opacity: 0, y: 8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.97 }}
          transition={{ duration: 0.14 }}
          className="absolute bottom-12 left-0 z-30 w-72 origin-bottom-left overflow-hidden rounded-2xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-gray-700 dark:bg-surface-darkside"
        >
          {PLUS_ITEMS.map((it, i) => (
            <div key={it.key}>
              {i === 2 && <div className="mx-2 my-1 border-t border-gray-100 dark:border-gray-700" />}
              <button
                type="button"
                role="menuitem"
                onClick={() => { onPick(it.key); onClose(); }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-surface-hover dark:hover:bg-surface-darkhover"
              >
                <it.icon size={19} className={it.color} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{it.label}</span>
                  <span className="block truncate text-xs text-gray-500">{it.hint}</span>
                </span>
              </button>
            </div>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
