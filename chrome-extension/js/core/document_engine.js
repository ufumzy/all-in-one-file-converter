/**
 * CodeGreeks File Studio Document Processing Engine
 * Handles PDF rendering and text extraction (PDF.js), DOCX parsing (Mammoth),
 * Markdown compilation (Marked), OpenXML DOCX assembly, CSV/TSV, and JSON conversions.
 */

import * as pdfjs from '../../lib/pdf.min.mjs';
import { marked } from '../../lib/marked.js';
import { zipSync, strToU8 } from '../../lib/fflate.js';
import { COMPRESSION_TUNING } from '../config.js';
import { processMediaConversion } from './media_engine.js';

const extApi = globalThis.browser || globalThis.chrome;
pdfjs.GlobalWorkerOptions.workerSrc = extApi?.runtime?.getURL
  ? extApi.runtime.getURL('lib/pdf.worker.min.mjs')
  : new URL('../../lib/pdf.worker.min.mjs', import.meta.url).href;

const PRIMARY_FONT_STACK = '"Sarabun","Noto Sans Thai","Leelawadee UI","Segoe UI",system-ui,sans-serif';
const MONOSPACE_FONT_STACK = '"Cascadia Mono","Consolas","Menlo","Noto Sans Mono",monospace';

const createTextBlob = (str, mimeType = 'text/plain') =>
  new Blob([str], { type: `${mimeType};charset=utf-8` });

export const sanitizeHtmlEntities = (raw) =>
  String(raw ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));

