// Läuft im sichtbaren Browser (nicht in Node). Wartet, bis der Nutzer das Video startet,
// nimmt es mit captureStream + MediaRecorder auf und meldet Daten über __ytdSend an die App.
// Kein Umgehen von Schutzmaßnahmen: bei DRM (mediaKeys) bricht die Aufnahme sofort ab.

export const PAGE_SCRIPT = String.raw`
(() => {
  if (window.__ytdInstalled) return;
  window.__ytdInstalled = true;
  const send = (msg) => window.__ytdSend && window.__ytdSend(msg);
  const audioOnly = window.__ytdAudioOnly === true;
  let recorder = null;
  let video = null;

  const toBase64 = (buf) => {
    let s = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };

  const start = (v) => {
    if (recorder) return;
    if (v.mediaKeys) { send({ type: 'drm' }); return; }
    let stream;
    try { stream = (v.captureStream || v.mozCaptureStream).call(v); } catch (e) { send({ type: 'error', detail: String(e) }); return; }
    if (audioOnly) stream = new MediaStream(stream.getAudioTracks());
    const types = audioOnly ? ['audio/webm;codecs=opus'] : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    let queue = Promise.resolve();
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) queue = queue.then(() => e.data.arrayBuffer()).then((b) => send({ type: 'chunk', data: toBase64(b) }));
    };
    recorder.onstop = () => { queue.then(() => send({ type: 'stopped' })); };
    recorder.start(1000);
    video = v;
    send({ type: 'started', title: document.title, mimeType });
    v.addEventListener('timeupdate', () => send({ type: 'progress', current: v.currentTime, duration: isFinite(v.duration) ? v.duration : null }));
    v.addEventListener('ended', () => recorder && recorder.state !== 'inactive' && recorder.stop());
  };

  window.__ytdStop = () => { if (recorder && recorder.state !== 'inactive') recorder.stop(); else send({ type: 'stopped' }); };

  document.addEventListener('playing', (e) => {
    if (e.target instanceof HTMLVideoElement) start(e.target);
  }, true);
  document.addEventListener('encrypted', () => send({ type: 'drm' }), true);
})();
`;
