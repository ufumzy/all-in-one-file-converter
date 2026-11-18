/**
 * CodeGreeks File Studio Image Processing Engine
 * High-fidelity client-side bitmap transforms, HEIC decoding, ICO/BMP generation, and PDF page merging.
 */

import { PDFDocument } from '../../lib/pdf-lib.js';
import { processMediaConversion } from './media_engine.js';
import { COMPRESSION_TUNING } from '../config.js';

let heifDecoderSingleton = null;

async function decodeHeicBitmap(sourceBlob) {
  try {
    return await executeHeicDecode(sourceBlob);
  } catch (initialErr) {
    console.warn('Initial HEIC decoder failure, refreshing instance:', initialErr);
    heifDecoderSingleton = null;
    try {
      return await executeHeicDecode(sourceBlob);
    } catch (retryErr) {
      heifDecoderSingleton = null;
      console.warn('Subsequent HEIC decode failed:', retryErr);
      throw new Error('This HEIC/HEIF photo could not be decompressed.');
    }
  }
}

async function executeHeicDecode(rawBlob) {
  if (!heifDecoderSingleton) {
    const libModule = await import('../../lib/libheif.mjs');
    let instance = libModule.default();
    if (instance && typeof instance.then === 'function') instance = await instance;
    if (instance && instance.ready) await instance.ready;
    heifDecoderSingleton = instance;
  }

  const decoder = new heifDecoderSingleton.HeifDecoder();
  const rawBytes = new Uint8Array(await rawBlob.arrayBuffer());
  const decodedFrames = decoder.decode(rawBytes);

  if (!decodedFrames || !decodedFrames.length) {
    throw new Error('No readable frames found in HEIC container.');
  }

  const primaryFrame = decodedFrames[0];
  const width = primaryFrame.get_width();
  const height = primaryFrame.get_height();

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const frameImageData = ctx.createImageData(width, height);

  await new Promise((resolve, reject) => {
    primaryFrame.display(frameImageData, (success) => {
      if (success) resolve();
      else reject(new Error('Failed displaying HEIC pixel buffer.'));
    });
  });

  ctx.putImageData(frameImageData, 0, 0);
  for (const frame of decodedFrames) frame.free?.();
  return canvas;
}

export async function decodeBitmapToCanvas(imageBlob, formatExt) {
  if (formatExt === 'heic' || formatExt === 'heif') {
    return decodeHeicBitmap(imageBlob);
  }

  const blobUrl = URL.createObjectURL(imageBlob);
  let loadedImage;
  try {
    loadedImage = new Image();
    loadedImage.decoding = 'async';
    loadedImage.src = blobUrl;
    await loadedImage.decode();
  } catch {
    URL.revokeObjectURL(blobUrl);
    throw new Error('Image decoding failed. The file may be corrupt or an unsupported variant.');
  }

  let canvasW = loadedImage.naturalWidth;
  let canvasH = loadedImage.naturalHeight;

  if (formatExt === 'svg') {
    if (!canvasW || !canvasH) {
      canvasW = 1024;
      canvasH = 1024;
    }
    const targetScale = Math.max(1, 1024 / Math.max(canvasW, canvasH));
    canvasW = Math.round(canvasW * targetScale);
    canvasH = Math.round(canvasH * targetScale);
  }

  const targetCanvas = document.createElement('canvas');
  targetCanvas.width = canvasW;
  targetCanvas.height = canvasH;
  const ctx = targetCanvas.getContext('2d');
  ctx.drawImage(loadedImage, 0, 0, canvasW, canvasH);

  URL.revokeObjectURL(blobUrl);
  return targetCanvas;
}

const exportCanvasBlob = (canvasInstance, mimeType, qualityValue) =>
  new Promise((resolve, reject) => {
    canvasInstance.toBlob(
      (blobResult) => {
        if (blobResult) resolve(blobResult);
        else reject(new Error('Canvas rasterization failed to produce an output blob.'));
      },
      mimeType,
      qualityValue
    );
  });

