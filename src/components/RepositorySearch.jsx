import { useRef, useState } from 'react';
import { api } from '../services/api.js';

function retrievalLabel(matchedBy) {
  const methods = Array.isArray(matchedBy) ? matchedBy : [];
  if (methods.includes('vector') && methods.includes('keyword')) return 'Vector + Keyword';
  if (methods.includes('vector')) return 'Vector';
  if (methods.includes('keyword')) return 'Keyword';
  return '';
}

function SearchResult({ result, index }) {
  const details = result.retrieval || {};
  return <article className="search-result">
    <div className="search-result-heading">
      <div>
        <h4>{result.symbolName || result.filePath || `Code chunk ${index + 1}`}</h4>
        {result.filePath && <p className="search-file-path">{result.filePath}</p>}
        <p className="search-result-meta">{[result.language, result.structureType, Number.isFinite(result.startLine) && Number.isFinite(result.endLine) ? `Lines ${result.startLine}–${result.endLine}` : null].filter(Boolean).join(' · ')}</p>
      </div>
      {retrievalLabel(details.matchedBy) && <span className="match-badge">{retrievalLabel(details.matchedBy)}</span>}
    </div>
    {result.sourceCode && <pre className="search-code"><code>{result.sourceCode}</code></pre>}
    {(details.vectorRank != null || details.keywordRank != null || details.rrfScore != null) && <details className="retrieval-details">
      <summary>Retrieval details</summary>
      <div className="retrieval-values">
        {details.vectorRank != null && <span>Vector rank: {details.vectorRank}</span>}
        {details.keywordRank != null && <span>Keyword rank: {details.keywordRank}</span>}
        {details.rrfScore != null && <span>RRF score: {Number(details.rrfScore).toFixed(5)}</span>}
      </div>
    </details>}
  </article>;
}

export default function RepositorySearch({ repository, onUnauthorized = () => {} }) {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const searchInProgress = useRef(false);

  async function submitSearch(event) {
    event.preventDefault();
    const cleanQuery = query.trim();
    if (!cleanQuery || searchInProgress.current) return;
    searchInProgress.current = true;
    setSearching(true);
    setError('');
    setResults([]);
    setSubmittedQuery(cleanQuery);
    setHasSearched(true);
    try {
      const response = await api.searchRepository(repository.id, cleanQuery, 10);
      setResults(Array.isArray(response.results) ? response.results : []);
    } catch (requestError) {
      if (requestError.code === 'UNAUTHENTICATED') onUnauthorized();
      if (requestError.code === 'EMBEDDINGS_NOT_READY') setError('Embeddings are not ready for this repository yet. Generate embeddings from the repository card, then try again.');
      else if (requestError.code === 'PARSING_REQUIRED') setError('Parse the repository before searching its code.');
      else setError(requestError.message || 'Search could not be completed. Please try again.');
    } finally { searchInProgress.current = false; setSearching(false); }
  }

  return <section className="repository-search" aria-label={`Search ${repository.fullName || repository.name}`}>
    <div className="search-title-row"><div><span className="section-number">CODE SEARCH</span><h3>Find a place in the code.</h3></div><span className="search-repository-name">{repository.fullName || repository.name}</span></div>
    <form className="repository-search-form" onSubmit={submitSearch}>
      <label className="visually-hidden" htmlFor={`repository-search-${repository.id}`}>Search code in {repository.fullName || repository.name}</label>
      <input id={`repository-search-${repository.id}`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ask a question or search an identifier…" maxLength={1000} disabled={searching}/>
      <button className="button button-index" type="submit" disabled={searching || !query.trim()}>{searching ? 'Searching…' : 'Search'} <span aria-hidden="true">↗</span></button>
    </form>
    {searching && <div className="search-loading" role="status"><span className="loader"/>Searching repository code…</div>}
    {error && <p className="indexing-error" role="alert">{error}</p>}
    {hasSearched && !searching && !error && results.length === 0 && <div className="search-empty"><h4>No matching code chunks found.</h4><p>Try a different query or search using a function or class name.</p></div>}
    {results.length > 0 && !searching && <div className="search-results">
      <p className="search-summary">{results.length} {results.length === 1 ? 'result' : 'results'} for <strong>{submittedQuery}</strong></p>
      {results.map((result, index) => <SearchResult key={result.chunkId || `${result.filePath}-${result.startLine}-${index}`} result={result} index={index}/>) }
    </div>}
  </section>;
}
