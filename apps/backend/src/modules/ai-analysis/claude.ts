import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config';
import { logger } from '../../lib/logger';

export interface ClaudeAnalysis {
  summary: string;
  suggestedCause: string | null;
  nextDebugStep: string;
}

export interface ClaudeAnalyzeInput {
  prompt: string;
}

export interface ClaudeClient {
  analyze(input: ClaudeAnalyzeInput): Promise<ClaudeAnalysis>;
}

// Anthropic-backed implementation behind an interface so tests inject a mock.
class AnthropicClaudeClient implements ClaudeClient {
  async analyze(input: ClaudeAnalyzeInput): Promise<ClaudeAnalysis> {
    if (!config.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }
    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.aiTimeoutMs);

    try {
      const message = await client.messages.create(
        {
          model: config.aiModel,
          max_tokens: 500,
          messages: [{ role: 'user', content: input.prompt }],
        },
        { signal: controller.signal },
      );
      const text = message.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text?: string }).text ?? '')
        .join('\n');
      return parseJsonOutput(text);
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseJsonOutput(text: string): ClaudeAnalysis {
  const cleaned = extractJson(text);
  if (!cleaned) {
    throw new Error(`Claude response was not valid JSON: ${text.slice(0, 200)}`);
  }
  const data = JSON.parse(cleaned);
  if (typeof data.summary !== 'string') {
    throw new Error('Claude response missing "summary"');
  }
  return {
    summary: data.summary,
    suggestedCause: typeof data.suggestedCause === 'string' ? data.suggestedCause : null,
    nextDebugStep: typeof data.nextDebugStep === 'string' ? data.nextDebugStep : '',
  };
}

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

let active: ClaudeClient = new AnthropicClaudeClient();

// Swappable for tests (mock Claude / mock timeout).
export function setClaudeClient(client: ClaudeClient): ClaudeClient {
  const previous = active;
  active = client;
  return previous;
}

export function getClaudeClient(): ClaudeClient {
  return active;
}

export { logger };