/**
 * CodeGreeks File Studio Media Processing Engine
 * Comprehensive audio/video/animation transcode pipeline utilizing WebAssembly FFmpeg.
 */

import { FFmpeg } from '../../lib/ffmpeg/index.js';

let activeTranscoder = null;
let initializationPromise = null;
let activeProgressCallback = null;
let diagnosticLogs = [];

const extApi = globalThis.browser || globalThis.chrome;
const resolveResourceUrl = (relativePath) =>
  extApi?.runtime?.getURL
    ? extApi.runtime.getURL(relativePath)
    : new URL('../../' + relativePath, import.meta.url).href;

async function acquireTranscoder(statusNotifier) {
  if (activeTranscoder) return activeTranscoder;

  if (!initializationPromise) {
    initializationPromise = (async () => {
      statusNotifier?.('Initializing transcode core…');
      const instance = new FFmpeg();

      instance.on('progress', ({ progress }) => {
        if (activeProgressCallback && progress >= 0 && progress <= 1) {
          activeProgressCallback(progress);
        }
      });

      instance.on('log', ({ message }) => {
        diagnosticLogs.push(message);
        if (diagnosticLogs.length > 300) diagnosticLogs.shift();
      });

      await instance.load({
        coreURL: resolveResourceUrl('lib/core/ffmpeg-core.js'),
        wasmURL: resolveResourceUrl('lib/core/ffmpeg-core.wasm'),
      });

      activeTranscoder = instance;
      return instance;
    })().catch((err) => {
      initializationPromise = null;
      throw err;
    });
  }

  return initializationPromise;
}

const TRANSCODE_PROFILES = {
  compact: { crf: '30', vp8Bitrate: '800k', lameQuality: '6', aacBitrate: '128k', vorbisQuality: '3', opusBitrate: '96k', gifProfile: [10, 360] },
  balanced: { crf: '23', vp8Bitrate: '1500k', lameQuality: '2', aacBitrate: '192k', vorbisQuality: '5', opusBitrate: '128k', gifProfile: [12, 480] },
  pristine: { crf: '18', vp8Bitrate: '3000k', lameQuality: '0', aacBitrate: '256k', vorbisQuality: '7', opusBitrate: '192k', gifProfile: [15, 720] },
};

function resolveFfmpegParameters(targetContainer, tuningLevel = 'balanced', mediaFamily) {
  const profile = TRANSCODE_PROFILES[tuningLevel] || TRANSCODE_PROFILES.balanced;
  const x264Encoder = [
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', profile.crf,
    '-pix_fmt', 'yuv420p',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
  ];
  const aacEncoder = ['-c:a', 'aac', '-b:a', profile.aacBitrate];

  switch (targetContainer) {
    case 'mp4':
      return [...x264Encoder, ...aacEncoder, '-movflags', '+faststart'];
    case 'mov':
    case 'mkv':
      return [...x264Encoder, ...aacEncoder];
    case 'webm':
      return [
        '-c:v', 'libvpx',
        '-b:v', profile.vp8Bitrate,
        '-deadline', 'realtime',
        '-cpu-used', '8',
        '-c:a', 'libvorbis',
        '-q:a', profile.vorbisQuality,
      ];
    case 'avi':
      return [
        '-c:v', 'mpeg4',
        '-q:v', tuningLevel === 'pristine' ? '2' : tuningLevel === 'compact' ? '8' : '4',
        '-c:a', 'libmp3lame',
        '-q:a', '3',
      ];
    case 'gif':
      if (mediaFamily !== 'video') {
        return ['-vf', 'split[a][b];[a]palettegen[p];[b][p]paletteuse'];
      }
      return [
        '-vf', `fps=${profile.gifProfile[0]},scale='min(${profile.gifProfile[1]},iw)':-2:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse`,
        '-loop', '0',
      ];
    case 'mp3':
      return ['-vn', '-c:a', 'libmp3lame', '-q:a', profile.lameQuality];
    case 'wav':
      return ['-vn', '-c:a', 'pcm_s16le'];
    case 'ogg':
      return ['-vn', '-c:a', 'libvorbis', '-q:a', profile.vorbisQuality];
    case 'm4a':
      return ['-vn', ...aacEncoder];
    case 'aac':
      return ['-vn', ...aacEncoder, '-f', 'adts'];
    case 'flac':
      return ['-vn', '-c:a', 'flac'];
    case 'opus':
      return ['-vn', '-c:a', 'libopus', '-b:a', profile.opusBitrate];
    case 'png':
      return ['-frames:v', '1'];
    case 'tif':
      return ['-frames:v', '1', '-compression_algo', 'deflate'];
    default:
      return null;
  }
}

