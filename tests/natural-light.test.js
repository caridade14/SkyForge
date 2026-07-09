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
  evaluateNaturalLight
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
