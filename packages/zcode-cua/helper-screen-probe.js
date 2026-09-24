const MAX_ATTEMPTED_WINDOWS = 3;
const MIN_TARGET_WIDTH = 96;
const MIN_TARGET_HEIGHT = 64;
const MAX_TARGET_EDGE = 32_768;

function positiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validFiniteDimension(value, minimum) {
  return Number.isFinite(value) && value >= minimum && value <= MAX_TARGET_EDGE;
}

function validTargetBounds(bounds) {
  return (
    Array.isArray(bounds) &&
    bounds.length === 4 &&
    bounds.every((value) => typeof value === "number" && Number.isFinite(value)) &&
    validFiniteDimension(bounds[2], MIN_TARGET_WIDTH) &&
    validFiniteDimension(bounds[3], MIN_TARGET_HEIGHT)
  );
}

function pngDimensionsMatchWindow(png, target) {
  const widthRatio = png.width / target.bounds.width;
  const heightRatio = png.height / target.bounds.height;
  if (
    !Number.isFinite(widthRatio) ||
    !Number.isFinite(heightRatio) ||
    widthRatio < 0.75 ||
    widthRatio > 4.5 ||
    heightRatio < 0.75 ||
    heightRatio > 4.5
  ) {
    return false;
  }
  return Math.max(widthRatio, heightRatio) / Math.min(widthRatio, heightRatio) <= 1.35;
}

function isDecodedNonPlaceholderPng(sample, png) {
  if (
    !sample ||
    sample.width !== png.width ||
    sample.height !== png.height ||
    !positiveSafeInteger(sample.sampleWidth) ||
    sample.sampleWidth > 64 ||
    !positiveSafeInteger(sample.sampleHeight) ||
    sample.sampleHeight > 64 ||
    !positiveSafeInteger(sample.sampledPixelCount) ||
    sample.sampledPixelCount > 4096 ||
    sample.sampledPixelCount !== sample.sampleWidth * sample.sampleHeight ||
    !Number.isSafeInteger(sample.visiblePixelCount) ||
    sample.visiblePixelCount < 0 ||
    sample.visiblePixelCount > sample.sampledPixelCount ||
    !Number.isSafeInteger(sample.distinctColorBucketCount) ||
    sample.distinctColorBucketCount < 0 ||
    sample.distinctColorBucketCount > sample.visiblePixelCount ||
    !Number.isSafeInteger(sample.dominantColorPixelCount) ||
    sample.dominantColorPixelCount < 0 ||
    sample.dominantColorPixelCount > sample.visiblePixelCount ||
    !Number.isSafeInteger(sample.maxChannelRange) ||
    sample.maxChannelRange < 0 ||
    sample.maxChannelRange > 255
  ) {
    return false;
  }
  const visibleFloor = Math.max(4, Math.ceil(sample.sampledPixelCount * 0.005));
  const varietyFloor = Math.max(3, Math.ceil(sample.sampledPixelCount * 0.0025));
  return (
    sample.visiblePixelCount >= visibleFloor &&
    sample.distinctColorBucketCount >= 3 &&
    sample.visiblePixelCount - sample.dominantColorPixelCount >= varietyFloor &&
    sample.maxChannelRange >= 24
  );
}

export function isForeignWindowScreenCaptureProbeSuccess(probe) {
  if (
    probe?.ok !== true ||
    probe.status !== "granted" ||
    probe.probed !== true ||
    probe.evidence !== "foreign_window" ||
    probe.content_evidence !== "decoded_visible_non_uniform" ||
    !Number.isSafeInteger(probe.probe_pid) ||
    probe.probe_pid <= 0 ||
    !Number.isSafeInteger(probe.target_window_id) ||
    probe.target_window_id <= 0 ||
    !Number.isSafeInteger(probe.target_owner_pid) ||
    probe.target_owner_pid <= 0 ||
    probe.target_owner_pid === probe.probe_pid ||
    probe.target_on_screen !== true ||
    !validTargetBounds(probe.target_bounds) ||
    !Number.isSafeInteger(probe.png_width) ||
    probe.png_width <= 0 ||
    !Number.isSafeInteger(probe.png_height) ||
    probe.png_height <= 0 ||
    !Number.isSafeInteger(probe.candidate_count) ||
    probe.candidate_count <= 0 ||
    !Number.isSafeInteger(probe.attempted_window_count) ||
    probe.attempted_window_count <= 0 ||
    probe.attempted_window_count > MAX_ATTEMPTED_WINDOWS ||
    probe.attempted_window_count > probe.candidate_count ||
    !Number.isSafeInteger(probe.sample_width) ||
    probe.sample_width <= 0 ||
    !Number.isSafeInteger(probe.sample_height) ||
    probe.sample_height <= 0 ||
    !Number.isSafeInteger(probe.sampled_pixel_count) ||
    !Number.isSafeInteger(probe.visible_pixel_count) ||
    !Number.isSafeInteger(probe.distinct_color_bucket_count) ||
    !Number.isSafeInteger(probe.dominant_color_pixel_count) ||
    !Number.isSafeInteger(probe.max_channel_range) ||
    typeof probe.byte_length !== "number" ||
    probe.byte_length <= 0
  ) {
    return false;
  }
  const png = { width: probe.png_width, height: probe.png_height };
  const target = {
    windowId: probe.target_window_id,
    ownerPid: probe.target_owner_pid,
    ownerBundleId: null,
    ownerName: null,
    ownerActive: false,
    title: null,
    bounds: {
      x: probe.target_bounds[0],
      y: probe.target_bounds[1],
      width: probe.target_bounds[2],
      height: probe.target_bounds[3],
    },
    onScreen: true,
  };
  return (
    pngDimensionsMatchWindow(png, target) &&
    isDecodedNonPlaceholderPng(
      {
        width: png.width,
        height: png.height,
        sampleWidth: probe.sample_width,
        sampleHeight: probe.sample_height,
        sampledPixelCount: probe.sampled_pixel_count,
        visiblePixelCount: probe.visible_pixel_count,
        distinctColorBucketCount: probe.distinct_color_bucket_count,
        dominantColorPixelCount: probe.dominant_color_pixel_count,
        maxChannelRange: probe.max_channel_range,
      },
      png,
    )
  );
}

export function isScreenCaptureProbeSuccess(probe) {
  return isForeignWindowScreenCaptureProbeSuccess(probe);
}
