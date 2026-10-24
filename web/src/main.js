// Start, Aktionen, Ereignisse. Einzige Stelle, die Uhr und Benutzeraktionen kennt.

import { AUDIO_BITRATES, AUDIO_FORMATS, COOKIE_BROWSERS, MAX_HEIGHTS, VIDEO_CONTAINERS, sanitizeOptions } from '/core/model.js';
import { parseUrl, pickFormats } from '/core/logic.js';
import { api } from './api.js';
import * as T from './texts.js';
import { $, errorNote, fillSelect, h, note, previewText, renderDevices, renderHistoryRow, renderJob, renderMeta, renderPicker, renderTools, setNote } from './ui.js';

const state = {
  status: null,
  options: sanitizeOptions(null),
  meta: null,
  url: '',
  parsed: null,
  selected: new Set(), // ausgewählte Playlist-Positionen
  jobs: new Map(),
  history: [],
};

// ---------- Optionen ----------

const nullable = (v) => (v === '' ? null : Number(v));

function readOptions() {
  state.options = sanitizeOptions({
    ...state.options,
    maxHeight: nullable($('#opt-height').value),
    container: $('#opt-container').value,
    audioFormat: $('#opt-audio-format').value,
    audioBitrateKbps: nullable($('#opt-bitrate').value),
    embedMetadata: $('#opt-meta').checked,
    embedThumbnail: $('#opt-thumb').checked,
    wholePlaylist: $('#opt-playlist').checked,
  });
}

function showOptions() {
  const o = state.options;
  for (const b of document.querySelectorAll('.mode-switch button')) b.setAttribute('aria-pressed', String(b.dataset.mode === o.mode));
  for (const el of document.querySelectorAll('[data-for]')) el.hidden = el.dataset.for !== o.mode;
  $('#opt-bitrate').disabled = o.audioFormat === 'original' || o.audioFormat === 'flac';
  $('#opt-thumb').closest('label').hidden = o.mode === 'video' && o.container === 'webm';
  const formats = state.meta?.kind === 'video' ? state.meta.formats : [];
  $('#preview').textContent = previewText(pickFormats(formats, o), o, formats.length > 0);
  showPicker();
}

// ---------- Titelauswahl (Playlist) ----------

/** Gilt die Auswahl? Nur wenn eine Playlist geladen wird, nicht das einzelne Video daraus. */
const picking = () => state.meta?.kind === 'playlist' && (state.parsed?.kind === 'playlist' || (state.parsed?.kind === 'video-in-playlist' && state.options.wholePlaylist));

function showPicker() {
  const picker = $('#picker');
  if (!picker) return;
  picker.hidden = !picking();
  const total = state.meta.entries.length;
  for (const box of picker.querySelectorAll('input[data-index]')) box.checked = state.selected.has(Number(box.dataset.index));
  $('#pick-count').textContent = T.PICK.count(state.selected.size, total);
  $('#download-btn').disabled = picking() && state.selected.size === 0;
}

const pickHandlers = {
  pick: (index, on) => {
    if (on) state.selected.add(index);
    else state.selected.delete(index);
    showPicker();
  },
  all: (on) => {
    state.selected = new Set(on ? state.meta.entries.map((e) => e.index) : []);
    showPicker();
  },
};

/** null = ganze Playlist; sonst die ausgewählten Positionen. */
function playlistItems() {
  if (!picking() || state.selected.size === state.meta.entries.length) return null;
  return [...state.selected].sort((a, b) => a - b);
}

function initOptions(defaults) {
  state.options = sanitizeOptions(defaults);
  const o = state.options;
  fillSelect($('#opt-height'), MAX_HEIGHTS, T.HEIGHT, o.maxHeight);
  fillSelect($('#opt-container'), VIDEO_CONTAINERS, (v) => T.CONTAINER[v], o.container);
  fillSelect($('#opt-audio-format'), AUDIO_FORMATS, (v) => T.AUDIO_FORMAT[v], o.audioFormat);
  fillSelect($('#opt-bitrate'), AUDIO_BITRATES, T.BITRATE, o.audioBitrateKbps);
  $('#opt-meta').checked = o.embedMetadata;
  $('#opt-thumb').checked = o.embedThumbnail;
  $('#opt-playlist').checked = o.wholePlaylist;
  showOptions();
}

