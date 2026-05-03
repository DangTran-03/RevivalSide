# Prebuilt Combat Host

This folder contains RevivalSide-built `CombatHost` binaries from:

```powershell
dotnet publish .\combat-host\CombatHost.csproj -c Release --nologo -o .\prebuilt\combat-host
```

Use this DLL by setting:

```powershell
$env:CS_CSHARP_COMBAT_HOST_DLL = ".\prebuilt\combat-host\CombatHost.dll"
```

These are project binaries only. CounterSide managed DLLs are loaded from each contributor's local install and patched into an ignored runtime cache.