function flattenCanvasBackground(canvasInstance, backgroundColor = '#ffffff') {
  const mergedCanvas = document.createElement('canvas');
  mergedCanvas.width = canvasInstance.width;
  mergedCanvas.height = canvasInstance.height;
  const ctx = mergedCanvas.getContext('2d');
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, mergedCanvas.width, mergedCanvas.height);
  ctx.drawImage(canvasInstance, 0, 0);
  return mergedCanvas;
}

function serializeBmpStream(canvasSource) {
  const width = canvasSource.width;
  const height = canvasSource.height;
  const flattened = flattenCanvasBackground(canvasSource);
  const pixelData = flattened.getContext('2d').getImageData(0, 0, width, height).data;

  const rowPaddingBytes = Math.ceil((width * 3) / 4) * 4;
  const totalBufferSize = 54 + rowPaddingBytes * height;
  const arrayBuffer = new ArrayBuffer(totalBufferSize);
  const dataView = new DataView(arrayBuffer);

  // Bitmap signature 'BM'
  dataView.setUint8(0, 0x42);
  dataView.setUint8(1, 0x4d);
  dataView.setUint32(2, totalBufferSize, true);
  dataView.setUint32(10, 54, true); // Offset to image bits

  // DIB Header (BITMAPINFOHEADER)
  dataView.setUint32(14, 40, true);
  dataView.setInt32(18, width, true);
  dataView.setInt32(22, height, true);
  dataView.setUint16(26, 1, true); // Color planes
  dataView.setUint16(28, 24, true); // Bits per pixel
  dataView.setUint32(34, rowPaddingBytes * height, true);
  dataView.setInt32(38, 2835, true); // Horizontal resolution (approx 72 DPI)
  dataView.setInt32(42, 2835, true); // Vertical resolution

  const byteView = new Uint8Array(arrayBuffer);
  for (let y = 0; y < height; y++) {
    let rowOffset = 54 + (height - 1 - y) * rowPaddingBytes;
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      byteView[rowOffset++] = pixelData[srcIdx + 2]; // Blue
      byteView[rowOffset++] = pixelData[srcIdx + 1]; // Green
      byteView[rowOffset++] = pixelData[srcIdx];     // Red
    }
  }

  return new Blob([arrayBuffer], { type: 'image/bmp' });
}

async function compileIcoArchive(canvasSource) {
  const standardDimensions = [16, 32, 48, 256];
  const pngBlobs = [];

  for (const dim of standardDimensions) {
    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = dim;
    tileCanvas.height = dim;
    const ctx = tileCanvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';

    const fitScale = Math.min(dim / canvasSource.width, dim / canvasSource.height);
    const drawW = canvasSource.width * fitScale;
    const drawH = canvasSource.height * fitScale;
    ctx.drawImage(canvasSource, (dim - drawW) / 2, (dim - drawH) / 2, drawW, drawH);

    const pngBlob = await exportCanvasBlob(tileCanvas, 'image/png');
    pngBlobs.push(new Uint8Array(await pngBlob.arrayBuffer()));
  }

  const headerLength = 6 + 16 * standardDimensions.length;
  const aggregateBytes = headerLength + pngBlobs.reduce((acc, bytes) => acc + bytes.length, 0);
  const icoBuffer = new Uint8Array(aggregateBytes);
  const dataView = new DataView(icoBuffer.buffer);

  // ICO header: 0, type (1 = icon), count
  dataView.setUint16(2, 1, true);
  dataView.setUint16(4, standardDimensions.length, true);

  let currentImageOffset = headerLength;
  standardDimensions.forEach((dim, index) => {
    const dirEntryOffset = 6 + 16 * index;
    icoBuffer[dirEntryOffset] = dim >= 256 ? 0 : dim;     // Width (0 = 256)
    icoBuffer[dirEntryOffset + 1] = dim >= 256 ? 0 : dim; // Height
    dataView.setUint16(dirEntryOffset + 4, 1, true);      // Color planes
    dataView.setUint16(dirEntryOffset + 6, 32, true);     // BPP
    dataView.setUint32(dirEntryOffset + 8, pngBlobs[index].length, true);
    dataView.setUint32(dirEntryOffset + 12, currentImageOffset, true);

    icoBuffer.set(pngBlobs[index], currentImageOffset);
    currentImageOffset += pngBlobs[index].length;
  });

  return new Blob([icoBuffer], { type: 'image/x-icon' });
}

