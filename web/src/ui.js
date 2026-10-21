// Oberfläche: Rendering und Formatierung. Titel und Fehlertexte kommen von außen,
// deshalb nur textContent, nie innerHTML mit Daten.

import { qrSvg } from './qr.js';
import * as T from './texts.js';

/** Kleines Hilfsmittel zum Bauen von Elementen. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export const $ = (sel) => document.querySelector(sel);

// ---------- Formatierung ----------

export function formatBytes(n) {
  if (n === null || n === undefined) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v.toLocaleString('de-DE', { maximumFractionDigits: i === 0 ? 0 : 1 })} ${units[i]}`;
}

export function formatDuration(sec) {
  if (sec === null || sec === undefined) return '';
  const s = Math.round(sec);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh > 0 ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

export const formatDate = (iso) => (iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '');
export const formatDay = (ymd) => (ymd ? new Date(`${ymd}T00:00:00Z`).toLocaleDateString('de-DE', { timeZone: 'UTC' }) : '');

// ---------- Bausteine ----------

/** @param {'info'|'ok'|'warn'|'err'|''} kind */
export function note(kind, cap, ...text) {
  return h('div', { class: `note ${kind}`.trim(), role: kind === 'err' ? 'alert' : null }, h('span', { class: 'cap' }, cap), ...text);
}

export function setNote(container, el) {
  container.replaceChildren(...(el ? [el] : []));
}

export function fillSelect(select, values, label, selected) {
  select.replaceChildren(...values.map((v) => h('option', { value: v === null ? '' : String(v), selected: v === selected }, label(v))));
}

/** Fehler eines Jobs oder einer Prüfung als Hinweis mit Anleitung. */
export function errorNote(code, detail, attempts = []) {
  const [title, help] = T.ERROR[code] ?? T.ERROR.unknown;
  const parts = [h('strong', {}, title), help ? ` ${help}` : ''];
  const extra = [];
  if (attempts.some((a) => a.strategy === 'official' && a.errorCode === 'needs_user_action')) extra.push(h('p', { class: 'small' }, T.DETAIL.studio_or_takeout));
  if (detail && T.DETAIL[detail]) extra.push(h('p', { class: 'small' }, T.DETAIL[detail]));
  else if (detail) extra.push(h('details', {}, h('summary', {}, 'Details'), h('div', {}, h('pre', {}, detail))));
  if (attempts.length > 1) {
    extra.push(h('p', { class: 'small muted' }, 'Versucht: ', attempts.map((a) => `${T.STRATEGY[a.strategy]} (${(T.ERROR[a.errorCode] ?? T.ERROR.unknown)[0]})`).join(' → ')));
  }
  return note(code === 'cancelled' ? 'info' : 'err', code === 'cancelled' ? 'Info' : 'Fehler', ...parts, ...extra);
}

// ---------- Ansichten ----------

/** @param {import('/core/model.js').Metadata} m */
export function renderMeta(m, strategy) {
  const tags = [];
  if (m.kind === 'playlist') tags.push(h('span', { class: 'tag inv' }, `Playlist · ${m.entries.length}`));
  if (T.LIVE[m.liveStatus]) tags.push(h('span', { class: 'tag' }, T.LIVE[m.liveStatus]));
  if (m.ageLimit >= 18) tags.push(h('span', { class: 'tag acc' }, 'ab 18'));
  if (m.license && /creative commons/i.test(m.license)) tags.push(h('span', { class: 'tag acc' }, 'CC-Lizenz'));
  tags.push(h('span', { class: 'tag' }, `über ${T.STRATEGY[strategy]}`));
  const facts = [m.uploader, formatDuration(m.durationSec), formatDay(m.uploadDate)].filter(Boolean).join(' · ');
  const figure = m.thumbnailUrl
    ? h('figure', {}, h('img', { class: 'media', src: m.thumbnailUrl, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }), h('figcaption', {}, h('b', {}, 'ABB. 01'), 'Vorschaubild'))
    : null;
  const entries = m.kind === 'playlist'
    ? h('div', { class: 'entries' }, m.entries.map((e, i) => h('div', { class: 'row' }, h('span', {}, `${String(i + 1).padStart(2, '0')} · ${e.title || e.id} `, e.durationSec ? h('span', { class: 'muted' }, formatDuration(e.durationSec)) : null))))
    : null;
  const warn = m.liveStatus === 'is_live' || m.liveStatus === 'is_upcoming' ? note('warn', 'Achtung', T.ERROR.live_not_finished[1]) : null;
  return h('div', { class: 'card' },
    h('div', { class: figure ? 'meta-layout' : '' },
      figure,
      h('div', {},
        h('h3', { class: 'break' }, m.title || m.id),
        h('p', {}, facts),
        h('div', { class: 'meta-tags' }, tags),
        m.license ? h('p', { class: 'small' }, `Lizenz: ${m.license}`) : null,
      ),
    ),
    warn,
    entries,
  );
}

