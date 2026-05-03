# CounterSide Server Data

This folder is for local generated data and replay fixtures. It is ignored by git except for this README and `.gitkeep`.

Generated from parsed `StreamingAssets/ab_script*` Lua table bytecode:

- `units.json`: unit templates merged with stat templates, indexed by unit id and string id.
- `items.json`: item/equipment/piece tables grouped by table name.
- `dungeons.json`: dungeon base templates indexed by dungeon id and string id.
- `warfare.json`: warfare templates indexed by id and string id.
- `strings.json`: localized string tables by language code.
- `table_catalog.json`: every parsed table with relative source path and detected ID fields.

Capture-derived fixtures also live here:

- `captured-flows/`: HTTP mirror responses.
- `captured-tcp/`: contents/login TCP fixtures.
- `captured-game-flow/`: game-stream client/server packet fixtures.

Regenerate all of this from your own client and captures. Do not commit the generated files.
