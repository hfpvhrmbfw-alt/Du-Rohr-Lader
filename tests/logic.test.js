import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyJobEvent, isNewerVersion, nextStrategy, parseUrl, pickFormats, targetUrl } from '../src/core/logic.js';
import { DEFAULT_OPTIONS, emptyJob } from '../src/core/model.js';
import { fixture, subset } from './helpers.js';

test('parseUrl: Fixtures', () => {
  for (const c of fixture('parse-url.json').cases) {
    assert.deepEqual(parseUrl(c.input), c.expected, c.input);
  }
});

test('targetUrl: Video in Playlist folgt der Option wholePlaylist', () => {
  const parsed = parseUrl('https://www.youtube.com/watch?v=abcdefghijk&list=PLabc123');
  assert.ok(parsed.ok);
  assert.equal(targetUrl(parsed, { ...DEFAULT_OPTIONS, wholePlaylist: true }), 'https://www.youtube.com/playlist?list=PLabc123');
  assert.equal(targetUrl(parsed, { ...DEFAULT_OPTIONS, wholePlaylist: false }), 'https://www.youtube.com/watch?v=abcdefghijk');
});

test('pickFormats: Fixtures', () => {
  const f = fixture('formats.json');
  for (const c of f.cases) {
    const r = pickFormats(f.formats, c.options);
    assert.deepEqual(
      { video: r.video?.id ?? null, audio: r.audio?.id ?? null, merge: r.merge, transcode: r.transcode },
      c.expected,
      c.name,
    );
  }
});

test('pickFormats: nur DRM-Formate → nichts wählbar', () => {
  const r = pickFormats([{ id: 'x', kind: 'muxed', ext: 'mp4', height: 720, fps: 25, vcodec: 'avc1', acodec: 'mp4a', abrKbps: 128, tbrKbps: 1, sizeBytes: null, drm: true }], { mode: 'video' });
  assert.deepEqual(r, { video: null, audio: null, merge: false, transcode: false });
});

test('nextStrategy: Fixtures', () => {
  const f = fixture('next-strategy.json');
  for (const c of f.cases) {
    assert.equal(nextStrategy({ ...f.base, ...c.input }), c.expected, c.name);
  }
});

test('applyJobEvent: Fixtures', () => {
  for (const c of fixture('job-events.json').cases) {
    const start = emptyJob('j1', 'https://youtu.be/abcdefghijk', DEFAULT_OPTIONS, '2026-10-13T09:00:00Z');
    const end = c.events.reduce(applyJobEvent, start);
    assert.deepEqual(subset(end, c.expected), c.expected, c.name);
  }
});

test('applyJobEvent: verändert die Eingabe nicht', () => {
  const start = emptyJob('j1', 'u', DEFAULT_OPTIONS, 't');
  const copy = JSON.stringify(start);
  applyJobEvent(start, { type: 'started', strategy: 'ytdlp' });
  assert.equal(JSON.stringify(start), copy);
});

test('applyJobEvent: fertiger Job lässt sich nicht wiederholen', () => {
  let job = emptyJob('j1', 'u', DEFAULT_OPTIONS, 't');
  job = applyJobEvent(job, { type: 'done', at: 'x' });
  assert.equal(applyJobEvent(job, { type: 'retry' }), job);
});

test('isNewerVersion', () => {
  assert.equal(isNewerVersion('2026.08.19', '2026.09.01'), true);
  assert.equal(isNewerVersion('2026.08.19', '2026.08.19'), false);
  assert.equal(isNewerVersion('2026.08.19.1', '2026.08.19'), false);
  assert.equal(isNewerVersion('2026.08.19', '2026.08.19.1'), true);
  assert.equal(isNewerVersion('2025.12.31', '2026.01.01'), true);
  assert.equal(isNewerVersion('v2026.01.01', '2026.01.01'), false);
  assert.equal(isNewerVersion('kaputt', '2026.01.01'), null);
});

test('primaryError: erster Fehler, der etwas über das Video sagt', async () => {
  const { primaryError } = await import('../src/core/logic.js');
  assert.equal(primaryError([]), null);
  assert.deepEqual(primaryError([{ strategy: 'ytdlp', errorCode: 'tool_missing', detail: null }, { strategy: 'browser-capture', errorCode: 'drm', detail: 'd' }]), { errorCode: 'drm', detail: 'd' });
  assert.deepEqual(primaryError([{ strategy: 'official', errorCode: 'needs_api_key', detail: null }]), { errorCode: 'needs_api_key', detail: null });
});

test('addToHistory: nur abgeschlossene Jobs, neueste zuerst, ersetzt gleiche ID, begrenzt', async () => {
  const { addToHistory } = await import('../src/core/logic.js');
  const mk = (id, state) => ({ ...emptyJob(id, 'u', DEFAULT_OPTIONS, 't'), state });
  assert.deepEqual(addToHistory([], mk('a', 'downloading')), []);
  let h = addToHistory([], mk('a', 'failed'));
  h = addToHistory(h, mk('b', 'done'));
  h = addToHistory(h, mk('a', 'done'));
  assert.deepEqual(h.map((j) => [j.id, j.state]), [['a', 'done'], ['b', 'done']]);
  assert.equal(addToHistory(h, mk('c', 'done'), 2).length, 2);
});
