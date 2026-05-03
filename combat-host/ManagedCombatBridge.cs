using System.Collections;
using System.Globalization;
using System.Reflection;
using System.Runtime.InteropServices;

namespace RevivalSide.CombatHost;

// Reflection bridge into the installed CounterSide Managed assemblies.
//
// The Node listener still owns sockets and packet order. This bridge owns the
// real in-process NKCGameServerLocal instance when the installed client DLLs are
// available, and drains the packets that the local server enqueues for the
// Unity client path.
internal static class ManagedCombatBridge
{
    private const int GameLoadAck = 804;
    private const int GameLoadCompleteAck = 808;
    private const int GameRespawnAck = 817;
    private const int GameSync = 822;

    private static readonly Dictionary<string, ManagedCombatSession> Sessions = new();

    public static bool TryStart(HostOptions options, StartBattleData data, DynamicGameState dynamicGame, out string? error)
    {
        error = null;
        if (string.IsNullOrWhiteSpace(options.ManagedDir) || string.IsNullOrWhiteSpace(data.GameLoadAckPayloadBase64))
        {
            return false;
        }

        var runtime = ManagedRuntime.TryLoad(options.ManagedDir, options.GameplayTablesDir, out error);
        if (runtime == null)
        {
            return false;
        }

        try
        {
            var gameLoadAck = runtime.DeserializePacket(GameLoadAck, Convert.FromBase64String(data.GameLoadAckPayloadBase64));
            var gameData = runtime.GetField(gameLoadAck, "gameData");
            if (gameData == null)
            {
                error = "managed GAME_LOAD_ACK contained null gameData";
                return false;
            }

            runtime.InitializeClientTables();

            var server = runtime.Create("NKC.NKCGameServerLocal");
            runtime.Invoke(server, "EndGame");
            runtime.Invoke(server, "Init");
            runtime.SetField(gameData, "m_GameUID", dynamicGame.GameUID);
            runtime.PrepareGameDataForLocalServer(gameData);
            var runtimeData = runtime.Invoke(server, "GetGameRuntimeData");
            if (!runtime.TryApplyDungeonGameTeamData(gameData, runtimeData, out error))
            {
                return false;
            }
            runtime.PrepareGameDataForLocalServer(gameData);
            runtime.Invoke(server, "SetGameData", gameData);
            if (runtimeData != null)
            {
                runtime.Invoke(server, "SetGameRuntimeData", runtimeData);
            }
            runtime.ClearClientQueue();

            var sessionId = dynamicGame.GameUID.ToString(CultureInfo.InvariantCulture);
            Sessions[sessionId] = new ManagedCombatSession(sessionId, runtime, server);
            dynamicGame.ManagedSessionId = sessionId;
            dynamicGame.ManagedCombat = true;
            return true;
        }
        catch (Exception ex)
        {
            error = ex.ToString();
            return false;
        }
    }

    public static bool TryBuildInitialSync(
        DynamicGameState? dynamicGame,
        BattleState? battleState,
        out HostResponse? response,
        out string? error)
    {
        response = null;
        if (!TryGetSession(dynamicGame, out var session, out error))
        {
            return false;
        }

        try
        {
            var packets = new List<HostPacket>();
            if (!session.Started)
            {
                packets.Add(session.BuildLoadCompleteAck());
                session.Start();
            }

            packets.AddRange(session.UpdateAndDrain(0.25f, 8));
            var sync = LastPayload(packets, GameSync);
            response = new HostResponse
            {
                Ok = true,
                BattleState = battleState,
                Packets = packets,
                PayloadBase64 = sync
            };
            return sync != null || packets.Count > 0;
        }
        catch (Exception ex)
        {
            error = ex.ToString();
            response = new HostResponse { Ok = false, Error = error };
            return false;
        }
    }

    public static bool TryHandleDeploy(
        DeployCommandData data,
        out HostResponse? response,
        out string? error)
    {
        response = null;
        if (!TryGetSession(data.DynamicGame, out var session, out error))
        {
            return false;
        }

        if (data.Req == null)
        {
            error = "deploy request required";
            return false;
        }

        try
        {
            session.EnsureStarted();
            var packets = session.HandleDeploy(data.Req);
            response = new HostResponse
            {
                Ok = true,
                DynamicGame = data.DynamicGame,
                BattleState = data.BattleState,
                Packets = packets,
                Deployed = new HostDeployResult
                {
                    Handled = true,
                    Mode = "managed-local-server"
                }
            };
            return true;
        }
        catch (Exception ex)
        {
            error = ex.ToString();
            response = new HostResponse { Ok = false, Error = error };
            return false;
        }
    }

