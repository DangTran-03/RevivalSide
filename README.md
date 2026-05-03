# RevivalSide

RevivalSide is a local CounterSide revival research server. It includes the Node.js TCP listener, packet handlers, capture tooling, a C# combat-host bridge, and project-built combat-host binaries.

This repository intentionally does not track client assets, raw packet captures, decompiled `Assembly-CSharp` source dumps, decrypted Lua table output, account databases, or raw game DLLs. Each collaborator generates those locally from their own installed client.

## What Is Tracked

- `cs-listener.js`: TCP listener, packet framing, HTTP mirror, login/session glue.
- `packet-handlers/`: request handlers for login, lobby, battle, cutscene, and utility packets.
- `combat-handler/`: Node-side combat session orchestration and bridge into the C# host.
- `combat-host/`: C# local combat host and managed assembly patcher.
- `prebuilt/combat-host/`: published RevivalSide combat host binaries.
- `tools/`: capture, table extraction, packet schema, and setup helper scripts.
- `stages/`: hand-authored stage definitions used by current tutorial work.
- `packet-schema.json`: generated protocol reference used for packet work.

## Quick Start

Read [docs/setup.md](docs/setup.md) first. The short version is:

```powershell
git clone https://github.com/MadlyMoe/RevivalSide.git RevivalSide
cd RevivalSide
copy .env.example .env
npm install
npm run build:combat-host
```

Then generate your local table data and captures, patch hosts from an elevated PowerShell prompt, and run:

```powershell
npm run listen
```

The default listener uses TCP `127.0.0.1:22000` and HTTP mirror `http://127.0.0.1:8088`.