export const sanitizeXmlEntities = (raw) =>
  String(raw ?? '')
    .replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function wrapHtmlDocument(bodyContent, docTitle = 'Document') {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${sanitizeHtmlEntities(docTitle)}</title>
<style>
body { font-family: ${PRIMARY_FONT_STACK}; max-width: 820px; margin: 40px auto; padding: 0 24px; line-height: 1.65; color: #1e2022; }
img { max-width: 100%; border-radius: 4px; }
table { border-collapse: collapse; width: 100%; margin: 16px 0; }
td, th { border: 1px solid #d0d7de; padding: 8px 12px; text-align: left; }
th { background: #f6f8fa; font-weight: 600; }
pre { background: #f6f8fa; padding: 14px; border-radius: 6px; overflow: auto; font-family: ${MONOSPACE_FONT_STACK}; font-size: 13px; }
blockquote { border-left: 4px solid #0969da; margin: 16px 0; padding: 0 16px; color: #57606a; }
hr { border: none; border-top: 1px solid #d0d7de; margin: 24px 0; }
</style></head>
<body>
${bodyContent}
</body></html>`;
}

/* ================= PDF INGESTION ================= */

async function openPdfDocument(fileBlob) {
  const fileBytes = new Uint8Array(await fileBlob.arrayBuffer());
  return pdfjs.getDocument({ data: fileBytes, isEvalSupported: false }).promise;
}

export async function inspectPdfDocument(fileBlob) {
  const pdfInstance = await openPdfDocument(fileBlob);
  const pageTotal = pdfInstance.numPages;
  await pdfInstance.destroy();
  return { pageCount: pageTotal };
}

const resolvePageRange = (totalPages, requestedRange) =>
  requestedRange && requestedRange.length
    ? requestedRange.filter((p) => p >= 1 && p <= totalPages)
    : Array.from({ length: totalPages }, (_, idx) => idx + 1);

async function renderPdfPagesToBitmaps(pdfFile, targetFormat, runContext = {}) {
  const pdfInstance = await openPdfDocument(pdfFile);
  const tuning = COMPRESSION_TUNING[runContext.tuningPreset] || COMPRESSION_TUNING.balanced;
  const targetPages = resolvePageRange(pdfInstance.numPages, runContext.pageRange);

  if (!targetPages.length) {
    await pdfInstance.destroy();
    throw new Error('No valid pages found in the requested range.');
  }

  const generatedBitmaps = [];
  for (let k = 0; k < targetPages.length; k++) {
    const pageNum = targetPages[k];
    runContext.onStatusUpdate?.(`Rendering page ${pageNum} of ${pdfInstance.numPages}…`);
    const pageHandle = await pdfInstance.getPage(pageNum);
    const viewport = pageHandle.getViewport({ scale: tuning.scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await pageHandle.render({ canvasContext: ctx, viewport }).promise;

    let pageBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Canvas rasterization failed.'))),
        targetFormat === 'jpg' ? 'image/jpeg' : 'image/png',
        tuning.img
      );
    });

    if (targetFormat === 'tif') {
      pageBlob = await processMediaConversion(pageBlob, 'png', 'tif', {
        ...runContext,
        onProgressUpdate: null,
        onStatusUpdate: null,
      });
    }

    generatedBitmaps.push({ blob: pageBlob, pageIndex: pageNum });
    runContext.onProgressUpdate?.((k + 1) / targetPages.length);
    pageHandle.cleanup();
  }

  await pdfInstance.destroy();
  return generatedBitmaps;
}

async function extractPdfTextContent(pdfFile, runContext = {}) {
  const pdfInstance = await openPdfDocument(pdfFile);
  const targetPages = resolvePageRange(pdfInstance.numPages, runContext.pageRange);
  const pageTextBuffers = [];

  for (let k = 0; k < targetPages.length; k++) {
    const pageNum = targetPages[k];
    const pageHandle = await pdfInstance.getPage(pageNum);
    const textSnapshot = await pageHandle.getTextContent();
    let aggregatedText = '';

    for (const item of textSnapshot.items) {
      if (typeof item.str === 'string') {
        aggregatedText += item.str;
        if (item.hasEOL) aggregatedText += '\n';
      }
    }

    pageTextBuffers.push(aggregatedText.trim());
    runContext.onProgressUpdate?.((k + 1) / targetPages.length);
    pageHandle.cleanup();
  }

  await pdfInstance.destroy();
  return pageTextBuffers;
}

/* ================= OPENXML DOCX ARCHITECTURE ================= */

const DOCX_TYPE_DEFINITIONS = {
  h1: { sz: 36, b: true }, h2: { sz: 30, b: true }, h3: { sz: 26, b: true },
  h4: { sz: 24, b: true }, h5: { sz: 22, b: true }, h6: { sz: 22, b: true },
  p: { sz: 22 }, li: { sz: 22, ind: 360 }, quote: { sz: 22, ind: 540, i: true },
  tr: { sz: 20 }, pre: { sz: 19, mono: true },
};

export function buildDocxPackage(contentBlocks) {
  const paragraphXml = contentBlocks
    .map((block) => {
      if (block.kind === 'pagebreak') return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      if (block.kind === 'hr' || block.kind === 'img') return '<w:p/>';

      const styleSpec = DOCX_TYPE_DEFINITIONS[block.kind] || DOCX_TYPE_DEFINITIONS.p;
      const fontXml = styleSpec.mono
        ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Tahoma"/>'
        : '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Tahoma"/>';
      const runProperties = `<w:rPr>${fontXml}${styleSpec.b || (block.kind === 'tr' && block.isHeader) ? '<w:b/><w:bCs/>' : ''}${styleSpec.i ? '<w:i/>' : ''}<w:sz w:val="${styleSpec.sz}"/><w:szCs w:val="${styleSpec.sz + 6}"/></w:rPr>`;

      const textRuns = String(block.text ?? '')
        .split('\n')
        .map(
          (line, idx) =>
            `<w:r>${runProperties}${idx ? '<w:br/>' : ''}<w:t xml:space="preserve">${sanitizeXmlEntities(line)}</w:t></w:r>`
        )
        .join('');

      const paragraphProperties = `<w:pPr><w:spacing w:before="${/^h/.test(block.kind) ? 240 : 0}" w:after="${block.kind === 'li' || block.kind === 'tr' ? 60 : 160}"/>${styleSpec.ind ? `<w:ind w:left="${styleSpec.ind}"/>` : ''}</w:pPr>`;
      return `<w:p>${paragraphProperties}${textRuns}</w:p>`;
    })
    .join('');

  const bodyContent = paragraphXml || '<w:p/>';
  const mainDocumentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyContent}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const packageFiles = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8(mainDocumentXml),
  };

  return new Blob([zipSync(packageFiles)], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

/* ================= HTML PARSING & TEXT CONVERSION ================= */

const STRUCTURAL_BLOCK_TAGS = new Set([
  'P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'PRE', 'BLOCKQUOTE', 'TR', 'TABLE', 'UL', 'OL', 'HR',
  'FIGURE', 'FIGCAPTION', 'DL', 'DT', 'DD', 'ADDRESS'
]);

function sanitizeAndParseHtmlDom(htmlMarkup) {
  const domDoc = new DOMParser().parseFromString(htmlMarkup, 'text/html');
  domDoc.querySelectorAll('script,style,noscript,template,iframe,object').forEach((el) => el.remove());
  return domDoc;
}

export function transformHtmlToFormattedText(htmlSource) {
  const dom = sanitizeAndParseHtmlDom(htmlSource);
  let accumulatedText = '';

  const traverse = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      accumulatedText += node.nodeValue.replace(/\s+/g, ' ');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName;
    if (tag === 'BR') {
      accumulatedText += '\n';
      return;
    }
    if (tag === 'PRE') {
      accumulatedText += `\n${node.textContent}\n`;
      return;
    }

    const isBlock = STRUCTURAL_BLOCK_TAGS.has(tag);
    if (isBlock) accumulatedText += '\n';
    if (tag === 'LI') accumulatedText += '• ';

    for (const child of node.childNodes) traverse(child);

    if (tag === 'TD' || tag === 'TH') accumulatedText += '\t';
    if (isBlock) accumulatedText += '\n';
  };

  traverse(dom.body);
  return accumulatedText
    .split('\n')
    .map((l) => l.replace(/^ +| +$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';
}

function extractStructureBlocks(htmlSource) {
  const dom = sanitizeAndParseHtmlDom(htmlSource);
  const blocks = [];
  let currentBlock = null;

  const commitBlock = () => {
    if (currentBlock && currentBlock.text.trim()) blocks.push(currentBlock);
    currentBlock = null;
  };

  const initBlock = (kind) => {
    commitBlock();
    currentBlock = { kind, text: '' };
  };

  const walk = (node, ctx = {}) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!currentBlock) currentBlock = { kind: ctx.kind || 'p', text: '' };
      currentBlock.text += ctx.isPreformatted ? node.nodeValue : node.nodeValue.replace(/\s+/g, ' ');
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const tag = node.tagName;
    if (tag === 'BR') {
      if (currentBlock) currentBlock.text += '\n';
      return;
    }
    if (tag === 'IMG') {
      commitBlock();
      if (node.getAttribute('src')) blocks.push({ kind: 'img', src: node.getAttribute('src') });
      return;
    }
    if (tag === 'HR') {
      commitBlock();
      blocks.push({ kind: 'hr' });
      return;
    }
    if (/^H[1-6]$/.test(tag)) {
      initBlock(tag.toLowerCase());
      for (const child of node.childNodes) walk(child, { kind: tag.toLowerCase() });
      commitBlock();
      return;
    }
    if (tag === 'PRE') {
      initBlock('pre');
      currentBlock.text = node.textContent.replace(/\n$/, '');
      commitBlock();
      return;
    }
    if (tag === 'LI') {
      const isOrdered = node.parentElement?.tagName === 'OL';
      const orderIdx = isOrdered ? [...node.parentElement.children].indexOf(node) + 1 : 0;
      initBlock('li');
      currentBlock.text = isOrdered ? `${orderIdx}. ` : '•  ';
      for (const child of node.childNodes) walk(child, { kind: 'li' });
      commitBlock();
      return;
    }
    if (tag === 'TR') {
      initBlock('tr');
      currentBlock.text = [...node.children].map((td) => td.textContent.replace(/\s+/g, ' ').trim()).join('   |   ');
      currentBlock.isHeader = Boolean(node.querySelector('th'));
      commitBlock();
      return;
    }
    if (tag === 'BLOCKQUOTE') {
      commitBlock();
      for (const child of node.childNodes) walk(child, { kind: 'quote' });
      commitBlock();
      return;
    }

    const isBlock = STRUCTURAL_BLOCK_TAGS.has(tag);
    if (isBlock) commitBlock();
    for (const child of node.childNodes) walk(child, ctx);
    if (isBlock) commitBlock();
  };

  walk(dom.body);
  commitBlock();
  return blocks;
}

/* ================= PAGINATED PDF GENERATION (150 DPI) ================= */

const PDF_NODE_STYLES = {
  h1: { size: 34, weight: 700, before: 26, after: 12 },
  h2: { size: 28, weight: 700, before: 22, after: 10 },
  h3: { size: 24, weight: 700, before: 18, after: 8 },
  h4: { size: 21, weight: 700, before: 14, after: 6 },
  h5: { size: 20, weight: 700, before: 12, after: 6 },
  h6: { size: 19, weight: 700, before: 12, after: 6 },
  p: { size: 19, weight: 400, before: 0, after: 12 },
  li: { size: 19, weight: 400, before: 0, after: 6, indent: 24 },
  quote: { size: 19, weight: 400, before: 0, after: 12, indent: 30, color: '#555' },
  tr: { size: 17, weight: 400, before: 0, after: 4 },
  pre: { size: 16, weight: 400, before: 4, after: 14, mono: true, bg: '#f3f3f3' },
};

const wordSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;

function wrapCanvasText(ctx, rawText, maxLineWidth) {
  const lineArray = [];
  for (const paragraph of (rawText || '').split('\n')) {
    const tokens = wordSegmenter
      ? [...wordSegmenter.segment(paragraph)].map((s) => s.segment)
      : paragraph.split(/(\s+)/);

    let activeLine = '';
    for (const token of tokens) {
      if (ctx.measureText(activeLine + token).width <= maxLineWidth || !activeLine) {
        if (ctx.measureText(token).width > maxLineWidth && !activeLine) {
          let charFragment = '';
          for (const char of token) {
            if (ctx.measureText(charFragment + char).width > maxLineWidth && charFragment) {
              lineArray.push(charFragment);
              charFragment = '';
            }
            charFragment += char;
          }
          activeLine = charFragment;
        } else {
          activeLine += token;
        }
      } else {
        lineArray.push(activeLine.trimEnd());
        activeLine = token.trimStart();
      }
    }
    lineArray.push(activeLine.trimEnd());
  }
  return lineArray;
}

async function loadInlineImage(imageSrc) {
  const img = new Image();
  img.src = imageSrc;
  try {
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

async function renderContentNodesToPdf(blocks, runContext = {}) {
  // A4 dimensions at 150 DPI: 1240 x 1754 px
  const pageWidth = 1240;
  const pageHeight = 1754;
  const pageMargin = 110;
  const contentWidth = pageWidth - 2 * pageMargin;

  const canvasPages = [];
  let currentCanvas, ctx, cursorY;

  const appendPage = () => {
    currentCanvas = document.createElement('canvas');
    currentCanvas.width = pageWidth;
    currentCanvas.height = pageHeight;
    ctx = currentCanvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pageWidth, pageHeight);
    ctx.textBaseline = 'top';
    canvasPages.push(currentCanvas);
    cursorY = pageMargin;
  };

  appendPage();
  const scaleRatio = 1.55;

  for (let idx = 0; idx < blocks.length; idx++) {
    const block = blocks[idx];

    if (block.kind === 'hr') {
      cursorY += 10;
      if (cursorY > pageHeight - pageMargin) appendPage();
      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(pageMargin, cursorY);
      ctx.lineTo(pageWidth - pageMargin, cursorY);
      ctx.stroke();
      cursorY += 20;
      continue;
    }

    if (block.kind === 'img') {
      const imgElement = await loadInlineImage(block.src);
      if (!imgElement) continue;

      let drawW = Math.min(contentWidth, imgElement.naturalWidth * scaleRatio);
      let drawH = (imgElement.naturalHeight / imgElement.naturalWidth) * drawW;
      if (drawH > pageHeight - 2 * pageMargin) {
        drawH = pageHeight - 2 * pageMargin;
        drawW = (imgElement.naturalWidth / imgElement.naturalHeight) * drawH;
      }

      if (cursorY + drawH > pageHeight - pageMargin) appendPage();
      ctx.drawImage(imgElement, pageMargin, cursorY, drawW, drawH);
      cursorY += drawH + 14;
      continue;
    }

    const style = PDF_NODE_STYLES[block.kind] || PDF_NODE_STYLES.p;
    const computedFontSize = Math.round(style.size * scaleRatio * 0.85);
    ctx.font = `${style.weight} ${computedFontSize}px ${style.mono ? MONOSPACE_FONT_STACK : PRIMARY_FONT_STACK}`;

    const indentPx = (style.indent || 0) * scaleRatio;
    const lineSpacing = Math.round(computedFontSize * (style.mono ? 1.35 : 1.6));
    const lines = wrapCanvasText(
      ctx,
      (block.text || '').replace(/\t/g, '    '),
      contentWidth - indentPx - (style.bg ? 24 : 0)
    );

    if (cursorY > pageMargin) cursorY += style.before * scaleRatio * 0.7;
    if (/^h/.test(block.kind) && cursorY + lineSpacing * (lines.length + 2) > pageHeight - pageMargin) {
      appendPage();
    }

    for (const line of lines) {
      if (cursorY + lineSpacing > pageHeight - pageMargin) {
        appendPage();
        ctx.font = `${style.weight} ${computedFontSize}px ${style.mono ? MONOSPACE_FONT_STACK : PRIMARY_FONT_STACK}`;
      }
      if (style.bg) {
        ctx.fillStyle = style.bg;
        ctx.fillRect(pageMargin, cursorY - 4, contentWidth, lineSpacing);
      }
      if (block.kind === 'quote') {
        ctx.fillStyle = '#dddddd';
        ctx.fillRect(pageMargin, cursorY, 6, lineSpacing);
      }

      ctx.fillStyle = style.color || '#1a1a1a';
      if (block.kind === 'tr' && block.isHeader) {
        ctx.font = `700 ${computedFontSize}px ${PRIMARY_FONT_STACK}`;
      }

      ctx.fillText(line, pageMargin + indentPx + (style.bg ? 12 : 0), cursorY + (lineSpacing - computedFontSize) / 2);
      cursorY += lineSpacing;
    }

    if (block.kind === 'tr') {
      ctx.strokeStyle = '#e2e2e2';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pageMargin, cursorY + 2);
      ctx.lineTo(pageWidth - pageMargin, cursorY + 2);
      ctx.stroke();
    }

    cursorY += style.after * scaleRatio * 0.7;
    runContext.onProgressUpdate?.(((idx + 1) / blocks.length) * 0.9);
  }

  runContext.onStatusUpdate?.('Writing PDF document…');

  const { PDFDocument } = await import('../../lib/pdf-lib.js');
  const compiledPdf = await PDFDocument.create();
  const tuning = COMPRESSION_TUNING[runContext.tuningPreset] || COMPRESSION_TUNING.balanced;

  for (const pageCanvas of canvasPages) {
    const jpegBlob = await new Promise((resolve, reject) => {
      pageCanvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Canvas export to JPEG failed.'))),
        'image/jpeg',
        Math.max(0.85, tuning.img)
      );
    });

    const embeddedImage = await compiledPdf.embedJpg(await jpegBlob.arrayBuffer());
    // 595.28 x 841.89 points = standard A4
    const a4Page = compiledPdf.addPage([595.28, 841.89]);
    a4Page.drawImage(embeddedImage, { x: 0, y: 0, width: 595.28, height: 841.89 });
  }

  const outputBytes = await compiledPdf.save();
  return new Blob([outputBytes], { type: 'application/pdf' });
}

/* ================= TABULAR DATA (CSV / TSV / JSON) ================= */

export function tabularCsvParser(rawText, delimiter) {
  if (!delimiter) {
    const firstLine = rawText.split('\n')[0];
    delimiter = [',', ';', '\t', '|'].reduce(
      (best, d) => (firstLine.split(d).length > firstLine.split(best).length ? d : best),
      ','
    );
  }

  const rows = [];
  let currentRow = [];
  let currentField = '';
  let insideQuotes = false;
  const cleanInput = rawText.replace(/^\uFEFF/, '');

  for (let i = 0; i < cleanInput.length; i++) {
    const char = cleanInput[i];
    if (insideQuotes) {
      if (char === '"') {
        if (cleanInput[i + 1] === '"') {
          currentField += '"';
          i++;
        } else {
          insideQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else if (char === '"') {
      insideQuotes = true;
    } else if (char === delimiter) {
      currentRow.push(currentField);
      currentField = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && cleanInput[i + 1] === '\n') i++;
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
    } else {
      currentField += char;
    }
  }

  if (currentField !== '' || currentRow.length) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

const formatCsvCell = (value) => {
  const str = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

export function serializeTabularCsv(rows) {
  return '\uFEFF' + rows.map((r) => r.map(formatCsvCell).join(',')).join('\r\n') + '\r\n';
}

export function tabularToJsonCollection(rows) {
  const [headerRow, ...bodyRows] = rows;
  const fieldKeys = headerRow.map((h, idx) => h.trim() || `column_${idx + 1}`);

  return bodyRows.map((row) =>
    Object.fromEntries(
      fieldKeys.map((key, idx) => {
        const rawVal = row[idx] ?? '';
        const numericVal =
          rawVal !== '' && !isNaN(rawVal) && /^-?\d/.test(rawVal) && !/^0\d/.test(rawVal) ? Number(rawVal) : rawVal;
        return [key, numericVal];
      })
    )
  );
}

export function tabularToHtmlMarkup(rows, title) {
  const [header, ...body] = rows;
  const tableHtml =
    `<table><thead><tr>${header.map((h) => `<th>${sanitizeHtmlEntities(h)}</th>`).join('')}</tr></thead><tbody>` +
    body
      .map((r) => `<tr>${r.map((c) => `<td>${sanitizeHtmlEntities(c)}</td>`).join('')}</tr>`)
      .join('') +
    '</tbody></table>';
  return wrapHtmlDocument(tableHtml, title);
}

export function jsonEntityToTabular(parsedJson) {
  let records = parsedJson;
  if (!Array.isArray(records)) {
    records = Array.isArray(records?.data) ? records.data : [records];
  }
  if (records.every((item) => Array.isArray(item))) return records;

  const distinctKeys = [];
  for (const item of records) {
    if (item && typeof item === 'object') {
      for (const k of Object.keys(item)) {
        if (!distinctKeys.includes(k)) distinctKeys.push(k);
      }
    }
  }

  if (!distinctKeys.length) return [['value'], ...records.map((v) => [v])];
  return [distinctKeys, ...records.map((obj) => distinctKeys.map((k) => (obj && typeof obj === 'object' ? obj[k] : '')))];
}

/* ================= DISPATCHER ================= */

export async function processDocumentConversion(sourceFile, inputExt, targetExt, runContext = {}, docName = 'document') {
  runContext.onStatusUpdate?.('Parsing document…');

  if (inputExt === 'pdf') {
    if (targetExt === 'txt') {
      const extractedPages = await extractPdfTextContent(sourceFile, runContext);
      return { outputBlob: createTextBlob(extractedPages.join('\n\n\f\n\n')) };
    }
    if (targetExt === 'docx') {
      const extractedPages = await extractPdfTextContent(sourceFile, runContext);
      const docBlocks = [];
      extractedPages.forEach((pageText, pageIndex) => {
        if (pageIndex) docBlocks.push({ kind: 'pagebreak' });
        for (const paragraph of pageText.split(/\n{2,}/)) {
          if (paragraph.trim()) docBlocks.push({ kind: 'p', text: paragraph });
        }
      });
      return { outputBlob: buildDocxPackage(docBlocks) };
    }
    const pageBitmaps = await renderPdfPagesToBitmaps(sourceFile, targetExt, runContext);
    return {
      outputBlobs: pageBitmaps.map((item) => ({
        blob: item.blob,
        pageIndex: item.pageIndex,
      })),
    };
  }

  let intermediateHtml = null;
  let intermediatePlainText = null;

  if (inputExt === 'docx') {
    if (!globalThis.mammoth) throw new Error('Mammoth DOCX parser library is not available.');
    const arrayBuffer = await sourceFile.arrayBuffer();
    if (targetExt === 'txt') {
      const rawResult = await globalThis.mammoth.extractRawText({ arrayBuffer });
      return { outputBlob: createTextBlob(rawResult.value) };
    }
    if (targetExt === 'md') {
      const mdResult = await globalThis.mammoth.convertToMarkdown({ arrayBuffer });
      return { outputBlob: createTextBlob(mdResult.value, 'text/markdown') };
    }
    const htmlResult = await globalThis.mammoth.convertToHtml({ arrayBuffer });
    intermediateHtml = htmlResult.value;
  } else if (inputExt === 'md') {
    intermediatePlainText = await sourceFile.text();
    intermediateHtml = marked.parse(intermediatePlainText, { gfm: true, breaks: false });
  } else if (inputExt === 'html' || inputExt === 'htm') {
    intermediateHtml = await sourceFile.text();
  } else if (inputExt === 'txt') {
    intermediatePlainText = await sourceFile.text();
  } else if (inputExt === 'csv' || inputExt === 'tsv') {
    const parsedRows = tabularCsvParser(await sourceFile.text(), inputExt === 'tsv' ? '\t' : undefined);
    if (!parsedRows.length) throw new Error('The input tabular file contains no data.');
    if (targetExt === 'json') {
      return { outputBlob: createTextBlob(JSON.stringify(tabularToJsonCollection(parsedRows), null, 2), 'application/json') };
    }
    if (targetExt === 'html') {
      return { outputBlob: createTextBlob(tabularToHtmlMarkup(parsedRows, docName), 'text/html') };
    }
    if (targetExt === 'csv') {
      return { outputBlob: createTextBlob(serializeTabularCsv(parsedRows), 'text/csv') };
    }
  } else if (inputExt === 'json') {
    let parsedEntity;
    try {
      parsedEntity = JSON.parse(await sourceFile.text());
    } catch {
      throw new Error('This file contains malformed or unparseable JSON.');
    }
    if (targetExt === 'csv') {
      return { outputBlob: createTextBlob(serializeTabularCsv(jsonEntityToTabular(parsedEntity)), 'text/csv') };
    }
    if (targetExt === 'html') {
      return { outputBlob: createTextBlob(tabularToHtmlMarkup(jsonEntityToTabular(parsedEntity), docName), 'text/html') };
    }
    if (targetExt === 'txt') {
      return { outputBlob: createTextBlob(JSON.stringify(parsedEntity, null, 2)) };
    }
  }

  switch (targetExt) {
    case 'html':
      if (inputExt === 'txt') {
        const paragraphMarkup = intermediatePlainText
          .split(/\n{2,}/)
          .map((p) => `<p>${sanitizeHtmlEntities(p).replace(/\n/g, '<br>')}</p>`)
          .join('\n');
        return { outputBlob: createTextBlob(wrapHtmlDocument(paragraphMarkup, docName), 'text/html') };
      }
      return { outputBlob: createTextBlob(wrapHtmlDocument(intermediateHtml, docName), 'text/html') };
    case 'txt':
      return { outputBlob: createTextBlob(intermediateHtml != null ? transformHtmlToFormattedText(intermediateHtml) : intermediatePlainText) };
    case 'md':
      return { outputBlob: createTextBlob(intermediatePlainText ?? transformHtmlToFormattedText(intermediateHtml), 'text/markdown') };
    case 'docx': {
      const blocks = intermediateHtml != null
        ? extractStructureBlocks(intermediateHtml)
        : intermediatePlainText.split(/\n{2,}/).map((p) => ({ kind: 'p', text: p }));
      return { outputBlob: buildDocxPackage(blocks) };
    }
    case 'pdf': {
      const blocks = intermediateHtml != null
        ? extractStructureBlocks(intermediateHtml)
        : intermediatePlainText.split(/\n{2,}/).map((p) => ({ kind: 'p', text: p }));
      if (!blocks.length) throw new Error('No printable content found in document.');
      return { outputBlob: await renderContentNodesToPdf(blocks, runContext) };
    }
    default:
      throw new Error(`Cannot transform .${inputExt} into .${targetExt}`);
  }
}
