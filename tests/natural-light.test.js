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
  ozoneVerticalOpticalDepth,
  oxygenVerticalOpticalDepth,
  waterVaporVerticalOpticalDepth,
  gasOpticalDepthComponents,
  directTransmittanceSpectrum,
  evaluateNaturalLight,
  normalizeNaturalLightInput,
  createNaturalLightSceneState,
  naturalLightInputFromSceneState,
  directionFromLutCoordinate,
  generateSkyViewLut,
  generateTransmittanceLut
} = require("../src/natural-light");

function spectralSample(spectrum, wavelengthNm) {
  return spectrum.reduce((nearest, sample) =>
    Math.abs(sample.wavelengthNm - wavelengthNm) <
    Math.abs(nearest.wavelengthNm - wavelengthNm)
      ? sample
      : nearest
  );
}

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
  assert.ok(rayleighOpticalDepth(450) > rayleighOpticalDepth(650));
});

test("gas absorption exposes expected visible spectral bands", () => {
  assert.ok(ozoneVerticalOpticalDepth(600, 300) > ozoneVerticalOpticalDepth(500, 300));
  assert.ok(oxygenVerticalOpticalDepth(760, 1) > oxygenVerticalOpticalDepth(650, 1));
  assert.ok(waterVaporVerticalOpticalDepth(720, 3) > waterVaporVerticalOpticalDepth(720, 0.5));

  const components = gasOpticalDepthComponents({
    wavelengthNm: 760,
    pressureRatio: 1,
    ozoneDobsonUnits: 300,
    precipitableWaterCm: 1.5
  });
  assert.ok(components.oxygen > 0);
  assert.equal(
    components.total,
    components.ozone + components.oxygen + components.waterVapor
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

  const cleanMean = clean.reduce((sum, sample) => sum + sample.transmittance, 0) / clean.length;
  const hazyMean = hazy.reduce((sum, sample) => sum + sample.transmittance, 0) / hazy.length;
  assert.ok(hazyMean < cleanMean);
});

test("ozone and water columns lower their corresponding spectral bands", () => {
  const dryLowOzone = directTransmittanceSpectrum({
    airMass: 2,
    ozoneDobsonUnits: 150,
    precipitableWaterCm: 0.2
  });
  const humidHighOzone = directTransmittanceSpectrum({
    airMass: 2,
    ozoneDobsonUnits: 600,
    precipitableWaterCm: 6
  });

  assert.ok(
    spectralSample(humidHighOzone, 600).transmittance <
    spectralSample(dryLowOzone, 600).transmittance
  );
  assert.ok(
    spectralSample(humidHighOzone, 720).transmittance <
    spectralSample(dryLowOzone, 720).transmittance
  );
  assert.ok(spectralSample(humidHighOzone, 760).oxygenOpticalDepth > 0);
});

test("natural-light evaluation returns finite multiple-scattering daylight outputs", () => {
  const result = evaluateNaturalLight({
    latitude: -8.8383,
    longitude: 13.2344,
    dateTime: "2026-07-09T15:00:00+01:00",
    altitudeMeters: 6,
    aerosolOpticalDepth550: 0.18,
    angstromExponent: 1.2,
    ozoneDobsonUnits: 310,
    precipitableWaterCm: 3.2
  });

  assert.equal(result.model.id, "skyforge-natural-light-phase4");
  assert.equal(result.model.gasAbsorptionModel.id, "skyforge-gas-absorption-phase3");
  assert.equal(result.model.multipleScatteringModel.id, "skyforge-multiple-scattering-phase4");
  assert.ok(result.irradiance.directNormalWm2 > 0);
  assert.ok(result.irradiance.globalHorizontalEstimatedWm2 > 0);
  assert.ok(result.irradiance.broadbandGasTransmittance > 0);
  assert.ok(result.irradiance.broadbandGasTransmittance <= 1);
  assert.ok(Number.isFinite(result.color.zenithSkyLinearSrgb.r));
  assert.equal(result.spectral.directSun.length, 41);
  assert.ok(result.spectral.transmittance.some((sample) => sample.totalGasOpticalDepth > 0));
  assert.equal(result.spectral.multipleScatteringAtmosphere.length, 41);
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
  assert.equal(input.precipitableWaterCm, 1.5);
  assert.equal(input.aerosolSingleScatteringAlbedo, 0.92);
  assert.equal(input.multipleScatteringOrders, 4);
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

  assert.throws(
    () => normalizeNaturalLightInput({
      latitude: 0,
      longitude: 0,
      dateTime: "2026-07-09T12:00:00Z",
      multipleScatteringOrders: 9
    }),
    /multipleScatteringOrders/
  );
});

test("natural-light scene state is persistence-safe and round-trips", () => {
  const state = createNaturalLightSceneState({
    latitude: -8.8383,
    longitude: 13.2344,
    dateTime: "2026-07-09T15:00:00+01:00",
    altitudeMeters: 6,
    aerosolOpticalDepth550: 0.18,
    groundAlbedo: 0.24,
    ozoneDobsonUnits: 325,
    precipitableWaterCm: 2.8,
    multipleScatteringOrders: 5
  });

  assert.equal(state.schema.id, "skyforge.natural-light");
  assert.equal(state.schema.version, 1);
  assert.equal(state.mode, "physical");
  assert.equal(state.solver.id, "skyforge-natural-light-phase4");
  assert.equal(state.solver.multipleScatteringOrders, 5);
  assert.equal(state.atmosphere.groundAlbedo, 0.24);
  assert.equal(state.atmosphere.ozoneDobsonUnits, 325);

  const restored = naturalLightInputFromSceneState(state);
  assert.equal(restored.latitude, -8.8383);
  assert.equal(restored.longitude, 13.2344);
  assert.equal(restored.aerosolOpticalDepth550, 0.18);
  assert.equal(restored.precipitableWaterCm, 2.8);
  assert.equal(restored.multipleScatteringOrders, 5);
});

test("sky-view LUT directions are unit vectors on the upper hemisphere", () => {
  const direction = directionFromLutCoordinate(3, 1, 8, 4);
  assert.ok(direction.y > 0);
  assert.ok(Math.abs(Math.hypot(direction.x, direction.y, direction.z) - 1) < 1e-12);
});

test("sky-view LUT returns finite deterministic multiple-scattering RGB pixels", () => {
  const payload = {
    input: {
      latitude: 48.8566,
      longitude: 2.3522,
      dateTime: "2026-07-09T14:00:00+02:00",
      altitudeMeters: 35,
      aerosolOpticalDepth550: 0.12,
      ozoneDobsonUnits: 320,
      precipitableWaterCm: 2.1
    },
    lut: { width: 8, height: 4 }
  };

  const first = generateSkyViewLut(payload);
  const second = generateSkyViewLut(payload);

  assert.equal(first.model.id, "skyforge-sky-view-lut-phase4");
  assert.equal(first.layout.width, 8);
  assert.equal(first.layout.height, 4);
  assert.equal(first.pixels.length, 8 * 4 * 3);
  assert.ok(first.pixels.every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
  assert.ok(first.statistics.maximumLuminance > 0);
  assert.ok(first.statistics.multipleToSingleRatio >= 0);
  assert.deepEqual(first.pixels, second.pixels);
});

test("transmittance LUT returns bounded RGB and broadband transport", () => {
  const lut = generateTransmittanceLut({
    input: {
      latitude: 48.8566,
      longitude: 2.3522,
      dateTime: "2026-07-09T14:00:00+02:00",
      aerosolOpticalDepth550: 0.12,
      ozoneDobsonUnits: 320,
      precipitableWaterCm: 2.1
    },
    transmittanceLut: {
      width: 8,
      height: 4,
      maxAltitudeMeters: 20_000
    }
  });

  assert.equal(lut.model.id, "skyforge-transmittance-lut-phase3");
  assert.equal(lut.layout.channels.length, 4);
  assert.equal(lut.pixels.length, 8 * 4 * 4);
  assert.ok(lut.pixels.every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
  assert.ok(lut.statistics.maximumBroadbandTransmittance <= 1);

  const topAtmosphereNearZenith = lut.pixels[3];
  const groundRowOffset = (3 * 8) * 4;
  const groundNearZenith = lut.pixels[groundRowOffset + 3];
  assert.ok(topAtmosphereNearZenith > groundNearZenith);
});

test("LUT generators enforce bounded dimensions", () => {
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

  assert.throws(
    () => generateTransmittanceLut({
      latitude: 0,
      longitude: 0,
      dateTime: "2026-03-20T12:00:00Z",
      width: 1024,
      height: 512
    }),
    /transmittanceLut.width/
  );
});