// ---------- Prüfen und Laden ----------

async function probe(e) {
  e.preventDefault();
  const input = $('#url').value;
  const parsed = parseUrl(input);
  state.meta = null;
  $('#download-btn').disabled = false;
  $('#meta').hidden = true;
  $('#options').hidden = true;
  if (!parsed.ok) return setNote($('#probe-note'), note('warn', 'Prüfen', T.URL_ERROR[parsed.error]));
  if (parsed.kind === 'channel') return setNote($('#probe-note'), note('warn', 'Kanal', 'Ganze Kanäle lädt die App nicht. Bitte ein Video oder eine Playlist einfügen.'));
  state.url = input;
  state.parsed = parsed;
  $('#opt-playlist-row').hidden = parsed.kind !== 'video-in-playlist' && parsed.kind !== 'playlist';
  if (parsed.kind === 'playlist') $('#opt-playlist').checked = true;
  readOptions();
  setNote($('#probe-note'), note('info', 'Prüfe', 'Metadaten werden geladen …'));
  $('#probe-btn').disabled = true;
  const r = await api.probe(input, state.options.wholePlaylist).catch(() => null);
  $('#probe-btn').disabled = false;
  if (!r || !r.ok) return setNote($('#probe-note'), note('err', 'Fehler', 'Der lokale Server antwortet nicht.'));
  const res = r.data;
  if (!res.ok) {
    setNote($('#probe-note'), errorNote(res.errorCode, res.detail, res.attempts ?? []));
    // Laden trotzdem anbieten: Fallbacks (z. B. Aufnahme) brauchen keine Metadaten.
    if (res.errorCode !== 'invalid_url' && res.errorCode !== 'deleted' && res.errorCode !== 'drm') $('#options').hidden = false;
    showOptions();
    return;
  }
  setNote($('#probe-note'), null);
  state.meta = res.metadata;
  state.selected = new Set(res.metadata.entries.map((e) => e.index));
  const picker = res.metadata.kind === 'playlist' ? renderPicker(res.metadata.entries, state.selected, pickHandlers) : null;
  $('#meta').replaceChildren(renderMeta(res.metadata, res.strategy, picker));
  $('#meta').hidden = false;
  $('#options').hidden = false;
  showOptions();
}

async function download() {
  readOptions();
  const items = playlistItems();
  if (items && items.length === 0) return setNote($('#probe-note'), note('warn', 'Auswahl', T.PICK.nothing));
  const r = await api.addJob(state.url, state.options, items);
  if (r.status === 403) return $('#legal').showModal();
  if (!r.ok) return setNote($('#probe-note'), note('err', 'Fehler', 'Auftrag konnte nicht angelegt werden.'));
  upsertJob(r.data);
  document.getElementById('auftraege').scrollIntoView({ behavior: 'smooth' });
}

// ---------- Aufträge und Verlauf ----------

const handlers = {
  cancel: (id) => api.cancel(id),
  retry: async (id) => {
    const r = await api.retry(id);
    if (r.ok) upsertJob(r.data);
  },
  reveal: (path) => api.reveal(path),
  fileUrl: api.fileUrl,
  local: true, // wird mit dem Status gesetzt: false auf einem gekoppelten iPhone/iPad
};

function upsertJob(job) {
  state.jobs.set(job.id, job);
  const list = $('#jobs');
  const el = renderJob(job, handlers);
  const old = list.querySelector(`[data-id="${CSS.escape(job.id)}"]`);
  if (old) old.replaceWith(el);
  else {
    list.querySelector('.empty')?.remove();
    list.prepend(el);
  }
}

