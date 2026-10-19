import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Copy, Download, ExternalLink, FileText, Square, Volume2 } from 'lucide-react';
import Markdown from './Markdown.jsx';
import { Sparkle } from './Logo.jsx';
import { speak, stopSpeaking, ttsSupported } from './VoiceInput.jsx';
import { copyText } from '../utils/helpers.js';

async function downloadImage(url, i) {
  try {
    const blob = await (await fetch(url)).blob();
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `ai-image-${i + 1}.jpg` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch {
    window.open(url, '_blank', 'noopener');
  }
}

function GeneratedImage({ src, index }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="group relative overflow-hidden rounded-2xl bg-surface-card dark:bg-surface-darkcard">
      {!loaded && !failed && (
        <div className="flex aspect-video items-center justify-center">
          <div className="text-center text-xs text-gray-500">
            <Sparkle className="thinking-star mx-auto mb-2 h-7 w-7" />
            Painting your image…
          </div>
        </div>
      )}
      {failed && <div className="flex aspect-video items-center justify-center text-sm text-gray-500">Image failed to load — try again.</div>}
      <a href={src} target="_blank" rel="noopener noreferrer">
        <img
          src={src}
          alt={`Generated ${index + 1}`}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`w-full object-cover transition ${loaded ? 'opacity-100' : 'absolute opacity-0'}`}
        />
      </a>
      {loaded && (
        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
          <button onClick={() => downloadImage(src, index)} className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80" title="Download">
            <Download size={16} />
          </button>
          <a href={src} target="_blank" rel="noopener noreferrer" className="rounded-full bg-black/60 p-2 text-white hover:bg-black/80" title="Open">
            <ExternalLink size={16} />
          </a>
        </div>
      )}
    </div>
  );
}

export default function MessageBubble({ msg, readOnly = false }) {
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const isUser = msg.role === 'user';

  if (isUser) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
        <div className="max-w-[85%] space-y-2">
          {msg.previews?.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {msg.previews.map((p) => <img key={p} src={p} alt="" className="h-24 w-24 rounded-xl object-cover" />)}
            </div>
          )}
          {msg.attachments?.filter((a) => !msg.previews?.length || !a.mimeType?.startsWith('image/')).map((a) => (
            <div key={a.name} className="ml-auto flex w-fit items-center gap-2 rounded-xl bg-surface-card px-3 py-2 text-xs dark:bg-surface-darkcard">
              <FileText size={14} /> {a.name}
            </div>
          ))}
          {msg.content && (
            <div className="whitespace-pre-wrap break-words rounded-3xl rounded-tr-md bg-surface-card px-5 py-3 dark:bg-surface-darkhover">
              {msg.content}
            </div>
          )}
        </div>
      </motion.div>
    );
  }

  const toggleSpeak = () => {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
    } else {
      setSpeaking(true);
      speak(msg.content, () => setSpeaking(false));
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3 sm:gap-4">
      <Sparkle className="mt-1 h-7 w-7 shrink-0" />
      <div className="min-w-0 flex-1">
        {msg.content && <Markdown content={msg.content} />}
        {msg.images?.length > 0 && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {msg.images.map((src, i) => <GeneratedImage key={src} src={src} index={i} />)}
          </div>
        )}
        {!readOnly && (
          <div className="mt-2 flex items-center gap-1 text-gray-500">
            <button
              className="btn-icon h-8 w-8"
              title="Copy response"
              onClick={async () => {
                if (await copyText(msg.content)) { setCopied(true); setTimeout(() => setCopied(false), 1500); }
              }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
            {ttsSupported && (
              <button className="btn-icon h-8 w-8" title={speaking ? 'Stop' : 'Read aloud'} onClick={toggleSpeak}>
                {speaking ? <Square size={14} /> : <Volume2 size={16} />}
              </button>
            )}
            {msg.provider && <span className="ml-1 text-[11px] uppercase tracking-wide opacity-60">{msg.provider}</span>}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function TypingIndicator({ label = 'Thinking' }) {
  return (
    <div className="flex items-center gap-4">
      <Sparkle className="thinking-star h-7 w-7" />
      <div className="flex items-center gap-1 text-sm text-gray-500">
        {label}
        <span className="dot">.</span><span className="dot">.</span><span className="dot">.</span>
      </div>
    </div>
  );
}
