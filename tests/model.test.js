import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIO_BITRATES, DEFAULT_OPTIONS, DEFAULT_SETTINGS, ERROR_CODES, FINAL_ERROR_CODES, SCHEMA_VERSION, STRATEGY_IDS,
  buildExport, emptyJob, parseImport, sanitizeJob, sanitizeOptions, sanitizePlaylistItems, sanitizeSettings, upgradeRaw,
} from '../src/core/model.js';

test('Stammdaten: IDs eindeutig, Endfehler sind gültige Fehlercodes', () => {
  for (const list of [STRATEGY_IDS, ERROR_CODES, AUDIO_BITRATES]) assert.equal(new Set(list).size, list.length);
  for (const code of FINAL_ERROR_CODES) assert.ok(ERROR_CODES.includes(code), code);
});

test('sanitizeOptions: Unsinn → Standardwerte, gültige Werte bleiben', () => {
  assert.deepEqual(sanitizeOptions(null), DEFAULT_OPTIONS);
  assert.deepEqual(sanitizeOptions({ mode: 'hack', maxHeight: 999, audioBitrateKbps: '320' }), DEFAULT_OPTIONS);
  assert.deepEqual(sanitizeOptions({ mode: 'audio', audioFormat: 'mp3', audioBitrateKbps: 320 }), { ...DEFAULT_OPTIONS, mode: 'audio', audioFormat: 'mp3', audioBitrateKbps: 320 });
});

test('sanitizeSettings: unbekannte und doppelte Strategien fallen weg', () => {
  const s = sanitizeSettings({ chain: ['ytdlp', 'evil', 'ytdlp', 'official'], cookieBrowser: 'netscape' });
  assert.deepEqual(s.chain, ['ytdlp', 'official']);
  assert.equal(s.cookieBrowser, null);
  assert.deepEqual(sanitizeSettings({ chain: [] }).chain, DEFAULT_SETTINGS.chain);
});

test('Export → Import ergibt dieselben Daten', () => {
  const job = { ...emptyJob('j1', 'https://youtu.be/abcdefghijk', DEFAULT_OPTIONS, '2026-10-13T09:00:00Z'), state: 'done', files: ['/a.mp4'] };
  const exp = buildExport(DEFAULT_SETTINGS, [job], '2026-10-13T10:00:00Z');
  const back = parseImport(JSON.parse(JSON.stringify(exp)));
  assert.ok(back.ok);
  assert.deepEqual(back.history, [job]);
  assert.deepEqual(back.settings, DEFAULT_SETTINGS);
});

test('Import: kaputte, fremde und neuere Dateien werden abgelehnt', () => {
  assert.deepEqual(parseImport(null), { ok: false, error: 'not_json' });
  assert.deepEqual(parseImport({ app: 'andere-app', version: 1, history: [] }), { ok: false, error: 'wrong_app' });
  assert.deepEqual(parseImport({ app: 'youtube-downloader', version: SCHEMA_VERSION + 1, history: [] }), { ok: false, error: 'newer_version' });
  assert.deepEqual(parseImport({ app: 'youtube-downloader', version: 1 }), { ok: false, error: 'bad_format' });
  const r = parseImport({ app: 'youtube-downloader', version: 1, history: [{ id: 1 }, { id: 'a', url: 'u', createdAt: 't', state: '??' }] });
  assert.ok(r.ok);
  assert.equal(r.history.length, 1);
  assert.equal(r.history[0].state, 'failed');
});

test('upgradeRaw ist idempotent', () => {
  const raw = { app: 'youtube-downloader', version: 1, history: [] };
  assert.deepEqual(upgradeRaw(upgradeRaw(raw)), upgradeRaw(raw));
});

test('Titelauswahl: Positionen eindeutig, aufsteigend, ab 1; bleibt im Verlauf erhalten', () => {
  assert.equal(sanitizePlaylistItems(undefined), null);
  assert.equal(sanitizePlaylistItems('1,2'), null);
  assert.deepEqual(sanitizePlaylistItems([]), []);
  assert.deepEqual(sanitizePlaylistItems([5, 2, 2, 0, -1, 1.5, '3', 9]), [2, 5, 9]);
  const job = emptyJob('j1', 'https://www.youtube.com/playlist?list=PLabc123', DEFAULT_OPTIONS, '2026-10-24T10:00:00Z', [3, 1]);
  assert.deepEqual(job.playlistItems, [1, 3]);
  assert.equal(emptyJob('j2', 'u', DEFAULT_OPTIONS, 'x').playlistItems, null);
  assert.deepEqual(sanitizeJob(JSON.parse(JSON.stringify(job))).playlistItems, [1, 3]);
});
