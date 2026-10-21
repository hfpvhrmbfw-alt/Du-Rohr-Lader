// Logik: reine Funktionen. Kein DOM, kein Netz, keine Dateien, keine Uhr, keine Prozesse.
// Zeitstempel kommen als Parameter; Ergebnisse sind Daten, nie Anzeigetexte.

import { FINAL_ERROR_CODES, FINAL_JOB_STATES, HISTORY_LIMIT, sanitizeOptions } from './model.js';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{2,64}$/;
const YT_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'];

/**
 * @typedef {Object} ParsedUrl
 * @property {true} ok
 * @property {'video'|'short'|'live'|'playlist'|'video-in-playlist'|'channel'|'other-site'} kind
 * @property {string|null} videoId
 * @property {string|null} playlistId
 * @property {string} normalizedUrl  kanonische URL für die Engines
 * @property {string|null} playlistUrl
 */

/**
 * Erkennt YouTube-URLs aller üblichen Formen. Andere http(s)-Seiten sind 'other-site'.
 * @param {string} input
 * @returns {ParsedUrl | {ok: false, error: 'empty'|'invalid_url'|'unsupported_scheme'|'missing_id'}}
 */
export function parseUrl(input) {
  const text = typeof input === 'string' ? input.trim() : '';
  if (text === '') return { ok: false, error: 'empty' };
  if (/\s/.test(text)) return { ok: false, error: 'invalid_url' };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  let u;
  try {
    u = new URL(withScheme);
  } catch {
    return { ok: false, error: 'invalid_url' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, error: 'unsupported_scheme' };
  const host = u.hostname.toLowerCase();
  if (!host.includes('.')) return { ok: false, error: 'invalid_url' };

  const watch = (id) => `https://www.youtube.com/watch?v=${id}`;
  const list = (id) => `https://www.youtube.com/playlist?list=${id}`;
  const listParam = u.searchParams.get('list');
  const playlistId = listParam && PLAYLIST_ID.test(listParam) ? listParam : null;

  /** @returns {ParsedUrl|{ok:false,error:'missing_id'}} */
  const video = (id, kind) => {
    if (!id || !VIDEO_ID.test(id)) return { ok: false, error: 'missing_id' };
    if (playlistId) {
      return { ok: true, kind: 'video-in-playlist', videoId: id, playlistId, normalizedUrl: watch(id), playlistUrl: list(playlistId) };
    }
    return { ok: true, kind, videoId: id, playlistId: null, normalizedUrl: watch(id), playlistUrl: null };
  };

  if (host === 'youtu.be') {
    return video(u.pathname.split('/')[1] || null, 'video');
  }
  if (YT_HOSTS.includes(host)) {
    const parts = u.pathname.split('/').filter((p) => p !== '');
    const first = parts[0] || '';
    if (first === 'watch') return video(u.searchParams.get('v'), 'video');
    if (first === 'shorts') return video(parts[1] || null, 'short');
    if (first === 'live') return video(parts[1] || null, 'live');
    if (first === 'embed' || first === 'v') return video(parts[1] || null, 'video');
    if (first === 'playlist') {
      if (!playlistId) return { ok: false, error: 'missing_id' };
      return { ok: true, kind: 'playlist', videoId: null, playlistId, normalizedUrl: list(playlistId), playlistUrl: list(playlistId) };
    }
    if (first.startsWith('@') || first === 'channel' || first === 'c' || first === 'user') {
      return { ok: true, kind: 'channel', videoId: null, playlistId: null, normalizedUrl: `https://www.youtube.com${u.pathname}`, playlistUrl: null };
    }
    return { ok: false, error: 'missing_id' };
  }
  return { ok: true, kind: 'other-site', videoId: null, playlistId: null, normalizedUrl: u.toString(), playlistUrl: null };
}

/**
 * Welche URL soll die Engine bekommen? Bei Video-in-Playlist entscheidet die Option.
 * @param {ParsedUrl} parsed
 * @param {import('./model.js').DownloadRequestOptions} options
 */
export function targetUrl(parsed, options) {
  if (parsed.kind === 'video-in-playlist' && options.wholePlaylist && parsed.playlistUrl) return parsed.playlistUrl;
  return parsed.normalizedUrl;
}

const CONTAINER_VIDEO_PREF = { mp4: ['avc1', 'h264', 'av01', 'vp09', 'vp9'], webm: ['vp09', 'vp9', 'av01'], mkv: ['av01', 'vp09', 'vp9', 'avc1', 'h264'] };
const CONTAINER_AUDIO_PREF = { mp4: ['m4a', 'mp4'], webm: ['webm', 'opus'], mkv: ['webm', 'opus', 'm4a'] };
const AUDIO_TARGET_PREF = { original: ['m4a', 'webm', 'opus'], mp3: ['m4a', 'webm'], m4a: ['m4a', 'mp4'], flac: ['webm', 'opus', 'm4a'], opus: ['webm', 'opus'] };

const rank = (list, value) => {
  if (!value) return list.length;
  const i = list.findIndex((p) => value.toLowerCase().startsWith(p));
  return i === -1 ? list.length : i;
};
const n = (x) => (x === null ? -1 : x);

/**
 * @typedef {Object} FormatChoice
 * @property {import('./model.js').MediaFormat|null} video
 * @property {import('./model.js').MediaFormat|null} audio
 * @property {boolean} merge      Video und Audio werden zusammengeführt (ffmpeg)
 * @property {boolean} transcode  Audio wird umgewandelt (ffmpeg)
 */

/**
 * Vorschau, was mit den gewählten Optionen geladen wird. Formate mit DRM werden nie gewählt.
 * Bei Gleichstand gilt die Reihenfolge der Eingabeliste.
 * @param {import('./model.js').MediaFormat[]} formats
 * @param {import('./model.js').DownloadRequestOptions} rawOptions
 * @returns {FormatChoice}
 */
export function pickFormats(formats, rawOptions) {
  const o = sanitizeOptions(rawOptions);
  const usable = formats.map((f, index) => ({ f, index })).filter(({ f }) => !f.drm);
  const audios = usable.filter(({ f }) => f.kind === 'audio');

  const audioPref = o.mode === 'audio' ? AUDIO_TARGET_PREF[o.audioFormat] : CONTAINER_AUDIO_PREF[o.container];
  const bestAudio = audios
    .slice()
    .sort((a, b) => rank(audioPref, a.f.ext) - rank(audioPref, b.f.ext) || n(b.f.abrKbps) - n(a.f.abrKbps) || a.index - b.index)[0];

  if (o.mode === 'audio') {
    if (!bestAudio) {
      const muxed = usable.filter(({ f }) => f.kind === 'muxed').sort((a, b) => n(b.f.abrKbps) - n(a.f.abrKbps) || a.index - b.index)[0];
      return { video: null, audio: muxed ? muxed.f : null, merge: false, transcode: muxed !== undefined };
    }
    const keep = o.audioFormat === 'original' || (o.audioFormat === 'm4a' && bestAudio.f.ext === 'm4a') || (o.audioFormat === 'opus' && bestAudio.f.acodec === 'opus');
    return { video: null, audio: bestAudio.f, merge: false, transcode: !keep };
  }

  const fits = ({ f }) => o.maxHeight === null || (f.height !== null && f.height <= o.maxHeight);
  const videoPref = CONTAINER_VIDEO_PREF[o.container];
  const videos = usable
    .filter(({ f }) => (f.kind === 'video' || f.kind === 'muxed') && fits({ f }))
    .sort(
      (a, b) =>
        n(b.f.height) - n(a.f.height) ||
        rank(videoPref, a.f.vcodec) - rank(videoPref, b.f.vcodec) ||
        n(b.f.fps) - n(a.f.fps) ||
        n(b.f.tbrKbps) - n(a.f.tbrKbps) ||
        a.index - b.index,
    );
  const bestVideo = videos[0];
  if (!bestVideo) return { video: null, audio: null, merge: false, transcode: false };
  if (bestVideo.f.kind === 'muxed' || !bestAudio) return { video: bestVideo.f, audio: null, merge: false, transcode: false };
  return { video: bestVideo.f, audio: bestAudio.f, merge: true, transcode: false };
}

/**
 * @typedef {{type:'started', strategy:string}
 *  | {type:'phase', phase:'probing'|'downloading'|'postprocessing'}
 *  | {type:'progress', percent:number|null, downloadedBytes:number|null, totalBytes:number|null, speedBps:number|null, etaSec:number|null, playlistIndex?:number|null, playlistCount?:number|null}
 *  | {type:'title', title:string}
 *  | {type:'file', path:string}
 *  | {type:'strategy-failed', strategy:string, errorCode:string, detail:string|null}
 *  | {type:'done', at:string}
 *  | {type:'failed', errorCode:string, detail:string|null, at:string}
 *  | {type:'cancelled', at:string}
 *  | {type:'retry'}} JobEvent
 */

/**
 * Zustandsmaschine eines Download-Jobs. Gibt immer ein neues Objekt zurück.
 * Abgeschlossene Jobs reagieren nur noch auf 'retry'.
 * @param {import('./model.js').Job} job
 * @param {JobEvent} event
 * @returns {import('./model.js').Job}
 */
export function applyJobEvent(job, event) {
  const final = FINAL_JOB_STATES.includes(job.state);
  if (final && event.type !== 'retry') return job;
  switch (event.type) {
    case 'started':
      return {
        ...job,
        state: 'probing',
        strategy: event.strategy,
        tried: job.tried.includes(event.strategy) ? job.tried : [...job.tried, event.strategy],
        percent: null,
        speedBps: null,
        etaSec: null,
      };
    case 'phase':
      return { ...job, state: event.phase };
    case 'progress':
      return {
        ...job,
        state: job.state === 'postprocessing' ? 'postprocessing' : 'downloading',
        percent: event.percent === null ? job.percent : Math.max(0, Math.min(100, event.percent)),
        downloadedBytes: event.downloadedBytes,
        totalBytes: event.totalBytes,
        speedBps: event.speedBps,
        etaSec: event.etaSec,
        playlistIndex: event.playlistIndex ?? job.playlistIndex,
        playlistCount: event.playlistCount ?? job.playlistCount,
      };
    case 'title':
      return { ...job, title: event.title };
    case 'file':
      return job.files.includes(event.path) ? job : { ...job, files: [...job.files, event.path] };
    case 'strategy-failed':
      return {
        ...job,
        errorCode: event.errorCode,
        errorDetail: event.detail,
        attempts: [...job.attempts, { strategy: event.strategy, errorCode: event.errorCode, detail: event.detail }],
      };
    case 'done':
      return { ...job, state: 'done', percent: 100, speedBps: null, etaSec: null, errorCode: null, errorDetail: null, finishedAt: event.at };
    case 'failed':
      return { ...job, state: 'failed', speedBps: null, etaSec: null, errorCode: event.errorCode, errorDetail: event.detail, finishedAt: event.at };
    case 'cancelled':
      return { ...job, state: 'cancelled', speedBps: null, etaSec: null, errorCode: 'cancelled', errorDetail: null, finishedAt: event.at };
    case 'retry':
      if (!final || job.state === 'done') return job;
      return {
        ...job,
        state: 'queued',
        strategy: null,
        tried: [],
        attempts: [],
        percent: null,
        downloadedBytes: null,
        totalBytes: null,
        speedBps: null,
        etaSec: null,
        files: [],
        errorCode: null,
        errorDetail: null,
        attempt: job.attempt + 1,
        finishedAt: null,
      };
    default:
      return job;
  }
}

/** Codes, die nur sagen „diese Strategie kann das nicht“, nicht warum das Video scheitert. */
const SECONDARY_ERRORS = ['needs_user_action', 'needs_api_key', 'not_supported_by_engine', 'tool_missing', 'cookies_unavailable'];

/**
 * Aussagekräftigster Fehler einer Versuchsreihe: der erste, der etwas über das Video sagt,
 * sonst der erste überhaupt.
 * @param {import('./model.js').Attempt[]} attempts
 * @returns {{errorCode: string, detail: string|null}|null}
 */
export function primaryError(attempts) {
  const hit = attempts.find((a) => !SECONDARY_ERRORS.includes(a.errorCode)) ?? attempts[0];
  return hit ? { errorCode: hit.errorCode, detail: hit.detail } : null;
}

/** Fehler, bei denen Cookies des eigenen Browsers helfen können (Strategie B). */
const COOKIES_HELP = ['bot_check', 'age_restricted', 'members_only', 'login_required', 'private', 'rate_limited', 'unknown'];
/** Fehler, bei denen eine Aufnahme im sichtbaren Browser helfen kann (Strategie D). */
const CAPTURE_HELPS = ['bot_check', 'age_restricted', 'members_only', 'login_required', 'private', 'rate_limited', 'region_blocked', 'tool_missing', 'unknown'];

/**
 * @typedef {Object} FallbackInput
 * @property {string[]} chain         Reihenfolge laut Einstellungen
 * @property {string[]} tried         schon versuchte Strategien
 * @property {string|null} lastErrorCode null = noch nichts versucht
 * @property {Object<string, boolean>} available  Strategie → Programm/Schlüssel vorhanden
 * @property {string|null} cookieBrowser
 * @property {boolean} allowBrowserCapture
 * @property {boolean} isPlaylist
 */

/**
 * Nächste Strategie der Fallback-Kette oder null, wenn keine mehr sinnvoll ist.
 * @param {FallbackInput} input
 * @returns {string|null}
 */
export function nextStrategy(input) {
  const err = input.lastErrorCode;
  if (err !== null && FINAL_ERROR_CODES.includes(err)) return null;
  for (const id of input.chain) {
    if (input.tried.includes(id)) continue;
    if (input.available[id] !== true) continue;
    if (id === 'ytdlp-cookies') {
      if (input.cookieBrowser === null) continue;
      if (err !== null && !COOKIES_HELP.includes(err)) continue;
    }
    if (id === 'browser-capture') {
      if (!input.allowBrowserCapture || input.isPlaylist) continue;
      if (err !== null && !CAPTURE_HELPS.includes(err)) continue;
    }
    return id;
  }
  return null;
}

/**
 * Vergleicht yt-dlp-Versionen der Form JJJJ.MM.TT[.N].
 * @param {string} installed
 * @param {string} latest
 * @returns {boolean|null} null, wenn eine Version nicht lesbar ist
 */
export function isNewerVersion(installed, latest) {
  const parse = (v) => (/^\d+(\.\d+)*$/.test(v) ? v.split('.').map(Number) : null);
  const a = parse(installed.trim().replace(/^v/, ''));
  const b = parse(latest.trim().replace(/^v/, ''));
  if (!a || !b) return null;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (y !== x) return y > x;
  }
  return false;
}

/**
 * Abgeschlossenen Job vorne in den Verlauf legen; ein älterer Eintrag mit derselben ID wird ersetzt.
 * @param {import('./model.js').Job[]} history  neueste zuerst
 * @param {import('./model.js').Job} job
 * @param {number} [limit]
 * @returns {import('./model.js').Job[]}
 */
export function addToHistory(history, job, limit = HISTORY_LIMIT) {
  if (!FINAL_JOB_STATES.includes(job.state)) return history;
  const done = { ...job, speedBps: null, etaSec: null };
  return [done, ...history.filter((h) => h.id !== job.id)].slice(0, limit);
}
