# SkyForge Studio validation

The Studio gate exercises the existing application and GPU shaders through an isolated browser profile. It creates sphere/cube/plane reference geometry, edits numeric transforms, uses move/rotate/scale handles, checks cancellation and Undo/Redo, configures the graph through node parameters and sockets, animates Sun/clouds/exposure/transforms, plays the timeline, saves and reopens a project, restores autosave and captures a PNG image of the WebGL preview.

Run the server with `npm start`, then run the gate using Playwright installed outside the project:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/node_modules/playwright \
SKYFORGE_TEST_OUTPUT=/tmp/skyforge-studio-results \
node scripts/validate-studio.cjs
```

On the Mac, use the installed Chrome and its native WebGL backend:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/node_modules/playwright \
PLAYWRIGHT_CHANNEL=chrome SKYFORGE_WEBGL_BACKEND=native \
SKYFORGE_TEST_OUTPUT=/tmp/skyforge-studio-native \
node scripts/validate-studio.cjs
```

Set `SKYFORGE_EXPECT_VOLUMETRIC=1` when validating the GPU volume increment. That mode requires the real volumetric pass, exercises Low/Medium/High quality, checks bounded buffers and sample counts, verifies animated volume pixels, and switches to the existing cloud layer fallback. It records draw plus GPU readback wall time; these measurements are not frame-rate promises. Each draw/readback is a separate browser evaluation with a 45-second bound for software GPU runners; ordinary UI evaluations retain their 20-second bound. The benchmark temporarily aims the camera into the cloud slab and restores the scene camera and animation frame before testing project persistence. Its isolated time comparison changes the frame without applying animated scene parameters, so that pixel difference tests the wind/time shader input.

The gate checks actual framebuffer pixels separately for implemented Sun, Atmosphere, Clouds and ColorGrade output. The preview now bounds cloud distance to 65–220 km according to layer altitude, without increasing sample counts. Very shallow horizon rays can still miss the layer. Gizmo gestures wait for the handles actually rendered for the current object, transform tool and layout, including slow GPU and resize updates. It rejects graph type errors and cycles atomically, checks one history entry per scene/node/keyframe gesture and no entries per playback frame, and observes physical-lighting requests during playback. Preview exposure has its own numeric Sky inspector control, with committed-only export and Escape cancellation. Browser calls and the gate lifetime are bounded; browser cleanup runs even if writing artifacts fails, with process ownership limited to the gate's isolated browser. The hidden-document condition is simulated because headless Chrome keeps its tabs visible; the real visibility listeners pause playback and GPU submission.

Artifacts include `studio-results.json`, `studio-workspace.png` and `studio-webgl-preview.png`. The PNG is identified as an image of the display preview. It does not represent an HDR/EXR export, an ACES/OCIO implementation or a production renderer.

The existing `scripts/validate-viewport.cjs` remains the detailed navigation, Sun gizmo, reference persistence, context loss and Legacy View regression gate. `npm test` checks the portable service, geometry and transaction tests.

## Natural preview and UI regression gate

Run `scripts/validate-preview-ui.cjs` with the same Playwright and server setup. It tests clouds in the unchanged startup camera, normal inspector density scaling, fractional restored values, Undo/Redo, all five cloud shapes, shared noon/sunset/night lighting, actual cloud shadows on references, accessible Studio menus, workspace reset, keyframe insertion, node authority, the Blender panel, project download/open, invalid file handling, keyboard ownership, Legacy workspace preservation and rendering at rest. It rejects application errors, WebGL errors and failed Natural Light responses. Optional web-font network failures and the exact unchanged photo assets omitted from a cloud text snapshot are recorded separately; CI uses the full repository checkout.

The detailed viewport gate still verifies the real physical evaluation at the current date/time. Its subsequent mesh-visibility checks use a fixed daytime Sun, so the clock cannot turn that geometry test into a night-lighting test. The dedicated preview/UI gate retains its explicit night checks.

The repair passed all 169 unit tests and all three browser gates using real WebGL 1 through ANGLE SwiftShader on Linux. In the new gate, clouds changed 81.8% of sampled startup sky pixels with no camera movement. Mean display luminance in the sampled sky region was 162.7 at noon, 103.2 at sunset and 6.1 at night; the reference region fell from 83.7 at noon to 1.5 at night. Under dense clouds, reference luminance fell from 100.7 to 82.0. These readbacks verify visible changes and shared illumination; they do not certify physical calibration or image quality on native hardware.

Low retained its 250,000-pixel and 16-step budget. The existing Studio gate also passed Medium and High, graph/timeline rendering, navigation, persistence, context recovery and resource disposal. Native Intel/Apple Silicon GPU performance for the repair still requires a target-machine run. No production HDR/EXR or OCIO output is certified by these checks.

## Lighting workbench validation

