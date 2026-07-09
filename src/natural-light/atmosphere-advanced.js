"use strict";

const {
  calculateSolarPosition,
  absoluteAirMass,
  pressureRatioAtAltitude,
  extraterrestrialNormalIrradiance
} = require("./solar-core");
const base = require("./atmosphere-core");
const {
  GAS_ABSORPTION_MODEL_ID,
  GAS_ABSORPTION_VERSION,
  gasOpticalDepthComponents
} = require("./gas-absorption-core");

const NATURAL_LIGHT_MODEL_ID = "skyforge-natural-light-phase3";
const NATURAL_LIGHT_MODEL_VERSION = "0.3.0";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeVector(vector) {
  const x = Number(vector?.x) || 0;
  const y = Number(vector?.y) || 0;
  const z = Number(vector?.z) || 0;
  const length = Math.hypot(x, y, z);
  if (length < 1e-12) throw new RangeError("direction vector must not be zero");
  return { x: x / length, y: y / length, z: z / length };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
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

function chromaticityFromXyz(xyz) {
  const sum = xyz.X + xyz.Y + xyz.Z;
  if (sum <= 0) return { x: 0, y: 0 };
  return { x: xyz.X / sum, y: xyz.Y / sum };
}

function correlatedColorTemperatureFromXy(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || y === 0.1858) return null;
  const n = (x - 0.3320) / (0.1858 - y);
  const cct = 449 * n ** 3 + 3525 * n ** 2 + 6823.3 * n + 5520.33;
  return Number.isFinite(cct) ? clamp(cct, 1000, 40_000) : null;
}

function directTransmittanceSpectrum(input = {}) {
  const wavelengthsNm = input.wavelengthsNm || base.DEFAULT_WAVELENGTHS_NM;
  const airMass = Number(input.airMass);

  if (!Number.isFinite(airMass) || airMass < 0) {
    return wavelengthsNm.map((wavelengthNm) => ({
      wavelengthNm,
      rayleighOpticalDepth: Infinity,
      aerosolOpticalDepth: Infinity,
      ozoneOpticalDepth: Infinity,
      oxygenOpticalDepth: Infinity,
      waterVaporOpticalDepth: Infinity,
      totalGasOpticalDepth: Infinity,
      totalOpticalDepth: Infinity,
      transmittance: 0
    }));
  }

  const pressureRatio = input.pressureRatio ?? 1;
  const aerosolOpticalDepth550 = input.aerosolOpticalDepth550 ?? 0.1;
  const angstromExponent = input.angstromExponent ?? 1.3;
  const ozoneDobsonUnits = input.ozoneDobsonUnits ?? 300;
  const precipitableWaterCm = input.precipitableWaterCm ?? 1.5;
  const effectiveAirMass = clamp(airMass, 0, 40);

  return wavelengthsNm.map((wavelengthNm) => {
    const tauRayleigh = base.rayleighOpticalDepth(wavelengthNm, pressureRatio);
    const tauAerosol = base.aerosolOpticalDepth(
      wavelengthNm,
      aerosolOpticalDepth550,
      angstromExponent
    );
    const gas = gasOpticalDepthComponents({
      wavelengthNm,
      pressureRatio,
      ozoneDobsonUnits,
      precipitableWaterCm
    });
    const totalOpticalDepth = tauRayleigh + tauAerosol + gas.total;

    return {
      wavelengthNm,
      rayleighOpticalDepth: tauRayleigh,
      aerosolOpticalDepth: tauAerosol,
      ozoneOpticalDepth: gas.ozone,
      oxygenOpticalDepth: gas.oxygen,
      waterVaporOpticalDepth: gas.waterVapor,
      totalGasOpticalDepth: gas.total,
      totalOpticalDepth,
      transmittance: Math.exp(-totalOpticalDepth * effectiveAirMass)
    };
  });
}

