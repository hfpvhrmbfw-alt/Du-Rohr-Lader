// Hülle: Warteschlange der Download-Jobs. Führt Jobs über die Ablaufsteuerung des Kerns aus,
// hält Abbruch-Signale und meldet jede Änderung an die Zuhörer (SSE).

import { applyJobEvent, addToHistory } from '../src/core/logic.js';
import { emptyJob, FINAL_JOB_STATES } from '../src/core/model.js';
import { runJob } from '../src/core/orchestrator.js';

/**
 * @param {{
 *   newId: () => string,
 *   now: () => string,
 *   context: () => Promise<{engines: Object<string, any>, available: Object<string, boolean>, settings: import('../src/core/model.js').Settings, outputDir: string}>,
 *   onHistory: (history: import('../src/core/model.js').Job[]) => void,
 *   history: import('../src/core/model.js').Job[],
 *   concurrency?: number,
 *   onBusy?: (busy: boolean) => void,  läuft mindestens ein Job?
 * }} deps
 */
export function createJobManager(deps) {
  /** @type {Map<string, import('../src/core/model.js').Job>} */
  const jobs = new Map();
  /** @type {Map<string, AbortController>} */
  const controllers = new Map();
  /** @type {Set<(msg: object) => void>} */
  const listeners = new Set();
  const queue = [];
  let running = 0;
  let history = deps.history;
  const limit = deps.concurrency ?? 1;

  const emit = (msg) => {
    for (const fn of listeners) fn(msg);
  };
  const set = (job) => {
    jobs.set(job.id, job);
    emit({ type: 'job', job });
  };

  const pump = async () => {
    while (running < limit && queue.length > 0) {
      const id = queue.shift();
      const job = jobs.get(id);
      if (!job || job.state !== 'queued') continue;
      if (running++ === 0) deps.onBusy?.(true);
      const ac = new AbortController();
      controllers.set(id, ac);
      (async () => {
        try {
          const ctx = await deps.context();
          const end = await runJob(job, ctx.outputDir, {
            ...ctx,
            signal: ac.signal,
            now: deps.now,
            onUpdate: (j, ev) => {
              if (ev && ev.type === 'log') emit({ type: 'log', jobId: j.id, line: ev.line });
              else set(j);
            },
          });
          set(end);
          history = addToHistory(history, end);
          deps.onHistory(history);
          emit({ type: 'history', history });
        } catch (err) {
          const failed = applyJobEvent(jobs.get(id), { type: 'failed', errorCode: 'unknown', detail: String(err), at: deps.now() });
          set(failed);
        } finally {
          controllers.delete(id);
          if (--running === 0) deps.onBusy?.(false);
          pump();
        }
      })();
    }
  };

  return {
    /** @param {string} url @param {import('../src/core/model.js').DownloadRequestOptions} options @param {number[]|null} [playlistItems] */
    add(url, options, playlistItems = null) {
      const job = emptyJob(deps.newId(), url, options, deps.now(), playlistItems);
      set(job);
      queue.push(job.id);
      pump();
      return job;
    },
    /** @param {string} id */
    cancel(id) {
      const job = jobs.get(id);
      if (!job || FINAL_JOB_STATES.includes(job.state)) return false;
      const ac = controllers.get(id);
      if (ac) ac.abort();
      else set(applyJobEvent(job, { type: 'cancelled', at: deps.now() }));
      return true;
    },
    /** @param {string} id */
    retry(id) {
      const job = jobs.get(id) ?? history.find((h) => h.id === id);
      if (!job) return null;
      const again = applyJobEvent(job, { type: 'retry' });
      if (again === job) return null;
      set(again);
      queue.push(again.id);
      pump();
      return again;
    },
    list: () => [...jobs.values()],
    history: () => history,
    /** @param {import('../src/core/model.js').Job[]} next */
    replaceHistory(next) {
      history = next;
      deps.onHistory(history);
      emit({ type: 'history', history });
    },
    /** @param {(msg: object) => void} fn */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
