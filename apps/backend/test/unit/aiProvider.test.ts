import { describe, it, expect, afterEach } from 'vitest';
import { getClaudeClient } from '../../src/modules/ai-analysis/claude';
import { GroqClient } from '../../src/modules/ai-analysis/groq';
import { config } from '../../src/config';

const realFetch = globalThis.fetch;

function setFakeFetch(status: number, body: string) {
  globalThis.fetch = async () => new Response(body, { status }) as Response;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  (config as unknown as { groqApiKey: string }).groqApiKey = '';
});

describe('AI provider selection (free by default)', () => {
  it('defaults to the Groq client so incident analysis runs on the free tier', () => {
    expect(getClaudeClient()).toBeInstanceOf(GroqClient);
  });
});

describe('GroqClient (Groq chat-completions)', () => {
  it('parses a chat-completions response into ClaudeAnalysis', async () => {
    (config as unknown as { groqApiKey: string }).groqApiKey = 'test-key';
    setFakeFetch(
      200,
      JSON.stringify({
        choices: [{ message: { content: '{"summary":"Rate limits","suggestedCause":"Throttling","nextDebugStep":"Check quota"}' } }],
      }),
    );

    const result = await new GroqClient().analyze({ prompt: 'analyze this' });
    expect(result.summary).toBe('Rate limits');
    expect(result.suggestedCause).toBe('Throttling');
    expect(result.nextDebugStep).toBe('Check quota');
  });

  it('strips code fences around the JSON payload', async () => {
    (config as unknown as { groqApiKey: string }).groqApiKey = 'test-key';
    setFakeFetch(
      200,
      JSON.stringify({
        choices: [{ message: { content: '```json\n{"summary":"Ok","suggestedCause":null,"nextDebugStep":""}\n```' } }],
      }),
    );

    const result = await new GroqClient().analyze({ prompt: 'x' });
    expect(result.summary).toBe('Ok');
  });

  it('throws a descriptive error on API failure (429/5xx) so the queue persists null', async () => {
    (config as unknown as { groqApiKey: string }).groqApiKey = 'test-key';
    setFakeFetch(429, '{"error":{"message":"rate limited"}}');

    await expect(new GroqClient().analyze({ prompt: 'x' })).rejects.toThrow(/Groq API 429/);
  });

  it('throws when GROQ_API_KEY is missing', async () => {
    await expect(new GroqClient().analyze({ prompt: 'x' })).rejects.toThrow('GROQ_API_KEY is not configured');
  });
});