/** Vorschau, was geladen wird (aus logic.pickFormats). */
export function previewText(choice, options, hasFormats) {
  if (!hasFormats) return options.mode === 'audio' ? 'Bestes verfügbares Audio wird geladen.' : 'Bestes Video innerhalb der gewählten Grenzen wird geladen.';
  const f = (x) => [x.height ? `${x.height}p` : null, x.ext, x.vcodec, x.acodec, x.abrKbps ? `${Math.round(x.abrKbps)} kbit/s` : null, x.sizeBytes ? formatBytes(x.sizeBytes) : null].filter(Boolean).join(' · ');
  if (!choice.video && !choice.audio) return 'Mit diesen Einstellungen passt kein Format.';
  const parts = [];
  if (choice.video) parts.push(`Video: ${f(choice.video)}`);
  if (choice.audio) parts.push(`Audio: ${f(choice.audio)}`);
  if (choice.merge) parts.push('wird per ffmpeg zusammengeführt');
  if (choice.transcode) parts.push(`wird nach ${T.AUDIO_FORMAT[options.audioFormat]} umgewandelt`);
  return `Voraussichtlich ${parts.join('; ')}.`;
}

/**
 * @param {import('/core/model.js').Job} job
 * @param {{cancel: (id: string) => void, retry: (id: string) => void, reveal: (path: string) => void, local: boolean, fileUrl: (path: string) => string}} on
 */
