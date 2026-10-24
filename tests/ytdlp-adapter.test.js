import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDownloadArgs, buildProbeArgs, formatArgs, playlistItemsArg } from '../src/adapters/ytdlp/args.js';
import { classifyError, mapInfoJson, parseLine } from '../src/adapters/ytdlp/parse.js';
import { createYtDlpEngine } from '../src/adapters/ytdlp/engine.js';
import { checkEngine } from '../src/core/engine.js';
import { DEFAULT_OPTIONS, ERROR_CODES, STRATEGY_IDS } from '../src/core/model.js';
import { fixture } from './helpers.js';

test('mapInfoJson: Fixtures', () => {
  for (const c of fixture('ytdlp-info.json').cases) assert.deepEqual(mapInfoJson(c.input), c.expected, c.name);
});

test('classifyError: Fixtures, alle Codes existieren im Modell', () => {
  for (const c of fixture('ytdlp-errors.json').cases) {
    const r = classifyError(c.stderr);
    assert.equal(r.errorCode, c.expected, c.stderr);
    assert.ok(ERROR_CODES.includes(r.errorCode));
  }
});

test('parseLine: Fortschritt, Titel, Datei, Playlist-Position, Nachbearbeitung', () => {
  assert.deepEqual(parseLine('@@P{"status":"downloading","downloaded_bytes":250,"total_bytes":1000,"speed":50.5,"eta":15}'), {
    type: 'progress', percent: 25, downloadedBytes: 250, totalBytes: 1000, speedBps: 50.5, etaSec: 15,
  });
  assert.equal(parseLine('@@P{"status":"finished","downloaded_bytes":1}').percent, 100);
  assert.equal(parseLine('@@P{"status":"downloading","fragment_index":3,"fragment_count":4}').percent, 75);
  assert.deepEqual(parseLine('@@TMein Titel'), { type: 'title', title: 'Mein Titel' });
  assert.deepEqual(parseLine('@@F"/out/a b.mp4"'), { type: 'file', path: '/out/a b.mp4' });
  assert.equal(parseLine('@@I0/0'), null);
  assert.deepEqual(parseLine('@@I2/7'), { type: 'progress', percent: 0, downloadedBytes: null, totalBytes: null, speedBps: null, etaSec: null, playlistIndex: 2, playlistCount: 7 });
  assert.deepEqual(parseLine('[Merger] Merging formats into "x.mp4"'), { type: 'phase', phase: 'postprocessing' });
  assert.equal(parseLine('[youtube] abc: Downloading webpage'), null);
  assert.equal(parseLine('@@P{kaputt'), null);
});

test('Argumente: Cookies nur bei Strategie B, URL immer nach --', () => {
  assert.deepEqual(buildProbeArgs('https://x', { cookieBrowser: null }).slice(-2), ['--', 'https://x']);
  assert.ok(!buildProbeArgs('u', { cookieBrowser: null }).includes('--cookies-from-browser'));
  const b = buildProbeArgs('u', { cookieBrowser: 'firefox' });
  assert.equal(b[b.indexOf('--cookies-from-browser') + 1], 'firefox');
});

test('Argumente: Formatwahl', () => {
  assert.deepEqual(formatArgs({ ...DEFAULT_OPTIONS, maxHeight: 720 }), ['-f', 'bv*+ba/b', '--merge-output-format', 'mp4', '-S', 'res:720,vcodec:h264,ext:mp4:m4a']);
  assert.deepEqual(formatArgs({ ...DEFAULT_OPTIONS, container: 'mkv' }), ['-f', 'bv*+ba/b', '--merge-output-format', 'mkv']);
  assert.deepEqual(formatArgs({ ...DEFAULT_OPTIONS, mode: 'audio', audioFormat: 'mp3', audioBitrateKbps: 192 }), ['-f', 'ba/b', '-S', 'aext:m4a', '-x', '--audio-format', 'mp3', '--audio-quality', '192K']);
  assert.deepEqual(formatArgs({ ...DEFAULT_OPTIONS, mode: 'audio', audioFormat: 'flac', audioBitrateKbps: 320 }), ['-f', 'ba/b', '-x', '--audio-format', 'flac']);
  assert.deepEqual(formatArgs({ ...DEFAULT_OPTIONS, mode: 'audio' }), ['-f', 'ba/b', '-x', '--audio-format', 'best']);
});

test('Argumente: Playlist-Ordner, kein Cover bei webm', () => {
  const req = { url: 'https://www.youtube.com/playlist?list=PLx', outputDir: '/out', options: { ...DEFAULT_OPTIONS, container: 'webm' } };
  const a = buildDownloadArgs(req, { cookieBrowser: null, isPlaylist: true });
  assert.ok(a.includes('--yes-playlist'));
  assert.ok(a[a.indexOf('-o') + 1].startsWith('%(playlist_title|Playlist)s/'));
  assert.ok(!a.includes('--embed-thumbnail'));
  assert.ok(a.includes('--embed-metadata'));
});

const fakeRunner = (result) => ({ calls: [], async run(cmd, args, opts) { this.calls.push({ cmd, args }); for (const l of result.lines ?? []) opts?.onLine?.('stdout', l); return { stdout: '', stderr: '', error: null, exitCode: 0, ...result }; } });

