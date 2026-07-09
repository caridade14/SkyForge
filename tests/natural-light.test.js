/**
 * Run with:
 *   node --test tests/natural-light.test.js
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  calculateSolarPosition,
  relativeAirMass,
  rayleighOpticalDepth,
  directTransmittanceSpectrum,
  evaluateNaturalLight,
  normalizeNaturalLightInput,
  createNaturalLightSceneState,
  naturalLightInputFromSceneState,
  directionFromLutCoordinate,
  generateSkyViewLut
} = require("../src/natural-light");

test("equinox sun is nearly overhead at the equator around solar noon", () => {
  const result = calculateSolarPosition({
    latitude: 0,
    longitude: 0,
    dateTime: "2026-03-20T12:07:00Z",
    timezoneOffsetMinutes: 0
  });

  assert.ok(
    result.apparentElevationDeg > 88,
    `expected > 88°, got ${result.apparentElevationDeg}`
  );
  assert.equal(result.isAboveHorizon, true);
});

test("sun is below the horizon near equatorial midnight", () => {
  const result = calculateSolarPosition({
    latitude: 0,
    longitude: 0,
    dateTime: "2026-03-20T00:00:00Z",
    timezoneOffsetMinutes: 0
  });

  assert.ok(result.apparentElevationDeg < -80);
  assert.equal(result.isAboveHorizon, false);
});

test("solar azimuth is normalized and direction is unit length", () => {
  const result = calculateSolarPosition({
    latitude: 48.8566,
    longitude: 2.3522,
    dateTime: "2026-07-09T14:00:00+02:00"
  });

  assert.ok(result.azimuthDeg >= 0 && result.azimuthDeg < 360);
  const directionLength = Math.hypot(
    result.sunDirection.x,
    result.sunDirection.y,
    result.sunDirection.z
  );
  assert.ok(Math.abs(directionLength - 1) < 1e-12);
});

test("air mass grows toward the horizon", () => {
  assert.ok(relativeAirMass(80) > relativeAirMass(30));
  assert.equal(relativeAirMass(90), Infinity);
});

test("Rayleigh extinction is stronger in blue wavelengths", () => {
  assert.ok(
    rayleighOpticalDepth(450) > rayleighOpticalDepth(650)
  );
});

test("aerosol loading lowers direct spectral transmittance", () => {
  const clean = directTransmittanceSpectrum({
    airMass: 2,
    aerosolOpticalDepth550: 0.05
  });
  const hazy = directTransmittanceSpectrum({
    airMass: 2,
    aerosolOpticalDepth550: 0.45
  });

  const cleanMean =
    clean.reduce((sum, sample) => sum + sample.transmittance, 0) /
    clean.length;
  const hazyMean =
    hazy.reduce((sum, sample) => sum + sample.transmittance, 0) /
    hazy.length;

  assert.ok(hazyMean < cleanMean);
});

test("natural-light evaluation returns finite daylight outputs", () => {
  const result = evaluateNaturalLight({
    latitude: -8.8383,
    longitude: 13.2344,
    dateTime: "2026-07-09T15:00:00+01:00",
    altitudeMeters: 6,
    aerosolOpticalDepth550: 0.18,
    angstromExponent: 1.2
  });

  assert.equal(result.model.id, "skyforge-natural-light-phase1");
  assert.ok(result.irradiance.directNormalWm2 > 0);
  assert.ok(result.irradiance.globalHorizontalEstimatedWm2 > 0);
  assert.ok(
    Number.isFinite(result.color.zenithSkyLinearSrgb.r)
  );
  assert.equal(result.spectral.directSun.length, 41);
});

test("natural-light input normalization accepts nested API payloads", () => {
  const input = normalizeNaturalLightInput({
    input: {
      latitude: 48.8566,
      longitude: 2.3522,
      dateTime: "2026-07-09T14:00:00+02:00",
      altitudeMeters: 35
    }
  });

  assert.equal(input.latitude, 48.8566);
  assert.equal(input.longitude, 2.3522);
  assert.equal(input.timezoneOffsetMinutes, 120);
  assert.equal(input.altitudeMeters, 35);
  assert.equal(input.aerosolOpticalDepth550, 0.1);
  assert.equal(input.ozoneDobsonUnits, 300);
});

test("natural-light input normalization rejects invalid physical values", () => {
  assert.throws(
    () => normalizeNaturalLightInput({
      latitude: 95,
      longitude: 0,
      dateTime: "2026-07-09T12:00:00Z"
    }),
    /latitude/
  );

  assert.throws(
    () => normalizeNaturalLightInput({
      latitude: 0,
      longitude: 0,
      dateTime: "not-a-date"
    }),
    /dateTime/
  );
});

test("natural-light scene state is persistence-safe and round-trips", () => {
  const state = createNaturalLightSceneState({
    latitude: -8.8383,
    longitude: 13.2344,
    dateTime: "2026-07-09T15:00:00+01:00",
    altitudeMeters: 6,
    aerosolOpticalDepth550: 0.18,
    groundAlbedo: 0.24
  });

  assert.equal(state.schema.id, "skyforge.natural-light");
  assert.equal(state.schema.version, 1);
  assert.equal(state.mode, "physical");
  assert.equal(state.atmosphere.groundAlbedo, 0.24);

  const restored = naturalLightInputFromSceneState(state);
  assert.equal(restored.latitude, -8.8383);
  assert.equal(restored.longitude, 13.2344);
  assert.equal(restored.aerosolOpticalDepth550, 0.18);
});

test("sky-view LUT directions are unit vectors on the upper hemisphere", () => {
  const direction = directionFromLutCoordinate(3, 1, 8, 4);
  assert.ok(direction.y > 0);
  assert.ok(Math.abs(Math.hypot(direction.x, direction.y, direction.z) - 1) < 1e-12);
});

test("sky-view LUT returns finite deterministic linear RGB pixels", () => {
  const payload = {
    input: {
      latitude: 48.8566,
      longitude: 2.3522,
      dateTime: "2026-07-09T14:00:00+02:00",
      altitudeMeters: 35,
      aerosolOpticalDepth550: 0.12
    },
    lut: { width: 8, height: 4 }
  };

  const first = generateSkyViewLut(payload);
  const second = generateSkyViewLut(payload);

  assert.equal(first.model.id, "skyforge-sky-view-lut-phase2");
  assert.equal(first.layout.width, 8);
  assert.equal(first.layout.height, 4);
  assert.equal(first.pixels.length, 8 * 4 * 3);
  assert.ok(first.pixels.every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
  assert.ok(first.statistics.maximumLuminance > 0);
  assert.deepEqual(first.pixels, second.pixels);
});

test("sky-view LUT enforces bounded dimensions", () => {
  assert.throws(
    () => generateSkyViewLut({
      latitude: 0,
      longitude: 0,
      dateTime: "2026-03-20T12:00:00Z",
      width: 2048,
      height: 1024
    }),
    /lut.width/
  );
});