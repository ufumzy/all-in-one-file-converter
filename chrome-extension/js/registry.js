/**
 * CodeGreeks File Studio Media Registry
 * Unified catalog of media families, supported containers, codecs, and vector glyphs.
 */

const buildSvgGlyph = (bodyMarkup, attributes = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="cg-glyph" ${attributes}>${bodyMarkup}</svg>`;

export const VECTOR_GLYPHS = {
  app_logo: `<svg viewBox="0 0 24 24" fill="none" class="cg-glyph glyph-brand" aria-hidden="true"><path d="M6 6.5L12.5 12L6 17.5" stroke="#fffdf8" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><line x1="14" y1="17.5" x2="20" y2="17.5" stroke="#eda23c" stroke-width="2.6" stroke-linecap="round"/><circle cx="18" cy="7" r="2.2" fill="#248a58" stroke="#fffdf8" stroke-width="0.9"/></svg>`,
  document: buildSvgGlyph(
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>'
  ),
  image: buildSvgGlyph(
    '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>'
  ),
  video: buildSvgGlyph(
    '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>'
  ),
  audio: buildSvgGlyph(
    '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'
  ),
  upload: buildSvgGlyph(
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>'
  ),
  settings: buildSvgGlyph(
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>'
  ),
  back: buildSvgGlyph('<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>'),
  close: buildSvgGlyph('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  check: buildSvgGlyph('<polyline points="20 6 9 17 4 12"/>', 'stroke-width="2.5"'),
  shield: buildSvgGlyph('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
  chevron_down: buildSvgGlyph('<polyline points="6 9 12 15 18 9"/>'),
  chevron_right: buildSvgGlyph('<polyline points="9 18 15 12 9 6"/>'),
  download: buildSvgGlyph('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  trash: buildSvgGlyph('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  external_tab: buildSvgGlyph('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>'),
  sun: buildSvgGlyph('<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'),
  moon: buildSvgGlyph('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),
  monitor: buildSvgGlyph('<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>'),
  search: buildSvgGlyph('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
  refresh: buildSvgGlyph('<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>'),
  sparkle: buildSvgGlyph('<path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/>'),
  folder: buildSvgGlyph('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),
  arrow_right: buildSvgGlyph('<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>'),
  file_output: buildSvgGlyph('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/>')
};

export const MEDIA_MATRIX = {
  document: {
    displayName: 'Documents',
    singularTitle: 'Document',
    glyphKey: 'document',
    acceptedInputs: ['pdf', 'docx', 'txt', 'md', 'html', 'htm', 'csv', 'tsv', 'json'],
    potentialOutputs: ['pdf', 'docx', 'png', 'jpg', 'tif', 'txt', 'html', 'md', 'json', 'csv'],
    fallbackTarget: 'pdf',
  },
  image: {
    displayName: 'Images',
    singularTitle: 'Image',
    glyphKey: 'image',
    acceptedInputs: ['png', 'jpg', 'jpeg', 'heic', 'heif', 'webp', 'gif', 'svg', 'bmp', 'tif', 'tiff', 'ico', 'avif'],
    potentialOutputs: ['png', 'jpg', 'webp', 'pdf', 'gif', 'bmp', 'tif', 'ico'],
    fallbackTarget: 'png',
  },
  video: {
    displayName: 'Videos',
    singularTitle: 'Video',
    glyphKey: 'video',
    acceptedInputs: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', 'flv', 'wmv', '3gp', 'mpeg', 'mpg', 'ts', 'ogv'],
    potentialOutputs: ['mp4', 'webm', 'mov', 'mkv', 'avi', 'gif', 'mp3', 'wav', 'm4a'],
    fallbackTarget: 'mp4',
  },
  audio: {
    displayName: 'Audio',
    singularTitle: 'Audio',
    glyphKey: 'audio',
    acceptedInputs: ['mp3', 'wav', 'm4a', 'ogg', 'oga', 'aac', 'flac', 'opus', 'wma', 'amr', 'aiff', 'aif', 'weba'],
    potentialOutputs: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'],
    fallbackTarget: 'mp3',
  },
};

export const SUPPORTED_FAMILIES = Object.keys(MEDIA_MATRIX);

const EXTENSION_NORMALIZATIONS = {
  jpeg: 'jpg',
  htm: 'html',
  tiff: 'tif',
  heif: 'heic',
  aif: 'aiff',
  oga: 'ogg',
  mpg: 'mpeg'
};

export const canonicalExtension = (extName) => {
  const clean = (extName || '').toLowerCase().trim().replace(/^\./, '');
  return EXTENSION_NORMALIZATIONS[clean] || clean;
};

export const FORMAT_ROUTING_MAP = {
  pdf: ['png', 'jpg', 'tif', 'docx', 'txt'],
  docx: ['pdf', 'html', 'txt', 'md'],
  txt: ['pdf', 'docx', 'html', 'md'],
  md: ['pdf', 'html', 'docx', 'txt'],
  html: ['pdf', 'docx', 'txt', 'md'],
  csv: ['json', 'html'],
  tsv: ['csv', 'json', 'html'],
  json: ['csv', 'html', 'txt'],
};

export function extractFileExtension(fileName) {
  const match = /\.([a-zA-Z0-9]+)$/i.exec(fileName || '');
  return match ? match[1].toLowerCase() : '';
}

export function stripFileExtension(fileName) {
  return (fileName || 'untitled').replace(/\.[^.]+$/, '');
}

export function detectMediaFamily(fileInstance) {
  if (!fileInstance) return null;
  const fileName = typeof fileInstance === 'string' ? fileInstance : (fileInstance.name || '');
  const ext = fileName.includes('.') ? extractFileExtension(fileName) : canonicalExtension(fileName);
  if (ext === 'webm' && fileInstance?.type?.startsWith('audio/')) return 'audio';

  for (const familyKey of SUPPORTED_FAMILIES) {
    if (MEDIA_MATRIX[familyKey].acceptedInputs.includes(ext)) {
      return familyKey;
    }
  }

  const mime = (typeof fileInstance === 'object' && fileInstance?.type) || '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.includes('pdf') || mime.includes('word') || mime.includes('text')) return 'document';

  return null;
}

export function queryAvailableTargets(familyKeyOrExt, inputExtension) {
  let familyKey = familyKeyOrExt;
  let ext = inputExtension;
  if (!ext) {
    ext = familyKeyOrExt;
    familyKey = detectMediaFamily(ext);
  }
  const normExt = canonicalExtension(ext);
  if (familyKey === 'document') {
    return FORMAT_ROUTING_MAP[normExt] || [];
  }
  if (!MEDIA_MATRIX[familyKey]) return [];
  return MEDIA_MATRIX[familyKey].potentialOutputs.filter(
    (targetExt) => canonicalExtension(targetExt) !== normExt
  );
}

export function enumerateUniqueFormats(familyKey) {
  const family = MEDIA_MATRIX[familyKey];
  if (!family) return [];
  const formatList = [];
  for (const candidate of [...family.acceptedInputs, ...family.potentialOutputs]) {
    const normal = canonicalExtension(candidate);
    if (!formatList.includes(normal)) formatList.push(normal);
  }
  return formatList;
}

export const TOTAL_SYSTEM_FORMATS = new Set(
  SUPPORTED_FAMILIES.flatMap(enumerateUniqueFormats)
).size;

export const requiresTranscodeEngine = (familyKeyOrIn, inExtOrOut, optionalOut) => {
  let familyKey = familyKeyOrIn;
  let inExt = inExtOrOut;
  let outExt = optionalOut;
  if (optionalOut === undefined) {
    inExt = familyKeyOrIn;
    outExt = inExtOrOut;
    familyKey = detectMediaFamily(inExt);
  }
  const normIn = canonicalExtension(inExt);
  const normOut = canonicalExtension(outExt);
  if (familyKey === 'video' || familyKey === 'audio') return true;
  if (normOut === 'tif' || normIn === 'tif') return true;
  if (familyKey === 'image' && normOut === 'gif') return true;
  return false;
};

export const supportsTuningProfile = (familyKeyOrIn, inExtOrOut, optionalOut) => {
  let familyKey = familyKeyOrIn;
  let inExt = inExtOrOut;
  let outExt = optionalOut;
  if (optionalOut === undefined) {
    inExt = familyKeyOrIn;
    outExt = inExtOrOut;
    familyKey = detectMediaFamily(inExt);
  }
  const normOut = canonicalExtension(outExt);
  const normIn = canonicalExtension(inExt);
  if (familyKey === 'video') return true;
  if (familyKey === 'audio' && !['wav', 'flac'].includes(normOut)) return true;
  if (['jpg', 'webp', 'gif'].includes(normOut)) return true;
  if (normOut === 'pdf' && familyKey === 'image') return true;
  if (normIn === 'pdf' && ['png', 'jpg', 'tif'].includes(normOut)) return true;
  return false;
};

export const isSegmentedOutput = (inExt, outExt) =>
  canonicalExtension(inExt) === 'pdf' && ['png', 'jpg', 'tif'].includes(canonicalExtension(outExt));

export function sanitizeFileName(nameString) {
  return (nameString || 'converted')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 160) || 'converted';
}

export function sanitizeHtmlEntities(raw) {
  return String(raw ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

export function formatByteMetric(byteCount) {
  if (typeof byteCount !== 'number' || isNaN(byteCount) || byteCount <= 0) return '0 B';
  if (byteCount < 1024) return `${byteCount} B`;
  const scaleUnits = ['KB', 'MB', 'GB'];
  let tier = -1;
  let remaining = byteCount;
  do {
    remaining /= 1024;
    tier++;
  } while (remaining >= 1024 && tier < 2);
  return `${remaining.toFixed(remaining < 10 ? 1 : 0)} ${scaleUnits[tier]}`;
}

export function formatElapsedSeconds(seconds) {
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const remSec = Math.round(seconds % 60);
  return `${mins}m ${remSec}s`;
}

export function formatPlaybackDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = String(Math.round(seconds % 60)).padStart(2, '0');
  return `${m}:${s}`;
}
