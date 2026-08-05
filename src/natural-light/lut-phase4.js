"use strict";

const baseLut = require("./lut-core");
const {
  pressureRatioAtAltitude
} = require("./solar-core");
const {
  normalizeNaturalLightInput
} = require("./input-schema");
const {
  computeMultipleScatteringSpectrum
} = require("./multiple-scattering-core");

const SKY_VIEW_LUT_MODEL_ID = "skyforge-sky-view-lut-phase4";
const SKY_VIEW_LUT_VERSION = "0.4.0";
const MULTIPLE_SCATTERING_LUT_MODEL_ID =
  "skyforge-multiple-scattering-lut-phase4";
const MULTIPLE_SCATTERING_LUT_VERSION = "0.4.0";
const DEFAULT_MULTIPLE_SCATTERING_LUT_WIDTH = 32;
const DEFAULT_MULTIPLE_SCATTERING_LUT_HEIGHT = 16;
const MAX_MULTIPLE_SCATTERING_LUT_WIDTH = 128;
const MAX_MULTIPLE_SCATTERING_LUT_HEIGHT = 64;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundFloat(value, digits = 7) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

function integerInRange(name, value, fallback, min, max) {
  const resolved = value === undefined || value === null
    ? fallback
    : Number(value);
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new RangeError(`${name} must be an integer in [${min}, ${max}]`);
  }
  return resolved;
}

function finiteInRange(name, value, fallback, min, max) {
  const resolved = value === undefined || value === null
    ? fallback
    : Number(value);
  if (!Number.isFinite(resolved) || resolved < min || resolved > max) {
    throw new RangeError(
      `${name} must be a finite number in [${min}, ${max}]`
    );
  }
  return resolved;
}

function normalizePositiveRgb(rgb) {
  const positive = [
    Math.max(0, Number(rgb?.r) || 0),
    Math.max(0, Number(rgb?.g) || 0),
    Math.max(0, Number(rgb?.b) || 0)
  ];
  const maximum = Math.max(...positive, 1e-12);
  return positive.map((value) => value / maximum);
}

function multipleScatteringForInput(input, sunZenithDeg, altitudeMeters) {
  return computeMultipleScatteringSpectrum({
    sunZenithDeg,
    altitudeMeters,
    pressureRatio: pressureRatioAtAltitude(altitudeMeters),
    aerosolOpticalDepth550: input.aerosolOpticalDepth550,
    angstromExponent: input.angstromExponent,
    mieAsymmetry: input.mieAsymmetry,
    aerosolSingleScatteringAlbedo:
      input.aerosolSingleScatteringAlbedo,
    ozoneDobsonUnits: input.ozoneDobsonUnits,
    precipitableWaterCm: input.precipitableWaterCm,
    groundAlbedo: input.groundAlbedo,
    multipleScatteringOrders: input.multipleScatteringOrders
  });
}

