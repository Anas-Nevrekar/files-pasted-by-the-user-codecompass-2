import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import RepositoryCard from './RepositoryCard.jsx';
import { api } from '../services/api.js';

vi.mock('../services/api.js', () => ({ api: {
  startRepositoryIndexing: vi.fn(),
  indexingJobStatus: vi.fn(),
} }));

const repository = { id: 'repository-id', fullName: 'octo/project', htmlUrl: 'https://github.com/octo/project' };
const activeJob = { id: 'job-1', repositoryId: repository.id, status: 'queued', stage: 'queued', progress: 0, message: 'Waiting for a worker' };

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });
beforeEach(() => { vi.useFakeTimers(); });

describe('RepositoryCard indexing controls', () => {
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
});
