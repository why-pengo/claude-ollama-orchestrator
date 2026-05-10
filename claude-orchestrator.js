// claude-orchestrator.js

import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import TaskRouter from './ollama-router.js';
import { resetDb } from './stats-db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_FILE = join(__dirname, 'orchestrator.log');

class ClaudeOrchestrator {
  constructor(skills = {}, rules = {}) {
    this.router = new TaskRouter();
    this.skills = skills;
    this.rules = rules;
    this.history = [];
  }

  applySkills(prompt) {
    let out = prompt;
    const applied = [];
    for (const [keyword, skillPrompt] of Object.entries(this.skills)) {
      if (prompt.toLowerCase().includes(keyword)) {
        out = `${skillPrompt}\n\nRequest: ${out}`;
        applied.push(keyword);
      }
    }
    if (applied.length) {
      const line = `[${new Date().toISOString()}] [SKILLS] Applied: ${applied.join(', ')}`;
      console.log(line);
      fs.appendFileSync(LOG_FILE, line + '\n');
    }
    return out;
  }

  enforceRules(prompt) {
    const constraints = Object.values(this.rules).join('\n');
    return constraints ? `${prompt}\n\n--- Rules ---\n${constraints}` : prompt;
  }

  // Pure computation — same enrichment as process() but with no logging or stats side effects.
  // Use this in --dry-run so routing assessment matches what a real run would route on.
  computeRoutingPrompt(userRequest) {
    let out = userRequest;
    for (const [keyword, skillPrompt] of Object.entries(this.skills)) {
      if (userRequest.toLowerCase().includes(keyword)) {
        out = `${skillPrompt}\n\nRequest: ${out}`;
      }
    }
    return this.enforceRules(out);
  }

  async process(userRequest, forceComplexity = null) {
    const line = `[${new Date().toISOString()}] [REQUEST] ${userRequest.slice(0, 120)}${userRequest.length > 120 ? '…' : ''}`;
    console.log('\n' + '='.repeat(60));
    console.log(line);
    fs.appendFileSync(LOG_FILE, line + '\n');

    let prompt = this.applySkills(userRequest);
    prompt = this.enforceRules(prompt);

    const result = await this.router.route(prompt, forceComplexity);

    this.history.push({ request: userRequest, result, ts: new Date() });

    if (!result.streamed) {
      console.log('\n' + '-'.repeat(60));
      console.log(`SOURCE : ${result.source.toUpperCase()}  (${result.model})`);
      if (result.cost) console.log(`COST   : $${result.cost.toFixed(4)}`);
      console.log('-'.repeat(60));
      console.log(result.text);
    }
    console.log('='.repeat(60) + '\n');

    return result;
  }

  getStats() {
    return this.router.getStats();
  }

  reset() {
    this.router.resetStats();
    resetDb();
    this.history = [];
  }
}

export default ClaudeOrchestrator;
