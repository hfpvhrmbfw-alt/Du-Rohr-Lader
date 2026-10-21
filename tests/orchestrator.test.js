import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeWithFallback, runJob } from '../src/core/orchestrator.js';
import { DEFAULT_OPTIONS, DEFAULT_SETTINGS, emptyJob } from '../src/core/model.js';

/** Attrappe einer Engine: liefert vorgegebene Ergebnisse. */
function fakeEngine(id, { probe, download, caps = {} }) {
  const calls = [];
  return {
    id,
    calls,
    capabilities: () => ({ metadata: true, download: true, audioOnly: true, playlist: true, needsUserAction: false, ...caps }),
    checkAvailable: async () => ({ ok: true, version: '1', errorCode: null }),
    probe: async (url) => { calls.push(['probe', url]); return probe; },
    download: async (req, ctx) => {
      calls.push(['download', req.url]);
      ctx.onEvent({ type: 'progress', percent: 50, downloadedBytes: 1, totalBytes: 2, speedBps: 1, etaSec: 1 });
      return typeof download === 'function' ? download(ctx) : download;
    },
  };
}

const deps = (engines, extra = {}) => ({
  engines,
  available: Object.fromEntries(Object.keys(engines).map((k) => [k, true])),
  settings: { ...DEFAULT_SETTINGS, cookieBrowser: 'firefox', allowBrowserCapture: true },
  signal: new AbortController().signal,
  now: () => '2026-10-13T12:00:00Z',
  onUpdate: () => {},
  ...extra,
});

const job = (url = 'https://youtu.be/abcdefghijk') => emptyJob('j1', url, DEFAULT_OPTIONS, '2026-10-13T11:00:00Z');
const meta = { id: 'abcdefghijk', title: 'T' };

test('runJob: A klappt → fertig, B wird nicht gefragt', async () => {
  const a = fakeEngine('ytdlp', { download: { ok: true, files: ['/o/a.mp4'] } });
  const b = fakeEngine('ytdlp-cookies', { download: { ok: true, files: [] } });
  const states = [];
  const end = await runJob(job(), '/o', deps({ ytdlp: a, 'ytdlp-cookies': b }, { onUpdate: (j) => states.push(j.state) }));
  assert.equal(end.state, 'done');
  assert.deepEqual(end.files, ['/o/a.mp4']);
  assert.equal(b.calls.length, 0);
  assert.deepEqual(a.calls, [['download', 'https://www.youtube.com/watch?v=abcdefghijk']]);
  assert.deepEqual(states, ['probing', 'downloading', 'downloading', 'done']); // started, progress, file, done
});

test('runJob: Bot-Check bei A → B mit Cookies → fertig', async () => {
  const a = fakeEngine('ytdlp', { download: { ok: false, errorCode: 'bot_check', detail: 'x' } });
  const b = fakeEngine('ytdlp-cookies', { download: { ok: true, files: ['/o/b.mp4'] } });
  const end = await runJob(job(), '/o', deps({ ytdlp: a, 'ytdlp-cookies': b }));
  assert.equal(end.state, 'done');
  assert.equal(end.strategy, 'ytdlp-cookies');
  assert.deepEqual(end.tried, ['ytdlp', 'ytdlp-cookies']);
});

test('runJob: gelöscht → sofort Schluss', async () => {
  const a = fakeEngine('ytdlp', { download: { ok: false, errorCode: 'deleted', detail: null } });
  const b = fakeEngine('ytdlp-cookies', { download: { ok: true, files: [] } });
  const end = await runJob(job(), '/o', deps({ ytdlp: a, 'ytdlp-cookies': b }));
  assert.equal(end.state, 'failed');
  assert.equal(end.errorCode, 'deleted');
  assert.equal(b.calls.length, 0);
});

test('runJob: ungültige URL, keine Engine wird gestartet', async () => {
  const a = fakeEngine('ytdlp', { download: { ok: true, files: [] } });
  const end = await runJob(job('kein link'), '/o', deps({ ytdlp: a }));
  assert.equal(end.errorCode, 'invalid_url');
  assert.equal(a.calls.length, 0);
});

test('runJob: Abbrechen während des Downloads', async () => {
  const ac = new AbortController();
  const a = fakeEngine('ytdlp', { download: () => { ac.abort(); return { ok: false, errorCode: 'cancelled', detail: null }; } });
  const end = await runJob(job(), '/o', deps({ ytdlp: a }, { signal: ac.signal }));
  assert.equal(end.state, 'cancelled');
});

test('runJob: keine Engine verfügbar → not_supported_by_engine', async () => {
  const a = fakeEngine('ytdlp', { download: { ok: true, files: [] } });
  const end = await runJob(job(), '/o', deps({ ytdlp: a }, { available: { ytdlp: false } }));
  assert.equal(end.errorCode, 'not_supported_by_engine');
});

test('probeWithFallback: Playlist-URL, A scheitert mit Rate-Limit → B', async () => {
  const a = fakeEngine('ytdlp', { probe: { ok: false, errorCode: 'rate_limited', detail: null } });
  const b = fakeEngine('ytdlp-cookies', { probe: { ok: true, metadata: meta } });
  const r = await probeWithFallback('https://www.youtube.com/watch?v=abcdefghijk&list=PLabc123', deps({ ytdlp: a, 'ytdlp-cookies': b }));
  assert.equal(r.ok, true);
  assert.equal(r.strategy, 'ytdlp-cookies');
  assert.deepEqual(a.calls, [['probe', 'https://www.youtube.com/playlist?list=PLabc123']]);
});

test('runJob: Bot-Check bei A, C liefert nur Hinweis → Fehler bleibt bot_check, Versuche protokolliert', async () => {
  const a = fakeEngine('ytdlp', { download: { ok: false, errorCode: 'bot_check', detail: 'x' } });
  const c = fakeEngine('official', { download: { ok: false, errorCode: 'needs_user_action', detail: 'studio_or_takeout' }, caps: { download: false } });
  const end = await runJob(job(), '/o', deps({ ytdlp: a, official: c }, { settings: { ...DEFAULT_SETTINGS } }));
  assert.equal(end.state, 'failed');
  assert.equal(end.errorCode, 'bot_check');
  assert.deepEqual(end.attempts.map((x) => [x.strategy, x.errorCode]), [['ytdlp', 'bot_check'], ['official', 'needs_user_action']]);
});
