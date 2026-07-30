"use strict";

const DEFAULT_PHYSICAL_CAMERA = Object.freeze({
  apertureFNumber: 8,
  shutterSeconds: 1 / 125,
  iso: 100,
  exposureCompensationEv: 0,
  ndFilterStops: 0,
  whiteBalanceKelvin: 5600,
  autoExposure: true,
  middleGray: 0.18,
  minExposureEv: -16,
  maxExposureEv: 20,
  adaptationSpeedUp: 3,
  adaptationSpeedDown: 1.5
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

function normalizePhysicalCamera(payload = {}) {
  const source = payload.camera || payload;
  return {
    apertureFNumber: finiteNumber(
      "camera.apertureFNumber",
      source.apertureFNumber ?? source.aperture ?? DEFAULT_PHYSICAL_CAMERA.apertureFNumber,
      0.5,
      64
    ),
    shutterSeconds: finiteNumber(
      "camera.shutterSeconds",
      source.shutterSeconds ?? source.shutter ?? DEFAULT_PHYSICAL_CAMERA.shutterSeconds,
      1 / 32000,
      60
    ),
    iso: finiteNumber("camera.iso", source.iso ?? DEFAULT_PHYSICAL_CAMERA.iso, 25, 204800),
    exposureCompensationEv: finiteNumber(
      "camera.exposureCompensationEv",
      source.exposureCompensationEv ?? source.exposureCompensation ?? DEFAULT_PHYSICAL_CAMERA.exposureCompensationEv,
      -16,
      16
    ),
    ndFilterStops: finiteNumber(
      "camera.ndFilterStops",
      source.ndFilterStops ?? DEFAULT_PHYSICAL_CAMERA.ndFilterStops,
      0,
      20
    ),
    whiteBalanceKelvin: finiteNumber(
      "camera.whiteBalanceKelvin",
      source.whiteBalanceKelvin ?? source.whiteBalance ?? DEFAULT_PHYSICAL_CAMERA.whiteBalanceKelvin,
      1000,
      40000
    ),
    autoExposure: source.autoExposure === undefined
      ? DEFAULT_PHYSICAL_CAMERA.autoExposure
      : Boolean(source.autoExposure),
    middleGray: finiteNumber(
      "camera.middleGray",
      source.middleGray ?? DEFAULT_PHYSICAL_CAMERA.middleGray,
      0.01,
      1
    ),
    minExposureEv: finiteNumber(
      "camera.minExposureEv",
      source.minExposureEv ?? DEFAULT_PHYSICAL_CAMERA.minExposureEv,
      -32,
      32
    ),
    maxExposureEv: finiteNumber(
      "camera.maxExposureEv",
      source.maxExposureEv ?? DEFAULT_PHYSICAL_CAMERA.maxExposureEv,
      -32,
      32
    ),
    adaptationSpeedUp: finiteNumber(
      "camera.adaptationSpeedUp",
      source.adaptationSpeedUp ?? DEFAULT_PHYSICAL_CAMERA.adaptationSpeedUp,
      0.01,
      30
    ),
    adaptationSpeedDown: finiteNumber(
      "camera.adaptationSpeedDown",
      source.adaptationSpeedDown ?? DEFAULT_PHYSICAL_CAMERA.adaptationSpeedDown,
      0.01,
      30
    )
  };
}

function calculateEv100(cameraInput = {}) {
  const camera = normalizePhysicalCamera(cameraInput);
  return Math.log2((camera.apertureFNumber ** 2) / camera.shutterSeconds);
}

function calculateSceneEv(cameraInput = {}) {
  const camera = normalizePhysicalCamera(cameraInput);
  return calculateEv100(camera) - Math.log2(camera.iso / 100) + camera.ndFilterStops;
}

function cameraExposureMultiplier(cameraInput = {}) {
  const camera = normalizePhysicalCamera(cameraInput);
  const sceneEv = calculateSceneEv(camera);
  return Math.pow(2, camera.exposureCompensationEv - sceneEv);
}

function targetAutoExposureEv(logAverageLuminance, cameraInput = {}) {
  const camera = normalizePhysicalCamera(cameraInput);
  const luminance = Math.max(1e-6, Number(logAverageLuminance) || 1e-6);
  const targetEv = Math.log2(luminance / camera.middleGray) - camera.exposureCompensationEv;
  return clamp(targetEv, camera.minExposureEv, camera.maxExposureEv);
}

function exposureMultiplierFromEv(exposureEv) {
  return Math.pow(2, -Number(exposureEv || 0));
}

function adaptExposureEv(currentEv, targetEv, deltaSeconds, cameraInput = {}) {
  const camera = normalizePhysicalCamera(cameraInput);
  const current = Number.isFinite(Number(currentEv)) ? Number(currentEv) : Number(targetEv) || 0;
  const target = Number(targetEv) || 0;
  const delta = clamp(Number(deltaSeconds) || 0, 0, 1);
  const speed = target < current ? camera.adaptationSpeedUp : camera.adaptationSpeedDown;
  const factor = 1 - Math.exp(-speed * delta);
  return current + (target - current) * factor;
}

function correlatedColorTemperatureRgb(kelvin) {
  const temperature = clamp(Number(kelvin) || 6500, 1000, 40000) / 100;
  let red;
  let green;
  let blue;

  if (temperature <= 66) {
    red = 255;
    green = 99.4708025861 * Math.log(temperature) - 161.1195681661;
    blue = temperature <= 19
      ? 0
      : 138.5177312231 * Math.log(temperature - 10) - 305.0447927307;
  } else {
    red = 329.698727446 * Math.pow(temperature - 60, -0.1332047592);
    green = 288.1221695283 * Math.pow(temperature - 60, -0.0755148492);
    blue = 255;
  }

  return {
    r: clamp(red / 255, 0, 1),
    g: clamp(green / 255, 0, 1),
    b: clamp(blue / 255, 0, 1)
  };
}

function whiteBalanceMultipliers(kelvin) {
  const reference = correlatedColorTemperatureRgb(6500);
  const target = correlatedColorTemperatureRgb(kelvin);
  const multipliers = {
    r: reference.r / Math.max(target.r, 1e-6),
    g: reference.g / Math.max(target.g, 1e-6),
    b: reference.b / Math.max(target.b, 1e-6)
  };
  const normalization = Math.max(multipliers.r, multipliers.g, multipliers.b, 1e-6);
  return {
    r: multipliers.r / normalization,
    g: multipliers.g / normalization,
    b: multipliers.b / normalization
  };
}

module.exports = {
  DEFAULT_PHYSICAL_CAMERA,
  normalizePhysicalCamera,
  calculateEv100,
  calculateSceneEv,
  cameraExposureMultiplier,
  targetAutoExposureEv,
  exposureMultiplierFromEv,
  adaptExposureEv,
  correlatedColorTemperatureRgb,
  whiteBalanceMultipliers
};
