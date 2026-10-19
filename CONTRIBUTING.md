# Contributing

Use Node.js 22 or 24 and install dependencies with `npm ci --ignore-scripts`.

Run `npm run check`, `npm test`, and `python3 test/motion_test.py` before submitting a change. These checks need no Blender instance or STEVE account. GitHub Actions runs them on Linux, Windows and macOS.

For Blender adapter changes, run the isolated runtime tests in a separate background Blender process:

```sh
blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python test/blender_adapter_test.py
```

The optional `node scripts/smoke-blender.js` uses a live Blender bridge. It creates and removes its own test scene. Close or save other work first, and never run it while the connector is accepting an action. Separate offline tests, background Blender tests and live STEVE validation in change descriptions.

Keep changes small. Follow `.editorconfig` and `.prettierrc.json`; formatting is optional tooling, not a runtime dependency. Preserve LICENSE and NOTICE when adapting upstream code.

Keep the public action catalog restricted to fixed operations. Preserve signature verification, durable run acceptance, duplicate prevention, unit conversion and existing scene contents. Unsupported motion must fail clearly instead of producing a partial animation. Configuration, signing keys, state, logs and generated CAD or Blender artifacts stay local.

New distributable files belong in `release-files.json`. `npm run release:prepare` creates a clean source tree, ZIP, SHA-256 checksum and file manifest. It refuses private paths, symlinks and existing destinations. See [release steps](docs/releasing.md).
