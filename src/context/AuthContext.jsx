import { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../services/api.js';
export const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading');
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState(null);
  const refresh = useCallback(async () => {
    setStatus('loading'); setAuthError(null);
    try { const result = await api.me(); setUser(result.user); setStatus('authenticated'); return result.user; }
    catch (error) {
      setUser(null);
      if (error.code === 'UNAUTHENTICATED' || error.status === 401) { setStatus('unauthenticated'); return null; }
      setAuthError(error); setStatus('error'); return null;
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  const signOut = useCallback(async () => {
    try { await api.logout(); setUser(null); setStatus('unauthenticated'); return true; }
    catch (error) {
      if (error.code === 'UNAUTHENTICATED' || error.status === 401) { setUser(null); setStatus('unauthenticated'); return true; }
      throw error;
    }
  }, []);
  const value = useMemo(() => ({ status, user, authError, refresh, signOut, clearAuth: () => { setUser(null); setStatus('unauthenticated'); } }), [status,user,authError,refresh,signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
