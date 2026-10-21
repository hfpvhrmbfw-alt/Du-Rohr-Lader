// Hülle: Wer darf den lokalen Server benutzen? Rein (ohne Netz und Dateien), damit testbar.
// Standard: nur dieser Rechner (127.0.0.1/localhost). Mit YTD_LAN=1 zusätzlich Geräte im
// Heimnetz (z. B. iPhone), aber nur nach Kopplung über einen geheimen Schlüssel (Cookie).

export const PAIR_COOKIE = 'ytd_pair';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** @param {string|undefined} addr */
export const isLoopback = (addr) => LOOPBACK.has(addr ?? '');

/** @param {string|undefined} header @returns {Object<string, string>} */
export function parseCookies(header) {
  const out = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // kaputter Wert: ignorieren
    }
  }
  return out;
}

/** Vergleich in konstanter Zeit, damit der Schlüssel nicht über Antwortzeiten erraten wird. */
export function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || a === '') return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Dateien, die auch ungekoppelte Geräte laden dürfen: Programmcode und Icons der Oberfläche, nie Daten. */
const PUBLIC = /^\/(styles\.css|layout\.css|sw\.js|manifest\.webmanifest|icons\/[\w.-]+|src\/[\w.-]+\.js|core\/(model|logic)\.js)$/;

/**
 * @param {{port: number, lan: boolean, lanHosts?: string[], token?: string|null}} cfg
 *   lanHosts: Namen/Adressen dieses Rechners im Heimnetz (ohne Port)
 */
export function createAccessPolicy(cfg) {
  const local = ['127.0.0.1', 'localhost', '[::1]'].map((h) => `${h}:${cfg.port}`);
  const remote = cfg.lan ? (cfg.lanHosts ?? []).map((h) => `${h}:${cfg.port}`) : [];
  const hosts = new Set([...local, ...remote]);
  const origins = new Set([...hosts].map((h) => `http://${h}`));
  const token = cfg.lan ? cfg.token ?? null : null;

  return {
    hosts: [...hosts],
    /**
     * @param {{method: string, path: string, host?: string, origin?: string, remote?: string, cookie?: string, pair?: string|null}} req
     * @returns {{ok: true, local: boolean, paired: boolean, setCookie?: string} | {ok: false, status: number, error: string}}
     */
    check(req) {
      // Host-Prüfung schützt vor DNS-Rebinding, Origin-Prüfung vor fremden Webseiten.
      if (!hosts.has(req.host ?? '')) return { ok: false, status: 403, error: 'forbidden_host' };
      if (req.method !== 'GET' && req.origin !== undefined && !origins.has(req.origin)) return { ok: false, status: 403, error: 'forbidden_origin' };
      if (isLoopback(req.remote)) return { ok: true, local: true, paired: false };
      if (!cfg.lan || !token) return { ok: false, status: 403, error: 'forbidden_remote' };
      if (req.method === 'GET' && req.pair && sameSecret(req.pair, token)) {
        return { ok: true, local: false, paired: true, setCookie: `${PAIR_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax` };
      }
      if (sameSecret(parseCookies(req.cookie)[PAIR_COOKIE], token)) return { ok: true, local: false, paired: true };
      if (req.method === 'GET' && PUBLIC.test(req.path)) return { ok: true, local: false, paired: false };
      return { ok: false, status: 401, error: 'not_paired' };
    },
    /** Schlüssel für die Startadresse der installierten App (nur an gekoppelte Geräte ausliefern). */
    token,
    /** Kopplungs-Links für die Anzeige auf diesem Rechner. */
    pairUrls: () => (token ? remote.map((h) => `http://${h}/?pair=${encodeURIComponent(token)}`) : []),
  };
}
