import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api.js';

afterEach(() => vi.unstubAllGlobals());

describe('Phase 4 API contract', () => {
  it('starts parsing with the repository route, cookie credentials, and no assumed request body', async () => {
    const responseBody = { success: true, alreadyRunning: false, job: { id: 'parse-1', repositoryId: 'repo-1', status: 'queued', stage: 'queued', progress: 0 } };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => responseBody });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.startRepositoryParsing('repo-1')).resolves.toEqual(responseBody);
    expect(fetchMock).toHaveBeenCalledWith(`${api.baseUrl}/api/repositories/repo-1/parse`, {
      method: 'POST', credentials: 'include', headers: {},
    });
  });

  it('reads parsing status by job ID and preserves the contract job envelope', async () => {
    const responseBody = { job: { id: 'parse-1', repositoryId: 'repo-1', status: 'completed_with_errors', stage: 'completed', progress: 100, totalFiles: 4, processedFiles: 4, parsedFiles: 2, skippedFiles: 1, failedFiles: 1, totalChunks: 5, errorMessage: null, startedAt: null, completedAt: null } };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => responseBody });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.parsingJobStatus('parse-1')).resolves.toEqual(responseBody);
    expect(fetchMock).toHaveBeenCalledWith(`${api.baseUrl}/api/parsing-jobs/parse-1`, {
      credentials: 'include', headers: {},
    });
  });

  it('surfaces the safe source-unavailable contract error code and message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 409,
      json: async () => ({ error: { code: 'PARSING_SOURCE_UNAVAILABLE', message: 'Repository indexing must be complete and its retained clone available before parsing.' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.startRepositoryParsing('repo-1')).rejects.toMatchObject({
      name: 'ApiError', status: 409, code: 'PARSING_SOURCE_UNAVAILABLE',
    });
    await expect(api.startRepositoryParsing('repo-1')).rejects.toBeInstanceOf(ApiError);
  });
});
