// Verbindung zum lokalen Server: JSON-API und Ereignisstrom (SSE).

const json = async (method, path, body) => {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
};

export const api = {
  status: (refresh = false) => json('GET', `/api/status${refresh ? '?refresh=1' : ''}`),
  saveSettings: (patch) => json('PUT', '/api/settings', patch),
  saveSecrets: (secrets) => json('PUT', '/api/secrets', secrets),
  probe: (url, wholePlaylist) => json('POST', '/api/probe', { url, wholePlaylist }),
  addJob: (url, options, playlistItems = null) => json('POST', '/api/jobs', { url, options, playlistItems }),
  cancel: (id) => json('POST', `/api/jobs/${encodeURIComponent(id)}/cancel`),
  retry: (id) => json('POST', `/api/jobs/${encodeURIComponent(id)}/retry`),
  clearHistory: () => json('DELETE', '/api/history'),
  exportData: () => json('GET', '/api/export'),
  importData: (data) => json('POST', '/api/import', data),
  updateCheck: () => json('GET', '/api/update-check'),
  reveal: (path) => json('POST', '/api/reveal', { path }),
  fileUrl: (path) => `/api/file?path=${encodeURIComponent(path)}`,
  /** @param {(msg: any) => void} onMessage @param {(connected: boolean) => void} onState */
  events(onMessage, onState) {
    const es = new EventSource('/api/events');
    es.onopen = () => onState(true);
    es.onerror = () => onState(false);
    es.onmessage = (e) => onMessage(JSON.parse(e.data));
    return () => es.close();
  },
};
