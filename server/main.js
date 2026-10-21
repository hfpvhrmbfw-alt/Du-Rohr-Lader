#!/usr/bin/env node
// Hülle Phase 1: lokaler Server, standardmäßig nur auf 127.0.0.1. Setzt Kern und Adapter zusammen,
// bietet JSON-API und SSE (Fortschritt) für die PWA in web/ und liefert deren Dateien aus.
// Mit YTD_LAN=1 auch für gekoppelte Geräte im Heimnetz (iPhone/iPad als Fernbedienung, siehe access.js).

import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { homedir, hostname, networkInterfaces, platform } from 'node:os';
import { basename, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createFfmpeg } from '../src/adapters/ffmpeg.js';
import { createFileStore } from '../src/adapters/file-store.js';
import { createHttpClient } from '../src/adapters/http.js';
import { createProcessRunner } from '../src/adapters/process.js';
import { createCaptureEngine } from '../src/adapters/capture/engine.js';
import { createOfficialEngine } from '../src/adapters/official/engine.js';
import { createYtDlpEngine } from '../src/adapters/ytdlp/engine.js';
import { fetchLatestYtDlp } from '../src/adapters/ytdlp/update.js';
import { isNewerVersion } from '../src/core/logic.js';
import { buildExport, parseImport, sanitizeOptions, sanitizeSettings } from '../src/core/model.js';
import { probeWithFallback } from '../src/core/orchestrator.js';
import { createAccessPolicy, isLoopback } from './access.js';
import { createJobManager } from './jobs.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const LAN = process.env.YTD_LAN === '1';
const HOST = LAN ? '0.0.0.0' : '127.0.0.1';
const DATA_DIR = process.env.YTD_DATA_DIR || (platform() === 'darwin' ? join(homedir(), 'Library', 'Application Support', 'YouTube-Downloader') : join(homedir(), '.local', 'share', 'youtube-downloader'));
const DEFAULT_OUT = join(homedir(), 'Downloads', 'YouTube-Downloader');
const YTDLP = process.env.YTDLP_BIN || 'yt-dlp';
const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg';

const now = () => new Date().toISOString();
const runner = createProcessRunner();
const http = createHttpClient();
const ffmpeg = createFfmpeg({ runner, binary: FFMPEG });
const store = createFileStore(DATA_DIR, now);
const loaded = store.load();
let settings = loaded.settings;
let secrets = store.loadSecrets();
const lanHosts = () => {
  const name = hostname();
  const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  return [...new Set([...ips, name, name.endsWith('.local') ? name : `${name}.local`])];
};
const access = createAccessPolicy({
  port: PORT,
  lan: LAN,
  lanHosts: LAN ? lanHosts() : [],
  token: LAN ? store.pairingToken(() => randomBytes(18).toString('base64url'), process.env.YTD_PAIR_RESET === '1') : null,
});
const loadPlaywright = () => import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');

const buildEngines = () => ({
  ytdlp: createYtDlpEngine({ id: 'ytdlp', runner, binary: YTDLP }),
  'ytdlp-cookies': createYtDlpEngine({ id: 'ytdlp-cookies', runner, binary: YTDLP, cookieBrowser: settings.cookieBrowser }),
  official: createOfficialEngine({ http, apiKey: process.env.YOUTUBE_API_KEY || secrets.youtubeApiKey }),
  'browser-capture': createCaptureEngine({
    loadPlaywright,
    ffmpeg,
    profileDir: join(DATA_DIR, 'browser-profile'),
    channel: process.env.CAPTURE_CHANNEL || undefined,
  }),
});

let engines = buildEngines();
/** @type {{at: number, result: Object<string, {ok: boolean, version: string|null, errorCode: string|null}>}|null} */
let availability = null;
const checkAll = async (force = false) => {
  if (!force && availability && Date.now() - availability.at < 60_000) return availability.result;
  const result = {};
  for (const [id, e] of Object.entries(engines)) result[id] = await e.checkAvailable();
  availability = { at: Date.now(), result };
  return result;
};
const refresh = () => {
  engines = buildEngines();
  availability = null;
};

const jobs = createJobManager({
  newId: randomUUID,
  now,
  history: loaded.history,
  onHistory: (history) => store.save(settings, history),
  context: async () => {
    const avail = await checkAll();
    return {
      engines,
      available: Object.fromEntries(Object.entries(avail).map(([k, v]) => [k, v.ok])),
      settings,
      outputDir: settings.outputDir || DEFAULT_OUT,
    };
  },
});

// ---------- HTTP ----------

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const MEDIA = { '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.opus': 'audio/ogg', '.ogg': 'audio/ogg' };

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((ok) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 5_000_000) req.destroy();
      else chunks.push(c);
    });
    req.on('end', () => {
      try {
        ok(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
      } catch {
        ok(undefined);
      }
    });
  });

