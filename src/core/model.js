// Modell: Typen, stabile IDs, Standardwerte, Validierung, Export/Import.
// Keine Abhängigkeiten, keine Anzeigetexte (die stehen in web/src/texts.js).

export const APP_ID = 'youtube-downloader';
export const SCHEMA_VERSION = 1;

/** Strategien A–D. IDs nie umbenennen, nur ergänzen. */
export const STRATEGY_IDS = ['ytdlp', 'ytdlp-cookies', 'official', 'browser-capture'];

/** Standard-Fallback-Kette (vorläufig, wird nach der Testmatrix bestätigt). */
export const DEFAULT_CHAIN = ['ytdlp', 'ytdlp-cookies', 'browser-capture', 'official'];

export const MEDIA_MODES = ['video', 'audio'];

/** Höchstauflösung; null = beste verfügbare. */
export const MAX_HEIGHTS = [null, 2160, 1440, 1080, 720, 480, 360];

export const VIDEO_CONTAINERS = ['mp4', 'webm', 'mkv'];

/** 'original' = bestes Audio unverändert (m4a oder opus), sonst Umwandlung per ffmpeg. */
export const AUDIO_FORMATS = ['original', 'mp3', 'm4a', 'flac', 'opus'];

/** kbit/s; null = beste/variable Qualität. Bei flac und original ohne Wirkung. */
export const AUDIO_BITRATES = [null, 96, 128, 160, 192, 256, 320];

/** Browser, aus denen yt-dlp Cookies lesen kann (Strategie B). */
export const COOKIE_BROWSERS = ['chrome', 'firefox', 'safari', 'edge', 'brave', 'chromium'];

export const URL_KINDS = ['video', 'short', 'live', 'playlist', 'video-in-playlist', 'channel', 'other-site'];

export const JOB_STATES = ['queued', 'probing', 'downloading', 'postprocessing', 'done', 'failed', 'cancelled'];
export const FINAL_JOB_STATES = ['done', 'failed', 'cancelled'];

export const JOB_PHASES = ['probing', 'downloading', 'postprocessing'];

/** Fehlercodes, die Engines liefern. Anzeigetext und Anleitung je Code in texts.js. */
export const ERROR_CODES = [
  'invalid_url',
  'unsupported_site',
  'private',
  'deleted',
  'age_restricted',
  'members_only',
  'login_required',
  'region_blocked',
  'rate_limited',
  'bot_check',
  'drm',
  'paid_content',
  'live_not_finished',
  'network',
  'tool_missing',
  'cookies_unavailable',
  'needs_user_action',
  'needs_api_key',
  'not_supported_by_engine',
  'cancelled',
  'unknown',
];

/** Fehler, bei denen keine andere Strategie hilft: Kette sofort beenden. */
/** Höchstzahl der Einträge im Verlauf. */
export const HISTORY_LIMIT = 500;

export const FINAL_ERROR_CODES = ['invalid_url', 'deleted', 'drm', 'paid_content', 'cancelled'];

/**
 * @typedef {Object} Settings
 * @property {boolean} legalNoticeAccepted
 * @property {string|null} cookieBrowser  eine von COOKIE_BROWSERS oder null (Strategie B aus)
 * @property {boolean} allowBrowserCapture  Strategie D darf angeboten werden
 * @property {string[]} chain  Reihenfolge der Strategien
 * @property {string|null} outputDir  Zielordner; null = Standard der Hülle (z. B. ~/Downloads/YouTube-Downloader)
 * @property {DownloadRequestOptions} defaults
 */

/**
 * @typedef {Object} DownloadRequestOptions
 * @property {'video'|'audio'} mode
 * @property {number|null} maxHeight
 * @property {'mp4'|'webm'|'mkv'} container
 * @property {'original'|'mp3'|'m4a'|'flac'|'opus'} audioFormat
 * @property {number|null} audioBitrateKbps
 * @property {boolean} embedMetadata  Titel, Künstler usw. als Tags
 * @property {boolean} embedThumbnail Cover einbetten
 * @property {boolean} wholePlaylist  bei Playlist-URLs alle Einträge laden
 */

/**
 * @typedef {Object} DownloadRequest
 * @property {string} url
 * @property {DownloadRequestOptions} options
 * @property {string} outputDir
 * @property {boolean} isPlaylist  vom Kern entschieden (logic.targetUrl), nicht von der Engine
 */

