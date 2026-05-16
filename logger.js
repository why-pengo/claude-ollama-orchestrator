// logger.js — minimal append-only log writer with no stats-db dependency.
// Lets the UserPromptSubmit hook log without pulling in better-sqlite3.

import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const LOG_FILE = process.env.LOG_FILE_PATH || join(__dirname, 'orchestrator.log');

function buildLine(tag, message) {
  return `[${new Date().toISOString()}] [${tag}] ${message}`;
}

export function logEntry(tag, message) {
  const line = buildLine(tag, message);
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

// File-only variant for the UserPromptSubmit hook: Claude Code injects hook
// stdout into the next message as additionalContext, so a stdout log line
// would show up as raw debug text in the model's view. logToFile keeps the
// audit trail without polluting the prompt context.
export function logToFile(tag, message) {
  fs.appendFileSync(LOG_FILE, buildLine(tag, message) + '\n');
}
