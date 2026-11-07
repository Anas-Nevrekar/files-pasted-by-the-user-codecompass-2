import { useCallback, useEffect, useState } from 'react';
import Navbar from '../components/Navbar.jsx';
import RepositoryForm from '../components/RepositoryForm.jsx';
import RepositoryCard from '../components/RepositoryCard.jsx';
import { api } from '../services/api.js';
import { useAuth } from '../hooks/useAuth.js';
import { useNavigate } from 'react-router-dom';

export default function DashboardPage() {
  const { user, signOut, clearAuth } = useAuth();
  const navigate = useNavigate();
  const [repositories, setRepositories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const [processingByRepository, setProcessingByRepository] = useState({});
  const [notice, setNotice] = useState('');

  const loadRepositories = useCallback(async () => {
    setLoading(true);
    setListError('');
    try {
      const data = await api.repositories();
      const repositoryList = Array.isArray(data.repositories) ? data.repositories : [];
      setRepositories(repositoryList);
      setProcessingByRepository({});
    } catch (error) {
      if (error.code === 'UNAUTHENTICATED') { clearAuth(); return; }
      setListError(error.message);
    } finally {
      setLoading(false);
    }
  }, [clearAuth]);

  useEffect(() => { loadRepositories(); }, [loadRepositories]);

  async function importRepository(url) {
    try {
      const result = await api.importRepository(url);
      setRepositories((current) => {
        const item = { ...result.repository, processingStatus: result.processing || null };
        const existing = current.findIndex((repository) => repository.id === item.id || repository.fullName?.toLowerCase() === item.fullName?.toLowerCase());
        if (existing < 0) return [item, ...current];
        const next = [...current];
        next[existing] = { ...next[existing], ...item };
        return next;
      });
      if (result.processing) setProcessingByRepository((current) => ({ ...current, [result.repository.id]: result.processing }));
      setNotice('');
      return result;
    } catch (error) {
      if (error.code === 'UNAUTHENTICATED') clearAuth();
      throw error;
    }
  }

  const updateProcessingStatus = useCallback((repositoryId, status) => {
    setProcessingByRepository((current) => {
      if (JSON.stringify(current[repositoryId]) === JSON.stringify(status)) return current;
      return { ...current, [repositoryId]: status };
    });
  }, []);

  async function deleteRepository(repository) {
    try {
      await api.deleteRepository(repository.id);
      setRepositories((current) => current.filter((item) => item.id !== repository.id));
      setProcessingByRepository((current) => {
        const next = { ...current };
        delete next[repository.id];
        return next;
      });
      setNotice(`${repository.fullName} was removed from CodeCompass.`);
    } catch (error) {
      if (error.code === 'UNAUTHENTICATED') clearAuth();
      throw error;
    }
  }

  const summaryReady = repositories.filter((repository) => processingByRepository[repository.id]?.status === 'ready').length;
  const summaryAttention = repositories.filter((repository) => processingByRepository[repository.id]?.status === 'failed').length;
  const summaryKnown = repositories.filter((repository) => processingByRepository[repository.id]).length;
  const summaryProcessing = Math.max(0, summaryKnown - summaryReady - summaryAttention);

  async function logout() {
    setLoggingOut(true);
    setLogoutError('');
    try { await signOut(); }
    catch (error) { setLogoutError(error.message); }
    finally { setLoggingOut(false); }
  }

  return <div className="dashboard-shell">
    <Navbar user={user} onLogout={logout} loggingOut={loggingOut}/>
    <main className="dashboard-main">
      <section className="welcome">
        <div><div className="eyebrow"><span className="eyebrow-dot"/> YOUR WORKSPACE</div><h1>Understand any<br/>codebase, <em>faster.</em></h1><p>Import a GitHub repository and let CodeCompass map its structure, analyze its code, and help you understand how everything works.</p></div>
      </section>
      {logoutError && <p className="notice notice-error" role="alert">{logoutError}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {!loading && !listError && <section className="workspace-summary" aria-label="Repository summary">
        <span className="summary-title">Your workspace</span>
        <div className="summary-metrics">
          <div><strong>{repositories.length}</strong><span>Total repositories</span></div>
          <div><strong>{summaryKnown === repositories.length ? summaryReady : '—'}</strong><span>Ready</span></div>
          <div><strong>{summaryKnown === repositories.length ? summaryProcessing : '—'}</strong><span>Processing</span></div>
          <div><strong>{summaryKnown === repositories.length ? summaryAttention : '—'}</strong><span>Needs attention</span></div>
        </div>
      </section>}
      <section className="import-panel"><div className="section-heading"><div><span className="section-number">01 / IMPORT</span><h2>Start with a GitHub repository.</h2></div><p>CodeCompass will process it automatically<br/>and show each step below.</p></div><RepositoryForm onImport={importRepository}/></section>
      <section className="repositories-section">
        <div className="section-heading repo-heading"><div><span className="section-number">02 / YOUR LIBRARY</span><h2>Your repositories <span className="count">{repositories.length.toString().padStart(2, '0')}</span></h2><p>Your imported repositories and their processing status.</p></div>{repositories.length > 0 && <span className="list-note">Newest imports first</span>}</div>
        {loading ? <div className="inline-state" role="status"><span className="loader"/>Loading your repositories…</div>
          : listError ? <div className="empty-state"><p>{listError}</p><button className="button button-outline" onClick={loadRepositories}>Try again ↗</button></div>
            : repositories.length === 0 ? <div className="empty-state"><div className="empty-glyph">⌘</div><h3>Your library is waiting.</h3><p>Paste a public GitHub URL above to add your first repository.</p></div>
              : <div className="repo-list">{repositories.map((repository) => <RepositoryCard key={repository.id || repository.fullName} repository={repository} onUnauthorized={clearAuth} onProcessingStatusChange={updateProcessingStatus} onDelete={deleteRepository} onOpenExplorer={(id) => navigate(`/repositories/${id}`)} onOpenCitation={(citation) => navigate(`/repositories/${repository.id}`, { state: { tab: 'viewer', sourceTarget: citation } })}/>)}</div>}
      </section>
    </main>
  </div>;
}
