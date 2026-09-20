import { describe, it, expect } from 'vitest';
import { loadRootCausePrompt, renderRootCausePrompt } from '../../src/modules/ai-analysis/prompt';

describe('root-cause prompt (v1)', () => {
  it('loads the versioned file from prompts/root-cause-v1.md', () => {
    const prompt = loadRootCausePrompt();
    expect(prompt).toContain('# Root-Cause Analysis Prompt (v1)');
    expect(prompt).toContain('{{failureHistory}}');
    expect(prompt).toContain('{{statusCodeHistogram}}');
    expect(prompt).toContain('{{deployCorrelation}}');
  });

  it('substitutes grounded failure rows and the no-correlation marker', () => {
    const rendered = renderRootCausePrompt({
      failureHistory: '2026-01-01T00:00:00Z status=503 latencyMs=4000 error="timeout"',
      statusCodeHistogram: '503: 6\n500: 1',
      deployCorrelation: '',
    });
    expect(rendered).toContain('status=503 latencyMs=4000');
    expect(rendered).toContain('503: 6');
    expect(rendered).toContain('Deploy-correlation data: none available.');
    expect(rendered).not.toContain('{{failureHistory}}');
    expect(rendered).toContain('Insufficient data');
  });

  it('does not treat observed data braces as template syntax', () => {
    const rendered = renderRootCausePrompt({
      failureHistory: 'check body contained {{secret}} literal',
      statusCodeHistogram: '200: 1',
      deployCorrelation: '',
    });
    expect(rendered).not.toContain('{{failureHistory}}');
    expect(rendered).toContain('[[secret]] literal');
  });
});