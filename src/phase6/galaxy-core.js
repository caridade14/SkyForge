"use strict";

const GALAXY_SCHEMA_ID = "skyforge.galaxy";
const GALAXY_SCHEMA_VERSION = 1;
const GALAXY_ENGINE_VERSION = "0.6.0";

const DEFAULT_GALAXY = Object.freeze({
  enabled: true,
  type: "spiral",
  seed: 8347,
  starDensity: 0.72,
  armCount: 4,
  armTwist: 3.6,
  radius: 1,
  thickness: 0.22,
  coreSize: 0.24,
  coreIntensity: 1.25,
  dust: 0.48,
  nebula: 0.42,
  temperature: 6200,
  rotation: 0,
  inclination: 0.28,
  blackHole: 0,
  lensing: 0,
  animate: true,
  animationSpeed: 0.018
});

function finite(name, value, min, max, fallback) {
  const number = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new RangeError(`${name} must be a finite number in [${min}, ${max}]`);
  }
  return number;
}

function integer(name, value, min, max, fallback) {
  const number = finite(name, value, min, max, fallback);
  if (!Number.isInteger(number)) throw new RangeError(`${name} must be an integer in [${min}, ${max}]`);
  return number;
}

function sourceFromPayload(payload = {}) {
  if (!payload || typeof payload !== "object") return {};
  return payload.galaxy || payload.scene?.galaxy || payload.rendering?.phase6?.galaxy || payload;
}

function normalizeGalaxy(payload = {}) {
  const source = sourceFromPayload(payload);
  const type = ["spiral", "barred", "elliptical", "irregular", "ring"].includes(source.type)
    ? source.type
    : DEFAULT_GALAXY.type;
  return {
    enabled: source.enabled !== false,
    type,
    seed: integer("seed", source.seed, 0, 999999, DEFAULT_GALAXY.seed),
    starDensity: finite("starDensity", source.starDensity, 0, 1.5, DEFAULT_GALAXY.starDensity),
    armCount: integer("armCount", source.armCount, 1, 8, DEFAULT_GALAXY.armCount),
    armTwist: finite("armTwist", source.armTwist, 0.2, 8, DEFAULT_GALAXY.armTwist),
    radius: finite("radius", source.radius, 0.2, 2.5, DEFAULT_GALAXY.radius),
    thickness: finite("thickness", source.thickness, 0.03, 0.8, DEFAULT_GALAXY.thickness),
    coreSize: finite("coreSize", source.coreSize, 0.03, 0.8, DEFAULT_GALAXY.coreSize),
    coreIntensity: finite("coreIntensity", source.coreIntensity, 0, 4, DEFAULT_GALAXY.coreIntensity),
    dust: finite("dust", source.dust, 0, 1.5, DEFAULT_GALAXY.dust),
    nebula: finite("nebula", source.nebula, 0, 1.5, DEFAULT_GALAXY.nebula),
    temperature: finite("temperature", source.temperature, 1800, 18000, DEFAULT_GALAXY.temperature),
    rotation: finite("rotation", source.rotation, -Math.PI * 8, Math.PI * 8, DEFAULT_GALAXY.rotation),
    inclination: finite("inclination", source.inclination, -1.45, 1.45, DEFAULT_GALAXY.inclination),
    blackHole: finite("blackHole", source.blackHole, 0, 1, DEFAULT_GALAXY.blackHole),
    lensing: finite("lensing", source.lensing, 0, 1, DEFAULT_GALAXY.lensing),
    animate: source.animate !== false,
    animationSpeed: finite("animationSpeed", source.animationSpeed, 0, 0.2, DEFAULT_GALAXY.animationSpeed)
  };
}

function seededRandom(seed) {
  let state = (Number(seed) >>> 0) || 1;
  return function random() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function estimateGalaxy(galaxyInput = {}) {
  const galaxy = normalizeGalaxy(galaxyInput);
  const random = seededRandom(galaxy.seed);
  const morphologyFactor = {
    spiral: 1,
    barred: 1.08,
    elliptical: 0.82,
    irregular: 0.58,
    ring: 0.66
  }[galaxy.type];
  const referenceStars = 100_000_000_000;
  const estimatedStarCount = Math.round(
    referenceStars * galaxy.starDensity * Math.pow(galaxy.radius, 2.15) * Math.max(galaxy.thickness, 0.08) * 4.2 * morphologyFactor
  );
  const diameterLightYears = Math.round(100_000 * galaxy.radius);
  const thicknessLightYears = Math.round(4_000 * galaxy.thickness / 0.22);
  const coreLuminosityRelative = Number((galaxy.coreIntensity * Math.pow(galaxy.coreSize / 0.24, 1.4)).toFixed(3));
  const dustOpacityRelative = Number((galaxy.dust * (0.75 + random() * 0.5)).toFixed(3));
  const nebulaEmissionRelative = Number((galaxy.nebula * galaxy.starDensity * (0.85 + random() * 0.3)).toFixed(3));
  const gpuComplexity = Math.round(
    28 + galaxy.starDensity * 38 + galaxy.nebula * 18 + galaxy.dust * 14 + galaxy.lensing * 22 + (galaxy.animate ? 6 : 0)
  );
  return {
    schema: { id: GALAXY_SCHEMA_ID, version: GALAXY_SCHEMA_VERSION },
    engine: { id: "skyforge-galaxy-phase6", version: GALAXY_ENGINE_VERSION },
    galaxy,
    estimates: {
      estimatedStarCount,
      diameterLightYears,
      thicknessLightYears,
      coreLuminosityRelative,
      dustOpacityRelative,
      nebulaEmissionRelative,
      gpuComplexityScore: Math.min(100, gpuComplexity)
    },
    renderer: {
      preferredBackend: "WebGPU",
      fallbackBackend: "WebGL2",
      representation: "procedural-fragment-field",
      colorManagement: "scene-linear to ACES fitted",
      animation: galaxy.animate ? "gpu-time-driven" : "static"
    }
  };
}

function createGalaxySceneState(payload = {}) {
  const result = estimateGalaxy(payload);
  return {
    schema: result.schema,
    mode: "procedural-gpu",
    engine: result.engine,
    galaxy: result.galaxy,
    estimates: result.estimates
  };
}

module.exports = {
  GALAXY_SCHEMA_ID,
  GALAXY_SCHEMA_VERSION,
  GALAXY_ENGINE_VERSION,
  DEFAULT_GALAXY,
  sourceFromPayload,
  normalizeGalaxy,
  seededRandom,
  estimateGalaxy,
  createGalaxySceneState
};
