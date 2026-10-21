// Layered top-to-bottom layout for the graphs LangChain/LangGraph report (get_graph()), plus the
// mapping from a run's trace to the sequence of nodes the animation visits.

import { GraphData, GraphEdge, GraphNode, TimelineEvent, TraceRun } from '../models';

export interface LaidNode extends GraphNode {
  x: number; // centre
  y: number; // centre
  w: number;
  h: number;
  layer: number;
  terminal: boolean;
  display: string;
  role: 'llm' | 'tool' | 'retriever' | 'parser' | 'prompt' | 'io' | 'node';
}

export interface LaidEdge extends GraphEdge {
  path: string;
  back: boolean;
  labelX: number;
  labelY: number;
}

export interface Layout {
  nodes: LaidNode[];
  edges: LaidEdge[];
  width: number;
  height: number;
  byId: Map<string, LaidNode>;
}

export interface AnimStep {
  nodeId: string;
  captions: string[];
  kind: string;
}

const NODE_H = 36;
const TERMINAL_H = 26;
const LAYER_GAP = 50;
const NODE_GAP = 22;
const MARGIN = 18;

export function isTerminal(node: GraphNode): boolean {
  return node.id === '__start__' || node.id === '__end__';
}

export function roleOf(node: GraphNode): LaidNode['role'] {
  const label = node.label;
  if (node.kind) return node.kind as LaidNode['role'];
  if (/Input$|Output$/.test(label) || isTerminal(node)) return 'io';
  if (/Parser/.test(label)) return 'parser';
  if (/Prompt/.test(label)) return 'prompt';
  if (/Retriever/.test(label)) return 'retriever';
  if (/^tools?$|ToolNode/i.test(label)) return 'tool';
  if (/^Chat|ChatModel|LLM|^model$/i.test(label)) return 'llm';
  return 'node';
}

function displayLabel(node: GraphNode): string {
  if (node.id === '__start__') return 'START';
  if (node.id === '__end__') return 'END';
  return node.label.length > 34 ? node.label.slice(0, 32) + '…' : node.label;
}

