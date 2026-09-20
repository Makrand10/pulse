import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const PROMPT_RELATIVE = join('prompts', 'root-cause-v1.md');

// Root-cause-v1.md is versioned in the repo; locate it relative to this file
// walking up to the monorepo root (works in dev and after tsc build).
let cached: string | null = null;

export function loadRootCausePrompt(): string {
  if (cached) return cached;
  let dir = dirname(__filename);
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, PROMPT_RELATIVE);
    try {
      cached = readFileSync(candidate, 'utf8');
      return cached;
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error(`Could not locate ${PROMPT_RELATIVE} relative to the backend source`);
}

export interface RootCauseTemplate {
  failureHistory: string;
  statusCodeHistogram: string;
  deployCorrelation: string; // may be '' when no correlation data exists
}

// Escape braces in observed data so ground-truthed rows are never interpreted
// as template syntax, using inert readable markers.
function escapeBraces(s: string): string {
  return s.replace(/\{\{/g, '[[').replace(/\}\}/g, ']]');
}

export function renderRootCausePrompt(template: RootCauseTemplate): string {
  const deploySection = template.deployCorrelation
    ? `Deploy-correlation data:\n\n${template.deployCorrelation}`
    : 'Deploy-correlation data: none available.';

  return loadRootCausePrompt()
    .replace('{{failureHistory}}', escapeBraces(template.failureHistory))
    .replace('{{statusCodeHistogram}}', escapeBraces(template.statusCodeHistogram))
    .replace('{{deployCorrelation}}', escapeBraces(deploySection));
}