"use strict";

const {
  normalizePhysicalCamera,
  calculateEv100,
  calculateSceneEv,
  cameraExposureMultiplier,
  targetAutoExposureEv,
  exposureMultiplierFromEv,
  whiteBalanceMultipliers
} = require("./physical-camera");
const { normalizeVolumetricClouds } = require("./cloud-core");

const PHASE5_RENDERER_ID = "skyforge-natural-light-phase5";
const PHASE5_RENDERER_VERSION = "0.5.0";

const DEFAULT_RENDER_QUALITY = Object.freeze({
  preset: "production",
  hdrTarget: "rgba16f",
  atmosphereLutResolution: {
    transmittance: [256, 64],
    multipleScattering: [32, 32],
    skyView: [192, 108],
    aerialPerspective: [32, 32, 32]
  },
  cloudRaySteps: 72,
  cloudLightSteps: 8,
  temporalReprojection: true,
  temporalBlend: 0.92,
  shadowMapResolution: 2048,
  environmentCubeResolution: 256,
  irradianceCubeResolution: 32,
  specularPrefilterMipCount: 8
});

const QUALITY_PRESETS = Object.freeze({
  realtime: {
    preset: "realtime",
    atmosphereLutResolution: {
      transmittance: [128, 32],
      multipleScattering: [16, 16],
      skyView: [96, 54],
      aerialPerspective: [16, 16, 16]
    },
    cloudRaySteps: 36,
    cloudLightSteps: 4,
    temporalBlend: 0.94,
    shadowMapResolution: 1024,
    environmentCubeResolution: 128,
    irradianceCubeResolution: 16,
    specularPrefilterMipCount: 7
  },
  production: DEFAULT_RENDER_QUALITY,
  reference: {
    preset: "reference",
    atmosphereLutResolution: {
      transmittance: [512, 128],
      multipleScattering: [64, 64],
      skyView: [384, 216],
      aerialPerspective: [64, 64, 64]
    },
    cloudRaySteps: 144,
    cloudLightSteps: 16,
    temporalBlend: 0.88,
    shadowMapResolution: 4096,
    environmentCubeResolution: 512,
    irradianceCubeResolution: 64,
    specularPrefilterMipCount: 9
  }
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeQuality(payload = {}) {
  const source = payload.render || payload.quality || payload;
  const presetName = String(source.preset || source.qualityPreset || "production").toLowerCase();
  const preset = QUALITY_PRESETS[presetName] || QUALITY_PRESETS.production;
  return {
    ...DEFAULT_RENDER_QUALITY,
    ...preset,
    ...source,
    preset: QUALITY_PRESETS[presetName] ? presetName : "production",
    hdrTarget: "rgba16f",
    cloudRaySteps: Math.round(clamp(finiteOr(source.cloudRaySteps, preset.cloudRaySteps), 8, 256)),
    cloudLightSteps: Math.round(clamp(finiteOr(source.cloudLightSteps, preset.cloudLightSteps), 1, 64)),
    temporalReprojection: source.temporalReprojection === undefined
      ? true
      : Boolean(source.temporalReprojection),
    temporalBlend: clamp(finiteOr(source.temporalBlend, preset.temporalBlend), 0, 0.999),
    shadowMapResolution: Math.round(clamp(
      finiteOr(source.shadowMapResolution, preset.shadowMapResolution),
      256,
      8192
    )),
    environmentCubeResolution: Math.round(clamp(
      finiteOr(source.environmentCubeResolution, preset.environmentCubeResolution),
      32,
      2048
    )),
    irradianceCubeResolution: Math.round(clamp(
      finiteOr(source.irradianceCubeResolution, preset.irradianceCubeResolution),
      8,
      256
    )),
    specularPrefilterMipCount: Math.round(clamp(
      finiteOr(source.specularPrefilterMipCount, preset.specularPrefilterMipCount),
      1,
      12
    ))
  };
}

function estimateSceneLuminance(evaluation = {}) {
  const direct = Math.max(0, finiteOr(evaluation.irradiance?.directNormalWm2, 0));
  const diffuse = Math.max(0, finiteOr(evaluation.irradiance?.diffuseHorizontalEstimatedWm2, 0));
  const global = Math.max(0, finiteOr(evaluation.irradiance?.globalHorizontalEstimatedWm2, direct + diffuse));
  const sky = Math.max(0, finiteOr(evaluation.color?.zenithSkyXyz?.Y, 0));
  return Math.max(1e-4, global * 0.0018 + sky * 0.08);
}

function createPhase5RenderState(payload = {}, evaluation = {}) {
  const camera = normalizePhysicalCamera(payload.camera || payload.render?.camera || {});
  const clouds = normalizeVolumetricClouds(payload.clouds || payload.render?.clouds || {});
  const quality = normalizeQuality(payload.render || payload.quality || {});
  const sceneLuminance = estimateSceneLuminance(evaluation);
  const physicalEv100 = calculateEv100(camera);
  const sceneEv = calculateSceneEv(camera);
  const autoExposureEv = targetAutoExposureEv(sceneLuminance, camera);
  const selectedExposureEv = camera.autoExposure ? autoExposureEv : sceneEv;
  const exposureMultiplier = camera.autoExposure
    ? exposureMultiplierFromEv(selectedExposureEv)
    : cameraExposureMultiplier(camera);
  const sunElevation = finiteOr(evaluation.solarPosition?.apparentElevationDeg, -90);
  const sunIlluminanceLux = Math.max(0, finiteOr(evaluation.irradiance?.directNormalWm2, 0) * 93);

  return {
    renderer: {
      id: PHASE5_RENDERER_ID,
      version: PHASE5_RENDERER_VERSION,
      backendPreference: ["webgpu", "webgl2", "canvas2d-reference"],
      activeReferenceBackend: "canvas2d-reference",
      finalRendererBridge: "cycles-standalone-planned"
    },
    colorManagement: {
      workingSpace: "ACEScg",
      transfer: "scene-linear",
      display: "sRGB",
      toneMapper: "ACES-fitted",
      gamutCompression: "soft-threshold",
      hdrTarget: quality.hdrTarget,
      exportFormats: ["OpenEXR-half", "OpenEXR-float"]
    },
    camera: {
      ...camera,
      physicalEv100,
      sceneEv,
      estimatedLogAverageLuminance: sceneLuminance,
      targetExposureEv: selectedExposureEv,
      exposureMultiplier,
      whiteBalanceMultipliers: whiteBalanceMultipliers(camera.whiteBalanceKelvin)
    },
    sun: {
      angularRadiusRadians: 0.00465,
      angularDiameterDeg: 0.533,
      direction: evaluation.solarPosition?.sunDirection || { x: 0, y: -1, z: 0 },
      apparentElevationDeg: sunElevation,
      azimuthDeg: finiteOr(evaluation.solarPosition?.azimuthDeg, 0),
      illuminanceLux: sunElevation > 0 ? sunIlluminanceLux : 0,
      sourceType: "finite-angular-disc"
    },
    atmosphere: {
      model: "spectral-rayleigh-mie-ozone-multiple-scattering",
      luts: {
        transmittance: quality.atmosphereLutResolution.transmittance,
        multipleScattering: quality.atmosphereLutResolution.multipleScattering,
        skyView: quality.atmosphereLutResolution.skyView,
        aerialPerspective: quality.atmosphereLutResolution.aerialPerspective
      },
      aerialPerspective: {
        enabled: true,
        equation: "surface*transmittance+inscatter"
      }
    },
    clouds: {
      ...clouds,
      raySteps: quality.cloudRaySteps,
      lightSteps: quality.cloudLightSteps,
      temporalReprojection: quality.temporalReprojection,
      temporalBlend: quality.temporalBlend,
      extinctionLaw: "Beer-Lambert",
      phaseFunction: "Henyey-Greenstein",
      densityField: "weather-map-perlin-worley-reference"
    },
    pbr: {
      brdf: "Cook-Torrance-GGX",
      fresnel: "Schlick",
      geometry: "Smith-correlated",
      workflow: "metallic-roughness",
      energyConservation: true,
      environmentLighting: {
        diffuseIrradiance: true,
        specularPrefilter: true,
        brdfLut: true,
        environmentCubeResolution: quality.environmentCubeResolution,
        irradianceCubeResolution: quality.irradianceCubeResolution,
        specularPrefilterMipCount: quality.specularPrefilterMipCount
      }
    },
    shadows: {
      solarDiscSoftness: true,
      cloudShadows: clouds.enabled,
      mapResolution: quality.shadowMapResolution,
      cascades: quality.preset === "realtime" ? 3 : 4
    },
    globalIllumination: {
      preview: ["sky-irradiance", "reflection-probes", "screen-space-gi", "ground-bounce"],
      final: "path-traced-cycles"
    },
    quality
  };
}

module.exports = {
  PHASE5_RENDERER_ID,
  PHASE5_RENDERER_VERSION,
  DEFAULT_RENDER_QUALITY,
  QUALITY_PRESETS,
  normalizeQuality,
  estimateSceneLuminance,
  createPhase5RenderState
};
