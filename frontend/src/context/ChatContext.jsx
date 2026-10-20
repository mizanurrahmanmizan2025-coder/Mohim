import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, streamRequest } from '../utils/api.js';
import { useAuth } from './AuthContext.jsx';

const ChatContext = createContext(null);
const BLOCKING = ['SUBSCRIPTION_EXPIRED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_BLOCKED'];

export function ChatProvider({ children }) {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const { refresh: refreshUser } = useAuth();

  const [chats, setChats] = useState([]);
  const [chat, setChat] = useState(null); // { _id, title, mode, messages }
  const [mode, setMode] = useState('general');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null); // { message, code }
  const [loadingChat, setLoadingChat] = useState(false);
  const [imageSize, setImageSize] = useState('landscape');
  const [imageQuality, setImageQuality] = useState('standard');
  const abortRef = useRef(null);

  const loadChats = useCallback(async () => {
    try {
      const { chats: list } = await api.get('/chats');
      setChats(list);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadChats(); }, [loadChats]);

  // load the chat in the URL
  useEffect(() => {
    if (!chatId) {
      setChat(null);
      return;
    }
    if (chat?._id === chatId) return;
    setLoadingChat(true);
    api.get(`/chats/${chatId}`)
      .then(({ chat: c }) => { setChat(c); setMode(c.mode || 'general'); })
      .catch(() => navigate('/c', { replace: true }))
      .finally(() => setLoadingChat(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  const newChat = (m = mode) => {
    abortRef.current?.abort();
    setChat(null);
    setError(null);
    setMode(m);
    navigate('/c');
  };

  /* ───────────────────────── send with live progress ───────────────────────── */
  const send = async (text, files = []) => {
    if (sending || (!text.trim() && !files.length)) return;
    setError(null);
    setSending(true);

    const liveKey = `live-${Date.now()}`;
    const userMsg = {
      _id: `${liveKey}-u`,
      role: 'user',
      content: text,
      attachments: files.map((f) => ({ name: f.name, mimeType: f.type, size: f.size })),
      previews: files.filter((f) => f.type.startsWith('image/')).map((f) => URL.createObjectURL(f)),
    };
    const liveMsg = {
      _id: liveKey,
      clientKey: liveKey,
      role: 'assistant',
      live: true,
      routedMode: mode === 'general' ? null : mode,
      steps: [{ id: 'connect', label: 'Connecting', status: 'active' }],
      thinking: '',
      content: '',
      images: [],
      imagePlan: null,
      imageProgress: {},
    };
    setChat((c) => ({ ...(c || { title: text.slice(0, 60) || 'New chat', mode }), messages: [...(c?.messages || []), userMsg, liveMsg] }));

    const patch = (fn) => setChat((c) => (c ? { ...c, messages: c.messages.map((m) => (m.clientKey === liveKey ? fn(m) : m)) } : c));

    // batch token deltas into one render per animation frame
    let pendingText = '';
    let pendingThink = '';
    let raf = null;
    const flush = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      const t = pendingText;
      const th = pendingThink;
      pendingText = '';
      pendingThink = '';
      if (t || th) patch((m) => ({ ...m, content: m.content + t, thinking: m.thinking + th }));
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(flush); };
    const finishSteps = (status) => (m) => ({
      ...m,
      live: false,
      steps: m.steps.map((s) => (s.status === 'active' ? { ...s, status } : s)),
    });

    const form = new FormData();
    form.append('message', text);
    form.append('mode', mode);
    if (chat?._id) form.append('chatId', chat._id);
    form.append('imageSize', imageSize);
    form.append('imageQuality', imageQuality);
    files.forEach((f) => form.append('files', f));

    const isNew = !chat?._id;
    abortRef.current = new AbortController();

    const onEvent = (event, d) => {
      switch (event) {
        case 'meta':
          patch((m) => ({ ...m, steps: m.steps.filter((s) => s.id !== 'connect') }));
          break;
        case 'step':
          flush();
          patch((m) => {
            const steps = [...m.steps];
            const i = steps.findIndex((s) => s.id === d.id);
            if (i >= 0) steps[i] = { ...steps[i], ...d };
            else steps.push(d);
            return { ...m, steps };
          });
          break;
        case 'route':
          patch((m) => ({ ...m, routedMode: d.mode }));
          break;
        case 'thinking':
          pendingThink += d.text;
          schedule();
          break;
        case 'delta':
          pendingText += d.text;
          schedule();
          break;
        case 'reset':
          pendingText = '';
          pendingThink = '';
          patch((m) => ({ ...m, content: '', thinking: '' }));
          break;
        case 'image_plan':
          patch((m) => ({ ...m, imagePlan: d }));
          break;
        case 'image_progress':
          patch((m) => ({ ...m, imageProgress: { ...m.imageProgress, [d.index]: d } }));
          break;
        case 'image':
          patch((m) => {
            const images = [...(m.images || [])];
            images[d.index] = d.url;
            return { ...m, images };
          });
          break;
        case 'done':
          flush();
          patch((m) => ({ ...d.message, clientKey: liveKey, live: false, thinking: m.thinking, imagePlan: m.imagePlan, imageProgress: m.imageProgress }));
          setChat((c) => ({ ...c, _id: d.chatId, title: d.title }));
          if (isNew) {
            navigate(`/c/${d.chatId}`, { replace: true });
            loadChats();
          } else {
            setChats((list) => {
              const found = list.find((x) => x._id === d.chatId);
              return found ? [{ ...found, updatedAt: new Date().toISOString() }, ...list.filter((x) => x._id !== d.chatId)] : list;
            });
          }
          break;
        case 'error':
          flush();
          setError({ message: d.message, code: d.code });
          patch(finishSteps('error'));
          break;
        default:
      }
    };

    try {
      await streamRequest('/chat/stream', form, { onEvent, signal: abortRef.current.signal });
    } catch (err) {
      flush();
      if (err.name === 'AbortError') {
        patch((m) => ({ ...finishSteps('error')(m), stopped: true }));
        if (isNew) setTimeout(loadChats, 800); // server saves partial answers
      } else {
        setError({ message: err.message, code: err.code });
        patch(finishSteps('error'));
        if (BLOCKING.includes(err.code)) refreshUser();
      }
    } finally {
      setSending(false);
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    setSending(false);
  };

  const deleteChat = async (id) => {
    await api.del(`/chats/${id}`);
    setChats((l) => l.filter((c) => c._id !== id));
    if (chat?._id === id) newChat();
  };

  const renameChat = async (id, title) => {
    const { chat: c } = await api.patch(`/chats/${id}`, { title });
    setChats((l) => l.map((x) => (x._id === id ? { ...x, title: c.title } : x)));
    if (chat?._id === id) setChat((cur) => ({ ...cur, title: c.title }));
  };

  const setShare = async (enabled) => {
    if (!chat?._id) return null;
    const res = await api.post(`/chats/${chat._id}/share`, { enabled });
    setChat((c) => ({ ...c, isPublic: res.isPublic, shareId: res.shareId }));
    return res;
  };

  return (
    <ChatContext.Provider
      value={{
        chats, chat, mode, setMode, sending, error, setError, loadingChat,
        imageSize, setImageSize, imageQuality, setImageQuality,
        send, stop, newChat, deleteChat, renameChat, setShare,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export const useChat = () => useContext(ChatContext);