    public static bool TryBuildSync(
        SyncCommandData data,
        out HostResponse? response,
        out string? error)
    {
        response = null;
        if (!TryGetSession(data.DynamicGame, out var session, out error))
        {
            return false;
        }

        try
        {
            session.EnsureStarted();
            var delta = (float)Math.Clamp(data.Delta ?? 0.25, 0.01, 1);
            var packets = session.UpdateAndDrain(delta, Math.Max(1, (int)Math.Ceiling(delta / 0.033333335f)));
            var sync = LastPayload(packets, GameSync);

            response = new HostResponse
            {
                Ok = true,
                BattleState = data.BattleState,
                Packets = packets,
                PayloadBase64 = sync
            };
            // NKCGameServerLocal does not emit a GAME_SYNC every host tick. An
            // empty drain means "no client packet this frame", not a combat-host
            // failure; the Node listener will simply skip sending for that tick.
            return true;
        }
        catch (Exception ex)
        {
            error = ex.ToString();
            response = new HostResponse { Ok = false, Error = error };
            return false;
        }
    }

    private static string? LastPayload(IEnumerable<HostPacket> packets, int packetId)
    {
        return packets.LastOrDefault(packet => packet.PacketId == packetId)?.PayloadBase64;
    }

    private static bool TryGetSession(DynamicGameState? dynamicGame, out ManagedCombatSession session, out string? error)
    {
        session = null!;
        error = null;
        if (dynamicGame == null || !dynamicGame.ManagedCombat || string.IsNullOrWhiteSpace(dynamicGame.ManagedSessionId))
        {
            return false;
        }

        if (Sessions.TryGetValue(dynamicGame.ManagedSessionId, out session!))
        {
            return true;
        }

        error = $"managed combat session not found: {dynamicGame.ManagedSessionId}";
        return false;
    }

    private sealed class ManagedCombatSession
    {
        private readonly string sessionId;
        private readonly ManagedRuntime runtime;
        private readonly object server;

        public ManagedCombatSession(string sessionId, ManagedRuntime runtime, object server)
        {
            this.sessionId = sessionId;
            this.runtime = runtime;
            this.server = server;
        }

        public bool Started { get; private set; }

        public HostPacket BuildLoadCompleteAck()
        {
            var packet = runtime.Create("ClientPacket.Game.NKMPacket_GAME_LOAD_COMPLETE_ACK");
            runtime.SetField(packet, "gameRuntimeData", runtime.Invoke(server, "GetGameRuntimeData"));
            return runtime.SerializePacket(packet, GameLoadCompleteAck, "managed-load-complete");
        }

        public void Start()
        {
            if (Started) return;
            runtime.Invoke(server, "StartGame", false);
            Started = true;
        }

        public void EnsureStarted()
        {
            if (!Started)
            {
                Start();
            }
        }

        public List<HostPacket> HandleDeploy(RespawnReq req)
        {
            var request = runtime.Create("ClientPacket.Game.NKMPacket_GAME_RESPAWN_REQ");
            var requestedUnitUid = ParseLong(req.UnitUID);
            runtime.SetField(request, "unitUID", requestedUnitUid);
            runtime.SetField(request, "assistUnit", req.AssistUnit);
            runtime.SetField(request, "respawnPosX", (float)req.RespawnPosX);
            runtime.SetField(request, "gameTime", (float)req.GameTime);

            var respawnUnitUid = requestedUnitUid;
            var method = runtime.GetMethod(
                server.GetType(),
                "OnRecv",
                runtime.GetType("ClientPacket.Game.NKMPacket_GAME_RESPAWN_REQ"),
                typeof(long).MakeByRefType());
            var args = new object[] { request, respawnUnitUid };
            var errorCode = method.Invoke(server, args);
            respawnUnitUid = Convert.ToInt64(args[1], CultureInfo.InvariantCulture);
            if (respawnUnitUid <= 0) respawnUnitUid = requestedUnitUid;

            var ack = runtime.Create("ClientPacket.Game.NKMPacket_GAME_RESPAWN_ACK");
            runtime.SetField(ack, "errorCode", errorCode);
            runtime.SetField(ack, "unitUID", respawnUnitUid);
            runtime.SetField(ack, "assistUnit", req.AssistUnit);

            var packets = new List<HostPacket>
            {
                runtime.SerializePacket(ack, GameRespawnAck, "managed-respawn")
            };
            // Keep deployment as a pure input ACK. The regular battle update
            // loop drains GAME_SYNC packets, which avoids a one-off first-deploy
            // sync burst that can look like the client replayed/rolled back.
            return packets;
        }

