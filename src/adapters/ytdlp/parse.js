// yt-dlp-Adapter, rein: übersetzt Ausgaben von yt-dlp in Modell-Daten und Fehlercodes.

import { MARK } from './args.js';

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const str = (x) => (typeof x === 'string' && x !== '' ? x : null);
const LIVE = { not_live: 'none', is_live: 'is_live', was_live: 'was_live', is_upcoming: 'is_upcoming', post_live: 'post_live' };

/**
 * @param {any} f
 * @returns {import('../../core/model.js').MediaFormat|null}
 */
function mapFormat(f) {
  const v = str(f.vcodec);
  const a = str(f.acodec);
  // 'none' heißt „sicher nicht vorhanden“; fehlende Angabe (z. B. direkte Dateien) gilt als vorhanden.
  const hasV = v !== 'none';
  const hasA = a !== 'none';
  if (!hasV && !hasA) return null; // Storyboards, Bilder
  if (f.ext === 'mhtml') return null;
  return {
    id: String(f.format_id),
    kind: hasV && hasA ? 'muxed' : hasV ? 'video' : 'audio',
    ext: str(f.ext) ?? 'unknown',
    height: num(f.height),
    fps: num(f.fps),
    vcodec: hasV ? v : null, // null = unbekannt bzw. nicht vorhanden
    acodec: hasA ? a : null,
    abrKbps: num(f.abr),
    tbrKbps: num(f.tbr),
    sizeBytes: num(f.filesize) ?? num(f.filesize_approx),
    drm: f.has_drm === true,
  };
}

/**
 * @param {any} j  Ausgabe von `yt-dlp -J`
 * @returns {import('../../core/model.js').Metadata}
 */
export function mapInfoJson(j) {
  const date = str(j.upload_date);
  const isList = j._type === 'playlist';
  const thumb = str(j.thumbnail) ?? (Array.isArray(j.thumbnails) && j.thumbnails.length > 0 ? str(j.thumbnails[j.thumbnails.length - 1].url) : null);
  return {
    id: String(j.id ?? ''),
    url: str(j.webpage_url) ?? str(j.original_url) ?? '',
    title: str(j.title) ?? '',
    uploader: str(j.uploader) ?? str(j.channel),
    durationSec: num(j.duration),
    thumbnailUrl: thumb,
    uploadDate: date && /^\d{8}$/.test(date) ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : null,
    license: str(j.license),
    liveStatus: LIVE[j.live_status] ?? 'none',
    ageLimit: num(j.age_limit) ?? 0,
    kind: isList ? 'playlist' : 'video',
    entries: isList && Array.isArray(j.entries)
      ? j.entries
          .map((e, i) => e && { index: i + 1, id: String(e.id ?? ''), url: str(e.url) ?? str(e.webpage_url) ?? '', title: str(e.title) ?? '', durationSec: num(e.duration) })
          .filter((e) => e)
      : [],
    formats: isList ? [] : (Array.isArray(j.formats) ? j.formats : typeof j.url === 'string' ? [j] : []).map(mapFormat).filter((f) => f !== null),
  };
}

const POST = /^\[(Merger|ExtractAudio|EmbedThumbnail|Metadata|FixupM3u8|FixupM4a|VideoConvertor|VideoRemuxer|ThumbnailsConvertor|MoveFiles)\]/;

/**
 * Eine Zeile der yt-dlp-Ausgabe → Engine-Ereignis oder null.
 * @param {string} line
 * @returns {import('../../core/engine.js').EngineEvent|null}
 */
export function parseLine(line) {
  if (line.startsWith(MARK.progress)) {
    let p;
    try {
      p = JSON.parse(line.slice(MARK.progress.length));
    } catch {
      return null;
    }
    const done = num(p.downloaded_bytes);
    const total = num(p.total_bytes) ?? num(p.total_bytes_estimate);
    let percent = done !== null && total ? (done / total) * 100 : null;
    if (percent === null && num(p.fragment_index) !== null && num(p.fragment_count)) percent = (p.fragment_index / p.fragment_count) * 100;
    if (p.status === 'finished') percent = 100;
    return {
      type: 'progress',
      percent: percent === null ? null : Math.round(percent * 10) / 10,
      downloadedBytes: done,
      totalBytes: total,
      speedBps: num(p.speed),
      etaSec: num(p.eta),
    };
  }
  if (line.startsWith(MARK.title)) return { type: 'title', title: line.slice(MARK.title.length) };
  if (line.startsWith(MARK.item)) {
    const m = /^(\d+)\/(\d+)$/.exec(line.slice(MARK.item.length));
    if (!m || m[2] === '0') return null;
    return { type: 'progress', percent: 0, downloadedBytes: null, totalBytes: null, speedBps: null, etaSec: null, playlistIndex: Number(m[1]), playlistCount: Number(m[2]) };
  }
  if (line.startsWith(MARK.file)) {
    try {
      const path = JSON.parse(line.slice(MARK.file.length));
      return typeof path === 'string' ? { type: 'file', path } : null;
    } catch {
      return null;
    }
  }
  if (POST.test(line)) return { type: 'phase', phase: 'postprocessing' };
  return null;
}

/** Reihenfolge zählt: spezifische Muster vor allgemeinen. */
const RULES = [
  ['invalid_url', /is not a valid URL/i],
  ['unsupported_site', /Unsupported URL/i],
  ['drm', /DRM protected|has_drm|This video is DRM/i],
  ['paid_content', /requires payment|purchase this video|This video is only available for rent|Premium members only/i],
  ['bot_check', /confirm you(’|')?re not a bot|captcha challenge/i],
  ['rate_limited', /HTTP Error 429|Too Many Requests|rate[- ]limit|try again later/i],
  ['age_restricted', /confirm your age|age[- ]restricted|inappropriate for some users/i],
  ['members_only', /members[- ]only|Join this channel|available to this channel's members/i],
  ['private', /Private video|This video is private/i],
  ['region_blocked', /not (made this video )?available in your country|geo[- ]?restrict|blocked it in your country/i],
  ['live_not_finished', /Premieres in|live event will begin|This live event|is_upcoming|recording is not available|Live stream is offline/i],
  ['deleted', /has been removed|no longer available|account associated with this video has been terminated|Video unavailable|does not exist|HTTP Error 404/i],
  ['login_required', /Use --cookies-from-browser or --cookies for the authentication|only available for registered users|requires authentication|Sign in to/i],
  ['cookies_unavailable', /could not find .* cookies database|Failed to decrypt|could not copy .* cookie database|keyring/i],
  ['tool_missing', /ffmpeg (is )?not (found|installed)|ffprobe and ffmpeg not found/i],
  ['network', /Unable to download webpage|getaddrinfo|Name or service not known|Temporary failure in name resolution|Connection refused|timed out|Tunnel connection failed|Network is unreachable|Connection reset/i],
];

/**
 * stderr von yt-dlp → Fehlercode aus model.ERROR_CODES. Zeilen mit „ERROR:“ haben Vorrang.
 * @param {string} stderr
 * @returns {{errorCode: string, detail: string|null}}
 */
export function classifyError(stderr) {
  const errorLines = stderr.split(/\r?\n/).filter((l) => l.startsWith('ERROR:'));
  const detail = errorLines.length > 0 ? errorLines[errorLines.length - 1].slice(6).trim() : (stderr.trim().split(/\r?\n/).pop() ?? '').trim() || null;
  for (const text of [errorLines.join('\n'), stderr]) {
    if (text === '') continue;
    for (const [code, re] of RULES) if (re.test(text)) return { errorCode: code, detail };
  }
  return { errorCode: 'unknown', detail };
}
