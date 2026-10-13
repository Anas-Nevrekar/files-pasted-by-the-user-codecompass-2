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

export const api = {
  get baseUrl() { return baseUrl; },
  me: () => request('/api/auth/me'),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  repositories: () => request('/api/repositories'),
  importRepository: (url) => request('/api/repositories/import', { method: 'POST', body: JSON.stringify({ url }) }),
  githubSignInUrl: () => `${baseUrl}/api/auth/github`,
};
