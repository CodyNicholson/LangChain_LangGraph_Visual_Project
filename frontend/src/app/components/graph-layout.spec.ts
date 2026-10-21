import { GraphData, TraceRun } from '../models';
import { buildSteps, layoutGraph } from './graph-layout';

const agentGraph: GraphData = {
  nodes: [{ id: '__start__', label: '__start__' }, { id: 'agent', label: 'agent' }, { id: 'tools', label: 'tools' }, { id: '__end__', label: '__end__' }],
  edges: [
    { source: '__start__', target: 'agent', conditional: false },
    { source: 'agent', target: 'tools', conditional: true },
    { source: 'agent', target: '__end__', conditional: true },
    { source: 'tools', target: 'agent', conditional: false },
  ],
  mermaid: '',
};

const run = (name: string, node: string | null, kind: TraceRun['kind'], startMs: number): TraceRun =>
  ({ id: `${name}${startMs}`, parent: null, kind, name, node, input: null, startMs, endMs: startMs + 5, durationMs: 5 });

describe('layoutGraph', () => {
  it('layers nodes top to bottom and detects the cycle as a back edge', () => {
    const l = layoutGraph(agentGraph);
    const layer = (id: string) => l.byId.get(id)!.layer;
    expect(layer('__start__')).toBe(0);
    expect(layer('agent')).toBe(1);
    expect(layer('tools')).toBe(2);
    expect(layer('__end__')).toBe(3);
    const back = l.edges.filter((e) => e.back).map((e) => `${e.source}>${e.target}`);
    expect(back).toEqual(['tools>agent']);
    expect(l.nodes.every((n) => n.x - n.w / 2 >= 0 && n.x + n.w / 2 <= l.width)).toBe(true);
  });

  it('lays out a graph without __start__ from its roots', () => {
    const g: GraphData = { nodes: [{ id: 'a', label: 'PromptInput' }, { id: 'b', label: 'ChatPromptTemplate' }], edges: [{ source: 'a', target: 'b', conditional: false }], mermaid: '' };
    const l = layoutGraph(g);
    expect(l.byId.get('a')!.layer).toBe(0);
    expect(l.byId.get('b')!.role).toBe('prompt');
  });
});

describe('buildSteps', () => {
  it('maps LangGraph runs onto nodes, merging a node with the model call inside it', () => {
    const trace = [run('agent', 'agent', 'chain', 0), run('ChatAnthropic', 'agent', 'llm', 1), run('tools', 'tools', 'chain', 10),
      run('get_weather', 'tools', 'tool', 11), run('agent', 'agent', 'chain', 20)];
    const steps = buildSteps(agentGraph, trace);
    expect(steps.map((s) => s.nodeId)).toEqual(['__start__', 'agent', 'tools', 'agent', '__end__']);
    expect(steps[1].captions.some((c) => c.includes('ChatAnthropic (llm)'))).toBe(true);
  });

  it('matches LCEL runs by label and manual graphs by kind', () => {
    const g: GraphData = {
      nodes: [{ id: 'q', label: 'question' }, { id: 'm', label: 'model.bind_tools()', kind: 'llm' }, { id: 't', label: 'tools', kind: 'tool' }, { id: 'a', label: 'answer' }],
      edges: [{ source: 'q', target: 'm', conditional: false }, { source: 'm', target: 't', conditional: true }, { source: 't', target: 'm', conditional: false }, { source: 'm', target: 'a', conditional: true }],
      mermaid: '',
    };
    const steps = buildSteps(g, [run('Scripted', null, 'llm', 0), run('calculator', null, 'tool', 5), run('Scripted', null, 'llm', 9)]);
    expect(steps.map((s) => s.nodeId)).toEqual(['q', 'm', 't', 'm', 'a']);
  });

  it('does not reach END when the graph was interrupted', () => {
    const steps = buildSteps(agentGraph, [run('agent', 'agent', 'chain', 0)], [{ t: 1, label: '__interrupt__', node: '__interrupt__', data: {} }]);
    expect(steps.at(-1)!.nodeId).toBe('agent');
  });
});
