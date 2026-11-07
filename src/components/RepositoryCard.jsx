import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services/api.js';
import RepositorySearch from './RepositorySearch.jsx';
import RepositoryAsk from './RepositoryAsk.jsx';

const noOp = () => {};
const stages = [
  { key: 'indexing', label: 'Indexing', detail: 'Finding and saving repository files' },
  { key: 'parsing', label: 'Parsing', detail: 'Reading source files and finding code to understand' },
  { key: 'embeddings', label: 'Generating embeddings', detail: 'Preparing code for questions and search' },
];
const stageJob = (state, key) => state?.stages?.[key];

export default function RepositoryCard({ repository, onUnauthorized = noOp, onOpenCitation, onOpenExplorer = noOp, onProcessingStatusChange = noOp, onDelete = noOp }) {
  const [processing, setProcessing] = useState(repository.processingStatus || null);
  const [statusError, setStatusError] = useState('');
  const [retryError, setRetryError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showAsk, setShowAsk] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const requestInProgress = useRef(false);
  const dialogRef = useRef(null);
  const menuTriggerRef = useRef(null);
  const status = processing?.status;
  const ready = status === 'ready';
  const currentStage = processing?.currentStage;
  const activeStage = stages.find(({ key }) => key === currentStage);
  const explorerReady = Boolean(stageJob(processing, 'parsing')?.completed);
  const searchable = ready && stageJob(processing, 'embeddings')?.embeddedChunks > 0;

  useEffect(() => { if (processing) onProcessingStatusChange(repository.id, processing); }, [repository.id, processing, onProcessingStatusChange]);

  useEffect(() => {
    if (menuOpen) {
      const closeMenuOnEscape = (event) => { if (event.key === 'Escape') setMenuOpen(false); };
      document.addEventListener('keydown', closeMenuOnEscape);
      return () => { document.removeEventListener('keydown', closeMenuOnEscape); menuTriggerRef.current?.focus(); };
    }
    if (!confirmDelete) return undefined;
    const focusFrame = window.requestAnimationFrame(() => dialogRef.current?.querySelector('button:not(:disabled)')?.focus());
    const keepDialogFocus = (event) => {
      if (event.key === 'Escape' && !deleting) setConfirmDelete(false);
      if (event.key !== 'Tab') return;
      const buttons = [...dialogRef.current.querySelectorAll('button:not(:disabled)')];
      if (!buttons.length) return;
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
    };
    document.addEventListener('keydown', keepDialogFocus);
    return () => { window.cancelAnimationFrame(focusFrame); document.removeEventListener('keydown', keepDialogFocus); menuTriggerRef.current?.focus(); };
  }, [menuOpen, confirmDelete, deleting]);

  async function confirmRemoval() {
    if (deleting) return;
    setDeleting(true); setDeleteError('');
    try { await onDelete(repository); setConfirmDelete(false); }
    catch (error) { setDeleteError(error.message || 'Repository could not be deleted. Please try again.'); }
    finally { setDeleting(false); }
  }

  const refresh = useCallback(async () => {
    if (requestInProgress.current) return;
    requestInProgress.current = true;
    try {
      const latest = await api.repositoryProcessingStatus(repository.id);
      setProcessing(latest);
      setStatusError('');
    } catch (error) {
      if (error.code === 'UNAUTHENTICATED') onUnauthorized();
      else setStatusError(error.message || 'Could not update repository status.');
    } finally { requestInProgress.current = false; }
  }, [repository.id, onUnauthorized]);

  useEffect(() => {
    let timer;
    let cancelled = false;
    const load = async () => {
      if (cancelled || requestInProgress.current) return;
      requestInProgress.current = true;
      try {
        const latest = await api.repositoryProcessingStatus(repository.id);
        if (!cancelled) { setProcessing(latest); setStatusError(''); }
      } catch (error) {
        if (!cancelled) {
          if (error.code === 'UNAUTHENTICATED') onUnauthorized();
          else setStatusError(error.message || 'Could not update repository status.');
        }
      } finally { requestInProgress.current = false; }
    };
    void load();
    if (!['ready', 'failed'].includes(status) || !processing) timer = window.setInterval(load, 4000);
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; if (timer) window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [repository.id, status, Boolean(processing), onUnauthorized]);

  async function retry() {
    if (retrying) return;
    setRetrying(true); setRetryError('');
    try {
      if (currentStage === 'indexing') await api.startRepositoryIndexing(repository.id);
      else if (currentStage === 'parsing') await api.startRepositoryParsing(repository.id);
      else if (currentStage === 'embeddings') await api.startRepositoryEmbeddings(repository.id);
      await refresh();
    } catch (error) {
      if (error.code === 'UNAUTHENTICATED') onUnauthorized();
      else setRetryError(error.message || 'Retry could not be started.');
    } finally { setRetrying(false); }
  }

  const imported = repository.importedAt ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(repository.importedAt)) : null;
  const errorMessage = processing?.stages?.[currentStage]?.error || '';
  return <article className={'repo-card ' + (ready ? 'repo-card-ready' : 'repo-card-processing')}>
    <div className="repo-card-main">
      <div className="repo-card-topline"><span className="repo-kicker">GITHUB REPOSITORY</span><div className="repo-menu-wrap"><button ref={menuTriggerRef} type="button" className="repo-menu-trigger" aria-label={`Actions for ${repository.fullName}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>⋯</button>{menuOpen && <div className="repo-menu" role="menu"><a role="menuitem" href={repository.htmlUrl || ('https://github.com/' + repository.fullName)} target="_blank" rel="noopener noreferrer" onClick={() => setMenuOpen(false)}>Open on GitHub ↗</a><button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setDeleteError(''); setConfirmDelete(true); }}>Delete repository</button></div>}</div></div>
      <h3>{repository.fullName || (repository.owner + '/' + repository.name)}</h3>
      {repository.description && <p className="repo-description">{repository.description}</p>}
      <div className="repo-meta"><span>{repository.language || 'Language not specified'}</span>{repository.defaultBranch && <span>Branch: {repository.defaultBranch}</span>}{imported && <span>Added {imported}</span>}</div>
      <section className={'repo-processing ' + (ready ? 'is-ready' : processing?.status === 'failed' ? 'has-failed' : '')} aria-label="Repository processing status" aria-live="polite">
        <div className="repo-processing-heading"><strong>{ready ? 'Ready to explore' : processing?.status === 'failed' ? (activeStage?.label || 'Processing') + ' needs attention' : activeStage ? activeStage.label : 'Getting started'}</strong><span className={'repo-status-pill ' + (ready ? 'ready' : processing?.status === 'failed' ? 'failed' : 'working')}><i aria-hidden="true"/>{ready ? 'Ready' : processing?.status === 'failed' ? 'Action needed' : 'In progress'}</span></div>
        {!ready && <>
          <div className="repo-stage-track" aria-label="Repository processing stages">
            {stages.map(({ key, label }, index) => {
              const item = stageJob(processing, key);
              const done = Boolean(item?.completed);
              const current = currentStage === key && processing?.status !== 'failed';
              const pct = current && Number.isFinite(item?.progress) ? Math.max(0, Math.min(100, item.progress)) : null;
              return <div className={'repo-stage ' + (done ? 'done' : current ? 'current' : '')} key={key}><span className="repo-stage-mark" aria-hidden="true">{done ? '✓' : index + 1}</span><span>{label}</span>{pct !== null && <small>{pct}%</small>}</div>;
            })}
          </div>
          <p className="repo-processing-message">{processing?.status === 'failed' ? errorMessage || ('The ' + (activeStage?.label.toLowerCase() || 'processing') + ' step did not finish.') : activeStage?.detail || 'Your repository has been added. Processing will begin shortly.'}</p>
          {activeStage && <progress className="repo-progress" max="100" value={Number.isFinite(stageJob(processing, currentStage)?.progress) ? Math.max(0, Math.min(100, stageJob(processing, currentStage).progress)) : 0} aria-label={activeStage.label + ' progress'}/>}
          {currentStage === 'indexing' && stageJob(processing, 'indexing')?.discoveredFiles != null && <p className="repo-count">{stageJob(processing, 'indexing').discoveredFiles} files found · {stageJob(processing, 'indexing').eligibleFiles} eligible</p>}
          {currentStage === 'parsing' && <p className="repo-count">{stageJob(processing, 'parsing')?.processedFiles || 0} of {stageJob(processing, 'parsing')?.totalFiles || 0} files read{stageJob(processing, 'parsing')?.chunks != null ? ' · ' + stageJob(processing, 'parsing').chunks + ' code sections found' : ''}</p>}
          {currentStage === 'embeddings' && <p className="repo-count">{stageJob(processing, 'embeddings')?.processedChunks || 0} of {stageJob(processing, 'embeddings')?.totalChunks || 0} code sections prepared</p>}
          {processing?.status === 'failed' && <button className="button button-outline repo-retry" onClick={retry} disabled={retrying}>{retrying ? 'Retrying…' : 'Retry ' + (activeStage?.label.toLowerCase() || 'step')}</button>}
        </>}
        {ready && <p className="repo-processing-message">{searchable ? 'Repository analysis is complete. You can now ask questions, search the code, or explore its structure.' : 'Repository analysis is complete. You can now explore its structure.'}</p>}
        {ready && <p className="repo-ready-stages" aria-label="Indexing, parsing, and embeddings completed">Indexing ✓ <span>→</span> Parsing ✓ <span>→</span> Embeddings ✓</p>}
        {statusError && <p className="repo-status-error" role="alert">{statusError}</p>}
        {retryError && <p className="repo-status-error" role="alert">{retryError}</p>}
      </section>
      {(ready || explorerReady) && <div className="repo-actions">
        {searchable && <button className="button button-primary" onClick={() => setShowAsk((value) => !value)} aria-expanded={showAsk}>{showAsk ? 'Hide Q&A' : 'Ask CodeCompass'}</button>}
        {searchable && <button className="button button-outline" onClick={() => setShowSearch((value) => !value)} aria-expanded={showSearch}>{showSearch ? 'Hide search' : 'Search Repository'}</button>}
        {explorerReady && <button className="button button-outline" onClick={() => onOpenExplorer(repository.id)}>Open Explorer</button>}
        {!searchable && <p className="repo-count">No searchable code sections were found in this repository. The explorer is still available.</p>}
      </div>}
      {ready && showSearch && searchable && <RepositorySearch repository={repository} onUnauthorized={onUnauthorized}/>}
      {ready && showAsk && searchable && <RepositoryAsk repository={repository} onUnauthorized={onUnauthorized} onOpenCitation={onOpenCitation}/>}
    </div>
    {confirmDelete && <div className="delete-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleting) setConfirmDelete(false); }}><section ref={dialogRef} className="delete-dialog" role="dialog" aria-modal="true" aria-labelledby={`delete-title-${repository.id}`} aria-describedby={`delete-copy-${repository.id}`}>
      <h2 id={`delete-title-${repository.id}`}>Delete repository?</h2>
      <p id={`delete-copy-${repository.id}`}>Are you sure you want to remove <strong>{repository.fullName}</strong> from CodeCompass?</p>
      <p>This permanently deletes its indexed files, parsed code, embeddings, processing history, and saved analysis data from CodeCompass. It will not delete the original repository from GitHub.</p>
      {deleteError && <p className="delete-error" role="alert">{deleteError}</p>}
      <div className="delete-dialog-actions"><button type="button" className="button button-outline" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</button><button type="button" className="button button-danger" onClick={confirmRemoval} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete repository'}</button></div>
    </section></div>}
  </article>;
}
