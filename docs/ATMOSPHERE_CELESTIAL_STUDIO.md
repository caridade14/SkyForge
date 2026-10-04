# Atmosphere and celestial Studio preview

This milestone extends `feature/lighting-workbench`. It preserves Core v11,
the Natural Light service, the existing canvas renderer, Blender Bridge,
reference geometry, projects, history, graph composition and animation.

[Studio R15](STUDIO_RENDER_REFINEMENT.md) subsequently separates the cloud target
from display resolution, adds complete sky looks/cloud size, and repairs Legacy
layer activation, sky framing and smooth receiver shadow artifacts. The cloud
budgets below continue to apply to the cloud pass.

## Use the implemented controls

- Open **Sky → Stars / Moon / Aurora / Rainbow**, or click a sky layer in the
  left Outliner panel. These controls render in **3D View**.
- Each layer has an enable checkbox. Moon, Aurora and Rainbow have a **Frame**
  button. Enabling a layer preserves the current Sun and camera.
- **Moonlit night**, **Aurora night** and **Sunshower** are actual scene presets:
  they edit Sun/cloud/exposure/layer/camera state together, in one Undo step.
- Moon phase is a cycle: `0` / `1` new, `0.25` first quarter, `0.5` full,
  `0.75` last quarter. The inspector also displays illuminated percentage.
  The default apparent diameter is 0.52°, so a wide-angle view has a small Moon.
- Stars and Aurora fade with daylight. Rainbow requires a Sun above the
  horizon, nonzero rain amount and the antisolar viewing direction.
- The viewport rail provides Select, Move, Rotate, Scale, Orbit, Pan, Dolly,
  Undo, Frame selection, PNG capture, Home and three axis views. Selected
  navigation tools use left drag. Middle mouse / Alt drag retains Blender
  navigation, including trackpad Shift-pan and Ctrl-dolly.
- A Select tool hides object transform handles; G/R/S or the transform buttons
  return to their actual object tools. Navigation never changes the Sun marker
  or object selection. Escape cancels a navigation gesture.
- **Realtime atmosphere** is the default sky source. **Natural Light LUT**
  uses the backend's relative spectral result only when Sun and atmosphere
  inputs match its evaluated baseline. Manual mismatches use realtime transport.
  **Use physical sun** still explicitly copies evaluated solar angles.

## Transport and shared lighting

`viewport/atmosphere-transport.js` integrates radiance through a spherical
atmosphere (6360 km ground radius, 100 km atmosphere). Calculations use
kilometres and inverse-kilometre optical coefficients. This avoids subtracting
large metre coordinates in a limited-precision fragment shader.

The density profiles are exponential Rayleigh (8 km) and aerosol (1.2 km),
plus a triangular ozone profile between 10–40 km peaking at 25 km. Sea-level
Rayleigh coefficients are `[0.005802, 0.013558, 0.033100] km⁻¹` in RGB.
Aerosol extinction uses AOD/scale-height and an Ångström wavelength slope.
Scattering albedo controls absorption. Pressure, air temperature, ozone and
legacy atmosphere controls modify these coefficients; they are not extra
screen-space colour overlays.

Transport uses Beer–Lambert attenuation, normalized Rayleigh and
Henyey–Greenstein phases, spherical ground shadow and a cell-integrated
source term `(1 - exp(-σt Δs)) / σt`. Sun-path transmission is cached over
altitude / zenith cosine. A compact angular mean of first-order scattering
feeds an isotropic geometric closure for higher orders. That closure and its
12-direction quadrature are approximations, **not** the full angular
multiple-scattering solution in Bruneton's reference implementation.

The compact sky-view table concentrates samples near the horizon. Low / Medium /
High use 48×24 / 64×32 / 96×48 pixels and 20 / 28 / 36 integration steps.
The current sky observer is fixed at 20 m. Solar azimuth rotates the lookup;
azimuth, intensity, colour temperature and ordinary camera edits do not
regenerate it. Optical tables rebuild only when optical parameters change.
The final sky table rebuilds for elevation, optical changes or quality changes.

Radiance remains linear and may exceed one. There is no per-scene maximum
normalization. The fixed solar preview scale is **relative**, not a calibrated
lux / W m⁻² exposure model. A three-wavelength Planck ratio tints the source;
it is not a full CIE spectral colour-temperature integration. Sun, clouds,
GGX reference lighting and the sky reflection probe share this scene state.
Sky fill integrates the upper-hemisphere radiance with cosine / solid-angle
weights. Distant objects have a bounded Beer–Lambert aerial approximation;
cloud distance haze remains a preview approximation.

Display uses luminance Reinhard mapping, bounded gamut compression and sRGB
encoding. This renderer uses linear sRGB primaries; existing ACES / ACEScg
project metadata does **not** turn it into an ACES/OCIO implementation.
WebGL float-texture devices retain floating-point sky radiance; the fallback
uses RGBM over 0–32 relative radiance, with bounded quantization / clipping.

## Volumetric clouds

`viewport/cloud-noise.js` creates a deterministic seamless 32³ Perlin/Worley
field. Border-padded slices form a 272×136 RGBA atlas (about 145 KiB), sampled
trilinearly in WebGL 1. It is density data, not a flat cloud photograph. The
field is built once per seed, and shared by the volume and cloud shadow shader.
The macro weather variation and cellular erosion form 3D density inside a
height profile; Cumulus, Stratus, Cirrus, Cumulonimbus and Altostratus retain
distinct profiles. Wind advects the density in metres, converted from km/h.

