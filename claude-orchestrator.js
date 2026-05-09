// claude-orchestrator.js

const TaskRouter = require('./ollama-router');

class ClaudeOrchestrator {
  constructor(skills = {}, rules = {}) {
    this.router  = new TaskRouter();
    this.skills  = skills;
    this.rules   = rules;
    this.history = [];
  }

  applySkills(prompt) {
    let out     = prompt;
    let applied = [];
    for (const [keyword, skillPrompt] of Object.entries(this.skills)) {
      if (prompt.toLowerCase().includes(keyword)) {
        out = `${skillPrompt}\n\nRequest: ${out}`;
        applied.push(keyword);
      }
    }
    if (applied.length) {
      const { log } = require('./ollama-router'); // shared logger not exported — inline it
      const fs   = require('fs');
      const line = `[${new Date().toISOString()}] [SKILLS] Applied: ${applied.join(', ')}`;
      console.log(line);
      fs.appendFileSync(require('path').join(__dirname, 'orchestrator.log'), line + '\n');
    }
    return out;
  }

  enforceRules(prompt) {
    const constraints = Object.values(this.rules).join('\n');
    return constraints ? `${prompt}\n\n--- Rules ---\n${constraints}` : prompt;
  }

  async process(userRequest, forceComplexity = null) {
    const fs   = require('fs');
    const path = require('path');
    const line = `[${new Date().toISOString()}] [REQUEST] ${userRequest.slice(0, 120)}${userRequest.length > 120 ? '…' : ''}`;
    console.log('\n' + '='.repeat(60));
    console.log(line);
    fs.appendFileSync(path.join(__dirname, 'orchestrator.log'), line + '\n');

    let prompt = this.applySkills(userRequest);
    prompt     = this.enforceRules(prompt);

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
    return { ...this.router.getStats(), totalRequests: this.history.length };
  }

  reset() {
    this.router.resetStats();
    this.history = [];
  }
}

module.exports = ClaudeOrchestrator;
