import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../utils/api.js';
import { useAuth } from './AuthContext.jsx';

const ChatContext = createContext(null);

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

  const send = async (text, files = []) => {
    if (sending || (!text.trim() && !files.length)) return;
    setError(null);
    setSending(true);

    const optimistic = {
      _id: `tmp-${Date.now()}`,
      role: 'user',
      content: text,
      attachments: files.map((f) => ({ name: f.name, mimeType: f.type, size: f.size })),
      previews: files.filter((f) => f.type.startsWith('image/')).map((f) => URL.createObjectURL(f)),
    };
    setChat((c) => ({ ...(c || { title: text.slice(0, 60) || 'New chat', mode }), messages: [...(c?.messages || []), optimistic] }));

    const form = new FormData();
    form.append('message', text);
    form.append('mode', mode);
    if (chat?._id) form.append('chatId', chat._id);
    if (mode === 'image') form.append('imageSize', imageSize);
    files.forEach((f) => form.append('files', f));

    abortRef.current = new AbortController();
    try {
      const res = await api.upload('/chat/send', form, { signal: abortRef.current.signal });
      setChat((c) => ({ ...c, _id: res.chatId, title: res.title, mode: res.mode, messages: [...c.messages, res.message] }));
      if (!chat?._id) {
        navigate(`/c/${res.chatId}`, { replace: true });
        loadChats();
      } else {
        setChats((list) => {
          const found = list.find((x) => x._id === res.chatId);
          return found ? [{ ...found, updatedAt: new Date().toISOString() }, ...list.filter((x) => x._id !== res.chatId)] : list;
        });
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError({ message: err.message, code: err.code });
        if (['SUBSCRIPTION_EXPIRED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_BLOCKED'].includes(err.code)) refreshUser();
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
        imageSize, setImageSize, send, stop, newChat, deleteChat, renameChat, setShare,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export const useChat = () => useContext(ChatContext);
