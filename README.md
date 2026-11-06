# CodeCompass Frontend

A React and Vite frontend for CodeCompass repository onboarding, indexing, parsing, embeddings, hybrid code retrieval, and evidence-grounded repository questions. Sign in with GitHub through the backend, add public repository URLs, and explore code through search and AI answers with validated citations.

## Stack

- React 19, Vite, JavaScript ES modules
- React Router
- Fetch API with HTTP-only backend session cookies
- Vitest, Testing Library, jsdom

## Prerequisites

- Node.js 20 or newer and npm
- The separately maintained [CodeCompass backend](../files-pasted-by-the-user-codecompass/codecompass-backend/README.md)
- For end-to-end sign-in, a GitHub OAuth App configured in the backend

## Install and run

```bash
npm install
cp .env.example .env
npm run dev
```

Vite serves the app at `http://localhost:5173`. Configure the backend's `FRONTEND_URL` to exactly that origin. Set `VITE_API_BASE_URL` in `.env` to the backend origin (default `http://localhost:3000`), then restart Vite after changing it.

```bash
npm test
npm run build
npm run preview
```

## Authentication flow

The Continue with GitHub link navigates the browser to `GET /api/auth/github`. The backend owns OAuth, creates an HTTP-only, `SameSite=Lax` session cookie, and redirects to `/dashboard`; OAuth errors redirect to `/auth/error?code=…`. On app startup, the frontend calls `GET /api/auth/me` and renders protected content only after the backend confirms the session. The frontend keeps user state in React memory only. It does not receive or store GitHub access tokens or session tokens.

## Backend API used

All requests use `credentials: "include"` and the base URL from `VITE_API_BASE_URL`.

- `GET /api/auth/github` — OAuth initiation (browser navigation)
- `GET /api/auth/me` — current user and session validation
- `POST /api/auth/logout` — clear the session cookie
- `POST /api/repositories/import` — JSON `{ "url": "https://github.com/owner/repository" }`
- `GET /api/repositories` — user's imported repositories

API errors use `{ "error": { "code": "…", "message": "…" } }`. The client maps known backend codes to helpful UI errors and handles network or invalid JSON responses.

## Local backend setup

Follow the backend README to configure its `.env`, GitHub OAuth callback URL (`http://localhost:3000/api/auth/github/callback`), database, and services. Set the GitHub OAuth App homepage to `http://localhost:5173`. The backend must use `FRONTEND_URL=http://localhost:5173`; credentialed CORS and state-changing request origin checks require an exact match. Use the same hostname consistently (for example, do not mix `localhost` and `127.0.0.1`) so browser cookie behavior is predictable.

The backend cookie is HTTP-only and scoped to `/api`. Keep frontend and backend on local HTTP for development; production must use HTTPS and the exact deployed frontend origin. Never put GitHub client secrets or backend session secrets in a `VITE_` variable.

## Troubleshooting

- **Network error:** confirm the backend is running at `VITE_API_BASE_URL` and restart Vite after environment changes.
- **CORS or `ORIGIN_FORBIDDEN`:** align backend `FRONTEND_URL` with the browser's frontend origin and use credentialed requests.
- **Cookie/session missing:** use consistent hostnames and check browser cookie settings; the frontend must not replace the HTTP-only cookie with browser storage.
- **OAuth configuration error:** configure the OAuth client ID, secret, callback URL, and session secret in the backend only.

## Scope

The app supports GitHub sign-in, public repository metadata import/listing, indexing, AST parsing, embedding job progress, hybrid code retrieval, and stateless repository question answering with citations. It does not implement private repository access, persisted conversations, or graph visualization.

## Phase 3: Repository indexing UI

Each imported repository now shows its latest indexing status. Users can start indexing, monitor the backend-reported stage and progress, retry a failed job, and resume polling an active job after reloading the dashboard. Polling runs every two seconds, avoids overlapping requests, also refreshes when the page becomes visible, and stops for completed/failed jobs or when a card unmounts. Temporary status request errors leave the current backend status intact and are shown inline.

The frontend uses these implemented backend endpoints (all status calls use the existing credentialed API client):

- `POST /api/repositories/:repositoryId/index` — returns `{ success, alreadyRunning, job }` with HTTP 202 for a new job and HTTP 200 when an active job already exists. `job` includes `id`, `repositoryId`, `status`, `progress`, `stage`, `message`, discovered/eligible/excluded file counts, attempt counts, timestamps, and a safe `error` object.
- `GET /api/repositories/:repositoryId/indexing-status` — returns `{ repositoryId, latestJob, lastSuccessfulIndex }`. This is fetched per imported repository because the list endpoint does not include indexing fields.
- `GET /api/indexing-jobs/:jobId` — returns `{ job }` for polling.

Current backend stages are `queued`, `cloning`, `filtering`, `saving_inventory`, `completed`, and `failed` (the last two are terminal job statuses). The progress bar appears only when the backend returns a numeric `progress`; the UI does not estimate progress. Successful file totals and commit information are displayed only when supplied by the backend. Unknown statuses are shown as unknown instead of being treated as completed.

## Phase 5: embedding and hybrid search UI