function generateSkyViewLut(payload = {}) {
  const input = normalizeNaturalLightInput(payload);
  const singleLut = baseLut.generateSkyViewLut({
    input,
    lut: payload.lut || payload
  });
  const multiple = multipleScatteringForInput(
    input,
    singleLut.solarPosition.apparentZenithDeg,
    input.altitudeMeters
  );
  const atmosphereRgb = normalizePositiveRgb(
    multiple.color.atmosphericMultiple.linearSrgb
  );
  const groundRgb = normalizePositiveRgb(
    multiple.color.groundBounce.linearSrgb
  );
  const multipleStrength = clamp(
    multiple.metrics.multipleToSingleRatio * 0.42,
    0,
    1.8
  );
  const groundStrength = clamp(
    multiple.metrics.groundBounceBroadband * 1.8,
    0,
    0.85
  );

  const width = singleLut.layout.width;
  const height = singleLut.layout.height;
  const rawPixels = new Array(singleLut.pixels.length);
  let maximumChannel = 0;

  for (let y = 0; y < height; y += 1) {
    const elevation = (1 - (y + 0.5) / height) * Math.PI / 2;
    const viewY = Math.sin(elevation);
    const horizon = Math.pow(1 - viewY, 0.72);
    const atmosphericWeight = 0.68 + 0.32 * horizon;
    const groundWeight = 0.22 + 0.78 * Math.pow(1 - viewY, 1.6);

    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        const value =
          singleLut.pixels[offset + channel] +
          atmosphereRgb[channel] * multipleStrength * atmosphericWeight +
          groundRgb[channel] * groundStrength * groundWeight;
        rawPixels[offset + channel] = Math.max(0, value);
        maximumChannel = Math.max(maximumChannel, value);
      }
    }
  }

  const normalizationScale = maximumChannel > 0
    ? 1 / maximumChannel
    : 0;
  const pixels = rawPixels.map((value) =>
    roundFloat(value * normalizationScale)
  );
  let minimumLuminance = Infinity;
  let maximumLuminance = 0;
  let luminanceSum = 0;

  for (let index = 0; index < pixels.length; index += 3) {
    const luminance =
      0.2126 * pixels[index] +
      0.7152 * pixels[index + 1] +
      0.0722 * pixels[index + 2];
    minimumLuminance = Math.min(minimumLuminance, luminance);
    maximumLuminance = Math.max(maximumLuminance, luminance);
    luminanceSum += luminance;
  }

  return {
    ...singleLut,
    model: {
      id: SKY_VIEW_LUT_MODEL_ID,
      version: SKY_VIEW_LUT_VERSION,
      scattering: "finite-order-multiple-with-ground-bounce",
      sourceSolver: "skyforge-natural-light-phase4",
      multipleScatteringModel: multiple.model,
      limitations: [
        "Relative radiance normalization",
        "Hemispheric finite-order multiple scattering approximation",
        "Lambertian scalar ground albedo",
        "Gas absorption is band-parameterized, not line-by-line",
        "No direct solar-disc rasterization"
      ]
    },
    encoding: {
      ...singleLut.encoding,
      normalization: "global-max-after-indirect-light",
      normalizationScale: roundFloat(normalizationScale, 10)
    },
    statistics: {
      minimumLuminance: roundFloat(
        Number.isFinite(minimumLuminance) ? minimumLuminance : 0
      ),
      maximumLuminance: roundFloat(maximumLuminance),
      meanLuminance: roundFloat(
        width * height ? luminanceSum / (width * height) : 0
      ),
      multipleToSingleRatio: roundFloat(
        multiple.metrics.multipleToSingleRatio
      ),
      groundBounceBroadband: roundFloat(
        multiple.metrics.groundBounceBroadband
      )
    },
    multipleScattering: {
      metrics: multiple.metrics,
      orderEnergy: multiple.orderEnergy
    },
    pixels
  };
}

function resolveMultipleScatteringLutOptions(payload = {}) {
  const options = payload.multipleScatteringLut &&
    typeof payload.multipleScatteringLut === "object"
    ? payload.multipleScatteringLut
    : payload;
  return {
    width: integerInRange(
      "multipleScatteringLut.width",
      options.width,
      DEFAULT_MULTIPLE_SCATTERING_LUT_WIDTH,
      4,
      MAX_MULTIPLE_SCATTERING_LUT_WIDTH
    ),
    height: integerInRange(
      "multipleScatteringLut.height",
      options.height,
      DEFAULT_MULTIPLE_SCATTERING_LUT_HEIGHT,
      2,
      MAX_MULTIPLE_SCATTERING_LUT_HEIGHT
    ),
    maxAltitudeMeters: finiteInRange(
      "multipleScatteringLut.maxAltitudeMeters",
      options.maxAltitudeMeters,
      20_000,
      1_000,
      20_000
    )
  };
}

