"use strict";

const DEFAULT_VOLUMETRIC_CLOUDS = Object.freeze({
  enabled: true,
  coverage: 0.32,
  density: 0.55,
  baseHeightMeters: 1800,
  thicknessMeters: 2200,
  erosion: 0.42,
  detailStrength: 0.34,
  phaseAsymmetry: 0.72,
  extinctionCoefficient: 0.00085,
  multiScatteringFactor: 0.35,
  powderStrength: 0.4,
  shadowStrength: 0.72,
  windSpeedMetersPerSecond: 12,
  windDirectionDeg: 245,
  seed: 1337
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(name, value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new RangeError(`${name} must be a finite number in [${min}, ${max}]`);
  }
  return number;
}

function normalizeVolumetricClouds(payload = {}) {
  const source = payload.clouds || payload;
  return {
    enabled: source.enabled === undefined ? DEFAULT_VOLUMETRIC_CLOUDS.enabled : Boolean(source.enabled),
    coverage: finiteNumber("clouds.coverage", source.coverage ?? DEFAULT_VOLUMETRIC_CLOUDS.coverage, 0, 1),
    density: finiteNumber("clouds.density", source.density ?? DEFAULT_VOLUMETRIC_CLOUDS.density, 0, 2),
    baseHeightMeters: finiteNumber(
      "clouds.baseHeightMeters",
      source.baseHeightMeters ?? DEFAULT_VOLUMETRIC_CLOUDS.baseHeightMeters,
      0,
      20000
    ),
    thicknessMeters: finiteNumber(
      "clouds.thicknessMeters",
      source.thicknessMeters ?? DEFAULT_VOLUMETRIC_CLOUDS.thicknessMeters,
      50,
      20000
    ),
    erosion: finiteNumber("clouds.erosion", source.erosion ?? DEFAULT_VOLUMETRIC_CLOUDS.erosion, 0, 1),
    detailStrength: finiteNumber(
      "clouds.detailStrength",
      source.detailStrength ?? DEFAULT_VOLUMETRIC_CLOUDS.detailStrength,
      0,
      1
    ),
    phaseAsymmetry: finiteNumber(
      "clouds.phaseAsymmetry",
      source.phaseAsymmetry ?? DEFAULT_VOLUMETRIC_CLOUDS.phaseAsymmetry,
      -0.95,
      0.95
    ),
    extinctionCoefficient: finiteNumber(
      "clouds.extinctionCoefficient",
      source.extinctionCoefficient ?? DEFAULT_VOLUMETRIC_CLOUDS.extinctionCoefficient,
      0.00001,
      0.02
    ),
    multiScatteringFactor: finiteNumber(
      "clouds.multiScatteringFactor",
      source.multiScatteringFactor ?? DEFAULT_VOLUMETRIC_CLOUDS.multiScatteringFactor,
      0,
      2
    ),
    powderStrength: finiteNumber(
      "clouds.powderStrength",
      source.powderStrength ?? DEFAULT_VOLUMETRIC_CLOUDS.powderStrength,
      0,
      2
    ),
    shadowStrength: finiteNumber(
      "clouds.shadowStrength",
      source.shadowStrength ?? DEFAULT_VOLUMETRIC_CLOUDS.shadowStrength,
      0,
      1
    ),
    windSpeedMetersPerSecond: finiteNumber(
      "clouds.windSpeedMetersPerSecond",
      source.windSpeedMetersPerSecond ?? DEFAULT_VOLUMETRIC_CLOUDS.windSpeedMetersPerSecond,
      0,
      150
    ),
    windDirectionDeg: finiteNumber(
      "clouds.windDirectionDeg",
      source.windDirectionDeg ?? DEFAULT_VOLUMETRIC_CLOUDS.windDirectionDeg,
      -360,
      360
    ),
    seed: Math.round(finiteNumber("clouds.seed", source.seed ?? DEFAULT_VOLUMETRIC_CLOUDS.seed, 0, 2147483647))
  };
}

function fract(value) {
  return value - Math.floor(value);
}

function hash3(x, y, z, seed = 0) {
  return fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 0.013) * 43758.5453123);
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / Math.max(edge1 - edge0, 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
}

