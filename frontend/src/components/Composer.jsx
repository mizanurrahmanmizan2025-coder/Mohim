import { useEffect, useRef, useState } from 'react';
import { ArrowUp, FileArchive, FileText, Folder, Plus, Square, X } from 'lucide-react';
import VoiceInput from './VoiceInput.jsx';
import PlusMenu from './PlusMenu.jsx';
import ModelPicker from './ModelPicker.jsx';
import { useChat } from '../context/ChatContext.jsx';
import { getModeMeta } from '../utils/helpers.js';
import {
  ACCEPT_FILES, MAX_FILE_MB, MAX_UPLOAD_MB, folderFromInput, formatBytes, readDropped,
} from '../utils/fileSelection.js';

const MAX_SINGLE_FILES = 10;
let uid = 0;

function AttachmentChip({ item, onRemove }) {
  const isFolder = item.kind === 'folder';
  const f = item.file;
  const isImage = !isFolder && f.type.startsWith('image/');
  const isZip = !isFolder && /\.zip$/i.test(f.name);
  return (
    <div className="relative flex items-center gap-2 rounded-xl bg-white py-1.5 pl-2 pr-1 text-xs shadow-sm dark:bg-surface-dark">
      {isImage ? (
        <img src={item.preview} alt="" className="h-10 w-10 rounded-lg object-cover" />
      ) : (
        <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${isFolder ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30' : isZip ? 'bg-violet-100 text-violet-600 dark:bg-violet-900/30' : 'bg-blue-100 text-blue-600 dark:bg-blue-900/30'}`}>
          {isFolder ? <Folder size={18} /> : isZip ? <FileArchive size={18} /> : <FileText size={18} />}
        </span>
      )}
      <span className="min-w-0">
        <span className="block max-w-[160px] truncate font-medium">{isFolder ? `${item.name}/` : f.name}</span>
        <span className="block text-[11px] text-gray-500">
          {isFolder ? `${item.files.length} files · ${formatBytes(item.size)}${item.skipped ? ` · ${item.skipped} skipped` : ''}` : formatBytes(f.size)}
        </span>
      </span>
      <button type="button" onClick={onRemove} className="ml-1 rounded-full p-1 hover:bg-black/10 dark:hover:bg-white/10" title="Remove">
        <X size={14} />
      </button>
    </div>
  );
}

export default function Composer({ draft, setDraft, disabled }) {
  const { send, sending, stop, mode, setMode, imageSize, setImageSize, imageQuality, setImageQuality } = useChat();
  const [items, setItems] = useState([]); // { id, kind: 'file'|'folder', file?, files?, name?, size, preview? }
  const [notice, setNotice] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const taRef = useRef(null);
  const fileRef = useRef(null);
  const folderRef = useRef(null);
  const imageRef = useRef(null);
  const voiceBase = useRef('');
  const meta = getModeMeta(mode);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`;
  }, [draft]);

  useEffect(() => { taRef.current?.focus(); }, [mode]);
  useEffect(() => () => items.forEach((it) => it.preview && URL.revokeObjectURL(it.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const totalBytes = (list) => list.reduce((n, it) => n + it.size, 0);

  const addItems = (newItems) => {
    setNotice('');
    setItems((cur) => {
      const next = [...cur];
      for (const it of newItems) {
        if (it.kind === 'file' && it.file.size > MAX_FILE_MB * 1024 * 1024) { setNotice(`${it.file.name} is larger than ${MAX_FILE_MB} MB`); continue; }
        if (it.kind === 'file' && next.filter((x) => x.kind === 'file').length >= MAX_SINGLE_FILES) { setNotice(`Up to ${MAX_SINGLE_FILES} files — zip the rest`); break; }
        if (totalBytes(next) + it.size > MAX_UPLOAD_MB * 1024 * 1024) { setNotice(`Total upload limit is ${MAX_UPLOAD_MB} MB — zip the project or remove large files`); break; }
        if (it.kind === 'folder' && !it.files.length) { setNotice(`"${it.name}" has no readable files (dependencies/build folders are skipped)`); continue; }
        next.push(it);
      }
      return next;
    });
  };

  const fileItem = (file) => ({ id: ++uid, kind: 'file', file, size: file.size, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null });
  const folderItem = (folder) => ({ id: ++uid, kind: 'folder', ...folder });

  const onPick = (key) => {
    if (key === 'upload') fileRef.current?.click();
    else if (key === 'folder') folderRef.current?.click();
    else if (key === 'image-gen') setMode('image');
    else if (key === 'image-analyze') { setMode('document'); imageRef.current?.click(); }
    else if (key === 'search') setMode('search');
    else if (key === 'code') setMode('code');
  };

  const flatFiles = () => items.flatMap((it) => (it.kind === 'folder' ? it.files : [it.file]));

  const submit = (e) => {
    e?.preventDefault();
    const files = flatFiles();
    if (disabled || sending || (!draft.trim() && !files.length)) return;
    send(draft.trim(), files);
    setDraft('');
    setItems([]);
    setNotice('');
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
  };

  const onPaste = (e) => {
    const imgs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (imgs.length) addItems(imgs.map(fileItem));
  };

  const onDrop = async (e) => {
    e.preventDefault();
    setDragging(false);
    if (mode === 'image') return;
    const { singles, folders } = await readDropped(e.dataTransfer);
    addItems([...folders.map(folderItem), ...singles.map(fileItem)]);
  };

  const showModeChip = mode !== 'general';

  return (
    <form
      onSubmit={submit}
      onDragOver={(e) => { e.preventDefault(); if (mode !== 'image') setDragging(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
      onDrop={onDrop}
      className="mx-auto w-full max-w-3xl"
    >
      {/* hidden pickers */}
      <input ref={fileRef} type="file" multiple hidden accept={ACCEPT_FILES} onChange={(e) => { addItems([...e.target.files].map(fileItem)); e.target.value = ''; }} />
      <input ref={imageRef} type="file" multiple hidden accept="image/*,application/pdf" onChange={(e) => { addItems([...e.target.files].map(fileItem)); e.target.value = ''; }} />
      <input
        ref={folderRef}
        type="file"
        hidden
        webkitdirectory=""
        directory=""
        multiple
        onChange={(e) => {
          const folder = folderFromInput(e.target.files);
          if (folder) addItems([folderItem(folder)]);
          e.target.value = '';
        }}
      />

      <div className={`relative rounded-[28px] bg-surface-card px-3 pb-2 pt-3 shadow-sm ring-1 transition focus-within:ring-gray-300 dark:bg-surface-darkcard dark:focus-within:ring-gray-600 ${dragging ? 'ring-2 ring-blue-500' : 'ring-transparent'}`}>
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[28px] bg-blue-500/10 text-sm font-medium text-blue-600 dark:text-blue-300">
            Drop files, a .zip, or a whole folder
          </div>
        )}

        {items.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2 px-1">
            {items.map((it) => (
              <AttachmentChip key={it.id} item={it} onRemove={() => setItems((c) => c.filter((x) => x.id !== it.id))} />
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
          placeholder={disabled ? 'Chat is disabled for this account' : items.some((i) => i.kind === 'folder' || /\.zip$/i.test(i.file?.name || '')) ? 'What should I look for? (e.g. find bugs, explain the architecture)…' : `${meta.hint}…`}
          className="block max-h-[220px] w-full resize-none bg-transparent px-3 text-[15px] leading-6 outline-none placeholder:text-gray-500 disabled:cursor-not-allowed"
        />

        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="relative flex min-w-0 items-center gap-1">
            <button
              type="button"
              className={`btn-icon ${menuOpen ? 'bg-surface-hover dark:bg-surface-darkhover' : ''}`}
              title="Add files, folders and tools"
              onClick={() => setMenuOpen((o) => !o)}
              disabled={disabled}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <Plus size={22} className={`transition ${menuOpen ? 'rotate-45' : ''}`} />
            </button>
            <PlusMenu open={menuOpen} onClose={() => setMenuOpen(false)} onPick={onPick} />

            {showModeChip && (
              <span className={`flex items-center gap-1.5 rounded-full bg-white py-1 pl-2.5 pr-1 text-xs font-medium dark:bg-surface-dark ${meta.color}`}>
                <meta.icon size={14} /> <span className="hidden sm:inline">{meta.label}</span>
                <button type="button" onClick={() => setMode('general')} className="rounded-full p-0.5 text-gray-500 hover:bg-black/10 dark:hover:bg-white/10" title="Back to Chat (auto)">
                  <X size={13} />
                </button>
              </span>
            )}

            {mode === 'image' && (
              <>
                <select value={imageSize} onChange={(e) => setImageSize(e.target.value)} className="rounded-full bg-white px-2.5 py-1.5 text-xs outline-none dark:bg-surface-dark" title="Image size">
                  <option value="landscape">16:9</option>
                  <option value="square">1:1</option>
                  <option value="portrait">9:16</option>
                  <option value="wide">21:9</option>
                </select>
                <select value={imageQuality} onChange={(e) => setImageQuality(e.target.value)} className="rounded-full bg-white px-2.5 py-1.5 text-xs outline-none dark:bg-surface-dark" title="Resolution">
                  <option value="standard">1K</option>
                  <option value="hd">2K HD</option>
                  <option value="4k">4K</option>
                </select>
              </>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {mode !== 'image' && <ModelPicker compact />}
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
                disabled={disabled || (!draft.trim() && !items.length)}
                className="btn-icon bg-blue-600 text-white hover:bg-blue-700 disabled:bg-transparent disabled:text-gray-400 dark:hover:bg-blue-700"
                title="Send"
              >
                <ArrowUp size={20} />
              </button>
            )}
          </div>
        </div>
      </div>
      {notice && <p className="mt-1 px-4 text-xs text-amber-600 dark:text-amber-400">{notice}</p>}
      <p className="mt-2 text-center text-[11px] text-gray-500">AI can make mistakes — double-check important info.</p>
    </form>
  );
}
