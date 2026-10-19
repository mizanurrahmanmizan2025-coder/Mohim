import { useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { copyText, downloadFile, guessFilename } from '../utils/helpers.js';

export default function CodeBlock({ code, lang = 'text', label, accent }) {
  const [copied, setCopied] = useState(false);
  const filename = guessFilename(code, lang);

  const onCopy = async () => {
    if (await copyText(code)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="not-prose my-3 overflow-hidden rounded-xl border border-gray-200 bg-[#282c34] dark:border-gray-700">
      <div className="flex items-center justify-between gap-2 bg-[#21252b] px-3 py-1.5 text-xs text-gray-300">
        <span className="flex items-center gap-2 font-mono">
          {label && <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${accent}`}>{label}</span>}
          {lang}
        </span>
        <div className="flex items-center gap-1">
          <button onClick={onCopy} className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-white/10" title="Copy code">
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
          </button>
          <button
            onClick={() => downloadFile(code, filename)}
            className="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-white/10"
            title={`Download ${filename}`}
          >
            <Download size={14} />
            <span className="hidden sm:inline">{filename}</span>
          </button>
        </div>
      </div>
      <SyntaxHighlighter
        language={lang}
        style={oneDark}
        customStyle={{ margin: 0, padding: '14px 16px', background: 'transparent', fontSize: '13px' }}
        codeTagProps={{ style: { fontFamily: '"JetBrains Mono", ui-monospace, monospace' } }}
        wrapLongLines={false}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