The bounded raymarch integrates extinction and in-scattering. Sun self-shadow
samples follow the actual remaining cloud-layer path. A forward/backward
phase mixture and two broadened scattering-order approximations soften dark
interiors. This is not an exact water-droplet Mie solution. Deterministic
midpoint samples remove camera-dependent random flicker.

Existing Intel-friendly budgets remain unchanged: Low 16 primary / 2 light
samples and 250k pixels; Medium 28 / 2 and 500k; High 44 / 3 and 900k.
No continuous redraw is introduced. Higher quality improves sampling and
resolution; native integrated-GPU performance must still be measured.

## Celestial effects and composition

`viewport/celestial-effects.js` contributes Stars, Moon and Aurora before
cloud transport. Clouds therefore attenuate them. The local rain-shaft
Rainbow contribution follows the cloud pass. The reflection probe uses the
same shader and layer state, so enabled celestial effects also enter its sky
reflections. This is sky-only reflection; other scene objects are not reflected.

- **Stars:** seeded procedural positions distributed over solid angle, a
  magnitude/flux relation `10^(-0.4m)`, colour-temperature tints and a small
  point-spread texture. Count is bounded to 12,000. The 2048×1024 RGBA atlas
  is about 8 MiB and is generated only when enabled count/seed changes.
  This is **not** a real star catalogue, sidereal clock or constellation model.
- **Moon:** a spherical angular disc, continuous illuminated terminator,
  procedural albedo/crater variation, earthshine and a phase-dependent ambient
  contribution. Position and phase are art directed, not an astronomical
  lunar ephemeris or a calibrated photometric lunar model.
- **Aurora:** bounded ray intersections with three folded emission sheets,
  irregular striation, height-dependent green/red/violet emission and
  timeline-driven movement. Green/red altitude choices follow oxygen emission
  observations. This is a procedural preview, not a magnetosphere simulation
  or a space-weather forecast.
- **Rainbow:** stationary Snell-law primary/secondary deflection, a Cauchy
  approximation for water dispersion and seven RGB spectral bands. Geometry
  is observer-relative around the anti-Sun vector; primary colour order is
  reversed in the secondary bow. Density/intensity adds translucent light.
  No exact Mie spectrum, droplet size distribution, polarization or
  supernumerary/interference fringes is implemented.

The independent `moon`, `stars`, `aurora` and `rainbow` roots live in the
State Store. Projects and autosaves gain disabled defaults without replacing
existing fields. Old captured graph bases also gain these defaults, so
disconnecting a new effect restores its original direct state. Each effect
has a real graph node/socket and timeline tracks. The default six-node graph
is preserved; add an effect node and connect it to its SkyScene input.
Direct edits, graph authority, timeline overlays, cancellation and committed
project snapshots keep their existing precedence/history rules.

## Validation

Run `npm test` for portable numerical, history, migration, graph and animation
checks. Run `node scripts/validate-celestial.cjs` with a running gateway and
Playwright installed **outside** the project for actual shader/readback/UI
verification. Optional `PLAYWRIGHT_EXECUTABLE_PATH`, `PLAYWRIGHT_MODULE`,
`SKYFORGE_TEST_URL` and `SKYFORGE_TEST_OUTPUT` follow the existing browser gates.

The celestial gate checks atmosphere-cache reuse, fixed cloud budgets, seed
effects, daylight/night visibility, Moon phases and cloud occlusion, animated
Aurora, both rainbows and their geometry, numeric gesture history, rail input
ownership, no new physical requests, project/autosave state, idle rendering
and deletion of added GPU textures. CI also runs all four pre-existing
viewport/Studio/preview/lighting gates and portable tests on Linux, Windows,
macOS Apple Silicon and macOS Intel. Linux GPU tests use actual WebGL 1 via
ANGLE SwiftShader; they do not certify native Intel/Apple/Windows GPU drivers.

The offline HDR/EXR renderer, OCIO and fully calibrated spectral export remain
separate unfinished milestones. This change does not upgrade the export queue
or fabricate DCC bridges.

## Primary technical references

- [Bruneton & Neyret, Precomputed Atmospheric Scattering (reference implementation)](https://ebruneton.github.io/precomputed_atmospheric_scattering/),
  including [transport equations](https://ebruneton.github.io/precomputed_atmospheric_scattering/atmosphere/functions.glsl.html).
- [Hillaire 2020, A Scalable and Production Ready Sky and Atmosphere Rendering Technique](https://doi.org/10.1111/cgf.14050):
  compact sky-view/transmittance caches and approximate multiple scattering.
  This project implements its own bounded RGB integrator, not the paper's
  complete production solver.
- [PBRT v4, Phase Functions](https://www.pbr-book.org/4ed/Volume_Scattering/Phase_Functions):
  normalized Henyey–Greenstein phase and direction conventions.
- [Jung 2015, Three-dimensional graphic physically based simulator of rainbows together with the background scene](https://doi.org/10.1364/AO.54.001926):
  rain-shaft scattering and observer/Sun geometry. Our seven-band preview is
  substantially simpler than the simulator described in the paper.
- [NASA, Aurora colours and emission heights](https://science.nasa.gov/sun/auroras/),
  and [red/green oxygen emissions](https://www.nasa.gov/image-article/red-green-aurora-australis/).
