// Integrationstest Strategie D: Headless-Chromium spielt eine lokale Testseite ab, die App nimmt auf.
// Wird übersprungen, wenn Playwright (PLAYWRIGHT_MODULE oder npm-Paket) oder ffmpeg fehlt.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createProcessRunner } from '../src/adapters/process.js';
import { createFfmpeg } from '../src/adapters/ffmpeg.js';
import { createCaptureEngine } from '../src/adapters/capture/engine.js';
import { checkEngine } from '../src/core/engine.js';
import { DEFAULT_OPTIONS, STRATEGY_IDS } from '../src/core/model.js';

const loadPlaywright = () => import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
let pwOk = true;
try {
  await loadPlaywright();
} catch {
  pwOk = false;
}
const ffOk = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
const skip = !pwOk || !ffOk ? 'Playwright oder ffmpeg fehlt' : false;

let dir, server, base;
before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'ytd-cap-'));
  const clip = join(dir, 'clip.webm');
  spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '3', '-c:v', 'libvpx-vp9', '-b:v', '300k', '-c:a', 'libopus', '-shortest', clip]);
  const data = readFileSync(clip);
  server = createServer((req, res) => {
    if (req.url === '/clip.webm') return res.writeHead(200, { 'content-type': 'video/webm', 'content-length': data.length }).end(data);
    if (req.url === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end('<title>Mein Testclip - YouTube</title><video src="/clip.webm" muted></video>');
    res.writeHead(404).end();
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const engine = (extra = {}) =>
  createCaptureEngine({ loadPlaywright, ffmpeg: createFfmpeg({ runner: createProcessRunner() }), profileDir: join(dir, 'profile'), headless: true, autoplay: true, ...extra });

test('D: Vertrag und Verfügbarkeit', { skip }, async () => {
  assert.deepEqual(checkEngine(engine(), STRATEGY_IDS), []);
  assert.equal((await engine().checkAvailable()).ok, true);
});

test('D: Aufnahme als MP4 mit Titel aus der Seite', { skip, timeout: 60000 }, async () => {
  const events = [];
  const out = join(dir, 'video');
  const r = await engine().download({ url: `${base}/`, isPlaylist: false, outputDir: out, options: DEFAULT_OPTIONS }, { signal: new AbortController().signal, onEvent: (e) => events.push(e) });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.files[0], /Mein Testclip \[Aufnahme\]\.mp4$/);
  const info = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,codec_type:format=duration', '-of', 'json', r.files[0]], { encoding: 'utf8' }).stdout);
  assert.deepEqual(info.streams.map((s) => s.codec_name).sort(), ['aac', 'h264']);
  assert.ok(Number(info.format.duration) > 2, `Dauer ${info.format.duration}`);
  assert.ok(events.some((e) => e.type === 'progress'));
  assert.deepEqual(readdirSync(out).filter((f) => f.startsWith('.capture')), [], 'Rohdatei aufgeräumt');
});

test('D: Nur Audio als FLAC', { skip, timeout: 60000 }, async () => {
  const r = await engine().download({ url: `${base}/`, isPlaylist: false, outputDir: join(dir, 'audio'), options: { ...DEFAULT_OPTIONS, mode: 'audio', audioFormat: 'flac' } }, { signal: new AbortController().signal, onEvent: () => {} });
  assert.equal(r.ok, true, JSON.stringify(r));
  const info = JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,codec_type', '-of', 'json', r.files[0]], { encoding: 'utf8' }).stdout);
  assert.deepEqual(info.streams.map((s) => s.codec_type), ['audio']);
  assert.equal(info.streams[0].codec_name, 'flac');
});

test('D: Nutzer startet nicht → klare Meldung statt Hängen', { skip, timeout: 30000 }, async () => {
  const r = await engine({ autoplay: false, startTimeoutMs: 1500 }).download({ url: `${base}/`, isPlaylist: false, outputDir: join(dir, 'none'), options: DEFAULT_OPTIONS }, { signal: new AbortController().signal, onEvent: () => {} });
  assert.deepEqual(r, { ok: false, errorCode: 'needs_user_action', detail: 'not_started' });
});
