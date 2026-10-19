import { useEffect, useRef, useState } from 'react';
import { ArrowUp, FileText, Paperclip, Square, X } from 'lucide-react';
import VoiceInput from './VoiceInput.jsx';
import { useChat } from '../context/ChatContext.jsx';
import { getModeMeta } from '../utils/helpers.js';

const ACCEPT = {
  document: 'application/pdf,image/*,.txt,.md,.csv,.json',
  code: '.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.cs,.go,.rb,.php,.html,.css,.sql,.json,.txt,.md,image/*',
  default: 'application/pdf,image/*,.txt,.md,.csv,.json,.js,.py,.html,.css',
};
const MAX_FILES = 5;
const MAX_SIZE = 10 * 1024 * 1024;

export default function Composer({ draft, setDraft, disabled }) {
  const { send, sending, stop, mode, imageSize, setImageSize } = useChat();
  const [files, setFiles] = useState([]);
  const [fileError, setFileError] = useState('');
  const taRef = useRef(null);
  const fileRef = useRef(null);
  const voiceBase = useRef('');
  const meta = getModeMeta(mode);

  // auto-grow textarea
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`;
  }, [draft]);

  useEffect(() => { taRef.current?.focus(); }, [mode]);

  const addFiles = (list) => {
    setFileError('');
    const incoming = [...list].filter((f) => {
      if (f.size > MAX_SIZE) { setFileError(`${f.name} is larger than 10 MB`); return false; }
      return true;
    });
    setFiles((cur) => [...cur, ...incoming].slice(0, MAX_FILES));
  };

  const submit = (e) => {
    e?.preventDefault();
    if (disabled || sending || (!draft.trim() && !files.length)) return;
    send(draft.trim(), files);
    setDraft('');
    setFiles([]);
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
  };

  const onPaste = (e) => {
    const imgs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (imgs.length) addFiles(imgs);
  };

  return (
    <form
      onSubmit={submit}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); if (mode !== 'image') addFiles(e.dataTransfer.files); }}
      className="mx-auto w-full max-w-3xl"
    >
      <div className="rounded-[28px] bg-surface-card px-3 pb-2 pt-3 shadow-sm ring-1 ring-transparent transition focus-within:ring-gray-300 dark:bg-surface-darkcard dark:focus-within:ring-gray-600">
        {files.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 px-2">
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} className="relative flex items-center gap-2 rounded-xl bg-white px-2 py-1.5 text-xs shadow-sm dark:bg-surface-dark">
                {f.type.startsWith('image/') ? (
                  <img src={URL.createObjectURL(f)} alt="" className="h-10 w-10 rounded-lg object-cover" />
                ) : (
                  <FileText size={18} className="text-amber-500" />
                )}
                <span className="max-w-[140px] truncate">{f.name}</span>
                <button type="button" onClick={() => setFiles((c) => c.filter((_, j) => j !== i))} className="rounded-full p-0.5 hover:bg-black/10">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={taRef}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onPaste={onPaste}
          disabled={disabled}
          placeholder={disabled ? 'Chat is disabled for this account' : `${meta.hint}…`}
          className="block max-h-[220px] w-full resize-none bg-transparent px-3 text-[15px] leading-6 outline-none placeholder:text-gray-500 disabled:cursor-not-allowed"
        />

        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-1">
            {mode !== 'image' && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  hidden
                  accept={ACCEPT[mode] || ACCEPT.default}
                  onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
                />
                <button type="button" className="btn-icon" title="Attach files (PDF, images, code)" onClick={() => fileRef.current?.click()} disabled={disabled}>
                  <Paperclip size={20} />
                </button>
              </>
            )}
            {mode === 'image' && (
              <select
                value={imageSize}
                onChange={(e) => setImageSize(e.target.value)}
                className="rounded-full bg-white px-3 py-1.5 text-xs outline-none dark:bg-surface-dark"
                title="Image size"
              >
                <option value="landscape">16:9 Thumbnail</option>
                <option value="square">1:1 Square</option>
                <option value="portrait">9:16 Story</option>
                <option value="wide">3:1 Banner</option>
              </select>
            )}
            <span className={`ml-1 hidden items-center gap-1.5 text-xs sm:flex ${meta.color}`}>
              <meta.icon size={14} /> {meta.label}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <VoiceInput
              disabled={disabled}
              onTranscript={(text, isFinal) => {
                if (!voiceBase.current) voiceBase.current = draft ? `${draft} ` : '';
                setDraft(voiceBase.current + text);
                if (isFinal) voiceBase.current = '';
              }}
            />
            {sending ? (
              <button type="button" onClick={stop} className="btn-icon bg-gray-900 text-white hover:bg-gray-700 dark:bg-white dark:text-black" title="Stop">
                <Square size={16} />
              </button>
            ) : (
              <button
                type="submit"
                disabled={disabled || (!draft.trim() && !files.length)}
                className="btn-icon bg-blue-600 text-white hover:bg-blue-700 disabled:bg-transparent disabled:text-gray-400 dark:hover:bg-blue-700"
                title="Send"
              >
                <ArrowUp size={20} />
              </button>
            )}
          </div>
        </div>
      </div>
      {fileError && <p className="mt-1 px-4 text-xs text-red-500">{fileError}</p>}
      <p className="mt-2 text-center text-[11px] text-gray-500">AI can make mistakes — double-check important info.</p>
    </form>
  );
}