/**
 * @typedef {Object} MediaFormat
 * @property {string} id
 * @property {'video'|'audio'|'muxed'} kind
 * @property {string} ext
 * @property {number|null} height
 * @property {number|null} fps
 * @property {string|null} vcodec
 * @property {string|null} acodec
 * @property {number|null} abrKbps
 * @property {number|null} tbrKbps
 * @property {number|null} sizeBytes
 * @property {boolean} drm
 */

/**
 * @typedef {Object} Metadata
 * @property {string} id
 * @property {string} url
 * @property {string} title
 * @property {string|null} uploader
 * @property {number|null} durationSec
 * @property {string|null} thumbnailUrl
 * @property {string|null} uploadDate  YYYY-MM-DD
 * @property {string|null} license
 * @property {'none'|'is_live'|'was_live'|'is_upcoming'|'post_live'} liveStatus
 * @property {number} ageLimit
 * @property {'video'|'playlist'} kind
 * @property {PlaylistEntry[]} entries  leer bei Einzelvideos
 * @property {MediaFormat[]} formats    leer bei Playlists
 */

/**
 * @typedef {Object} PlaylistEntry
 * @property {string} id
 * @property {string} url
 * @property {string} title
 * @property {number|null} durationSec
 */

/**
 * @typedef {Object} Job
 * @property {string} id
 * @property {string} url
 * @property {DownloadRequestOptions} options
 * @property {string} state       eine von JOB_STATES
 * @property {string|null} strategy aktuelle bzw. erfolgreiche Strategie
 * @property {string[]} tried     bereits versuchte Strategien
 * @property {Attempt[]} attempts gescheiterte Versuche je Strategie, in Reihenfolge
 * @property {number|null} percent 0–100
 * @property {number|null} downloadedBytes
 * @property {number|null} totalBytes
 * @property {number|null} speedBps
 * @property {number|null} etaSec
 * @property {number|null} playlistIndex  1-basiert
 * @property {number|null} playlistCount
 * @property {string|null} title
 * @property {string[]} files
 * @property {string|null} errorCode
 * @property {string|null} errorDetail
 * @property {number} attempt     1 beim ersten Lauf, +1 bei „Wiederholen“
 * @property {string} createdAt   ISO-Zeitstempel (von der Hülle übergeben)
 * @property {string|null} finishedAt
 */

/**
 * @typedef {Object} Attempt
 * @property {string} strategy
 * @property {string} errorCode
 * @property {string|null} detail
 */

/** @type {DownloadRequestOptions} */
export const DEFAULT_OPTIONS = {
  mode: 'video',
  maxHeight: null,
  container: 'mp4',
  audioFormat: 'original',
  audioBitrateKbps: null,
  embedMetadata: true,
  embedThumbnail: true,
  wholePlaylist: true,
};

/** @type {Settings} */
export const DEFAULT_SETTINGS = {
  legalNoticeAccepted: false,
  cookieBrowser: null,
  allowBrowserCapture: false,
  chain: DEFAULT_CHAIN.slice(),
  outputDir: null,
  defaults: DEFAULT_OPTIONS,
};

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
const str = (value) => (typeof value === 'string' ? value : null);
const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * @param {unknown} raw
 * @returns {DownloadRequestOptions}
 */
export function sanitizeOptions(raw) {
  const o = raw && typeof raw === 'object' ? /** @type {any} */ (raw) : {};
  const d = DEFAULT_OPTIONS;
  return {
    mode: pick(o.mode, MEDIA_MODES, d.mode),
    maxHeight: pick(o.maxHeight, MAX_HEIGHTS, d.maxHeight),
    container: pick(o.container, VIDEO_CONTAINERS, d.container),
    audioFormat: pick(o.audioFormat, AUDIO_FORMATS, d.audioFormat),
    audioBitrateKbps: pick(o.audioBitrateKbps, AUDIO_BITRATES, d.audioBitrateKbps),
    embedMetadata: bool(o.embedMetadata, d.embedMetadata),
    embedThumbnail: bool(o.embedThumbnail, d.embedThumbnail),
    wholePlaylist: bool(o.wholePlaylist, d.wholePlaylist),
  };
}

/**
 * @param {unknown} raw
 * @returns {Settings}
 */
