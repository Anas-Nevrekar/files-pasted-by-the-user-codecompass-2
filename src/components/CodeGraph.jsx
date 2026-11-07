import { useEffect, useMemo, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, MiniMap, Position, MarkerType } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api } from '../services/api.js';

function CodeNode({ data, selected }) {
  return <div className={`graph-node graph-node-${data.nodeType} ${selected ? 'graph-node-selected' : ''}`} title={data.tooltip || data.filePath || data.name}>
    <Handle type="target" position={Position.Left}/><span className="graph-node-type">{data.nodeType}</span><strong>{data.name}</strong>
    {data.filePath && <small>{data.filePath}</small>}
    {data.nodeType === 'module' && <small>{data.fileCount} files · {data.symbolCount} symbols · {data.dependencyCount} outgoing module links</small>}
    {data.nodeType === 'context' && <small>Related file</small>}<Handle type="source" position={Position.Right}/>
  </div>;
}
const nodeTypes = { codeNode: CodeNode };
const noOp = () => {};

function moduleForNode(node, modules) { return modules.find((module) => module.filePaths.includes(node.filePath)); }

function nodeForLayout(node, position, selectedId, extra = {}) {
  const nodeType = extra.nodeType || node.type;
  return { id: node.id, type: 'codeNode', position, selected: node.id === selectedId,
    data: { ...node, ...extra, nodeType, name: extra.name || node.name || node.symbolName || node.type } };
}

function layoutForLevel(graph, path, selectedId) {
  const modules = graph.metadata?.modules || [];
  const allFiles = graph.nodes.filter((node) => node.type === 'file');
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const current = path.at(-1);
  let nodes = [];
  let rawEdges = [];
  let filters = ['all'];

  if (!current) {
    nodes = modules.map((module, index) => nodeForLayout(module, { x: (index % 3) * 390, y: Math.floor(index / 3) * 230 }, selectedId,
      { nodeType: 'module', name: module.name, fileCount: module.fileCount, symbolCount: module.symbolCount, dependencyCount: module.dependencies.length,
        tooltip: `${module.path}: ${module.fileCount} files, ${module.symbolCount} parsed chunks` }));
    const moduleIds = new Set(modules.map((module) => module.id));
    const dependencyCounts = new Map();
    modules.forEach((module) => module.dependencies.forEach((dependency) => {
      const key = `${module.id}:${dependency.moduleId}`;
      dependencyCounts.set(key, (dependencyCounts.get(key) || 0) + dependency.importCount);
    }));
    rawEdges = [...dependencyCounts].map(([key, importCount]) => {
      const [source, target] = key.split(':');
      return { id: `module-edge-${key}`, source, target, type: 'IMPORTS', certainty: 'high', isInferred: false, evidence: { importCount } };
    }).filter((edge) => moduleIds.has(edge.source) && moduleIds.has(edge.target));
    filters = ['all', 'imports'];
  } else if (current.level === 'module') {
    const module = modules.find((item) => item.id === current.id);
    const fileIds = new Set(module?.fileNodeIds || []);
    const files = allFiles.filter((node) => fileIds.has(node.id));
    const fileImportEdges = graph.edges.filter((edge) => edge.type === 'IMPORTS' && (fileIds.has(edge.source) || fileIds.has(edge.target)));
    const relatedIds = new Set([...fileIds]);
    fileImportEdges.forEach((edge) => { relatedIds.add(edge.source); relatedIds.add(edge.target); });
    const contextFiles = [...relatedIds].map((id) => byId.get(id)).filter((node) => node?.type === 'file');
    nodes = contextFiles.map((node) => {
      const fileModule = moduleForNode(node, modules);
      const isContext = !fileIds.has(node.id);
      const index = files.findIndex((item) => item.id === node.id);
      const position = isContext ? { x: 760, y: [...relatedIds].indexOf(node.id) * 125 } : { x: 0, y: index * 145 };
      return nodeForLayout(node, position, selectedId, { nodeType: isContext ? 'context' : 'file', tooltip: `${node.filePath}${fileModule ? ` · ${fileModule.path}` : ''}` });
    });
    rawEdges = fileImportEdges;
    filters = ['all', 'imports'];
  } else if (current.level === 'file') {
    const symbols = graph.nodes.filter((node) => node.filePath === current.filePath && node.type !== 'file');
    const fileNode = allFiles.find((node) => node.filePath === current.filePath);
    nodes = symbols.map((node, index) => nodeForLayout(node, { x: 370 + Math.floor(index / 8) * 370, y: (index % 8) * 125 }, selectedId));
    if (fileNode) nodes.unshift(nodeForLayout(fileNode, { x: 0, y: 180 }, selectedId));
    const symbolIds = new Set([...symbols.map((node) => node.id), ...(fileNode ? [fileNode.id] : [])]);
    rawEdges = graph.edges.filter((edge) => symbolIds.has(edge.source) && symbolIds.has(edge.target));
    filters = ['all', 'contains'];
  } else if (current.level === 'symbol') {
    const focus = byId.get(current.id);
    const relatedEdges = graph.edges.filter((edge) => edge.source === current.id || edge.target === current.id);
    const relatedIds = new Set([current.id]);
    relatedEdges.forEach((edge) => { relatedIds.add(edge.source); relatedIds.add(edge.target); });
    nodes = [...relatedIds].map((id) => byId.get(id)).filter(Boolean).map((node) => {
      if (node.id === current.id) return nodeForLayout(node, { x: 380, y: 180 }, current.id);
      const source = relatedEdges.find((edge) => edge.source === node.id && edge.target === current.id);
      return nodeForLayout(node, { x: source ? 0 : 760, y: source ? 100 : 260 }, selectedId, { nodeType: 'context' });
    });
    rawEdges = relatedEdges;
    if (!focus) nodes = [];
    filters = [...new Set(['all', ...relatedEdges.map((edge) => edge.type.toLowerCase())])];
  }
  return { nodes, edges: rawEdges, filters };
}