const staticFile = async (res, base, rel) => {
  const file = resolve(base, normalize(rel));
  if (!file.startsWith(base + sep) && file !== base) return send(res, 404, { error: 'not_found' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch {
    send(res, 404, { error: 'not_found' });
  }
};

const knownFiles = () => new Set([...jobs.list(), ...jobs.history()].flatMap((j) => j.files));

const status = async (force, local) => {
  const avail = await checkAll(force);
  const ff = await ffmpeg.checkAvailable();
  return {
    settings,
    outputDir: settings.outputDir || DEFAULT_OUT,
    platform: platform(),
    tools: {
      ytdlp: avail.ytdlp,
      ffmpeg: { ok: ff.ok, version: ff.version, errorCode: ff.ok ? null : 'tool_missing' },
      strategies: avail,
      apiKeySet: Boolean(process.env.YOUTUBE_API_KEY || secrets.youtubeApiKey),
    },
    storeWarning: loaded.warning,
    // Nur dieser Rechner sieht die Kopplungs-Links; ein gekoppeltes iPhone braucht sie nicht.
    client: { local, lan: LAN, pairUrls: local ? access.pairUrls() : [] },
  };
};

const routes = {
  'GET /api/status': async (req, res, url) => send(res, 200, await status(url.searchParams.get('refresh') === '1', isLoopback(req.socket.remoteAddress))),

  'PUT /api/settings': async (req, res) => {
    const body = await readBody(req);
    if (!body || typeof body !== 'object') return send(res, 400, { error: 'bad_request' });
    settings = sanitizeSettings({ ...settings, ...body, defaults: { ...settings.defaults, ...(body.defaults || {}) } });
    store.save(settings, jobs.history());
    refresh();
    send(res, 200, settings);
  },

  'PUT /api/secrets': async (req, res) => {
    const body = await readBody(req);
    const key = typeof body?.youtubeApiKey === 'string' ? body.youtubeApiKey.trim() : null;
    secrets = { youtubeApiKey: key || null };
    store.saveSecrets(secrets);
    refresh();
    send(res, 200, { apiKeySet: Boolean(secrets.youtubeApiKey) });
  },

  'POST /api/probe': async (req, res) => {
    const body = await readBody(req);
    if (typeof body?.url !== 'string') return send(res, 400, { error: 'bad_request' });
    const avail = await checkAll();
    const ac = new AbortController();
    req.on('close', () => !res.writableEnded && ac.abort());
    const opts = sanitizeOptions({ ...settings.defaults, wholePlaylist: body.wholePlaylist ?? settings.defaults.wholePlaylist });
    const result = await probeWithFallback(body.url, {
      engines,
      available: Object.fromEntries(Object.entries(avail).map(([k, v]) => [k, v.ok])),
      settings: { ...settings, defaults: opts },
      signal: ac.signal,
    });
    send(res, 200, result);
  },

  'GET /api/jobs': async (req, res) => send(res, 200, jobs.list()),

  'POST /api/jobs': async (req, res) => {
    const body = await readBody(req);
    if (!settings.legalNoticeAccepted) return send(res, 403, { error: 'legal_notice_not_accepted' });
    if (typeof body?.url !== 'string') return send(res, 400, { error: 'bad_request' });
    send(res, 201, jobs.add(body.url, sanitizeOptions(body.options)));
  },

  'GET /api/history': async (req, res) => send(res, 200, jobs.history()),
  'DELETE /api/history': async (req, res) => {
    jobs.replaceHistory([]);
    send(res, 200, []);
  },
  'GET /api/export': async (req, res) => send(res, 200, buildExport(settings, jobs.history(), now())),
  'POST /api/import': async (req, res) => {
    const r = parseImport(await readBody(req));
    if (!r.ok) return send(res, 400, { error: r.error });
    settings = { ...r.settings, legalNoticeAccepted: settings.legalNoticeAccepted };
    const ids = new Set(r.history.map((h) => h.id));
    jobs.replaceHistory([...r.history, ...jobs.history().filter((h) => !ids.has(h.id))]);
    refresh();
    send(res, 200, { settings, count: r.history.length });
  },

  'GET /api/update-check': async (req, res) => {
    const installed = (await checkAll()).ytdlp;
    const latest = await fetchLatestYtDlp(http);
    if (!latest.ok) return send(res, 200, { ok: false, errorCode: latest.errorCode, installed: installed.version });
    const newer = installed.version ? isNewerVersion(installed.version, latest.latest) : null;
    send(res, 200, { ok: true, installed: installed.version, latest: latest.latest, updateAvailable: newer, url: latest.url });
  },

  'GET /api/file': async (req, res, url) => {
    // Fertige Datei auf das anfragende Gerät übertragen (z. B. iPhone → App „Dateien“). Nur bekannte Dateien.
    const path = url.searchParams.get('path') ?? '';
    if (!knownFiles().has(path)) return send(res, 404, { error: 'unknown_file' });
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) return send(res, 404, { error: 'file_missing' });
    const name = basename(path);
    res.writeHead(200, {
      'content-type': MEDIA[extname(name).toLowerCase()] ?? 'application/octet-stream',
      'content-length': info.size,
      'content-disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'cache-control': 'no-store',
    });
    createReadStream(path).pipe(res);
  },

  'POST /api/reveal': async (req, res) => {
    if (!isLoopback(req.socket.remoteAddress)) return send(res, 403, { error: 'local_only' });
    const body = await readBody(req);
    if (typeof body?.path !== 'string' || !knownFiles().has(body.path)) return send(res, 404, { error: 'unknown_file' });
    const r = platform() === 'darwin' ? await runner.run('open', ['-R', body.path]) : await runner.run('xdg-open', [join(body.path, '..')]);
    send(res, 200, { ok: r.exitCode === 0 });
  },

  'GET /api/events': async (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    const write = (msg) => res.write(`data: ${JSON.stringify(msg)}\n\n`);
    write({ type: 'hello', jobs: jobs.list(), history: jobs.history() });
    const off = jobs.subscribe(write);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      off();
      clearInterval(ping);
    });
  },
};