function bezierPoint(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

export function layoutGraph(graph: GraphData): Layout {
  const ids = graph.nodes.map((n) => n.id);
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const e of graph.edges) {
    if (!out.has(e.source) || !out.has(e.target)) continue;
    out.get(e.source)!.push(e.target);
    if (e.source !== e.target) indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  }

  // DFS from the entry points to find back edges (the ones that make cycles).
  const starts: string[] = ids.filter((id) => id === '__start__');
  if (!starts.length) starts.push(...ids.filter((id) => indeg.get(id) === 0));
  if (!starts.length && ids.length) starts.push(ids[0]);
  const back = new Set<string>();
  const state = new Map<string, 0 | 1 | 2>();
  const order: string[] = [];
  const visit = (id: string) => {
    state.set(id, 1);
    order.push(id);
    for (const next of out.get(id) ?? []) {
      const s = state.get(next) ?? 0;
      if (s === 1) back.add(`${id}>${next}`);
      else if (s === 0) visit(next);
    }
    state.set(id, 2);
  };
  for (const s of starts) if (!state.get(s)) visit(s);
  for (const id of ids) if (!state.get(id)) visit(id);

  // Longest-path layering over forward edges.
  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  const fwdIndeg = new Map<string, number>(ids.map((id) => [id, 0]));
  const isFwd = (e: GraphEdge) => e.source !== e.target && !back.has(`${e.source}>${e.target}`) && out.has(e.source) && out.has(e.target);
  for (const e of graph.edges) if (isFwd(e)) fwdIndeg.set(e.target, fwdIndeg.get(e.target)! + 1);
  const queue = order.filter((id) => fwdIndeg.get(id) === 0);
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of graph.edges) {
      if (e.source !== id || !isFwd(e)) continue;
      layer.set(e.target, Math.max(layer.get(e.target)!, layer.get(id)! + 1));
      fwdIndeg.set(e.target, fwdIndeg.get(e.target)! - 1);
      if (fwdIndeg.get(e.target) === 0) queue.push(e.target);
    }
  }
  if (layer.has('__end__')) {
    const maxOther = Math.max(0, ...ids.filter((id) => id !== '__end__').map((id) => layer.get(id)!));
    layer.set('__end__', maxOther + 1);
  }

  // Group into layers, then one barycentre pass to reduce crossings.
  const layerCount = Math.max(0, ...layer.values()) + 1;
  const layers: string[][] = Array.from({ length: layerCount }, () => []);
  for (const id of order) layers[layer.get(id)!].push(id);
  const pos = new Map<string, number>();
  layers.forEach((l) => l.forEach((id, i) => pos.set(id, i)));
  for (let li = 1; li < layers.length; li++) {
    const bary = (id: string) => {
      const preds = graph.edges.filter((e) => e.target === id && isFwd(e) && layer.get(e.source)! < li).map((e) => pos.get(e.source)!);
      return preds.length ? preds.reduce((a, b) => a + b, 0) / preds.length : pos.get(id)!;
    };
    layers[li].sort((a, b) => bary(a) - bary(b));
    layers[li].forEach((id, i) => pos.set(id, i));
  }

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const sizes = new Map<string, { w: number; h: number }>();
  for (const n of graph.nodes) {
    const terminal = isTerminal(n);
    const text = displayLabel(n);
    sizes.set(n.id, terminal ? { w: 74, h: TERMINAL_H } : { w: Math.min(230, Math.max(92, text.length * 7.1 + 34)), h: NODE_H });
  }
  const layerWidth = (l: string[]) => l.reduce((acc, id) => acc + sizes.get(id)!.w, 0) + NODE_GAP * Math.max(0, l.length - 1);
  const backEdges = graph.edges.filter((e) => back.has(`${e.source}>${e.target}`) || e.source === e.target);
  const rail = backEdges.length ? 34 + 12 * Math.min(backEdges.length, 4) : 0;
  const contentW = Math.max(300, ...layers.map(layerWidth));
  const width = contentW + MARGIN * 2 + rail;

  const nodes: LaidNode[] = [];
  let y = MARGIN;
  for (let li = 0; li < layers.length; li++) {
    const l = layers[li];
    const rowH = Math.max(TERMINAL_H, ...l.map((id) => sizes.get(id)!.h));
    let x = MARGIN + (contentW - layerWidth(l)) / 2;
    for (const id of l) {
      const n = nodeById.get(id)!;
      const { w, h } = sizes.get(id)!;
      nodes.push({ ...n, x: x + w / 2, y: y + rowH / 2, w, h, layer: li, terminal: isTerminal(n), display: displayLabel(n), role: roleOf(n) });
      x += w + NODE_GAP;
    }
    y += rowH + LAYER_GAP;
  }
  const height = y - LAYER_GAP + MARGIN;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  let railIndex = 0;
  const edges: LaidEdge[] = [];
  for (const e of graph.edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) continue;
    const isBack = back.has(`${e.source}>${e.target}`) || e.source === e.target;
    let path: string;
    let labelX: number;
    let labelY: number;
    if (isBack) {
      const rx = MARGIN + contentW + 18 + 12 * (railIndex++ % 4);
      const x1 = s.x + s.w / 2;
      const x2 = t.x + t.w / 2;
      path = `M ${x1} ${s.y} C ${rx} ${s.y}, ${rx} ${t.y}, ${x2 + 4} ${t.y}`;
      labelX = rx - 6;
      labelY = (s.y + t.y) / 2;
    } else {
      const x1 = s.x;
      const y1 = s.y + s.h / 2;
      const x2 = t.x;
      const y2 = t.y - t.h / 2 - 3;
      const dy = Math.max(24, (y2 - y1) / 2);
      path = `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
      labelX = bezierPoint(x1, x1, x2, x2, 0.5);
      labelY = bezierPoint(y1, y1 + dy, y2 - dy, y2, 0.5);
    }
    edges.push({ ...e, path, back: isBack, labelX, labelY });
  }
  return { nodes, edges, width, height, byId };
}

/** The order in which nodes light up: entry, every traced run mapped onto a node, exit. */
export function buildSteps(graph: GraphData | null, trace: TraceRun[] = [], events: TimelineEvent[] = []): AnimStep[] {
  if (!graph?.nodes.length) return [];
  const ids = new Set(graph.nodes.map((n) => n.id));
  const byLabel = new Map<string, string>();
  const byKind = new Map<string, string>();
  for (const n of graph.nodes) {
    if (!byLabel.has(n.label)) byLabel.set(n.label, n.id);
    if (n.kind && !byKind.has(n.kind)) byKind.set(n.kind, n.id);
  }
  const indeg = new Map(graph.nodes.map((n) => [n.id, 0]));
  const outdeg = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const e of graph.edges) {
    if (e.source === e.target) continue;
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    outdeg.set(e.source, (outdeg.get(e.source) ?? 0) + 1);
  }
  const start = ids.has('__start__') ? '__start__' : graph.nodes.find((n) => indeg.get(n.id) === 0)?.id;
  const ends = ids.has('__end__') ? ['__end__'] : graph.nodes.filter((n) => outdeg.get(n.id) === 0).map((n) => n.id);

  const steps: AnimStep[] = [];
  const push = (nodeId: string, caption: string, kind: string) => {
    const last = steps[steps.length - 1];
    if (last && last.nodeId === nodeId) {
      if (caption && !last.captions.includes(caption)) last.captions.push(caption);
      return;
    }
    steps.push({ nodeId, captions: caption ? [caption] : [], kind });
  };
  if (start) push(start, 'input', 'io');

  const runs = [...trace].sort((a, b) => a.startMs - b.startMs);
  for (const run of runs) {
    const id = (run.node && ids.has(run.node) ? run.node : null) ?? byLabel.get(run.name) ?? byKind.get(run.kind) ?? null;
    if (!id) continue;
    const label = run.kind === 'chain' ? run.name : `${run.name} (${run.kind})`;
    const timing = run.durationMs != null ? ` · ${run.durationMs} ms` : '';
    push(id, run.error ? `${label} ✗ ${run.error}` : `${label}${timing}`, run.kind);
  }
  if (steps.length <= 1 && !runs.length) {
    // Nothing traced (pure-Python demo): walk the drawn nodes in layout order instead.
    for (const n of layoutGraph(graph).nodes) push(n.id, '', 'node');
  }
  // Graphs that stopped at an interrupt never reach END.
  const interrupted = events.some((e) => e.label === '__interrupt__');
  if (ends.length === 1 && !interrupted) push(ends[0], 'output', 'io');
  return steps;
}
