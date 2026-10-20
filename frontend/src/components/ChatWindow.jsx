import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Download, Lock, Menu, Share2, Volume2, VolumeX } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useChat } from '../context/ChatContext.jsx';
import MessageBubble, { TypingIndicator } from './MessageBubble.jsx';
import Composer from './Composer.jsx';
import { ShareModal } from './Modals.jsx';
import { speak, stopSpeaking, ttsSupported } from './VoiceInput.jsx';
import { STARTERS, exportChat, getModeMeta } from '../utils/helpers.js';

const BLOCKED_CODES = ['SUBSCRIPTION_EXPIRED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_BLOCKED'];

function accountBlock(user) {
  if (!user || user.role === 'admin') return null;
  if (user.status === 'blocked') return 'Your account has been blocked. Please contact the administrator.';
  if (user.status === 'suspended') return 'Your account is suspended. Please contact the administrator.';
  if (user.expired) return 'Your account subscription has expired. Please contact the administrator to renew.';
  return null;
}

export default function ChatWindow({ onOpenMobile, draft, setDraft }) {
  const { user } = useAuth();
  const { chat, mode, error, setError, setShare, loadingChat } = useChat();
  const [shareOpen, setShareOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(() => localStorage.getItem('autoSpeak') === '1');
  const bottomRef = useRef(null);

  const messages = chat?.messages || [];
  const meta = getModeMeta(chat?._id ? chat.mode : mode);
  const blockedMsg = accountBlock(user) || (BLOCKED_CODES.includes(error?.code) ? error.message : null);

  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  const stick = useRef(true); // follow the stream unless the user scrolled up
  const lastLive = useRef(false);

  // keep the newest content in view while it streams
  useEffect(() => {
    const el = scrollRef.current;
    const inner = contentRef.current;
    if (!el || !inner || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => { if (stick.current) el.scrollTop = el.scrollHeight; });
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    stick.current = true;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  // auto read-aloud when a live answer finishes
  const last = messages[messages.length - 1];
  useEffect(() => {
    if (lastLive.current && last && !last.live && last.role === 'assistant' && autoSpeak && last.content) speak(last.content);
    lastLive.current = Boolean(last?.live);
  }, [last?.live]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  useEffect(() => () => stopSpeaking(), []);

  const toggleAutoSpeak = () => {
    const v = !autoSpeak;
    setAutoSpeak(v);
    localStorage.setItem('autoSpeak', v ? '1' : '0');
    if (!v) stopSpeaking();
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* header */}
      <header className="flex items-center gap-2 px-3 py-2 sm:px-5">
        <button className="btn-icon md:hidden" onClick={onOpenMobile}><Menu size={20} /></button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium">{chat?.title || 'Custom AI Suite'}</div>
          <div className={`flex items-center gap-1 text-xs ${meta.color}`}><meta.icon size={12} /> {meta.label}</div>
        </div>
        {ttsSupported && (
          <button className="btn-icon" onClick={toggleAutoSpeak} title={autoSpeak ? 'Auto read-aloud: on' : 'Auto read-aloud: off'}>
            {autoSpeak ? <Volume2 size={18} className="text-blue-500" /> : <VolumeX size={18} />}
          </button>
        )}
        {messages.length > 0 && (
          <div className="relative">
            <button className="btn-icon" onClick={() => setExportOpen((o) => !o)} title="Export chat"><Download size={18} /></button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl bg-white py-1 text-sm shadow-lg dark:bg-surface-darkhover">
                  {[['md', 'Markdown (.md)'], ['txt', 'Plain text (.txt)'], ['json', 'JSON (.json)']].map(([f, l]) => (
                    <button key={f} onClick={() => { exportChat(chat, f); setExportOpen(false); }} className="block w-full px-4 py-2 text-left hover:bg-surface-hover dark:hover:bg-white/10">{l}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        {chat?._id && (
          <button className="btn-ghost" onClick={() => setShareOpen(true)} title="Share">
            <Share2 size={16} /> <span className="hidden sm:inline">Share</span>
          </button>
        )}
      </header>

      {/* messages */}
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
        <div ref={contentRef} className="mx-auto w-full max-w-3xl px-4 pb-6 sm:px-6">
          {loadingChat && <div className="py-10"><TypingIndicator label="Loading chat" /></div>}

          {!loadingChat && messages.length === 0 && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="pt-[12vh]">
              <h1 className="text-4xl font-medium tracking-tight sm:text-5xl">
                <span className="gradient-text">Hello, {user?.name?.split(' ')[0] || 'there'}</span>
              </h1>
              <p className="mt-2 text-2xl text-gray-400 sm:text-3xl">{meta.key === 'general' ? 'How can I help you today?' : meta.hint}</p>
              <div className="mt-10 grid gap-3 sm:grid-cols-3">
                {(STARTERS[meta.key] || STARTERS.general).map((s) => (
                  <button key={s} onClick={() => setDraft(s)}
                    className="card min-h-[96px] p-4 text-left text-sm transition hover:bg-surface-hover dark:hover:bg-surface-darkhover">
                    {s}
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          <div className="space-y-8 pt-4">
            {messages.map((m) => <MessageBubble key={m.clientKey || m._id} msg={m} />)}
          </div>

          {error && !BLOCKED_CODES.includes(error.code) && (
            <div className="mt-6 flex items-start gap-3 rounded-2xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <div className="flex-1">{error.message}</div>
              <button onClick={() => setError(null)} className="text-xs underline">Dismiss</button>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* composer / blocked notice */}
      <div className="px-3 pb-3 sm:px-5">
        {blockedMsg ? (
          <div className="mx-auto mb-2 flex max-w-3xl items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
            <Lock size={18} className="mt-0.5 shrink-0" />
            <div>{blockedMsg}</div>
          </div>
        ) : null}
        <Composer draft={draft} setDraft={setDraft} disabled={Boolean(blockedMsg)} />
      </div>

      <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} chat={chat} onToggle={setShare} />
    </div>
  );
}