        public List<HostPacket> UpdateAndDrain(float delta, int frames = 1)
        {
            for (var index = 0; index < Math.Max(1, frames); index += 1)
            {
                runtime.Invoke(server, "Update", delta / Math.Max(1, frames));
            }
            return runtime.DrainClientPackets($"managed-session-{sessionId}");
        }
    }

    private sealed class ManagedRuntime
    {
        private static readonly object Gate = new();
        private static ManagedRuntime? current;
        private static string currentRuntimeKey = "";

        private readonly Assembly assembly;
        private readonly string managedDir;
        private readonly IReadOnlyList<string> nativeSearchDirs;
        private readonly object packetController;
        private readonly Type serializableType;
        private readonly MethodInfo packetCreate;
        private readonly MethodInfo packetGetId;
        private readonly MethodInfo packetReaderGetWithoutNullBit;
        private readonly ConstructorInfo packetReaderCtor;
        private readonly MethodInfo packetWriterToBufferWithoutNullBit;
        private readonly MethodInfo zeroCopyCalcTotalSize;
        private readonly MethodInfo zeroCopyGetView;
        private readonly FieldInfo messageQueueField;
        private readonly FieldInfo messageEventField;
        private readonly FieldInfo messageIdField;
        private readonly FieldInfo messageParamField;
        private bool clientTablesInitialized;

        private ManagedRuntime(string managedDir, string gameplayTablesDir)
        {
            this.managedDir = managedDir;
            AppDomain.CurrentDomain.AssemblyResolve += (_, args) => ResolveManagedAssembly(managedDir, args);
            ManagedLuaFileLoader.Configure(gameplayTablesDir);
            assembly = Assembly.LoadFrom(ManagedAssemblyPatcher.GetAssemblyPath(managedDir, gameplayTablesDir));
            nativeSearchDirs = BuildNativeSearchDirs(managedDir);
            PrimeNativeSearchPath(nativeSearchDirs);
            NativeLibrary.SetDllImportResolver(assembly, ResolveNativeLibrary);
            serializableType = GetType("Cs.Protocol.ISerializable");

            var packetControllerType = GetType("Cs.Protocol.PacketController");
            packetController = packetControllerType.GetProperty("Instance", BindingFlags.Public | BindingFlags.Static)!.GetValue(null)!;
            packetControllerType.GetMethod("Initialize", BindingFlags.Public | BindingFlags.Instance)!.Invoke(packetController, null);
            packetCreate = packetControllerType.GetMethod("Create", BindingFlags.Public | BindingFlags.Instance, null, [typeof(ushort)], null)!;
            packetGetId = packetControllerType.GetMethod("GetId", BindingFlags.Public | BindingFlags.Instance, null, [serializableType], null)!;

            var packetReaderType = GetType("Cs.Protocol.PacketReader");
            packetReaderCtor = packetReaderType.GetConstructor([typeof(byte[])])!;
            packetReaderGetWithoutNullBit = packetReaderType.GetMethod("GetWithoutNullBit", BindingFlags.Public | BindingFlags.Instance, null, [serializableType], null)!;

            var packetWriterType = GetType("Cs.Protocol.PacketWriter");
            packetWriterToBufferWithoutNullBit = packetWriterType.GetMethod(
                "ToBufferWithoutNullBit",
                BindingFlags.Public | BindingFlags.Static,
                null,
                [serializableType],
                null)!;

            var zeroCopyType = GetType("Cs.Engine.Network.Buffer.ZeroCopyBuffer");
            zeroCopyCalcTotalSize = zeroCopyType.GetMethod("CalcTotalSize", BindingFlags.Public | BindingFlags.Instance)!;
            zeroCopyGetView = zeroCopyType.GetMethod("GetView", BindingFlags.NonPublic | BindingFlags.Instance)!;

            var messageType = GetType("NKC.NKCMessage");
            messageQueueField = messageType.GetField("m_linklistNKMMessageData", BindingFlags.NonPublic | BindingFlags.Static)!;
            var messageDataType = GetType("NKC.NKCMessageData");
            messageEventField = messageDataType.GetField("m_NKC_EVENT_MESSAGE", BindingFlags.Public | BindingFlags.Instance)!;
            messageIdField = messageDataType.GetField("m_MsgID2", BindingFlags.Public | BindingFlags.Instance)!;
            messageParamField = messageDataType.GetField("m_Param1", BindingFlags.Public | BindingFlags.Instance)!;
        }

