# Dump Assembly-CSharp

The decompiled `Assembly-CSharp` folder is useful for protocol and gameplay research, but it is local-only and ignored by git.

## ILSpy Command Line

```powershell
dotnet tool install --global ilspycmd
$managed = "C:\Program Files (x86)\Steam\steamapps\common\CounterSide\Data\Managed"
ilspycmd -p -o .\Assembly-CSharp "$managed\Assembly-CSharp.dll"
```

Useful files to inspect after dumping:

- `Assembly-CSharp\NKC\NKCGameClient.cs`
- `Assembly-CSharp\NKC\NKCGameServerLocal.cs`
- `Assembly-CSharp\NKM\NKMGame.cs`
- `Assembly-CSharp\NKM\NKMGameServerHost.cs`
- `Assembly-CSharp\ClientPacket\Game\*.cs`

## dnSpyEx GUI

1. Open `CounterSide\Data\Managed\Assembly-CSharp.dll`.
2. Right-click the assembly.
3. Choose `Export to Project`.
4. Export to `RevivalSide\Assembly-CSharp`.
5. Do not add the dump to git.

## Runtime Patch Notes

`combat-host\ManagedAssemblyPatcher.cs` patches a local cache copy of your installed `Assembly-CSharp.dll` when the combat host starts. The cache is generated under `combat-host\bin\...\patched-managed` or `combat-host\bin\host-cache\...\patched-managed` and is ignored by git.