const NOT_PAIRED = `<!DOCTYPE html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Nicht gekoppelt</title>
<body style="font:17px/1.5 system-ui;margin:0;padding:max(24px,env(safe-area-inset-top)) 24px;max-width:36em"><h1>Gerät nicht gekoppelt</h1>
<p>Öffne den YouTube-Downloader auf deinem Mac, gehe zu <b>Einstellungen → iPhone und iPad</b> und scanne den QR-Code mit der Kamera dieses Geräts.</p></body></html>`;

// Startadresse der installierten App enthält den Kopplungsschlüssel, weil iOS-Home-Bildschirm-Apps eigene Cookies haben.
const manifestFor = async (pair) => {
  const m = JSON.parse(await readFile(join(ROOT, 'web', 'manifest.webmanifest'), 'utf8'));
  if (pair) m.start_url = `/?pair=${encodeURIComponent(pair)}`;
  return JSON.stringify(m);
};

const server = createServer(async (req, res) => {
  // Nur eigene Oberfläche annehmen: dieser Rechner oder (mit YTD_LAN=1) gekoppelte Geräte. Siehe access.js.
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const pair = url.searchParams.get('pair');
  const gate = access.check({ method: req.method ?? 'GET', path, host: req.headers.host, origin: req.headers.origin, remote: req.socket.remoteAddress, cookie: req.headers.cookie, pair });
  if (!gate.ok) {
    if (gate.error === 'not_paired' && !path.startsWith('/api/')) {
      res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(NOT_PAIRED);
    }
    return send(res, gate.status, { error: gate.error });
  }
  if (gate.setCookie) res.setHeader('set-cookie', gate.setCookie);

  const m = /^\/api\/jobs\/([\w-]+)\/(cancel|retry)$/.exec(path);
  try {
    if (m && req.method === 'POST') {
      if (m[2] === 'cancel') return send(res, jobs.cancel(m[1]) ? 200 : 404, { ok: true });
      const again = jobs.retry(m[1]);
      return again ? send(res, 200, again) : send(res, 404, { error: 'not_retryable' });
    }
    const handler = routes[`${req.method} ${path}`];
    if (handler) return await handler(req, res, url);
    if (path.startsWith('/api/')) return send(res, 404, { error: 'not_found' });
    if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
    if (path.startsWith('/core/')) return staticFile(res, join(ROOT, 'src', 'core'), path.slice('/core/'.length));
    if (path === '/manifest.webmanifest' && !gate.local) {
      res.writeHead(200, { 'content-type': TYPES['.webmanifest'], 'cache-control': 'no-store' });
      return res.end(await manifestFor(gate.paired ? access.token : null));
    }
    return staticFile(res, join(ROOT, 'web'), path === '/' ? 'index.html' : path.slice(1));
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: 'internal' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`YouTube-Downloader läuft auf http://127.0.0.1:${PORT}`);
  if (LAN) console.log(`Heimnetz an (YTD_LAN=1). iPhone koppeln: ${access.pairUrls()[0] ?? '–'} (QR-Code unter Einstellungen)`);
  console.log(`Daten: ${DATA_DIR}`);
});