export function renderJob(job, on) {
  const active = !['done', 'failed', 'cancelled'].includes(job.state);
  const pct = job.percent ?? 0;
  const bar = active
    ? h('div', { class: `progress${job.percent === null ? ' indeterminate' : ''}`, role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': job.percent === null ? null : Math.round(pct) }, h('span', { style: `width:${pct}%` }))
    : null;
  const facts = [
    job.percent !== null && active ? `${pct.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %` : null,
    job.playlistCount ? `Teil ${job.playlistIndex} von ${job.playlistCount}` : null,
    job.downloadedBytes ? formatBytes(job.downloadedBytes) + (job.totalBytes ? ` von ${formatBytes(job.totalBytes)}` : '') : null,
    job.speedBps ? `${formatBytes(job.speedBps)}/s` : null,
    job.etaSec !== null && active ? `noch ${formatDuration(job.etaSec)}` : null,
  ].filter(Boolean).join(' · ');
  const buttons = [];
  if (active) buttons.push(h('button', { class: 'btn', type: 'button', onclick: () => on.cancel(job.id) }, 'Abbrechen'));
  if (job.state === 'failed' || job.state === 'cancelled') buttons.push(h('button', { class: 'btn', type: 'button', onclick: () => on.retry(job.id) }, 'Wiederholen'));
  for (const f of job.files) buttons.push(fileAction(f, on, on.local ? 'Im Finder zeigen' : 'Auf dieses Gerät laden'));
  return h('div', { class: 'job', 'data-id': job.id },
    h('div', { class: 'job-head' },
      h('span', { class: 'job-title' }, job.title || job.url),
      h('span', { class: 'meta-tags' },
        h('span', { class: `tag${job.state === 'done' ? ' inv' : job.state === 'failed' ? ' acc' : ''}` }, T.STATE[job.state]),
        job.strategy ? h('span', { class: 'tag' }, T.STRATEGY[job.strategy]) : null,
        h('span', { class: 'tag' }, T.MODE[job.options.mode]),
      ),
    ),
    bar,
    facts ? h('p', { class: 'small muted' }, facts) : null,
    job.strategy === 'browser-capture' && active ? note('info', 'Hinweis', T.CAPTURE_NOTE) : null,
    job.state === 'failed' ? errorNote(job.errorCode ?? 'unknown', job.errorDetail, job.attempts) : null,
    job.files.length ? h('p', { class: 'small break' }, job.files.join('\n')) : null,
    buttons.length ? h('div', { class: 'actions' }, buttons) : null,
  );
}

export function renderHistoryRow(job, on) {
  return h('tr', {},
    h('td', { class: 'small' }, formatDate(job.finishedAt ?? job.createdAt)),
    h('td', { class: 'break' }, job.title || job.url, job.files[0] ? h('div', { class: 'small muted' }, job.files.length > 1 ? `${job.files.length} Dateien` : job.files[0].split('/').pop()) : null),
    h('td', {}, h('span', { class: `tag${job.state === 'done' ? ' inv' : ''}` }, T.STATE[job.state]), job.state === 'failed' ? h('div', { class: 'small muted' }, (T.ERROR[job.errorCode] ?? T.ERROR.unknown)[0]) : null),
    h('td', { class: 'small' }, job.strategy ? T.STRATEGY[job.strategy] : ''),
    h('td', {}, job.state !== 'done' ? h('button', { class: 'btn', type: 'button', onclick: () => on.retry(job.id) }, 'Wiederholen') : job.files[0] ? fileAction(job.files[0], on, on.local ? 'Zeigen' : 'Laden') : null),
  );
}

/** Auf dem Mac: im Finder zeigen. Auf einem gekoppelten Gerät: Datei herunterladen (iOS legt sie in „Dateien“ ab). */
function fileAction(path, on, label) {
  if (on.local) return h('button', { class: 'btn', type: 'button', title: path, onclick: () => on.reveal(path) }, label);
  return h('a', { class: 'btn', href: on.fileUrl(path), download: path.split('/').pop(), title: path }, label);
}

/**
 * Kopplung fürs iPhone (nur auf dem Mac sichtbar) bzw. Hinweis auf dem gekoppelten Gerät.
 * @param {{local: boolean, lan: boolean, pairUrls: string[]}} client
 * @param {(url: string) => void} onCopy
 */
export function renderDevices(client, onCopy) {
  if (!client.local) return note('info', 'Fernbedienung', T.DEVICE.remote);
  if (!client.lan) return h('p', { class: 'muted' }, T.DEVICE.lanOff);
  const url = client.pairUrls[0];
  if (!url) return note('warn', 'Heimnetz', T.DEVICE.noAddress);
  const code = h('div', { class: 'qr', role: 'img', 'aria-label': 'QR-Code mit dem Kopplungs-Link' });
  code.innerHTML = qrSvg(url); // selbst erzeugtes SVG, keine fremden Daten
  return h('div', { class: 'pairing' },
    code,
    h('div', {},
      h('p', {}, T.DEVICE.scan),
      h('p', { class: 'small muted break' }, 'Weitere Adressen dieses Macs: ', client.pairUrls.slice(1).map((u) => new URL(u).host).join(', ') || '–'),
      h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: () => onCopy(url) }, T.DEVICE.copy)),
    ),
  );
}

export function renderTools(status) {
  const rows = [];
  const why = (t) => (t.errorCode === 'needs_user_action' ? 'kein Browser gewählt' : (T.ERROR[t.errorCode] ?? T.ERROR.unknown)[0]);
  const tool = (name, t, off = false) =>
    h('div', { class: `row${t.ok ? '' : ' prio'}` }, h('span', {}, h('strong', {}, name), ' ',
      !t.ok ? h('span', {}, `nicht verfügbar: ${why(t)}`) : off ? h('span', { class: 'muted' }, 'bereit, aber ausgeschaltet') : h('span', { class: 'muted' }, t.version ?? 'bereit')));
  rows.push(tool('yt-dlp', status.tools.ytdlp));
  rows.push(tool('ffmpeg', status.tools.ffmpeg));
  for (const id of status.settings.chain) {
    const s = status.tools.strategies[id];
    if (s) rows.push(tool(T.STRATEGY[id], s, id === 'browser-capture' && !status.settings.allowBrowserCapture));
  }
  return h('div', {}, rows, h('p', { class: 'small muted' }, `Reihenfolge der Fallback-Kette: ${status.settings.chain.map((id) => T.STRATEGY[id].split(' · ')[0]).join(' → ')}`));
}
