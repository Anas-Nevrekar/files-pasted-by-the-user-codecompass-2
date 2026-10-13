function dateLabel(value) { if (!value) return null; const date = new Date(value); return Number.isNaN(date.valueOf()) ? null : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date); }
export default function RepositoryCard({ repository }) {
  const imported = dateLabel(repository.importedAt);
  return <article className="repo-card">
    <div className="repo-card-main"><div className="repo-kicker">PUBLIC REPOSITORY</div><h3>{repository.fullName || `${repository.owner}/${repository.name}`}</h3>
      <p className="repo-description">{repository.description || 'No description provided.'}</p>
      <div className="repo-meta"><span>{repository.language || 'Language not specified'}</span>{repository.defaultBranch && <span>⌥ {repository.defaultBranch}</span>}{Number.isFinite(repository.starsCount) && <span>☆ {repository.starsCount.toLocaleString()}</span>}{imported && <span>Added {imported}</span>}</div>
    </div><a className="repo-link" href={repository.htmlUrl || `https://github.com/${repository.fullName}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${repository.fullName} on GitHub`}>View on GitHub <span aria-hidden="true">↗</span></a>
  </article>;
}
