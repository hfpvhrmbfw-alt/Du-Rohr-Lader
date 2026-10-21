import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOfficialEngine } from '../src/adapters/official/engine.js';
import { classifyApiError, parseIsoDuration } from '../src/adapters/official/parse.js';
import { checkEngine } from '../src/core/engine.js';
import { STRATEGY_IDS } from '../src/core/model.js';
import { fixture } from './helpers.js';

const f = fixture('data-api.json');
const ctx = { signal: new AbortController().signal, onEvent: () => {} };
const fakeHttp = (routes) => ({
  urls: [],
  async getJson(url) {
    this.urls.push(url);
    const path = new URL(url).pathname.split('/').pop();
    return routes[path] ?? { status: 404, json: null, error: null };
  },
});

test('parseIsoDuration', () => {
  assert.equal(parseIsoDuration('PT1H2M3S'), 3723);
  assert.equal(parseIsoDuration('PT45S'), 45);
  assert.equal(parseIsoDuration('P1DT1S'), 86401);
  assert.equal(parseIsoDuration('P0D'), 0);
  assert.equal(parseIsoDuration('PT'), null);
  assert.equal(parseIsoDuration('1:02'), null);
});

test('classifyApiError', () => {
  assert.equal(classifyApiError(403, f.quota), 'rate_limited');
  assert.equal(classifyApiError(400, f.badKey), 'needs_api_key');
  assert.equal(classifyApiError(500, null), 'unknown');
});

test('Engine C: Vertrag, ohne Schlüssel nicht verfügbar', async () => {
  const e = createOfficialEngine({ http: fakeHttp({}), apiKey: null });
  assert.deepEqual(checkEngine(e, STRATEGY_IDS), []);
  assert.equal((await e.checkAvailable()).errorCode, 'needs_api_key');
  assert.equal((await e.probe('https://youtu.be/abcdefghijk', ctx)).errorCode, 'needs_api_key');
});

test('Engine C: Video-Metadaten', async () => {
  const http = fakeHttp({ videos: { status: 200, json: f.video, error: null } });
  const r = await createOfficialEngine({ http, apiKey: 'K' }).probe('https://youtu.be/abcdefghijk', ctx);
  assert.deepEqual(r, { ok: true, metadata: f.videoExpected });
  assert.match(http.urls[0], /videos\?part=.*&id=abcdefghijk&key=K$/);
});

test('Engine C: Playlist über mehrere Seiten', async () => {
  let page = 0;
  const http = {
    async getJson(url) {
      if (url.includes('/playlists?')) return { status: 200, json: { items: [{ id: 'PLabc123', snippet: { title: 'Liste', channelTitle: 'Anna' } }] }, error: null };
      page++;
      const items = [{ snippet: { title: `V${page}` }, contentDetails: { videoId: `vid${page}xxxxxxx`.slice(0, 11) } }];
      return { status: 200, json: { items, nextPageToken: page < 2 ? 'next' : undefined }, error: null };
    },
  };
  const r = await createOfficialEngine({ http, apiKey: 'K' }).probe('https://www.youtube.com/playlist?list=PLabc123', ctx);
  assert.ok(r.ok);
  assert.equal(r.metadata.kind, 'playlist');
  assert.deepEqual(r.metadata.entries.map((e) => e.title), ['V1', 'V2']);
});

test('Engine C: nicht gefunden, Kontingent erschöpft, Netz weg, kein Download', async () => {
  const empty = createOfficialEngine({ http: fakeHttp({ videos: { status: 200, json: { items: [] }, error: null } }), apiKey: 'K' });
  assert.equal((await empty.probe('https://youtu.be/abcdefghijk', ctx)).errorCode, 'deleted');
  const quota = createOfficialEngine({ http: fakeHttp({ videos: { status: 403, json: f.quota, error: null } }), apiKey: 'K' });
  assert.equal((await quota.probe('https://youtu.be/abcdefghijk', ctx)).errorCode, 'rate_limited');
  const net = createOfficialEngine({ http: fakeHttp({ videos: { status: 0, json: null, error: 'network' } }), apiKey: 'K' });
  assert.equal((await net.probe('https://youtu.be/abcdefghijk', ctx)).errorCode, 'network');
  assert.deepEqual(await quota.download(), { ok: false, errorCode: 'needs_user_action', detail: 'studio_or_takeout' });
});
