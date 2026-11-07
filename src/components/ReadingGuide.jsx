import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api.js';

const noOp = () => {};

function progressKey(userId, repositoryId, parsingJobId) {
  return `codecompass-onboarding-position:${userId || 'unknown-user'}:${repositoryId}:${parsingJobId || 'current'}`;
}

function lineLabel(file) {
  if (file.startLine && file.endLine) return ` · lines ${file.startLine}–${file.endLine}`;
  if (file.startLine) return ` · line ${file.startLine}`;
  return '';
}

function StoryFile({ file, onOpenSource }) {
  if (file.sourceAvailable === false) return <span className="story-file-unavailable" title="The current analysis did not retain parsed source for this file."><code>{file.filePath}</code>{lineLabel(file)} <small>source unavailable</small></span>;
  return <button className="story-file-link" type="button" onClick={() => onOpenSource({
    filePath: file.filePath, symbolName: file.symbolName, startLine: file.startLine, endLine: file.endLine
  })}>
    <code>{file.filePath}</code>{lineLabel(file)} <span aria-hidden="true">↗</span>
  </button>;
}

function StoryDiagram({ diagram, onOpenSource }) {
  const edges = diagram?.edges || [];
  if (!edges.length) return null;
  return <div className="story-diagram" aria-label="Files that use code from other files">
    <span className="story-diagram-label">HOW THESE FILES CONNECT</span>
    {edges.slice(0, 8).map((edge, index) => <div className="story-diagram-edge" key={`${edge.sourcePath}-${edge.targetPath}-${index}`}>
      <button type="button" onClick={() => onOpenSource({ filePath: edge.sourcePath })}>{edge.sourcePath}</button>
      <span className="story-edge-label">uses code from →</span>
      <button type="button" onClick={() => onOpenSource({ filePath: edge.targetPath })}>{edge.targetPath}</button>
    </div>)}
    <small>These links show where one file uses code from another. They do not show the order every action runs.</small>
  </div>;
}

