// dashboard.js — live TUI dashboard for the orchestrator.
// Renders stats + log feed using ink v7 + React 19. No JSX — uses React.createElement.

import React, { useState, useEffect, useRef } from 'react';
import { render, Box, Text, useInput, useApp, useStdout } from 'ink';
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateSavings, SAVINGS_RATE_PER_M_TOKENS } from './ollama-router.js';

const h = React.createElement;
const __dirname = dirname(fileURLToPath(import.meta.url));
const STATS_FILE = join(__dirname, 'orchestrator-stats.json');
const LOG_FILE = join(__dirname, 'orchestrator.log');
const OLLAMA_URL = `http://localhost:${process.env.OLLAMA_PORT || 11434}`;

// ── Stats panel ───────────────────────────────────────────────────────────────
function StatsPanel({ stats, ollamaOnline, width }) {
  const model = process.env.OLLAMA_MODEL || 'mistral';
  const simple = stats?.simpleCalls ?? 0;
  const medium = stats?.mediumCalls ?? 0;
  const refs = stats?.claudeCodeReferrals ?? 0;
  const fallbacks = stats?.ollamaFallbacks ?? 0;
  const total = stats?.totalRequests ?? 0;
  const simplePct = total ? Math.round((simple / total) * 100) : 0;
  const mediumPct = total ? Math.round((medium / total) * 100) : 0;
  const refsPct = total ? Math.round((refs / total) * 100) : 0;
  const { tokens: estimatedTokens, savings: estimatedSavings } = estimateSavings(
    stats?.totalOffloadedChars ?? 0,
  );

  const fbRoutes = (stats?.routes || []).filter((r) => r.route === 'ollama-fallback');
  const byLabel = fbRoutes.reduce((acc, r) => {
    acc[r.label] = (acc[r.label] || 0) + 1;
    return acc;
  }, {});

  const last5 = (stats?.routes || []).slice(-5).reverse();

  const dotColor = ollamaOnline === null ? 'yellow' : ollamaOnline ? 'green' : 'red';
  const dotChar = ollamaOnline ? '●' : '○';
  const statusLabel = ollamaOnline === null ? 'checking…' : ollamaOnline ? 'online' : 'offline';

  return h(
    Box,
    {
      flexDirection: 'column',
      width,
      borderStyle: 'round',
      borderColor: 'cyan',
      paddingX: 1,
      flexShrink: 0,
    },
    h(Text, { bold: true, color: 'cyan' }, 'Stats'),
    h(Text, null, ''),
    h(Text, null, `Model  : ${model}`),
    h(Text, null, 'Ollama : ', h(Text, { color: dotColor }, dotChar), ` ${statusLabel}`),
    h(Text, null, ''),
    h(Text, null, `Simple calls  :${String(simple).padStart(5)}  (${simplePct}%)`),
    h(Text, null, `Medium calls  :${String(medium).padStart(5)}  (${mediumPct}%)`),
    h(Text, null, `Claude refers :${String(refs).padStart(5)}  (${refsPct}%)`),
    h(Text, null, `Fallbacks     :${String(fallbacks).padStart(5)}`),
    h(
      Text,
      { dimColor: true },
      `  ↳ local  d=${byLabel['OLLAMA-DOWN'] || 0}/t=${byLabel['OLLAMA-TIMEOUT'] || 0}/e=${byLabel['OLLAMA-ERROR'] || 0}`,
    ),
    h(
      Text,
      { dimColor: true },
      `  ↳ remote d=${byLabel['OLLAMA-REMOTE-DOWN'] || 0}/t=${byLabel['OLLAMA-REMOTE-TIMEOUT'] || 0}/e=${byLabel['OLLAMA-REMOTE-ERROR'] || 0}`,
    ),
    h(Text, null, `Requests      :${String(total).padStart(5)}`),
    h(Text, null, `Offloaded tkns: ${estimatedTokens.toLocaleString()}`),
    h(
      Text,
      { color: 'green' },
      `Est. savings  : ~$${estimatedSavings} ($${SAVINGS_RATE_PER_M_TOKENS}/M)`,
    ),
    h(Text, null, ''),
    h(Text, { bold: true }, 'Last 5 routes:'),
    ...(last5.length === 0
      ? [h(Text, { dimColor: true }, '  (none yet)')]
      : last5.map((r, i) =>
          h(
            Text,
            { key: i },
            `  ${r.ts.slice(11, 19)}  ${r.route.padEnd(15)} ${r.ms != null ? `${r.ms}ms` : ''}`,
          ),
        )),
  );
}

