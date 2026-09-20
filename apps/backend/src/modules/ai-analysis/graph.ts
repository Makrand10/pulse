import { StateGraph, START, END, Annotation } from '@langchain/langgraph';
import { fetchRecentFailures, buildContext, type FailureRow, type AnalysisContext } from './context';
import { renderRootCausePrompt } from './prompt';
import { getClaudeClient, type ClaudeAnalysis } from './claude';
import { persistIncidentAnalysis } from '../incidents/repository';

// Single-attempt sequential analysis on the 4 PRD nodes. Callers (the queue
// worker) own retry/failure bookkeeping so the parent incident flow is never
// affected by AI infra problems.
const State = Annotation.Root({
  teamId: Annotation<string>,
  apiId: Annotation<string>,
  incidentId: Annotation<string>,
  failures: Annotation<FailureRow[]>,
  context: Annotation<AnalysisContext | null>,
  analysis: Annotation<ClaudeAnalysis | null>,
  needsClaude: Annotation<boolean>,
});

const NODE_FETCH = 'fetchRecentFailures';
const NODE_BUILD = 'buildContext';
const NODE_CALL = 'callClaude';
const NODE_PERSIST = 'parseAndPersist';
const NODE_PERSIST_NULL = 'persistNull';

async function fetchNode(state: typeof State.State): Promise<Partial<typeof State.State>> {
  const failures = await fetchRecentFailures(state.teamId, state.apiId, 20);
  return { failures, needsClaude: failures.length > 0 };
}

async function buildNode(state: typeof State.State): Promise<Partial<typeof State.State>> {
  return { context: buildContext(state.failures) };
}

async function callNode(state: typeof State.State): Promise<Partial<typeof State.State>> {
  const prompt = renderRootCausePrompt({
    failureHistory: state.context!.failureHistoryText,
    statusCodeHistogram: state.context!.statusCodeHistogramText,
    deployCorrelation: state.context!.deployCorrelationText,
  });
  const analysis = await getClaudeClient().analyze({ prompt });
  return { analysis };
}

async function persistNode(state: typeof State.State): Promise<Partial<typeof State.State>> {
  const analysis = state.analysis!;
  await persistIncidentAnalysis(state.teamId, state.incidentId, {
    aiSummary: analysis.summary,
    aiSuggestedCause: analysis.suggestedCause,
  });
  return {};
}

async function persistNullNode(state: typeof State.State): Promise<Partial<typeof State.State>> {
  await persistIncidentAnalysis(state.teamId, state.incidentId, {
    aiSummary: null,
    aiSuggestedCause: null,
  });
  return {};
}

// No failure history → never call Claude (FR-7 AC): short-circuits the graph.
function shouldCallClaude(state: typeof State.State): string {
  return state.needsClaude ? NODE_BUILD : NODE_PERSIST_NULL;
}

export const analysisGraph = new StateGraph(State)
  .addNode(NODE_FETCH, fetchNode)
  .addNode(NODE_BUILD, buildNode)
  .addNode(NODE_CALL, callNode)
  .addNode(NODE_PERSIST, persistNode)
  .addNode(NODE_PERSIST_NULL, persistNullNode)
  .addEdge(START, NODE_FETCH)
  .addConditionalEdges(NODE_FETCH, shouldCallClaude)
  .addEdge(NODE_BUILD, NODE_CALL)
  .addEdge(NODE_CALL, NODE_PERSIST)
  .addEdge(NODE_PERSIST, END)
  .addEdge(NODE_PERSIST_NULL, END)
  .compile();

export interface RunAnalysisInput {
  teamId: string;
  apiId: string;
  incidentId: string;
}

export async function runAnalysis(input: RunAnalysisInput): Promise<void> {
  await analysisGraph.invoke({ ...input, failures: [], needsClaude: false, context: null, analysis: null });
}