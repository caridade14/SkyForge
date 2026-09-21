/**
 * SkyForge Natural Light Engine — Atmosphere Core
 *
 * Phase 1 implements deterministic spectral sampling with:
 * - Rayleigh molecular extinction
 * - Angstrom aerosol extinction
 * - single-scattering Rayleigh + Henyey-Greenstein Mie phase functions
 *
 * This is a physically grounded interactive model, not yet the final
 * multi-scattering reference renderer.
 */

"use strict";

const {
  calculateSolarPosition,
  absoluteAirMass,
  extraterrestrialNormalIrradiance
} = require("./solar-core");

const DEFAULT_WAVELENGTHS_NM = Object.freeze(
  Array.from({ length: 41 }, (_, index) => 380 + index * 10)
);
const PLANCK_H = 6.62607015e-34;
const LIGHT_C = 299_792_458;
const BOLTZMANN_K = 1.380649e-23;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function assertFinite(name, value, min = -Infinity, max = Infinity) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
    throw new RangeError(`${name} must be a finite number in [${min}, ${max}]`);
  }
  return numeric;
}

function normalizeVector(vector) {
  const x = Number(vector?.x) || 0;
  const y = Number(vector?.y) || 0;
  const z = Number(vector?.z) || 0;
  const length = Math.hypot(x, y, z);
  if (length < 1e-12) {
    throw new RangeError("direction vector must not be zero");
  }
  return { x: x / length, y: y / length, z: z / length };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function rayleighOpticalDepth(wavelengthNm, pressureRatio = 1) {
  const wavelengthMicrometers =
    assertFinite("wavelengthNm", wavelengthNm, 280, 2500) / 1000;
  const inverseSquared = 1 / (wavelengthMicrometers ** 2);
  return (
    assertFinite("pressureRatio", pressureRatio, 0.01, 1.2) *
    0.008569 *
    inverseSquared ** 2 *
    (1 + 0.0113 * inverseSquared + 0.00013 * inverseSquared ** 2)
  );
}

function aerosolOpticalDepth(
  wavelengthNm,
  aerosolOpticalDepth550 = 0.1,
  angstromExponent = 1.3
) {
  const wavelength = assertFinite("wavelengthNm", wavelengthNm, 280, 2500);
  const beta = assertFinite(
    "aerosolOpticalDepth550",
    aerosolOpticalDepth550,
    0,
    5
  );
  const alpha = assertFinite("angstromExponent", angstromExponent, 0, 4);
  return beta * Math.pow(wavelength / 550, -alpha);
}

function blackbodySpectralRadiance(wavelengthNm, temperatureK = 5778) {
  const wavelengthMeters =
    assertFinite("wavelengthNm", wavelengthNm, 100, 100_000) * 1e-9;
  const temperature = assertFinite(
    "temperatureK",
    temperatureK,
    100,
    100_000
  );
  const numerator = 2 * PLANCK_H * LIGHT_C ** 2;
  const exponent =
    (PLANCK_H * LIGHT_C) /
    (wavelengthMeters * BOLTZMANN_K * temperature);
  return numerator /
    (wavelengthMeters ** 5 * Math.expm1(exponent));
}

function normalizedSolarSpectrum(
  wavelengthsNm = DEFAULT_WAVELENGTHS_NM,
  temperatureK = 5778
) {
  const raw = wavelengthsNm.map((wavelengthNm) =>
    blackbodySpectralRadiance(wavelengthNm, temperatureK)
  );
  const max = Math.max(...raw);
  return raw.map((value, index) => ({
    wavelengthNm: wavelengthsNm[index],
    value: max > 0 ? value / max : 0
  }));
}

function rayleighPhase(cosTheta) {
  const c = clamp(cosTheta, -1, 1);
  return (3 / (16 * Math.PI)) * (1 + c * c);
}

function henyeyGreensteinPhase(cosTheta, asymmetry = 0.76) {
  const c = clamp(cosTheta, -1, 1);
  const g = assertFinite("asymmetry", asymmetry, -0.99, 0.99);
  const denominator = Math.pow(1 + g * g - 2 * g * c, 1.5);
  return (1 - g * g) / (4 * Math.PI * denominator);
}

function directTransmittanceSpectrum(input = {}) {
  const wavelengthsNm = input.wavelengthsNm || DEFAULT_WAVELENGTHS_NM;
  const airMass = Number(input.airMass);
  if (!Number.isFinite(airMass) || airMass < 0) {
    return wavelengthsNm.map((wavelengthNm) => ({
      wavelengthNm,
      rayleighOpticalDepth: Infinity,
      aerosolOpticalDepth: Infinity,
      totalOpticalDepth: Infinity,
      transmittance: 0
    }));
  }

  const pressureRatio = input.pressureRatio ?? 1;
  const aerosolOpticalDepth550 =
    input.aerosolOpticalDepth550 ?? 0.1;
  const angstromExponent = input.angstromExponent ?? 1.3;

  return wavelengthsNm.map((wavelengthNm) => {
    const tauRayleigh = rayleighOpticalDepth(
      wavelengthNm,
      pressureRatio
    );
    const tauAerosol = aerosolOpticalDepth(
      wavelengthNm,
      aerosolOpticalDepth550,
      angstromExponent
    );
    const tauTotal = tauRayleigh + tauAerosol;
    return {
      wavelengthNm,
      rayleighOpticalDepth: tauRayleigh,
      aerosolOpticalDepth: tauAerosol,
      totalOpticalDepth: tauTotal,
      transmittance: Math.exp(-tauTotal * airMass)
    };
  });
}

function cie1931Approx(wavelengthNm) {
  const wavelength = Number(wavelengthNm);

  const tx1 =
    (wavelength - 442.0) *
    (wavelength < 442.0 ? 0.0624 : 0.0374);
  const tx2 =
    (wavelength - 599.8) *
    (wavelength < 599.8 ? 0.0264 : 0.0323);
  const tx3 =
    (wavelength - 501.1) *
    (wavelength < 501.1 ? 0.0490 : 0.0382);
  const x =
    0.362 * Math.exp(-0.5 * tx1 * tx1) +
    1.056 * Math.exp(-0.5 * tx2 * tx2) -
    0.065 * Math.exp(-0.5 * tx3 * tx3);

  const ty1 =
    (wavelength - 568.8) *
    (wavelength < 568.8 ? 0.0213 : 0.0247);
  const ty2 =
    (wavelength - 530.9) *
    (wavelength < 530.9 ? 0.0613 : 0.0322);
  const y =
    0.821 * Math.exp(-0.5 * ty1 * ty1) +
    0.286 * Math.exp(-0.5 * ty2 * ty2);

  const tz1 =
    (wavelength - 437.0) *
    (wavelength < 437.0 ? 0.0845 : 0.0278);
  const tz2 =
    (wavelength - 459.0) *
    (wavelength < 459.0 ? 0.0385 : 0.0725);
  const z =
    1.217 * Math.exp(-0.5 * tz1 * tz1) +
    0.681 * Math.exp(-0.5 * tz2 * tz2);

  return { x: Math.max(0, x), y: Math.max(0, y), z: Math.max(0, z) };
}

function spectrumToXyz(spectrum) {
  if (!Array.isArray(spectrum) || spectrum.length < 2) {
    throw new TypeError("spectrum must contain at least two samples");
  }

  let X = 0;
  let Y = 0;
  let Z = 0;
  let normalization = 0;

  for (let index = 0; index < spectrum.length; index += 1) {
    const sample = spectrum[index];
    const previous = spectrum[Math.max(0, index - 1)];
    const next = spectrum[Math.min(spectrum.length - 1, index + 1)];
    const step =
      index === 0
        ? next.wavelengthNm - sample.wavelengthNm
        : index === spectrum.length - 1
          ? sample.wavelengthNm - previous.wavelengthNm
          : (next.wavelengthNm - previous.wavelengthNm) / 2;

    const matching = cie1931Approx(sample.wavelengthNm);
    const value = Math.max(0, Number(sample.value) || 0);
    X += value * matching.x * step;
    Y += value * matching.y * step;
    Z += value * matching.z * step;
    normalization += matching.y * step;
  }

  if (normalization <= 0) return { X: 0, Y: 0, Z: 0 };
  return {
    X: X / normalization,
    Y: Y / normalization,
    Z: Z / normalization
  };
}

function xyzToLinearSrgb(xyz) {
  return {
    r:
      3.2406 * xyz.X -
      1.5372 * xyz.Y -
      0.4986 * xyz.Z,
    g:
      -0.9689 * xyz.X +
      1.8758 * xyz.Y +
      0.0415 * xyz.Z,
    b:
      0.0557 * xyz.X -
      0.2040 * xyz.Y +
      1.0570 * xyz.Z
  };
}

function normalizeRgb(rgb) {
  const positive = {
    r: Math.max(0, rgb.r),
    g: Math.max(0, rgb.g),
    b: Math.max(0, rgb.b)
  };
  const max = Math.max(positive.r, positive.g, positive.b, 1e-12);
  return {
    r: positive.r / max,
    g: positive.g / max,
    b: positive.b / max
  };
}

function chromaticityFromXyz(xyz) {
  const sum = xyz.X + xyz.Y + xyz.Z;
  if (sum <= 0) return { x: 0, y: 0 };
  return { x: xyz.X / sum, y: xyz.Y / sum };
}

function correlatedColorTemperatureFromXy(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || y === 0.1858) {
    return null;
  }
  const n = (x - 0.3320) / (0.1858 - y);
  const cct =
    449 * n ** 3 +
    3525 * n ** 2 +
    6823.3 * n +
    5520.33;
  return Number.isFinite(cct) ? clamp(cct, 1000, 40_000) : null;
}