// ── Log feed panel ────────────────────────────────────────────────────────────
function LogPanel({ lines, maxLineLen }) {
  return h(
    Box,
    {
      flexDirection: 'column',
      flexGrow: 1,
      borderStyle: 'round',
      borderColor: 'cyan',
      paddingX: 1,
    },
    h(Text, { bold: true, color: 'cyan' }, 'Log feed'),
    h(Text, null, ''),
    ...(lines.length === 0
      ? [h(Text, { dimColor: true }, 'Waiting for activity…')]
      : lines.map((line, i) => {
          const tagMatch = line.match(/\[[A-Z][A-Z0-9-]*\]/g);
          const tag = tagMatch?.[0]?.slice(1, -1) || '';
          let color = 'white';
          if (tag === 'OLLAMA-DOWN' || tag === 'OLLAMA-ERROR') color = 'red';
          else if (tag === 'OLLAMA-REMOTE-DOWN' || tag === 'OLLAMA-REMOTE-ERROR') color = 'red';
          else if (tag === 'OLLAMA-TIMEOUT' || tag === 'OLLAMA-REMOTE-TIMEOUT') color = 'yellow';
          else if (tag === 'OLLAMA-REMOTE') color = 'magenta';
          else if (tag === 'OLLAMA') color = 'green';
          else if (tag === 'ROUTER') color = 'blue';
          else if (tag === 'REQUEST') color = 'cyan';
          const trimmed = line.length > maxLineLen ? `${line.slice(0, maxLineLen - 1)}…` : line;
          return h(Text, { key: i, color }, trimmed);
        })),
  );
}

// ── Root dashboard ────────────────────────────────────────────────────────────
function Dashboard() {
  const [stats, setStats] = useState(null);
  const [logLines, setLogLines] = useState([]);
  const [ollamaOnline, setOllamaOnline] = useState(null);
  const { exit } = useApp();
  const { stdout } = useStdout();
  const ollamaAbortRef = useRef(null);

  useEffect(() => {
    function tick() {
      try {
        setStats(JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')));
      } catch {
        setStats(null);
      }
      try {
        const stat = fs.statSync(LOG_FILE);
        const tail = 8192;
        const offset = Math.max(0, stat.size - tail);
        const buf = Buffer.alloc(Math.min(tail, stat.size));
        const fd = fs.openSync(LOG_FILE, 'r');
        fs.readSync(fd, buf, 0, buf.length, offset);
        fs.closeSync(fd);
        const tagged = buf
          .toString('utf8')
          .split('\n')
          .filter((l) => l.includes('['));
        setLogLines(tagged.slice(-20).reverse());
      } catch {
        setLogLines([]);
      }
      ollamaAbortRef.current?.abort();
      const ac = new AbortController();
      ollamaAbortRef.current = ac;
      fetch(`${OLLAMA_URL}/api/tags`, {
        signal: AbortSignal.any([ac.signal, AbortSignal.timeout(900)]),
      })
        .then((r) => setOllamaOnline(r.ok))
        .catch((_err) => {
          if (!ac.signal.aborted) setOllamaOnline(false);
        });
    }

    tick();
    const id = setInterval(tick, 1000);
    return () => {
      clearInterval(id);
      ollamaAbortRef.current?.abort();
    };
  }, []);

  useInput((input) => {
    if (input === 'q') exit();
  });

  const cols = stdout?.columns ?? 80;
  const leftWidth = Math.max(36, Math.floor(cols * 0.35));
  const rightMaxLen = Math.max(20, cols - leftWidth - 6);

  return h(
    Box,
    { flexDirection: 'column' },
    h(
      Box,
      { flexDirection: 'row' },
      h(StatsPanel, { stats, ollamaOnline, width: leftWidth }),
      h(LogPanel, { lines: logLines, maxLineLen: rightMaxLen }),
    ),
    h(
      Box,
      null,
      h(Text, { dimColor: true }, '  Refreshes every 1s · '),
      h(Text, { bold: true }, 'q'),
      h(Text, { dimColor: true }, ' or '),
      h(Text, { bold: true }, 'Ctrl-C'),
      h(Text, { dimColor: true }, ' to exit'),
    ),
  );
}

export default async function launchDashboard() {
  const { waitUntilExit } = render(h(Dashboard, null));
  await waitUntilExit();
}
