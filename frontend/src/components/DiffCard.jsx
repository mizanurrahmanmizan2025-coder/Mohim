import { useState } from 'react';
import { Columns2, Rows2, Wrench } from 'lucide-react';
import CodeBlock from './CodeBlock.jsx';

/** "Before vs After" comparison shown when the Code Expert fixes/refactors code. */
export default function DiffCard({ lang, before, after }) {
  const [split, setSplit] = useState(true);
  const beforeLines = before.split('\n').length;
  const afterLines = after.split('\n').length;

  return (
    <div className="not-prose my-4 rounded-2xl border border-gray-200 bg-surface-card p-3 dark:border-gray-700 dark:bg-surface-darkcard">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Wrench size={16} className="text-emerald-500" />
          Code fix — before vs after
          <span className="text-xs font-normal text-gray-500">
            {beforeLines} → {afterLines} lines
          </span>
        </div>
        <button onClick={() => setSplit((s) => !s)} className="btn-icon h-8 w-8" title={split ? 'Stack' : 'Side by side'}>
          {split ? <Rows2 size={16} /> : <Columns2 size={16} />}
        </button>
      </div>
      <div className={split ? 'grid gap-3 lg:grid-cols-2' : 'grid gap-3'}>
        <div className="min-w-0">
          <CodeBlock code={before} lang={lang} label="Before" accent="bg-red-500/20 text-red-300" />
        </div>
        <div className="min-w-0">
          <CodeBlock code={after} lang={lang} label="After" accent="bg-emerald-500/20 text-emerald-300" />
        </div>
      </div>
    </div>
  );
}
