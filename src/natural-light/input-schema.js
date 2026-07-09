"use strict";

const NATURAL_LIGHT_SCHEMA_ID = "skyforge.natural-light";
const NATURAL_LIGHT_SCHEMA_VERSION = 1;

const DEFAULT_NATURAL_LIGHT_INPUT = Object.freeze({
  altitudeMeters: 0,
  pressureHpa: 1013.25,
  temperatureC: 15,
  aerosolOpticalDepth550: 0.1,
  angstromExponent: 1.3,
  mieAsymmetry: 0.76,
  groundAlbedo: 0.2,
  ozoneDobsonUnits: 300,
  precipitableWaterCm: 1.5
});

function finiteNumber(name, value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new RangeError(`${name} must be a finite number in [${min}, ${max}]`);
  }
  return number;
}

function parseIsoTimezoneOffsetMinutes(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/Z$/i.test(trimmed)) return 0;
  const match = trimmed.match(/([+-])(\d{2}):?(\d{2})$/);
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

function normalizeDateTime(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError("dateTime must be a valid Date or ISO-8601 string");
    }
    return value.toISOString();
  }

  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError("dateTime must be a valid Date or ISO-8601 string");
  }

  const trimmed = value.trim();
  if (Number.isNaN(new Date(trimmed).getTime())) {
    throw new TypeError("dateTime must be a valid Date or ISO-8601 string");
  }
  return trimmed;
}

function extractNaturalLightSource(payload = {}) {
  if (!payload || typeof payload !== "object") return {};
  return (
    payload.input ||
    payload.naturalLight ||
    payload.lighting?.naturalLight ||
    payload.scene?.lighting?.naturalLight ||
    payload
  );
}

function normalizeNaturalLightInput(payload = {}) {
  const source = extractNaturalLightSource(payload);
  const latitude = finiteNumber("latitude", source.latitude, -90, 90);
  const longitude = finiteNumber("longitude", source.longitude, -180, 180);
  const dateTime = normalizeDateTime(source.dateTime);

  const parsedOffset = parseIsoTimezoneOffsetMinutes(dateTime);
  const timezoneOffsetMinutes = source.timezoneOffsetMinutes === undefined || source.timezoneOffsetMinutes === null
    ? (parsedOffset ?? 0)
    : finiteNumber("timezoneOffsetMinutes", source.timezoneOffsetMinutes, -14 * 60, 14 * 60);

  return {
    latitude,
    longitude,
    dateTime,
    timezoneOffsetMinutes,
    altitudeMeters: finiteNumber(
      "altitudeMeters",
      source.altitudeMeters ?? DEFAULT_NATURAL_LIGHT_INPUT.altitudeMeters,
      -500,
      20_000
    ),
    pressureHpa: finiteNumber(
      "pressureHpa",
      source.pressureHpa ?? DEFAULT_NATURAL_LIGHT_INPUT.pressureHpa,
      100,
      1100
    ),
    temperatureC: finiteNumber(
      "temperatureC",
      source.temperatureC ?? DEFAULT_NATURAL_LIGHT_INPUT.temperatureC,
      -100,
      80
    ),
    aerosolOpticalDepth550: finiteNumber(
      "aerosolOpticalDepth550",
      source.aerosolOpticalDepth550 ?? DEFAULT_NATURAL_LIGHT_INPUT.aerosolOpticalDepth550,
      0,
      5
    ),
    angstromExponent: finiteNumber(
      "angstromExponent",
      source.angstromExponent ?? DEFAULT_NATURAL_LIGHT_INPUT.angstromExponent,
      0,
      4
    ),
    mieAsymmetry: finiteNumber(
      "mieAsymmetry",
      source.mieAsymmetry ?? DEFAULT_NATURAL_LIGHT_INPUT.mieAsymmetry,
      -0.99,
      0.99
    ),
    groundAlbedo: finiteNumber(
      "groundAlbedo",
      source.groundAlbedo ?? DEFAULT_NATURAL_LIGHT_INPUT.groundAlbedo,
      0,
      1
    ),
    ozoneDobsonUnits: finiteNumber(
      "ozoneDobsonUnits",
      source.ozoneDobsonUnits ?? DEFAULT_NATURAL_LIGHT_INPUT.ozoneDobsonUnits,
      100,
      700
    ),
    precipitableWaterCm: finiteNumber(
      "precipitableWaterCm",
      source.precipitableWaterCm ?? DEFAULT_NATURAL_LIGHT_INPUT.precipitableWaterCm,
      0,
      12
    )
  };
}

function createNaturalLightSceneState(payload = {}) {
  const input = normalizeNaturalLightInput(payload);
  return {
    schema: {
      id: NATURAL_LIGHT_SCHEMA_ID,
      version: NATURAL_LIGHT_SCHEMA_VERSION
    },
    mode: "physical",
    solver: {
      id: "skyforge-natural-light-phase3",
      version: "0.3.0",
      scattering: "single-with-band-gas-absorption",
      gasAbsorption: "ozone-oxygen-water-band-model",
      spectralRangeNm: [380, 780],
      spectralStepNm: 10
    },
    location: {
      latitude: input.latitude,
      longitude: input.longitude,
      altitudeMeters: input.altitudeMeters
    },
    time: {
      dateTime: input.dateTime,
      timezoneOffsetMinutes: input.timezoneOffsetMinutes
    },
    atmosphere: {
      pressureHpa: input.pressureHpa,
      temperatureC: input.temperatureC,
      aerosolOpticalDepth550: input.aerosolOpticalDepth550,
      angstromExponent: input.angstromExponent,
      mieAsymmetry: input.mieAsymmetry,
      groundAlbedo: input.groundAlbedo,
      ozoneDobsonUnits: input.ozoneDobsonUnits,
      precipitableWaterCm: input.precipitableWaterCm
    }
  };
}

function naturalLightInputFromSceneState(sceneState = {}) {
  const source = sceneState.lighting?.naturalLight || sceneState.naturalLight || sceneState;
  if (source.location && source.time && source.atmosphere) {
    return normalizeNaturalLightInput({
      ...source.location,
      ...source.time,
      ...source.atmosphere
    });
  }
  return normalizeNaturalLightInput(source);
}

module.exports = {
  NATURAL_LIGHT_SCHEMA_ID,
  NATURAL_LIGHT_SCHEMA_VERSION,
  DEFAULT_NATURAL_LIGHT_INPUT,
  extractNaturalLightSource,
  normalizeNaturalLightInput,
  createNaturalLightSceneState,
  naturalLightInputFromSceneState
};