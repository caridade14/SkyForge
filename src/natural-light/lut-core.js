"use strict";

const {
  calculateSolarPosition,
  absoluteAirMass,
  pressureRatioAtAltitude
} = require("./solar-core");
const {
  sampleSingleScatteringSky,
  directTransmittanceSpectrum
} = require("./atmosphere-advanced");
const { normalizedSolarSpectrum } = require("./atmosphere-core");
const { normalizeNaturalLightInput } = require("./input-schema");

const SKY_VIEW_LUT_MODEL_ID = "skyforge-sky-view-lut-phase3";
const SKY_VIEW_LUT_VERSION = "0.3.0";
const TRANSMITTANCE_LUT_MODEL_ID = "skyforge-transmittance-lut-phase3";
const TRANSMITTANCE_LUT_VERSION = "0.3.0";
const DEFAULT_LUT_WIDTH = 64;
const DEFAULT_LUT_HEIGHT = 32;
const MAX_LUT_WIDTH = 256;
const MAX_LUT_HEIGHT = 128;
const DEFAULT_TRANSMITTANCE_WIDTH = 48;
const DEFAULT_TRANSMITTANCE_HEIGHT = 24;
const MAX_TRANSMITTANCE_WIDTH = 256;
const MAX_TRANSMITTANCE_HEIGHT = 128;
const DEFAULT_TRANSMITTANCE_MAX_ALTITUDE_METERS = 20_000;

function integerInRange(name, value, fallback, min, max) {
  const resolved = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new RangeError(`${name} must be an integer in [${min}, ${max}]`);
  }
  return resolved;
}

