import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Copy, FileText, Search, Square, Volume2 } from 'lucide-react';
import Markdown from './Markdown.jsx';
import { Sparkle } from './Logo.jsx';
import ProgressSteps, { ThinkingBox } from './ProgressSteps.jsx';
import ImageGrid from './ImageProgress.jsx';
import useTypewriter from '../hooks/useTypewriter.js';
import { speak, stopSpeaking, ttsSupported } from './VoiceInput.jsx';
import { copyText, getModeMeta } from '../utils/helpers.js';

/* which tool the auto-router used */
function RouteChip({ mode }) {
  if (!mode || mode === 'general') return null;
  const meta = mode === 'search' ? { label: 'Web Search', icon: Search, color: 'text-cyan-500' } : getModeMeta(mode);
  const Icon = meta.icon;
  return (
    <span className={`ml-1 inline-flex items-center gap-1 rounded-full bg-surface-card px-2 py-0.5 text-[11px] dark:bg-surface-darkcard ${meta.color}`}>
      <Icon size={12} /> {meta.label}
    </span>
  );
}

function UserBubble({ msg }) {
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

export default function MessageBubble({ msg, readOnly = false }) {
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  // animate only messages that started streaming in this session
  const [animate] = useState(Boolean(msg.live));
  const shown = useTypewriter(msg.content || '', animate);

  if (msg.role === 'user') return <UserBubble msg={msg} />;

  const typing = msg.live || shown.length < (msg.content || '').length;
  const fenceOpen = ((shown.match(/```/g) || []).length % 2) === 1; // caret would land inside a code block
  const hasImages = msg.imagePlan?.count > 0 || msg.images?.length > 0;
  const waitingForText = msg.live && !shown && !hasImages && !msg.thinking;

  const toggleSpeak = () => {
    if (speaking) { stopSpeaking(); setSpeaking(false); } else { setSpeaking(true); speak(msg.content, () => setSpeaking(false)); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3 sm:gap-4">
      <Sparkle className={`mt-1 h-7 w-7 shrink-0 ${msg.live ? 'thinking-star' : ''}`} />
      <div className="min-w-0 flex-1">
        <ProgressSteps steps={msg.steps} live={msg.live} />
        <ThinkingBox text={msg.thinking} live={msg.live && !shown} />

        {waitingForText && (
          <div className="space-y-2 pt-1" aria-hidden>
            <div className="h-3 w-11/12 animate-pulse rounded-full bg-gray-200 dark:bg-gray-800" />
            <div className="h-3 w-4/5 animate-pulse rounded-full bg-gray-200 dark:bg-gray-800" />
            <div className="h-3 w-2/3 animate-pulse rounded-full bg-gray-200 dark:bg-gray-800" />
          </div>
        )}

        {shown && (
          <div className="relative">
            <Markdown content={shown} />
            {typing && !fenceOpen && <span className="stream-caret" aria-hidden />}
          </div>
        )}

        {hasImages && <ImageGrid images={msg.images} plan={msg.imagePlan} progress={msg.imageProgress} />}

        {msg.stopped && <div className="mt-2 text-xs text-gray-500">Stopped</div>}

        {!readOnly && !msg.live && (msg.content || msg.images?.length > 0) && (
          <div className="mt-2 flex items-center gap-1 text-gray-500">
            <button
              className="btn-icon h-8 w-8"
              title="Copy response"
              onClick={async () => { if (await copyText(msg.content)) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
            {ttsSupported && msg.content && (
              <button className="btn-icon h-8 w-8" title={speaking ? 'Stop' : 'Read aloud'} onClick={toggleSpeak}>
                {speaking ? <Square size={14} /> : <Volume2 size={16} />}
              </button>
            )}
            <RouteChip mode={msg.routedMode} />
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
