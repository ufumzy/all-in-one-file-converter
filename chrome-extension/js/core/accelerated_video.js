/**
 * CodeGreeks File Studio Hardware-Accelerated Video Pipeline
 * Leverages Mediabunny and WebCodecs for near-instant container repackaging and GPU transcoding.
 */

import {
  Input, Output, Conversion, BlobSource, BufferTarget, ALL_FORMATS,
  Mp4OutputFormat, MovOutputFormat, MkvOutputFormat, WebMOutputFormat, WavOutputFormat,
  QUALITY_LOW, QUALITY_MEDIUM, QUALITY_HIGH, QUALITY_VERY_HIGH,
} from '../../lib/mediabunny.mjs';

const COMPATIBLE_INGEST_FORMATS = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'ts'];

const CONTAINER_DESTINATIONS = {
  mp4: { instantiate: () => new Mp4OutputFormat({ fastStart: 'in-memory' }), primaryVideo: 'avc', primaryAudio: 'aac', mimeType: 'video/mp4' },
  mov: { instantiate: () => new MovOutputFormat({ fastStart: 'in-memory' }), primaryVideo: 'avc', primaryAudio: 'aac', mimeType: 'video/quicktime' },
  mkv: { instantiate: () => new MkvOutputFormat(), primaryVideo: 'avc', primaryAudio: 'aac', mimeType: 'video/x-matroska' },
  webm: { instantiate: () => new WebMOutputFormat(), primaryVideo: 'vp9', primaryAudio: 'opus', mimeType: 'video/webm' },
  m4a: { instantiate: () => new Mp4OutputFormat({ fastStart: 'in-memory' }), primaryVideo: null, primaryAudio: 'aac', mimeType: 'audio/mp4' },
  wav: { instantiate: () => new WavOutputFormat(), primaryVideo: null, primaryAudio: 'pcm-s16', mimeType: 'audio/wav' },
};

const VIDEO_QUALITY_MAP = { compact: QUALITY_LOW, balanced: QUALITY_HIGH, pristine: QUALITY_VERY_HIGH };
const AUDIO_QUALITY_MAP = { compact: QUALITY_MEDIUM, balanced: QUALITY_HIGH, pristine: QUALITY_VERY_HIGH };

const PASSTHROUGH_COMPATIBLE_CODECS = {
  mp4: ['avc', 'hevc', 'av1', 'vp9', 'aac', 'mp3', 'opus', 'flac', 'ac3', 'eac3'],
  mov: ['avc', 'hevc', 'av1', 'vp9', 'aac', 'mp3', 'opus', 'flac', 'ac3', 'eac3'],
  webm: ['vp8', 'vp9', 'av1', 'opus', 'vorbis'],
  m4a: ['aac', 'mp3', 'opus', 'flac', 'ac3', 'eac3'],
  wav: [],
};

function canPassThroughTrack(targetContainer, track) {
  return (PASSTHROUGH_COMPATIBLE_CODECS[targetContainer] || []).includes(track.codec);
}

export async function acceleratedMuxConvert(sourceBlob, inputExt, targetExt, executionOpts = {}) {
  const containerConfig = CONTAINER_DESTINATIONS[targetExt];
  if (!containerConfig || !COMPATIBLE_INGEST_FORMATS.includes(inputExt) || typeof VideoEncoder === 'undefined') {
    return null;
  }

  executionOpts.onStatusUpdate?.('Inspecting media container…');
  const mediaInput = new Input({ source: new BlobSource(sourceBlob), formats: ALL_FORMATS });
  const qualityLevel = executionOpts.tuningPreset || 'balanced';
  const forceFullTranscode = qualityLevel === 'compact';

  const mediaOutput = new Output({
    format: containerConfig.instantiate(),
    target: new BufferTarget(),
  });

  const conversionPipeline = await Conversion.init({
    input: mediaInput,
    output: mediaOutput,
    tracks: 'primary',
    showWarnings: false,
    copy: { shiftTolerance: Infinity },
    video: containerConfig.primaryVideo
      ? {
          codec: containerConfig.primaryVideo,
          quality: VIDEO_QUALITY_MAP[qualityLevel],
          forceTranscode: forceFullTranscode,
          hardwareAcceleration: 'no-preference',
        }
      : { discard: true },
    audio: {
      codec: containerConfig.primaryAudio,
      quality: AUDIO_QUALITY_MAP[qualityLevel],
      forceTranscode: forceFullTranscode && targetExt !== 'wav',
    },
  });

  // Verify track integrity
  const rejectedTracks = conversionPipeline.discardedTracks.filter(
    (item) =>
      !['discarded_by_user', 'max_track_count_reached', 'max_track_count_of_type_reached'].includes(item.reason) &&
      (item.track.isVideoTrack() || item.track.isAudioTrack())
  );

  const hasUsableVideo = conversionPipeline.utilizedTracks.some((t) => t.isVideoTrack());
  const hasUsableAudio = conversionPipeline.utilizedTracks.some((t) => t.isAudioTrack());

  if (!conversionPipeline.isValid || rejectedTracks.length || (containerConfig.primaryVideo && !hasUsableVideo) || (!containerConfig.primaryVideo && !hasUsableAudio)) {
    mediaInput.dispose?.();
    return null;
  }

  let isReencoding = forceFullTranscode;
  if (!forceFullTranscode) {
    for (const track of conversionPipeline.utilizedTracks) {
      const desiredCodec = track.isVideoTrack() ? containerConfig.primaryVideo : containerConfig.primaryAudio;
      if (track.codec !== desiredCodec && !(targetExt === 'mkv' || canPassThroughTrack(targetExt, track))) {
        isReencoding = true;
      }
    }
  }

  executionOpts.onStatusUpdate?.('Processing media stream…');
  executionOpts.strategyMethod = targetExt === 'wav' ? 'pcm_direct' : isReencoding ? 'hardware_encoder' : 'stream_cloning';

  conversionPipeline.onProgress = (fraction) => executionOpts.onProgressUpdate?.(fraction);
  await conversionPipeline.execute();
  mediaInput.dispose?.();

  const finalBuffer = mediaOutput.target.buffer;
  if (!finalBuffer || !finalBuffer.byteLength) return null;

  return new Blob([finalBuffer], { type: containerConfig.mimeType });
}
