# Contributing

Keep the repo source-first and reproducible.

## Do Commit

- Listener, packet handlers, combat host source, and tooling.
- Small generated references that are useful to review, such as `packet-schema.json`.
- Documentation and setup scripts.
- Project-built RevivalSide binaries under `prebuilt/` when intentionally refreshed.

## Do Not Commit

- `Assembly-CSharp/` decompiler output.
- `Assembly-CSharp.dll` copied from a CounterSide install, original or patched.
- `server-data/` generated JSON, captures, manifests, or `users.json`.
- `captures/`, `*.pcapng`, `*.packet.bin`, `*.payload.bin`.
- `gameplay-tables*`, `decrypted-assets/`, or `extracted-assets/`.
- Visual Studio, Node, or .NET build folders.

## Before Pushing

```powershell
npm run check:listener
npm run check:handlers
npm run build:combat-host
git status --ignored -s
```

If `git status --ignored -s` shows local client data as tracked or unignored, stop and fix `.gitignore` before pushing.
