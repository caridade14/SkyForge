# SkyForge Natural Light Lab

## Purpose

The Natural Light Lab is the interactive viewport dashboard for the Phase 4 Natural Light Engine.

It is injected automatically by `server-natural-light.js` together with `natural-light-preview.js`. The original `SF30.html` file is not modified.

## Runtime clients

```text
natural-light-preview.js   0.4.0
natural-light-dashboard.js 0.1.0
```

The preview client owns API communication, LUT display, scene persistence and host-application hooks.

The dashboard owns user controls, diagnostic readouts and local interface preferences.

## Dashboard controls

### SKY

Displays the enhanced Phase 4 Sky-View LUT, including:

- Rayleigh scattering;
- aerosol scattering;
- gas absorption;
- finite-order multiple scattering;
- Lambertian ground bounce;
- physical solar position.

This is the normal production-preview mode.

### TRANS

Displays the Transmittance LUT.

The horizontal direction represents zenith angle and the vertical direction represents atmospheric altitude. The RGB channels show spectral transport near red, green and blue anchor wavelengths.

This mode is diagnostic and temporarily appears above the scene objects.

### MULTI

Displays the Multiple-Scattering LUT.

The horizontal direction represents solar zenith angle and the vertical direction represents altitude. RGB represents relative indirect spectral energy.

This mode is diagnostic and temporarily appears above the scene objects.

## Physical controls

### Ground albedo

```text
0.00–1.00
```

Controls the fraction of incident light reflected by the current scalar Lambertian ground model.

Lower values approximate dark materials such as asphalt. Higher values approximate bright surfaces such as sand or snow.

### Aerosol SSA

```text
0.00–1.00
```

Controls aerosol single-scattering albedo.

A value near one means aerosols primarily scatter light. A lower value means a larger fraction is absorbed.

### MS orders

```text
1–8
```

Controls the number of finite multiple-scattering recurrence orders.

Four orders are used by default. Higher values improve convergence diagnostics but require more CPU work.

### Sky opacity

```text
0.00–1.00
```

Controls the visual opacity of the physical sky layer without changing physical irradiance calculations.

The sky canvas is inserted at the back of the viewport stacking order so scene objects remain visible. Diagnostic LUT modes intentionally move the canvas above the scene.

## Live diagnostics

The dashboard reports:

- direct normal irradiance;
- total estimated diffuse horizontal irradiance;
- total indirect-to-single-scatter ratio;
- broadband ground-bounce contribution;
- final-order convergence residual;
- apparent solar elevation;
- active scattering-order count;
- solver connection status.

## Persistence

Physical scene parameters are persisted through:

```text
scene.lighting.naturalLight
```

Dashboard presentation preferences are stored locally in the browser under:

```text
skyforge.naturalLightLab.v1
```

Presentation preferences include:

- selected visualization mode;
- panel collapsed state;
- sky opacity;
- dashboard slider values.

## Browser events

The preview client emits:

```text
skyforge:natural-light-status
skyforge:natural-light-updated
skyforge:natural-light-restored
skyforge:natural-light-controls
```

This keeps the dashboard decoupled from the solver and allows future SkyForge modules to subscribe without wrapping internal functions.

## Public preview API

```javascript
window.SkyForgeNaturalLightPreview.getState()
window.SkyForgeNaturalLightPreview.refresh()
window.SkyForgeNaturalLightPreview.setEnabled(true)
window.SkyForgeNaturalLightPreview.setOverrides({
  groundAlbedo: 0.25,
  aerosolSingleScatteringAlbedo: 0.92,
  multipleScatteringOrders: 4
})
window.SkyForgeNaturalLightPreview.setVisualizationMode("sky")
window.SkyForgeNaturalLightPreview.setOverlayOpacity(0.72)
```

`getState()` exposes:

```text
input
sceneState
evaluation
skyViewLut
transmittanceLut
multipleScatteringLut
visualizationMode
overlayOpacity
overrides
clientVersion
```

## Validation

Automated validation covers:

- Phase 4 client versions;
- explicit physical overrides;
- physical parameter bounds;
- three-channel Sky LUT sampling;
- four-channel Transmittance and Multiple-Scattering LUT sampling;
- diagnostic LUT selection;
- dashboard number formatting;
- script injection into the served HTML;
- dashboard and preview static-file availability;
- gateway health metadata;
- full preview payload generation.

## Known limitation

The current CI validates logic, syntax and server integration but does not perform screenshot-based visual regression testing. Browser pixel-reference tests should be added when the viewport becomes stable enough for deterministic rendering snapshots.
