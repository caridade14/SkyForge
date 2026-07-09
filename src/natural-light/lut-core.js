"use strict";

const {
  calculateSolarPosition,
  absoluteAirMass,
  pressureRatioAtAltitude
} = require("./solar-core");
const { sampleSingleScatteringSky } = require("./atmosphere-core");
const { normalizeNaturalLightInput } = require("./input-schema");

const SKY_VIEW_LUT_MODEL_ID = "skyforge-sky-view-lut-phase2";
const SKY_VIEW_LUT_VERSION = "0.2.0";
const DEFAULT_LUT_WIDTH = 64;
const DEFAULT_LUT_HEIGHT = 32;
const MAX_LUT_WIDTH = 256;
const MAX_LUT_HEIGHT = 128;

function integerInRange(name, value, fallback, min, max) {
  const resolved = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new RangeError(`${name} must be an integer in [${min}, ${max}]`);
  }
  return resolved;
}

function roundFloat(value, digits = 7) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

function directionFromLutCoordinate(x, y, width, height) {
  const u = (x + 0.5) / width;
  const v = (y + 0.5) / height;
  const azimuth = u * Math.PI * 2;
  const elevation = (1 - v) * Math.PI / 2;
  const cosElevation = Math.cos(elevation);

  return {
    x: cosElevation * Math.sin(azimuth),
    y: Math.sin(elevation),
    z: cosElevation * Math.cos(azimuth)
  };
}

function resolveLutOptions(payload = {}) {
  const options = payload.lut && typeof payload.lut === "object" ? payload.lut : payload;
  return {
    width: integerInRange("lut.width", options.width, DEFAULT_LUT_WIDTH, 4, MAX_LUT_WIDTH),
    height: integerInRange("lut.height", options.height, DEFAULT_LUT_HEIGHT, 2, MAX_LUT_HEIGHT)
  };
}

function generateSkyViewLut(payload = {}) {
  const input = normalizeNaturalLightInput(payload);
  const { width, height } = resolveLutOptions(payload);
  const solarPosition = calculateSolarPosition(input);
  const sunAirMass = absoluteAirMass(
    solarPosition.apparentZenithDeg,
    input.altitudeMeters
  );
  const pressureRatio = pressureRatioAtAltitude(input.altitudeMeters);

  const rawPixels = new Array(width * height * 3);
  let maxChannel = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sky = sampleSingleScatteringSky({
        viewDirection: directionFromLutCoordinate(x, y, width, height),
        sunDirection: solarPosition.sunDirection,
        sunAirMass,
        altitudeMeters: input.altitudeMeters,
        pressureRatio,
        aerosolOpticalDepth550: input.aerosolOpticalDepth550,
        angstromExponent: input.angstromExponent,
        mieAsymmetry: input.mieAsymmetry
      });

      const offset = (y * width + x) * 3;
      const red = Math.max(0, Number(sky.linearSrgb.r) || 0);
      const green = Math.max(0, Number(sky.linearSrgb.g) || 0);
      const blue = Math.max(0, Number(sky.linearSrgb.b) || 0);
      rawPixels[offset] = red;
      rawPixels[offset + 1] = green;
      rawPixels[offset + 2] = blue;
      maxChannel = Math.max(maxChannel, red, green, blue);
    }
  }

  const normalizationScale = maxChannel > 0 ? 1 / maxChannel : 0;
  const pixels = new Array(rawPixels.length);
  let minLuminance = Infinity;
  let maxLuminance = 0;
  let luminanceSum = 0;

  for (let index = 0; index < rawPixels.length; index += 3) {
    const red = rawPixels[index] * normalizationScale;
    const green = rawPixels[index + 1] * normalizationScale;
    const blue = rawPixels[index + 2] * normalizationScale;
    pixels[index] = roundFloat(red);
    pixels[index + 1] = roundFloat(green);
    pixels[index + 2] = roundFloat(blue);

    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    minLuminance = Math.min(minLuminance, luminance);
    maxLuminance = Math.max(maxLuminance, luminance);
    luminanceSum += luminance;
  }

  const pixelCount = width * height;
  return {
    model: {
      id: SKY_VIEW_LUT_MODEL_ID,
      version: SKY_VIEW_LUT_VERSION,
      scattering: "single",
      sourceSolver: "skyforge-natural-light-phase1",
      limitations: [
        "Relative radiance normalization",
        "No multiple scattering yet",
        "No ozone or water-vapour absorption yet",
        "No direct solar-disc rasterization"
      ]
    },
    layout: {
      projection: "equirectangular-upper-hemisphere",
      width,
      height,
      channels: ["linearR", "linearG", "linearB"],
      rowOrder: "zenith-to-horizon",
      azimuthOrigin: "north",
      azimuthDirection: "clockwise"
    },
    input,
    solarPosition,
    encoding: {
      colorSpace: "linear-sRGB",
      range: [0, 1],
      normalization: "global-max-channel",
      normalizationScale: roundFloat(normalizationScale, 10)
    },
    statistics: {
      minimumLuminance: roundFloat(Number.isFinite(minLuminance) ? minLuminance : 0),
      maximumLuminance: roundFloat(maxLuminance),
      meanLuminance: roundFloat(pixelCount ? luminanceSum / pixelCount : 0)
    },
    pixels
  };
}

module.exports = {
  SKY_VIEW_LUT_MODEL_ID,
  SKY_VIEW_LUT_VERSION,
  DEFAULT_LUT_WIDTH,
  DEFAULT_LUT_HEIGHT,
  MAX_LUT_WIDTH,
  MAX_LUT_HEIGHT,
  directionFromLutCoordinate,
  resolveLutOptions,
  generateSkyViewLut
};