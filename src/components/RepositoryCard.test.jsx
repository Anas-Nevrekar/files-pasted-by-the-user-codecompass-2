import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import RepositoryCard from './RepositoryCard.jsx';
import { api } from '../services/api.js';

vi.mock('../services/api.js', () => ({ api: {
  repositoryProcessingStatus: vi.fn(),
  startRepositoryIndexing: vi.fn(),
  startRepositoryParsing: vi.fn(),
  startRepositoryEmbeddings: vi.fn(),
  searchRepository: vi.fn(),
  askRepositoryQuestion: vi.fn(),
  deleteRepository: vi.fn(),
} }));

const repository = { id: 'r1', fullName: 'octo/project', htmlUrl: 'https://github.com/octo/project', language: 'JavaScript' };
const parsingState = { status: 'processing', currentStage: 'parsing', stages: {
  indexing: { status: 'completed', progress: 100, completed: true, discoveredFiles: 12, eligibleFiles: 9 },
  parsing: { status: 'processing', progress: 44, processedFiles: 4, totalFiles: 9, chunks: 8 },
  embeddings: null,
} };
const readyState = { status: 'ready', currentStage: 'ready', stages: {
  indexing: { status: 'completed', completed: true, progress: 100 },
  parsing: { status: 'completed', completed: true, progress: 100, totalFiles: 9, processedFiles: 9, chunks: 8 },
  embeddings: { status: 'completed', completed: true, progress: 100, embeddedChunks: 8, processedChunks: 8, totalChunks: 8 },
} };

afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('RepositoryCard automatic processing', () => {
  it('shows live backend stage progress without manual processing buttons', async () => {
    api.repositoryProcessingStatus.mockResolvedValue(parsingState);
    render(<RepositoryCard repository={repository}/>);
    expect(await screen.findByText('Parsing')).toBeInTheDocument();
    expect(screen.getByText('4 of 9 files read · 8 code sections found')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Parsing progress' })).toHaveAttribute('value', '44');
    expect(screen.queryByRole('button', { name: /index repository|parse repository|generate embeddings/i })).not.toBeInTheDocument();
  });

  it('restores ready state from the backend and exposes repository tools', async () => {
    api.repositoryProcessingStatus.mockResolvedValue(readyState);
    render(<RepositoryCard repository={repository}/>);
    expect(await screen.findByText('Ready to explore')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask CodeCompass' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search Repository' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Explorer' })).toBeInTheDocument();
  });

  it('offers retry for the failed stage and retries only that stage', async () => {
    api.repositoryProcessingStatus.mockResolvedValue({ status: 'failed', currentStage: 'embeddings', retryAvailable: true, stages: {
      indexing: { status: 'completed', completed: true }, parsing: { status: 'completed', completed: true },
      embeddings: { status: 'failed', error: 'Embedding provider is unavailable.' },
    } });
    api.startRepositoryEmbeddings.mockResolvedValue({ success: true });
    render(<RepositoryCard repository={repository}/>);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry generating embeddings' }));
    await waitFor(() => expect(api.startRepositoryEmbeddings).toHaveBeenCalledWith('r1'));
    expect(api.startRepositoryIndexing).not.toHaveBeenCalled();
    expect(api.startRepositoryParsing).not.toHaveBeenCalled();
  });

  it('keeps separate repository statuses independent', async () => {
    api.repositoryProcessingStatus.mockImplementation((id) => Promise.resolve(id === 'r1' ? readyState : parsingState));
    render(<><RepositoryCard repository={repository}/><RepositoryCard repository={{ ...repository, id: 'r2', fullName: 'octo/other' }}/></>);
    await waitFor(() => expect(api.repositoryProcessingStatus).toHaveBeenCalledWith('r1'));
    await waitFor(() => expect(api.repositoryProcessingStatus).toHaveBeenCalledWith('r2'));
    expect(screen.getByText('Ready to explore')).toBeInTheDocument();
    expect(screen.getAllByText('Parsing').length).toBeGreaterThan(0);
  });

  it('offers repository management actions and requires confirmation before deletion', async () => {
    api.repositoryProcessingStatus.mockResolvedValue(readyState);
    const onDelete = vi.fn().mockResolvedValue({ success: true });
    render(<RepositoryCard repository={repository} onDelete={onDelete}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for octo/project' }));
    expect(screen.getByRole('menuitem', { name: 'Open on GitHub ↗' })).toHaveAttribute('href', repository.htmlUrl);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete repository' }));
    expect(screen.getByRole('dialog', { name: 'Delete repository?' })).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('calls delete only after confirmation and keeps errors visible for retry', async () => {
    api.repositoryProcessingStatus.mockResolvedValue(readyState);
    const onDelete = vi.fn().mockRejectedValueOnce(new Error('Delete failed')).mockResolvedValueOnce({ success: true });
    render(<RepositoryCard repository={repository} onDelete={onDelete}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for octo/project' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete repository' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete repository' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Delete failed');
    expect(screen.getByRole('heading', { name: 'octo/project' })).toBeInTheDocument();
    expect(onDelete).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Delete repository' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
