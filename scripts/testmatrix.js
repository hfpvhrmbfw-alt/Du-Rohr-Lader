#!/usr/bin/env node
// Testmatrix: jede verfügbare Strategie gegen jede URL aus testmatrix.urls.json.
// Aufruf: node scripts/testmatrix.js [--cookies firefox] [--out ./matrix-downloads]
// Ergebnis: docs/testmatrix-results.json und eine Markdown-Tabelle auf der Konsole.

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProcessRunner } from '../src/adapters/process.js';
import { createYtDlpEngine } from '../src/adapters/ytdlp/engine.js';
import { DEFAULT_OPTIONS } from '../src/core/model.js';
import { parseUrl, targetUrl } from '../src/core/logic.js';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1];
};
const root = new URL('..', import.meta.url).pathname;
const outDir = arg('--out') ?? join(root, 'matrix-downloads');
const runner = createProcessRunner();
const engines = [createYtDlpEngine({ id: 'ytdlp', runner })];
if (arg('--cookies')) engines.push(createYtDlpEngine({ id: 'ytdlp-cookies', runner, cookieBrowser: arg('--cookies') }));

const cases = JSON.parse(readFileSync(join(root, 'scripts/testmatrix.urls.json'), 'utf8')).cases.filter((c) => c.url);
if (cases.length === 0) {
  console.error('Keine URLs in scripts/testmatrix.urls.json eingetragen.');
  process.exit(1);
}

const mediaInfo = (file) => {
  const r = runner.run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,height,bit_rate', '-of', 'json', file]);
  return r.then((res) => {
    try {
      const s = JSON.parse(res.stdout).streams;
      const v = s.find((x) => x.codec_type === 'video');
      const a = s.find((x) => x.codec_type === 'audio');
      return { height: v?.height ?? null, vcodec: v?.codec_name ?? null, acodec: a?.codec_name ?? null };
    } catch {
      return { height: null, vcodec: null, acodec: null };
    }
  });
};

const results = [];
for (const engine of engines) {
  const avail = await engine.checkAvailable();
  for (const c of cases) {
    const parsed = parseUrl(c.url);
    const row = { strategy: engine.id, case: c.id, version: avail.version, ok: false, errorCode: null, detail: null, seconds: null, files: 0, bytes: 0, height: null, vcodec: null, acodec: null };
    if (!avail.ok) {
      results.push({ ...row, errorCode: avail.errorCode });
      continue;
    }
    if (!parsed.ok) {
      results.push({ ...row, errorCode: 'invalid_url' });
      continue;
    }
    const url = targetUrl(parsed, DEFAULT_OPTIONS);
    const dir = join(outDir, engine.id, c.id);
    mkdirSync(dir, { recursive: true });
    const t0 = performance.now();
    const res = await engine.download({ url, isPlaylist: url === parsed.playlistUrl, outputDir: dir, options: { ...DEFAULT_OPTIONS, embedThumbnail: false } }, { signal: new AbortController().signal, onEvent: () => {} });
    row.seconds = Math.round((performance.now() - t0) / 100) / 10;
    if (res.ok) {
      row.ok = true;
      row.files = res.files.length;
      row.bytes = res.files.reduce((sum, f) => sum + statSync(f).size, 0);
      if (res.files[0]) Object.assign(row, await mediaInfo(res.files[0]));
    } else {
      row.errorCode = res.errorCode;
      row.detail = res.detail;
    }
    results.push(row);
    console.error(`${engine.id} ${c.id}: ${row.ok ? 'ok' : row.errorCode} (${row.seconds}s)`);
  }
}

writeFileSync(join(root, 'docs/testmatrix-results.json'), JSON.stringify({ ranAt: new Date().toISOString(), platform: process.platform, results }, null, 2));
console.log('| Strategie | Fall | Erfolg | Zeit (s) | MB/s | Auflösung | Codecs | Fehler |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of results) {
  const mbps = r.ok && r.seconds ? (r.bytes / 1e6 / r.seconds).toFixed(1) : '';
  console.log(`| ${r.strategy} | ${r.case} | ${r.ok ? 'ja' : 'nein'} | ${r.seconds ?? ''} | ${mbps} | ${r.height ? r.height + 'p' : ''} | ${[r.vcodec, r.acodec].filter(Boolean).join('+')} | ${r.errorCode ?? ''} |`);
}