function styleEdges(edges) {
  return edges.map((edge) => {
    const uncertain = edge.isInferred || ['medium', 'low', 'unknown'].includes(edge.certainty);
    return { id: edge.id, source: edge.source, target: edge.target, label: edge.type === 'IMPORTS' ? 'imports' : undefined, data: edge,
      style: { stroke: uncertain ? '#b08a53' : '#7d9a82', strokeWidth: 1.8, strokeDasharray: uncertain ? '5 4' : undefined },
      labelStyle: { fill: '#718076', fontSize: 10 }, labelBgStyle: { fill: '#f8faf7', fillOpacity: 0.95 },
      markerEnd: { type: MarkerType.ArrowClosed, color: uncertain ? '#b08a53' : '#7d9a82' } };
  });
}

export default function CodeGraph({ repository, focusNodeId, onOpenSource, onUnauthorized = noOp }) {
  const [graph, setGraph] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [path, setPath] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState('');
  const [relationshipFilter, setRelationshipFilter] = useState('all');
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError('');
    api.repositoryGraph(repository.id, { signal: controller.signal }).then((data) => { if (!cancelled) setGraph(data); })
      .catch((requestError) => { if (requestError.code === 'UNAUTHENTICATED') onUnauthorized(); if (!cancelled && requestError.name !== 'AbortError') setError(requestError.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [repository.id, onUnauthorized]);

  const levelData = useMemo(() => graph?.status === 'ready' ? layoutForLevel(graph, path, selectedId) : { nodes: [], edges: [], filters: ['all'] }, [graph, path, selectedId]);
  const shownNodes = useMemo(() => levelData.nodes.map((node) => ({ ...node, selected: node.id === selectedId })), [levelData.nodes, selectedId]);
  const shownEdges = useMemo(() => styleEdges(levelData.edges.filter((edge) => relationshipFilter === 'all' || edge.type.toLowerCase() === relationshipFilter)), [levelData.edges, relationshipFilter]);
  const allGraphNodes = graph?.nodes || [];
  const searchResults = search.trim() ? allGraphNodes.filter((node) => `${node.name || ''} ${node.filePath || ''} ${node.symbolName || ''}`.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 8) : [];

  function navigateTo(nextPath, nextSelectedId = null) {
    setPath(nextPath);
    setSelectedId(nextSelectedId);
    setRelationshipFilter('all');
    const nextHistory = history.slice(0, historyIndex + 1);
    nextHistory.push({ path: nextPath, selectedId: nextSelectedId });
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
  }

  function openSearchResult(node) {
    const module = moduleForNode(node, graph.metadata.modules || []);
    if (node.type === 'file') navigateTo([{ level: 'module', id: module?.id, name: module?.name }, { level: 'file', filePath: node.filePath, id: node.id, name: node.name }].filter((item) => item.id), node.id);
    else {
      const file = allGraphNodes.find((item) => item.type === 'file' && item.filePath === node.filePath);
      navigateTo([{ level: 'module', id: module?.id, name: module?.name }, { level: 'file', filePath: node.filePath, id: file?.id, name: file?.name }, { level: 'symbol', id: node.id, name: node.name || node.symbolName }].filter((item) => item.id), node.id);
    }
    setSearch('');
  }

  function selectNode(_event, flowNode) {
    const node = graph.nodes.find((item) => item.id === flowNode.id);
    if (!node) {
      const module = graph.metadata.modules?.find((item) => item.id === flowNode.id);
      if (module) navigateTo([...path, { level: 'module', id: module.id, name: module.name }], module.id);
      return;
    }
    setSelectedId(node.id);
    if (path.length === 0) return;
    if (path.at(-1).level === 'module' && node.type === 'file') navigateTo([...path, { level: 'file', filePath: node.filePath, id: node.id, name: node.name }], node.id);
    else if (path.at(-1).level === 'file' && node.type !== 'file') navigateTo([...path, { level: 'symbol', id: node.id, name: node.name || node.symbolName }], node.id);
  }

  function openRelated(id) {
    const node = graph.nodes.find((item) => item.id === id);
    if (!node) {
      const module = graph.metadata.modules?.find((item) => item.id === id);
      if (module) navigateTo([{ level: 'module', id: module.id, name: module.name }], module.id);
      return;
    }
    openSearchResult(node);
  }

  function goHistory(index) {
    if (index < 0 || index >= history.length) return;
    setHistoryIndex(index);
    setPath(history[index].path);
    setSelectedId(history[index].selectedId);
    setRelationshipFilter('all');
  }

  useEffect(() => {
    if (!graph || !focusNodeId) return;
    const node = graph.nodes.find((item) => item.id === focusNodeId);
    if (!node) return;
    const module = moduleForNode(node, graph.metadata?.modules || []);
    const modulePath = module ? [{ level: 'module', id: module.id, name: module.name }] : [];
    const file = node.type === 'file' ? node : graph.nodes.find((item) => item.type === 'file' && item.filePath === node.filePath);
    const nextPath = node.type === 'file' ? [...modulePath, { level: 'file', id: node.id, filePath: node.filePath, name: node.name }]
      : [...modulePath, ...(file ? [{ level: 'file', id: file.id, filePath: file.filePath, name: file.name }] : []), { level: 'symbol', id: node.id, name: node.name || node.symbolName }];
    setPath(nextPath);
    setSelectedId(node.id);
    setHistory([{ path: nextPath, selectedId: node.id }]);
    setHistoryIndex(0);
  }, [graph, focusNodeId]);

  if (loading) return <div className="inline-state" role="status"><span className="loader"/>Loading repository overview…</div>;
  if (error) return <div className="explorer-state explorer-error" role="alert">{error}</div>;
  if (graph?.status !== 'ready') return <div className="explorer-state"><h3>Graph is not ready yet</h3><p>Current analysis status: {graph?.status || 'unavailable'}. Finish repository indexing and AST parsing, then reopen this view.</p></div>;
  if (!graph.metadata?.modules?.length) return <div className="explorer-state"><h3>No parsed graph nodes</h3><p>This repository has no indexed file groups in the current snapshot.</p></div>;

  const current = path.at(-1);
  const selected = graph.nodes.find((node) => node.id === selectedId) || graph.metadata.modules.find((module) => module.id === selectedId) || null;
  const inEdges = selected?.filePaths ? graph.metadata.modules.filter((module) => module.dependencies.some((dependency) => dependency.moduleId === selected.id))
    .map((module) => ({ id: `${module.id}:${selected.id}`, source: module.id, target: selected.id, type: 'IMPORTS', certainty: 'high' }))
    : selected ? graph.edges.filter((edge) => edge.target === selected.id) : [];
  const outEdges = selected?.filePaths ? selected.dependencies.map((dependency) => ({ id: `${selected.id}:${dependency.moduleId}`, source: selected.id, target: dependency.moduleId, type: 'IMPORTS', certainty: 'high', evidence: { importCount: dependency.importCount } }))
    : selected ? graph.edges.filter((edge) => edge.source === selected.id) : [];
  const title = !current ? 'Repository modules' : current.level === 'module' ? `${current.name} files` : current.level === 'file' ? `${current.filePath} symbols` : `${current.name} relationships`;

  return <section className="graph-section" aria-label="Code Graph">
    <div className="explorer-panel-heading"><div><span className="section-number">CODE GRAPH · PROGRESSIVE EXPLORATION</span><h2>{title}</h2></div><span className="graph-count">{shownNodes.length} visible nodes · {shownEdges.length} visible edges</span></div>
    {graph.metadata?.isComplete === false && <p className="graph-warning" role="status">This is a partial snapshot ({graph.metadata?.parseStatus || 'analysis incomplete'}{graph.metadata?.truncated ? ', backend response limit reached' : ''}).</p>}
    <div className="graph-toolbar">
      <div className="graph-history"><button type="button" onClick={() => goHistory(historyIndex - 1)} disabled={historyIndex <= 0} aria-label="Back in graph">←</button><button type="button" onClick={() => goHistory(historyIndex + 1)} disabled={historyIndex >= history.length - 1} aria-label="Forward in graph">→</button>
        <button type="button" onClick={() => navigateTo([], null)} disabled={!path.length}>Repository overview</button>
        {path.map((item, index) => <button type="button" key={`${item.id}-${index}`} onClick={() => navigateTo(path.slice(0, index + 1), item.id)}>{item.name}</button>)}
      </div>
      <label className="graph-search"><span className="visually-hidden">Search files and symbols</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search files and symbols…"/>
        {searchResults.length > 0 && <div className="graph-search-results" role="listbox">{searchResults.map((node) => <button type="button" role="option" key={node.id} onClick={() => openSearchResult(node)}><strong>{node.name || node.symbolName || node.type}</strong><small>{node.filePath} · {node.type}</small></button>)}</div>}
      </label>
      <label className="graph-filter">Relationship<select value={relationshipFilter} onChange={(event) => setRelationshipFilter(event.target.value)}>{levelData.filters.map((filter) => <option key={filter} value={filter}>{filter === 'all' ? 'All shown' : filter.toUpperCase()}</option>)}</select></label>
    </div>
    <div className="graph-legend"><span><i className="legend-solid"/>Direct parser-supported relationship</span><span><i className="legend-dashed"/>Inferred or uncertain relationship</span><span className="graph-legend-note">Module groups come from indexed directory paths.</span></div>
    {shownNodes.length ? <div className="graph-canvas graph-canvas-focused"><ReactFlow nodes={shownNodes} edges={shownEdges} nodeTypes={nodeTypes} onNodeClick={selectNode} onPaneClick={() => setSelectedId(null)} fitView fitViewOptions={{ padding: 0.22 }} minZoom={0.12} maxZoom={1.8} nodesConnectable={false} elementsSelectable>
      <Background color="#e7ece7" gap={22}/><Controls/><MiniMap nodeColor={(node) => node.data.nodeType === 'module' ? '#78947d' : node.data.nodeType === 'file' ? '#9eb1a0' : '#c4d1c5'} maskColor="rgba(247,249,246,.7)"/>
    </ReactFlow></div> : <div className="explorer-state">No relationships match this filter at this level.</div>}
    {current?.level === 'module' && <p className="graph-footnote">The view shows this directory group’s files and directly connected import context. Select a file to inspect its parsed symbols.</p>}
    {current?.level === 'file' && <p className="graph-footnote">Symbols are positioned in source-line order. Select a symbol to inspect its supported containment relationships.</p>}
    <aside className="graph-details" aria-live="polite"><span className="section-number">{selected ? 'NODE DETAILS & DIRECT RELATIONSHIPS' : 'SELECT A NODE'}</span>
      {!selected ? <p>Select a module, file, or symbol to see its source metadata and direct relationships.</p> : <><h3>{selected.name || selected.symbolName || selected.type}</h3><dl>
        <div><dt>Type</dt><dd>{selected.filePaths ? 'module group' : selected.type}</dd></div>{selected.path && <div><dt>Directory group</dt><dd>{selected.path}</dd></div>}{selected.filePath && <div><dt>File</dt><dd>{selected.filePath}</dd></div>}{selected.language && <div><dt>Language</dt><dd>{selected.language}</dd></div>}{selected.symbolName && <div><dt>Symbol</dt><dd>{selected.symbolName}</dd></div>}{selected.startLine && <div><dt>Lines</dt><dd>{selected.startLine}–{selected.endLine}</dd></div>}{selected.fileCount != null && <div><dt>Contents</dt><dd>{selected.fileCount} files · {selected.symbolCount} symbols</dd></div>}
      </dl>
      {selected.filePath && <button className="button button-index" onClick={() => onOpenSource({ filePath: selected.filePath, symbolName: selected.symbolName, startLine: selected.startLine, endLine: selected.endLine })}>Open in Code Viewer ↗</button>}
      {selected.filePaths && !path.some((item) => item.id === selected.id) && <button className="button button-index" onClick={() => navigateTo([...path, { level: 'module', id: selected.id, name: selected.name }], selected.id)}>Open module ↗</button>}
      {!!(inEdges.length || outEdges.length) && <div className="graph-relationships"><h4>Direct relationships</h4>{[...inEdges.map((edge) => ({ edge, direction: 'Incoming' })), ...outEdges.map((edge) => ({ edge, direction: 'Outgoing' }))].map(({ edge, direction }) => {
        const relatedId = direction === 'Incoming' ? edge.source : edge.target;
        const related = graph.nodes.find((node) => node.id === relatedId) || graph.metadata.modules.find((module) => module.id === relatedId);
        return <button type="button" key={`${edge.id}-${direction}`} onClick={() => openRelated(relatedId)}><span>{direction} · {edge.type}</span><strong>{related?.name || related?.filePath || relatedId}</strong><small>{edge.certainty || 'unknown'}{edge.isInferred ? ' · inferred' : ' · parser-backed'}</small></button>;
      })}</div>}</>}
    </aside>
    {!!graph.metadata?.unsupportedRelationships?.length && <p className="graph-footnote">Not available from current static analysis: {graph.metadata.unsupportedRelationships.join(', ')}.</p>}
  </section>;
}
