# steve-blender-connector

Connect STEVE to a local Blender session through the Blender Lab MCP extension.
Preserve LICENSE and NOTICE. This connector never contacts a printer.
Manual startup is the default. Never install or enable a login service unless the person asks.
Prepare and test changes before updating an installation; do not modify an active accepted action.

- Only fixed local Blender adapter operations are exposed. Never accept Python from remote actions.
- Use loopback for the unauthenticated Blender Lab MCP bridge.
- Add into a new owned collection or a new scene. Never clear an existing scene, replace arbitrary objects, or overwrite an existing blend file.
- Use metres in Blender scenes with unit scale 1 and respect other scene unit scales; STEVE's 3MF geometry and joint origins are millimetres. Preserve placed geometry and source instance names.
- Persist run acceptance before any effect; never retry a run after an uncertain bridge response. One process per data directory; serialize Blender operations.
- STEVE's connector protocol does not offer animated GLB. Do not claim 3MF contains animation. Motion JSON must carry the matching document and revision, with explicit unambiguous part mappings.
- Panel document run calls belong directly in click handlers. Disable while pending and refresh context on document/revision changes.
- Credentials, state, keys and generated artifacts stay in ignored directories. Release only the explicit allowlist.
- Validate offline tests, then live Blender readback and renders separately. No physical print claims.
