# Releasing

1. Review the public files and update the version in `package.json`, `package-lock.json` and the panel footer. Record user-visible changes in `CHANGELOG.md`.
2. Run `npm run check`, `npm test` and `python3 test/motion_test.py`. Run the isolated Blender adapter tests for Python adapter changes.
3. Run `npm run release:prepare` from a clean checkout. The versioned destination must not already exist. Review its `manifest.json`, source tree and ZIP; include only files in `release-files.json`.
4. Commit the public files, push to GitHub, and wait for every CI matrix job to pass on that commit.
5. Tag that tested commit and create a GitHub release. Attach the source ZIP, `SHA256SUMS` and `manifest.json`.

Never stage with an unrestricted `git add .` from an installation that contains local state. Review the staged file list and diff before committing. Do not publish `config.json`, data directories, private keys, exported models, renders or logs.

Updates to an installed connector happen only when it is idle. Stop the manual process after its accepted runs finish, replace the public source files, run `npm ci --ignore-scripts`, and start it again. Preserve the installation's ignored config and data directories. Do not enable automatic login startup as part of an update.
