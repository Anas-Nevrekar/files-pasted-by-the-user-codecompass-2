const baseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR', details = null } = {}) {
    super(message); this.name = 'ApiError'; this.status = status; this.code = code; this.details = details;
  }
}

const messages = {
  UNAUTHENTICATED: 'Your session has expired. Please sign in again.',
  INVALID_REPOSITORY_URL: 'Enter a valid public GitHub repository URL.',
  PRIVATE_REPOSITORY_UNSUPPORTED: 'Private repositories are not supported yet.',
  REPOSITORY_NOT_FOUND_OR_INACCESSIBLE: 'This repository could not be found or accessed.',
  GITHUB_API_RATE_LIMIT: 'GitHub is temporarily rate limiting requests. Please try again later.',
  GITHUB_UPSTREAM_UNAVAILABLE: 'GitHub is temporarily unavailable. Please try again later.',
  RATE_LIMITED: 'Too many requests. Please wait a few minutes and try again.',
  ORIGIN_FORBIDDEN: 'The request was rejected by the backend security policy.',
  EMBEDDINGS_NOT_READY: 'Generate embeddings for the latest parsing result before asking a question or searching.',
  PARSING_REQUIRED: 'Parse the repository before generating embeddings, asking questions, or searching its code.',
  LLM_NOT_CONFIGURED: 'Question answering is not configured on the backend.',
  LLM_RATE_LIMITED: 'The answer service is rate limited or its quota is exhausted. Try again later.',
  LLM_TIMEOUT: 'The answer request timed out. Please try again.',
  LLM_MODEL_UNAVAILABLE: 'The configured answer model is unavailable. Contact the administrator.',
  LLM_AUTHENTICATION_FAILED: 'The backend could not authenticate with the answer service.',
  LLM_INVALID_RESPONSE: 'The answer service returned an invalid response. Please try again.',
  RAG_UNAVAILABLE: 'Question answering is temporarily unavailable. Please try again later.',
  EMBEDDING_PROVIDER_UNAVAILABLE: 'The embedding service is temporarily unavailable. Please try again later.',
  OLLAMA_UNAVAILABLE: 'The embedding service is temporarily unavailable.',
};

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...options, credentials: 'include',
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    });
  } catch {
    throw new ApiError('Could not reach CodeCompass. Check that the backend is running and try again.');
  }
  let payload;
  try { payload = await response.json(); }
  catch { throw new ApiError('The backend returned an unexpected response. Please try again.', { status: response.status, code: 'INVALID_RESPONSE' }); }
  if (!response.ok) {
    const code = payload?.error?.code || `HTTP_${response.status}`;
    const fallback = ({400:'The request could not be validated.',401:'Please sign in to continue.',403:'You do not have permission to do that.',404:'The requested resource was not found.',429:'Too many requests. Please try again later.',500:'The server encountered an error.',503:'The service is temporarily unavailable.'})[response.status] || 'Something went wrong. Please try again.';
    throw new ApiError(messages[code] || (typeof payload?.error?.message === 'string' ? payload.error.message : fallback), { status: response.status, code, details: payload?.error });
  }
  return payload;
}

async function readApiError(response) {
  let payload;
  try { payload = await response.json(); }
  catch { throw new ApiError('The backend returned an unexpected response. Please try again.', { status: response.status, code: 'INVALID_RESPONSE' }); }
  const code = payload?.error?.code || `HTTP_${response.status}`;
  const fallback = ({ 400: 'The request could not be validated.', 401: 'Please sign in to continue.', 403: 'You do not have permission to do that.', 404: 'The requested resource was not found.', 409: 'This repository is not ready for that action yet.', 429: 'Too many requests. Please try again later.', 502: 'The answer service returned an invalid response.', 503: 'The service is temporarily unavailable.', 504: 'The request timed out.' })[response.status] || 'Something went wrong. Please try again.';
  throw new ApiError(messages[code] || (typeof payload?.error?.message === 'string' ? payload.error.message : fallback), { status: response.status, code, details: payload?.error });
}