Each repository card shows a separate Embeddings section. Generation is available after the latest saved parsing job is `completed` or `completed_with_errors`. The frontend starts work with `POST /api/repositories/:repositoryId/embeddings`, then polls `GET /api/embedding-jobs/:jobId` every two seconds while the job is `queued` or `processing`. It displays the backend stage and progress counts and stops polling when the backend reports `completed`, `completed_with_errors`, or `failed`. Temporary polling errors leave the last known job state intact. The job ID and last backend response are stored per repository in local storage; on refresh, the frontend uses the saved job ID to restore status from the backend. This is job tracking only and does not store authentication tokens.

The backend currently provides job lookup by ID but no repository-level latest embedding status endpoint. A job started in another browser, or a job whose local storage entry was cleared, cannot be discovered by this frontend until the backend adds that endpoint. Search remains hidden until a saved embedding job for the current parse confirms at least one embedded chunk.

When embeddings are ready, the repository card reveals an inline code search panel. The frontend posts `{ "query": "Where is user authentication handled?", "limit": 10 }` to `POST /api/repositories/:repositoryId/search`, using the existing credentialed API client and `VITE_API_BASE_URL`. Enter and the Search button submit the query; blank input and repeat submissions while a request is active are blocked. The frontend displays results exactly in the order returned by the backend, including symbol, path, language, structure, line range, source snippet, match method, vector/keyword ranks, and RRF score when supplied. It does not generate answers, embeddings, or ranking scores.

The backend response is `{ repositoryId, query, parsingJobId, results }`. Each result contains `chunkId`, `filePath`, `language`, `structureType`, `symbolName`, `startLine`, `endLine`, `sourceCode`, `metadata`, and a `retrieval` object with optional `vectorRank`, `keywordRank`, `rrfScore`, `matchedBy`, and `cosineDistance`. Backend errors use the existing `{ error: { code, message } }` envelope; the frontend shows safe readable messages for missing embeddings, required parsing, expired sessions, and provider/network failures.

No new frontend environment variables are required. Set `VITE_API_BASE_URL` to the backend origin (default `http://localhost:3000`); do not configure Ollama in Vite because embedding requests are made only by the backend. Install dependencies with `npm install`, run locally with `npm run dev`, run frontend tests with `npm test`, and create the production bundle with `npm run build`.

## Phase 6: repository question answering

When a repository has a successful parse and its saved embedding job confirms embedded chunks for that exact parse and latest indexed snapshot, its card offers **Ask about this repository**. The interface displays the selected repository name and description, the current conversation, streaming answers, and validated sources. It stays unavailable while indexing, parsing, or embedding is missing, active, or stale. A newer successful index requires parsing and embedding that snapshot before the UI enables questions.

The frontend sends questions only to `POST /api/repositories/:repositoryId/ask` with `{ "question": "Where is user authentication handled?", "stream": true }`. It uses `VITE_API_BASE_URL`, `credentials: "include"`, and the existing HTTP-only session cookie. It does not call Gemini, retrieve code, or validate citations in the browser. The backend response is consumed as Server-Sent Events over a credentialed `fetch` POST stream. The frontend handles `start` (`repositoryId`, `parsingJobId`), `token` (`text`), `citations` (`citations`), `complete` (`status`, `insufficientEvidence`), and `error` (`code`, `message`, `status`). A stream without a completion event is treated as interrupted.

When retrieval is empty, the backend returns JSON immediately even if `stream: true`: `{ repositoryId, question, answer, citations: [], insufficientEvidence: true, parsingJobId }`. For non-streaming clients, a normal answer has `{ repositoryId, question, answer, citations, insufficientEvidence, parsingJobId }`. Backend errors use `{ error: { code, message } }` with status codes including 400 for invalid requests, 401 for expired sessions, 404 for inaccessible repositories, 409 for parsing/embedding readiness, 429 for provider quota, and 503/504 for provider availability/timeouts.

Validated citations contain `id`, `chunkId`, `filePath`, `language`, `structureType`, `symbolName`, `startLine`, `endLine`, `sourceCode`, and `explanation`. Inline `[S1]`/`[[S1]]` references open the matching citation only when it exists in the returned citation list. The Sources section displays the trusted file path and line range; expanding a source shows its metadata, explanation, and code with line labels. Answers render safely as React text with paragraphs, headings, simple lists, inline code, and fenced code blocks. HTML is never injected. When the backend marks evidence insufficient, the UI labels that state and does not present generated text as a supported answer.

Conversation messages live in React state for the current page session and are not persisted. Each question triggers a fresh backend retrieval. Navigating away aborts the browser request; the UI does not claim to cancel provider generation. The backend currently has no repository-level endpoint to discover the latest parsing or embedding job. For readiness, the card therefore relies on the existing browser-local saved job IDs and backend status responses. A job created in another browser or after local storage is cleared may not be discoverable here; the backend still enforces ownership and readiness when `/ask` is called. No backend code or new frontend environment variable was added for this phase.

Questions and retrieved code snippets are sent to Google's hosted Gemini API by the backend. Avoid asking questions about confidential, proprietary, credential-containing, or otherwise sensitive repository content. Keep the Gemini API key in the backend `.env`; never put it in a `VITE_` variable. The backend does not return the key to the browser. Start the backend and its existing indexing, parsing, and embedding services as described in the backend README, then use a ready repository's question panel. Run frontend tests with `npm test` and create the production bundle with `npm run build`.