        public static ManagedRuntime? TryLoad(string managedDir, string gameplayTablesDir, out string? error)
        {
            error = null;
            try
            {
                var fullPath = Path.GetFullPath(managedDir);
                var tablesPath = string.IsNullOrWhiteSpace(gameplayTablesDir) ? "" : Path.GetFullPath(gameplayTablesDir);
                var assemblyPath = Path.Combine(fullPath, "Assembly-CSharp.dll");
                if (!File.Exists(assemblyPath))
                {
                    error = $"missing Assembly-CSharp.dll in {fullPath}";
                    return null;
                }

                lock (Gate)
                {
                    var runtimeKey = fullPath + "|" + tablesPath;
                    if (current != null && string.Equals(currentRuntimeKey, runtimeKey, StringComparison.OrdinalIgnoreCase))
                    {
                        return current;
                    }

                    current = new ManagedRuntime(fullPath, tablesPath);
                    currentRuntimeKey = runtimeKey;
                    return current;
                }
            }
            catch (Exception ex)
            {
                error = ex.ToString();
                return null;
            }
        }

        public object Create(string typeName) => Activator.CreateInstance(GetType(typeName))!;

        public void InitializeClientTables()
        {
            if (clientTablesInitialized) return;
            var nkcMainType = GetType("NKC.NKCMain");
            nkcMainType.GetMethod("NKCInit", BindingFlags.Public | BindingFlags.Static)!.Invoke(null, null);
            clientTablesInitialized = true;
        }

        public void PrepareGameDataForLocalServer(object gameData)
        {
            // Captured GAME_LOAD_ACK payloads already contain gameUnitUID lists
            // because they were built by the official server. NKCGameServerLocal
            // expects raw deck/team data and assigns those runtime IDs itself.
            SetField(gameData, "m_GameUnitUIDIndex", (short)0);
            foreach (var teamField in new[] { "m_NKMGameTeamDataA", "m_NKMGameTeamDataB" })
            {
                var team = GetField(gameData, teamField);
                if (team != null)
                {
                    ClearTeamRuntimeUnitIds(team);
                }
            }
        }

        public bool TryApplyDungeonGameTeamData(object gameData, object? runtimeData, out string? error)
        {
            error = null;
            if (runtimeData == null)
            {
                error = "missing NKMGameRuntimeData";
                return false;
            }

            try
            {
                var dungeonId = Convert.ToInt32(GetField(gameData, "m_DungeonID"), CultureInfo.InvariantCulture);
                if (dungeonId <= 0)
                {
                    return true;
                }

                var dungeonManagerType = GetType("NKM.NKMDungeonManager");
                var method = dungeonManagerType.GetMethod(
                    "MakeGameTeamData",
                    BindingFlags.Public | BindingFlags.Static,
                    null,
                    [gameData.GetType(), runtimeData.GetType()],
                    null);
                if (method == null)
                {
                    error = "NKMDungeonManager.MakeGameTeamData not found";
                    return false;
                }

                var ok = Convert.ToBoolean(method.Invoke(null, [gameData, runtimeData]), CultureInfo.InvariantCulture);
                if (!ok)
                {
                    error = $"NKMDungeonManager.MakeGameTeamData returned false for dungeonID={dungeonId}";
                }
                return ok;
            }
            catch (Exception ex)
            {
                error = ex.ToString();
                return false;
            }
        }

