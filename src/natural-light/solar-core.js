/**
 * SkyForge Natural Light Engine — Solar Core
 *
 * Dependency-free solar-position and clear-sky geometry utilities.
 * CommonJS is used to match the current SkyForge backend.
 */

"use strict";

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const SOLAR_CONSTANT_W_M2 = 1361;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeDegrees(value) {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function normalizeMinutes(value) {
  const normalized = value % 1440;
  return normalized < 0 ? normalized + 1440 : normalized;
}

function assertFinite(name, value, min = -Infinity, max = Infinity) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
    throw new RangeError(`${name} must be a finite number in [${min}, ${max}]`);
  }
  return numeric;
}

function parseIsoTimezoneOffsetMinutes(value) {
  if (typeof value !== "string") return null;
  if (/Z$/i.test(value.trim())) return 0;
  const match = value.trim().match(/([+-])(\d{2}):?(\d{2})$/);
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

function resolveDateTime(dateTime, timezoneOffsetMinutes) {
  const date = dateTime instanceof Date ? new Date(dateTime.getTime()) : new Date(dateTime);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("dateTime must be a valid Date or ISO-8601 string");
  }

  const parsedOffset = parseIsoTimezoneOffsetMinutes(
    typeof dateTime === "string" ? dateTime : ""
  );
  const offset = timezoneOffsetMinutes === undefined || timezoneOffsetMinutes === null
    ? (parsedOffset ?? 0)
    : assertFinite("timezoneOffsetMinutes", timezoneOffsetMinutes, -14 * 60, 14 * 60);

  // Shift UTC instant so UTC getters expose civil-time components at the requested offset.
  const civil = new Date(date.getTime() + offset * 60_000);
  return { date, civil, timezoneOffsetMinutes: offset };
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function dayOfYearFromCivilDate(civil) {
  const year = civil.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const current = Date.UTC(year, civil.getUTCMonth(), civil.getUTCDate());
  return Math.floor((current - start) / 86_400_000) + 1;
}

/**
 * NOAA-style solar-position approximation.
 *
 * Accuracy is suitable for interactive lighting and previsualization.
 * A later reference solver can replace this implementation without changing
 * the public API.
 */
function calculateSolarPosition(input = {}) {
  const latitude = assertFinite("latitude", input.latitude, -90, 90);
  const longitude = assertFinite("longitude", input.longitude, -180, 180);
  const { civil, timezoneOffsetMinutes } = resolveDateTime(
    input.dateTime,
    input.timezoneOffsetMinutes
  );

  const dayOfYear = dayOfYearFromCivilDate(civil);
  const daysInYear = isLeapYear(civil.getUTCFullYear()) ? 366 : 365;
  const civilHour =
    civil.getUTCHours() +
    civil.getUTCMinutes() / 60 +
    civil.getUTCSeconds() / 3600 +
    civil.getUTCMilliseconds() / 3_600_000;

  const gamma =
    (2 * Math.PI / daysInYear) *
    (dayOfYear - 1 + (civilHour - 12) / 24);

  const equationOfTimeMinutes =
    229.18 *
    (
      0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma)
    );

  const declinationRad =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const localMinutes =
    civil.getUTCHours() * 60 +
    civil.getUTCMinutes() +
    civil.getUTCSeconds() / 60 +
    civil.getUTCMilliseconds() / 60_000;

  const trueSolarTimeMinutes = normalizeMinutes(
    localMinutes +
    equationOfTimeMinutes +
    4 * longitude -
    timezoneOffsetMinutes
  );

  let hourAngleDeg = trueSolarTimeMinutes / 4 - 180;
  if (hourAngleDeg < -180) hourAngleDeg += 360;

  const latitudeRad = latitude * DEG_TO_RAD;
  const hourAngleRad = hourAngleDeg * DEG_TO_RAD;
  const cosZenith = clamp(
    Math.sin(latitudeRad) * Math.sin(declinationRad) +
      Math.cos(latitudeRad) *
        Math.cos(declinationRad) *
        Math.cos(hourAngleRad),
    -1,
    1
  );

  const geometricZenithDeg = Math.acos(cosZenith) * RAD_TO_DEG;
  const geometricElevationDeg = 90 - geometricZenithDeg;
  const refractionCorrectionDeg = atmosphericRefractionCorrection(
    geometricElevationDeg,
    input.pressureHpa,
    input.temperatureC
  );
  const apparentElevationDeg =
    geometricElevationDeg + refractionCorrectionDeg;
  const apparentZenithDeg = 90 - apparentElevationDeg;

  const azimuthRad = Math.atan2(
    Math.sin(hourAngleRad),
    Math.cos(hourAngleRad) * Math.sin(latitudeRad) -
      Math.tan(declinationRad) * Math.cos(latitudeRad)
  );
  const azimuthDeg = normalizeDegrees(azimuthRad * RAD_TO_DEG + 180);

  return {
    latitudeDeg: latitude,
    longitudeDeg: longitude,
    dayOfYear,
    timezoneOffsetMinutes,
    equationOfTimeMinutes,
    declinationDeg: declinationRad * RAD_TO_DEG,
    hourAngleDeg,
    trueSolarTimeMinutes,
    geometricElevationDeg,
    apparentElevationDeg,
    geometricZenithDeg,
    apparentZenithDeg,
    azimuthDeg,
    isAboveHorizon: apparentElevationDeg > 0,
    sunDirection: directionFromAzimuthElevation(
      azimuthDeg,
      apparentElevationDeg
    )
  };
}

