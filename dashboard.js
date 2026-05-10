// dashboard.js — full-screen TUI dashboard for the orchestrator.
// Renders three tier cards + log feed using ink v7 + React 19. No JSX.

import React, { useState, useEffect, useRef } from 'react';
import { render, Box, Text, useInput, useApp, useWindowSize } from 'ink';
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateSavings, SAVINGS_RATE_PER_M_TOKENS } from './ollama-router.js';

const h = React.createElement;
const __dirname = dirname(fileURLToPath(import.meta.url));
const STATS_FILE = join(__dirname, 'orchestrator-stats.json');
const LOG_FILE = join(__dirname, 'orchestrator.log');
const LOCAL_URL = `http://localhost:${process.env.OLLAMA_PORT || 11434}`;
const REMOTE_URL = process.env.OLLAMA_REMOTE_HOST || null;

function avgMs(routes, routeType) {
  const matching = (routes || []).filter((r) => r.route === routeType && r.ms > 0);
  if (!matching.length) return null;
  return Math.round(matching.reduce((s, r) => s + r.ms, 0) / matching.length);
}

function statusDot(online) {
  if (online === null) return { color: 'yellow', char: '◌', label: 'checking…' };
  return online
    ? { color: 'green', char: '●', label: 'online' }
    : { color: 'red', char: '○', label: 'offline' };
}

// ── Tier 1: Local Ollama ──────────────────────────────────────────────────────
function LocalTierCard({ stats, online }) {
  const model = process.env.OLLAMA_MODEL || 'mistral';
  const routes = stats?.routes || [];
  const calls = stats?.simpleCalls ?? 0;
  const total = stats?.totalRequests ?? 0;
  const pct = total ? Math.round((calls / total) * 100) : 0;
  const avg = avgMs(routes, 'ollama');
  const fb = routes.filter((r) => r.route === 'ollama-fallback');
  const fbl = fb.reduce((a, r) => {
    a[r.label] = (a[r.label] || 0) + 1;
    return a;
  }, {});
  const fbTotal =
    (fbl['OLLAMA-DOWN'] || 0) + (fbl['OLLAMA-TIMEOUT'] || 0) + (fbl['OLLAMA-ERROR'] || 0);
  const { color, char, label } = statusDot(online);
  const borderColor = online ? 'green' : 'cyan';

  return h(
    Box,
    { flexDirection: 'column', flexGrow: 1, borderStyle: 'round', borderColor, paddingX: 1 },
    h(Text, { bold: true, color: 'green' }, 'Tier 1 · Local Ollama'),
    h(Text, { dimColor: true }, `Model : ${model}`),
    h(Text, null, 'Status: ', h(Text, { color }, char), ` ${label}`),
    h(Text, null, ''),
    h(Text, null, `Calls     :${String(calls).padStart(5)}  (${pct}%)`),
    h(Text, null, `Avg ms    : ${avg != null ? avg.toLocaleString() : '—'}`),
    h(Text, null, `Fallbacks :${String(fbTotal).padStart(5)}`),
    h(
      Text,
      { dimColor: true },
      `  d=${fbl['OLLAMA-DOWN'] || 0} / t=${fbl['OLLAMA-TIMEOUT'] || 0} / e=${fbl['OLLAMA-ERROR'] || 0}`,
    ),
  );
}

