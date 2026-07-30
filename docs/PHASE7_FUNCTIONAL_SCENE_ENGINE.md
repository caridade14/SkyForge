# SkyForge Phase 7 — Functional Scene Engine

Phase 7 replaces the always-on galaxy preview and disconnected UI mocks with a functional scene pipeline.

## Core changes

- Galaxies are disabled by default and only appear after explicit creation or preset selection.
- A city selection requests current Open-Meteo conditions with the city's local timezone.
- Weather data drives cloud coverage/layers, humidity, fog, rain/snow, wind and storm lighting in the GPU viewport.
- The local city time continues to drive the physical solar-position pipeline.
- Moon phase, approximate position and illumination are derived from date, time and location.
- Stars are night-dependent and are occluded by clouds.
- Aurora is an additive sky layer; enabling it no longer replaces the atmosphere, clouds, moon or stars.
- Space Color Lab wheels accept pointer input and drive the final GPU color transform.
- Look Development presets affect the rendered result instead of only changing labels/outliner objects.

## Runtime

```bash
npm start
```

Open:

```text
http://127.0.0.1:3000
```

Health endpoint:

```text
GET /api/phase7/health
```

Live weather example:

```text
GET /api/phase7/weather?lat=45.764&lon=4.8357
```

## Rendering architecture

Phase 7 uses one WebGL2 full-scene canvas. The shader composes, in order:

1. physical-light sky driven by Phase 5 solar data;
2. sun disc and forward atmospheric glow;
3. moon and star field;
4. optional galaxy, disabled by default;
5. multi-layer procedural clouds driven by live low/mid/high cloud cover;
6. non-destructive aurora behind cloud occlusion;
7. fog, rain, snow and storm flashes;
8. interactive color grade and ACES fitted output.

The Phase 6 renderer is destroyed only after Phase 7 successfully creates and links its WebGL2 pipeline. If WebGL2 initialization fails, Phase 6 remains available.

## Weather source

The Phase 7 gateway requests Open-Meteo current variables:

- temperature and apparent temperature;
- relative humidity;
- day/night flag;
- precipitation, rain, showers and snowfall;
- WMO weather code;
- total, low, mid and high cloud cover;
- surface pressure and visibility;
- wind speed, direction and gusts;
- sunrise and sunset;
- automatic local timezone.

Responses are cached for five minutes per coordinate pair. The client refreshes the selected city's weather every ten minutes.

## Space Color Lab controls

- **Hue Orbit**: angle controls hue rotation; radius controls saturation.
- **Tri-Balance**: horizontal movement controls tint; vertical movement controls color temperature.
- **Gamut Gate**: horizontal movement controls contrast; vertical movement controls gamut compression.
- Existing contrast, saturation, highlight-rolloff and look controls remain connected.

## Aurora composition

The Aurora quick button is intercepted as an additive action. It enables or updates the Aurora layer without applying the old destructive Aurora weather preset. Aurora settings remain editable through the existing Aurora panel.

## Known architectural limits

This is a functional procedural sky renderer, not yet a general mesh renderer. Full scene meshes, cascaded shadow maps, reflection probes, full volumetric ray marching, multilayer EXR and native Cycles remain later native/GPU milestones.
