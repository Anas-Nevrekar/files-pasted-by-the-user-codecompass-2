import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
export default function ProtectedRoute({ children }) {
  const { status } = useAuth(); const location = useLocation();
  if (status === 'loading') return <main className="center-state" role="status">Checking your session…</main>;
  if (status === 'error') return <main className="center-state"><p>We couldn’t check your session. Check your connection and try again.</p><button className="button" onClick={() => window.location.reload()}>Try again</button></main>;
  if (status !== 'authenticated') return <Navigate to="/" replace state={{ from: location.pathname, notice: 'Sign in with GitHub to access your dashboard.' }} />;
  return children;
}
