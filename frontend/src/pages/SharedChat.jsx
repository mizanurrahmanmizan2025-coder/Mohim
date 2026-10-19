import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import MessageBubble, { TypingIndicator } from '../components/MessageBubble.jsx';
import Logo from '../components/Logo.jsx';
import { api } from '../utils/api.js';
import { exportChat, formatDate } from '../utils/helpers.js';

export default function SharedChat() {
  const { shareId } = useParams();
  const [chat, setChat] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/share/${shareId}`).then((r) => setChat(r.chat)).catch((e) => setError(e.message));
  }, [shareId]);

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-gray-800 dark:bg-surface-dark/80">
        <Link to="/"><Logo /></Link>
        <div className="flex items-center gap-2">
          {chat && <button className="btn-icon" onClick={() => exportChat(chat, 'md')} title="Download"><Download size={18} /></button>}
          <Link to="/register" className="btn-primary">Try it free</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">
        {error && <p className="text-center text-gray-500">{error}</p>}
        {!chat && !error && <TypingIndicator label="Loading" />}
        {chat && (
          <>
            <h1 className="text-2xl font-semibold">{chat.title}</h1>
            <p className="mb-8 mt-1 text-sm text-gray-500">Shared by {chat.author || 'a user'} · {formatDate(chat.createdAt)}</p>
            <div className="space-y-8">
              {chat.messages.map((m, i) => <MessageBubble key={i} msg={m} readOnly />)}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