function sampleSingleScatteringSky(input = {}) {
  const viewDirection = normalizeVector(input.viewDirection);
  const sunDirection = normalizeVector(input.sunDirection);

  if (viewDirection.y <= -0.02) {
    return {
      spectrum: base.DEFAULT_WAVELENGTHS_NM.map((wavelengthNm) => ({ wavelengthNm, value: 0 })),
      xyz: { X: 0, Y: 0, Z: 0 },
      linearSrgb: { r: 0, g: 0, b: 0 },
      normalizedLinearSrgb: { r: 0, g: 0, b: 0 }
    };
  }

  const cosTheta = clamp(dot(viewDirection, sunDirection), -1, 1);
  const viewZenithDeg = Math.acos(clamp(viewDirection.y, -1, 1)) * 180 / Math.PI;
  const viewAirMass = absoluteAirMass(Math.min(89.9, viewZenithDeg), input.altitudeMeters ?? 0);
  const sunAirMass = input.sunAirMass;
  const pressureRatio = input.pressureRatio ?? 1;
  const aerosolOpticalDepth550 = input.aerosolOpticalDepth550 ?? 0.1;
  const angstromExponent = input.angstromExponent ?? 1.3;
  const mieAsymmetry = input.mieAsymmetry ?? 0.76;
  const ozoneDobsonUnits = input.ozoneDobsonUnits ?? 300;
  const precipitableWaterCm = input.precipitableWaterCm ?? 1.5;
  const solar = base.normalizedSolarSpectrum();

  const spectrum = solar.map((solarSample) => {
    const wavelengthNm = solarSample.wavelengthNm;
    const tauRayleigh = base.rayleighOpticalDepth(wavelengthNm, pressureRatio);
    const tauAerosol = base.aerosolOpticalDepth(
      wavelengthNm,
      aerosolOpticalDepth550,
      angstromExponent
    );
    const gas = gasOpticalDepthComponents({
      wavelengthNm,
      pressureRatio,
      ozoneDobsonUnits,
      precipitableWaterCm
    });
    const scatteringOpticalDepth = tauRayleigh + tauAerosol;
    const totalExtinction = scatteringOpticalDepth + gas.total;

    const sunTransmittance = Number.isFinite(sunAirMass)
      ? Math.exp(-totalExtinction * clamp(sunAirMass, 0, 40))
      : 0;
    const viewScatter = 1 - Math.exp(-scatteringOpticalDepth * clamp(viewAirMass, 0, 40));
    const averageGasExitTransmittance = Math.exp(
      -gas.total * clamp(viewAirMass, 0, 40) * 0.5
    );
    const weightedPhase =
      tauRayleigh * base.rayleighPhase(cosTheta) +
      tauAerosol * base.henyeyGreensteinPhase(cosTheta, mieAsymmetry);

    const value =
      solarSample.value *
      sunTransmittance *
      viewScatter *
      averageGasExitTransmittance *
      weightedPhase /
      Math.max(scatteringOpticalDepth, 1e-9);

    return { wavelengthNm, value };
  });

  const xyz = base.spectrumToXyz(spectrum);
  const linearSrgb = base.xyzToLinearSrgb(xyz);
  return {
    spectrum,
    xyz,
    linearSrgb,
    normalizedLinearSrgb: normalizeRgb(linearSrgb)
  };
}