function atmosphericRefractionCorrection(
  geometricElevationDeg,
  pressureHpa = 1013.25,
  temperatureC = 15
) {
  const pressure = Number.isFinite(Number(pressureHpa))
    ? Number(pressureHpa)
    : 1013.25;
  const temperature = Number.isFinite(Number(temperatureC))
    ? Number(temperatureC)
    : 15;

  let correctionArcSeconds = 0;
  const elevation = geometricElevationDeg;

  if (elevation > 85) {
    correctionArcSeconds = 0;
  } else if (elevation > 5) {
    const tangent = Math.tan(elevation * DEG_TO_RAD);
    correctionArcSeconds =
      58.1 / tangent -
      0.07 / Math.pow(tangent, 3) +
      0.000086 / Math.pow(tangent, 5);
  } else if (elevation > -0.575) {
    correctionArcSeconds =
      1735 +
      elevation *
        (-518.2 +
          elevation *
            (103.4 + elevation * (-12.79 + elevation * 0.711)));
  } else {
    correctionArcSeconds =
      -20.772 / Math.tan(elevation * DEG_TO_RAD);
  }

  const pressureTemperatureScale =
    (pressure / 1010) * (283 / (273 + temperature));
  return (correctionArcSeconds / 3600) * pressureTemperatureScale;
}

function directionFromAzimuthElevation(azimuthDeg, elevationDeg) {
  const azimuth = azimuthDeg * DEG_TO_RAD;
  const elevation = elevationDeg * DEG_TO_RAD;
  const cosElevation = Math.cos(elevation);

  // SkyForge convention: +Y up, +Z north, +X east.
  return {
    x: cosElevation * Math.sin(azimuth),
    y: Math.sin(elevation),
    z: cosElevation * Math.cos(azimuth)
  };
}

function relativeAirMass(zenithDeg) {
  const zenith = Number(zenithDeg);
  if (!Number.isFinite(zenith) || zenith >= 90) return Infinity;
  if (zenith < 0) return 1;

  const cosZenith = Math.cos(zenith * DEG_TO_RAD);
  return 1 /
    (
      cosZenith +
      0.50572 * Math.pow(96.07995 - zenith, -1.6364)
    );
}

function pressureRatioAtAltitude(altitudeMeters = 0) {
  const altitude = assertFinite(
    "altitudeMeters",
    altitudeMeters,
    -500,
    20_000
  );
  return Math.exp(-altitude / 8434.5);
}

function absoluteAirMass(zenithDeg, altitudeMeters = 0) {
  const relative = relativeAirMass(zenithDeg);
  if (!Number.isFinite(relative)) return Infinity;
  return relative * pressureRatioAtAltitude(altitudeMeters);
}

function extraterrestrialNormalIrradiance(dayOfYear) {
  const day = assertFinite("dayOfYear", dayOfYear, 1, 366);
  return (
    SOLAR_CONSTANT_W_M2 *
    (1 + 0.033 * Math.cos((2 * Math.PI * day) / 365))
  );
}

module.exports = {
  DEG_TO_RAD,
  RAD_TO_DEG,
  SOLAR_CONSTANT_W_M2,
  calculateSolarPosition,
  atmosphericRefractionCorrection,
  directionFromAzimuthElevation,
  relativeAirMass,
  absoluteAirMass,
  pressureRatioAtAltitude,
  extraterrestrialNormalIrradiance
};
