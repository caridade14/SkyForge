# SkyForge Natural Light Engine — Phase 1

## Purpose

This phase starts replacing SkyForge's artistic gradient/noise preview with a deterministic, testable natural-light core.

The first implementation remains dependency-free and uses CommonJS so it can be integrated into the current Node.js backend without changing the existing stack.

## Phase 1 scope

- Solar azimuth and elevation from latitude, longitude, civil date/time and UTC offset.
- Atmospheric refraction correction.
- Relative and altitude-corrected optical air mass.
- Earth–Sun distance correction for extraterrestrial irradiance.
- Spectral sampling from 380–780 nm at 10 nm intervals.
- Rayleigh molecular optical depth.
- Angstrom aerosol optical depth.
- Direct spectral transmittance.
- Single-scattering Rayleigh and Henyey–Greenstein Mie sky samples.
- Approximate conversion from spectrum to CIE XYZ and linear sRGB.
- Estimated direct-normal, diffuse-horizontal and global-horizontal irradiance.
- Automated tests using Node's built-in test runner.

## Scientific honesty

Phase 1 is a physically grounded interactive model, not the final reference renderer.

It does not yet contain:

- Ozone absorption.
- Water-vapour and mixed-gas absorption.
- Multiple atmospheric scattering.
- Cloud radiative transfer.
- True HDR or OpenEXR encoding.
- Camera sensor and lens response.
- ACES D60 chromatic adaptation.
- Validation against measured SkyForge datasets.

Every API result exposes its solver version and limitations, so the application cannot falsely label Phase 1 output as reference-grade.

## Planned backend API

```text
POST /api/lighting/evaluate
```

Example body:

```json
{
  "latitude": 48.8566,
  "longitude": 2.3522,
  "dateTime": "2026-07-09T14:00:00+02:00",
  "altitudeMeters": 35,
  "aerosolOpticalDepth550": 0.12,
  "angstromExponent": 1.3
}
```

The current preview will progressively consume:

- `solarPosition.sunDirection`
- `irradiance.directNormalWm2`
- `color.directSunCctEstimatedK`
- `color.zenithSkyLinearSrgb`
- `spectral.transmittance`

## Phase 2 direction

1. Persist physical-atmosphere parameters in the scene schema.
2. Replace heuristic sun position in the preview.
3. Add an interactive multiple-scattering LUT solver.
4. Add real Radiance HDR and OpenEXR writers.
5. Build the first measured SkyForge Light Benchmark.
