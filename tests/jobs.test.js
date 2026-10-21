import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJobManager } from '../server/jobs.js';
import { DEFAULT_OPTIONS, DEFAULT_SETTINGS } from '../src/core/model.js';

const engine = (impl) => ({
  id: 'ytdlp',
  capabilities: () => ({ metadata: true, download: true, audioOnly: true, playlist: true, needsUserAction: false }),
  checkAvailable: async () => ({ ok: true, version: '1', errorCode: null }),
  probe: async () => ({ ok: false, errorCode: 'unknown', detail: null }),
  download: impl,
});

const manager = (download, saved = []) => {
  let n = 0;
  return createJobManager({
    newId: () => `job${++n}`,
    now: () => '2026-10-13T12:00:00Z',
    history: [],
    onHistory: (h) => saved.push(h),
    context: async () => ({ engines: { ytdlp: engine(download) }, available: { ytdlp: true }, settings: DEFAULT_SETTINGS, outputDir: '/o' }),
  });
};

const until = (m, id, states) =>
  new Promise((ok) => {
    const off = m.subscribe((msg) => {
      if (msg.type === 'job' && msg.job.id === id && states.includes(msg.job.state)) {
        off();
        ok(msg.job);
      }
    });
  });

test('Jobs: Warteschlange, Verlauf, Wiederholen', async () => {
  let fail = true;
  const saved = [];
  const m = manager(async () => (fail ? { ok: false, errorCode: 'network', detail: null } : { ok: true, files: ['/o/x.mp4'] }), saved);
  const job = m.add('https://youtu.be/abcdefghijk', DEFAULT_OPTIONS);
  const failed = await until(m, job.id, ['failed']);
  assert.equal(failed.errorCode, 'network');
  await new Promise((r) => setTimeout(r, 10)); // Verlauf wird nach dem Endzustand geschrieben
  assert.equal(m.history()[0].state, 'failed');
  fail = false;
  const again = m.retry(job.id);
  assert.equal(again.attempt, 2);
  const done = await until(m, job.id, ['done']);
  assert.deepEqual(done.files, ['/o/x.mp4']);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(m.history().length, 1);
  assert.equal(m.history()[0].state, 'done');
  assert.ok(saved.length >= 2);
});

test('Jobs: laufenden und wartenden Auftrag abbrechen', async () => {
  const m = manager((req, ctx) => new Promise((ok) => ctx.signal.addEventListener('abort', () => ok({ ok: false, errorCode: 'cancelled', detail: null }))));
  const a = m.add('https://youtu.be/abcdefghijk', DEFAULT_OPTIONS);
  const b = m.add('https://youtu.be/bbcdefghijk', DEFAULT_OPTIONS);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(m.cancel(b.id), true); // wartet noch
  assert.equal(m.list().find((j) => j.id === b.id).state, 'cancelled');
  const p = until(m, a.id, ['cancelled']);
  assert.equal(m.cancel(a.id), true);
  assert.equal((await p).state, 'cancelled');
  assert.equal(m.cancel(a.id), false);
});
