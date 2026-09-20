import { config } from '../../config';
import { parseJsonOutput } from './json';
import type { ClaudeAnalysis, ClaudeAnalyzeInput, ClaudeClient } from './claude';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
// gpt-oss-120b is available on Groq's current free tier; llama-3.3-70b-versatile
// has been dropped and returns model_not_found. Kept fallback-only: set AI_MODEL
// to pin the model for your account.
const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';

// Groq (Llama) free-tier implementation of ClaudeClient so incident analysis
// runs for $0. Same contract as AnthropicClaudeClient: timeout via AbortController,
// JSON parse via the shared parser, and it throws on missing key so the queue
// worker persists aiSummary=null instead of breaking incident creation.
class GroqClient implements ClaudeClient {
  async analyze(input: ClaudeAnalyzeInput): Promise<ClaudeAnalysis> {
    if (!config.groqApiKey) {
      throw new Error('GROQ_API_KEY is not configured');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.aiTimeoutMs);

    try {
      const res = await fetch(GROQ_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.groqApiKey}`,
        },
        body: JSON.stringify({
          model: config.aiModel || DEFAULT_GROQ_MODEL,
          messages: [{ role: 'user', content: input.prompt }],
          max_tokens: config.aiMaxTokens,
          temperature: 0.2,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 200);
        throw new Error(`Groq API ${res.status}: ${detail}`);
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const text = data.choices?.[0]?.message?.content ?? '';
      if (!text) {
        throw new Error('Groq API returned an empty response');
      }
      return parseJsonOutput(text);
    } finally {
      clearTimeout(timer);
    }
  }
}

export { GroqClient };