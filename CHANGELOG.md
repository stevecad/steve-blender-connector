# Changelog

## Unreleased

- Show geometry-only or imported-motion status beside the new collection in the panel, with its source, clip and frame range.
- Persist motion import status on Blender collections and return explicit geometry and motion provenance in action results.

## 0.1.2 — 2026-10-18

First public release.

- Import STEVE parts and assemblies into current or new Blender scenes through the Blender Lab MCP bridge.
- Preserve separate meshes, placement, dimensions and basic face colours.
- Bake supported STEVE joint animations and couplings, or import self-contained animated GLB files locally.
- Publish a STEVE panel for imports, status and uniquely named Blender-file copies.
- Start manually by default; optional macOS login service.
- Verify signed requests and file hashes; persist handled runs and never retry an uncertain scene mutation.
- Fix stranded runs after initial-report failures, stale panel run events and mixed face colours.
- Remove inherited printer-preparation code; document the required Blender extension and release process.
- Add CI for Node 22/24 across macOS, Linux and Windows, and validate the public release allowlist.

## 0.1.1 — 2026-10-18

Local validation build: manual macOS launcher, reporting/panel/material regressions fixed, isolated Blender adapter tests.

## 0.1.0 — 2026-10-18

Initial local implementation and live STEVE-to-Blender validation. Not published.
