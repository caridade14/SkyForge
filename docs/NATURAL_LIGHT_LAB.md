# SkyForge Natural Light Lab

## Purpose

The Natural Light Lab is the interactive control and diagnostic interface for the Phase 4 Natural Light Engine.

It is injected automatically by `server-natural-light.js` together with the physical preview client and the precision ergonomics stylesheet. The original `SF30.html` file is not modified.

## Runtime components

```text
natural-light-preview.js      0.4.0
natural-light-dashboard.js    0.2.0
natural-light-ergonomics.css  0.1.0
```

The preview client owns API communication, LUT display, scene persistence and host-application hooks.

The dashboard owns the native top-menu integration, physical presets, diagnostic readouts and local interface preferences.

The ergonomics stylesheet reduces excessive decorative corner rounding while preserving circular controls such as toggles, node sockets, status dots and slider handles.

## Access

The Natural Light Lab is no longer a permanent floating viewport panel.

It appears as a native **Natural Light** entry in the SkyForge upper menu bar, alongside the other application menus. The panel remains closed by default and opens only when the user clicks the menu.

The keyboard shortcut is:

```text
Shift + L
```

Clicking outside the panel or pressing `Escape` closes it. Interacting with sliders, selectors and diagnostic buttons does not close the menu.

## Viewport diagnostics

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

The horizontal direction represents zenith angle and the vertical direction represents atmospheric altitude. RGB channels show spectral transport near red, green and blue anchor wavelengths.

This is a diagnostic mode and temporarily appears above scene objects.

### MULTI

Displays the Multiple-Scattering LUT.

The horizontal direction represents solar zenith angle and the vertical direction represents altitude. RGB represents relative indirect spectral energy.

This is a diagnostic mode and temporarily appears above scene objects.

## Solver quality presets

### Realtime

```text
2 multiple-scattering orders
```

Designed for rapid interactive adjustments.

### Production

```text
4 multiple-scattering orders
```

Default balance between stability and interactive response.

### Reference

```text
8 multiple-scattering orders
```

Highest available finite-order convergence setting for inspection and comparison.

The order slider remains available for custom values from 1 to 8.

## Ground material presets

The current Phase 4 solver uses a scalar Lambertian ground albedo. The menu provides practical starting presets:

```text
Asphalt     0.08
Dry soil    0.17
Vegetation  0.22
Concrete    0.35
Sand        0.45
Snow        0.82
```

Selecting a material updates the ground albedo immediately. Moving the albedo slider away from a preset changes the selector to `Custom`.

These values are workflow presets, not wavelength-resolved measured BRDF datasets.

## Physical controls

### Ground albedo

```text
0.00–1.00
```

Controls the fraction of incident light reflected by the scalar Lambertian ground model.

### Aerosol SSA

```text
0.00–1.00
```

Controls aerosol single-scattering albedo. Values near one represent primarily scattering aerosols; lower values increase absorption.

### MS orders

```text
1–8
```

Controls the number of finite multiple-scattering recurrence orders.

### Sky opacity

```text
0.00–1.00
```

Controls only the visual opacity of the physical sky layer and does not alter calculated irradiance.

The sky canvas is inserted behind scene content in SKY mode. Diagnostic LUT modes intentionally move it above the scene.

## Live diagnostics

The menu reports:

- direct normal irradiance;
- diffuse horizontal irradiance;
- global horizontal irradiance;
- total indirect-to-single-scatter ratio;
- broadband ground-bounce contribution;
- apparent solar elevation;
- active scattering-order count;
- final-order convergence residual;
- solver connection state.

The convergence indicator classifies the final-order residual as:

```text
CONVERGED   <= 0.5%
ACCEPTABLE  <= 2.0%
REFINE      > 2.0%
```

## Precision ergonomics skin

`natural-light-ergonomics.css` changes major panels, dropdowns, cards, buttons, inputs and modal surfaces to a technical 1–2 px corner radius.

It deliberately preserves circles for:

- toggle tracks and handles;
- node sockets;
- slider handles;
- live-status dots;
- tab and status indicators.

This keeps functional affordances recognizable while reducing the overly rounded appearance of the interface.

## Persistence

Physical scene parameters are persisted through:

```text
scene.lighting.naturalLight
```

Natural Light menu preferences are stored locally under:

```text
skyforge.naturalLightLab.v2
```

The loader can migrate values from:

```text
skyforge.naturalLightLab.v1
```

Persisted preferences include:

- selected visualization mode;
- selected solver quality;
- selected ground material;
- ground albedo;
- aerosol single-scattering albedo;
- multiple-scattering orders;
- sky opacity.

The open or closed state is not persisted. The menu always starts closed.

## Browser events

The preview client emits:

```text
skyforge:natural-light-status
skyforge:natural-light-updated
skyforge:natural-light-restored
skyforge:natural-light-controls
```

This keeps the menu decoupled from the physical solver.

## Public dashboard API

```javascript
window.SkyForgeNaturalLightDashboard.open()
window.SkyForgeNaturalLightDashboard.close()
window.SkyForgeNaturalLightDashboard.toggle()
window.SkyForgeNaturalLightDashboard.getState()
```

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

## Validation

Automated validation covers:

- preview and dashboard versions;
- explicit physical overrides and bounds;
- RGB and RGBA-like LUT sampling;
- diagnostic LUT selection;
- ground-material preset values;
- solver quality presets;
- convergence classification;
- injection of the ergonomics stylesheet and both clients;
- static availability of all three runtime components;
- gateway health metadata;
- complete preview and LUT payload generation.

## Known limitation

The current CI validates logic, syntax and server integration but does not perform screenshot-based visual regression testing. Browser pixel-reference tests should be added when the viewport becomes stable enough for deterministic rendering snapshots.