        private void ClearTeamRuntimeUnitIds(object teamData)
        {
            ClearUnitRuntimeIds(GetField(teamData, "m_MainShip"));
            foreach (var listField in new[]
            {
                "m_listUnitData",
                "m_listAssistUnitData",
                "m_listEvevtUnitData",
                "m_listEnvUnitData",
                "m_listOperatorUnitData"
            })
            {
                if (GetField(teamData, listField) is not IEnumerable units) continue;
                foreach (var unit in units)
                {
                    ClearUnitRuntimeIds(unit);
                }
            }
        }

        private void ClearUnitRuntimeIds(object? unitData)
        {
            if (unitData == null) return;
            ClearCollectionField(unitData, "m_listGameUnitUID");
            ClearCollectionField(unitData, "m_listNearTargetRange");
        }

        private void ClearCollectionField(object target, string fieldName)
        {
            var collection = GetField(target, fieldName);
            collection?.GetType().GetMethod("Clear", BindingFlags.Public | BindingFlags.Instance)?.Invoke(collection, null);
        }

        public Type GetType(string typeName)
        {
            return assembly.GetType(typeName, throwOnError: true)!;
        }

        public MethodInfo GetMethod(Type owner, string name, params Type[] parameterTypes)
        {
            var method = owner.GetMethod(name, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance, null, parameterTypes, null);
            if (method == null)
            {
                throw new MissingMethodException(owner.FullName, name);
            }
            return method;
        }

        public object? Invoke(object target, string methodName, params object?[] args)
        {
            var parameterTypes = args.Select(arg => arg?.GetType() ?? typeof(object)).ToArray();
            var method = target.GetType().GetMethod(methodName, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance, null, parameterTypes, null)
                ?? target.GetType().GetMethod(methodName, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
            if (method == null)
            {
                throw new MissingMethodException(target.GetType().FullName, methodName);
            }
            return method.Invoke(target, args);
        }

        public object DeserializePacket(int packetId, byte[] payload)
        {
            var packet = packetCreate.Invoke(packetController, [Convert.ToUInt16(packetId)])!;
            var reader = packetReaderCtor.Invoke([payload]);
            try
            {
                packetReaderGetWithoutNullBit.Invoke(reader, [packet]);
                return packet;
            }
            finally
            {
                (reader as IDisposable)?.Dispose();
            }
        }

        public HostPacket SerializePacket(object packet, int fallbackPacketId, string label)
        {
            var id = Convert.ToInt32(packetGetId.Invoke(packetController, [packet]), CultureInfo.InvariantCulture);
            if (id <= 0 || id == ushort.MaxValue) id = fallbackPacketId;
            var zeroCopy = packetWriterToBufferWithoutNullBit.Invoke(null, [packet])!;
            var base64 = ZeroCopyToBase64(zeroCopy);
            return new HostPacket
            {
                PacketId = id,
                Label = label,
                PayloadBase64 = base64
            };
        }

        private string ZeroCopyToBase64(object zeroCopy)
        {
            var totalSize = Convert.ToInt32(zeroCopyCalcTotalSize.Invoke(zeroCopy, null), CultureInfo.InvariantCulture);
            if (totalSize <= 0) return "";

            var output = new byte[totalSize];
            var offset = 0;
            foreach (var segment in (IEnumerable)zeroCopyGetView.Invoke(zeroCopy, null)!)
            {
                var segmentType = segment.GetType();
                var data = (byte[])segmentType.GetProperty("Data", BindingFlags.Public | BindingFlags.Instance)!.GetValue(segment)!;
                var length = Convert.ToInt32(segmentType.GetProperty("Offset", BindingFlags.Public | BindingFlags.Instance)!.GetValue(segment), CultureInfo.InvariantCulture);
                Buffer.BlockCopy(data, 0, output, offset, length);
                offset += length;
            }

            return Convert.ToBase64String(output);
        }

        public List<HostPacket> DrainClientPackets(string label)
        {
            var output = new List<HostPacket>();
            var queue = messageQueueField.GetValue(null);
            if (queue == null) return output;

            foreach (var message in ((IEnumerable)queue).Cast<object>().ToList())
            {
                var eventName = messageEventField.GetValue(message)?.ToString() ?? "";
                if (!string.Equals(eventName, "NEM_NKCPACKET_SEND_TO_CLIENT", StringComparison.Ordinal))
                {
                    continue;
                }

                var packet = messageParamField.GetValue(message);
                if (packet == null) continue;
                var packetId = Convert.ToInt32(messageIdField.GetValue(message), CultureInfo.InvariantCulture);
                output.Add(SerializePacket(packet, packetId, label));
            }

            ClearClientQueue();
            return output;
        }

