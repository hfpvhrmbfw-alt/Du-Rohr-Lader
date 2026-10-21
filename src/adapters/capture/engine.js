// Strategie D: sichtbarer Browser (Playwright). Der Nutzer startet das Video selbst,
// die App nimmt den abgespielten Stream auf und wandelt ihn per ffmpeg um.
// Nur für Inhalte ohne DRM. Qualitätsverlust durch erneute Kodierung ist unvermeidlich.

import { createWriteStream, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { buildConvertArgs, safeFileName } from '../ffmpeg.js';
import { PAGE_SCRIPT } from './page-script.js';

/**
 * @typedef {Object} CaptureConfig
 * @property {() => Promise<any>} loadPlaywright  liefert das Playwright-Modul oder wirft
 * @property {ReturnType<import('../ffmpeg.js').createFfmpeg>} ffmpeg
 * @property {string} profileDir   eigenes Browserprofil der App (Anmeldung bleibt erhalten)
 * @property {boolean} [headless]  nur für Tests
 * @property {string} [channel]    z. B. 'chrome' für den installierten Chrome
 * @property {boolean} [autoplay]  nur für Tests: Video ohne Nutzer starten
 * @property {number} [startTimeoutMs] wie lange auf den Start durch den Nutzer gewartet wird
 */

/**
 * @param {CaptureConfig} cfg
 * @returns {import('../../core/engine.js').DownloadEngine}
 */
export function createCaptureEngine(cfg) {
  const startTimeout = cfg.startTimeoutMs ?? 10 * 60 * 1000;

  return {
    id: 'browser-capture',
    capabilities: () => ({ metadata: false, download: true, audioOnly: true, playlist: false, needsUserAction: true }),

    async checkAvailable() {
      try {
        const pw = await cfg.loadPlaywright();
        const ff = await cfg.ffmpeg.checkAvailable();
        if (!ff.ok) return { ok: false, version: null, errorCode: 'tool_missing' };
        return { ok: true, version: typeof pw.chromium?.name === 'function' ? 'playwright' : 'unknown', errorCode: null };
      } catch {
        return { ok: false, version: null, errorCode: 'tool_missing' };
      }
    },

    async probe() {
      return { ok: false, errorCode: 'not_supported_by_engine', detail: null };
    },

    async download(request, ctx) {
      let pw;
      try {
        pw = await cfg.loadPlaywright();
      } catch {
        return { ok: false, errorCode: 'tool_missing', detail: 'playwright' };
      }
      const o = request.options;
      mkdirSync(request.outputDir, { recursive: true });
      const raw = join(request.outputDir, `.capture-${Date.now()}.webm`);
      const sink = createWriteStream(raw);
      let browser = null;
      let bytes = 0;
      let title = null;
      const cleanup = () => rmSync(raw, { force: true });

      try {
        browser = await pw.chromium.launchPersistentContext(cfg.profileDir, {
          headless: cfg.headless ?? false,
          channel: cfg.channel,
          viewport: null,
          args: cfg.headless ? ['--autoplay-policy=no-user-gesture-required'] : [],
        });
        const page = browser.pages()[0] ?? (await browser.newPage());

        /** @type {(r: {kind: 'stopped'|'drm'|'error'|'closed'|'timeout', detail?: string}) => void} */
        let finish = () => {};
        const finished = new Promise((resolve) => (finish = resolve));
        let started = false;

        await page.exposeFunction('__ytdSend', (msg) => {
          if (msg.type === 'chunk') {
            const buf = Buffer.from(msg.data, 'base64');
            bytes += buf.length;
            sink.write(buf);
          } else if (msg.type === 'started') {
            started = true;
            title = (msg.title || '').replace(/ - YouTube$/, '') || null;
            if (title) ctx.onEvent({ type: 'title', title });
            ctx.onEvent({ type: 'phase', phase: 'downloading' });
          } else if (msg.type === 'progress') {
            const pct = msg.duration ? (msg.current / msg.duration) * 100 : null;
            ctx.onEvent({ type: 'progress', percent: pct === null ? null : Math.round(pct * 10) / 10, downloadedBytes: bytes, totalBytes: null, speedBps: null, etaSec: msg.duration ? Math.max(0, Math.round(msg.duration - msg.current)) : null });
          } else if (msg.type === 'stopped') finish({ kind: 'stopped' });
          else if (msg.type === 'drm') finish({ kind: 'drm' });
          else if (msg.type === 'error') finish({ kind: 'error', detail: msg.detail });
        });
        await page.addInitScript(`window.__ytdAudioOnly = ${o.mode === 'audio'};\n${PAGE_SCRIPT}`);
        page.on('close', () => finish({ kind: 'closed' }));
        ctx.signal.addEventListener('abort', () => finish({ kind: 'closed' }), { once: true });
        const timer = setTimeout(() => !started && finish({ kind: 'timeout' }), startTimeout);

        ctx.onEvent({ type: 'phase', phase: 'probing' });
        await page.goto(request.url, { waitUntil: 'domcontentloaded' });
        if (cfg.autoplay) await page.evaluate(() => document.querySelector('video')?.play());

        let end = await finished;
        clearTimeout(timer);
        // Nutzer hat das Fenster geschlossen: was bis dahin aufgenommen wurde, wird behalten.
        if (end.kind === 'closed' && !page.isClosed()) {
          await page.evaluate(() => window.__ytdStop?.()).catch(() => {});
        }
        await browser.close().catch(() => {});
        browser = null;
        await new Promise((r) => sink.end(r));

        if (ctx.signal.aborted) return cleanup(), { ok: false, errorCode: 'cancelled', detail: null };
        if (end.kind === 'drm') return cleanup(), { ok: false, errorCode: 'drm', detail: null };
        if (end.kind === 'timeout') return cleanup(), { ok: false, errorCode: 'needs_user_action', detail: 'not_started' };
        if (end.kind === 'error') return cleanup(), { ok: false, errorCode: 'unknown', detail: end.detail ?? null };
        if (bytes === 0) return cleanup(), { ok: false, errorCode: 'needs_user_action', detail: 'nothing_recorded' };

        ctx.onEvent({ type: 'phase', phase: 'postprocessing' });
        const base = join(request.outputDir, `${safeFileName(title)} [Aufnahme]`);
        const { output, args } = buildConvertArgs(raw, base, o, { title, artist: null });
        const conv = await cfg.ffmpeg.run(args, ctx.signal);
        cleanup();
        if (!conv.ok) return { ok: false, errorCode: conv.detail === 'ffmpeg_missing' ? 'tool_missing' : 'unknown', detail: conv.detail };
        ctx.onEvent({ type: 'file', path: output });
        return { ok: true, files: [output] };
      } catch (err) {
        if (browser) await browser.close().catch(() => {});
        sink.end();
        cleanup();
        return { ok: false, errorCode: ctx.signal.aborted ? 'cancelled' : 'unknown', detail: String(/** @type {any} */ (err).message ?? err) };
      }
    },
  };
}
