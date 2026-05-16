// logger.js — minimal append-only log writer with no stats-db dependency.
// Lets the UserPromptSubmit hook log without pulling in better-sqlite3.

import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const LOG_FILE = process.env.LOG_FILE_PATH || join(__dirname, 'orchestrator.log');

export function logEntry(tag, message) {
  const line = `[${new Date().toISOString()}] [${tag}] ${message}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}
