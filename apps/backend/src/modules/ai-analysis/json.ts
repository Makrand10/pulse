import type { ClaudeAnalysis } from './claude';

// Shared JSON parsing for provider responses. Lives in its own module so both
// provider clients (Claude, Groq) can use it without a runtime import cycle.

function extractJson(text: string): string | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    const sub = candidate.slice(start, end + 1);
    try {
      JSON.parse(sub);
      return sub;
    } catch {
      return null;
    }
  }
}

export function parseJsonOutput(text: string): ClaudeAnalysis {
  const cleaned = extractJson(text);
  if (!cleaned) {
    throw new Error(`AI response was not valid JSON: ${text.slice(0, 200)}`);
  }
  const data = JSON.parse(cleaned);
  if (typeof data.summary !== 'string') {
    throw new Error('AI response missing "summary"');
  }
  return {
    summary: data.summary,
    suggestedCause: typeof data.suggestedCause === 'string' ? data.suggestedCause : null,
    nextDebugStep: typeof data.nextDebugStep === 'string' ? data.nextDebugStep : '',
  };
}