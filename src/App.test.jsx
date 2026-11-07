import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount() { window.history.replaceState({}, '', '/'); return render(<BrowserRouter><App/></BrowserRouter>); }
describe('CodeCompass app', () => {
 it('renders the landing page and links sign-in to backend OAuth', async () => { vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline'))); mount(); expect(await screen.findByRole('heading', { name: /find your way/i })).toBeInTheDocument(); expect(screen.getByRole('link', { name: /continue with github/i })).toHaveAttribute('href', 'http://localhost:3000/api/auth/github'); });
 it('keeps dashboard protected when the backend session is unauthenticated', async () => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok:false, status:401, json:async()=>({error:{code:'UNAUTHENTICATED',message:'Sign in'}}) })); mount(); expect(await screen.findByRole('link', { name:/continue with github/i })).toBeInTheDocument(); expect(screen.queryByText(/your library/i)).not.toBeInTheDocument(); });
 it('shows authenticated user, repository list, imports without duplicates, and logs out', async () => {
  const repo={id:'r1',owner:'octo',name:'hello',fullName:'octo/hello',htmlUrl:'https://github.com/octo/hello',description:'A project',language:'JavaScript',starsCount:8,defaultBranch:'main'};
  const fetchMock=vi.fn(async (url, options={}) => { if (String(url).endsWith('/api/auth/me')) return {ok:true,status:200,json:async()=>({authenticated:true,user:{id:'u1',githubUsername:'octocat',displayName:'Octo Cat'}})}; if (String(url).endsWith('/api/repositories') && !options.method) return {ok:true,status:200,json:async()=>({repositories:[repo]})}; if (String(url).endsWith('/api/repositories/r1/indexing-status')) return {ok:true,status:200,json:async()=>({repositoryId:'r1',latestJob:null,lastSuccessfulIndex:null})}; if (String(url).endsWith('/api/repositories/import')) return {ok:true,status:200,json:async()=>({success:true,alreadyImported:true,code:'REPOSITORY_ALREADY_IMPORTED',repository:repo})}; if (String(url).endsWith('/api/auth/logout')) return {ok:true,status:200,json:async()=>({success:true})}; throw Error(String(url)); }); vi.stubGlobal('fetch',fetchMock);
  mount(); expect(await screen.findByRole('heading',{name:/understand any codebase, faster/i})).toBeInTheDocument(); expect(await screen.findByText('octo/hello')).toBeInTheDocument(); const input=screen.getByLabelText(/github repository url/i); await userEvent.type(input,'https://github.com/octo/hello'); await userEvent.click(screen.getByRole('button',{name:/add repository/i})); await waitFor(()=>expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/api/repositories/import',expect.objectContaining({credentials:'include',method:'POST'}))); await waitFor(()=>expect(screen.getAllByText('octo/hello')).toHaveLength(1)); await userEvent.click(screen.getByRole('button',{name:/sign out/i})); expect(await screen.findByRole('link',{name:/continue with github/i})).toBeInTheDocument(); expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/api/auth/logout',expect.objectContaining({credentials:'include',method:'POST'}));
 });
 it('restores the latest backend indexing job when the dashboard loads', async () => {
  const job = { id:'job-restore', repositoryId:'repo-restore', status:'queued', stage:'queued', progress:0, message:'Waiting for a worker' };
  const fetchMock = vi.fn(async (url) => {
   if (String(url).endsWith('/api/auth/me')) return {ok:true,status:200,json:async()=>({authenticated:true,user:{id:'u',githubUsername:'dev'}})};
   if (String(url).endsWith('/api/repositories')) return {ok:true,status:200,json:async()=>({repositories:[{id:'repo-restore',owner:'octo',name:'project',fullName:'octo/project',htmlUrl:'https://github.com/octo/project'}]})};
   if (String(url).endsWith('/api/repositories/repo-restore/indexing-status')) return {ok:true,status:200,json:async()=>({repositoryId:'repo-restore',status:'processing',currentStage:'indexing',stages:{indexing:{status:'queued',progress:0,completed:false}}})};
   throw Error(String(url));
  });
  vi.stubGlobal('fetch',fetchMock); mount();
  expect(await screen.findByText('Indexing')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/api/repositories/repo-restore/indexing-status',expect.objectContaining({credentials:'include'}));
 });
 it('rejects malformed repository URLs before calling import', async () => { vi.stubGlobal('fetch', vi.fn(async url => String(url).endsWith('/api/auth/me') ? ({ok:true,status:200,json:async()=>({authenticated:true,user:{id:'u',githubUsername:'dev'}})}) : String(url).endsWith('/api/repositories') ? ({ok:true,status:200,json:async()=>({repositories:[]})}) : ({ok:true,status:200,json:async()=>({repositoryId:'r',latestJob:null,lastSuccessfulIndex:null})}))); mount(); await screen.findByLabelText(/github repository url/i); await userEvent.type(screen.getByLabelText(/github repository url/i),'https://example.com/project'); await userEvent.click(screen.getByRole('button',{name:/add repository/i})); expect(await screen.findByRole('alert')).toHaveTextContent(/use a repository url/i); });
 it('opens a repository exploration page from the dashboard without leaving repository context', async () => {
  const repository = { id: 'repo-phase7', owner: 'octo', name: 'project', fullName: 'octo/project', htmlUrl: 'https://github.com/octo/project', description: 'A project' };
  vi.stubGlobal('fetch', vi.fn(async (url) => {
   if (String(url).endsWith('/api/auth/me')) return { ok: true, status: 200, json: async () => ({ authenticated: true, user: { id: 'u', githubUsername: 'dev' } }) };
   if (String(url).endsWith('/api/repositories')) return { ok: true, status: 200, json: async () => ({ repositories: [repository] }) };
   if (String(url).endsWith('/indexing-status')) return { ok: true, status: 200, json: async () => ({ repositoryId: repository.id, status: 'ready', currentStage: 'ready', stages: { indexing: { status: 'completed', completed: true }, parsing: { status: 'completed', completed: true }, embeddings: { status: 'completed', completed: true, embeddedChunks: 3 } } }) };
   throw Error(String(url));
  }));
  mount();
  await userEvent.click(await screen.findByRole('button', { name: /open explorer/i }));
  expect(await screen.findByRole('heading', { name: 'octo/project' })).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: /repository exploration/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Code Graph' })).toBeInTheDocument();
 });
 it('updates workspace metrics from processing status and removes a repository only after deletion succeeds', async () => {
  const repos = [
   { id: 'ready-repo', owner: 'octo', name: 'ready', fullName: 'octo/ready', htmlUrl: 'https://github.com/octo/ready' },
   { id: 'failed-repo', owner: 'octo', name: 'failed', fullName: 'octo/failed', htmlUrl: 'https://github.com/octo/failed' },
  ];
  const fetchMock = vi.fn(async (url, options = {}) => {
   const target = String(url);
   if (target.endsWith('/api/auth/me')) return { ok: true, status: 200, json: async () => ({ authenticated: true, user: { id: 'u', githubUsername: 'dev' } }) };
   if (target.endsWith('/api/repositories') && !options.method) return { ok: true, status: 200, json: async () => ({ repositories: repos }) };
   if (target.endsWith('/ready-repo/indexing-status')) return { ok: true, status: 200, json: async () => ({ status: 'ready', currentStage: 'ready', stages: { embeddings: { embeddedChunks: 3 } } }) };
   if (target.endsWith('/failed-repo/indexing-status')) return { ok: true, status: 200, json: async () => ({ status: 'failed', currentStage: 'parsing', stages: { parsing: { status: 'failed', error: 'Parse failed' } } }) };
   if (target.endsWith('/api/repositories/failed-repo') && options.method === 'DELETE') return { ok: true, status: 200, json: async () => ({ success: true, deleted: true, detached: false }) };
   throw Error(target);
  });
  vi.stubGlobal('fetch', fetchMock); mount();
  const summary = await screen.findByRole('region', { name: 'Repository summary' });
  await waitFor(() => expect([...summary.querySelectorAll('strong')].map((item) => item.textContent)).toEqual(['2', '1', '0', '1']));
  expect(screen.getByRole('heading', { name: 'octo/failed' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Actions for octo/failed' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Delete repository' }));
  expect(screen.getByRole('heading', { name: 'octo/failed' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Delete repository' }));
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'octo/failed' })).not.toBeInTheDocument());
  expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/api/repositories/failed-repo', expect.objectContaining({ method: 'DELETE', credentials: 'include' }));
  expect(await screen.findByRole('status')).toHaveTextContent('octo/failed was removed from CodeCompass.');
  expect([...summary.querySelectorAll('strong')].map((item) => item.textContent)).toEqual(['1', '1', '0', '0']);
 });
});
