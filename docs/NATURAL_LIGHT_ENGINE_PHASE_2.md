# SkyForge Natural Light Engine — Phase 2 Foundation

## Objective

Phase 2 begins connecting the physical solver to a production scene and preview pipeline without pretending that the current single-scattering model is already reference-grade.

This increment adds two foundations:

1. A validated and persistence-safe Natural Light scene schema.
2. A deterministic Sky-View LUT that the SkyForge viewport can consume.

## Natural Light scene state

The engine now normalizes physical inputs into a stable structure identified by:

```text
skyforge.natural-light / version 1
```

The state separates:

- geolocation and altitude;
- civil date/time and UTC offset;
- pressure and temperature;
- aerosol optical depth and Angstrom exponent;
- Mie asymmetry;
- ground albedo;
- reserved ozone and precipitable-water fields for the next spectral-absorption increment.

The state can be stored under:

```text
scene.lighting.naturalLight
```

and restored through `naturalLightInputFromSceneState`.

## API

### Evaluate physical daylight

```text
POST /api/lighting/evaluate
```

### Normalize a persistence-safe scene state

```text
POST /api/lighting/scene-state
```

Example:

```json
{
  "latitude": 48.8566,
  "longitude": 2.3522,
  "dateTime": "2026-07-09T14:00:00+02:00",
  "altitudeMeters": 35,
  "aerosolOpticalDepth550": 0.12,
  "groundAlbedo": 0.2
}
```

### Generate a Sky-View LUT

```text
POST /api/lighting/lut/sky-view
```

Example:

```json
{
  "input": {
    "latitude": 48.8566,
    "longitude": 2.3522,
    "dateTime": "2026-07-09T14:00:00+02:00",
    "altitudeMeters": 35,
    "aerosolOpticalDepth550": 0.12
  },
  "lut": {
    "width": 64,
    "height": 32
  }
}
```

The returned LUT uses:

- an equirectangular upper-hemisphere projection;
- north as azimuth origin;
- clockwise azimuth;
- rows ordered from zenith to horizon;
- relative linear-sRGB values globally normalized across the LUT.

Dimensions are deliberately bounded to protect the interactive gateway from oversized requests.

## Scientific status

The LUT is currently generated from the Phase 1 single-scattering Rayleigh/Mie solver. It preserves angular and chromatic variation but is not yet an absolute-radiance or multiple-scattering solution.

Current limitations are explicitly returned in API metadata:

- no multiple scattering;
- no ozone or water-vapour spectral absorption yet;
- no direct solar-disc rasterization;
- relative rather than absolute LUT radiance.

## Next implementation increment

1. Persist `scene.lighting.naturalLight` in the main SkyForge project schema.
2. Replace the viewport's heuristic sun direction with `solarPosition.sunDirection`.
3. Upload the Sky-View LUT to the preview renderer and blend a physically sized solar disc.
4. Add ozone, oxygen and water-vapour spectral absorption.
5. Replace the single-scattering LUT with a transmittance, multi-scattering and sky-view LUT pipeline.
6. Validate against measured clear-sky datasets and the SkyForge Light Benchmark.
