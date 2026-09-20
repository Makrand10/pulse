import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config';
import { logger } from '../../lib/logger';
import { parseJsonOutput } from './json';
import { GroqClient } from './groq';

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

const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-20250514';

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
          model: config.aiModel || DEFAULT_CLAUDE_MODEL,
          max_tokens: config.aiMaxTokens,
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

export { AnthropicClaudeClient };

let active: ClaudeClient = defaultClient();

// Provider selected once at startup: AI_PROVIDER=groq (free, default) or claude.
function defaultClient(): ClaudeClient {
  if (config.aiProvider === 'claude') {
    return new AnthropicClaudeClient();
  }
  return new GroqClient();
}
// Swappable injection seam for tests (mock provider / mock timeout).
export function setClaudeClient(client: ClaudeClient): ClaudeClient {
  const previous = active;
  active = client;
  return previous;
}

export function getClaudeClient(): ClaudeClient {
  return active;
}

export { logger };