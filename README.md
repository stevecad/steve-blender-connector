# steve-blender-connector

Connect STEVECAD to a running Blender instance through the **Blender Lab MCP extension**. STEVE sends signed connector actions over HTTPS; the local process sends fixed import operations to the extension’s loopback JSON bridge. The connector talks directly to that bridge; a separate LLM client or stdio MCP server is optional.

The connector adds a **Blender** panel to STEVE. Insert the open part or design into the current Blender scene or a new scene. Each import gets a separate collection; existing objects remain. Imported CAD is editable mesh geometry, not a parametric CAD history.

## What works

- Separate 3MF bodies with their names, modelled placement, dimensions and basic face colours.
- Current or new scene, with a named existing scene available through the action API.
- STEVE keyframed revolute, slider and rigid-joint animation, including coupled joints and attached children, baked into Blender keyframes.
- Local self-contained Animated GLB import through Blender’s glTF importer.
- Live scene status and uniquely named `.blend` copies in `data/exports/`.
- Signed STEVE requests, checked input hashes, serialized Blender requests, durable duplicate-run prevention and unknown-outcome reporting. A timed-out scene mutation is never retried automatically.

## Animation boundary

STEVE’s documented connector file formats currently include **3MF but not animated GLB**. 3MF carries geometry only. A panel import is static unless matching motion JSON is supplied; it never silently claims animation was transferred.

For agent-assisted animation, read `read_design(document_id=…, detail="kinematics")`, then call this connector’s `import_model` with `motion`, or `apply_motion` for an existing `import_id`. The motion payload is:

```json
{
  "document_id": "the source document id",
  "revision": 2,
  "kinematics": {
    "version": 1,
    "units": { "angle": "deg", "length": "mm" },
    "joints": [],
    "couplings": [],
    "animations": []
  },
  "clip": "open_close",
  "part_map": { "part-6": "jaw_0" }
}
```

Use the actual kinematics from STEVE. `part_map` explicitly maps the part IDs returned by import to STEVE instance names when display names differ (for example `jaw 0` versus `jaw_0`). All joint parents and children must resolve. Document and revision must match. Multiple clips require an explicit selection. An import’s existing animation is never replaced; import into another collection to try another clip.

Motion is sampled at the destination scene’s frame rate, up to 600 seconds and 500,000 joint samples. `ease` uses smoothstep; `linear` uses linear interpolation. The original loop flag is recorded; use Blender’s playback range to repeat it. This is a rigid-body visual transfer, not a transfer of physics, collision qualification, constraints, or drivers.

For **driven motors, cylindrical joints, exploded views**, or an exact export of STEVE’s sampled motion, choose **Motion → Export → Animated GLB** in STEVE, then run locally:

```sh
node import-glb.js /absolute/path/to/design-motion.glb --new-scene
```

Omit `--new-scene` to insert in the current scene. External GLB resource paths and URLs are refused. No remote action can supply a local path or arbitrary Python.

## Install

Requirements: **Node.js 22 or newer**, **Blender 5.1 or newer**, and the official **Blender Lab MCP** extension. Local Blender validation used **5.3.0 Alpha with MCP 1.0.3**; see [validation evidence](docs/validation.md). The connector needs Blender's glTF importer for local GLB files.

