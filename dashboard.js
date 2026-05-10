// dashboard.js — full-screen TUI dashboard for the orchestrator.
// Renders three tier cards + log feed using ink v7 + React 19. No JSX.

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { render, Box, Text, useInput, useApp, useWindowSize, useStdout } from 'ink';
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateSavings, SAVINGS_RATE_PER_M_TOKENS } from './ollama-router.js';
import { getAvgMs, getFallbackCounts, getTallies } from './stats-db.js';

const h = React.createElement;
const __dirname = dirname(fileURLToPath(import.meta.url));
const STATS_FILE = join(__dirname, 'orchestrator-stats.json');
const LOG_FILE = join(__dirname, 'orchestrator.log');
const LOCAL_URL = `http://localhost:${process.env.OLLAMA_PORT || 11434}`;
const REMOTE_URL = process.env.OLLAMA_REMOTE_HOST || null;

function statusDot(online) {
  if (online === null) return { color: 'yellow', char: '◌', label: 'checking…' };
  return online
    ? { color: 'green', char: '●', label: 'online' }
    : { color: 'red', char: '○', label: 'offline' };
}

// ── Tier 1: Local Ollama ──────────────────────────────────────────────────────
function LocalTierCard({ calls, pct, avg, fb, online }) {
  const model = process.env.OLLAMA_MODEL || 'mistral';
  const fbTotal = (fb.down || 0) + (fb.timeout || 0) + (fb.error || 0);
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
    h(Text, { dimColor: true }, `  d=${fb.down || 0} / t=${fb.timeout || 0} / e=${fb.error || 0}`),
  );
}

// ── Tier 2: Remote Ollama ─────────────────────────────────────────────────────
function RemoteTierCard({ calls, pct, avg, fb, online }) {
  const model = process.env.OLLAMA_REMOTE_MODEL || 'qwen2.5:32b';
  const host = (REMOTE_URL || '').replace(/^https?:\/\//, '');
  const fbTotal = (fb.down || 0) + (fb.timeout || 0) + (fb.error || 0);
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
    h(Text, { dimColor: true }, `  d=${fb.down || 0} / t=${fb.timeout || 0} / e=${fb.error || 0}`),
  );
}

// ── Tier 3: Claude Code ───────────────────────────────────────────────────────
function ClaudeCodeTierCard({ refs, pct }) {
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
const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g;
function localiseLogLine(line) {
  return line.replace(ISO_RE, (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  });
}

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
          const localLine = localiseLogLine(line);
          const trimmed =
            localLine.length > maxLineLen ? `${localLine.slice(0, maxLineLen - 1)}…` : localLine;
          return h(Text, { key: i, color }, trimmed);
        })),
  );
}

// ── Root dashboard ────────────────────────────────────────────────────────────
// ── Usage history panel ───────────────────────────────────────────────────────
function HistoryPanel({ tallies }) {
  const fmt = (m) => {
    const l = String(m['ollama'] ?? 0).padStart(4);
    const r = String(m['ollama-remote'] ?? 0).padStart(4);
    const c = String(m['claude-code'] ?? 0).padStart(4);
    const t = ((m['ollama'] ?? 0) + (m['ollama-remote'] ?? 0) + (m['claude-code'] ?? 0));
    return h(
      Box,
      { gap: 1 },
      h(Text, { color: 'green' }, `local${l}`),
      h(Text, { color: 'magenta' }, `remote${r}`),
      h(Text, { color: 'yellow' }, `claude${c}`),
      h(Text, { dimColor: true }, `total ${String(t).padStart(4)}`),
    );
  };

  return h(
    Box,
    { flexDirection: 'column', borderStyle: 'round', borderColor: 'blue', paddingX: 1 },
    h(Text, { bold: true, color: 'blue' }, 'Usage history'),
    h(Text, null, ''),
    h(Box, { gap: 2 },
      h(Box, { flexDirection: 'column' },
        h(Text, { dimColor: true }, 'Today      '),
        h(Text, { dimColor: true }, 'This week  '),
        h(Text, { dimColor: true }, 'This month '),
      ),
      h(Box, { flexDirection: 'column' },
        fmt(tallies.today),
        fmt(tallies.week),
        fmt(tallies.month),
      ),
    ),
  );
}

const REFRESH_OPTIONS = [2000, 5000, 10000, 20000, 30000];
const DEFAULT_REFRESH_IDX = 1; // 5s

