// dashboard.js — live TUI dashboard for the orchestrator.
// Renders stats + log feed using ink v7 + React 19. No JSX — uses React.createElement.

import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput, useApp, useStdout } from 'ink';
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const h = React.createElement;
const __dirname = dirname(fileURLToPath(import.meta.url));
const STATS_FILE = join(__dirname, 'orchestrator-stats.json');
const LOG_FILE = join(__dirname, 'orchestrator.log');
const OLLAMA_URL = `http://localhost:${process.env.OLLAMA_PORT || 11434}`;

// ── Stats panel ───────────────────────────────────────────────────────────────
function StatsPanel({ stats, ollamaOnline, width }) {
  const model = process.env.OLLAMA_MODEL || 'mistral';
  const ollama = stats?.ollamaCalls ?? 0;
  const refs = stats?.claudeCodeReferrals ?? 0;
  const fallbacks = stats?.ollamaFallbacks ?? 0;
  const total = ollama + refs + fallbacks;
  const ollamaPct = total ? Math.round((ollama / total) * 100) : 0;
  const refsPct = total ? Math.round((refs / total) * 100) : 0;

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
    h(Text, null, `Ollama calls  :${String(ollama).padStart(5)}  (${ollamaPct}%)`),
    h(Text, null, `Claude refers :${String(refs).padStart(5)}  (${refsPct}%)`),
    h(Text, null, `Fallbacks     :${String(fallbacks).padStart(5)}`),
    h(
      Text,
      { dimColor: true },
      `  ↳ down=${byLabel['OLLAMA-DOWN'] || 0} / timeout=${byLabel['OLLAMA-TIMEOUT'] || 0} / err=${byLabel['OLLAMA-ERROR'] || 0}`,
    ),
    h(Text, null, `Total         :${String(total).padStart(5)}`),
    h(Text, null, ''),
    h(Text, { bold: true }, 'Last 5 routes:'),
    ...(last5.length === 0
      ? [h(Text, { dimColor: true }, '  (none yet)')]
      : last5.map((r, i) =>
          h(
            Text,
            { key: i },
            `  ${r.ts.slice(11, 19)}  ${r.route.padEnd(15)} ${r.ms ? `${r.ms}ms` : ''}`,
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
          else if (tag === 'OLLAMA-TIMEOUT') color = 'yellow';
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

  useEffect(() => {
    function tick() {
      try {
        setStats(JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')));
      } catch {
        setStats(null);
      }
      try {
        const raw = fs.readFileSync(LOG_FILE, 'utf8');
        const tagged = raw.split('\n').filter((l) => l.includes('['));
        setLogLines(tagged.slice(-20).reverse());
      } catch {
        setLogLines([]);
      }
      fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(900) })
        .then((r) => setOllamaOnline(r.ok))
        .catch(() => setOllamaOnline(false));
    }

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
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
