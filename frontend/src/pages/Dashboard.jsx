import { useState } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import ChatWindow from '../components/ChatWindow.jsx';
import { PromptLibraryModal } from '../components/Modals.jsx';
import { useChat } from '../context/ChatContext.jsx';

export default function Dashboard() {
  const { newChat } = useChat();
  const [open, setOpen] = useState(() => localStorage.getItem('sidebar') !== 'closed');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const setOpenPersist = (fn) =>
    setOpen((o) => {
      const v = typeof fn === 'function' ? fn(o) : fn;
      localStorage.setItem('sidebar', v ? 'open' : 'closed');
      return v;
    });

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar open={open} setOpen={setOpenPersist} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} onOpenLibrary={() => setLibraryOpen(true)} />
      <ChatWindow onOpenMobile={() => setMobileOpen(true)} draft={draft} setDraft={setDraft} />
      <PromptLibraryModal
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onPick={(t) => { newChat(t.mode || 'general'); setDraft(t.prompt); }}
      />
    </div>
  );
}
