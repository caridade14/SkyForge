"use strict";

/**
 * SkyForge Natural Light Engine — Gas Absorption Core
 *
 * Interactive spectral-band approximation for visible atmospheric absorption.
 * The architecture mirrors clear-sky spectral models that keep ozone, mixed
 * gases and water-vapour transmittance separate, while deliberately avoiding
 * any claim of line-by-line HITRAN/MODTRAN equivalence.
 */

const GAS_ABSORPTION_MODEL_ID = "skyforge-gas-absorption-phase3";
const GAS_ABSORPTION_VERSION = "0.3.0";
const REFERENCE_OZONE_DU = 300;
const REFERENCE_WATER_CM = 1.5;

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

function gaussian(wavelengthNm, centerNm, sigmaNm) {
  const delta = (wavelengthNm - centerNm) / sigmaNm;
  return Math.exp(-0.5 * delta * delta);
}

/**
 * Effective vertical ozone optical depth.
 *
 * Two smooth components represent the visible edge of the Huggins system and
 * the broad Chappuis absorption system. Coefficients are intentionally smooth
 * because the current engine samples every 10 nm.
 */
function ozoneVerticalOpticalDepth(wavelengthNm, ozoneDobsonUnits = REFERENCE_OZONE_DU) {
  const wavelength = assertFinite("wavelengthNm", wavelengthNm, 280, 2500);
  const ozoneDu = assertFinite("ozoneDobsonUnits", ozoneDobsonUnits, 100, 700);
  const columnScale = ozoneDu / REFERENCE_OZONE_DU;

  const hugginsVisibleEdge = 0.055 * gaussian(wavelength, 385, 18);
  const chappuisMain = 0.034 * gaussian(wavelength, 600, 105);
  const chappuisBlueShoulder = 0.006 * gaussian(wavelength, 505, 48);
  return columnScale * (hugginsVisibleEdge + chappuisMain + chappuisBlueShoulder);
}

/**
 * Effective vertical oxygen optical depth.
 *
 * The visible gamma, B and A bands are represented as finite-width features
 * suitable for the engine's low-resolution interactive spectrum.
 */
function oxygenVerticalOpticalDepth(wavelengthNm, pressureRatio = 1) {
  const wavelength = assertFinite("wavelengthNm", wavelengthNm, 280, 2500);
  const pressure = assertFinite("pressureRatio", pressureRatio, 0.01, 1.2);

  const gammaBand = 0.008 * gaussian(wavelength, 628, 4.5);
  const bBand = 0.038 * gaussian(wavelength, 687, 4.2);
  const aBand = 0.145 * gaussian(wavelength, 760.5, 5.2);
  return pressure * (gammaBand + bBand + aBand);
}

/**
 * Effective vertical water-vapour optical depth.
 *
 * The exponent approximates saturation behaviour used by fast spectral
 * transmittance parameterizations. Only bands intersecting the 380–780 nm
 * SkyForge working range are represented here.
 */
function waterVaporVerticalOpticalDepth(
  wavelengthNm,
  precipitableWaterCm = REFERENCE_WATER_CM
) {
  const wavelength = assertFinite("wavelengthNm", wavelengthNm, 280, 2500);
  const waterCm = assertFinite("precipitableWaterCm", precipitableWaterCm, 0, 12);
  if (waterCm === 0) return 0;

  const columnScale = Math.pow(waterCm / REFERENCE_WATER_CM, 0.72);
  const band720 = 0.052 * gaussian(wavelength, 720, 10.5);
  const band740 = 0.014 * gaussian(wavelength, 742, 7.5);
  const nearInfraredEdge = 0.038 * gaussian(wavelength, 790, 17);
  return columnScale * (band720 + band740 + nearInfraredEdge);
}

function gasOpticalDepthComponents(input = {}) {
  const wavelengthNm = assertFinite("wavelengthNm", input.wavelengthNm, 280, 2500);
  const ozone = ozoneVerticalOpticalDepth(
    wavelengthNm,
    input.ozoneDobsonUnits ?? REFERENCE_OZONE_DU
  );
  const oxygen = oxygenVerticalOpticalDepth(
    wavelengthNm,
    input.pressureRatio ?? 1
  );
  const waterVapor = waterVaporVerticalOpticalDepth(
    wavelengthNm,
    input.precipitableWaterCm ?? REFERENCE_WATER_CM
  );

  return {
    ozone,
    oxygen,
    waterVapor,
    total: ozone + oxygen + waterVapor
  };
}

function gasTransmittanceSpectrum(input = {}) {
  const wavelengthsNm = Array.isArray(input.wavelengthsNm)
    ? input.wavelengthsNm
    : Array.from({ length: 41 }, (_, index) => 380 + index * 10);
  const airMass = Number(input.airMass);

  if (!Number.isFinite(airMass) || airMass < 0) {
    return wavelengthsNm.map((wavelengthNm) => ({
      wavelengthNm,
      ozoneOpticalDepth: Infinity,
      oxygenOpticalDepth: Infinity,
      waterVaporOpticalDepth: Infinity,
      totalGasOpticalDepth: Infinity,
      transmittance: 0
    }));
  }

  return wavelengthsNm.map((wavelengthNm) => {
    const components = gasOpticalDepthComponents({
      wavelengthNm,
      pressureRatio: input.pressureRatio ?? 1,
      ozoneDobsonUnits: input.ozoneDobsonUnits ?? REFERENCE_OZONE_DU,
      precipitableWaterCm: input.precipitableWaterCm ?? REFERENCE_WATER_CM
    });
    const effectiveAirMass = clamp(airMass, 0, 40);
    return {
      wavelengthNm,
      ozoneOpticalDepth: components.ozone,
      oxygenOpticalDepth: components.oxygen,
      waterVaporOpticalDepth: components.waterVapor,
      totalGasOpticalDepth: components.total,
      transmittance: Math.exp(-components.total * effectiveAirMass)
    };
  });
}

module.exports = {
  GAS_ABSORPTION_MODEL_ID,
  GAS_ABSORPTION_VERSION,
  REFERENCE_OZONE_DU,
  REFERENCE_WATER_CM,
  ozoneVerticalOpticalDepth,
  oxygenVerticalOpticalDepth,
  waterVaporVerticalOpticalDepth,
  gasOpticalDepthComponents,
  gasTransmittanceSpectrum
};