function valueNoise3(x, y, z, seed = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = smoothstep(0, 1, fract(x));
  const fy = smoothstep(0, 1, fract(y));
  const fz = smoothstep(0, 1, fract(z));
  const sample = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz, seed);
  const lerp = (a, b, t) => a * (1 - t) + b * t;
  const x00 = lerp(sample(0, 0, 0), sample(1, 0, 0), fx);
  const x10 = lerp(sample(0, 1, 0), sample(1, 1, 0), fx);
  const x01 = lerp(sample(0, 0, 1), sample(1, 0, 1), fx);
  const x11 = lerp(sample(0, 1, 1), sample(1, 1, 1), fx);
  return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz);
}

function fbm3(x, y, z, octaves = 5, seed = 0) {
  let amplitude = 0.5;
  let frequency = 1;
  let sum = 0;
  let normalization = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += valueNoise3(x * frequency, y * frequency, z * frequency, seed + octave * 101) * amplitude;
    normalization += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / Math.max(normalization, 1e-9);
}

function cloudHeightProfile(normalizedHeight) {
  const h = clamp(normalizedHeight, 0, 1);
  const bottom = smoothstep(0, 0.16, h);
  const top = 1 - smoothstep(0.68, 1, h);
  return bottom * top;
}

function sampleCloudDensity(position = {}, cloudInput = {}, timeSeconds = 0) {
  const clouds = normalizeVolumetricClouds(cloudInput);
  if (!clouds.enabled) return 0;
  const windRadians = clouds.windDirectionDeg * Math.PI / 180;
  const windOffset = clouds.windSpeedMetersPerSecond * Math.max(0, Number(timeSeconds) || 0);
  const x = (Number(position.x) || 0) + Math.sin(windRadians) * windOffset;
  const y = Number(position.y) || 0;
  const z = (Number(position.z) || 0) + Math.cos(windRadians) * windOffset;
  const height = (y - clouds.baseHeightMeters) / clouds.thicknessMeters;
  if (height <= 0 || height >= 1) return 0;

  const macroScale = 1 / 9000;
  const detailScale = 1 / 1700;
  const weather = fbm3(x * macroScale, 0.1, z * macroScale, 4, clouds.seed);
  const shape = fbm3(x * macroScale * 2.2, y * macroScale * 1.35, z * macroScale * 2.2, 5, clouds.seed + 47);
  const detail = fbm3(x * detailScale, y * detailScale, z * detailScale, 3, clouds.seed + 991);
  const threshold = 1 - clouds.coverage;
  const weatherMask = smoothstep(threshold - 0.12, threshold + 0.16, weather);
  const erodedShape = shape - (1 - detail) * clouds.erosion * clouds.detailStrength;
  return clamp((erodedShape - threshold) * 2.1, 0, 1) * weatherMask * cloudHeightProfile(height) * clouds.density;
}

function beerLambertTransmittance(density, distanceMeters, extinctionCoefficient) {
  return Math.exp(-Math.max(0, density) * Math.max(0, distanceMeters) * Math.max(0, extinctionCoefficient));
}

function henyeyGreenstein(cosTheta, asymmetry) {
  const g = clamp(asymmetry, -0.95, 0.95);
  const denominator = Math.pow(Math.max(1 + g * g - 2 * g * clamp(cosTheta, -1, 1), 1e-6), 1.5);
  return (1 - g * g) / (4 * Math.PI * denominator);
}

function cloudPowderTerm(density, strength = 0.4) {
  return 1 - Math.exp(-Math.max(0, density) * Math.max(0, strength) * 2);
}

function evaluateCloudLighting(input = {}) {
  const clouds = normalizeVolumetricClouds(input.clouds || input);
  const density = Math.max(0, Number(input.density) || 0);
  const stepLengthMeters = Math.max(0, Number(input.stepLengthMeters) || 0);
  const lightTransmittance = clamp(Number(input.lightTransmittance ?? 1), 0, 1);
  const phase = henyeyGreenstein(Number(input.cosTheta) || 0, clouds.phaseAsymmetry);
  const transmittance = beerLambertTransmittance(density, stepLengthMeters, clouds.extinctionCoefficient);
  const powder = cloudPowderTerm(density, clouds.powderStrength);
  const multi = 1 + clouds.multiScatteringFactor * (1 - lightTransmittance);
  const scattering = density * phase * lightTransmittance * multi * (0.65 + powder * 0.35);
  return { transmittance, scattering, phase, powder };
}

module.exports = {
  DEFAULT_VOLUMETRIC_CLOUDS,
  normalizeVolumetricClouds,
  hash3,
  valueNoise3,
  fbm3,
  cloudHeightProfile,
  sampleCloudDensity,
  beerLambertTransmittance,
  henyeyGreenstein,
  cloudPowderTerm,
  evaluateCloudLighting
};
