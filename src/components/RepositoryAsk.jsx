import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api.js';

function inlineContent(text, citations, onOpen) {
  const citationById = new Map(citations.map((citation) => [citation.id, citation]));
  const parts = text.split(/(\[\[?S\d+\]\]?|`[^`]+`)/g).filter(Boolean);
  return parts.map((part, index) => {
    const citationMatch = part.match(/^\[\[?(S\d+)\]\]?$/);
    if (citationMatch) {
      const citation = citationById.get(citationMatch[1]);
      return citation ? <button className="answer-citation-ref" key={index} onClick={() => onOpen(citation.id)} aria-label={`Open source ${citation.id}`}>[{citation.id}]</button> : <span key={index}>{part}</span>;
    }
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    return part;
  });
}

function renderAnswer(answer, citations, onOpen) {
  const lines = answer.split('\n');
  const blocks = [];
  let paragraph = [];
  let index = 0;
  const flushParagraph = () => {
    if (paragraph.length) blocks.push(<p key={`p-${index++}`}>{inlineContent(paragraph.join('\n'), citations, onOpen)}</p>);
    paragraph = [];
  };
  while (lines.length) {
    const line = lines.shift();
    if (line.startsWith('```')) {
      flushParagraph();
      const language = line.slice(3).trim();
      const code = [];
      while (lines.length && !lines[0].startsWith('```')) code.push(lines.shift());
      if (lines.length) lines.shift();
      blocks.push(<pre className="answer-code" key={`code-${index++}`}><code data-language={language || undefined}>{code.join('\n')}</code></pre>);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const Tag = `h${heading[1].length}`;
      blocks.push(<Tag key={`h-${index++}`}>{inlineContent(heading[2], citations, onOpen)}</Tag>);
      continue;
    }
    const listItem = line.match(/^\s*[-*]\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      blocks.push(<div className="answer-list-item" key={`li-${index++}`}>• {inlineContent(listItem[1], citations, onOpen)}</div>);
      continue;
    }
    if (!line.trim()) { flushParagraph(); continue; }
    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}

