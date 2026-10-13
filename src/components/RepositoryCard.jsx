import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api.js';

function dateLabel(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

const activeStatuses = ['queued', 'cloning', 'filtering', 'saving_inventory'];
const stageLabels = {
  queued: 'Waiting to start',
  cloning: 'Downloading repository files',
  filtering: 'Finding eligible files',
  saving_inventory: 'Saving file inventory',
  completed: 'Indexing complete',
  failed: 'Indexing failed',
};

function getStageLabel(job) {
  if (!job) return 'Not indexed yet';
  return stageLabels[job.stage] || stageLabels[job.status] || `Status: ${job.status || 'unknown'}`;
}

export default function RepositoryCard({ repository, onUnauthorized = () => {} }) {
  const imported = dateLabel(repository.importedAt);
  const [job, setJob] = useState(repository.indexing?.latestJob || null);
  const [lastSuccessfulIndex, setLastSuccessfulIndex] = useState(repository.indexing?.lastSuccessfulIndex || null);
  const [statusError, setStatusError] = useState(repository.indexingStatusError || '');
  const [actionError, setActionError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const requestInProgress = useRef(false);

  useEffect(() => {
    setJob(repository.indexing?.latestJob || null);
    setLastSuccessfulIndex(repository.indexing?.lastSuccessfulIndex || null);
    setStatusError(repository.indexingStatusError || '');
  }, [repository.indexing, repository.indexingStatusError]);

  useEffect(() => {
    if (!job?.id || !activeStatuses.includes(job.status)) return undefined;
    let cancelled = false;
    let timer;

    async function refreshJob() {
      if (requestInProgress.current || cancelled) return;
      requestInProgress.current = true;
      setRefreshing(true);
      try {
        const result = await api.indexingJobStatus(job.id);
        if (!cancelled && result.job) {
          setJob(result.job);
          setStatusError('');
        }
      } catch (error) {
        if (!cancelled) {
          if (error.code === 'UNAUTHENTICATED') onUnauthorized();
          else setStatusError(error.message);
        }
      } finally {
        requestInProgress.current = false;
        if (!cancelled) setRefreshing(false);
      }
    }

    timer = window.setInterval(refreshJob, 2000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshJob();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', refreshJob);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', refreshJob);
    };
  }, [job?.id, job?.status, onUnauthorized]);

  async function startIndexing() {
    if (submitting) return;
    setSubmitting(true);
    setActionError('');
    setStatusError('');
    try {
      const result = await api.startRepositoryIndexing(repository.id);
      setJob(result.job);
    } catch (error) {
      if (error.code === 'UNAUTHENTICATED') onUnauthorized();
      setActionError(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  const isActive = job && activeStatuses.includes(job.status);
  const isFailed = job?.status === 'failed';
  const isCompleted = job?.status === 'completed';
  const fileCount = job?.eligibleFileCount ?? lastSuccessfulIndex?.eligibleFileCount;
  const progress = Number.isFinite(job?.progress) ? Math.max(0, Math.min(100, job.progress)) : null;

  return <article className="repo-card">
    <div className="repo-card-main">
      <div className="repo-kicker">PUBLIC REPOSITORY</div>
      <h3>{repository.fullName || `${repository.owner}/${repository.name}`}</h3>
      <p className="repo-description">{repository.description || 'No description provided.'}</p>
      <div className="repo-meta"><span>{repository.language || 'Language not specified'}</span>{repository.defaultBranch && <span>⌥ {repository.defaultBranch}</span>}{Number.isFinite(repository.starsCount) && <span>☆ {repository.starsCount.toLocaleString()}</span>}{imported && <span>Added {imported}</span>}</div>
      <div className={`indexing-panel ${isFailed ? 'indexing-failed' : isCompleted ? 'indexing-completed' : ''}`}>
        <div className="indexing-heading"><span className="section-number">INDEXING</span><span className={`indexing-state ${isActive ? 'state-active' : ''}`}><span className="state-indicator"/>{getStageLabel(job)}</span></div>
        {job?.message && !isFailed && <p className="indexing-message">{job.message}</p>}
        {isActive && progress !== null && <div className="progress-row"><progress max="100" value={progress} aria-label={`Indexing ${progress}% complete`}/><span>{progress}%</span></div>}
        {isActive && refreshing && <span className="refreshing-note" role="status">Updating status…</span>}
        {statusError && <p className="indexing-error" role="alert">{statusError} Status is unchanged; we’ll keep checking.</p>}
        {isFailed && <p className="indexing-error" role="alert">{job.error?.message || job.message || 'Indexing could not be completed.'}</p>}
        {isCompleted && <p className="indexing-message">{Number.isFinite(fileCount) ? `${fileCount.toLocaleString()} eligible files indexed.` : 'Repository inventory is ready.'}{lastSuccessfulIndex?.commitSha && <> Commit <code>{lastSuccessfulIndex.commitSha.slice(0, 7)}</code>.</>}</p>}
        {Number.isFinite(job?.discoveredFileCount) && isCompleted && <p className="indexing-detail">{job.discoveredFileCount.toLocaleString()} files discovered · {Number.isFinite(job.excludedFileCount) ? job.excludedFileCount.toLocaleString() : '—'} excluded</p>}
        {!isActive && <button className="button button-index" onClick={startIndexing} disabled={submitting || !repository.id}>{submitting ? 'Starting…' : isFailed ? 'Retry indexing' : isCompleted ? 'Re-index repository' : 'Index Repository'} <span aria-hidden="true">↗</span></button>}
        {actionError && <p className="indexing-error" role="alert">{actionError}</p>}
      </div>
    </div>
    <a className="repo-link" href={repository.htmlUrl || `https://github.com/${repository.fullName}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${repository.fullName} on GitHub`}>View on GitHub <span aria-hidden="true">↗</span></a>
  </article>;
}
