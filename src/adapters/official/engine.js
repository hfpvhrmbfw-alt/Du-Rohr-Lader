// Strategie C: offizielle YouTube Data API v3, nur Metadaten.
// Download gibt es hier nicht: für eigene Videos verweist die App auf YouTube Studio bzw. Google Takeout.

import { parseUrl } from '../../core/logic.js';
import { classifyApiError, mapPlaylist, mapVideoItem } from './parse.js';

const API = 'https://www.googleapis.com/youtube/v3';
const MAX_PLAYLIST_PAGES = 10; // 500 Einträge

/**
 * @param {{http: import('../http.js').HttpClient, apiKey: string|null}} cfg
 * @returns {import('../../core/engine.js').DownloadEngine}
 */
export function createOfficialEngine(cfg) {
  const get = async (path, params, signal) => {
    const q = new URLSearchParams({ ...params, key: cfg.apiKey ?? '' });
    const res = await cfg.http.getJson(`${API}/${path}?${q}`, { signal });
    if (res.error) return { ok: false, errorCode: res.error === 'aborted' ? 'cancelled' : 'network', detail: null };
    if (res.status !== 200) return { ok: false, errorCode: classifyApiError(res.status, res.json), detail: res.json?.error?.message ?? null };
    return { ok: true, json: res.json };
  };

  return {
    id: 'official',
    capabilities: () => ({ metadata: true, download: false, audioOnly: false, playlist: true, needsUserAction: true }),

    async checkAvailable() {
      return cfg.apiKey ? { ok: true, version: 'v3', errorCode: null } : { ok: false, version: null, errorCode: 'needs_api_key' };
    },

    async probe(url, ctx) {
      if (!cfg.apiKey) return { ok: false, errorCode: 'needs_api_key', detail: null };
      const parsed = parseUrl(url);
      if (!parsed.ok) return { ok: false, errorCode: 'invalid_url', detail: parsed.error };
      if (parsed.kind === 'playlist') {
        const pl = await get('playlists', { part: 'snippet', id: parsed.playlistId }, ctx.signal);
        if (!pl.ok) return pl;
        if (!pl.json.items?.length) return { ok: false, errorCode: 'deleted', detail: 'not_found_or_private' };
        const items = [];
        let pageToken = '';
        for (let page = 0; page < MAX_PLAYLIST_PAGES; page++) {
          const r = await get('playlistItems', { part: 'snippet,contentDetails', playlistId: parsed.playlistId, maxResults: '50', ...(pageToken ? { pageToken } : {}) }, ctx.signal);
          if (!r.ok) return r;
          items.push(...(r.json.items ?? []));
          pageToken = r.json.nextPageToken ?? '';
          if (!pageToken) break;
        }
        return { ok: true, metadata: mapPlaylist(pl.json.items[0], items) };
      }
      if (!parsed.videoId) return { ok: false, errorCode: 'not_supported_by_engine', detail: parsed.kind };
      const r = await get('videos', { part: 'snippet,contentDetails,status,liveStreamingDetails', id: parsed.videoId }, ctx.signal);
      if (!r.ok) return r;
      if (!r.json.items?.length) return { ok: false, errorCode: 'deleted', detail: 'not_found_or_private' };
      return { ok: true, metadata: mapVideoItem(r.json.items[0]) };
    },

    async download() {
      // Kein Download über die API möglich. Die Oberfläche zeigt den Weg über YouTube Studio / Google Takeout.
      return { ok: false, errorCode: 'needs_user_action', detail: 'studio_or_takeout' };
    },
  };
}
