// Adapter: ffmpeg. Wird von Strategie D zum Umwandeln der Aufnahme genutzt
// (bei A/B ruft yt-dlp ffmpeg selbst auf).

/**
 * Zielformat und ffmpeg-Argumente für eine Aufnahme. Rein, ohne Prozessstart.
 * @param {string} input
 * @param {string} outputBase  Pfad ohne Endung
 * @param {import('../core/model.js').DownloadRequestOptions} o
 * @param {{title: string|null, artist: string|null}} tags
 * @returns {{output: string, args: string[]}}
 */
export function buildConvertArgs(input, outputBase, o, tags) {
  const meta = [];
  if (o.embedMetadata && tags.title) meta.push('-metadata', `title=${tags.title}`);
  if (o.embedMetadata && tags.artist) meta.push('-metadata', `artist=${tags.artist}`);
  const head = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', input];
  const br = o.audioBitrateKbps !== null ? ['-b:a', `${o.audioBitrateKbps}k`] : [];
  if (o.mode === 'audio') {
    const table = {
      original: { ext: 'opus', codec: ['-c:a', 'copy'], bitrate: false },
      opus: { ext: 'opus', codec: ['-c:a', 'libopus'], bitrate: true },
      mp3: { ext: 'mp3', codec: ['-c:a', 'libmp3lame'], bitrate: true },
      m4a: { ext: 'm4a', codec: ['-c:a', 'aac'], bitrate: true },
      flac: { ext: 'flac', codec: ['-c:a', 'flac'], bitrate: false },
    }[o.audioFormat];
    const output = `${outputBase}.${table.ext}`;
    return { output, args: [...head, '-vn', ...table.codec, ...(table.bitrate ? br : []), ...meta, output] };
  }
  const output = `${outputBase}.${o.container}`;
  const codec = o.container === 'mp4' ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart'] : ['-c', 'copy'];
  return { output, args: [...head, ...codec, ...meta, output] };
}

/**
 * Dateiname aus einem Titel: keine Pfadtrenner, keine Steuerzeichen, begrenzte Länge.
 * @param {string|null} title
 * @returns {string}
 */
export function safeFileName(title) {
  const clean = (title ?? '').replace(/[\/\\:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '');
  return (clean || 'Aufnahme').slice(0, 150);
}

/**
 * @param {{runner: import('./process.js').ProcessRunner, binary?: string}} cfg
 */
export function createFfmpeg(cfg) {
  const binary = cfg.binary ?? 'ffmpeg';
  return {
    /** @returns {Promise<{ok: boolean, version: string|null}>} */
    async checkAvailable() {
      const r = await cfg.runner.run(binary, ['-version']);
      const m = /ffmpeg version (\S+)/.exec(r.stdout);
      return r.exitCode === 0 ? { ok: true, version: m ? m[1] : 'unknown' } : { ok: false, version: null };
    },
    /**
     * @param {string[]} args
     * @param {AbortSignal} signal
     * @returns {Promise<{ok: boolean, detail: string|null}>}
     */
    async run(args, signal) {
      const r = await cfg.runner.run(binary, args, { signal });
      if (r.error === 'not_found') return { ok: false, detail: 'ffmpeg_missing' };
      return r.exitCode === 0 ? { ok: true, detail: null } : { ok: false, detail: r.stderr.trim().split('\n').pop() ?? null };
    },
  };
}
