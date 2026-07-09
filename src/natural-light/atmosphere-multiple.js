"use strict";

const base = require("./atmosphere-core");
const advanced = require("./atmosphere-advanced");
const {
  MULTIPLE_SCATTERING_MODEL_ID,
  MULTIPLE_SCATTERING_VERSION,
  computeMultipleScatteringSpectrum,
  combineSingleAndMultipleSky
} = require("./multiple-scattering-core");

const NATURAL_LIGHT_MODEL_ID = "skyforge-natural-light-phase4";
const NATURAL_LIGHT_MODEL_VERSION = "0.4.0";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeRgb(rgb) {
  const positive = {
    r: Math.max(0, Number(rgb.r) || 0),
    g: Math.max(0, Number(rgb.g) || 0),
    b: Math.max(0, Number(rgb.b) || 0)
  };
  const maximum = Math.max(positive.r, positive.g, positive.b, 1e-12);
  return {
    r: positive.r / maximum,
    g: positive.g / maximum,
    b: positive.b / maximum
  };
}

function evaluateNaturalLight(input = {}) {
  const single = advanced.evaluateNaturalLight(input);
  const multiple = computeMultipleScatteringSpectrum({
    sunZenithDeg: single.solarPosition.apparentZenithDeg,
    altitudeMeters: input.altitudeMeters ?? 0,
    pressureRatio: single.atmosphere.pressureRatio,
    aerosolOpticalDepth550: input.aerosolOpticalDepth550 ?? 0.1,
    angstromExponent: input.angstromExponent ?? 1.3,
    mieAsymmetry: input.mieAsymmetry ?? 0.76,
    aerosolSingleScatteringAlbedo:
      input.aerosolSingleScatteringAlbedo ?? 0.92,
    ozoneDobsonUnits: input.ozoneDobsonUnits ?? 300,
    precipitableWaterCm: input.precipitableWaterCm ?? 1.5,
    groundAlbedo: input.groundAlbedo ?? 0.2,
    multipleScatteringOrders: input.multipleScatteringOrders ?? 4
  });

  const zenithSpectrum = combineSingleAndMultipleSky(
    single.spectral.zenithSky,
    multiple,
    { x: 0, y: 1, z: 0 }
  );
  const zenithXyz = base.spectrumToXyz(zenithSpectrum);
  const zenithLinearSrgb = base.xyzToLinearSrgb(zenithXyz);
  const elevationSin = Math.max(
    0,
    Math.sin(single.solarPosition.apparentElevationDeg * Math.PI / 180)
  );
  const singleDiffuse = single.irradiance.diffuseHorizontalEstimatedWm2;
  const multipleBoost = singleDiffuse * clamp(
    multiple.metrics.multipleToSingleRatio,
    0,
    2.5
  );
  const groundBoost =
    single.irradiance.extraterrestrialNormalWm2 *
    elevationSin *
    multiple.metrics.groundBounceBroadband *
    0.18;
  const diffuseHorizontalWm2 = single.solarPosition.isAboveHorizon
    ? singleDiffuse + multipleBoost + groundBoost
    : 0;
  const globalHorizontalWm2 =
    single.irradiance.directNormalWm2 * elevationSin +
    diffuseHorizontalWm2;

  return {
    ...single,
    model: {
      id: NATURAL_LIGHT_MODEL_ID,
      version: NATURAL_LIGHT_MODEL_VERSION,
      scattering: "finite-order-multiple-with-ground-bounce",
      gasAbsorptionModel: single.model.gasAbsorptionModel,
      multipleScatteringModel: {
        id: MULTIPLE_SCATTERING_MODEL_ID,
        version: MULTIPLE_SCATTERING_VERSION,
        orders: multiple.model.orders
      },
      spectralRangeNm: single.model.spectralRangeNm,
      spectralStepNm: single.model.spectralStepNm,
      limitations: [
        "Multiple scattering uses a hemispheric finite-order recurrence",
        "Ground bounce assumes a Lambertian scalar albedo",
        "No polarization or terrain occlusion",
        "Gas absorption is band-parameterized, not line-by-line"
      ]
    },
    atmosphere: {
      ...single.atmosphere,
      aerosolSingleScatteringAlbedo:
        input.aerosolSingleScatteringAlbedo ?? 0.92,
      groundAlbedo: input.groundAlbedo ?? 0.2,
      multipleScatteringOrders: multiple.model.orders
    },
    irradiance: {
      ...single.irradiance,
      singleScatterDiffuseHorizontalEstimatedWm2: singleDiffuse,
      multipleScatterDiffuseBoostEstimatedWm2: multipleBoost,
      groundBounceDiffuseBoostEstimatedWm2: groundBoost,
      diffuseHorizontalEstimatedWm2: diffuseHorizontalWm2,
      globalHorizontalEstimatedWm2: globalHorizontalWm2
    },
    color: {
      ...single.color,
      zenithSkyLinearSrgb: normalizeRgb(zenithLinearSrgb),
      zenithSkyXyz: zenithXyz,
      multipleScatteringLinearSrgb:
        multiple.color.totalIndirect.linearSrgb
    },
    spectral: {
      ...single.spectral,
      zenithSky: zenithSpectrum,
      multipleScatteringAtmosphere:
        multiple.spectra.atmosphericMultiple,
      groundBounce: multiple.spectra.groundBounce,
      totalIndirect: multiple.spectra.totalIndirect
    },
    multipleScattering: {
      model: multiple.model,
      metrics: multiple.metrics,
      orderEnergy: multiple.orderEnergy
    }
  };
}

module.exports = {
  NATURAL_LIGHT_MODEL_ID,
  NATURAL_LIGHT_MODEL_VERSION,
  evaluateNaturalLight
};