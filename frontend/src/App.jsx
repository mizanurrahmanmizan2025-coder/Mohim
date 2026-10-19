import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { ChatProvider } from './context/ChatContext.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Admin from './pages/Admin.jsx';
import SharedChat from './pages/SharedChat.jsx';
import { Sparkle } from './components/Logo.jsx';

function Splash() {
  return (
    <div className="flex h-full items-center justify-center">
      <Sparkle className="thinking-star h-10 w-10" />
    </div>
  );
}

function Private({ children, admin = false }) {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function GuestOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  return user ? <Navigate to="/" replace /> : children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
      <Route path="/share/:shareId" element={<SharedChat />} />
      <Route path="/admin" element={<Private admin><Admin /></Private>} />
      <Route
        path="/c/:chatId?"
        element={<Private><ChatProvider><Dashboard /></ChatProvider></Private>}
      />
      <Route path="/" element={<Navigate to="/c" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
