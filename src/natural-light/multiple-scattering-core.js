"use strict";

const {
  relativeAirMass,
  pressureRatioAtAltitude
} = require("./solar-core");
const base = require("./atmosphere-core");
const {
  directTransmittanceSpectrum
} = require("./atmosphere-advanced");
const {
  gasOpticalDepthComponents
} = require("./gas-absorption-core");

const MULTIPLE_SCATTERING_MODEL_ID = "skyforge-multiple-scattering-phase4";
const MULTIPLE_SCATTERING_VERSION = "0.4.0";
const DEFAULT_MULTIPLE_SCATTERING_ORDERS = 4;
const MAX_MULTIPLE_SCATTERING_ORDERS = 8;
const DEFAULT_AEROSOL_SINGLE_SCATTERING_ALBEDO = 0.92;
const DIFFUSE_AIR_MASS = 1.66;

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

function integerInRange(name, value, fallback, min, max) {
  const resolved = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new RangeError(`${name} must be an integer in [${min}, ${max}]`);
  }
  return resolved;
}

function transportStateAtWavelength(input = {}) {
  const wavelengthNm = assertFinite("wavelengthNm", input.wavelengthNm, 280, 2500);
  const pressureRatio = assertFinite("pressureRatio", input.pressureRatio ?? 1, 0.001, 1.2);
  const aerosolSingleScatteringAlbedo = assertFinite(
    "aerosolSingleScatteringAlbedo",
    input.aerosolSingleScatteringAlbedo ?? DEFAULT_AEROSOL_SINGLE_SCATTERING_ALBEDO,
    0,
    1
  );
  const mieAsymmetry = assertFinite("mieAsymmetry", input.mieAsymmetry ?? 0.76, -0.99, 0.99);

  const rayleigh = base.rayleighOpticalDepth(wavelengthNm, pressureRatio);
  const aerosolExtinction = base.aerosolOpticalDepth(
    wavelengthNm,
    input.aerosolOpticalDepth550 ?? 0.1,
    input.angstromExponent ?? 1.3
  );
  const aerosolScattering = aerosolExtinction * aerosolSingleScatteringAlbedo;
  const gas = gasOpticalDepthComponents({
    wavelengthNm,
    pressureRatio,
    ozoneDobsonUnits: input.ozoneDobsonUnits ?? 300,
    precipitableWaterCm: input.precipitableWaterCm ?? 1.5
  });

  const scatteringOpticalDepth = rayleigh + aerosolScattering;
  const absorptionOpticalDepth =
    aerosolExtinction - aerosolScattering + gas.total;
  const extinctionOpticalDepth = scatteringOpticalDepth + absorptionOpticalDepth;
  const singleScatteringAlbedo = extinctionOpticalDepth > 0
    ? scatteringOpticalDepth / extinctionOpticalDepth
    : 0;
  const transportOpticalDepth =
    rayleigh + aerosolScattering * (1 - clamp(mieAsymmetry, 0, 0.99));

  return {
    wavelengthNm,
    rayleighOpticalDepth: rayleigh,
    aerosolExtinctionOpticalDepth: aerosolExtinction,
    aerosolScatteringOpticalDepth: aerosolScattering,
    gasAbsorptionOpticalDepth: gas.total,
    scatteringOpticalDepth,
    absorptionOpticalDepth,
    extinctionOpticalDepth,
    transportOpticalDepth,
    singleScatteringAlbedo
  };
}

function spectrumBroadbandMean(spectrum, solarSpectrum = base.normalizedSolarSpectrum()) {
  let weighted = 0;
  let weightSum = 0;
  for (let index = 0; index < spectrum.length; index += 1) {
    const weight = solarSpectrum[index]?.value ?? 1;
    weighted += Math.max(0, Number(spectrum[index]?.value) || 0) * weight;
    weightSum += weight;
  }
  return weightSum > 0 ? weighted / weightSum : 0;
}

function spectrumToColor(spectrum) {
  const xyz = base.spectrumToXyz(spectrum);
  const linearSrgb = base.xyzToLinearSrgb(xyz);
  return { xyz, linearSrgb };
}

