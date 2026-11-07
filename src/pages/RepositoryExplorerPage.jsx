import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import Navbar from '../components/Navbar.jsx';
import RepositoryAsk from '../components/RepositoryAsk.jsx';
import CodeGraph from '../components/CodeGraph.jsx';
import CodeViewer from '../components/CodeViewer.jsx';
import ReadingGuide from '../components/ReadingGuide.jsx';
import { useAuth } from '../hooks/useAuth.js';
import { api } from '../services/api.js';

const tabs = [
  { id: 'overview', label: 'Overview' }, { id: 'ask', label: 'Ask CodeCompass' },
  { id: 'graph', label: 'Code Graph' }, { id: 'viewer', label: 'Code Viewer' }, { id: 'guide', label: 'Understand This Codebase' }
];

export default function RepositoryExplorerPage() {
  const { repositoryId } = useParams();
  const { clearAuth, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [repository, setRepository] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState(location.state?.tab || 'overview');
  const [sourceTarget, setSourceTarget] = useState(location.state?.sourceTarget || null);
  const [graphTargetId, setGraphTargetId] = useState(location.state?.graphTargetId || null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    api.repositories({ signal: controller.signal }).then((data) => {
      if (cancelled) return;
      const found = (Array.isArray(data.repositories) ? data.repositories : []).find((item) => item.id === repositoryId);
      if (!found) setError('This repository is not available in your account.');
      else setRepository(found);
    }).catch((requestError) => {
      if (requestError.code === 'UNAUTHENTICATED') clearAuth();
      if (!cancelled) setError(requestError.message || 'Repository details could not be loaded.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [repositoryId, clearAuth]);

  useEffect(() => {
    if (location.state?.tab) setTab(location.state.tab);
    if (location.state?.sourceTarget) setSourceTarget(location.state.sourceTarget);
    if (location.state?.graphTargetId) setGraphTargetId(location.state.graphTargetId);
  }, [location.key]);

  const openSource = useCallback((target) => {
    if (!target?.filePath) return;
    setSourceTarget(target);
    setTab('viewer');
  }, []);

  const openGraphNode = useCallback((nodeId) => {
    setGraphTargetId(nodeId);
    setTab('graph');
  }, []);

  return <div className="dashboard-shell">
    <Navbar user={user} onLogout={async () => { try { await api.logout(); } finally { clearAuth(); navigate('/'); } }} loggingOut={false}/>
    <main className="dashboard-main explorer-main">
      <Link className="explorer-back" to="/dashboard">← Your repositories</Link>
      {loading ? <div className="inline-state" role="status"><span className="loader"/>Loading repository…</div>
        : error ? <div className="explorer-state explorer-error" role="alert">{error} <Link to="/dashboard">Return to your repositories</Link></div>
          : repository && <>
            <section className="explorer-repo-heading"><div><span className="section-number">PUBLIC REPOSITORY</span><h1>{repository.fullName || `${repository.owner}/${repository.name}`}</h1><p>{repository.description || 'No description provided.'}</p></div><a className="repo-link" href={repository.htmlUrl} target="_blank" rel="noopener noreferrer">View on GitHub ↗</a></section>
            <nav className="explorer-tabs" aria-label="Repository exploration">
              {tabs.map((item) => <button key={item.id} type="button" className={`explorer-tab ${tab === item.id ? 'explorer-tab-active' : ''}`} onClick={() => setTab(item.id)} aria-current={tab === item.id ? 'page' : undefined}>{item.label}</button>)}
            </nav>
            <div className="explorer-content">
              {tab === 'overview' && <section className="explorer-overview"><span className="section-number">REPOSITORY OVERVIEW</span><h2>Explore the codebase.</h2><p>Ask questions, inspect the static code graph, open source chunks, or follow the reading guide. Index and parse the repository from your dashboard before using graph and source exploration.</p><div className="overview-meta"><span>{repository.language || 'Language not specified'}</span>{repository.defaultBranch && <span>Branch: {repository.defaultBranch}</span>}{Number.isFinite(repository.starsCount) && <span>☆ {repository.starsCount.toLocaleString()}</span>}</div><button className="button button-primary" onClick={() => setTab('ask')}>Ask CodeCompass ↗</button></section>}
              {tab === 'ask' && <RepositoryAsk repository={repository} onUnauthorized={clearAuth} onOpenCitation={openSource}/>}
              {tab === 'graph' && <CodeGraph repository={repository} focusNodeId={graphTargetId} onOpenSource={openSource} onUnauthorized={clearAuth}/>}
              {tab === 'viewer' && <CodeViewer repository={repository} target={sourceTarget} onUnauthorized={clearAuth}/>}
              {tab === 'guide' && <ReadingGuide repository={repository} userId={user?.id} onOpenSource={openSource} onAsk={() => setTab('ask')} onExploreFlow={() => setTab('graph')} onUnauthorized={clearAuth}/>}
            </div>
          </>}
      <footer className="dashboard-footer"><span>CODECOMPASS / REPOSITORY EXPLORER</span><span>STATIC ANALYSIS · SOURCE NAVIGATION</span></footer>
    </main>
  </div>;
}