const CONTAINER_MIME_REGISTRY = {
  mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm',
  avi: 'video/x-msvideo', gif: 'image/gif', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/ogg', png: 'image/png', tif: 'image/tiff',
};

let activeSessionSequence = 0;

async function probeContainerStreams(transcoderInstance, virtualInputPath) {
  diagnosticLogs = [];
  await transcoderInstance.exec(['-hide_banner', '-i', virtualInputPath]).catch(() => {});
  const streamInfo = { videoCodec: null, audioCodec: null };

  for (const logLine of diagnosticLogs) {
    const match = /Stream #\d+:\d+.*?: (Video|Audio): ([a-z0-9_]+)/i.exec(logLine);
    if (!match) continue;
    const isVideo = match[1] === 'Video';
    if (isVideo && /attached pic/i.test(logLine)) continue;

    if (isVideo && !streamInfo.videoCodec) streamInfo.videoCodec = match[2].toLowerCase();
    if (!isVideo && !streamInfo.audioCodec) streamInfo.audioCodec = match[2].toLowerCase();
  }

  diagnosticLogs = [];
  return streamInfo;
}

const MP4_PERMITTED_VIDEO = ['h264', 'hevc', 'av1'];
const MP4_PERMITTED_AUDIO = ['aac', 'mp3', 'alac', 'ac3', 'eac3'];

function resolveStreamCopyParameters(targetContainer, { videoCodec, audioCodec }) {
  const channelMapping = ['-map', '0:v:0?', '-map', '0:a:0?', '-dn', '-sn'];

  if (targetContainer === 'mp4' || targetContainer === 'mov') {
    if (!videoCodec || !(MP4_PERMITTED_VIDEO.includes(videoCodec) || (targetContainer === 'mov' && ['prores', 'mjpeg'].includes(videoCodec)))) {
      return null;
    }
    const videoArguments = ['-c:v', 'copy', ...(videoCodec === 'hevc' ? ['-tag:v', 'hvc1'] : [])];
    const audioArguments = !audioCodec || MP4_PERMITTED_AUDIO.includes(audioCodec)
      ? ['-c:a', 'copy']
      : ['-c:a', 'aac', '-b:a', '192k'];
    return [...channelMapping, ...videoArguments, ...audioArguments, ...(targetContainer === 'mp4' ? ['-movflags', '+faststart'] : [])];
  }

  if (targetContainer === 'mkv') {
    return videoCodec ? [...channelMapping, '-c', 'copy'] : null;
  }

  if (targetContainer === 'webm') {
    if (!['vp8', 'vp9', 'av1'].includes(videoCodec)) return null;
    return [
      ...channelMapping,
      '-c:v', 'copy',
      ...(!audioCodec || ['opus', 'vorbis'].includes(audioCodec) ? ['-c:a', 'copy'] : ['-c:a', 'libopus', '-b:a', '128k'])
    ];
  }

  if (targetContainer === 'm4a' && ['aac', 'alac'].includes(audioCodec)) {
    return ['-vn', '-map', '0:a:0', '-c:a', 'copy'];
  }

  if (targetContainer === 'mp3' && audioCodec === 'mp3') {
    return ['-vn', '-map', '0:a:0', '-c:a', 'copy'];
  }

  return null;
}

export function resetTranscoderSession() {
  try { activeTranscoder?.terminate(); } catch { /* Already disposed */ }
  activeTranscoder = null;
  initializationPromise = null;
  activeProgressCallback = null;
}

const isEngineCrashException = (err) => !(err instanceof Error && err.isFriendlyError);
const createFriendlyError = (msg) => Object.assign(new Error(msg), { isFriendlyError: true });

export async function processMediaConversion(sourceFile, inputExt, targetExt, executionOpts = {}) {
  // Try hardware-accelerated pipeline first if applicable
  if (executionOpts.familyKey === 'video') {
    try {
      const { acceleratedMuxConvert } = await import('./accelerated_video.js');
      const acceleratedBlob = await acceleratedMuxConvert(sourceFile, inputExt, targetExt, executionOpts);
      if (acceleratedBlob) return acceleratedBlob;
    } catch (muxError) {
      console.warn('Hardware transcode bypassed, falling back to WebAssembly engine:', muxError);
    }
    executionOpts.onProgressUpdate?.(null);
  }

  try {
    return await executeTranscodeAttempt(sourceFile, inputExt, targetExt, executionOpts, true);
  } catch (firstPassErr) {
    if (!isEngineCrashException(firstPassErr)) throw firstPassErr;
    console.warn('Transcoder session aborted, re-spawning engine:', firstPassErr);
    resetTranscoderSession();
  }

  // Second pass on a clean instance without stream copying
  try {
    executionOpts.onProgressUpdate?.(null);
    return await executeTranscodeAttempt(sourceFile, inputExt, targetExt, executionOpts, false);
  } catch (secondPassErr) {
    if (!isEngineCrashException(secondPassErr)) throw secondPassErr;
    console.warn('Transcoder engine exhausted:', secondPassErr);
    resetTranscoderSession();
    throw createFriendlyError('File is too large or complex for browser memory. Try the Compact preset or a shorter media file.');
  }
}

