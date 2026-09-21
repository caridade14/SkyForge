# SkyForge Natural Light Engine — Phase 3

## Objective

Phase 3 adds visible atmospheric gas absorption and the first dedicated transmittance LUT to the Natural Light pipeline.

The implementation remains an interactive spectral model. It is more physically complete than Phase 2, but it is not a line-by-line spectroscopic renderer and does not claim equivalence with HITRAN, MODTRAN or SMARTS.

## Gas absorption architecture

The engine now keeps extinction processes separate:

- Rayleigh molecular scattering;
- aerosol extinction through an Angstrom model;
- ozone absorption;
- molecular oxygen absorption;
- water-vapour absorption.

The public solver identifier is now:

```text
skyforge-natural-light-phase3 / 0.3.0
```

The gas module is identified as:

```text
skyforge-gas-absorption-phase3 / 0.3.0
```

## Visible absorption bands

The interactive spectrum uses 41 samples from 380 to 780 nm. Gas features are therefore represented as smooth effective bands rather than individual spectral lines.

### Ozone

The model includes:

- the visible edge of the Huggins system;
- the broad Chappuis absorption system.

The strength scales with `ozoneDobsonUnits`.

### Oxygen

The model includes finite-width approximations of:

- the gamma band near 628 nm;
- the B band near 687 nm;
- the A band near 760 nm.

The remaining oxygen column scales with atmospheric pressure.

### Water vapour

The current visible-range model includes absorption around:

- 720 nm;
- 740 nm;
- the approach to the stronger near-infrared system beyond the current spectral range.

The strength scales non-linearly with `precipitableWaterCm`.

## Air-mass correction

Phase 1 applied pressure both to molecular optical depth and to the slant air-mass value. Phase 3 removes that double scaling.

The transport calculation now uses:

- relative geometric air mass for the slant path;
- pressure ratio for Rayleigh and oxygen column density;
- explicit aerosol, ozone and water-vapour columns.

Both relative and pressure-adjusted absolute air mass are still returned for diagnostics.

## Transmittance LUT

A new LUT is available through:

```text
POST /api/lighting/lut/transmittance
```

The LUT maps:

- X axis: solar/view zenith angle from 0 to 89.5 degrees;
- Y axis: observer altitude from the configured top altitude to ground;
- channels: red at 650 nm, green at 550 nm, blue at 450 nm and solar-weighted broadband transmittance.

The model identifier is:

```text
skyforge-transmittance-lut-phase3 / 0.3.0
```

Example request:

```json
{
  "input": {
    "latitude": 48.8566,
    "longitude": 2.3522,
    "dateTime": "2026-07-09T14:00:00+02:00",
    "aerosolOpticalDepth550": 0.12,
    "ozoneDobsonUnits": 320,
    "precipitableWaterCm": 2.1
  },
  "transmittanceLut": {
    "width": 48,
    "height": 24,
    "maxAltitudeMeters": 20000
  }
}
```

## Altitude-dependent columns

The LUT reduces atmospheric constituents separately with altitude:

- molecular pressure follows the existing barometric pressure ratio;
- aerosol column uses an effective 1.8 km scale height;
- water vapour uses an effective 2.2 km scale height;
- the remaining ozone column decreases more slowly because much of the ozone layer lies above the lower atmosphere.

These values are interactive approximations and are exposed in the LUT metadata.

## Preview response

`POST /api/lighting/preview` now returns:

```text
input
sceneState
evaluation
skyViewLut
transmittanceLut
```

The Sky-View LUT now includes ozone, oxygen and water-vapour absorption in the incoming solar path and an approximate outgoing gas attenuation term.

## Validation

The automated test suite verifies:

- expected ozone, oxygen and water-vapour spectral bands;
- stronger columns reducing transmittance in the correct wavelength regions;
- finite gas-aware irradiance and colour outputs;
- persistence of ozone and precipitable-water parameters;
- deterministic gas-aware Sky-View LUT output;
- bounded altitude-versus-zenith transmittance LUT output;
- higher transmittance at altitude than near ground;
- the public Phase 3 API and preview response.

## Remaining scientific work

1. Replace smooth gas bands with licensed or redistributable high-resolution cross-section data.
2. Implement spectral resampling and band integration instead of evaluating only sample centres.
3. Add multiple scattering and ground-atmosphere energy feedback.
4. Add wavelength-dependent aerosol single-scattering albedo.
5. Add cloud optical transport and cloud-sun occlusion.
6. Calibrate absolute radiance against measured clear-sky spectra and reference datasets.
7. Move LUT generation to a GPU compute path for production resolution.