function finiteInRange(name, value, fallback, min, max) {
  const resolved = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isFinite(resolved) || resolved < min || resolved > max) {
    throw new RangeError(`${name} must be a finite number in [${min}, ${max}]`);
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

function resolveTransmittanceLutOptions(payload = {}) {
  const options = payload.transmittanceLut && typeof payload.transmittanceLut === "object"
    ? payload.transmittanceLut
    : (payload.lut && typeof payload.lut === "object" ? payload.lut : payload);
  return {
    width: integerInRange(
      "transmittanceLut.width",
      options.width,
      DEFAULT_TRANSMITTANCE_WIDTH,
      4,
      MAX_TRANSMITTANCE_WIDTH
    ),
    height: integerInRange(
      "transmittanceLut.height",
      options.height,
      DEFAULT_TRANSMITTANCE_HEIGHT,
      2,
      MAX_TRANSMITTANCE_HEIGHT
    ),
    maxAltitudeMeters: finiteInRange(
      "transmittanceLut.maxAltitudeMeters",
      options.maxAltitudeMeters,
      DEFAULT_TRANSMITTANCE_MAX_ALTITUDE_METERS,
      1_000,
      80_000
    )
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
        mieAsymmetry: input.mieAsymmetry,
        ozoneDobsonUnits: input.ozoneDobsonUnits,
        precipitableWaterCm: input.precipitableWaterCm
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
      scattering: "single-with-band-gas-absorption",
      sourceSolver: "skyforge-natural-light-phase3",
      limitations: [
        "Relative radiance normalization",
        "No multiple scattering yet",
        "Gas absorption is band-parameterized, not line-by-line",
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

function nearestTransmittanceSample(spectrum, wavelengthNm) {
  let nearest = spectrum[0];
  let nearestDistance = Infinity;
  for (const sample of spectrum) {
    const distance = Math.abs(sample.wavelengthNm - wavelengthNm);
    if (distance < nearestDistance) {
      nearest = sample;
      nearestDistance = distance;
    }
  }
  return nearest?.transmittance ?? 0;
}

function generateTransmittanceLut(payload = {}) {
  const input = normalizeNaturalLightInput(payload);
  const { width, height, maxAltitudeMeters } = resolveTransmittanceLutOptions(payload);
  const solarSpectrum = normalizedSolarSpectrum();
  const pixels = new Array(width * height * 4);
  let minimumBroadband = Infinity;
  let maximumBroadband = 0;
  let broadbandSum = 0;

  for (let y = 0; y < height; y += 1) {
    const altitudeFraction = 1 - (y + 0.5) / height;
    const altitudeMeters = altitudeFraction * maxAltitudeMeters;
    const pressureRatio = pressureRatioAtAltitude(altitudeMeters);

    for (let x = 0; x < width; x += 1) {
      const zenithDeg = ((x + 0.5) / width) * 89.5;
      const airMass = absoluteAirMass(zenithDeg, altitudeMeters);
      const spectrum = directTransmittanceSpectrum({
        airMass,
        pressureRatio,
        aerosolOpticalDepth550: input.aerosolOpticalDepth550,
        angstromExponent: input.angstromExponent,
        ozoneDobsonUnits: input.ozoneDobsonUnits,
        precipitableWaterCm: input.precipitableWaterCm
      });

      let broadband = 0;
      let weightSum = 0;
      for (let index = 0; index < spectrum.length; index += 1) {
        const weight = solarSpectrum[index]?.value ?? 1;
        broadband += spectrum[index].transmittance * weight;
        weightSum += weight;
      }
      broadband = weightSum > 0 ? broadband / weightSum : 0;

      const offset = (y * width + x) * 4;
      pixels[offset] = roundFloat(nearestTransmittanceSample(spectrum, 650));
      pixels[offset + 1] = roundFloat(nearestTransmittanceSample(spectrum, 550));
      pixels[offset + 2] = roundFloat(nearestTransmittanceSample(spectrum, 450));
      pixels[offset + 3] = roundFloat(broadband);
      minimumBroadband = Math.min(minimumBroadband, broadband);
      maximumBroadband = Math.max(maximumBroadband, broadband);
      broadbandSum += broadband;
    }
  }

  const pixelCount = width * height;
  return {
    model: {
      id: TRANSMITTANCE_LUT_MODEL_ID,
      version: TRANSMITTANCE_LUT_VERSION,
      sourceSolver: "skyforge-natural-light-phase3",
      absorption: "ozone-oxygen-water-band-model",
      limitations: [
        "Band-parameterized gas absorption",
        "No line-by-line pressure broadening",
        "No multiple scattering"
      ]
    },
    layout: {
      projection: "altitude-vs-zenith",
      width,
      height,
      channels: ["red650", "green550", "blue450", "broadband"],
      xAxis: { quantity: "zenithDeg", range: [0, 89.5] },
      yAxis: {
        quantity: "altitudeMeters",
        range: [maxAltitudeMeters, 0],
        rowOrder: "top-atmosphere-to-ground"
      }
    },
    input,
    encoding: {
      range: [0, 1],
      normalization: "none"
    },
    statistics: {
      minimumBroadbandTransmittance: roundFloat(
        Number.isFinite(minimumBroadband) ? minimumBroadband : 0
      ),
      maximumBroadbandTransmittance: roundFloat(maximumBroadband),
      meanBroadbandTransmittance: roundFloat(
        pixelCount ? broadbandSum / pixelCount : 0
      )
    },
    pixels
  };
}

module.exports = {
  SKY_VIEW_LUT_MODEL_ID,
  SKY_VIEW_LUT_VERSION,
  TRANSMITTANCE_LUT_MODEL_ID,
  TRANSMITTANCE_LUT_VERSION,
  DEFAULT_LUT_WIDTH,
  DEFAULT_LUT_HEIGHT,
  MAX_LUT_WIDTH,
  MAX_LUT_HEIGHT,
  DEFAULT_TRANSMITTANCE_WIDTH,
  DEFAULT_TRANSMITTANCE_HEIGHT,
  MAX_TRANSMITTANCE_WIDTH,
  MAX_TRANSMITTANCE_HEIGHT,
  DEFAULT_TRANSMITTANCE_MAX_ALTITUDE_METERS,
  directionFromLutCoordinate,
  resolveLutOptions,
  resolveTransmittanceLutOptions,
  generateSkyViewLut,
  generateTransmittanceLut
};