The lighting increment passed all 176 portable unit tests and the four real gateway/WebGL browser gates on Linux through ANGLE SwiftShader. Run `scripts/validate-lighting.cjs` with the same Playwright environment above. It adds the real reference bench through the menus, checks one Undo for the scene/camera transaction, edits presets and linear albedo, tests roughness preview/commit/cancellation and locking, downloads/reopens a project and duplicates its materials. It verifies actual shadow/probe pixels, cached passes and deletion of their GPU resources.

At Low quality, the bench used a 512 × 512 depth map and a 128 × 64 sky/cloud probe while retaining the existing 250,000 viewport-pixel cap. Toggling object shadows changed 0.96% of the whole viewport readback; the sampled unoccluded ground patch was identical with shadows enabled and disabled, guarding against self-shadow stripes. Overcast changed 48.44% of probe pixels and 73.83% of the sampled 16 × 16 chrome-sphere region. Clearing only the GPU probe, with Sun, cloud shadows and material fixed, changed all pixels in that chrome region. This isolates a real environment contribution rather than attributing all cloud-induced mesh changes to reflections.

Unchanged sky/scene draws and ordinary material edits reused the probe and depth map. Cloud edits rebuilt the probe and kept the object depth map; geometry edits rebuilt the depth map. The existing browser gates passed navigation, LUT/manual separation, idle rendering, context recovery, Legacy access, menus, graph/timeline editing, project/autosave and all three cloud quality modes. The Studio quality readbacks also record lighting target dimensions and require the GPU probe, with 128/192/256 width and bounded shadow-map sizes.

The measurements verify state ownership and visible rendered behavior. They do not certify physical radiometry, native Intel/Apple Silicon GPU performance, a GGX-prefiltered environment, production HDR/OpenEXR or OCIO. See [LIGHTING_WORKBENCH.md](LIGHTING_WORKBENCH.md) for the material/probe limits. Earlier native timings below belong to the earlier implementation.

## Historical native results — before the preview/UI repair

The measurements below belong to the published volumetric implementation at `8066cea8fa98e3fc9404c0164d913f5fab8a113f`. They do not certify the repaired shaders on native Intel or Apple Silicon GPUs. Re-run the gates on the target Mac to measure the new version.

Workspace unit tests: 5 passed. The integrated Studio volume gate passed all eight stages with exit code 0 in installed Chrome on the Mac, using WebGL 1 through ANGLE Metal on Intel Iris Plus Graphics 645, with no WebGL errors. The run exercised numeric and gizmo move/rotation/scale, local axes, gesture cancellation and history, graph edits and rendered pixels, nine animated tracks, playback, Low/Medium/High GPU volume rendering, time/wind pixels, the procedural layer, portable project download/open, autosave reload, layout persistence, preview capture and actual GPU buffer/program disposal. Disposal left no current GL program or pending animation frame; the isolated Chrome browser closed normally.

The captured `skyforge-webgl-preview.png` was 640 × 390 pixels and 95,993 bytes at Low quality. Playback added no Undo entries and no Natural Light evaluation requests. Four physical requests occurred across initialization and project lifecycle operations in the complete run. The test uses an isolated browser profile and dismisses the separate legacy recovery message through its real button while verifying that its snapshot remains stored. Native volume artifacts are in `/private/tmp/skyforge-studio-volume-native`.

Measured integrated volume performance used a 1440 × 1000 browser window at DPR 1 and a perspective camera with yaw 0.55, pitch -0.45, distance 12 m and target `[0, 0, 10]` m, aimed into the cloud slab. Each quality discarded one warmup draw and reported the median of five draw plus synchronous GPU readback wall times:

| Quality | Internal resolution | Pixels | March / shadow samples | Median draw + readback |
| --- | --- | ---: | ---: | ---: |
| Low | 513 × 486 | 249,318 | 16 / 2 | 31.4 ms |
| Medium | 726 × 688 | 499,488 | 28 / 2 | 63.8 ms |
| High | 880 × 834 | 733,920 | 44 / 3 | 97.7 ms |

These values describe this scene and view, including readback overhead. They are not sustained playback FPS. The renderer's separate `frameTimeMs` metric measures CPU command submission and must not be interpreted as GPU frame time. Low is the default on this target hardware. The 250,000 / 500,000 / 900,000 pixel caps and 16 / 28 / 44 sample limits keep the preview bounded; High did not reach its pixel cap in this viewport.

The detailed viewport regression gate also passed with exit code 0 after the integrated volume increment, explicitly selecting the procedural layer in the original workspace. Its original workspace viewport was 848 × 627 pixels. Navigation, Sun gestures and physical/manual separation, reference picking and translation, one Undo per gesture, Escape, project/autosave compatibility, rendering at rest, context loss/recovery, fallback and disposal remained functional. Its native artifacts are in `/private/tmp/skyforge-studio-volume-classic-native`.

The earlier editor gate passed all seven stages with the procedural layer. Its PNG was 894 × 544 pixels and 304,958 bytes. An isolated cloud prototype at DPR 2 previously measured 38 / 95 / 212 ms for Low / Medium / High in a different scene and larger view; the table above records the final integrated implementation and its explicit benchmark pose.