function sampleSingleScatteringSky(input = {}) {
  const viewDirection = normalizeVector(input.viewDirection);
  const sunDirection = normalizeVector(input.sunDirection);
  if (viewDirection.y <= -0.02) {
    return {
      spectrum: DEFAULT_WAVELENGTHS_NM.map((wavelengthNm) => ({
        wavelengthNm,
        value: 0
      })),
      xyz: { X: 0, Y: 0, Z: 0 },
      linearSrgb: { r: 0, g: 0, b: 0 },
      normalizedLinearSrgb: { r: 0, g: 0, b: 0 }
    };
  }

  const cosTheta = clamp(dot(viewDirection, sunDirection), -1, 1);
  const viewZenithDeg =
    Math.acos(clamp(viewDirection.y, -1, 1)) * 180 / Math.PI;
  const viewAirMass = absoluteAirMass(
    Math.min(89.9, viewZenithDeg),
    input.altitudeMeters ?? 0
  );
  const sunAirMass = input.sunAirMass;
  const pressureRatio = input.pressureRatio ?? 1;
  const aerosolOpticalDepth550 =
    input.aerosolOpticalDepth550 ?? 0.1;
  const angstromExponent = input.angstromExponent ?? 1.3;
  const mieAsymmetry = input.mieAsymmetry ?? 0.76;
  const solar = normalizedSolarSpectrum();

  const spectrum = solar.map((solarSample) => {
    const wavelengthNm = solarSample.wavelengthNm;
    const tauR = rayleighOpticalDepth(wavelengthNm, pressureRatio);
    const tauM = aerosolOpticalDepth(
      wavelengthNm,
      aerosolOpticalDepth550,
      angstromExponent
    );
    const totalTau = tauR + tauM;

    const sunTransmittance =
      Number.isFinite(sunAirMass)
        ? Math.exp(-totalTau * sunAirMass)
        : 0;
    const viewScatter = 1 - Math.exp(-totalTau * viewAirMass);
    const weightedPhase =
      tauR * rayleighPhase(cosTheta) +
      tauM * henyeyGreensteinPhase(cosTheta, mieAsymmetry);

    const value =
      solarSample.value *
      sunTransmittance *
      viewScatter *
      weightedPhase /
      Math.max(totalTau, 1e-9);

    return { wavelengthNm, value };
  });

  const xyz = spectrumToXyz(spectrum);
  const linearSrgb = xyzToLinearSrgb(xyz);
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
  const pressureRatio = Math.exp(-Number(altitudeMeters) / 8434.5);
  const sunAirMass = absoluteAirMass(
    solarPosition.apparentZenithDeg,
    altitudeMeters
  );
  const extraterrestrialWm2 = extraterrestrialNormalIrradiance(
    solarPosition.dayOfYear
  );

  const transmittance = directTransmittanceSpectrum({
    airMass: sunAirMass,
    pressureRatio,
    aerosolOpticalDepth550:
      input.aerosolOpticalDepth550 ?? 0.1,
    angstromExponent: input.angstromExponent ?? 1.3
  });
  const solarSpectrum = normalizedSolarSpectrum();
  let weightedTransmittance = 0;
  let weightSum = 0;

  for (let index = 0; index < transmittance.length; index += 1) {
    const weight = solarSpectrum[index].value;
    weightedTransmittance +=
      transmittance[index].transmittance * weight;
    weightSum += weight;
  }
  weightedTransmittance =
    weightSum > 0 ? weightedTransmittance / weightSum : 0;

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
  const ghiEstimatedWm2 =
    dniWm2 * elevationSin + dhiEstimatedWm2;

  const zenithSky = sampleSingleScatteringSky({
    viewDirection: { x: 0, y: 1, z: 0 },
    sunDirection: solarPosition.sunDirection,
    sunAirMass,
    altitudeMeters,
    pressureRatio,
    aerosolOpticalDepth550:
      input.aerosolOpticalDepth550 ?? 0.1,
    angstromExponent: input.angstromExponent ?? 1.3,
    mieAsymmetry: input.mieAsymmetry ?? 0.76
  });

  const directSpectrum = solarSpectrum.map((sample, index) => ({
    wavelengthNm: sample.wavelengthNm,
    value: sample.value * transmittance[index].transmittance
  }));
  const directXyz = spectrumToXyz(directSpectrum);
  const directChromaticity = chromaticityFromXyz(directXyz);

  return {
    model: {
      id: "skyforge-natural-light-phase1",
      version: "0.1.0",
      scattering: "single",
      spectralRangeNm: [380, 780],
      spectralStepNm: 10,
      limitations: [
        "No ozone or water-vapour absorption yet",
        "No multiple scattering yet",
        "Diffuse irradiance is an engineering estimate"
      ]
    },
    solarPosition,
    atmosphere: {
      altitudeMeters: Number(altitudeMeters),
      pressureRatio,
      aerosolOpticalDepth550:
        input.aerosolOpticalDepth550 ?? 0.1,
      angstromExponent: input.angstromExponent ?? 1.3,
      mieAsymmetry: input.mieAsymmetry ?? 0.76,
      absoluteAirMass: Number.isFinite(sunAirMass)
        ? sunAirMass
        : null
    },
    irradiance: {
      extraterrestrialNormalWm2: extraterrestrialWm2,
      directNormalWm2: dniWm2,
      diffuseHorizontalEstimatedWm2: dhiEstimatedWm2,
      globalHorizontalEstimatedWm2: ghiEstimatedWm2,
      broadbandDirectTransmittance: weightedTransmittance
    },
    color: {
      directSunXyz: directXyz,
      directSunChromaticity: directChromaticity,
      directSunCctEstimatedK:
        correlatedColorTemperatureFromXy(
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
  DEFAULT_WAVELENGTHS_NM,
  rayleighOpticalDepth,
  aerosolOpticalDepth,
  blackbodySpectralRadiance,
  normalizedSolarSpectrum,
  rayleighPhase,
  henyeyGreensteinPhase,
  directTransmittanceSpectrum,
  spectrumToXyz,
  xyzToLinearSrgb,
  sampleSingleScatteringSky,
  evaluateNaturalLight
};
