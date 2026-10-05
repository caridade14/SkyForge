# Studio R16 — celestial rendering and a single Studio command surface

This increment continues from Studio R15 (`767dba0`), without rebuilding the
Core, cloud pass, physical request cancellation, animation graph or bridges.

## Visible controls

- **Sky layers → Moon → Real size · 0.52°** restores a natural apparent angular
  diameter in one undoable edit. The number field still allows deliberate art
  direction. A centred-disc readout reports its approximate pixel diameter.
- **Telephoto view** changes the lens to 20° and frames the Moon. It does not
  enlarge the Moon in world angular units. Undo restores the previous lens/view.
- **Sky effects** has four keyboard-accessible tabs and only one visible editor.
  Left/right arrows, Home and End navigate the tabs. Editing/Undo, timeline,
  node inputs, projects and autosave still use the existing State Store.
- The main **File / Edit / View / Sky / Scene / Animation / Nodes / Help** menus
  own the commands previously repeated in the top toolbar. Reference transforms
  live on the viewport rail. Transform orientation, workspace layouts, maximize
  and Legacy workspace remain on the compact toolbar. The viewport header keeps
  renderer, projection, reference sphere, sky source and cloud quality controls.
- Scene presets have one source, **Sky looks**. The former effects presets now
  delegate to these same recipes. The original DOM, handlers and tools reappear
  in Legacy workspace; the new UI does not clone or destroy them.

## Rendering changes

**Stars.** A seeded, solid-angle-uniform procedural catalogue stores offsets,
magnitudes and temperatures in a 512 × 256 RGBA8 texture (512 KiB, versus the
previous 8 MiB blurred atlas). It retains the brightest star if two entries
share a cell. Nine local catalogue-cell lookups reconstruct small point-spread
cores in display-pixel units. Magnitudes retain the `10^(-0.4m)` relation;
colours, atmospheric extinction, twilight and a bounded moonlight wash affect
the resulting relative RGB. Rotation remains fixed to world space, not the
camera. These are procedural stars, not measured constellation positions.

**Moon.** A lunar-Lambert mix of the Lommel–Seeliger single-scattering response
and Lambert response replaces a uniformly lit sphere. Fixed dark basins and
small crater rings replace the broad mottled noise. Phase/earthshine and cloud
occlusion are preserved. Surface detail is procedural, not an LRO texture or a
geographic reconstruction. Angular diameter and camera lens remain independent.

**Aurora.** Each folded emission curtain has a finite Gaussian cross-section.
Four bounded root-refinement steps locate a curtain; eight importance samples
integrate its local thickness, with a maximum of three curtains. Altitude bands
separate lower green, higher weak red and a small purple lower rim. Sheared,
multiscale structures vary along the emission volume and the existing timeline.
No new always-running animation or physical request loop is introduced. This is
an optically thin local emission approximation; it does not simulate plasma,
geomagnetic field lines or find every intersection with a self-overlapping fold.
The Aurora night look uses two narrower curtains with restrained intensity.

**Rainbow.** Seventeen wavelength samples (380–700 nm) use the existing Cauchy /
Snell stationary droplet angles. Their overlapping lobes are integrated in XYZ
using the Wyman–Sloan–Shirley CIE 1931 fit, then converted to relative linear RGB.
The primary/secondary colour orders stay opposite. Bounded rain-shaft variation
breaks the uniform bright contour. Single-reflection fill brightens the primary
cone interior; the gap between bows receives no added rainbow light, yielding
Alexander's band without a painted dark overlay. Rain amount zero still produces
exactly the unmodified sky. This is a geometric spectral preview, not full Mie
rain-droplet scattering, interference or a measured drop-size distribution.

## Budget and validation

The separated cloud pass, sample counts (16 / 28 / 44), pixel limits
(250k / 500k / 900k), 2M display cap and resource/context-loss ownership remain
unchanged. No production dependencies were added. Enabled aurora/rainbow branches
add bounded fragment work; native Intel/Apple/Windows GPU timing still requires
validation on those actual devices. Portable CI tests cover the OS matrix; the
headless WebGL gates run Chromium/SwiftShader.

`npm test` includes numeric angular projection, lunar response, catalogue
statistics/magnitude retention, spectral colour order and preservation of
existing scene data. `scripts/validate-celestial-realism.cjs` measures actual
Moon disc pixels at two lenses, star component sizes, emission/animation changes,
Alexander's band, real UI commands, edit history, idle rendering and disposal.
The six earlier WebGL/UI gates remain enabled and use the consolidated command
surfaces. CI retains screenshots and JSON results as artifacts.

The preview remains relative linear RGB with the existing display mapping. This
change does not add a calibrated professional HDR/EXR renderer or an OCIO pipeline.

## Primary references

- NASA [Moon apparent size](https://imagine.gsfc.nasa.gov/educators/programs/fermi/classroom/agn_guide.html).
- USGS ISIS [lunar photometric models](https://isis.astrogeology.usgs.gov/3.9.0/Application/presentation/Tabbed/photomet/photomet.html).
- NASA [red and green auroral altitude bands](https://www.nasa.gov/image-article/red-green-aurora-australis/).
- NOAA [auroral emission colours](https://sos.noaa.gov/catalog/datasets/aurora-3d/).
- Wyman, Sloan, Shirley, [CIE XYZ analytical fits](https://jcgt.org/published/0002/02/01/), JCGT 2013.
- MIT [rainbow caustics and Alexander's band](https://people.csail.mit.edu/fredo/comp-photo-book/02-fundamentals-01-light-and-physics.html).
