// Vertrag DownloadEngine. Jede Strategie (A–D) ist ein Adapter, der dieses Interface erfüllt.
// Der Kern kennt nur diesen Vertrag, nie das Programm dahinter (yt-dlp, Playwright, API).
// In Rust: `trait DownloadEngine` mit `enum EngineEvent` und `Result<_, EngineError>`.

/**
 * @typedef {Object} EngineCapabilities
 * @property {boolean} metadata        kann probe()
 * @property {boolean} download        kann Dateien liefern
 * @property {boolean} audioOnly       kann nur Audio laden
 * @property {boolean} playlist        kann Playlists
 * @property {boolean} needsUserAction braucht Handgriffe des Nutzers (z. B. Video selbst starten)
 */

/**
 * @typedef {Object} Availability
 * @property {boolean} ok
 * @property {string|null} version
 * @property {string|null} errorCode  z. B. 'tool_missing', 'needs_api_key'
 */

/**
 * @typedef {{ok: true, metadata: import('./model.js').Metadata}
 *   | {ok: false, errorCode: string, detail: string|null}} ProbeResult
 */

/**
 * @typedef {{ok: true, files: string[]}
 *   | {ok: false, errorCode: string, detail: string|null}} DownloadResult
 */

/**
 * Ereignisse der Engine während eines Laufs (reine Daten).
 * @typedef {{type:'phase', phase:'probing'|'downloading'|'postprocessing'}
 *  | {type:'progress', percent:number|null, downloadedBytes:number|null, totalBytes:number|null, speedBps:number|null, etaSec:number|null, playlistIndex?:number|null, playlistCount?:number|null}
 *  | {type:'title', title:string}
 *  | {type:'file', path:string}
 *  | {type:'log', stream:'stdout'|'stderr', line:string}} EngineEvent
 */

/**
 * @typedef {Object} EngineContext
 * @property {AbortSignal} signal
 * @property {(event: EngineEvent) => void} onEvent
 */

/**
 * @typedef {Object} DownloadEngine
 * @property {string} id  eine von STRATEGY_IDS
 * @property {() => EngineCapabilities} capabilities
 * @property {() => Promise<Availability>} checkAvailable
 * @property {(url: string, ctx: EngineContext) => Promise<ProbeResult>} probe
 * @property {(request: import('./model.js').DownloadRequest, ctx: EngineContext) => Promise<DownloadResult>} download
 */

const CAPABILITY_KEYS = ['metadata', 'download', 'audioOnly', 'playlist', 'needsUserAction'];

/**
 * Prüft, ob ein Objekt den Vertrag erfüllt. Liefert eine Liste von Mängeln (leer = in Ordnung).
 * @param {any} engine
 * @param {string[]} strategyIds
 * @returns {string[]}
 */
export function checkEngine(engine, strategyIds) {
  const problems = [];
  if (!engine || typeof engine !== 'object') return ['not_an_object'];
  if (!strategyIds.includes(engine.id)) problems.push('unknown_id');
  for (const name of ['capabilities', 'checkAvailable', 'probe', 'download']) {
    if (typeof engine[name] !== 'function') problems.push(`missing_${name}`);
  }
  if (typeof engine.capabilities === 'function') {
    const caps = engine.capabilities();
    for (const key of CAPABILITY_KEYS) {
      if (typeof caps?.[key] !== 'boolean') problems.push(`capability_${key}`);
    }
  }
  return problems;
}
