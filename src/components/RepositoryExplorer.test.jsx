import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CodeViewer from './CodeViewer.jsx';
import CodeGraph from './CodeGraph.jsx';
import ReadingGuide from './ReadingGuide.jsx';
import { api } from '../services/api.js';

vi.mock('../services/api.js', () => ({ api: {
  repositorySource: vi.fn(), repositoryGraph: vi.fn(), repositoryReadingGuide: vi.fn(),
  repositoryReadingProgress: vi.fn().mockResolvedValue({ progress: null }),
  saveRepositoryReadingProgress: vi.fn().mockResolvedValue({})
} }));
vi.mock('@monaco-editor/react', () => ({ default: ({ language, value, options }) => <pre data-testid="monaco" data-language={language} data-readonly={String(options.readOnly)}>{value}</pre> }));
vi.mock('@xyflow/react', () => ({
  ReactFlow: ({ nodes, edges, onNodeClick }) => <div data-testid="flow">
    {nodes.map((node) => <button key={node.id} onClick={(event) => onNodeClick(event, node)}>{node.data.name}</button>)}
    {edges.map((edge) => <span key={edge.id} data-testid="graph-edge" data-dashed={edge.style.strokeDasharray ? 'true' : 'false'}>{edge.label || edge.data.type}</span>)}
  </div>,
  Background: () => null, Controls: () => null, Handle: () => null, MiniMap: () => null, Position: { Left: 'left', Right: 'right' }, MarkerType: { ArrowClosed: 'arrowclosed' }
}));

const repository = { id: 'repo-1', fullName: 'octo/project', description: 'A small demo application.' };
const storyChapters = [
  { id: 'overview', title: 'What are we looking at?', paragraphs: ['The snapshot contains a frontend and a backend.'], files: [], relationships: [], diagram: { nodes: [], edges: [] } },
  { id: 'beginning', title: 'Where does everything begin?', paragraphs: ['The entry candidate imports the application component.'], files: [{ filePath: 'src/main.jsx', symbolName: 'mount', startLine: 4, endLine: 8, evidenceType: 'filename-heuristic', certainty: 'medium' }], relationships: [], diagram: { nodes: [], edges: [] } },
  { id: 'application-flow', title: 'How does the application work?', paragraphs: ['The parsed source in src/main.jsx imports src/App.jsx. This confirms a source dependency, not execution order.'], files: [{ filePath: 'src/App.jsx', startLine: 3, endLine: 8 }], relationships: [{ sourcePath: 'src/main.jsx', targetPath: 'src/App.jsx' }], diagram: { nodes: [], edges: [{ sourcePath: 'src/main.jsx', targetPath: 'src/App.jsx', label: 'imports' }] } },
  { id: 'summary', title: 'Putting the pieces together', paragraphs: ['You now have the basic mental model of this codebase.'], files: [], relationships: [], diagram: { nodes: [], edges: [] } }
];
function guideResponse(chapters = storyChapters) { return { status: 'ready', onboarding: { chapters }, metadata: { method: 'static-analysis', parsingJobId: 'parse-1', isComplete: true, coverage: { parsedFiles: 2, indexedFiles: 3, chunks: 5 } } }; }
afterEach(() => { cleanup(); window.localStorage.clear(); vi.clearAllMocks(); });

