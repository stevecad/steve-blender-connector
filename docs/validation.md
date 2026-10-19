# Validation evidence

Validated locally on 2026-10-18 with Blender **5.3.0 Alpha** and Node **26.8.2** on macOS. Node 22+ is the intended runtime; other Node versions, operating systems and Blender builds have not been tested here.

## Offline

- JavaScript syntax and configuration checks passed.
- The initial 22 Node tests passed: signature verification, persistent replay prevention, queued terminal results, early cancellation, input integrity, 3MF bounds and separation, malformed ZIP/XML rejection, external GLB resources rejected, loopback restriction, fragmented bridge messages, request serialization and unknown timeout without retry.
- Four Python motion tests passed: coupling ratios and base offsets, hold keys, smoothstep easing, cyclic/non-finite input and unsupported motion rejection.

## Live Blender

The opt-in smoke test imported two bodies into a new scene, measured an assembly width of 22 mm, baked a one-second slider movement at 24 fps, measured 20 mm travel at frame 25, verified the original scene’s object count, refused animation overwrite and saved a unique `.blend` copy. The test then removed only its own scene.

## STEVE end to end

The paired connector's status, 3MF import and apply-motion actions succeeded through STEVE's signed run queue. A 14-part gripper test design arrived as 14 distinct meshes, approximately 130 × 142.997 × 124.500 mm. Its actual `open_close` animation was transferred with explicit instance mappings:

- 11 animated objects, 217 samples, frames 1–217 at 24 fps, 9 seconds between endpoints.
- Jaw and attached pad X travel: 0 mm at frame 1, 19 mm at frame 49, 38 mm at frames 97 and 121, and 0 mm at frame 217.
- The scroll disc and hub rotate together; the three radial sliders use the source coupling ratios.
- Original `Scene` still contains Cube, Camera and Light.
- Closed and open rendered stills were inspected. Presentation camera, lights and display materials were added only for this demonstration; these are not claimed to come from the 3MF.

## Additional integration checks

- Animated GLB round-trip through the local CLI retained 14 meshes, frames 1–217 and the jaw positions at closed/open/closed. This fixture was exported from Blender; a STEVE-generated GLB was not separately tested.
- A second independent Blender process reopened the saved demo with automatic script execution disabled, read both scenes, counted 11 animated objects and measured 38.000003 mm jaw travel at frame 97.
- The published panel was inspected in Safari: connected state, current scene, destination controls and open document revision were visible. A real document import was submitted from its click handler; STEVE subsequently requested its separate document-sharing confirmation. After confirming, the panel run succeeded and inserted all 10 components of a second test assembly into its own Blender scene.
- The macOS login service was installed with explicit approval and verified running as `studio.steve.blender-connector`; its live status was reported to STEVE after startup.
- Import into an existing scene with unit scale 0.001 also retained the 22 mm fixture width.

## Limits

This validates visual mesh and sampled rigid-body animation transfer. It does not validate CAD constraints, physics, manufacture, collision safety or physical operation. STEVE's motion checks are not rerun in Blender. Smoothstep is the connector's interpretation of `ease`; exact correspondence at every fractional timestamp has not been compared against STEVE's viewer.

STEVE’s connector protocol does not supply animated GLB or automatically attach kinematics. The panel sends geometry; motion requires matching JSON supplied by an agent or pasted by the person. Direct metadata transfer supports revolute/slider/rigid joints and their couplings. Drives, cylindrical joints and exploded views require the local Animated GLB route.

## Release regression suite

The 0.1.2 source passes 30 Node tests, four Python motion tests and three isolated background Blender adapter tests locally. The adapter tests cover mixed face colours, rollback of a failed geometry-plus-motion import, and importing into an existing scene with millimetre units. Release tests check a clean allowlisted tree, excluded private files, refused symlinks and the manual launcher's executable permission.

CI runs the offline checks on Node 22 and 24 across macOS, Linux and Windows. Blender runtime and live STEVE tests remain separate; the hosted CI matrix does not install Blender or access a STEVE account.

Manual startup is the default. Installing a login service is an explicit optional step. The locally validated service was also successfully unloaded to return to manual operation.
