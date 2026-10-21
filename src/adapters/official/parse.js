// Strategie C, rein: Antworten der YouTube Data API v3 → Modell-Daten.

/**
 * ISO-8601-Dauer (PT1H2M3S, P1DT2H) → Sekunden; null, wenn nicht lesbar.
 * @param {unknown} text
 * @returns {number|null}
 */
export function parseIsoDuration(text) {
  if (typeof text !== 'string') return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(text);
  if (!m || text === 'P' || text.endsWith('T')) return null;
  const [d, h, min, s] = m.slice(1).map((x) => (x ? Number(x) : 0));
  return d * 86400 + h * 3600 + min * 60 + s;
}

const bestThumb = (t) => (t && (t.maxres || t.standard || t.high || t.medium || t.default)?.url) || null;

/**
 * @param {any} item  Eintrag aus videos.list
 * @returns {import('../../core/model.js').Metadata}
 */
export function mapVideoItem(item) {
  const sn = item.snippet || {};
  const cd = item.contentDetails || {};
  const st = item.status || {};
  const live = item.liveStreamingDetails || {};
  const liveStatus =
    sn.liveBroadcastContent === 'live' ? 'is_live'
      : sn.liveBroadcastContent === 'upcoming' ? 'is_upcoming'
        : live.actualEndTime ? 'was_live' : 'none';
  return {
    id: String(item.id),
    url: `https://www.youtube.com/watch?v=${item.id}`,
    title: sn.title ?? '',
    uploader: sn.channelTitle ?? null,
    durationSec: parseIsoDuration(cd.duration),
    thumbnailUrl: bestThumb(sn.thumbnails),
    uploadDate: typeof sn.publishedAt === 'string' ? sn.publishedAt.slice(0, 10) : null,
    license: st.license === 'creativeCommon' ? 'Creative Commons Attribution license (reuse allowed)' : st.license === 'youtube' ? 'Standard YouTube License' : null,
    liveStatus,
    ageLimit: cd.contentRating?.ytRating === 'ytAgeRestricted' ? 18 : 0,
    kind: 'video',
    entries: [],
    formats: [], // Die API nennt keine Download-Formate.
  };
}

/**
 * @param {any} playlist  Eintrag aus playlists.list
 * @param {any[]} items   gesammelte Einträge aus playlistItems.list
 * @returns {import('../../core/model.js').Metadata}
 */
export function mapPlaylist(playlist, items) {
  const sn = playlist.snippet || {};
  return {
    id: String(playlist.id),
    url: `https://www.youtube.com/playlist?list=${playlist.id}`,
    title: sn.title ?? '',
    uploader: sn.channelTitle ?? null,
    durationSec: null,
    thumbnailUrl: bestThumb(sn.thumbnails),
    uploadDate: typeof sn.publishedAt === 'string' ? sn.publishedAt.slice(0, 10) : null,
    license: null,
    liveStatus: 'none',
    ageLimit: 0,
    kind: 'playlist',
    entries: items
      .filter((it) => it?.contentDetails?.videoId)
      .map((it) => ({ id: it.contentDetails.videoId, url: `https://www.youtube.com/watch?v=${it.contentDetails.videoId}`, title: it.snippet?.title ?? '', durationSec: null })),
    formats: [],
  };
}

/**
 * HTTP-Status und Fehlerantwort der API → Fehlercode.
 * @param {number} status
 * @param {any} json
 * @returns {string}
 */
export function classifyApiError(status, json) {
  const reason = json?.error?.errors?.[0]?.reason ?? '';
  if (/quotaExceeded|rateLimitExceeded|userRateLimitExceeded/.test(reason) || status === 429) return 'rate_limited';
  if (/keyInvalid|keyExpired|forbidden|accessNotConfigured/.test(reason) || status === 400 || status === 401 || status === 403) return 'needs_api_key';
  if (status === 404) return 'deleted';
  return 'unknown';
}