export async function assemblePdfFromCanvases(canvasCollection, qualityRatio) {
  const pdfDoc = await PDFDocument.create();

  for (const canvasItem of canvasCollection) {
    const flattened = flattenCanvasBackground(canvasItem);
    const jpegBlob = await exportCanvasBlob(flattened, 'image/jpeg', qualityRatio);
    const embeddedImg = await pdfDoc.embedJpg(await jpegBlob.arrayBuffer());

    // Scale from 96 DPI screen pixels to 72 DPI PDF points
    const pointW = canvasItem.width * 0.75;
    const pointH = canvasItem.height * 0.75;
    const page = pdfDoc.addPage([pointW, pointH]);
    page.drawImage(embeddedImg, { x: 0, y: 0, width: pointW, height: pointH });
  }

  const serializedPdf = await pdfDoc.save();
  return new Blob([serializedPdf], { type: 'application/pdf' });
}

export async function processImageConversion(sourcePayload, sourceExt, targetExt, executionOpts = {}) {
  const tuning = COMPRESSION_TUNING[executionOpts.tuningPreset] || COMPRESSION_TUNING.balanced;
  const qualityFactor = tuning.img;

  let currentSource = sourcePayload;
  let activeSourceExt = sourceExt;

  if (sourceExt === 'tif' || sourceExt === 'tiff') {
    executionOpts.onStatusUpdate?.('Parsing TIFF image stream…');
    currentSource = await processMediaConversion(sourcePayload, sourceExt, 'png', executionOpts);
    activeSourceExt = 'png';
    if (targetExt === 'png') return currentSource;
  }

  if (sourceExt === 'heic' || sourceExt === 'heif') {
    executionOpts.onStatusUpdate?.('Decompressing HEIC picture…');
    const decodedCanvas = await decodeHeicBitmap(sourcePayload);
    currentSource = await exportCanvasBlob(decodedCanvas, 'image/png');
    activeSourceExt = 'png';
    if (targetExt === 'png') return currentSource;
  }

  if (targetExt === 'gif' || targetExt === 'tif') {
    if (['svg', 'avif', 'ico'].includes(activeSourceExt)) {
      const intermediateCanvas = await decodeBitmapToCanvas(currentSource, activeSourceExt);
      currentSource = await exportCanvasBlob(intermediateCanvas, 'image/png');
      activeSourceExt = 'png';
    }
    return processMediaConversion(currentSource, activeSourceExt, targetExt, executionOpts);
  }

  executionOpts.onStatusUpdate?.('Rendering image…');
  const canvasElement = await decodeBitmapToCanvas(currentSource, activeSourceExt);
  executionOpts.onProgressUpdate?.(0.5);

  switch (targetExt) {
    case 'png':
      return exportCanvasBlob(canvasElement, 'image/png');
    case 'jpg':
      return exportCanvasBlob(flattenCanvasBackground(canvasElement), 'image/jpeg', qualityFactor);
    case 'webp':
      return exportCanvasBlob(canvasElement, 'image/webp', qualityFactor);
    case 'bmp':
      return serializeBmpStream(canvasElement);
    case 'ico':
      return compileIcoArchive(canvasElement);
    case 'pdf':
      return assemblePdfFromCanvases([canvasElement], qualityFactor);
    default:
      throw new Error(`Unsupported destination format: .${targetExt}`);
  }
}