function computeMultipleScatteringSpectrum(input = {}) {
  const sunZenithDeg = assertFinite(
    "sunZenithDeg",
    input.sunZenithDeg,
    0,
    180
  );
  const altitudeMeters = assertFinite(
    "altitudeMeters",
    input.altitudeMeters ?? 0,
    -500,
    20_000
  );
  const groundAlbedo = assertFinite(
    "groundAlbedo",
    input.groundAlbedo ?? 0.2,
    0,
    1
  );
  const orders = integerInRange(
    "multipleScatteringOrders",
    input.multipleScatteringOrders,
    DEFAULT_MULTIPLE_SCATTERING_ORDERS,
    1,
    MAX_MULTIPLE_SCATTERING_ORDERS
  );
  const pressureRatio = input.pressureRatio ?? pressureRatioAtAltitude(altitudeMeters);
  const solar = base.normalizedSolarSpectrum();
  const sunAirMass = relativeAirMass(Math.min(89.5, sunZenithDeg));
  const sunCosine = Math.max(0, Math.cos(sunZenithDeg * Math.PI / 180));

  const direct = directTransmittanceSpectrum({
    airMass: sunAirMass,
    pressureRatio,
    aerosolOpticalDepth550: input.aerosolOpticalDepth550 ?? 0.1,
    angstromExponent: input.angstromExponent ?? 1.3,
    ozoneDobsonUnits: input.ozoneDobsonUnits ?? 300,
    precipitableWaterCm: input.precipitableWaterCm ?? 1.5
  });

  const singleScatterSeed = [];
  const atmosphericMultiple = [];
  const groundBounce = [];
  const totalIndirect = [];
  const orderEnergy = Array.from({ length: orders }, (_, index) => ({
    order: index + 1,
    atmosphere: 0,
    ground: 0,
    total: 0
  }));

  for (let index = 0; index < solar.length; index += 1) {
    const wavelengthNm = solar[index].wavelengthNm;
    const transport = transportStateAtWavelength({
      wavelengthNm,
      pressureRatio,
      aerosolOpticalDepth550: input.aerosolOpticalDepth550 ?? 0.1,
      angstromExponent: input.angstromExponent ?? 1.3,
      mieAsymmetry: input.mieAsymmetry ?? 0.76,
      aerosolSingleScatteringAlbedo:
        input.aerosolSingleScatteringAlbedo ?? DEFAULT_AEROSOL_SINGLE_SCATTERING_ALBEDO,
      ozoneDobsonUnits: input.ozoneDobsonUnits ?? 300,
      precipitableWaterCm: input.precipitableWaterCm ?? 1.5
    });
    const directTransmittance = direct[index].transmittance;
    const scatteringInteraction = 1 - Math.exp(
      -transport.scatteringOpticalDepth * clamp(sunAirMass, 0, 40)
    );
    const diffuseInteraction = 1 - Math.exp(
      -transport.transportOpticalDepth * DIFFUSE_AIR_MASS
    );
    const atmosphericReturn = clamp(
      transport.singleScatteringAlbedo * diffuseInteraction * 0.58,
      0,
      0.88
    );
    const diffuseEscape = Math.exp(
      -transport.extinctionOpticalDepth * DIFFUSE_AIR_MASS * 0.5
    );
    const groundReturn = clamp(
      groundAlbedo * diffuseEscape * diffuseEscape * 0.52,
      0,
      0.48
    );

    const seed =
      solar[index].value *
      directTransmittance *
      scatteringInteraction *
      (0.32 + 0.68 * diffuseInteraction);
    const directGroundSource =
      solar[index].value *
      directTransmittance *
      sunCosine *
      groundAlbedo *
      diffuseEscape *
      0.42;

    let currentAtmosphere = seed;
    let currentGround = directGroundSource;
    let multipleAtmosphere = 0;
    let accumulatedGround = currentGround;

    orderEnergy[0].atmosphere += currentAtmosphere;
    orderEnergy[0].ground += currentGround;
    orderEnergy[0].total += currentAtmosphere + currentGround;

    for (let order = 2; order <= orders; order += 1) {
      const nextAtmosphere =
        currentAtmosphere * atmosphericReturn +
        currentGround * atmosphericReturn * 0.72;
      const nextGround =
        (currentAtmosphere * 0.5 + currentGround * 0.2) * groundReturn;

      multipleAtmosphere += nextAtmosphere;
      accumulatedGround += nextGround;
      currentAtmosphere = nextAtmosphere;
      currentGround = nextGround;

      orderEnergy[order - 1].atmosphere += nextAtmosphere;
      orderEnergy[order - 1].ground += nextGround;
      orderEnergy[order - 1].total += nextAtmosphere + nextGround;
    }

    singleScatterSeed.push({ wavelengthNm, value: seed });
    atmosphericMultiple.push({ wavelengthNm, value: multipleAtmosphere });
    groundBounce.push({ wavelengthNm, value: accumulatedGround });
    totalIndirect.push({
      wavelengthNm,
      value: multipleAtmosphere + accumulatedGround
    });
  }

  const solarWeightSum = solar.reduce((sum, sample) => sum + sample.value, 0) || 1;
  for (const order of orderEnergy) {
    order.atmosphere /= solarWeightSum;
    order.ground /= solarWeightSum;
    order.total /= solarWeightSum;
  }

  const singleBroadband = spectrumBroadbandMean(singleScatterSeed, solar);
  const atmosphereBroadband = spectrumBroadbandMean(atmosphericMultiple, solar);
  const groundBroadband = spectrumBroadbandMean(groundBounce, solar);
  const totalBroadband = spectrumBroadbandMean(totalIndirect, solar);
  const lastOrderEnergy = orderEnergy[orderEnergy.length - 1]?.total ?? 0;
  const cumulativeOrderEnergy = orderEnergy.reduce((sum, order) => sum + order.total, 0);

  return {
    model: {
      id: MULTIPLE_SCATTERING_MODEL_ID,
      version: MULTIPLE_SCATTERING_VERSION,
      method: "finite-order-hemispheric-recurrence",
      orders,
      groundModel: "lambertian",
      limitations: [
        "Hemispheric recurrence approximation",
        "No full angular radiance integral",
        "No polarization",
        "No terrain occlusion"
      ]
    },
    input: {
      sunZenithDeg,
      altitudeMeters,
      pressureRatio,
      groundAlbedo,
      aerosolSingleScatteringAlbedo:
        input.aerosolSingleScatteringAlbedo ?? DEFAULT_AEROSOL_SINGLE_SCATTERING_ALBEDO,
      multipleScatteringOrders: orders
    },
    spectra: {
      singleScatterSeed,
      atmosphericMultiple,
      groundBounce,
      totalIndirect
    },
    color: {
      atmosphericMultiple: spectrumToColor(atmosphericMultiple),
      groundBounce: spectrumToColor(groundBounce),
      totalIndirect: spectrumToColor(totalIndirect)
    },
    metrics: {
      singleScatterSeedBroadband: singleBroadband,
      atmosphericMultipleBroadband: atmosphereBroadband,
      groundBounceBroadband: groundBroadband,
      totalIndirectBroadband: totalBroadband,
      multipleToSingleRatio: singleBroadband > 0
        ? totalBroadband / singleBroadband
        : 0,
      lastOrderFraction: cumulativeOrderEnergy > 0
        ? lastOrderEnergy / cumulativeOrderEnergy
        : 0
    },
    orderEnergy
  };
}

