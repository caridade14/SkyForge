"use strict";

const LINEAR_SRGB_TO_ACESCG = Object.freeze([
  [0.6131324224, 0.3395380158, 0.0474166960],
  [0.0701243808, 0.9163940113, 0.0134515239],
  [0.0205876575, 0.1095745716, 0.8697854040]
]);

const ACESCG_TO_LINEAR_SRGB = Object.freeze([
  [1.7048586763, -0.6217160219, -0.0832993717],
  [-0.1300768242, 1.1407357748, -0.0105598017],
  [-0.0239640729, -0.1289755083, 1.1530140189]
]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function vector3(value = {}) {
  if (Array.isArray(value)) {
    return { r: Number(value[0]) || 0, g: Number(value[1]) || 0, b: Number(value[2]) || 0 };
  }
  return { r: Number(value.r) || 0, g: Number(value.g) || 0, b: Number(value.b) || 0 };
}

function multiplyMatrix3(matrix, color) {
  const c = vector3(color);
  return {
    r: matrix[0][0] * c.r + matrix[0][1] * c.g + matrix[0][2] * c.b,
    g: matrix[1][0] * c.r + matrix[1][1] * c.g + matrix[1][2] * c.b,
    b: matrix[2][0] * c.r + matrix[2][1] * c.g + matrix[2][2] * c.b
  };
}

function linearSrgbToAcescg(color) {
  return multiplyMatrix3(LINEAR_SRGB_TO_ACESCG, color);
}

function acescgToLinearSrgb(color) {
  return multiplyMatrix3(ACESCG_TO_LINEAR_SRGB, color);
}

function luminance(color) {
  const c = vector3(color);
  return Math.max(0, 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b);
}

function acesFittedChannel(value) {
  const x = Math.max(0, Number(value) || 0);
  const a = 2.51;
  const b = 0.03;
  const c = 2.43;
  const d = 0.59;
  const e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0, 1);
}

function acesFitted(color) {
  const c = vector3(color);
  return {
    r: acesFittedChannel(c.r),
    g: acesFittedChannel(c.g),
    b: acesFittedChannel(c.b)
  };
}

function linearToSrgbChannel(value) {
  const x = Math.max(0, Number(value) || 0);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

function linearToSrgb(color) {
  const c = vector3(color);
  return {
    r: clamp(linearToSrgbChannel(c.r), 0, 1),
    g: clamp(linearToSrgbChannel(c.g), 0, 1),
    b: clamp(linearToSrgbChannel(c.b), 0, 1)
  };
}

function softGamutCompress(color, threshold = 0.8, limit = 1.4) {
  const c = vector3(color);
  const maximum = Math.max(c.r, c.g, c.b);
  if (maximum <= threshold) return c;
  const amount = (maximum - threshold) / Math.max(limit - threshold, 1e-6);
  const compressedMaximum = threshold + (limit - threshold) * (1 - Math.exp(-Math.max(0, amount)));
  const scale = compressedMaximum / Math.max(maximum, 1e-6);
  return { r: c.r * scale, g: c.g * scale, b: c.b * scale };
}

function applyWhiteBalance(color, multipliers = { r: 1, g: 1, b: 1 }) {
  const c = vector3(color);
  return {
    r: c.r * (Number(multipliers.r) || 1),
    g: c.g * (Number(multipliers.g) || 1),
    b: c.b * (Number(multipliers.b) || 1)
  };
}

function applyDisplayPipeline(color, options = {}) {
  const exposure = Number.isFinite(Number(options.exposureMultiplier))
    ? Number(options.exposureMultiplier)
    : 1;
  const whiteBalance = options.whiteBalance || { r: 1, g: 1, b: 1 };
  const working = options.inputSpace === "acescg"
    ? vector3(color)
    : linearSrgbToAcescg(color);
  const balanced = applyWhiteBalance(working, whiteBalance);
  const exposed = { r: balanced.r * exposure, g: balanced.g * exposure, b: balanced.b * exposure };
  const displayLinear = acescgToLinearSrgb(softGamutCompress(exposed));
  return linearToSrgb(acesFitted(displayLinear));
}

module.exports = {
  LINEAR_SRGB_TO_ACESCG,
  ACESCG_TO_LINEAR_SRGB,
  vector3,
  multiplyMatrix3,
  linearSrgbToAcescg,
  acescgToLinearSrgb,
  luminance,
  acesFittedChannel,
  acesFitted,
  linearToSrgbChannel,
  linearToSrgb,
  softGamutCompress,
  applyWhiteBalance,
  applyDisplayPipeline
};