async function executeTranscodeAttempt(sourceFile, inExt, targetExt, executionOpts, permitStreamCloning) {
  const engine = await acquireTranscoder(executionOpts.onStatusUpdate);
  const sequenceId = ++activeSessionSequence;
  const virtualDir = `/session_${sequenceId}`;
  const inputFileName = `source.${inExt || 'bin'}`;
  const outputFileName = `/result_${sequenceId}.${targetExt}`;

  executionOpts.onStatusUpdate?.('Encoding file…');
  activeProgressCallback = executionOpts.onProgressUpdate || null;
  diagnosticLogs = [];

  await engine.createDir(virtualDir);
  let isMountedViaWorkerFs = false;
  let virtualSourcePath;

  try {
    const fileToMount = sourceFile instanceof File && sourceFile.name === inputFileName
      ? sourceFile
      : new File([sourceFile], inputFileName);
    await engine.mount('WORKERFS', { files: [fileToMount] }, virtualDir);
    isMountedViaWorkerFs = true;
    virtualSourcePath = `${virtualDir}/${inputFileName}`;
  } catch {
    virtualSourcePath = `${virtualDir}/${inputFileName}`;
    await engine.writeFile(virtualSourcePath, new Uint8Array(await sourceFile.arrayBuffer()));
  }

  const defaultParameters = resolveFfmpegParameters(targetExt, executionOpts.tuningPreset, executionOpts.familyKey);
  if (!defaultParameters) throw createFriendlyError(`Cannot transcode into .${targetExt}`);

  let executionExitCode = -1;
  if (permitStreamCloning && executionOpts.familyKey === 'video' && executionOpts.tuningPreset !== 'compact') {
    const streamManifest = await probeContainerStreams(engine, virtualSourcePath);
    const passthroughParameters = resolveStreamCopyParameters(targetExt, streamManifest);
    if (passthroughParameters) {
      executionOpts.onStatusUpdate?.('Packaging streams…');
      executionExitCode = await engine.exec(['-hide_banner', '-y', '-i', virtualSourcePath, ...passthroughParameters, outputFileName]);
      if (executionExitCode === 0) {
        executionOpts.strategyMethod = 'stream_cloning';
      } else {
        await engine.deleteFile(outputFileName).catch(() => {});
        executionOpts.onStatusUpdate?.('Encoding file…');
      }
    }
  }

  if (executionExitCode !== 0) {
    diagnosticLogs = [];
    executionExitCode = await engine.exec(['-hide_banner', '-y', '-i', virtualSourcePath, ...defaultParameters, outputFileName]);
    if (executionExitCode === 0 && !executionOpts.strategyMethod) {
      executionOpts.strategyMethod = 'wasm_engine';
    }
  }

  activeProgressCallback = null;
  if (isMountedViaWorkerFs) await engine.unmount(virtualDir).catch(() => {});
  else await engine.deleteFile(virtualSourcePath).catch(() => {});
  await engine.deleteDir(virtualDir).catch(() => {});

  if (executionExitCode !== 0) {
    const errorSnippet = diagnosticLogs.filter((line) => /error|invalid|not|unsupported/i.test(line)).slice(-2).join(' ');
    await engine.deleteFile(outputFileName).catch(() => {});
    console.warn('Transcode diagnostics:', errorSnippet);
    throw createFriendlyError('Could not process this media file. The source codec may not be supported.');
  }

  const generatedBuffer = await engine.readFile(outputFileName);
  await engine.deleteFile(outputFileName).catch(() => {});

  if (!generatedBuffer || !generatedBuffer.length) {
    throw createFriendlyError('Conversion finished but generated an empty output.');
  }

  return new Blob([generatedBuffer.buffer], {
    type: CONTAINER_MIME_REGISTRY[targetExt] || 'application/octet-stream',
  });
}
