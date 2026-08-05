"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  transportStateAtWavelength,
  computeMultipleScatteringSpectrum,
  evaluateNaturalLight,
  createNaturalLightSceneState,
  naturalLightInputFromSceneState,
  generateSkyViewLut,
  generateMultipleScatteringLut
} = require("../src/natural-light");

const daylightInput = {
  latitude: 48.8566,
  longitude: 2.3522,
  dateTime: "2026-07-09T14:00:00+02:00",
  altitudeMeters: 35,
  aerosolOpticalDepth550: 0.12,
  angstromExponent: 1.3,
  mieAsymmetry: 0.76,
  aerosolSingleScatteringAlbedo: 0.92,
  groundAlbedo: 0.2,
  ozoneDobsonUnits: 320,
  precipitableWaterCm: 2.1,
  multipleScatteringOrders: 4
};

test("transport state separates scattering and absorption", () => {
  const state = transportStateAtWavelength({
    wavelengthNm: 550,
    pressureRatio: 1,
    aerosolOpticalDepth550: 0.2,
    aerosolSingleScatteringAlbedo: 0.9,
    ozoneDobsonUnits: 320,
    precipitableWaterCm: 2
  });

  assert.ok(state.scatteringOpticalDepth > 0);
  assert.ok(state.absorptionOpticalDepth > 0);
  assert.ok(state.extinctionOpticalDepth > state.scatteringOpticalDepth);
  assert.ok(state.singleScatteringAlbedo > 0);
  assert.ok(state.singleScatteringAlbedo < 1);
  assert.ok(state.transportOpticalDepth <= state.scatteringOpticalDepth);
});

test("ground albedo increases the ground-bounce contribution", () => {
  const blackGround = computeMultipleScatteringSpectrum({
    ...daylightInput,
    sunZenithDeg: 35,
    groundAlbedo: 0
  });
  const brightGround = computeMultipleScatteringSpectrum({
    ...daylightInput,
    sunZenithDeg: 35,
    groundAlbedo: 0.8
  });

  assert.equal(blackGround.metrics.groundBounceBroadband, 0);
  assert.ok(
    brightGround.metrics.groundBounceBroadband >
    blackGround.metrics.groundBounceBroadband
  );
  assert.ok(
    brightGround.metrics.totalIndirectBroadband >
    blackGround.metrics.totalIndirectBroadband
  );
});

test("additional scattering orders add energy while remaining convergent", () => {
  const twoOrders = computeMultipleScatteringSpectrum({
    ...daylightInput,
    sunZenithDeg: 45,
    multipleScatteringOrders: 2
  });
  const sixOrders = computeMultipleScatteringSpectrum({
    ...daylightInput,
    sunZenithDeg: 45,
    multipleScatteringOrders: 6
  });

  assert.ok(
    sixOrders.metrics.totalIndirectBroadband >=
    twoOrders.metrics.totalIndirectBroadband
  );
  assert.equal(sixOrders.orderEnergy.length, 6);
  assert.ok(
    sixOrders.orderEnergy.at(-1).total <
    sixOrders.orderEnergy[0].total
  );
  assert.ok(sixOrders.metrics.lastOrderFraction < 0.2);
});

test("multiple scattering produces no daylight with sun below horizon", () => {
  const result = computeMultipleScatteringSpectrum({
    ...daylightInput,
    sunZenithDeg: 110,
    multipleScatteringOrders: 6
  });

  assert.equal(result.metrics.singleScatterSeedBroadband, 0);
  assert.equal(result.metrics.atmosphericMultipleBroadband, 0);
  assert.equal(result.metrics.groundBounceBroadband, 0);
  assert.equal(result.metrics.totalIndirectBroadband, 0);
});

test("phase 4 evaluation exposes multiple-scattering diagnostics", () => {
  const result = evaluateNaturalLight(daylightInput);

  assert.equal(result.model.id, "skyforge-natural-light-phase4");
  assert.equal(
    result.model.multipleScatteringModel.id,
    "skyforge-multiple-scattering-phase4"
  );
  assert.equal(result.multipleScattering.model.orders, 4);
  assert.ok(
    result.irradiance.diffuseHorizontalEstimatedWm2 >=
    result.irradiance.singleScatterDiffuseHorizontalEstimatedWm2
  );
  assert.ok(result.spectral.multipleScatteringAtmosphere.length === 41);
  assert.ok(result.spectral.groundBounce.length === 41);
  assert.ok(result.multipleScattering.metrics.lastOrderFraction >= 0);
});

test("phase 4 scene state persists solver quality and aerosol albedo", () => {
  const state = createNaturalLightSceneState({
    ...daylightInput,
    multipleScatteringOrders: 6,
    aerosolSingleScatteringAlbedo: 0.88
  });

  assert.equal(state.solver.id, "skyforge-natural-light-phase4");
  assert.equal(state.solver.multipleScatteringOrders, 6);
  assert.equal(state.atmosphere.aerosolSingleScatteringAlbedo, 0.88);

  const restored = naturalLightInputFromSceneState(state);
  assert.equal(restored.multipleScatteringOrders, 6);
  assert.equal(restored.aerosolSingleScatteringAlbedo, 0.88);
});

test("phase 4 Sky-View LUT contains indirect-light metadata", () => {
  const lut = generateSkyViewLut({
    input: daylightInput,
    lut: { width: 8, height: 4 }
  });

  assert.equal(lut.model.id, "skyforge-sky-view-lut-phase4");
  assert.equal(lut.model.multipleScatteringModel.orders, 4);
  assert.equal(lut.pixels.length, 8 * 4 * 3);
  assert.ok(lut.statistics.multipleToSingleRatio >= 0);
  assert.equal(lut.multipleScattering.orderEnergy.length, 4);
  assert.ok(
    lut.pixels.every((value) =>
      Number.isFinite(value) && value >= 0 && value <= 1
    )
  );
});

test("multiple-scattering LUT is deterministic and bounded", () => {
  const payload = {
    input: daylightInput,
    multipleScatteringLut: {
      width: 8,
      height: 4,
      maxAltitudeMeters: 20_000
    }
  };
  const first = generateMultipleScatteringLut(payload);
  const second = generateMultipleScatteringLut(payload);

  assert.equal(
    first.model.id,
    "skyforge-multiple-scattering-lut-phase4"
  );
  assert.equal(first.layout.width, 8);
  assert.equal(first.layout.height, 4);
  assert.equal(first.pixels.length, 8 * 4 * 4);
  assert.ok(first.statistics.maximumOrderResidual < 0.2);
  assert.ok(
    first.pixels.every((value) =>
      Number.isFinite(value) && value >= 0 && value <= 1
    )
  );
  assert.deepEqual(first.pixels, second.pixels);
});

test("multiple-scattering LUT dimensions are protected", () => {
  assert.throws(
    () => generateMultipleScatteringLut({
      input: daylightInput,
      multipleScatteringLut: { width: 1024, height: 512 }
    }),
    /multipleScatteringLut.width/
  );
});