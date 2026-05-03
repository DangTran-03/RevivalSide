using System.Reflection;

namespace RevivalSide.CombatHost;

// Called by the patched combat-host copy of Assembly-CSharp.dll.
//
// The original NKMLua.LoadCommonPathBase falls through into Unity TextAsset /
// AssetBundle APIs. In this standalone host we already have decrypted gameplay
// tables on disk, so the patched method delegates here instead.
public static class ManagedLuaFileLoader
{
    private static readonly object Gate = new();
    private static string gameplayTablesDir = "";
    private static FieldInfo? luaServerField;
    private static FieldInfo? fileNameForDebugField;
    private static MethodInfo? luaDoByteString;
    private static MethodInfo? luaDoTextString;

    public static void Configure(string tablesDir)
    {
        lock (Gate)
        {
            gameplayTablesDir = string.IsNullOrWhiteSpace(tablesDir) ? "" : Path.GetFullPath(tablesDir);
        }
    }

    public static bool LoadCommonPathBase(
        object nkmlua,
        string bundleName,
        string fileName,
        bool bAddCompiledLuaPostFix,
        bool bUseDevScript,
        ref string errorMessage)
    {
        try
        {
            if (TryLoad(nkmlua, bundleName, fileName, out errorMessage))
            {
                return true;
            }

            if (bUseDevScript && TryLoad(nkmlua, bundleName, fileName + "_DEV", out errorMessage))
            {
                return true;
            }

            errorMessage = $"dumped Lua table not found: bundle={bundleName} file={fileName}";
            return false;
        }
        catch (Exception ex)
        {
            errorMessage = ex.ToString();
            return false;
        }
    }

    private static bool TryLoad(object nkmlua, string bundleName, string fileName, out string errorMessage)
    {
        errorMessage = "";
        var candidate = FindLuaFile(bundleName, fileName);
        if (candidate == null)
        {
            return false;
        }

        EnsureReflection(nkmlua);
        fileNameForDebugField?.SetValue(nkmlua, fileName);
        var luaServer = luaServerField?.GetValue(nkmlua);
        if (luaServer == null)
        {
            errorMessage = "NKMLua.m_LuaSvr was not available";
            return false;
        }

        var bytes = File.ReadAllBytes(candidate);
        var chunkName = Path.GetFileNameWithoutExtension(candidate);
        if (IsLuaBytecode(bytes))
        {
            luaDoByteString?.Invoke(luaServer, new object?[] { bytes, chunkName, "b" });
        }
        else
        {
            luaDoTextString?.Invoke(luaServer, new object?[] { File.ReadAllText(candidate), chunkName });
        }

        return true;
    }

    private static void EnsureReflection(object nkmlua)
    {
        if (luaServerField != null) return;
        lock (Gate)
        {
            if (luaServerField != null) return;
            var luaType = nkmlua.GetType();
            luaServerField = luaType.GetField("m_LuaSvr", BindingFlags.NonPublic | BindingFlags.Instance);
            fileNameForDebugField = luaType.GetField("fileNameForDebug", BindingFlags.NonPublic | BindingFlags.Instance);
            var luaServerType = luaServerField?.FieldType;
            if (luaServerType == null) return;
            luaDoByteString = luaServerType.GetMethod(
                "DoString",
                BindingFlags.Public | BindingFlags.Instance,
                null,
                new[] { typeof(byte[]), typeof(string), typeof(string) },
                null);
            luaDoTextString = luaServerType.GetMethod(
                "DoString",
                BindingFlags.Public | BindingFlags.Instance,
                null,
                new[] { typeof(string), typeof(string) },
                null);
        }
    }

    private static string? FindLuaFile(string bundleName, string fileName)
    {
        if (string.IsNullOrWhiteSpace(gameplayTablesDir) || !Directory.Exists(gameplayTablesDir))
        {
            return null;
        }

        var bundle = bundleName.ToLowerInvariant();
        var file = Path.GetFileName(fileName);
        foreach (var source in new[] { "StreamingAssets", "Assetbundles" })
        {
            foreach (var extension in new[] { ".luac", ".lua", ".bytes" })
            {
                var candidate = Path.Combine(gameplayTablesDir, source, bundle, "luac", file + extension);
                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }
        }

        return null;
    }

    private static bool IsLuaBytecode(byte[] bytes)
    {
        return bytes.Length >= 4 && bytes[0] == 0x1b && bytes[1] == (byte)'L' && bytes[2] == (byte)'u' && bytes[3] == (byte)'a';
    }
}
