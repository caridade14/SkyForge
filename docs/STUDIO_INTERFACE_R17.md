# Studio R17 interface

The UI refresh starts from R16 (82ec0af), without replacing its renderer, State Store, project services or command dispatcher.

## Design and interaction

The current R16 workspace and File menu were opened and captured with Product Design before implementation. The direction keeps the existing workstation layout and amber identity while improving panel hierarchy, control sizes, text contrast and inspector grouping.

- Scoped presentation stylesheet: neutral surfaces, system fonts, larger controls, visible keyboard focus and useful scrollbars.
- Project name and modification status in the workspace bar.
- Scene search gets its own full-width row. The empty state explains how to add lighting reference geometry.
- Sky layers become labeled rows with enabled state; the same existing actions open their controls.
- Inspector sections gain distinct icons and aligned navigation. The original effects tabs remain.
- All eight menus and all 52 command names, labels, identifiers and ordering are retained.
- Menu keyboard support adds Left/Right, Home/End, roving focus and Tab dismissal alongside Up/Down and Escape.
- Fixed-position popups are clamped to the viewport and scroll on short screens. Closing menus on resize avoids stale geometry.
- Legacy restores its original DOM and event handlers; the R17 stylesheet has no rules that restyle Legacy controls.
- Disposal removes the new stylesheet and all owned menu listeners.

No production dependency, backend, shading model or project schema changes are required. npm start remains unchanged.

## Regression checks

The frozen R16 menu fixture protects the original public command surface. Unit tests cover the contract, keyboard edge cases and popup placement. The additional real-browser gate exercises command effects, Undo/Redo, all inspector sections, original editors, scene preservation across layout changes, viewport bounds at 1440/1280/760/390 widths, Legacy restoration and screenshots.

All seven existing browser gates remain in CI; the new interface gate runs in its own group. Portable CPU tests retain Linux, Windows, Apple Silicon and Intel macOS. Software WebGL CI cannot certify native GPU performance on a user's Mac.

## Verification record

The local execution environment became unavailable during implementation. The GitHub branch and CI are used to preserve and verify the final source. Do not infer a successful test or final visual review from this document alone; consult the workflow conclusions and their screenshot artifacts.
