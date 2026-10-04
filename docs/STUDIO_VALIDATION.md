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

Set `SKYFORGE_EXPECT_VOLUMETRIC=1` when validating the GPU volume increment. That mode requires the real volumetric pass, exercises Low/Medium/High quality, checks bounded buffers and sample counts, verifies animated volume pixels, and switches to the existing cloud layer fallback. It records draw plus GPU readback wall time; these measurements are not frame-rate promises.

The gate checks actual framebuffer pixels separately for implemented Sun, Atmosphere, Clouds and ColorGrade output. It rejects graph type errors and cycles atomically, checks one history entry per scene/node/keyframe gesture and no entries per playback frame, and observes physical-lighting requests during playback. Preview exposure has its own numeric Sky inspector control, with committed-only export and Escape cancellation. Browser calls and the gate lifetime are bounded; browser cleanup runs even if writing artifacts fails, with process ownership limited to the gate's isolated browser. The hidden-document condition is simulated because headless Chrome keeps its tabs visible; the real visibility listeners pause playback and GPU submission.

Artifacts include `studio-results.json`, `studio-workspace.png` and `studio-webgl-preview.png`. The PNG is identified as an image of the display preview. It does not represent an HDR/EXR export, an ACES/OCIO implementation or a production renderer.

The existing `scripts/validate-viewport.cjs` remains the detailed navigation, Sun gizmo, reference persistence, context loss and Legacy View regression gate. `npm test` checks the portable service, geometry and transaction tests.

## Results

Workspace unit tests: 5 passed. The integrated Studio gate passed all seven stages with exit code 0 in installed Chrome on the Mac, using WebGL 1 through ANGLE Metal on Intel Iris Plus Graphics 645, with no WebGL errors. The run exercised numeric and gizmo move/rotation/scale, local axes, gesture cancellation and history, graph edits and rendered pixels, nine animated tracks, playback, portable project download/open, autosave reload, layout persistence, preview capture and actual GPU buffer/program disposal.

The captured `skyforge-webgl-preview.png` was 894 × 544 pixels and 304,958 bytes. Playback added no Undo entries and no Natural Light evaluation requests. The test uses an isolated browser profile and dismisses the separate legacy recovery message through its real button while verifying that its snapshot remains stored.

This editor-stage run used the existing procedural cloud layer. It does not claim volumetric validation until the separate GPU volume increment is connected and the gate runs with `SKYFORGE_EXPECT_VOLUMETRIC=1`.

The detailed viewport regression gate also passed with exit code 0 on the same native GPU. Its original workspace viewport was 848 × 627 pixels. Navigation, Sun gestures and physical/manual separation, reference picking and translation, one Undo per gesture, Escape, project/autosave compatibility, rendering at rest, context loss/recovery, fallback and disposal remained functional.

The isolated cloud prototype was measured on Intel Iris Plus 645 with an 848 × 669 CSS viewport at DPR 2. Seven draw plus readback samples gave medians of 38 ms / 249,528 pixels for Low, 95 ms / 499,888 pixels for Medium and 212 ms / 899,256 pixels for High. These are preliminary per-draw measurements of that specific view; the integrated gate records its own dimensions and timings.
