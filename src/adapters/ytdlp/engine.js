// Strategie A (ohne Login) und B (Cookies aus dem eigenen Browser) als DownloadEngine.

import { buildDownloadArgs, buildProbeArgs } from './args.js';
import { classifyError, mapInfoJson, parseLine } from './parse.js';

/**
 * @param {{id: 'ytdlp'|'ytdlp-cookies', runner: import('../process.js').ProcessRunner, binary?: string, cookieBrowser?: string|null}} cfg
 * @returns {import('../../core/engine.js').DownloadEngine}
 */
export function createYtDlpEngine(cfg) {
  const binary = cfg.binary ?? 'yt-dlp';
  const cookieBrowser = cfg.id === 'ytdlp-cookies' ? (cfg.cookieBrowser ?? null) : null;

  const failure = (res) => {
    if (res.error === 'not_found') return { ok: false, errorCode: 'tool_missing', detail: binary };
    if (res.error === 'aborted') return { ok: false, errorCode: 'cancelled', detail: null };
    return { ok: false, ...classifyError(res.stderr) };
  };

  return {
    id: cfg.id,
    capabilities: () => ({ metadata: true, download: true, audioOnly: true, playlist: true, needsUserAction: false }),

    async checkAvailable() {
      if (cfg.id === 'ytdlp-cookies' && cookieBrowser === null) return { ok: false, version: null, errorCode: 'needs_user_action' };
      const res = await cfg.runner.run(binary, ['--version']);
      if (res.exitCode !== 0) return { ok: false, version: null, errorCode: 'tool_missing' };
      return { ok: true, version: res.stdout.trim(), errorCode: null };
    },

    async probe(url, ctx) {
      const res = await cfg.runner.run(binary, buildProbeArgs(url, { cookieBrowser }), { signal: ctx.signal });
      if (res.exitCode !== 0 || res.error) return failure(res);
      try {
        return { ok: true, metadata: mapInfoJson(JSON.parse(res.stdout)) };
      } catch {
        return { ok: false, errorCode: 'unknown', detail: 'invalid_json' };
      }
    },

    async download(request, ctx) {
      const files = [];
      ctx.onEvent({ type: 'phase', phase: 'downloading' });
      const res = await cfg.runner.run(binary, buildDownloadArgs(request, { cookieBrowser, isPlaylist: request.isPlaylist }), {
        signal: ctx.signal,
        onLine: (stream, line) => {
          const ev = parseLine(line);
          if (ev) {
            if (ev.type === 'file') files.push(ev.path);
            ctx.onEvent(ev);
          } else {
            ctx.onEvent({ type: 'log', stream, line });
          }
        },
      });
      if (res.exitCode !== 0 || res.error) return failure(res);
      return { ok: true, files };
    },
  };
}