1. Install Blender and Node.js.
2. Open the [official Blender Lab MCP page](https://www.blender.org/lab/mcp-server/). Install its **MCP** add-on by dragging the installation button into Blender, or downloading the add-on and choosing **Install from Disk** in Blender's extension preferences. The drag-and-drop route first adds the Blender Lab repository, then installs the add-on on the second drop.
3. In Blender's preferences, enable **MCP** and expand its settings. Keep the host on loopback and the port at **9876**. Click **Start MCP Bridge Server** if it says the server is stopped. The add-on's Auto Start option controls its bridge when Blender opens; it is separate from starting this connector.
4. Download a [source release](https://github.com/stevecad/steve-blender-connector/releases) and unpack it, or clone this repository. Run the following in its folder:

```sh
npm ci --ignore-scripts
node setup.js
```

Setup should print `"connected": true` and the active Blender scene. The extension must be the Blender Lab implementation linked above; similarly named add-ons can use a different protocol.

`setup.js` creates ignored `config.json` if absent, then checks Blender. Adjust the port there if necessary. The unauthenticated Blender bridge must remain bound to loopback, not a LAN address.

## Pair and use

1. In STEVE, enable its API and obtain a pairing code under Settings → Connectors.
2. Run `node connector.js --pair CODE` and confirm the exact locally printed fingerprint in STEVE.
3. Allow status, import, animation and save-copy for the callers you want, including the panel.
4. Leave `npm start` running. Open the **Blender** panel in STEVE, choose a destination and click **Insert into Blender**.

The panel’s document action runs directly from your click. STEVE may ask once before letting the panel send the open document. Select its “Don’t ask again” option if desired; that document-sharing permission is separate from action permissions. STEVE may take several minutes to prepare a document before returning a run or confirmation; the button stays disabled and the request is not repeated. Changing the open document/revision clears pasted motion metadata. Buttons stay disabled until a pending run ends.

After a successful import, the result card shows the new collection name beside **Geometry only** or **Motion imported**. Its summary identifies whether motion came from a STEVE payload or a GLB; a STEVE payload also names the clip and frame range. A plain 3MF import explicitly says that no motion payload was supplied. Raw JSON remains available under **Technical details**.

The result retains `animation_imported` and adds `geometry_source`, `motion_source` (`none`, `steve_payload`, or `glb`) and `motion_summary`. Blender also stores `steve_animation_imported`, `steve_motion_source` and `steve_motion_summary` on the collection. Adding motion later updates those collection properties and returns the same explicit status.

All scenes remain in the same Blender session. “New scene” adds a scene in that session; it does not close the current `.blend`. Save a copy from the panel or save normally in Blender. The computer must stay awake, the connector must run, and Blender must have its MCP bridge started. When Blender closes, the connector stays online and reports Blender offline.

For manual startup on macOS, double-click **start-connector.command**. Keep its Terminal window open and press **Ctrl-C** to stop. Open Blender separately. From a shell, `npm start` does the same thing.

Automatic login startup is optional. To opt in after pairing:

```sh
sh service/macos/install.sh
```

This installs the login LaunchAgent `studio.steve.blender-connector`. It restarts the connector if it exits; Blender itself is opened separately. Remove it with:

```sh
launchctl bootout gui/$(id -u)/studio.steve.blender-connector
rm ~/Library/LaunchAgents/studio.steve.blender-connector.plist
```

The LaunchAgent must not overlap a manually started connector. Stop the manual process after its runs finish before installing it. State, the private signing key, logs, imported meshes and `.blend` copies remain in ignored `data/`; never publish that directory. The local GLB CLI uses `data-local/`.

## Troubleshooting

- **Panel says Offline:** keep the manually started connector running, open Blender, and start the extension's bridge. `node setup.js` checks the local connection.
- **Import waits:** STEVE may be preparing the file or waiting for document-sharing confirmation. Check its waiting indicator; do not submit the same import again.
- **Small or invisible model:** imported dimensions are preserved. Select its collection and use Blender's **View → Frame Selected**.
- **Lost or timed-out response:** inspect Blender before submitting another run. The same run is never retried automatically.
- **Animation mapping fails:** use the `part_map` in the animation notes above; display names can differ from STEVE's instance IDs.

## Development

```sh
npm run check
npm test
python3 test/motion_test.py
blender --background --factory-startup --python-exit-code 1 --python test/blender_adapter_test.py
node scripts/smoke-blender.js   # opt-in live Blender test, creates/removes its own test scene
npm run release:prepare
```

`release:prepare` builds a clean source tree, ZIP, SHA-256 checksum and per-file manifest from `release-files.json`, excluding private state and generated models. See [contributing](CONTRIBUTING.md), [release steps](docs/releasing.md) and [changes](CHANGELOG.md). The original MIT license and upstream attribution are in [LICENSE](LICENSE) and [NOTICE](NOTICE).

References: [STEVE connector protocol](https://stevecad.studio/docs/developers/connectors/), [STEVE motion exports](https://stevecad.studio/docs/assemblies/export-motion/).
