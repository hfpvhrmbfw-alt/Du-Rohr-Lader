// Adapter: Programme starten. Einzige Stelle mit child_process.
// Austauschbar: Tests verwenden eine Attrappe mit derselben Schnittstelle.

import { spawn } from 'node:child_process';

/**
 * @typedef {Object} RunResult
 * @property {number|null} exitCode
 * @property {string} stdout
 * @property {string} stderr
 * @property {'not_found'|'aborted'|null} error
 */

/**
 * @typedef {Object} ProcessRunner
 * @property {(cmd: string, args: string[], opts?: {signal?: AbortSignal, onLine?: (stream: 'stdout'|'stderr', line: string) => void, env?: Object<string,string>}) => Promise<RunResult>} run
 */

/** @returns {ProcessRunner} */
export function createProcessRunner() {
  return {
    run(cmd, args, opts = {}) {
      return new Promise((resolve) => {
        if (opts.signal?.aborted) return resolve({ exitCode: null, stdout: '', stderr: '', error: 'aborted' });
        let child;
        try {
          child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...(opts.env || {}) } });
        } catch {
          return resolve({ exitCode: null, stdout: '', stderr: '', error: 'not_found' });
        }
        const out = { stdout: '', stderr: '' };
        const rest = { stdout: '', stderr: '' };
        const feed = (stream) => (chunk) => {
          const text = chunk.toString('utf8');
          out[stream] += text;
          if (!opts.onLine) return;
          const lines = (rest[stream] + text).split(/\r?\n|\r/);
          rest[stream] = lines.pop() ?? '';
          for (const line of lines) if (line !== '') opts.onLine(stream, line);
        };
        child.stdout.on('data', feed('stdout'));
        child.stderr.on('data', feed('stderr'));

        let aborted = false;
        let killTimer = null;
        const onAbort = () => {
          aborted = true;
          child.kill('SIGTERM');
          killTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
        };
        opts.signal?.addEventListener('abort', onAbort, { once: true });

        let spawnError = null;
        child.on('error', (err) => {
          spawnError = /** @type {any} */ (err).code === 'ENOENT' ? 'not_found' : null;
        });
        child.on('close', (code) => {
          if (killTimer) clearTimeout(killTimer);
          opts.signal?.removeEventListener('abort', onAbort);
          if (opts.onLine) {
            for (const s of ['stdout', 'stderr']) if (rest[s] !== '') opts.onLine(/** @type {any} */ (s), rest[s]);
          }
          resolve({ exitCode: code, stdout: out.stdout, stderr: out.stderr, error: spawnError ?? (aborted ? 'aborted' : null) });
        });
      });
    },
  };
}