describe('CodeViewer', () => {
  it('loads trusted source chunks, uses a supported language, and configures Monaco as read-only', async () => {
    api.repositorySource.mockResolvedValue({ filePath: 'src/auth.py', contentScope: 'parsed_chunks', chunks: [{ source: 'def login():\n    return True', language: 'python', startLine: 4, endLine: 5 }] });
    render(<CodeViewer repository={repository} target={{ filePath: 'src/auth.py', chunkId: 'chunk-1', startLine: 4, endLine: 5 }}/>);
    expect(await screen.findByTestId('monaco')).toHaveTextContent('def login()');
    expect(screen.getByTestId('monaco')).toHaveAttribute('data-language', 'python');
    expect(screen.getByTestId('monaco')).toHaveAttribute('data-readonly', 'true');
    expect(api.repositorySource).toHaveBeenCalledWith('repo-1', expect.objectContaining({ filePath: 'src/auth.py', chunkId: 'chunk-1', startLine: 4, endLine: 5, signal: expect.any(AbortSignal) }));
    expect(screen.getByText(/showing retained AST chunks/i)).toBeInTheDocument();
  });

  it('shows source load errors and does not invent code', async () => {
    api.repositorySource.mockRejectedValue(new Error('Source is unavailable.'));
    render(<CodeViewer repository={repository} target={{ filePath: 'src/missing.js' }}/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Source is unavailable.');
    expect(screen.queryByTestId('monaco')).not.toBeInTheDocument();
  });
});

describe('CodeGraph', () => {
  it('renders backend nodes and uncertain relationship styling, then opens selected source', async () => {
    api.repositoryGraph.mockResolvedValue({ repositoryId: 'repo-1', status: 'ready', nodes: [
      { id: 'file-1', type: 'file', name: 'auth.js', filePath: 'src/auth.js' },
      { id: 'fn-1', type: 'function', name: 'login', filePath: 'src/auth.js', language: 'javascript', symbolName: 'login', startLine: 4, endLine: 6 }
    ], edges: [{ id: 'edge-1', source: 'file-1', target: 'fn-1', type: 'CONTAINS', certainty: 'low', isInferred: true }], metadata: { totalNodes: 2, totalEdges: 1, isComplete: true, unsupportedRelationships: [], modules: [{ id: 'module-auth', path: 'src', name: 'src', fileCount: 1, symbolCount: 1, filePaths: ['src/auth.js'], fileNodeIds: ['file-1'], dependencies: [] }] } });
    const onOpenSource = vi.fn();
    render(<CodeGraph repository={repository} onOpenSource={onOpenSource}/>);
    fireEvent.click(await screen.findByRole('button', { name: 'src' }));
    fireEvent.click(await screen.findByRole('button', { name: 'auth.js' }));
    fireEvent.click(await screen.findByRole('button', { name: 'login' }));
    expect(screen.getByText('src/auth.js')).toBeInTheDocument();
    expect(screen.getByTestId('graph-edge')).toHaveAttribute('data-dashed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /open in code viewer/i }));
    expect(onOpenSource).toHaveBeenCalledWith({ filePath: 'src/auth.js', symbolName: 'login', startLine: 4, endLine: 6 });
  });

  it('handles an empty backend graph without generating nodes', async () => {
    api.repositoryGraph.mockResolvedValue({ status: 'ready', nodes: [], edges: [], metadata: { modules: [] } });
    render(<CodeGraph repository={repository} onOpenSource={() => {}}/>);
    expect(await screen.findByText('No parsed graph nodes')).toBeInTheDocument();
  });
});

describe('ReadingGuide', () => {
  it('renders one continuous story with a concise overview, connected chapters, and no stage or section navigation', async () => {
    api.repositoryReadingGuide.mockResolvedValue(guideResponse());
    render(<ReadingGuide repository={repository} onOpenSource={() => {}}/>);
    expect(await screen.findByRole('heading', { name: 'Understand This Codebase' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'octo/project' })).toBeInTheDocument();
    expect(screen.getByText('A small demo application.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What are we looking at?' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Putting the pieces together' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: /onboarding/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/stage 1/i)).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Reading progress' })).toHaveAttribute('aria-valuenow', '0');
  });

  it('opens a referenced file at its source lines and stores the reading position', async () => {
    api.repositoryReadingGuide.mockResolvedValue(guideResponse());
    const onOpenSource = vi.fn();
    render(<ReadingGuide repository={repository} onOpenSource={onOpenSource}/>);
    fireEvent.click(await screen.findByRole('button', { name: /src\/main\.jsx.*lines 4–8/i }));
    expect(onOpenSource).toHaveBeenCalledWith({ filePath: 'src/main.jsx', symbolName: 'mount', startLine: 4, endLine: 8 });
    expect(window.localStorage.getItem('codecompass-onboarding-position:unknown-user:repo-1:parse-1')).toContain('scrollY');
  });

  it('shows a small contextual import diagram with an explicit relationship label', async () => {
    api.repositoryReadingGuide.mockResolvedValue(guideResponse());
    render(<ReadingGuide repository={repository} onOpenSource={() => {}}/>);
    await screen.findByRole('heading', { name: 'How does the application work?' });
    expect(screen.getByText('HOW THESE FILES CONNECT')).toBeInTheDocument();
    expect(screen.getByText('uses code from →')).toBeInTheDocument();
    expect(screen.getByText(/do not show the order every action runs/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /next chapter/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /previous chapter/i }).length).toBeGreaterThan(0);
  });

  it('offers Ask CodeCompass as an action at the end of the story', async () => {
    api.repositoryReadingGuide.mockResolvedValue(guideResponse());
    const onAsk = vi.fn();
    render(<ReadingGuide repository={repository} onOpenSource={() => {}} onAsk={onAsk}/>);
    fireEvent.click(await screen.findByRole('button', { name: /ask codecompass a question/i }));
    expect(onAsk).toHaveBeenCalledOnce();
  });

  it('handles a guide with no generated chapters', async () => {
    api.repositoryReadingGuide.mockResolvedValue(guideResponse([]));
    render(<ReadingGuide repository={repository} onOpenSource={() => {}}/>);
    expect(await screen.findByText('No story could be generated yet')).toBeInTheDocument();
  });

  it('shows loading and API error states', async () => {
    api.repositoryReadingGuide.mockReturnValueOnce(new Promise(() => {}));
    const loading = render(<ReadingGuide repository={repository} onOpenSource={() => {}}/>);
    expect(screen.getByRole('status')).toHaveTextContent(/preparing your onboarding guide/i);
    loading.unmount();
    api.repositoryReadingGuide.mockRejectedValueOnce(new Error('Guide unavailable.'));
    render(<ReadingGuide repository={repository} onOpenSource={() => {}}/>);
    expect(await screen.findByRole('alert')).toHaveTextContent('Guide unavailable.');
  });

  it('shows incomplete parse coverage without claiming a complete architecture story', async () => {
    api.repositoryReadingGuide.mockResolvedValue({ ...guideResponse(), metadata: { ...guideResponse().metadata, isComplete: false, coverage: { parsedFiles: 4, indexedFiles: 7, chunks: 12 } } });
    render(<ReadingGuide repository={repository} onOpenSource={() => {}}/>);
    expect(await screen.findByText(/We could examine 4 of 7 files/i)).toBeInTheDocument();
    expect(screen.getByText(/may miss parts of the application/i)).toBeInTheDocument();
  });
});