// ── Tier 2: Remote Ollama ─────────────────────────────────────────────────────
function RemoteTierCard({ stats, online }) {
  const model = process.env.OLLAMA_REMOTE_MODEL || 'qwen2.5:32b';
  const host = (REMOTE_URL || '').replace(/^https?:\/\//, '');
  const routes = stats?.routes || [];
  const calls = stats?.mediumCalls ?? 0;
  const total = stats?.totalRequests ?? 0;
  const pct = total ? Math.round((calls / total) * 100) : 0;
  const avg = avgMs(routes, 'ollama-remote');
  const fb = routes.filter((r) => r.route === 'ollama-fallback');
  const fbl = fb.reduce((a, r) => {
    a[r.label] = (a[r.label] || 0) + 1;
    return a;
  }, {});
  const fbTotal =
    (fbl['OLLAMA-REMOTE-DOWN'] || 0) +
    (fbl['OLLAMA-REMOTE-TIMEOUT'] || 0) +
    (fbl['OLLAMA-REMOTE-ERROR'] || 0);
  const { color, char, label } = statusDot(online);
  const borderColor = !REMOTE_URL ? 'gray' : online ? 'magenta' : 'cyan';

  if (!REMOTE_URL) {
    return h(
      Box,
      {
        flexDirection: 'column',
        flexGrow: 1,
        borderStyle: 'round',
        borderColor: 'gray',
        paddingX: 1,
      },
      h(Text, { bold: true, color: 'gray' }, 'Tier 2 · Remote Ollama'),
      h(Text, null, ''),
      h(Text, { dimColor: true }, 'Not configured'),
      h(Text, { dimColor: true }, 'Set OLLAMA_REMOTE_HOST'),
      h(Text, { dimColor: true }, 'to enable tier 2'),
    );
  }

  return h(
    Box,
    { flexDirection: 'column', flexGrow: 1, borderStyle: 'round', borderColor, paddingX: 1 },
    h(Text, { bold: true, color: 'magenta' }, 'Tier 2 · Remote Ollama'),
    h(Text, { dimColor: true }, `Host  : ${host}`),
    h(Text, { dimColor: true }, `Model : ${model}`),
    h(Text, null, 'Status: ', h(Text, { color }, char), ` ${label}`),
    h(Text, null, ''),
    h(Text, null, `Calls     :${String(calls).padStart(5)}  (${pct}%)`),
    h(Text, null, `Avg ms    : ${avg != null ? avg.toLocaleString() : '—'}`),
    h(Text, null, `Fallbacks :${String(fbTotal).padStart(5)}`),
    h(
      Text,
      { dimColor: true },
      `  d=${fbl['OLLAMA-REMOTE-DOWN'] || 0} / t=${fbl['OLLAMA-REMOTE-TIMEOUT'] || 0} / e=${fbl['OLLAMA-REMOTE-ERROR'] || 0}`,
    ),
  );
}

// ── Tier 3: Claude Code ───────────────────────────────────────────────────────
function ClaudeCodeTierCard({ stats }) {
  const refs = stats?.claudeCodeReferrals ?? 0;
  const total = stats?.totalRequests ?? 0;
  const pct = total ? Math.round((refs / total) * 100) : 0;

  return h(
    Box,
    {
      flexDirection: 'column',
      flexGrow: 1,
      borderStyle: 'round',
      borderColor: 'yellow',
      paddingX: 1,
    },
    h(Text, { bold: true, color: 'yellow' }, 'Tier 3 · Claude Code'),
    h(Text, { dimColor: true }, 'Always available'),
    h(Text, null, 'Status: ', h(Text, { color: 'green' }, '●'), ' ready'),
    h(Text, null, ''),
    h(Text, null, `Referrals :${String(refs).padStart(5)}  (${pct}%)`),
    h(Text, null, ''),
    h(Text, { dimColor: true }, 'Handles complex tasks'),
    h(Text, { dimColor: true }, 'and offline fallback'),
  );
}

// ── Log feed panel ────────────────────────────────────────────────────────────
function LogPanel({ lines, maxLines, maxLineLen }) {
  const visible = lines.slice(0, maxLines);

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
    ...(visible.length === 0
      ? [h(Text, { dimColor: true }, 'Waiting for activity…')]
      : visible.map((line, i) => {
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
  const [localOnline, setLocalOnline] = useState(null);
  const [remoteOnline, setRemoteOnline] = useState(null);
  const { exit } = useApp();
  const { columns: cols = 80, rows = 24 } = useWindowSize();
  const localAbortRef = useRef(null);
  const remoteAbortRef = useRef(null);

  // enter alt-screen + hide cursor on mount; restore on exit
  useEffect(() => {
    process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l');
    return () => process.stdout.write('\x1b[?1049l\x1b[?25h');
  }, []);

  useEffect(() => {
    function tick() {
      try {
        setStats(JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')));
      } catch {
        setStats(null);
      }
      try {
        const stat = fs.statSync(LOG_FILE);
        const tail = 16384;
        const offset = Math.max(0, stat.size - tail);
        const buf = Buffer.alloc(Math.min(tail, stat.size));
        const fd = fs.openSync(LOG_FILE, 'r');
        fs.readSync(fd, buf, 0, buf.length, offset);
        fs.closeSync(fd);
        const tagged = buf
          .toString('utf8')
          .split('\n')
          .filter((l) => l.includes('['));
        setLogLines(tagged.slice(-60).reverse());
      } catch {
        setLogLines([]);
      }

      localAbortRef.current?.abort();
      const lac = new AbortController();
      localAbortRef.current = lac;
      fetch(`${LOCAL_URL}/api/tags`, {
        signal: AbortSignal.any([lac.signal, AbortSignal.timeout(900)]),
      })
        .then((r) => setLocalOnline(r.ok))
        .catch(() => {
          if (!lac.signal.aborted) setLocalOnline(false);
        });

      if (REMOTE_URL) {
        remoteAbortRef.current?.abort();
        const rac = new AbortController();
        remoteAbortRef.current = rac;
        fetch(`${REMOTE_URL}/api/tags`, {
          signal: AbortSignal.any([rac.signal, AbortSignal.timeout(900)]),
        })
          .then((r) => setRemoteOnline(r.ok))
          .catch(() => {
            if (!rac.signal.aborted) setRemoteOnline(false);
          });
      }
    }

    tick();
    const id = setInterval(tick, 1000);
    return () => {
      clearInterval(id);
      localAbortRef.current?.abort();
      remoteAbortRef.current?.abort();
    };
  }, []);

  useInput((input) => {
    if (input === 'q') exit();
  });

  const total = stats?.totalRequests ?? 0;
  const { tokens: estTokens, savings: estSavings } = estimateSavings(
    stats?.totalOffloadedChars ?? 0,
  );

  // log panel gets whatever rows remain after tier cards (~12), summary (1), footer (1), borders
  const logMaxLines = Math.max(4, rows - 16);
  const maxLineLen = Math.max(20, cols - 6);

  return h(
    Box,
    { flexDirection: 'column', width: cols },
    h(
      Box,
      { flexDirection: 'row', width: cols },
      h(LocalTierCard, { stats, online: localOnline }),
      h(RemoteTierCard, { stats, online: remoteOnline }),
      h(ClaudeCodeTierCard, { stats }),
    ),
    h(
      Box,
      { paddingX: 2 },
      h(Text, null, `Total: ${total} requests  ·  `),
      h(Text, null, `Offloaded: ${estTokens.toLocaleString()} tokens  ·  `),
      h(Text, { color: 'green' }, `~$${estSavings} saved`),
      h(Text, { dimColor: true }, `  ($${SAVINGS_RATE_PER_M_TOKENS}/M)`),
    ),
    h(LogPanel, { lines: logLines, maxLines: logMaxLines, maxLineLen }),
    h(
      Box,
      { paddingX: 2 },
      h(Text, { dimColor: true }, 'Refreshes every 1s  ·  '),
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