function evaluateNaturalLight(input = {}) {
  const solarPosition = calculateSolarPosition(input);
  const altitudeMeters = input.altitudeMeters ?? 0;
  const pressureRatio = pressureRatioAtAltitude(altitudeMeters);
  const sunAirMass = absoluteAirMass(solarPosition.apparentZenithDeg, altitudeMeters);
  const extraterrestrialWm2 = extraterrestrialNormalIrradiance(solarPosition.dayOfYear);
  const ozoneDobsonUnits = input.ozoneDobsonUnits ?? 300;
  const precipitableWaterCm = input.precipitableWaterCm ?? 1.5;

  const transmittance = directTransmittanceSpectrum({
    airMass: sunAirMass,
    pressureRatio,
    aerosolOpticalDepth550: input.aerosolOpticalDepth550 ?? 0.1,
    angstromExponent: input.angstromExponent ?? 1.3,
    ozoneDobsonUnits,
    precipitableWaterCm
  });
  const solarSpectrum = base.normalizedSolarSpectrum();
  let weightedTransmittance = 0;
  let gasOnlyWeightedTransmittance = 0;
  let weightSum = 0;

  for (let index = 0; index < transmittance.length; index += 1) {
    const weight = solarSpectrum[index].value;
    const sample = transmittance[index];
    weightedTransmittance += sample.transmittance * weight;
    gasOnlyWeightedTransmittance +=
      Math.exp(-sample.totalGasOpticalDepth * clamp(sunAirMass, 0, 40)) * weight;
    weightSum += weight;
  }
  weightedTransmittance = weightSum > 0 ? weightedTransmittance / weightSum : 0;
  gasOnlyWeightedTransmittance = weightSum > 0
    ? gasOnlyWeightedTransmittance / weightSum
    : 0;

  const dniWm2 = solarPosition.isAboveHorizon
    ? extraterrestrialWm2 * weightedTransmittance
    : 0;
  const elevationSin = Math.max(
    0,
    Math.sin(solarPosition.apparentElevationDeg * Math.PI / 180)
  );
  const diffuseFraction = clamp(
    0.08 +
      (1 - weightedTransmittance) * 0.38 +
      (input.aerosolOpticalDepth550 ?? 0.1) * 0.15,
    0,
    0.75
  );
  const dhiEstimatedWm2 = solarPosition.isAboveHorizon
    ? extraterrestrialWm2 * elevationSin * diffuseFraction
    : 0;
  const ghiEstimatedWm2 = dniWm2 * elevationSin + dhiEstimatedWm2;

  const zenithSky = sampleSingleScatteringSky({
    viewDirection: { x: 0, y: 1, z: 0 },
    sunDirection: solarPosition.sunDirection,
    sunAirMass,
    altitudeMeters,
    pressureRatio,
    aerosolOpticalDepth550: input.aerosolOpticalDepth550 ?? 0.1,
    angstromExponent: input.angstromExponent ?? 1.3,
    mieAsymmetry: input.mieAsymmetry ?? 0.76,
    ozoneDobsonUnits,
    precipitableWaterCm
  });

  const directSpectrum = solarSpectrum.map((sample, index) => ({
    wavelengthNm: sample.wavelengthNm,
    value: sample.value * transmittance[index].transmittance
  }));
  const directXyz = base.spectrumToXyz(directSpectrum);
  const directChromaticity = chromaticityFromXyz(directXyz);

  return {
    model: {
      id: NATURAL_LIGHT_MODEL_ID,
      version: NATURAL_LIGHT_MODEL_VERSION,
      scattering: "single-with-band-gas-absorption",
      gasAbsorptionModel: {
        id: GAS_ABSORPTION_MODEL_ID,
        version: GAS_ABSORPTION_VERSION
      },
      spectralRangeNm: [380, 780],
      spectralStepNm: 10,
      limitations: [
        "Gas absorption is band-parameterized, not line-by-line",
        "No multiple scattering yet",
        "Diffuse irradiance is an engineering estimate"
      ]
    },
    solarPosition,
    atmosphere: {
      altitudeMeters: Number(altitudeMeters),
      pressureRatio,
      aerosolOpticalDepth550: input.aerosolOpticalDepth550 ?? 0.1,
      angstromExponent: input.angstromExponent ?? 1.3,
      mieAsymmetry: input.mieAsymmetry ?? 0.76,
      ozoneDobsonUnits,
      precipitableWaterCm,
      absoluteAirMass: Number.isFinite(sunAirMass) ? sunAirMass : null
    },
    irradiance: {
      extraterrestrialNormalWm2: extraterrestrialWm2,
      directNormalWm2: dniWm2,
      diffuseHorizontalEstimatedWm2: dhiEstimatedWm2,
      globalHorizontalEstimatedWm2: ghiEstimatedWm2,
      broadbandDirectTransmittance: weightedTransmittance,
      broadbandGasTransmittance: gasOnlyWeightedTransmittance
    },
    color: {
      directSunXyz: directXyz,
      directSunChromaticity: directChromaticity,
      directSunCctEstimatedK: correlatedColorTemperatureFromXy(
        directChromaticity.x,
        directChromaticity.y
      ),
      zenithSkyLinearSrgb: zenithSky.normalizedLinearSrgb
    },
    spectral: {
      directSun: directSpectrum,
      zenithSky: zenithSky.spectrum,
      transmittance
    }
  };
}

module.exports = {
  NATURAL_LIGHT_MODEL_ID,
  NATURAL_LIGHT_MODEL_VERSION,
  directTransmittanceSpectrum,
  sampleSingleScatteringSky,
  evaluateNaturalLight
};