export default function RepositoryAsk({ repository, onUnauthorized = () => {}, onOpenCitation }) {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [expandedCitation, setExpandedCitation] = useState(null);
  const [citationError, setCitationError] = useState('');
  const controllerRef = useRef(null);
  const busyRef = useRef(false);
  const messagesRef = useRef(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages]);

  function updateMessage(id, update) {
    if (!mountedRef.current) return;
    setMessages((current) => current.map((message) => message.id === id ? update(message) : message));
  }

  async function submitQuestion(event) {
    event.preventDefault();
    await sendQuestion(question);
  }

  async function sendQuestion(value) {
    const cleanQuestion = value.trim();
    if (!cleanQuestion || busyRef.current) return;
    busyRef.current = true;
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setQuestion('');
    setMessages((current) => [...current, { id, question: cleanQuestion, answer: '', citations: [], status: 'waiting', insufficientEvidence: false, error: '' }]);
    try {
      const result = await api.askRepositoryQuestion(repository.id, cleanQuestion, {
        signal: controller.signal,
        onEvent(eventName, payload) {
          if (eventName === 'token' && typeof payload.text === 'string') updateMessage(id, (message) => ({ ...message, answer: message.answer + payload.text, status: 'streaming' }));
          if (eventName === 'answer' && typeof payload.answer === 'string') updateMessage(id, (message) => ({ ...message, answer: payload.answer, status: 'streaming' }));
          if (eventName === 'citations' && Array.isArray(payload.citations)) updateMessage(id, (message) => ({ ...message, citations: payload.citations }));
          if (eventName === 'complete') updateMessage(id, (message) => ({ ...message, status: 'completed', insufficientEvidence: Boolean(payload.insufficientEvidence) }));
        },
      });
      updateMessage(id, (message) => ({ ...message, answer: result.answer, citations: result.citations, insufficientEvidence: result.insufficientEvidence, status: 'completed' }));
    } catch (error) {
      if (error.code === 'UNAUTHENTICATED') onUnauthorized();
      if (error.name !== 'AbortError') updateMessage(id, (message) => ({ ...message, answer: '', citations: [], status: 'error', error: error.message }));
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }

  return <section className="repository-ask" aria-label={`Ask questions about ${repository.fullName || 'this repository'}`}>
    <div className="ask-heading">
      <div><span className="section-number">CODEBASE Q&amp;A</span><h3>Ask about {repository.fullName || 'this repository'}</h3></div>
      <span className="ask-context">Answers use retrieved repository code</span>
    </div>
    {repository.description && <p className="ask-repository-context">{repository.description}</p>}
    <p className="ask-privacy-note">Your question and retrieved code snippets are sent to Google's hosted Gemini API. Avoid confidential, proprietary, or credential-containing repositories.</p>
    <div className="ask-messages" ref={messagesRef} aria-live="polite">
      {messages.length === 0 && <p className="ask-empty">Ask a question about how this codebase works. Each question retrieves fresh code evidence.</p>}
      {messages.map((message) => <article className="ask-message" key={message.id}>
        <div className="ask-question"><span>You</span><p>{message.question}</p></div>
        <div className={`ask-answer ${message.insufficientEvidence ? 'ask-answer-insufficient' : ''}`}>
          <div className="ask-answer-label">{message.insufficientEvidence ? 'Evidence was insufficient' : 'CodeCompass'}{message.status === 'waiting' && <span className="ask-waiting" role="status"><span className="loader"/>Retrieving evidence and preparing an answer…</span>}{message.status === 'streaming' && <span className="ask-streaming" role="status">Answering…</span>}{message.status === 'error' && message.answer && <span className="ask-streaming">Answer interrupted</span>}</div>
          {message.insufficientEvidence && <p className="ask-insufficient-note">The available code evidence did not support a confident answer.</p>}
          {message.answer && !message.insufficientEvidence && <div className="ask-answer-content">{renderAnswer(message.answer, message.citations, (citationId) => { const citation = message.citations.find((item) => item.id === citationId); if (citation && onOpenCitation && citation.filePath) { setCitationError(''); onOpenCitation(citation); } else if (citation && onOpenCitation) setCitationError(`Source location for ${citation.id} is unavailable.`); else setExpandedCitation(`${message.id}:${citationId}`); })}</div>}
          {citationError && <p className="ask-error" role="alert">{citationError}</p>}
          {message.status === 'error' && <p className="ask-error" role="alert">{message.error} <button type="button" className="ask-retry" disabled={busy} onClick={() => sendQuestion(message.question)}>Retry this question</button></p>}
          {message.status === 'completed' && message.citations.length > 0 && <div className="ask-sources">
            <h4>Sources</h4>
            {message.citations.map((citation) => <div className="ask-source" key={citation.chunkId || citation.id}>
              <button className="ask-source-toggle" onClick={() => setExpandedCitation((current) => current === `${message.id}:${citation.id}` ? null : `${message.id}:${citation.id}`)} aria-expanded={expandedCitation === `${message.id}:${citation.id}`}>
                <span className="ask-source-id">{citation.id}</span><span className="ask-source-path">{citation.filePath || 'Path unavailable'}</span><span className="ask-source-lines">{Number.isFinite(citation.startLine) && Number.isFinite(citation.endLine) ? `Lines ${citation.startLine}–${citation.endLine}` : 'Line range unavailable'}</span>
              </button>
              {expandedCitation === `${message.id}:${citation.id}` && <div className="ask-source-detail">
                <div>{citation.symbolName && <span>Symbol: {citation.symbolName}</span>}{citation.language && <span>Language: {citation.language}</span>}{citation.structureType && <span>Structure: {citation.structureType}</span>}</div>
                {citation.explanation && <p>{citation.explanation}</p>}
                {citation.filePath && onOpenCitation && <button type="button" className="ask-open-source" onClick={() => { setCitationError(''); onOpenCitation(citation); }}>Open in Code Viewer ↗</button>}
                {typeof citation.sourceCode === 'string' && <pre className="ask-source-code"><code>{citation.sourceCode.split('\n').map((line, lineIndex) => <span className="ask-source-line" key={lineIndex}><b>{Number.isFinite(citation.startLine) ? citation.startLine + lineIndex : ''}</b>{line || ' '}</span>)}</code></pre>}
              </div>}
            </div>)}
          </div>}
        </div>
      </article>)}
    </div>
    <form className="ask-form" onSubmit={submitQuestion}>
      <label className="visually-hidden" htmlFor={`ask-question-${repository.id}`}>Ask a question about {repository.fullName || 'this repository'}</label>
      <textarea id={`ask-question-${repository.id}`} value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Where is user authentication handled?" maxLength={2000} rows={2} disabled={busy} />
      <div className="ask-form-footer"><span>Enter to send · Shift+Enter for a new line</span><button className="button button-primary" type="submit" disabled={busy || !question.trim()}>{busy ? 'Answering…' : 'Ask repository'} <span aria-hidden="true">↗</span></button></div>
    </form>
  </section>;
}
