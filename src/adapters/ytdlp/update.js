// Adapter: neueste yt-dlp-Version bei GitHub abfragen. Der Vergleich liegt in logic.isNewerVersion.

const LATEST = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';

/**
 * @param {import('../http.js').HttpClient} http
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ok: true, latest: string, url: string|null} | {ok: false, errorCode: string}>}
 */
export async function fetchLatestYtDlp(http, signal) {
  const r = await http.getJson(LATEST, { signal, headers: { 'user-agent': 'youtube-downloader-local' } });
  if (r.error) return { ok: false, errorCode: 'network' };
  if (r.status === 403 || r.status === 429) return { ok: false, errorCode: 'rate_limited' };
  const tag = r.json?.tag_name;
  if (r.status !== 200 || typeof tag !== 'string') return { ok: false, errorCode: 'unknown' };
  return { ok: true, latest: tag, url: typeof r.json.html_url === 'string' ? r.json.html_url : null };
}