function combineSingleAndMultipleSky(
  singleSpectrum,
  multipleScattering,
  viewDirection = { x: 0, y: 1, z: 0 }
) {
  const viewY = clamp(Number(viewDirection?.y) || 0, 0, 1);
  const horizon = Math.pow(1 - viewY, 0.72);
  const atmosphericWeight = 0.68 + 0.32 * horizon;
  const groundWeight = 0.22 + 0.78 * Math.pow(1 - viewY, 1.6);
  const atmospheric = multipleScattering?.spectra?.atmosphericMultiple || [];
  const ground = multipleScattering?.spectra?.groundBounce || [];

  return singleSpectrum.map((sample, index) => ({
    wavelengthNm: sample.wavelengthNm,
    value:
      Math.max(0, Number(sample.value) || 0) +
      Math.max(0, Number(atmospheric[index]?.value) || 0) * atmosphericWeight +
      Math.max(0, Number(ground[index]?.value) || 0) * groundWeight
  }));
}

module.exports = {
  MULTIPLE_SCATTERING_MODEL_ID,
  MULTIPLE_SCATTERING_VERSION,
  DEFAULT_MULTIPLE_SCATTERING_ORDERS,
  MAX_MULTIPLE_SCATTERING_ORDERS,
  DEFAULT_AEROSOL_SINGLE_SCATTERING_ALBEDO,
  DIFFUSE_AIR_MASS,
  transportStateAtWavelength,
  spectrumBroadbandMean,
  computeMultipleScatteringSpectrum,
  combineSingleAndMultipleSky
};