import { useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { api } from '../services/api.js';

const languageNames = { javascript: 'javascript', typescript: 'typescript', python: 'python' };
const noOp = () => {};

function sourceText(chunks) {
  const lines = [];
  for (const chunk of chunks) {
    const contentLines = String(chunk.source || '').split('\n');
    contentLines.forEach((line, index) => {
      const lineNumber = chunk.startLine + index;
      if (lineNumber > 0 && lineNumber <= 100000 && lines[lineNumber - 1] === undefined) lines[lineNumber - 1] = line;
    });
  }
  return lines.join('\n');
}

function validLine(value) { return Number.isInteger(value) && value > 0 && value <= 100000; }

export default function CodeViewer({ repository, target, onUnauthorized = noOp }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editorReady, setEditorReady] = useState(false);
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const decorationRef = useRef([]);
  const activeTarget = target || null;

  useEffect(() => {
    if (!activeTarget?.filePath) { setResult(null); setError(''); return undefined; }
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError('');
    api.repositorySource(repository.id, { ...activeTarget, signal: controller.signal }).then((data) => {
      if (!cancelled) setResult(data);
    }).catch((requestError) => {
      if (requestError.code === 'UNAUTHENTICATED') onUnauthorized();
      if (!cancelled && requestError.name !== 'AbortError') { setResult(null); setError(requestError.message || 'Source could not be loaded.'); }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [repository.id, activeTarget?.filePath, activeTarget?.chunkId, activeTarget?.startLine, activeTarget?.endLine, activeTarget?.symbolName, onUnauthorized]);

  const chunks = result?.chunks || [];
  const value = useMemo(() => sourceText(chunks), [chunks]);
  const language = languageNames[chunks[0]?.language] || 'plaintext';
  const startLine = validLine(activeTarget?.startLine) ? activeTarget.startLine : null;
  const endLine = validLine(activeTarget?.endLine) && (!startLine || activeTarget.endLine >= startLine) ? activeTarget.endLine : startLine;

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    if (!startLine || !value) { decorationRef.current = editor.deltaDecorations(decorationRef.current, []); return; }
    const lastLine = editor.getModel()?.getLineCount() || 0;
    if (startLine > lastLine) { decorationRef.current = editor.deltaDecorations(decorationRef.current, []); return; }
    const safeEnd = Math.min(endLine || startLine, lastLine);
    const range = new monaco.Range(startLine, 1, safeEnd, editor.getModel().getLineMaxColumn(safeEnd));
    decorationRef.current = editor.deltaDecorations(decorationRef.current, [{
      range, options: { isWholeLine: true, className: 'code-viewer-highlight', glyphMarginClassName: 'code-viewer-glyph' }
    }]);
    editor.revealRangeInCenter(range);
    editor.setSelection(range);
  }, [value, startLine, endLine, editorReady]);

  return <section className="code-viewer" aria-label="Code Viewer">
    <div className="explorer-panel-heading"><div><span className="section-number">CODE VIEWER</span><h2>{activeTarget?.filePath?.split('/').at(-1) || 'Select source'}</h2></div>
      {activeTarget?.filePath && <span className="viewer-path">{activeTarget.filePath}</span>}
    </div>
    {activeTarget && <p className="viewer-location">{activeTarget.symbolName && <span>{activeTarget.symbolName} · </span>}{startLine ? `Lines ${startLine}${endLine && endLine !== startLine ? `–${endLine}` : ''}` : 'Source location unavailable'}</p>}
    {loading ? <div className="inline-state" role="status"><span className="loader"/>Loading parsed source…</div>
      : error ? <div className="explorer-state explorer-error" role="alert">{error}</div>
        : !activeTarget?.filePath ? <div className="explorer-state">Choose a citation, graph node, or reading recommendation to open parsed source here.</div>
          : chunks.length === 0 || !value ? <div className="explorer-state">No parsed source content is available for this location.</div>
            : <><div className="viewer-scope-note">Showing retained AST chunks. Lines outside parsed chunks may be blank; this is not the complete repository file.</div>
              <div className="monaco-wrap"><Editor height="min(70vh, 780px)" language={language} value={value} theme="vs" onMount={(editor, monaco) => { editorRef.current = editor; monacoRef.current = monaco; setEditorReady(true); }} options={{ readOnly: true, domReadOnly: true, minimap: { enabled: false }, lineNumbers: 'on', scrollBeyondLastLine: false, automaticLayout: true, fontSize: 13, wordWrap: 'off', glyphMargin: true, renderLineHighlight: 'line' }}/></div></>}
  </section>;
}