export default function ReadingGuide({ repository, userId, onOpenSource, onAsk = noOp, onExploreFlow = noOp, onUnauthorized = noOp }) {
  const [guide, setGuide] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [expandedDetails, setExpandedDetails] = useState({});
  const articleRef = useRef(null);
  const saveTimer = useRef(null);
  const restoredStorageKey = useRef(null);
  const onboarding = guide?.onboarding || {};
  const chapters = useMemo(() => onboarding.chapters || [], [onboarding.chapters]);
  const coverage = guide?.metadata?.coverage || {};
  const storageKey = progressKey(userId, repository.id, guide?.metadata?.parsingJobId);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError('');
    api.repositoryReadingGuide(repository.id, { signal: controller.signal })
      .then((data) => { if (!cancelled) setGuide(data); })
      .catch((requestError) => {
        if (requestError.code === 'UNAUTHENTICATED') onUnauthorized();
        if (!cancelled && requestError.name !== 'AbortError') setError(requestError.message || 'The onboarding guide could not be loaded.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [repository.id, onUnauthorized]);

  const measureProgress = useCallback(() => {
    const article = articleRef.current;
    if (!article) return;
    const maxScroll = Math.max(1, article.scrollHeight - window.innerHeight);
    const current = Math.max(0, Math.min(maxScroll, window.scrollY - article.offsetTop));
    const value = Math.round(current / maxScroll * 100);
    setProgress(value);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try { window.localStorage.setItem(storageKey, JSON.stringify({ parsingJobId: guide?.metadata?.parsingJobId, scrollY: window.scrollY, progress: value })); }
      catch { /* Reading position is a convenience; the guide remains usable without storage. */ }
    }, 150);
  }, [guide?.metadata?.parsingJobId, storageKey]);

  useEffect(() => {
    if (!guide || restoredStorageKey.current === storageKey) return undefined;
    restoredStorageKey.current = storageKey;
    let saved = null;
    try { saved = JSON.parse(window.localStorage.getItem(storageKey) || 'null'); } catch { saved = null; }
    const frame = window.requestAnimationFrame(() => {
      if (saved?.parsingJobId === guide.metadata?.parsingJobId && Number.isFinite(saved.scrollY)) window.scrollTo(0, saved.scrollY);
      measureProgress();
    });
    window.addEventListener('scroll', measureProgress, { passive: true });
    window.addEventListener('resize', measureProgress);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', measureProgress);
      window.removeEventListener('resize', measureProgress);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [guide, measureProgress, storageKey]);

  function persistPosition() {
    try { window.localStorage.setItem(storageKey, JSON.stringify({ parsingJobId: guide?.metadata?.parsingJobId, scrollY: window.scrollY, progress })); }
    catch { /* The guide remains usable when storage is unavailable. */ }
  }

  function openSource(file) {
    persistPosition();
    onOpenSource({ filePath: file.filePath, symbolName: file.symbolName, startLine: file.startLine, endLine: file.endLine });
  }

  function askCodeCompass() { persistPosition(); onAsk(); }

  if (loading) return <div className="inline-state" role="status"><span className="loader"/>Preparing your onboarding guide…</div>;
  if (error) return <div className="explorer-state explorer-error" role="alert">{error}</div>;
  if (guide?.status !== 'ready') return <div className="explorer-state"><h3>Onboarding guide is not ready</h3><p>Current analysis status: {guide?.status || 'unavailable'}. Index and parse this repository first.</p></div>;
  if (!chapters.length) return <div className="explorer-state"><h3>No story could be generated yet</h3><p>The current analysis did not return enough structured evidence for a repository walkthrough.</p></div>;

  const description = repository.description && repository.description !== 'No description provided.'
    ? repository.description : 'We will build a picture of what this project does as we follow its code.';
  const toggleDetails = (chapterId) => setExpandedDetails((current) => ({ ...current, [chapterId]: !current[chapterId] }));

  return <article ref={articleRef} className="repository-story" aria-label="Understand This Codebase">
    <header className="story-header">
      <span className="section-number">REPOSITORY ONBOARDING</span>
      <h2>Understand This Codebase</h2>
      <h3>{repository.fullName || `${repository.owner}/${repository.name}`}</h3>
      <p>{description}</p>
      <p className="story-subtitle">Follow a guided walkthrough to understand how this application is structured and how its major components work together.</p>
      <div className="story-reading-progress"><div role="progressbar" aria-label="Reading progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}><span style={{ width: `${progress}%` }}/></div><small>{progress}% read · your position is saved in this browser</small></div>
    </header>

    {guide.metadata?.isComplete === false && <details className="reading-analysis-warning story-warning">
      <summary>We could examine {coverage.parsedFiles ?? 0} of {coverage.indexedFiles ?? 0} files</summary>
      <p>Some files were unavailable to this walkthrough, so it may miss parts of the application. Reading the linked source can help fill in the gaps.</p>
    </details>}

    <div className="story-chapters">
      {chapters.map((chapter, index) => <section className="story-chapter" id={`story-chapter-${chapter.id}`} key={chapter.id}>
        <span className="story-chapter-count">{String(index + 1).padStart(2, '0')}</span>
        <h3>{chapter.title}</h3>
        {chapter.paragraphs?.map((paragraph, paragraphIndex) => <p key={`${chapter.id}-paragraph-${paragraphIndex}`}>{paragraph}</p>)}
        {chapter.files?.length > 0 && <div className="story-references" aria-label={`Source references for ${chapter.title}`}>
          {chapter.files.slice(0, 10).map((file) => <span className="story-reference" key={`${file.filePath}-${file.startLine || ''}-${file.symbolName || ''}`}>
            <StoryFile file={file} onOpenSource={openSource}/>{file.role && <small title={file.why || file.role}>{file.role}</small>}
            {file.symbolName && <small>{file.symbolName}</small>}
          </span>)}
        </div>}
        <StoryDiagram diagram={chapter.diagram} onOpenSource={openSource}/>
        {chapter.details?.length > 0 && <details className="story-technical-details" open={Boolean(expandedDetails[chapter.id])} onToggle={(event) => {
          if (event.currentTarget.open !== Boolean(expandedDetails[chapter.id])) toggleDetails(chapter.id);
        }}><summary>Show technical details</summary><ul>{chapter.details.slice(0, 12).map((detail, detailIndex) => <li key={`${detail.label || detail.filePath}-${detailIndex}`}>
          {detail.filePath ? <><StoryFile file={detail} onOpenSource={openSource}/> — </> : <><strong>{detail.label}</strong> — </>}{detail.text || detail.signals?.join('; ') || detail.evidenceType}
        </li>)}</ul></details>}
        {chapter.relationships?.length > 0 && <details className="story-technical-details"><summary>Show how we know these files are connected</summary><ul>{chapter.relationships.slice(0, 12).map((edge, edgeIndex) => <li key={`${edge.sourcePath}-${edge.targetPath}-${edgeIndex}`}>
          <StoryFile file={{ filePath: edge.sourcePath }} onOpenSource={openSource}/> uses code from <StoryFile file={{ filePath: edge.targetPath }} onOpenSource={openSource}/>
        </li>)}</ul></details>}
        <nav className="story-chapter-nav" aria-label={`Chapter ${index + 1} navigation`}>
          {index > 0 && <button type="button" className="button button-outline" onClick={() => document.getElementById(`story-chapter-${chapters[index - 1].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>← Previous chapter</button>}
          {index < chapters.length - 1 && <button type="button" className="button button-outline" onClick={() => document.getElementById(`story-chapter-${chapters[index + 1].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Next chapter →</button>}
        </nav>
        {index < chapters.length - 1 && <hr/>}
      </section>)}
    </div>

    <section className="story-finish">
      <h3>You now have the basic mental model of this codebase.</h3>
      <p>Choose one of these files to see an important part of the application up close, or ask CodeCompass about something you want to understand better.</p>
      <div className="story-actions">
        <button className="button button-primary" type="button" onClick={askCodeCompass}>Ask CodeCompass a question ↗</button>
        <button className="button button-outline" type="button" onClick={() => { persistPosition(); onExploreFlow(); }}>Explore a connection in Code Graph ↗</button>
        {chapters.flatMap((chapter) => chapter.files || []).slice(0, 3).map((file) => <button className="button button-outline" type="button" key={`${file.filePath}-${file.startLine}`} onClick={() => openSource(file)}>Open {file.filePath} ↗</button>)}
      </div>
    </section>
  </article>;
}
