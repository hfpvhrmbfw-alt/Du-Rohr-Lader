// yt-dlp-Adapter, rein: baut Befehlszeilen aus Anfrage-Daten. Kein Prozessstart hier.

/** Markierungen, an denen parse.js die eigenen Ausgaben erkennt. */
export const MARK = { progress: '@@P', title: '@@T', file: '@@F', item: '@@I' };

const COMMON = ['--newline', '--color', 'never', '--no-warnings', '--ignore-config'];

/**
 * @param {string} url
 * @param {{cookieBrowser: string|null}} opts
 * @returns {string[]}
 */
export function buildProbeArgs(url, opts) {
  return [...COMMON, ...cookieArgs(opts.cookieBrowser), '--dump-single-json', '--flat-playlist', '--skip-download', '--', url];
}

/** @param {string|null} browser */
function cookieArgs(browser) {
  return browser ? ['--cookies-from-browser', browser] : [];
}

/**
 * Sortierreihenfolge (-S) statt starrer Format-IDs: yt-dlp wählt selbst das Beste innerhalb der Grenzen.
 * @param {import('../../core/model.js').DownloadRequestOptions} o
 * @returns {string[]}
 */
export function formatArgs(o) {
  if (o.mode === 'audio') {
    const sort = o.audioFormat === 'm4a' || o.audioFormat === 'mp3' ? ['-S', 'aext:m4a'] : o.audioFormat === 'opus' ? ['-S', 'acodec:opus'] : [];
    const args = ['-f', 'ba/b', ...sort, '-x', '--audio-format', o.audioFormat === 'original' ? 'best' : o.audioFormat];
    const lossy = o.audioFormat === 'mp3' || o.audioFormat === 'm4a' || o.audioFormat === 'opus';
    if (lossy && o.audioBitrateKbps !== null) args.push('--audio-quality', `${o.audioBitrateKbps}K`);
    return args;
  }
  const sort = [];
  if (o.maxHeight !== null) sort.push(`res:${o.maxHeight}`);
  if (o.container === 'mp4') sort.push('vcodec:h264', 'ext:mp4:m4a');
  if (o.container === 'webm') sort.push('ext:webm:webm');
  const args = ['-f', 'bv*+ba/b', '--merge-output-format', o.container];
  if (sort.length > 0) args.push('-S', sort.join(','));
  return args;
}

/**
 * @param {import('../../core/model.js').DownloadRequest} request
 * @param {{cookieBrowser: string|null, isPlaylist: boolean}} opts
 * @returns {string[]}
 */
export function buildDownloadArgs(request, opts) {
  const o = request.options;
  const name = opts.isPlaylist
    ? '%(playlist_title|Playlist)s/%(playlist_index)03d - %(title)s [%(id)s].%(ext)s'
    : '%(title)s [%(id)s].%(ext)s';
  const args = [
    ...COMMON,
    ...cookieArgs(opts.cookieBrowser),
    '--progress',
    '--progress-template', `download:${MARK.progress}%(progress)j`,
    '--print', `before_dl:${MARK.title}%(title)s`,
    '--print', `before_dl:${MARK.item}%(playlist_index|0)s/%(n_entries|0)s`,
    '--print', `after_move:${MARK.file}%(filepath)j`,
    opts.isPlaylist ? '--yes-playlist' : '--no-playlist',
    '-P', request.outputDir,
    '-o', name,
    ...formatArgs(o),
  ];
  if (o.embedMetadata) args.push('--embed-metadata');
  // webm kann kein eingebettetes Cover; yt-dlp würde sonst scheitern.
  const coverOk = o.mode === 'audio' || o.container !== 'webm';
  if (o.embedThumbnail && coverOk) args.push('--embed-thumbnail');
  args.push('--', request.url);
  return args;
}
