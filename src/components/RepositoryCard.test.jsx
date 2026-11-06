import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import RepositoryCard from './RepositoryCard.jsx';
import { api } from '../services/api.js';

vi.mock('../services/api.js', () => ({ api: {
  startRepositoryIndexing: vi.fn(),
  indexingJobStatus: vi.fn(),
  startRepositoryParsing: vi.fn(),
  parsingJobStatus: vi.fn(),
  startRepositoryEmbeddings: vi.fn(),
  embeddingJobStatus: vi.fn(),
  searchRepository: vi.fn(),
  askRepositoryQuestion: vi.fn(),
} }));

const repository = { id: 'repository-id', fullName: 'octo/project', htmlUrl: 'https://github.com/octo/project' };
const activeJob = { id: 'job-1', repositoryId: repository.id, status: 'queued', stage: 'queued', progress: 0, message: 'Waiting for a worker' };

afterEach(() => { cleanup(); vi.resetAllMocks(); vi.useRealTimers(); });
beforeEach(() => { vi.useFakeTimers(); window.localStorage.clear(); });

const indexedRepository = {
  ...repository,
  indexing: {
    latestJob: { id: 'index-1', repositoryId: repository.id, status: 'completed', stage: 'completed', progress: 100 },
    lastSuccessfulIndex: { eligibleFileCount: 12, indexedAt: '2026-11-05T09:00:00.000Z' },
  },
};

const parsingJob = {
  id: 'parse-1', repositoryId: repository.id, status: 'queued', stage: 'queued', progress: 0,
  totalFiles: 0, processedFiles: 0, parsedFiles: 0, skippedFiles: 0, failedFiles: 0,
  totalChunks: 0, errorMessage: null, startedAt: null, completedAt: null,
};
const completedParsingJob = { ...parsingJob, status: 'completed', stage: 'completed', progress: 100, totalChunks: 3, completedAt: '2026-11-06T10:00:00.000Z' };
const embeddingJob = { id: 'embed-1', repositoryId: repository.id, parsingJobId: completedParsingJob.id, status: 'queued', stage: 'queued', progress: 0, totalChunks: 3, processedChunks: 0, embeddedChunks: 0, skippedChunks: 0, failedChunks: 0 };