export async function readSseStream(response, onEvent = () => {}) {
  if (!response.body?.getReader) throw new ApiError('The backend did not provide an answer stream.', { status: response.status, code: 'INVALID_STREAM' });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';
  let citations = [];
  let insufficientEvidence = false;
  let completed = false;

  function dispatch(block) {
    const lines = block.split('\n');
    let event = 'message';
    const data = [];
    for (const line of lines) {
      if (!line || line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      if (field === 'data') data.push(value);
    }
    if (!data.length) return;
    let payload;
    try { payload = JSON.parse(data.join('\n')); }
    catch { throw new ApiError('The backend sent an invalid answer stream.', { status: 502, code: 'INVALID_STREAM' }); }
    onEvent(event, payload);
    if (event === 'token' && typeof payload.text === 'string') answer += payload.text;
    if (event === 'answer' && typeof payload.answer === 'string') answer = payload.answer;
    if (event === 'citations' && Array.isArray(payload.citations)) citations = payload.citations;
    if (event === 'complete') { completed = true; insufficientEvidence = Boolean(payload.insufficientEvidence); }
    if (event === 'error') throw new ApiError(payload.message || 'Question answering failed.', { status: payload.status || 503, code: payload.code || 'RAG_UNAVAILABLE' });
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
      let splitAt = buffer.indexOf('\n\n');
      while (splitAt >= 0) {
        dispatch(buffer.slice(0, splitAt));
        buffer = buffer.slice(splitAt + 2);
        splitAt = buffer.indexOf('\n\n');
      }
      if (done) break;
    }
    if (buffer.trim()) dispatch(buffer);
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof ApiError) throw error;
    throw new ApiError('The answer stream was interrupted. Please try again.', { code: 'STREAM_INTERRUPTED' });
  } finally {
    try { await reader.cancel(); } catch { /* The stream may already be closed. */ }
  }
  if (!completed) throw new ApiError('The answer stream ended before completion. Please try again.', { code: 'STREAM_INTERRUPTED' });
  return { answer, citations, insufficientEvidence };
}

export const api = {
  get baseUrl() { return baseUrl; },
  me: () => request('/api/auth/me'),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  repositories: () => request('/api/repositories'),
  startRepositoryIndexing: (repositoryId) => request(`/api/repositories/${encodeURIComponent(repositoryId)}/index`, { method: 'POST' }),
  repositoryIndexingStatus: (repositoryId) => request(`/api/repositories/${encodeURIComponent(repositoryId)}/indexing-status`),
  indexingJobStatus: (jobId) => request(`/api/indexing-jobs/${encodeURIComponent(jobId)}`),
  startRepositoryParsing: (repositoryId) => request(`/api/repositories/${encodeURIComponent(repositoryId)}/parse`, { method: 'POST' }),
  parsingJobStatus: (jobId) => request(`/api/parsing-jobs/${encodeURIComponent(jobId)}`),
  startRepositoryEmbeddings: (repositoryId) => request(`/api/repositories/${encodeURIComponent(repositoryId)}/embeddings`, { method: 'POST' }),
  embeddingJobStatus: (jobId) => request(`/api/embedding-jobs/${encodeURIComponent(jobId)}`),
  searchRepository: (repositoryId, query, limit = 10) => request(`/api/repositories/${encodeURIComponent(repositoryId)}/search`, {
    method: 'POST', body: JSON.stringify({ query, limit }),
  }),
  async askRepositoryQuestion(repositoryId, question, { signal, onEvent } = {}) {
    let response;
    try {
      response = await fetch(`${baseUrl}/api/repositories/${encodeURIComponent(repositoryId)}/ask`, {
        method: 'POST', credentials: 'include', signal,
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ question, stream: true }),
      });
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new ApiError('Could not reach CodeCompass. Check that the backend is running and try again.');
    }
    if (!response.ok) return readApiError(response);
    if (response.headers?.get?.('content-type')?.includes('application/json')) {
      let result;
      try { result = await response.json(); }
      catch { throw new ApiError('The backend returned an invalid answer.', { status: response.status, code: 'INVALID_RESPONSE' }); }
      if (typeof result?.answer !== 'string' || !Array.isArray(result.citations) || typeof result.insufficientEvidence !== 'boolean') throw new ApiError('The backend returned an invalid answer.', { status: response.status, code: 'INVALID_RESPONSE' });
      return result;
    }
    return readSseStream(response, onEvent);
  },
  importRepository: (url) => request('/api/repositories/import', { method: 'POST', body: JSON.stringify({ url }) }),
  githubSignInUrl: () => `${baseUrl}/api/auth/github`,
};
