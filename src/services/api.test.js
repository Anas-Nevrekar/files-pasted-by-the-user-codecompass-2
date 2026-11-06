import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, readSseStream } from './api.js';

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

describe('Phase 5 API contract', () => {
  it('starts embedding generation and polls by the returned job ID', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({ success: true, alreadyRunning: false, job: { id: 'embed-1', status: 'queued' } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ job: { id: 'embed-1', status: 'processing', processedChunks: 4 } }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.startRepositoryEmbeddings('repo/a')).resolves.toMatchObject({ job: { id: 'embed-1', status: 'queued' } });
    await expect(api.embeddingJobStatus('embed-1')).resolves.toMatchObject({ job: { processedChunks: 4 } });
    expect(fetchMock).toHaveBeenNthCalledWith(1, `${api.baseUrl}/api/repositories/repo%2Fa/embeddings`, { method: 'POST', credentials: 'include', headers: {} });
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${api.baseUrl}/api/embedding-jobs/embed-1`, { credentials: 'include', headers: {} });
  });

  it('posts search query and limit using the repository route and cookie credentials', async () => {
    const responseBody = { repositoryId: 'repo-1', query: 'authenticate', results: [] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => responseBody });
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.searchRepository('repo-1', 'authenticate', 10)).resolves.toEqual(responseBody);
    expect(fetchMock).toHaveBeenCalledWith(`${api.baseUrl}/api/repositories/repo-1/search`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'authenticate', limit: 10 }),
    });
  });
});

describe('Phase 6 API contract', () => {
  it('posts streaming questions with cookies and parses the backend SSE contract', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'event: start\ndata: {"repositoryId":"repo-1"}\n\neve',
      'nt: token\ndata: {"text":"Auth uses "}\n\nevent: token\ndata: {"text":"login [[S1]]."}\n\n',
      'event: citations\ndata: {"citations":[{"id":"S1","chunkId":"chunk-1","filePath":"src/auth.js","startLine":2,"endLine":4,"sourceCode":"function login() {}"}]}\n\nevent: complete\ndata: {"status":"completed","insufficientEvidence":false}\n\n',
    ];
    const body = new ReadableStream({ start(controller) { chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk))); controller.close(); } });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, body });
    vi.stubGlobal('fetch', fetchMock);
    const events = [];
    const result = await api.askRepositoryQuestion('repo/a', 'Where is login?', { onEvent: (event, payload) => events.push([event, payload]) });
    expect(result).toMatchObject({ answer: 'Auth uses login [[S1]].', citations: [{ id: 'S1', filePath: 'src/auth.js' }], insufficientEvidence: false });
    expect(events.map(([event]) => event)).toEqual(['start', 'token', 'token', 'citations', 'complete']);
    expect(fetchMock).toHaveBeenCalledWith(`${api.baseUrl}/api/repositories/repo%2Fa/ask`, expect.objectContaining({
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify({ question: 'Where is login?', stream: true }),
    }));
  });

  it('rejects a stream that ends without completion and maps backend readiness errors', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('event: token\ndata: {"text":"partial"}\n\n')); controller.close(); } });
    await expect(readSseStream({ body })).rejects.toMatchObject({ code: 'STREAM_INTERRUPTED' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: { code: 'EMBEDDINGS_NOT_READY', message: 'Generate embeddings.' } }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.askRepositoryQuestion('repo-1', 'question')).rejects.toMatchObject({ code: 'EMBEDDINGS_NOT_READY', message: expect.stringContaining('Generate embeddings') });
  });

  it('replaces a citationless partial stream with the backend validated answer', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'event: token\ndata: {"text":"uncited partial"}\n\n',
      'event: answer\ndata: {"answer":"Validated [[S1]]."}\n\n',
      'event: citations\ndata: {"citations":[{"id":"S1","chunkId":"chunk-1","filePath":"src/auth.js"}]}\n\n',
      'event: complete\ndata: {"status":"completed","insufficientEvidence":false}\n\n'
    ];
    const body = new ReadableStream({ start(controller) { chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk))); controller.close(); } });
    const events = [];
    const result = await readSseStream({ body }, (event, payload) => events.push([event, payload]));
    expect(result.answer).toBe('Validated [[S1]].');
    expect(result.citations.map(({ id }) => id)).toEqual(['S1']);
    expect(events.map(([event]) => event)).toEqual(['token', 'answer', 'citations', 'complete']);
  });

  it('accepts the backend JSON insufficient-evidence response when retrieval is empty', async () => {
    const result = { repositoryId: 'repo-1', question: 'Where?', answer: 'The retrieved code evidence does not contain enough information.', citations: [], insufficientEvidence: true, parsingJobId: 'parse-1' };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: { get: () => 'application/json; charset=utf-8' }, json: async () => result });
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.askRepositoryQuestion('repo-1', 'Where?')).resolves.toEqual(result);
  });
});