        public void ClearClientQueue()
        {
            var queue = messageQueueField.GetValue(null);
            queue?.GetType().GetMethod("Clear", BindingFlags.Public | BindingFlags.Instance)?.Invoke(queue, null);
        }

        public object? GetField(object target, string fieldName)
        {
            return target.GetType().GetField(fieldName, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance)?.GetValue(target);
        }

        public void SetField(object target, string fieldName, object? value)
        {
            var field = target.GetType().GetField(fieldName, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance)
                ?? throw new MissingFieldException(target.GetType().FullName, fieldName);
            field.SetValue(target, ConvertForField(value, field.FieldType));
        }

        private static object? ConvertForField(object? value, Type fieldType)
        {
            if (value == null) return null;
            var targetType = Nullable.GetUnderlyingType(fieldType) ?? fieldType;
            if (targetType.IsEnum)
            {
                return value.GetType().IsEnum ? value : Enum.ToObject(targetType, value);
            }
            if (targetType == typeof(float)) return Convert.ToSingle(value, CultureInfo.InvariantCulture);
            if (targetType == typeof(double)) return Convert.ToDouble(value, CultureInfo.InvariantCulture);
            if (targetType == typeof(short)) return Convert.ToInt16(value, CultureInfo.InvariantCulture);
            if (targetType == typeof(int)) return Convert.ToInt32(value, CultureInfo.InvariantCulture);
            if (targetType == typeof(long)) return Convert.ToInt64(value, CultureInfo.InvariantCulture);
            if (targetType == typeof(bool)) return Convert.ToBoolean(value, CultureInfo.InvariantCulture);
            return value;
        }

        private static Assembly? ResolveManagedAssembly(string managedDir, ResolveEventArgs args)
        {
            var simpleName = new AssemblyName(args.Name).Name;
            if (string.IsNullOrWhiteSpace(simpleName))
            {
                return null;
            }

            var alreadyLoaded = AppDomain.CurrentDomain.GetAssemblies()
                .FirstOrDefault(asm => string.Equals(asm.GetName().Name, simpleName, StringComparison.OrdinalIgnoreCase));
            if (alreadyLoaded != null)
            {
                return alreadyLoaded;
            }

            var candidate = Path.Combine(managedDir, simpleName + ".dll");
            if (!File.Exists(candidate))
            {
                return null;
            }

            return Assembly.LoadFrom(candidate);
        }

        private IntPtr ResolveNativeLibrary(string libraryName, Assembly sourceAssembly, DllImportSearchPath? searchPath)
        {
            var fileNames = NativeLibraryFileNames(libraryName);
            foreach (var directory in nativeSearchDirs)
            {
                foreach (var fileName in fileNames)
                {
                    var candidate = Path.Combine(directory, fileName);
                    if (File.Exists(candidate) && NativeLibrary.TryLoad(candidate, out var handle))
                    {
                        return handle;
                    }
                }
            }

            return IntPtr.Zero;
        }

        private static IReadOnlyList<string> BuildNativeSearchDirs(string managedDir)
        {
            var dataDir = Directory.GetParent(managedDir)?.FullName ?? managedDir;
            var gameDir = Directory.GetParent(dataDir)?.FullName ?? dataDir;
            return new[]
            {
                managedDir,
                Path.Combine(dataDir, "Plugins", "x86_64"),
                Path.Combine(dataDir, "Plugins"),
                dataDir,
                gameDir
            }.Where(Directory.Exists).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        }

        private static IEnumerable<string> NativeLibraryFileNames(string libraryName)
        {
            yield return libraryName;
            if (!libraryName.EndsWith(".dll", StringComparison.OrdinalIgnoreCase))
            {
                yield return libraryName + ".dll";
            }
        }

        private static void PrimeNativeSearchPath(IEnumerable<string> nativeSearchDirs)
        {
            foreach (var directory in nativeSearchDirs)
            {
                if (File.Exists(Path.Combine(directory, "lua54.dll")))
                {
                    SetDllDirectory(directory);
                    break;
                }
            }
        }

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool SetDllDirectory(string lpPathName);
    }

    private static long ParseLong(string? value)
    {
        return long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) ? parsed : 0;
    }
}
