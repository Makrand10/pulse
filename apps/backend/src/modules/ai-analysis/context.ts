import { CheckResult } from '../../db/models/CheckResult';

export interface FailureRow {
  checkedAt: Date;
  statusCode: number | null;
  latencyMs: number;
  errorMessage: string | null;
}

export interface AnalysisContext {
  failures: FailureRow[];
  failureHistoryText: string;
  statusCodeHistogramText: string;
  deployCorrelationText: string;
}

// Last K failed checks (status DOWN), most recent first. Empty result is the
// short-circuit signal for the graph: never call Claude without ground truth.
export async function fetchRecentFailures(
  teamId: string,
  apiId: string,
  limit = 20,
): Promise<FailureRow[]> {
  const docs = await CheckResult.find(
    { teamId, apiId, status: 'DOWN' },
    { statusCode: 1, latencyMs: 1, errorMessage: 1, checkedAt: 1, _id: 0 },
  )
    .sort({ checkedAt: -1 })
    .limit(limit)
    .lean();
  return docs.map((d) => ({
    checkedAt: d.checkedAt,
    statusCode: (d.statusCode as number | null) ?? null,
    latencyMs: d.latencyMs,
    errorMessage: (d.errorMessage as string | null) ?? null,
  }));
}

export function buildContext(failures: FailureRow[]): AnalysisContext {
  const failureHistoryText = failures
    .map((f, i) => {
      const at = f.checkedAt.toISOString();
      const code = f.statusCode ?? 'n/a';
      const err = f.errorMessage ? ` error="${f.errorMessage}"` : '';
      return `#${failures.length - i} ${at} status=${code} latencyMs=${f.latencyMs}${err}`;
    })
    .join('\n');

  const histogram = new Map<number, number>();
  for (const f of failures) {
    if (f.statusCode !== null) histogram.set(f.statusCode, (histogram.get(f.statusCode) ?? 0) + 1);
  }
  const statusCodeHistogramText =
    histogram.size === 0
      ? 'none recorded'
      : [...histogram.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([code, count]) => `${code}: ${count}`)
          .join('\n');

  // No deploy-correlation source in v1 (no deployment events collected yet);
  // the prompt's grounding rule covers both the with/without cases.
  const deployCorrelationText = '';

  return { failures, failureHistoryText, statusCodeHistogramText, deployCorrelationText };
}