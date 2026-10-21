// Integrationstest Strategie A mit echtem yt-dlp und ffmpeg gegen einen lokalen Testserver (127.0.0.1).
// YouTube selbst wird hier nicht angesprochen. Wird übersprungen, wenn yt-dlp oder ffmpeg fehlen.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createProcessRunner } from '../src/adapters/process.js';
import { createYtDlpEngine } from '../src/adapters/ytdlp/engine.js';
import { DEFAULT_OPTIONS } from '../src/core/model.js';

const BIN = process.env.YTDLP_BIN || 'yt-dlp';
const have = (cmd, arg) => spawnSync(cmd, [arg], { stdio: 'ignore' }).status === 0;
const skip = !have(BIN, '--version') || !have('ffmpeg', '-version') ? 'yt-dlp oder ffmpeg fehlt' : false;

let dir, server, base;

before(async () => {
  if (skip) return;
  dir = mkdtempSync(join(tmpdir(), 'ytd-test-'));
  const clip = join(dir, 'clip.mp4');
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25', '-f', 'lavfi', '-i', 'sine=frequency=440',
    '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-metadata', 'title=Testclip', clip]);
  assert.equal(r.status, 0, 'Testclip erzeugen');
  const data = readFileSync(clip);
  server = createServer((req, res) => {
    if (req.url === '/clip.mp4' || req.url === '/slow.mp4') {
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': data.length });
      if (req.url === '/clip.mp4') return res.end(data);
      // langsam: 2 KB alle 100 ms, damit Abbrechen getestet werden kann
      let pos = 0;
      const t = setInterval(() => { res.write(data.subarray(pos, pos + 2048)); pos += 2048; if (pos >= data.length) { clearInterval(t); res.end(); } }, 100);
      res.on('close', () => clearInterval(t));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const engine = () => createYtDlpEngine({ id: 'ytdlp', runner: createProcessRunner(), binary: BIN });
const ctx = (signal = new AbortController().signal, events = []) => ({ signal, onEvent: (e) => events.push(e) });

test('A: checkAvailable liefert Version', { skip }, async () => {
  const r = await engine().checkAvailable();
  assert.equal(r.ok, true);
  assert.match(r.version, /^\d{4}\.\d{2}\.\d{2}/);
});

test('A: probe liefert Metadaten', { skip }, async () => {
  const r = await engine().probe(`${base}/clip.mp4`, ctx());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.metadata.kind, 'video');
  assert.equal(r.metadata.title, 'clip');
  assert.ok(r.metadata.formats.length >= 1);
});

test('A: Video-Download mit Fortschritt und Datei', { skip }, async () => {
  const events = [];
  const out = join(dir, 'video');
  const r = await engine().download({ url: `${base}/clip.mp4`, isPlaylist: false, outputDir: out, options: { ...DEFAULT_OPTIONS, embedThumbnail: false } }, ctx(undefined, events));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.files.length, 1);
  assert.ok(statSync(r.files[0]).size > 10000);
  assert.ok(events.some((e) => e.type === 'progress' && e.percent === 100));
  assert.ok(events.some((e) => e.type === 'title'));
});

test('A: Nur Audio als MP3 192 kbit/s mit Tags', { skip }, async () => {
  const out = join(dir, 'audio');
  const r = await engine().download(
    { url: `${base}/clip.mp4`, isPlaylist: false, outputDir: out, options: { ...DEFAULT_OPTIONS, mode: 'audio', audioFormat: 'mp3', audioBitrateKbps: 192, embedThumbnail: false } },
    ctx(),
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.files[0], /\.mp3$/);
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,bit_rate:format_tags=title', '-of', 'json', r.files[0]], { encoding: 'utf8' });
  const info = JSON.parse(probe.stdout);
  assert.equal(info.streams[0].codec_name, 'mp3');
  assert.equal(Number(info.streams[0].bit_rate), 192000);
  assert.equal(info.format.tags.title, 'clip');
});

test('A: 404 → Fehlercode statt Absturz', { skip }, async () => {
  const r = await engine().probe(`${base}/gibtsnicht.mp4`, ctx());
  assert.equal(r.ok, false);
  assert.equal(r.errorCode, 'deleted');
});

test('A: Abbrechen beendet yt-dlp', { skip }, async () => {
  const ac = new AbortController();
  const started = Date.now();
  setTimeout(() => ac.abort(), 1000);
  const r = await engine().download({ url: `${base}/slow.mp4`, isPlaylist: false, outputDir: join(dir, 'cancel'), options: DEFAULT_OPTIONS }, ctx(ac.signal));
  assert.deepEqual(r, { ok: false, errorCode: 'cancelled', detail: null });
  assert.ok(Date.now() - started < 6000);
});