describe('RepositoryCard indexing controls', () => {
  it('keeps codebase questions unavailable until backend embeddings are confirmed for the current parse', () => {
    render(<RepositoryCard repository={indexedRepository}/>);
    expect(screen.queryByRole('button', { name: /ask about this repository/i })).not.toBeInTheDocument();
    expect(screen.getByText(/complete ast parsing before asking questions/i)).toBeInTheDocument();
  });

  it('shows repository Q&A only after saved parsing and embedding jobs confirm readiness', async () => {
    window.localStorage.setItem('codecompass-parsing-jobs', JSON.stringify({ [repository.id]: completedParsingJob }));
    window.localStorage.setItem('codecompass-embedding-jobs', JSON.stringify({ [repository.id]: { id: 'embed-ready', repositoryId: repository.id, parsingJobId: completedParsingJob.id, status: 'completed', embeddedChunks: 3 } }));
    render(<RepositoryCard repository={indexedRepository}/>);
    fireEvent.click(screen.getByRole('button', { name: /ask about this repository/i }));
    expect(screen.getByRole('heading', { name: /ask about octo\/project/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /ask a question about octo\/project/i })).toBeEnabled();
  });

  it('keeps Q&A disabled when re-indexing is newer than the saved parse and embeddings', () => {
    window.localStorage.setItem('codecompass-parsing-jobs', JSON.stringify({ [repository.id]: completedParsingJob }));
    window.localStorage.setItem('codecompass-embedding-jobs', JSON.stringify({ [repository.id]: { id: 'embed-ready', repositoryId: repository.id, parsingJobId: completedParsingJob.id, status: 'completed', embeddedChunks: 3 } }));
    const newerIndex = { ...indexedRepository, indexing: { ...indexedRepository.indexing, latestJob: { ...indexedRepository.indexing.latestJob, completedAt: '2026-11-07T10:00:00.000Z' } } };
    render(<RepositoryCard repository={newerIndex}/>);
    expect(screen.queryByRole('button', { name: /ask about this repository/i })).not.toBeInTheDocument();
    expect(screen.getByText(/re-parse the latest indexed snapshot/i)).toBeInTheDocument();
  });

  it('shows the index action and starts indexing with the repository ID', async () => {
    api.startRepositoryIndexing.mockResolvedValue({ success: true, alreadyRunning: false, job: activeJob });
    render(<RepositoryCard repository={repository}/>);
    expect(screen.getByRole('button', { name: /index repository/i })).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /index repository/i })); });
    expect(api.startRepositoryIndexing).toHaveBeenCalledWith('repository-id');
    expect(screen.getByText('Waiting to start')).toBeInTheDocument();
    expect(screen.getByText('Waiting for a worker')).toBeInTheDocument();
  });

  it('polls active jobs and stops after backend completion', async () => {
    render(<RepositoryCard repository={{ ...repository, indexing: { latestJob: activeJob } }}/>);
    api.indexingJobStatus.mockResolvedValue({ job: { ...activeJob, status: 'completed', stage: 'completed', progress: 100, eligibleFileCount: 14 } });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByText('Indexing complete')).toBeInTheDocument();
    expect(screen.getByText('14 eligible files indexed.')).toBeInTheDocument();
    expect(api.indexingJobStatus).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(api.indexingJobStatus).toHaveBeenCalledTimes(1);
  });

  it('keeps an active state after a temporary poll error and offers retry after failure', async () => {
    render(<RepositoryCard repository={{ ...repository, indexing: { latestJob: activeJob } }}/>);
    api.indexingJobStatus.mockRejectedValueOnce(new Error('Temporary connection problem')).mockResolvedValueOnce({ job: { ...activeJob, status: 'failed', stage: 'failed', error: { code: 'INDEXING_FAILED', message: 'Repository could not be cloned.' } } });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByText('Waiting to start')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Temporary connection problem');
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByText('Indexing failed')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Repository could not be cloned.');
    expect(api.indexingJobStatus).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(api.indexingJobStatus).toHaveBeenCalledTimes(2);
    api.startRepositoryIndexing.mockResolvedValue({ success: true, alreadyRunning: false, job: { ...activeJob, id: 'job-2' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /retry indexing/i })); });
    expect(api.startRepositoryIndexing).toHaveBeenCalledWith('repository-id');
    expect(screen.getByText('Waiting to start')).toBeInTheDocument();
  });

  it('clears the polling timer when the card unmounts', async () => {
    const { unmount } = render(<RepositoryCard repository={{ ...repository, indexing: { latestJob: activeJob } }}/>);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts parsing with the repository ID and follows the returned contract job', async () => {
    api.startRepositoryParsing.mockResolvedValue({ success: true, alreadyRunning: true, job: parsingJob });
    render(<RepositoryCard repository={indexedRepository}/>);
    await act(async () => {
      const button = screen.getByRole('button', { name: /parse repository/i });
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(api.startRepositoryParsing).toHaveBeenCalledWith(repository.id);
    expect(api.startRepositoryParsing).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Waiting to start')).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem('codecompass-parsing-jobs'))[repository.id]).toEqual(parsingJob);
  });

  it('offers re-parsing after a newer completed index and keeps it unavailable until then', async () => {
    const completedParse = { ...parsingJob, status: 'completed', stage: 'completed', progress: 100, completedAt: '2026-11-05T10:00:00.000Z' };
    window.localStorage.setItem('codecompass-parsing-jobs', JSON.stringify({ [repository.id]: completedParse }));
    api.startRepositoryParsing.mockResolvedValue({ success: true, alreadyRunning: false, job: parsingJob });
    const original = { ...indexedRepository, indexing: {
      ...indexedRepository.indexing,
      latestJob: { ...indexedRepository.indexing.latestJob, completedAt: '2026-11-05T09:00:00.000Z' }
    } };
    const { rerender } = render(<RepositoryCard repository={original}/>);
    const reparse = screen.getByRole('button', { name: /re-parse repository/i });
    expect(reparse).toBeDisabled();
    expect(screen.getByText(/re-index this repository to create a fresh source snapshot/i)).toBeInTheDocument();

    rerender(<RepositoryCard repository={{ ...original, indexing: {
      ...original.indexing,
      latestJob: { ...original.indexing.latestJob, id: 'index-2', completedAt: '2026-11-06T10:00:00.000Z' }
    }}}/>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('button', { name: /re-parse repository/i })).toBeEnabled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /re-parse repository/i })); });
    expect(api.startRepositoryParsing).toHaveBeenCalledWith(repository.id);
  });

  it.each([
    ['completed', { status: 'completed', stage: 'completed', progress: 100, totalFiles: 4, processedFiles: 4, parsedFiles: 4, skippedFiles: 0, failedFiles: 0, totalChunks: 9 }],
    ['completed_with_errors', { status: 'completed_with_errors', stage: 'completed', progress: 100, totalFiles: 4, processedFiles: 4, parsedFiles: 2, skippedFiles: 1, failedFiles: 1, totalChunks: 5 }],
    ['failed', { status: 'failed', stage: 'failed', errorMessage: 'Parsing could not be completed.' }],
  ])('stops polling after the %s terminal status', async (_status, fields) => {
    window.localStorage.setItem('codecompass-parsing-jobs', JSON.stringify({ [repository.id]: parsingJob }));
    api.parsingJobStatus.mockResolvedValue({ job: { ...parsingJob, ...fields } });
    render(<RepositoryCard repository={indexedRepository}/>);
    await act(async () => { await Promise.resolve(); });
    expect(api.parsingJobStatus).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(api.parsingJobStatus).toHaveBeenCalledTimes(1);
    if (_status === 'completed_with_errors') expect(screen.getByText(/some files were skipped or could not be processed/i)).toBeInTheDocument();
    if (_status === 'failed') expect(screen.getByRole('alert')).toHaveTextContent('Parsing could not be completed.');
  });

  it('restores an active parsing job after remount and keeps it active through a temporary network error', async () => {
    window.localStorage.setItem('codecompass-parsing-jobs', JSON.stringify({ [repository.id]: parsingJob }));
    api.parsingJobStatus.mockRejectedValueOnce(new Error('Temporary connection problem'))
      .mockResolvedValue({ job: { ...parsingJob, status: 'processing', stage: 'parsing', progress: 30, totalFiles: 10, processedFiles: 3 } });
    const first = render(<RepositoryCard repository={indexedRepository}/>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('Waiting to start')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Temporary connection problem');
    first.unmount();
    render(<RepositoryCard repository={indexedRepository}/>);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(api.parsingJobStatus).toHaveBeenCalledTimes(3);
    expect(screen.getByText('Parsing source files')).toBeInTheDocument();
    expect(screen.getByText(/3 \/ 10 files processed/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('retries failed parsing and blocks retries when the retained source is unavailable', async () => {
    window.localStorage.setItem('codecompass-parsing-jobs', JSON.stringify({ [repository.id]: { ...parsingJob, status: 'failed', stage: 'failed', errorMessage: 'Worker retries were exhausted.' } }));
    api.startRepositoryParsing.mockResolvedValueOnce({ success: true, alreadyRunning: false, job: { ...parsingJob, id: 'parse-2' } });
    api.parsingJobStatus.mockResolvedValue({ job: { ...parsingJob, id: 'parse-2' } });
    render(<RepositoryCard repository={indexedRepository}/>);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /retry parsing/i })); });
    expect(api.startRepositoryParsing).toHaveBeenCalledWith(repository.id);
    expect(screen.getByText('Waiting to start')).toBeInTheDocument();

    api.parsingJobStatus.mockResolvedValue({ job: { ...parsingJob, id: 'parse-2', status: 'failed', stage: 'failed', errorMessage: 'Worker retries were exhausted.' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByRole('button', { name: /retry parsing/i })).toBeInTheDocument();
    const unavailable = Object.assign(new Error('Repository indexing must be complete and its retained clone available before parsing.'), { code: 'PARSING_SOURCE_UNAVAILABLE' });
    api.startRepositoryParsing.mockRejectedValueOnce(unavailable);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /retry parsing/i })); });
    expect(screen.getAllByRole('alert').some((alert) => alert.textContent.includes('retained clone available'))).toBe(true);
    expect(screen.getByText(/Re-index this repository/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /parse repository/i })).not.toBeInTheDocument();

    api.startRepositoryIndexing.mockResolvedValue({ job: { id: 'index-2', repositoryId: repository.id, status: 'queued', stage: 'queued' } });
    api.indexingJobStatus.mockResolvedValue({ job: { id: 'index-2', repositoryId: repository.id, status: 'completed', stage: 'completed', progress: 100 } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /re-index repository/i })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByRole('button', { name: /retry parsing/i })).toBeInTheDocument();
  });

  it('keeps embedding generation unavailable until parsing has completed', () => {
    render(<RepositoryCard repository={indexedRepository}/>);
    expect(screen.getByText('Complete AST parsing before generating embeddings.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /generate embeddings/i })).not.toBeInTheDocument();
  });

  it('starts embeddings for the parsed snapshot, restores the job ID, polls, and stops at completion', async () => {
    window.localStorage.setItem('codecompass-parsing-jobs', JSON.stringify({ [repository.id]: completedParsingJob }));
    api.startRepositoryEmbeddings.mockResolvedValue({ success: true, alreadyRunning: false, job: embeddingJob });
    api.embeddingJobStatus.mockResolvedValueOnce({ job: embeddingJob }).mockResolvedValue({ job: { ...embeddingJob, status: 'completed', stage: 'completed', progress: 100, processedChunks: 3, embeddedChunks: 3, completedAt: '2026-11-06T10:01:00.000Z' } });
    render(<RepositoryCard repository={indexedRepository}/>);
    const button = screen.getByRole('button', { name: /generate embeddings/i });
    await act(async () => { fireEvent.click(button); fireEvent.click(button); });
    expect(api.startRepositoryEmbeddings).toHaveBeenCalledTimes(1);
    expect(api.startRepositoryEmbeddings).toHaveBeenCalledWith(repository.id);
    expect(JSON.parse(window.localStorage.getItem('codecompass-embedding-jobs'))[repository.id].id).toBe('embed-1');
    await act(async () => { await Promise.resolve(); });
    expect(api.embeddingJobStatus).toHaveBeenCalledWith('embed-1');
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByText('Embeddings generated')).toBeInTheDocument();
    expect(screen.getByText(/3 \/ 3 chunks processed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /search repository/i })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(api.embeddingJobStatus).toHaveBeenCalledTimes(2);
  });

  it('restores active embedding jobs after refresh and keeps them active through temporary network failures', async () => {
    window.localStorage.setItem('codecompass-parsing-jobs', JSON.stringify({ [repository.id]: completedParsingJob }));
    window.localStorage.setItem('codecompass-embedding-jobs', JSON.stringify({ [repository.id]: embeddingJob }));
    api.embeddingJobStatus.mockRejectedValueOnce(new Error('Temporary connection problem')).mockResolvedValue({ job: { ...embeddingJob, status: 'processing', stage: 'generating_embeddings', progress: 35, processedChunks: 1 } });
    render(<RepositoryCard repository={indexedRepository}/>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('Waiting to start')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Temporary connection problem');
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByText('Generating embeddings')).toBeInTheDocument();
    expect(screen.getByText(/1 \/ 3 chunks processed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /search repository/i })).not.toBeInTheDocument();
  });

  it('searches only after the current parse has embeddings and displays returned retrieval details', async () => {
    window.localStorage.setItem('codecompass-parsing-jobs', JSON.stringify({ [repository.id]: completedParsingJob }));
    window.localStorage.setItem('codecompass-embedding-jobs', JSON.stringify({ [repository.id]: { ...embeddingJob, status: 'completed', stage: 'completed', progress: 100, embeddedChunks: 3 } }));
    api.searchRepository.mockResolvedValue({ results: [{ chunkId: 'chunk-1', filePath: 'src/auth.js', language: 'javascript', structureType: 'function', symbolName: 'authenticateUser', startLine: 10, endLine: 12, sourceCode: 'function authenticateUser() {\n  return true;\n}', retrieval: { vectorRank: 1, keywordRank: 2, rrfScore: 0.0325, matchedBy: ['vector', 'keyword'] } }] });
    render(<RepositoryCard repository={indexedRepository}/>);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /search repository/i })); });
    fireEvent.change(screen.getByRole('textbox', { name: /search code/i }), { target: { value: 'Where is authentication?' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^search/i })); });
    expect(api.searchRepository).toHaveBeenCalledWith(repository.id, 'Where is authentication?', 10);
    expect(screen.getByText('authenticateUser')).toBeInTheDocument();
    expect(screen.getByText('src/auth.js')).toBeInTheDocument();
    expect(screen.getByText('Vector + Keyword')).toBeInTheDocument();
    expect(screen.getByText('RRF score: 0.03250')).toBeInTheDocument();
  });

  it('displays empty search results and does not submit an empty query', async () => {
    window.localStorage.setItem('codecompass-parsing-jobs', JSON.stringify({ [repository.id]: completedParsingJob }));
    window.localStorage.setItem('codecompass-embedding-jobs', JSON.stringify({ [repository.id]: { ...embeddingJob, status: 'completed', stage: 'completed', progress: 100, embeddedChunks: 3 } }));
    api.searchRepository.mockResolvedValue({ results: [] });
    render(<RepositoryCard repository={indexedRepository}/>);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /search repository/i })); });
    expect(screen.getByRole('button', { name: /^search/i })).toBeDisabled();
    expect(api.searchRepository).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: /search code/i }), { target: { value: 'calculateTotal' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^search/i })); });
    expect(screen.getByText('No matching code chunks found.')).toBeInTheDocument();
  });
});
