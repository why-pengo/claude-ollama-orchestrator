// classifier.js — pure prompt classifier with no Ollama, stats, or SQLite dependency.
// Kept separate from ollama-router.js so the UserPromptSubmit hook can use it without
// paying the cost of initialising better-sqlite3 on every prompt.

const _rawLimit = Number(process.env.OLLAMA_SIMPLE_SIZE_LIMIT);
export const SIMPLE_SIZE_LIMIT = Number.isFinite(_rawLimit) && _rawLimit > 0 ? _rawLimit : 20_000;

const SIMPLE_KEYWORDS = [
  'format',
  'extract',
  'convert',
  'parse',
  'organise',
  'organize',
  'list',
  'template',
  'rename',
  'sort',
];
const MEDIUM_KEYWORDS = ['explain', 'reason'];
const COMPLEX_KEYWORDS = [
  'architect',
  'security',
  'tradeoff',
  'plan',
  'clean',
  'debug',
  'refactor',
  'design',
  'implement',
  'optimise',
  'optimize',
];

export function classifyPrompt(prompt) {
  // Hook payloads come from external input — coerce defensively so a non-string
  // prompt (null/number/object) doesn't crash the hook.
  if (typeof prompt !== 'string') prompt = String(prompt ?? '');

  const lower = prompt.toLowerCase();
  const complexMatch = COMPLEX_KEYWORDS.find((kw) => lower.includes(kw));
  if (complexMatch) {
    return { complexity: 'complex', reason: `matched keyword "${complexMatch}" (complex list)` };
  }
  const mediumMatch = MEDIUM_KEYWORDS.find((kw) => lower.includes(kw));
  if (mediumMatch) {
    return { complexity: 'medium', reason: `matched keyword "${mediumMatch}" (medium list)` };
  }
  const simpleMatch = SIMPLE_KEYWORDS.find((kw) => lower.includes(kw));
  if (simpleMatch) {
    if (prompt.length > SIMPLE_SIZE_LIMIT) {
      return {
        complexity: 'medium',
        reason: `matched keyword "${simpleMatch}" (simple list) but prompt length ${prompt.length} > ${SIMPLE_SIZE_LIMIT} chars — escalated to tier 2`,
      };
    }
    return { complexity: 'simple', reason: `matched keyword "${simpleMatch}" (simple list)` };
  }
  if (prompt.length > 500) {
    return {
      complexity: 'complex',
      reason: `prompt length ${prompt.length} > 500 chars (length fallback)`,
    };
  }
  return { complexity: 'simple', reason: `no keywords matched, length ≤ 500 (length fallback)` };
}
