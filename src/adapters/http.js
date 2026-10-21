// Adapter: HTTP-Anfragen. Einzige Stelle mit fetch. Tests verwenden eine Attrappe.

/**
 * @typedef {Object} HttpClient
 * @property {(url: string, opts?: {signal?: AbortSignal, headers?: Object<string,string>}) => Promise<{status: number, json: any, error: 'network'|'aborted'|null}>} getJson
 */

/** @returns {HttpClient} */
export function createHttpClient() {
  return {
    async getJson(url, opts = {}) {
      try {
        const res = await fetch(url, { signal: opts.signal, headers: { accept: 'application/json', ...(opts.headers || {}) } });
        let json = null;
        try {
          json = await res.json();
        } catch {
          json = null;
        }
        return { status: res.status, json, error: null };
      } catch (err) {
        return { status: 0, json: null, error: /** @type {any} */ (err).name === 'AbortError' ? 'aborted' : 'network' };
      }
    },
  };
}