function renderHistory() {
  const rows = state.history.map((j) => renderHistoryRow(j, handlers));
  $('#history').replaceChildren(...(rows.length ? rows : [h('tr', {}, h('td', { colspan: 5, class: 'empty' }, 'Noch nichts geladen.'))]));
}

async function exportData() {
  const r = await api.exportData();
  if (!r.ok) return;
  const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `youtube-downloader-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    return setNote($('#history-note'), note('err', 'Import', T.IMPORT_ERROR.not_json));
  }
  const r = await api.importData(data);
  if (!r.ok) return setNote($('#history-note'), note('err', 'Import', T.IMPORT_ERROR[r.data?.error] ?? T.IMPORT_ERROR.bad_format));
  setNote($('#history-note'), note('ok', 'Import', `${r.data.count} Einträge übernommen.`));
  await loadStatus();
}

async function clearHistory() {
  if (!confirm('Verlauf wirklich leeren? Die heruntergeladenen Dateien bleiben erhalten.')) return;
  await api.clearHistory();
}

// ---------- Einstellungen ----------

function showSettings(s) {
  $('#set-outdir').value = s.settings.outputDir ?? '';
  $('#set-outdir').placeholder = s.outputDir;
  fillSelect($('#set-browser'), [null, ...COOKIE_BROWSERS], (v) => (v === null ? 'Aus' : T.BROWSER[v]), s.settings.cookieBrowser);
  $('#set-capture').checked = s.settings.allowBrowserCapture;
  $('#set-apikey').placeholder = s.tools.apiKeySet ? 'gesetzt (zum Ändern neu eingeben)' : 'nicht gesetzt';
  $('#tools').replaceChildren(renderTools(s));
  const client = s.client ?? { local: true, lan: false, pairUrls: [] };
  if (handlers.local !== client.local) {
    handlers.local = client.local;
    document.documentElement.dataset.client = client.local ? 'local' : 'remote';
    for (const job of state.jobs.values()) upsertJob(job);
    renderHistory();
  }
  $('#devices').replaceChildren(renderDevices(client, copyPairLink));
  const y = s.tools.ytdlp;
  $('#tool-state').textContent = y.ok ? `yt-dlp ${y.version}` : 'yt-dlp fehlt';
  if (!y.ok) setNote($('#global-note'), note('err', 'Programm fehlt', T.ERROR.tool_missing[1]));
  else setNote($('#global-note'), null);
}

async function copyPairLink(url) {
  try {
    await navigator.clipboard.writeText(url);
    $('#settings-saved').textContent = T.DEVICE.copied;
  } catch {
    prompt('Link zum Kopieren:', url);
  }
}

async function saveSettings() {
  const patch = {
    outputDir: $('#set-outdir').value.trim() || null,
    cookieBrowser: $('#set-browser').value || null,
    allowBrowserCapture: $('#set-capture').checked,
    defaults: state.options,
  };
  await api.saveSettings(patch);
  const key = $('#set-apikey').value.trim();
  if (key) await api.saveSecrets({ youtubeApiKey: key });
  $('#set-apikey').value = '';
  $('#settings-saved').textContent = 'Gespeichert.';
  setTimeout(() => ($('#settings-saved').textContent = ''), 2500);
  await loadStatus(true);
}

async function updateCheck() {
  setNote($('#update-note'), note('info', 'Update', 'Prüfe …'));
  const r = await api.updateCheck();
  const d = r.data;
  if (!d?.ok) return setNote($('#update-note'), note('warn', 'Update', 'Die neueste Version konnte nicht abgefragt werden (GitHub nicht erreichbar).'));
  if (d.updateAvailable) {
    return setNote($('#update-note'), note('warn', 'Update', `yt-dlp ${d.latest} ist verfügbar (installiert: ${d.installed}). Aktualisieren mit `, h('code', {}, 'brew upgrade yt-dlp'), ' oder ', h('code', {}, 'yt-dlp -U'), '.'));
  }
  setNote($('#update-note'), note('ok', 'Aktuell', `yt-dlp ${d.installed} ist die neueste Version.`));
}

async function loadStatus(refresh = false) {
  const r = await api.status(refresh).catch(() => null);
  if (r?.status === 401) return setNote($('#global-note'), note('err', 'Kopplung', T.DEVICE.notPaired));
  if (!r?.ok) return setNote($('#global-note'), note('err', 'Server', 'Der lokale Server läuft nicht. Im Projektordner „npm start“ ausführen.'));
  state.status = r.data;
  showSettings(r.data);
  if (!r.data.settings.legalNoticeAccepted) $('#legal').showModal();
  return r.data;
}

// ---------- Desktop: Einfügen und Ziehen ----------

/** URL aus Zwischenablage oder Drag & Drop direkt prüfen; „/“ springt ins URL-Feld. */
function bindQuickInput() {
  const take = (text) => {
    const url = (text ?? '').trim().split(/\s+/)[0];
    if (!url || !parseUrl(url).ok) return false;
    $('#url').value = url;
    $('#url-form').requestSubmit();
    return true;
  };
  const typing = (el) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  document.addEventListener('paste', (e) => {
    if (!typing(e.target) && take(e.clipboardData?.getData('text'))) e.preventDefault();
  });
  document.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('text/uri-list') || e.dataTransfer?.types.includes('text/plain')) {
      e.preventDefault();
      document.body.classList.add('dropping');
    }
  });
  document.addEventListener('dragleave', (e) => e.relatedTarget === null && document.body.classList.remove('dropping'));
  document.addEventListener('drop', (e) => {
    document.body.classList.remove('dropping');
    if (take(e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain'))) e.preventDefault();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target) && !$('#legal').open) {
      e.preventDefault();
      $('#url').focus();
      $('#url').select();
    }
  });
}

// ---------- Start ----------

async function start() {
  if (localStorage.getItem('theme')) document.documentElement.dataset.theme = localStorage.getItem('theme');
  $('#legal-text').textContent = T.LEGAL;
  $('#capture-note').textContent = T.CAPTURE_NOTE;
  $('#legal').addEventListener('cancel', (e) => e.preventDefault());
  $('#legal-accept').addEventListener('click', async () => {
    await api.saveSettings({ legalNoticeAccepted: true });
    $('#legal').close();
  });

  $('#url-form').addEventListener('submit', probe);
  $('#download-btn').addEventListener('click', download);
  for (const b of document.querySelectorAll('.mode-switch button')) {
    b.addEventListener('click', () => {
      state.options = { ...state.options, mode: b.dataset.mode };
      showOptions();
    });
  }
  for (const id of ['#opt-height', '#opt-container', '#opt-audio-format', '#opt-bitrate', '#opt-meta', '#opt-thumb', '#opt-playlist']) {
    $(id).addEventListener('change', () => {
      readOptions();
      showOptions();
    });
  }
  $('#export-btn').addEventListener('click', exportData);
  $('#import-file').addEventListener('change', importData);
  $('#clear-btn').addEventListener('click', clearHistory);
  $('#save-settings').addEventListener('click', saveSettings);
  $('#update-btn').addEventListener('click', updateCheck);
  $('#refresh-btn').addEventListener('click', () => loadStatus(true));
  bindQuickInput();

  const s = await loadStatus();
  initOptions(s?.settings.defaults ?? null);
  renderHistory();

  api.events(
    (msg) => {
      if (msg.type === 'hello') {
        for (const j of msg.jobs) upsertJob(j);
        state.history = msg.history;
        renderHistory();
      } else if (msg.type === 'job') upsertJob(msg.job);
      else if (msg.type === 'history') {
        state.history = msg.history;
        renderHistory();
      }
    },
    (connected) => {
      if (!connected) setNote($('#global-note'), note('warn', 'Verbindung', 'Verbindung zum lokalen Server unterbrochen. Neuer Versuch läuft …'));
      else if (state.status?.tools.ytdlp.ok) setNote($('#global-note'), null);
    },
  );

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
