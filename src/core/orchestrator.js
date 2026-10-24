// Ablaufsteuerung: führt einen Job über die Fallback-Kette aus.
// Kennt nur das Interface DownloadEngine; Uhr und Ausgabe werden hineingereicht.

import { applyJobEvent, nextStrategy, parseUrl, primaryError, targetUrl } from './logic.js';

/**
 * @typedef {Object} RunDeps
 * @property {Object<string, import('./engine.js').DownloadEngine>} engines  nach Strategie-ID
 * @property {Object<string, boolean>} available  Ergebnis von checkAvailable je Strategie
 * @property {import('./model.js').Settings} settings
 * @property {AbortSignal} signal
 * @property {() => string} now  liefert ISO-Zeitstempel
 * @property {(job: import('./model.js').Job, event: import('./engine.js').EngineEvent|null) => void} onUpdate
 */

const usable = (deps, capability) => {
  /** @type {Object<string, boolean>} */
  const out = {};
  for (const [id, engine] of Object.entries(deps.engines)) {
    out[id] = deps.available[id] === true && engine.capabilities()[capability] === true;
  }
  return out;
};

/**
 * Metadaten holen, mit Fallback über alle Engines, die probe() können.
 * @param {string} input
 * @param {Omit<RunDeps, 'onUpdate'|'now'>} deps
 * @returns {Promise<{ok: true, strategy: string, metadata: import('./model.js').Metadata, parsed: import('./logic.js').ParsedUrl}
 *   | {ok: false, errorCode: string, detail: string|null, tried: string[], attempts: import('./model.js').Attempt[]}>}
 */
export async function probeWithFallback(input, deps) {
  const parsed = parseUrl(input);
  if (!parsed.ok) return { ok: false, errorCode: 'invalid_url', detail: parsed.error, tried: [] };
  const url = targetUrl(parsed, deps.settings.defaults);
  const available = usable(deps, 'metadata');
  /** @type {string[]} */
  const tried = [];
  let lastError = null;
  /** @type {import('./model.js').Attempt[]} */
  const attempts = [];
  for (;;) {
    if (deps.signal.aborted) return { ok: false, errorCode: 'cancelled', detail: null, tried, attempts };
    const id = nextStrategy({
      chain: deps.settings.chain,
      tried,
      lastErrorCode: lastError,
      available,
      cookieBrowser: deps.settings.cookieBrowser,
      allowBrowserCapture: deps.settings.allowBrowserCapture,
      isPlaylist: parsed.kind === 'playlist',
    });
    if (id === null) {
      const primary = primaryError(attempts) ?? { errorCode: 'not_supported_by_engine', detail: null };
      return { ok: false, ...primary, tried, attempts };
    }
    tried.push(id);
    const result = await deps.engines[id].probe(url, { signal: deps.signal, onEvent: () => {} });
    if (result.ok) return { ok: true, strategy: id, metadata: result.metadata, parsed };
    attempts.push({ strategy: id, errorCode: result.errorCode, detail: result.detail });
    lastError = result.errorCode;
  }
}

/**
 * Führt einen Job aus, bis er fertig, endgültig gescheitert oder abgebrochen ist.
 * @param {import('./model.js').Job} startJob
 * @param {string} outputDir
 * @param {RunDeps} deps
 * @returns {Promise<import('./model.js').Job>}
 */
export async function runJob(startJob, outputDir, deps) {
  let job = startJob;
  const update = (event, engineEvent = null) => {
    job = applyJobEvent(job, event);
    deps.onUpdate(job, engineEvent);
  };

  const parsed = parseUrl(job.url);
  if (!parsed.ok) {
    update({ type: 'failed', errorCode: 'invalid_url', detail: parsed.error, at: deps.now() });
    return job;
  }
  const url = targetUrl(parsed, job.options);
  const isPlaylist = url === parsed.playlistUrl;
  const available = usable(deps, 'download');
  available.official = deps.available.official === true; // C liefert keinen Download, aber den Hinweis am Ende der Kette

  for (;;) {
    if (deps.signal.aborted) {
      update({ type: 'cancelled', at: deps.now() });
      return job;
    }
    const id = nextStrategy({
      chain: deps.settings.chain,
      tried: job.tried,
      lastErrorCode: job.errorCode,
      available,
      cookieBrowser: deps.settings.cookieBrowser,
      allowBrowserCapture: deps.settings.allowBrowserCapture,
      isPlaylist,
    });
    if (id === null) {
      const primary = primaryError(job.attempts) ?? { errorCode: 'not_supported_by_engine', detail: null };
      update({ type: 'failed', errorCode: primary.errorCode, detail: primary.detail, at: deps.now() });
      return job;
    }
    update({ type: 'started', strategy: id });
    const result = await deps.engines[id].download(
      { url, options: job.options, outputDir, isPlaylist, playlistItems: isPlaylist ? job.playlistItems : null },
      {
        signal: deps.signal,
        onEvent: (ev) => {
          if (ev.type === 'log') deps.onUpdate(job, ev);
          else update(ev, ev);
        },
      },
    );
    if (deps.signal.aborted) {
      update({ type: 'cancelled', at: deps.now() });
      return job;
    }
    if (result.ok) {
      for (const path of result.files) update({ type: 'file', path });
      update({ type: 'done', at: deps.now() });
      return job;
    }
    update({ type: 'strategy-failed', strategy: id, errorCode: result.errorCode, detail: result.detail });
  }
}