function generateMultipleScatteringLut(payload = {}) {
  const input = normalizeNaturalLightInput(payload);
  const {
    width,
    height,
    maxAltitudeMeters
  } = resolveMultipleScatteringLutOptions(payload);
  const rawPixels = new Array(width * height * 4);
  let maximumValue = 0;
  let totalEnergy = 0;
  let maximumOrderResidual = 0;

  for (let y = 0; y < height; y += 1) {
    const altitudeFraction = 1 - (y + 0.5) / height;
    const altitudeMeters = altitudeFraction * maxAltitudeMeters;
    const columnScales = baseLut.remainingColumnScales(
      altitudeMeters,
      maxAltitudeMeters
    );

    for (let x = 0; x < width; x += 1) {
      const sunZenithDeg = ((x + 0.5) / width) * 89.5;
      const multiple = computeMultipleScatteringSpectrum({
        sunZenithDeg,
        altitudeMeters,
        pressureRatio: pressureRatioAtAltitude(altitudeMeters),
        aerosolOpticalDepth550:
          input.aerosolOpticalDepth550 * columnScales.aerosol,
        angstromExponent: input.angstromExponent,
        mieAsymmetry: input.mieAsymmetry,
        aerosolSingleScatteringAlbedo:
          input.aerosolSingleScatteringAlbedo,
        ozoneDobsonUnits:
          input.ozoneDobsonUnits * columnScales.ozone,
        precipitableWaterCm:
          input.precipitableWaterCm * columnScales.waterVapor,
        groundAlbedo: input.groundAlbedo,
        multipleScatteringOrders: input.multipleScatteringOrders
      });
      const rgb = multiple.color.totalIndirect.linearSrgb;
      const offset = (y * width + x) * 4;
      rawPixels[offset] = Math.max(0, Number(rgb.r) || 0);
      rawPixels[offset + 1] = Math.max(0, Number(rgb.g) || 0);
      rawPixels[offset + 2] = Math.max(0, Number(rgb.b) || 0);
      rawPixels[offset + 3] = Math.max(
        0,
        multiple.metrics.totalIndirectBroadband
      );

      maximumValue = Math.max(
        maximumValue,
        rawPixels[offset],
        rawPixels[offset + 1],
        rawPixels[offset + 2],
        rawPixels[offset + 3]
      );
      totalEnergy += rawPixels[offset + 3];
      maximumOrderResidual = Math.max(
        maximumOrderResidual,
        multiple.metrics.lastOrderFraction
      );
    }
  }

  const normalizationScale = maximumValue > 0
    ? 1 / maximumValue
    : 0;
  const pixels = rawPixels.map((value) =>
    roundFloat(value * normalizationScale)
  );

  return {
    model: {
      id: MULTIPLE_SCATTERING_LUT_MODEL_ID,
      version: MULTIPLE_SCATTERING_LUT_VERSION,
      sourceSolver: "skyforge-natural-light-phase4",
      method: "finite-order-hemispheric-recurrence",
      orders: input.multipleScatteringOrders,
      groundModel: "lambertian",
      limitations: [
        "Not a full angular radiance integral",
        "No polarization",
        "No terrain occlusion",
        "Relative energy encoding"
      ]
    },
    layout: {
      projection: "altitude-vs-solar-zenith",
      width,
      height,
      channels: [
        "indirectLinearR",
        "indirectLinearG",
        "indirectLinearB",
        "indirectBroadband"
      ],
      xAxis: {
        quantity: "sunZenithDeg",
        range: [0, 89.5]
      },
      yAxis: {
        quantity: "altitudeMeters",
        range: [maxAltitudeMeters, 0],
        rowOrder: "top-atmosphere-to-ground"
      }
    },
    input,
    encoding: {
      colorSpace: "linear-sRGB",
      range: [0, 1],
      normalization: "global-max-relative-energy",
      normalizationScale: roundFloat(normalizationScale, 10)
    },
    statistics: {
      meanIndirectBroadband: roundFloat(
        width * height ? totalEnergy / (width * height) : 0
      ),
      maximumOrderResidual: roundFloat(maximumOrderResidual)
    },
    pixels
  };
}

module.exports = {
  ...baseLut,
  SKY_VIEW_LUT_MODEL_ID,
  SKY_VIEW_LUT_VERSION,
  MULTIPLE_SCATTERING_LUT_MODEL_ID,
  MULTIPLE_SCATTERING_LUT_VERSION,
  DEFAULT_MULTIPLE_SCATTERING_LUT_WIDTH,
  DEFAULT_MULTIPLE_SCATTERING_LUT_HEIGHT,
  MAX_MULTIPLE_SCATTERING_LUT_WIDTH,
  MAX_MULTIPLE_SCATTERING_LUT_HEIGHT,
  generateSkyViewLut,
  resolveMultipleScatteringLutOptions,
  generateMultipleScatteringLut
};