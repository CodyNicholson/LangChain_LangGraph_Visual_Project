// Shapes returned by the FastAPI backend (see backend/app/core.py).

export type Library = 'langchain' | 'langgraph';

export interface GraphNode { id: string; label: string; kind?: string | null }
export interface GraphEdge { source: string; target: string; conditional: boolean; label?: string | null }
export interface GraphData { nodes: GraphNode[]; edges: GraphEdge[]; mermaid: string }

export interface DemoSummary {
  id: string;
  library: Library;
  title: string;
  stateful: boolean;
  source: string;
  graph: GraphData | null;
}

export interface TraceRun {
  id: string;
  parent: string | null;
  kind: 'llm' | 'tool' | 'retriever' | 'chain' | 'prompt' | 'parser';
  name: string;
  node: string | null;
  input: unknown;
  output?: unknown;
  error?: string;
  startMs: number;
  endMs?: number;
  durationMs?: number;
}

export interface TimelineEvent { t: number; label: string; node: string | null; data: any }
export interface Check { label: string; ok: boolean; detail: unknown }

export interface DemoResult {
  id: string;
  mode: 'mock' | 'live';
  model: string;
  output: any;
  graph: GraphData | null;
  trace: TraceRun[];
  events: TimelineEvent[];
  checks: Check[];
  notes: string[];
  error: string | null;
  elapsedMs: number;
}

export interface AppConfig {
  liveAvailable: boolean;
  model: string;
  langsmith: boolean;
  limits: { perMinute: number; perHour: number };
  versions: Record<string, string | null>;
}

export interface DemoInput {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'select';
  default: string | number;
  options?: (string | number)[];
  min?: number;
  max?: number;
}

export interface DemoAction {
  label: string;
  inputs?: Record<string, unknown>;
  tone?: 'primary' | 'ghost' | 'danger';
}

export interface DemoInfo {
  id: string;
  library: Library;
  category: string;
  title: string;
  tagline: string;
  description: string[];
  keyApis: string[];
  useCases: string[];
  inputs: DemoInput[];
  actions?: DemoAction[];
  stream?: boolean;
}
