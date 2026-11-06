import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api.js';
import RepositorySearch from './RepositorySearch.jsx';
import RepositoryAsk from './RepositoryAsk.jsx';

function dateLabel(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

const activeStatuses = ['queued', 'cloning', 'filtering', 'saving_inventory'];
const noOp = () => {};
const stageLabels = {
  queued: 'Waiting to start',
  cloning: 'Downloading repository files',
  filtering: 'Finding eligible files',
  saving_inventory: 'Saving file inventory',
  completed: 'Indexing complete',
  failed: 'Indexing failed',
};

const activeParsingStatuses = ['queued', 'processing'];
const activeEmbeddingStatuses = ['queued', 'processing'];
const embeddingStageLabels = {
  queued: 'Waiting to start', loading_chunks: 'Loading code chunks',
  generating_embeddings: 'Generating embeddings', saving_embeddings: 'Saving embeddings',
  completed: 'Embeddings generated', failed: 'Embedding generation failed',
};
const parsingStageLabels = {
  queued: 'Waiting to start',
  parsing: 'Parsing source files',
  completed: 'Parsing completed',
  failed: 'Parsing failed',
};

function getSavedParsingJob(repositoryId) {
  try {
    const savedJobs = JSON.parse(window.localStorage.getItem('codecompass-parsing-jobs') || '{}');
    return savedJobs[repositoryId] || null;
  } catch {
    return null;
  }
}

function saveParsingJob(repositoryId, job) {
  try {
    const savedJobs = JSON.parse(window.localStorage.getItem('codecompass-parsing-jobs') || '{}');
    savedJobs[repositoryId] = job;
    window.localStorage.setItem('codecompass-parsing-jobs', JSON.stringify(savedJobs));
  } catch {
    // The current page can still follow the job if browser storage is unavailable.
  }
}

function getSavedEmbeddingJob(repositoryId) {
  try {
    const savedJobs = JSON.parse(window.localStorage.getItem('codecompass-embedding-jobs') || '{}');
    return savedJobs[repositoryId] || null;
  } catch { return null; }
}

function saveEmbeddingJob(repositoryId, job) {
  try {
    const savedJobs = JSON.parse(window.localStorage.getItem('codecompass-embedding-jobs') || '{}');
    savedJobs[repositoryId] = job;
    window.localStorage.setItem('codecompass-embedding-jobs', JSON.stringify(savedJobs));
  } catch { /* Keep following the job in memory when browser storage is unavailable. */ }
}

function getStageLabel(job) {
  if (!job) return 'Not indexed yet';
  return stageLabels[job.stage] || stageLabels[job.status] || `Status: ${job.status || 'unknown'}`;
}

export default function RepositoryCard({ repository, onUnauthorized = noOp }) {
  const imported = dateLabel(repository.importedAt);
  const [job, setJob] = useState(repository.indexing?.latestJob || null);
  const [lastSuccessfulIndex, setLastSuccessfulIndex] = useState(repository.indexing?.lastSuccessfulIndex || null);
  const [statusError, setStatusError] = useState(repository.indexingStatusError || '');
  const [actionError, setActionError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [parsingJob, setParsingJob] = useState(() => getSavedParsingJob(repository.id));
  const [embeddingJob, setEmbeddingJob] = useState(() => getSavedEmbeddingJob(repository.id));
  const [embeddingError, setEmbeddingError] = useState('');
  const [embeddingActionError, setEmbeddingActionError] = useState('');
  const [startingEmbeddings, setStartingEmbeddings] = useState(false);
  const [refreshingEmbeddings, setRefreshingEmbeddings] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showAsk, setShowAsk] = useState(false);
  const [parsingError, setParsingError] = useState('');
  const [parsingActionError, setParsingActionError] = useState('');
  const [parsingSourceUnavailableAfterIndex, setParsingSourceUnavailableAfterIndex] = useState(null);
  const [startingParsing, setStartingParsing] = useState(false);
  const [refreshingParsing, setRefreshingParsing] = useState(false);
  const parsingRequestInProgress = useRef(false);
  const parsingStartInProgress = useRef(false);
  const embeddingRequestInProgress = useRef(false);
  const embeddingStartInProgress = useRef(false);
  const lastImmediatelyCheckedEmbeddingJob = useRef(null);
  const lastImmediatelyCheckedParsingJob = useRef(null);
  const requestInProgress = useRef(false);

  useEffect(() => {
    setParsingJob(getSavedParsingJob(repository.id));
    setParsingError('');
    setParsingActionError('');
  }, [repository.id]);

  useEffect(() => {
    setEmbeddingJob(getSavedEmbeddingJob(repository.id));
    setEmbeddingError('');
    setEmbeddingActionError('');
    setShowSearch(false);
    setShowAsk(false);
  }, [repository.id]);

  useEffect(() => {
    if (parsingSourceUnavailableAfterIndex && job?.status === 'completed' && job.id !== parsingSourceUnavailableAfterIndex) {
      setParsingSourceUnavailableAfterIndex(null);
      setParsingActionError('');
    }
  }, [job?.id, job?.status, parsingSourceUnavailableAfterIndex]);

  useEffect(() => {
    if (!parsingJob?.id || !activeParsingStatuses.includes(parsingJob.status)) return undefined;
    let cancelled = false;
    let timer;

    async function refreshParsingJob() {
      if (parsingRequestInProgress.current || cancelled) return;
      parsingRequestInProgress.current = true;
      setRefreshingParsing(true);
      try {
        const result = await api.parsingJobStatus(parsingJob.id);
        if (!cancelled && result.job) {
          setParsingJob(result.job);
          saveParsingJob(repository.id, result.job);
          setParsingError('');
        }
      } catch (error) {
        if (!cancelled) {
          if (error.code === 'UNAUTHENTICATED') onUnauthorized();
          else setParsingError(error.message);
        }
      } finally {
        parsingRequestInProgress.current = false;
        if (!cancelled) setRefreshingParsing(false);
      }
    }

    timer = window.setInterval(refreshParsingJob, 2000);
    if (lastImmediatelyCheckedParsingJob.current !== parsingJob.id) {
      lastImmediatelyCheckedParsingJob.current = parsingJob.id;
      refreshParsingJob();
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshParsingJob();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', refreshParsingJob);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', refreshParsingJob);
    };
  }, [parsingJob?.id, parsingJob?.status, repository.id, onUnauthorized]);

  useEffect(() => {
    if (!embeddingJob?.id || !activeEmbeddingStatuses.includes(embeddingJob.status)) return undefined;
    let cancelled = false;
    let timer;

    async function refreshEmbeddingJob() {
      if (embeddingRequestInProgress.current || cancelled) return;
      embeddingRequestInProgress.current = true;
      setRefreshingEmbeddings(true);
      try {
        const result = await api.embeddingJobStatus(embeddingJob.id);
        if (!cancelled && result.job) {
          setEmbeddingJob(result.job);
          saveEmbeddingJob(repository.id, result.job);
          setEmbeddingError('');
        }
      } catch (error) {
        if (!cancelled) {
          if (error.code === 'UNAUTHENTICATED') onUnauthorized();
          else setEmbeddingError(error.message);
        }
      } finally {
        embeddingRequestInProgress.current = false;
        if (!cancelled) setRefreshingEmbeddings(false);
      }
    }

    timer = window.setInterval(refreshEmbeddingJob, 2000);
    if (lastImmediatelyCheckedEmbeddingJob.current !== embeddingJob.id) {
      lastImmediatelyCheckedEmbeddingJob.current = embeddingJob.id;
      refreshEmbeddingJob();
    }
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') refreshEmbeddingJob(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', refreshEmbeddingJob);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', refreshEmbeddingJob);
    };
  }, [embeddingJob?.id, embeddingJob?.status, repository.id, onUnauthorized]);

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

  async function startParsing() {
    if (parsingStartInProgress.current) return;
    parsingStartInProgress.current = true;
    setStartingParsing(true);
    setParsingActionError('');
    setParsingError('');
    try {
      const result = await api.startRepositoryParsing(repository.id);
      setParsingJob(result.job);
      saveParsingJob(repository.id, result.job);
    } catch (error) {
      if (error.code === 'UNAUTHENTICATED') onUnauthorized();
      if (error.code === 'PARSING_SOURCE_UNAVAILABLE') setParsingSourceUnavailableAfterIndex(job?.id || 'no-completed-index');
      setParsingActionError(error.message);
    } finally {
      parsingStartInProgress.current = false;
      setStartingParsing(false);
    }
  }

  async function startEmbeddings() {
    if (embeddingStartInProgress.current || startingEmbeddings) return;
    embeddingStartInProgress.current = true;
    setStartingEmbeddings(true);
    setEmbeddingError('');
    setEmbeddingActionError('');
    try {
      const result = await api.startRepositoryEmbeddings(repository.id);
      if (!result.job) throw new Error('The backend did not return an embedding job. Please try again.');
      setEmbeddingJob(result.job);
      saveEmbeddingJob(repository.id, result.job);
    } catch (error) {
      if (error.code === 'UNAUTHENTICATED') onUnauthorized();
      setEmbeddingActionError(error.message || 'Embedding generation could not be started.');
    } finally {
      embeddingStartInProgress.current = false;
      setStartingEmbeddings(false);
    }
  }

  const isActive = job && activeStatuses.includes(job.status);
  const isFailed = job?.status === 'failed';
  const isCompleted = job?.status === 'completed';
  const fileCount = job?.eligibleFileCount ?? lastSuccessfulIndex?.eligibleFileCount;
  const progress = Number.isFinite(job?.progress) ? Math.max(0, Math.min(100, job.progress)) : null;
  const parsingIsActive = parsingJob && activeParsingStatuses.includes(parsingJob.status);
  const parsingIsComplete = parsingJob?.status === 'completed';
  const parsingHasErrors = parsingJob?.status === 'completed_with_errors';
  const parsingFailed = parsingJob?.status === 'failed';
  const hasCompletedIndex = job?.status === 'completed' || Boolean(lastSuccessfulIndex);
  const canReparse = hasCompletedIndex && job?.status === 'completed' &&
    Number.isFinite(Date.parse(job.completedAt || '')) &&
    Number.isFinite(Date.parse(parsingJob?.completedAt || '')) &&
    Date.parse(job.completedAt) > Date.parse(parsingJob.completedAt);
  const canRetryParsing = parsingFailed || (parsingHasErrors && parsingJob.failedFiles > 0);
  const parsingProgress = Number.isFinite(parsingJob?.progress) ? Math.max(0, Math.min(100, parsingJob.progress)) : null;
  const embeddingMatchesCurrentParse = Boolean(embeddingJob && parsingJob?.id && embeddingJob.parsingJobId === parsingJob.id);
  const embeddingIsActive = embeddingJob && activeEmbeddingStatuses.includes(embeddingJob.status);
  const embeddingIsCompleted = embeddingMatchesCurrentParse && embeddingJob.status === 'completed';
  const embeddingHasErrors = embeddingMatchesCurrentParse && embeddingJob.status === 'completed_with_errors';
  const embeddingFailed = embeddingMatchesCurrentParse && embeddingJob.status === 'failed';
  const embeddingCompletedEmpty = embeddingMatchesCurrentParse && embeddingJob.status === 'completed' && embeddingJob.embeddedChunks === 0;
  const parsedReady = parsingJob && ['completed', 'completed_with_errors'].includes(parsingJob.status);
  const latestIndexAt = Date.parse((job?.status === 'completed' && job.completedAt) || lastSuccessfulIndex?.indexedAt || '');
  const latestParseAt = Date.parse(parsingJob?.completedAt || '');
  const parsingMatchesLatestIndex = Number.isFinite(latestIndexAt) && Number.isFinite(latestParseAt) && latestParseAt >= latestIndexAt;
  const parsingNeedsRefresh = Boolean(parsedReady && Number.isFinite(latestIndexAt) && Number.isFinite(latestParseAt) && latestIndexAt > latestParseAt);
  const retrievalReady = embeddingMatchesCurrentParse && parsingMatchesLatestIndex && embeddingJob.embeddedChunks > 0 && (embeddingIsCompleted || embeddingHasErrors);
  const embeddingProgress = Number.isFinite(embeddingJob?.progress) ? Math.max(0, Math.min(100, embeddingJob.progress)) : null;
  const embeddingStage = embeddingJob?.status === 'completed_with_errors' ? 'Completed with errors'
    : embeddingStageLabels[embeddingJob?.stage] || (embeddingJob?.status ? `Status: ${embeddingJob.status}` : 'Not generated');

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
      <div className={`indexing-panel parsing-panel ${parsingFailed ? 'indexing-failed' : parsingIsComplete ? 'indexing-completed' : parsingHasErrors ? 'parsing-partial' : ''}`}>
        <div className="indexing-heading"><span className="section-number">AST PARSING</span><span className={`indexing-state ${parsingIsActive ? 'state-active' : ''}`}><span className="state-indicator"/>{parsingJob ? (parsingStageLabels[parsingJob.stage] || `Status: ${parsingJob.status}`) : 'Not parsed yet'}</span></div>
        {!parsingJob && <p className="indexing-message">Parse this repository after indexing is complete to extract code chunks.</p>}
        {parsingJob && <div className="parsing-stats">
          {parsingIsActive && parsingProgress !== null && <div className="progress-row"><progress max="100" value={parsingProgress} aria-label={`Parsing ${parsingProgress}% complete`}/><span>{parsingProgress}%</span></div>}
          {(parsingIsActive || parsingIsComplete || parsingHasErrors || parsingFailed) && <p className="indexing-detail">{Number.isFinite(parsingJob.processedFiles) && <span>{parsingJob.processedFiles} / {parsingJob.totalFiles} files processed</span>}{Number.isFinite(parsingJob.parsedFiles) && <span> · {parsingJob.parsedFiles} parsed</span>}{Number.isFinite(parsingJob.skippedFiles) && <span> · {parsingJob.skippedFiles} skipped</span>}{Number.isFinite(parsingJob.failedFiles) && <span> · {parsingJob.failedFiles} failed</span>}</p>}
          {Number.isFinite(parsingJob.totalChunks) && <p className="indexing-detail">{parsingJob.totalChunks.toLocaleString()} code chunks extracted</p>}
          {parsingJob.completedAt && <p className="indexing-detail">Completed {dateLabel(parsingJob.completedAt)}</p>}
          {parsingJob.errorMessage && <p className="indexing-error" role="alert">{parsingJob.errorMessage}</p>}
        </div>}
        {parsingError && <p className="indexing-error" role="alert">{parsingError} Status is unchanged; we’ll keep checking.</p>}
        {parsingIsActive && refreshingParsing && <span className="refreshing-note" role="status">Updating parsing status…</span>}
        {parsingHasErrors && <p className="indexing-message">Parsing completed, but some files were skipped or could not be processed.</p>}
        {(parsingIsComplete || parsingHasErrors) && !canRetryParsing && <p className="indexing-detail">Re-index this repository to create a fresh source snapshot before parsing again.</p>}
        {!parsingJob && !hasCompletedIndex && <p className="indexing-detail">Repository indexing must finish before parsing can start.</p>}
        {parsingSourceUnavailableAfterIndex && <p className="indexing-detail">Re-index this repository to make its source available for parsing again.</p>}
        {!parsingIsActive && hasCompletedIndex && !parsingSourceUnavailableAfterIndex && <button className="button button-index" onClick={startParsing} disabled={startingParsing || !repository.id || isActive || ((parsingIsComplete || parsingHasErrors) && !canRetryParsing && !canReparse)}>{startingParsing ? 'Starting…' : canRetryParsing ? 'Retry parsing' : (parsingIsComplete || parsingHasErrors) ? 'Re-parse Repository' : 'Parse Repository'} <span aria-hidden="true">↗</span></button>}
        {parsingActionError && <p className="indexing-error" role="alert">{parsingActionError}</p>}
      </div>
      <div className={`indexing-panel embedding-panel ${embeddingFailed ? 'indexing-failed' : embeddingIsCompleted ? 'indexing-completed' : embeddingHasErrors ? 'parsing-partial' : ''}`}>
        <div className="indexing-heading"><span className="section-number">EMBEDDINGS</span><span className={`indexing-state ${embeddingIsActive ? 'state-active' : ''}`}><span className="state-indicator"/>{!parsedReady ? 'Waiting for parsing' : embeddingMatchesCurrentParse ? embeddingStage : embeddingIsActive ? `${embeddingStage} · previous parse` : 'Not generated for latest parse'}</span></div>
        {!parsedReady && <p className="indexing-message">Complete AST parsing before generating embeddings.</p>}
        {embeddingJob && <div className="embedding-stats">
          {embeddingIsActive && embeddingProgress !== null && <div className="progress-row"><progress max="100" value={embeddingProgress} aria-label={`Embedding ${embeddingProgress}% complete`}/><span>{embeddingProgress}%</span></div>}
          {(embeddingMatchesCurrentParse || embeddingIsActive) && <p className="indexing-detail">{Number.isFinite(embeddingJob.processedChunks) && <span>{embeddingJob.processedChunks} / {embeddingJob.totalChunks} chunks processed</span>}{Number.isFinite(embeddingJob.embeddedChunks) && <span> · {embeddingJob.embeddedChunks} embedded</span>}{Number.isFinite(embeddingJob.skippedChunks) && <span> · {embeddingJob.skippedChunks} reused or skipped</span>}{Number.isFinite(embeddingJob.failedChunks) && <span> · {embeddingJob.failedChunks} failed</span>}</p>}
          {embeddingJob.completedAt && embeddingMatchesCurrentParse && <p className="indexing-detail">Completed {dateLabel(embeddingJob.completedAt)}</p>}
          {embeddingFailed && embeddingJob.errorMessage && <p className="indexing-error" role="alert">{embeddingJob.errorMessage}</p>}
          {embeddingHasErrors && <p className="indexing-message">Some chunks could not be embedded. Retry to process missing chunks.</p>}
          {embeddingCompletedEmpty && <p className="indexing-message">No code chunks were available to search in this parsing result.</p>}
        </div>}
        {embeddingError && <p className="indexing-error" role="alert">{embeddingError} Status is unchanged; we’ll keep checking.</p>}
        {embeddingIsActive && refreshingEmbeddings && <span className="refreshing-note" role="status">Updating embedding status…</span>}
        {embeddingIsActive && !embeddingMatchesCurrentParse && <p className="indexing-detail">An embedding job for an earlier parse is still active.</p>}
        {parsedReady && !retrievalReady && !embeddingCompletedEmpty && <button className="button button-index" onClick={startEmbeddings} disabled={startingEmbeddings || Boolean(embeddingIsActive)}>{startingEmbeddings ? 'Starting…' : embeddingHasErrors || embeddingFailed ? 'Retry embeddings' : 'Generate Embeddings'} <span aria-hidden="true">↗</span></button>}
        {embeddingActionError && <p className="indexing-error" role="alert">{embeddingActionError}</p>}
        {retrievalReady && <button className="button button-index search-toggle" onClick={() => setShowSearch((value) => !value)} aria-expanded={showSearch}>{showSearch ? 'Hide code search' : 'Search repository'} <span aria-hidden="true">{showSearch ? '−' : '↗'}</span></button>}
        {retrievalReady && showSearch && <RepositorySearch repository={repository} onUnauthorized={onUnauthorized}/>}
        {retrievalReady && <button className="button button-index ask-toggle" onClick={() => setShowAsk((value) => !value)} aria-expanded={showAsk}>{showAsk ? 'Hide codebase Q&A' : 'Ask about this repository'} <span aria-hidden="true">{showAsk ? '−' : '↗'}</span></button>}
        {!retrievalReady && <p className="indexing-detail ask-readiness-note">{!hasCompletedIndex ? 'Index this repository before asking questions.' : !parsedReady ? parsingIsActive ? 'Question answering is waiting for AST parsing to finish.' : 'Complete AST parsing before asking questions.' : parsingNeedsRefresh ? 'Re-parse the latest indexed snapshot before asking questions.' : embeddingIsActive ? 'Question answering is waiting for embeddings to finish.' : 'Generate embeddings for the latest parsing result before asking questions.'}</p>}
        {retrievalReady && showAsk && <RepositoryAsk repository={repository} onUnauthorized={onUnauthorized}/>}
      </div>
    </div>
    <a className="repo-link" href={repository.htmlUrl || `https://github.com/${repository.fullName}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${repository.fullName} on GitHub`}>View on GitHub <span aria-hidden="true">↗</span></a>
  </article>;
}