export function sanitizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? /** @type {any} */ (raw) : {};
  const chain = Array.isArray(s.chain)
    ? s.chain.filter((id, i) => STRATEGY_IDS.includes(id) && s.chain.indexOf(id) === i)
    : [];
  return {
    legalNoticeAccepted: bool(s.legalNoticeAccepted, false),
    cookieBrowser: pick(s.cookieBrowser, COOKIE_BROWSERS, null),
    allowBrowserCapture: bool(s.allowBrowserCapture, false),
    chain: chain.length > 0 ? chain : DEFAULT_CHAIN.slice(),
    outputDir: typeof s.outputDir === 'string' && s.outputDir.trim() !== '' ? s.outputDir.trim() : null,
    defaults: sanitizeOptions(s.defaults),
  };
}

/**
 * Leerer Job. id und Zeitstempel kommen von außen.
 * @param {string} id
 * @param {string} url
 * @param {DownloadRequestOptions} options
 * @param {string} createdAt
 * @returns {Job}
 */
export function emptyJob(id, url, options, createdAt) {
  return {
    id,
    url,
    options: sanitizeOptions(options),
    state: 'queued',
    strategy: null,
    tried: [],
    attempts: [],
    percent: null,
    downloadedBytes: null,
    totalBytes: null,
    speedBps: null,
    etaSec: null,
    playlistIndex: null,
    playlistCount: null,
    title: null,
    files: [],
    errorCode: null,
    errorDetail: null,
    attempt: 1,
    createdAt,
    finishedAt: null,
  };
}

/**
 * Verlaufseintrag (abgeschlossener Job). Unbekannte Felder fallen weg.
 * @param {unknown} raw
 * @returns {Job|null}
 */
export function sanitizeJob(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const j = /** @type {any} */ (raw);
  if (typeof j.id !== 'string' || typeof j.url !== 'string' || typeof j.createdAt !== 'string') return null;
  const base = emptyJob(j.id, j.url, j.options, j.createdAt);
  return {
    ...base,
    state: pick(j.state, JOB_STATES, 'failed'),
    strategy: pick(j.strategy, STRATEGY_IDS, null),
    tried: Array.isArray(j.tried) ? j.tried.filter((id) => STRATEGY_IDS.includes(id)) : [],
    attempts: Array.isArray(j.attempts)
      ? j.attempts
          .filter((a) => a && STRATEGY_IDS.includes(a.strategy) && ERROR_CODES.includes(a.errorCode))
          .map((a) => ({ strategy: a.strategy, errorCode: a.errorCode, detail: str(a.detail) }))
      : [],
    percent: num(j.percent),
    downloadedBytes: num(j.downloadedBytes),
    totalBytes: num(j.totalBytes),
    speedBps: null,
    etaSec: null,
    playlistIndex: num(j.playlistIndex),
    playlistCount: num(j.playlistCount),
    title: str(j.title),
    files: Array.isArray(j.files) ? j.files.filter((f) => typeof f === 'string') : [],
    errorCode: pick(j.errorCode, ERROR_CODES, null),
    errorDetail: str(j.errorDetail),
    attempt: num(j.attempt) ?? 1,
    finishedAt: str(j.finishedAt),
  };
}

/**
 * @param {Settings} settings
 * @param {Job[]} history
 * @param {string} exportedAt ISO-Zeitstempel
 */
export function buildExport(settings, history, exportedAt) {
  return { app: APP_ID, version: SCHEMA_VERSION, exportedAt, settings, history };
}

/**
 * Hebt ältere Formate auf die aktuelle Version. Idempotent.
 * @param {any} raw
 */
export function upgradeRaw(raw) {
  return raw; // Version 1 ist die erste, noch nichts zu tun.
}

/**
 * @param {unknown} raw
 * @returns {{ok: true, settings: Settings, history: Job[]} | {ok: false, error: 'not_json'|'wrong_app'|'newer_version'|'bad_format'}}
 */
export function parseImport(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'not_json' };
  const r = /** @type {any} */ (raw);
  if (r.app !== APP_ID) return { ok: false, error: 'wrong_app' };
  if (typeof r.version !== 'number') return { ok: false, error: 'bad_format' };
  if (r.version > SCHEMA_VERSION) return { ok: false, error: 'newer_version' };
  const up = upgradeRaw(r);
  if (!Array.isArray(up.history)) return { ok: false, error: 'bad_format' };
  const history = up.history.map(sanitizeJob).filter((j) => j !== null);
  return { ok: true, settings: sanitizeSettings(up.settings), history };
}
