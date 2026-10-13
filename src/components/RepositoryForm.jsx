import { useState } from 'react';
const githubRepoPattern = /^https:\/\/github\.com\/[^/]+\/[^/]+(?:\.git)?\/?$/i;
export default function RepositoryForm({ onImport, disabled = false }) {
  const [url, setUrl] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [success, setSuccess] = useState('');
  async function submit(event) {
    event.preventDefault(); setError(''); setSuccess('');
    if (!url.trim()) { setError('Paste a GitHub repository URL to continue.'); return; }
    if (!githubRepoPattern.test(url.trim())) { setError('Use a repository URL like https://github.com/owner/repository.'); return; }
    setBusy(true);
    try { const result = await onImport(url.trim()); setSuccess(result.alreadyImported ? 'This repository was already in your collection.' : 'Repository added to your collection.'); setUrl(''); }
    catch (err) { setError(err?.message || 'The repository could not be imported.'); }
    finally { setBusy(false); }
  }
  return <form className="import-form" onSubmit={submit} noValidate>
    <label htmlFor="repository-url">GitHub repository URL</label>
    <div className="form-row"><input id="repository-url" type="url" autoComplete="url" placeholder="https://github.com/owner/repository" value={url} onChange={e => {setUrl(e.target.value); setError(''); setSuccess('');}} aria-invalid={Boolean(error)} aria-describedby={error ? 'import-error' : success ? 'import-success' : 'url-hint'} disabled={disabled || busy}/><button className="button button-primary" type="submit" disabled={disabled || busy}>{busy ? 'Adding…' : 'Add repository'} <span aria-hidden="true">↗</span></button></div>
    <div className="form-foot"><span id="url-hint">Public repositories only. Metadata is saved to your account.</span>{error && <span id="import-error" className="form-error" role="alert">{error}</span>}{success && <span id="import-success" className="form-success" role="status">{success}</span>}</div>
  </form>;
}