test('Argumente: Titelauswahl nur bei Playlists, als Bereiche zusammengefasst', () => {
  assert.equal(playlistItemsArg([1, 2, 3, 5, 7, 8]), '1-3,5,7-8');
  assert.equal(playlistItemsArg([4]), '4');
  const req = { url: 'https://www.youtube.com/playlist?list=PLabc123', options: DEFAULT_OPTIONS, outputDir: '/o', isPlaylist: true, playlistItems: [2, 3, 9] };
  const args = buildDownloadArgs(req, { cookieBrowser: null, isPlaylist: true });
  assert.equal(args[args.indexOf('--playlist-items') + 1], '2-3,9');
  assert.ok(args.indexOf('--playlist-items') < args.indexOf('--'));
  assert.ok(!buildDownloadArgs({ ...req, playlistItems: null }, { cookieBrowser: null, isPlaylist: true }).includes('--playlist-items'));
  assert.ok(!buildDownloadArgs({ ...req, isPlaylist: false }, { cookieBrowser: null, isPlaylist: false }).includes('--playlist-items'));
});

test('Engine A erfüllt den Vertrag', () => {
  assert.deepEqual(checkEngine(createYtDlpEngine({ id: 'ytdlp', runner: fakeRunner({}) }), STRATEGY_IDS), []);
  assert.deepEqual(checkEngine(createYtDlpEngine({ id: 'ytdlp-cookies', runner: fakeRunner({}), cookieBrowser: 'safari' }), STRATEGY_IDS), []);
});

test('Engine: fehlendes Programm → tool_missing; B ohne Browser nicht verfügbar', async () => {
  const missing = createYtDlpEngine({ id: 'ytdlp', runner: fakeRunner({ exitCode: null, error: 'not_found' }) });
  assert.deepEqual(await missing.checkAvailable(), { ok: false, version: null, errorCode: 'tool_missing' });
  const ctx = { signal: new AbortController().signal, onEvent: () => {} };
  assert.equal((await missing.probe('u', ctx)).errorCode, 'tool_missing');
  const b = createYtDlpEngine({ id: 'ytdlp-cookies', runner: fakeRunner({ stdout: '2026.08.19\n' }) });
  assert.equal((await b.checkAvailable()).errorCode, 'needs_user_action');
});

test('Engine: Download meldet Ereignisse und Dateien, Fehler werden klassifiziert', async () => {
  const ok = createYtDlpEngine({ id: 'ytdlp', runner: fakeRunner({ lines: ['@@TClip', '@@P{"status":"downloading","downloaded_bytes":5,"total_bytes":10}', 'irgendwas', '@@F"/out/Clip.mp4"'] }) });
  const events = [];
  const r = await ok.download({ url: 'https://youtu.be/abcdefghijk', isPlaylist: false, outputDir: '/out', options: DEFAULT_OPTIONS }, { signal: new AbortController().signal, onEvent: (e) => events.push(e.type) });
  assert.deepEqual(r, { ok: true, files: ['/out/Clip.mp4'] });
  assert.deepEqual(events, ['phase', 'title', 'progress', 'log', 'file']);

  const bot = createYtDlpEngine({ id: 'ytdlp', runner: fakeRunner({ exitCode: 1, stderr: 'ERROR: [youtube] x: Sign in to confirm you’re not a bot.' }) });
  const r2 = await bot.download({ url: 'u', isPlaylist: false, outputDir: '/out', options: DEFAULT_OPTIONS }, { signal: new AbortController().signal, onEvent: () => {} });
  assert.equal(r2.ok, false);
  assert.equal(r2.errorCode, 'bot_check');
});

test('ffmpeg: Umwandlungsargumente und sichere Dateinamen', async () => {
  const { buildConvertArgs, safeFileName } = await import('../src/adapters/ffmpeg.js');
  const mp3 = buildConvertArgs('/t/in.webm', '/o/Clip', { ...DEFAULT_OPTIONS, mode: 'audio', audioFormat: 'mp3', audioBitrateKbps: 256 }, { title: 'Clip', artist: null });
  assert.equal(mp3.output, '/o/Clip.mp3');
  assert.deepEqual(mp3.args.slice(-8), ['-vn', '-c:a', 'libmp3lame', '-b:a', '256k', '-metadata', 'title=Clip', '/o/Clip.mp3']);
  const flac = buildConvertArgs('/t/in.webm', '/o/C', { ...DEFAULT_OPTIONS, mode: 'audio', audioFormat: 'flac', audioBitrateKbps: 256, embedMetadata: false }, { title: 'C', artist: null });
  assert.ok(!flac.args.includes('-b:a') && !flac.args.includes('-metadata'));
  assert.equal(buildConvertArgs('i', '/o/C', { ...DEFAULT_OPTIONS, container: 'webm' }, { title: null, artist: null }).args.includes('copy'), true);
  assert.equal(safeFileName('a/b:c*?'), 'a b c');
  assert.equal(safeFileName('../..'), 'Aufnahme');
  assert.equal(safeFileName(null), 'Aufnahme');
});
