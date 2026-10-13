# CodeCompass Frontend

A React and Vite frontend for the CodeCompass Phase 2 onboarding flow. Sign in with GitHub through the backend, add public repository URLs, and view persisted repository metadata. This phase does not clone or index source code.

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

The app supports GitHub sign-in, user session checks, public repository metadata import/listing, and logout. It does not implement private repository access, cloning, indexing, parsing, embeddings, AI answers, or graph visualization.