function Dashboard() {
  const [stats, setStats] = useState(null);
  const [logLines, setLogLines] = useState([]);
  const [localOnline, setLocalOnline] = useState(null);
  const [remoteOnline, setRemoteOnline] = useState(null);
  const [refreshIdx, setRefreshIdx] = useState(DEFAULT_REFRESH_IDX);
  const [sqliteData, setSqliteData] = useState({
    localAvg: null,
    remoteAvg: null,
    fallbacks: {},
    tallies: { today: {}, week: {}, month: {} },
  });
  const { exit } = useApp();
  const { columns: cols = 80, rows = 24 } = useWindowSize();
  const { stdout: inkStdout } = useStdout();
  const localAbortRef = useRef(null);
  const remoteAbortRef = useRef(null);

  // enter alt-screen + hide cursor on mount; restore on React unmount and process exit
  useEffect(() => {
    const out = inkStdout ?? process.stdout;
    if (!out.isTTY) return;
    const restore = () => out.write('\x1b[?1049l\x1b[?25h');
    out.write('\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l');
    process.on('exit', restore);
    return () => {
      process.off('exit', restore);
      restore();
    };
  }, [inkStdout]);

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

      try {
        setSqliteData({
          localAvg: getAvgMs('ollama'),
          remoteAvg: getAvgMs('ollama-remote'),
          fallbacks: getFallbackCounts(),
          tallies: getTallies(),
        });
      } catch {
        // DB not yet initialised
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
    const id = setInterval(tick, REFRESH_OPTIONS[refreshIdx]);
    return () => {
      clearInterval(id);
      localAbortRef.current?.abort();
      remoteAbortRef.current?.abort();
    };
  }, [refreshIdx]);

  useInput((input, key) => {
    if (input === 'q') exit();
    if (key.leftArrow) setRefreshIdx((i) => Math.max(0, i - 1));
    if (key.rightArrow) setRefreshIdx((i) => Math.min(REFRESH_OPTIONS.length - 1, i + 1));
  });

  const total = stats?.totalRequests ?? 0;
  const { tokens: estTokens, savings: estSavings } = estimateSavings(
    stats?.totalOffloadedChars ?? 0,
  );

  // Compute all route-derived aggregates once per stats/sqliteData update
  const derived = useMemo(() => {
    const fbl = sqliteData.fallbacks;
    const t = stats?.totalRequests ?? 0;
    const simple = stats?.simpleCalls ?? 0;
    const medium = stats?.mediumCalls ?? 0;
    const refs = stats?.claudeCodeReferrals ?? 0;
    return {
      localAvg: sqliteData.localAvg,
      remoteAvg: sqliteData.remoteAvg,
      localFb: {
        down: fbl['OLLAMA-DOWN'],
        timeout: fbl['OLLAMA-TIMEOUT'],
        error: fbl['OLLAMA-ERROR'],
      },
      remoteFb: {
        down: fbl['OLLAMA-REMOTE-DOWN'],
        timeout: fbl['OLLAMA-REMOTE-TIMEOUT'],
        error: fbl['OLLAMA-REMOTE-ERROR'],
      },
      simpleCalls: simple,
      simplePct: t ? Math.round((simple / t) * 100) : 0,
      mediumCalls: medium,
      mediumPct: t ? Math.round((medium / t) * 100) : 0,
      refs,
      refsPct: t ? Math.round((refs / t) * 100) : 0,
    };
  }, [stats, sqliteData]);

  // log panel gets whatever rows remain after tier cards (~12), summary (1), footer (1), borders
  const logMaxLines = Math.max(4, rows - 16);
  const maxLineLen = Math.max(20, cols - 6);

  return h(
    Box,
    { flexDirection: 'column', width: cols },
    h(
      Box,
      { flexDirection: 'row', width: cols },
      h(LocalTierCard, {
        calls: derived.simpleCalls,
        pct: derived.simplePct,
        avg: derived.localAvg,
        fb: derived.localFb,
        online: localOnline,
      }),
      h(RemoteTierCard, {
        calls: derived.mediumCalls,
        pct: derived.mediumPct,
        avg: derived.remoteAvg,
        fb: derived.remoteFb,
        online: remoteOnline,
      }),
      h(ClaudeCodeTierCard, { refs: derived.refs, pct: derived.refsPct }),
    ),
    h(HistoryPanel, { tallies: sqliteData.tallies }),
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
      h(Text, { dimColor: true }, 'Refresh: '),
      h(Text, { bold: true }, '← →'),
      h(Text, { dimColor: true }, ' to change  ·  '),
      h(Text, null, `${REFRESH_OPTIONS[refreshIdx] / 1000}s`),
      h(Text, { dimColor: true }, `  [${REFRESH_OPTIONS.map((ms, i) => (i === refreshIdx ? `[${ms / 1000}]` : `${ms / 1000}`)).join(' ')}]  ·  `),
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
