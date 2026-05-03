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
    private const int GameEnd = 811;
    private const int GamePauseAck = 813;
    private const int GameRespawnAck = 817;
    private const int GameShipSkillAck = 819;
    private const int GameSync = 822;
    private const int GameUseUnitSkillAck = 830;
    private const float ManagedFrameDelta = 0.033333335f;
    private const int ManagedMaxCatchUpFrames = 3;
    private const int ManagedActionPrimeFrames = 1;
    private const int QuietGameSyncPayloadBytes = 64;

    private static readonly Dictionary<string, ManagedCombatSession> Sessions = new();

    public static bool TryWarmup(HostOptions options, out string? error)
    {
        error = null;
        if (string.IsNullOrWhiteSpace(options.ManagedDir))
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
            runtime.InitializeClientTables();
            return true;
        }
        catch (Exception ex)
        {
            error = ex.ToString();
            return false;
        }
    }

    public static bool TryStart(
        HostOptions options,
        StartBattleData data,
        DynamicGameState dynamicGame,
        out HostPacket? gameLoadAck,
        out string? error)
    {
        gameLoadAck = null;
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
            var gameLoadAckTemplate = runtime.DeserializePacket(GameLoadAck, Convert.FromBase64String(data.GameLoadAckPayloadBase64));
            var gameData = runtime.GetField(gameLoadAckTemplate, "gameData");
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
            if (dynamicGame.DungeonID > 0)
            {
                runtime.SetField(gameData, "m_DungeonID", dynamicGame.DungeonID);
            }
            if (dynamicGame.MapID > 0)
            {
                runtime.SetField(gameData, "m_MapID", dynamicGame.MapID);
            }
            runtime.ApplyTutorialGameType(gameData, dynamicGame.DungeonID);
            var eventDeckId = data.Stage?.EventDeckId ?? dynamicGame.DungeonID;
            if (ShouldApplyEventDeck(dynamicGame.StageID, dynamicGame.DungeonID, eventDeckId))
            {
                runtime.ApplyEventDeckTeamA(gameData, eventDeckId);
            }
            else if (ShouldApplyTutorialEventDeckTeamA(dynamicGame.StageID, dynamicGame.DungeonID, eventDeckId))
            {
                runtime.ApplyTutorialEventDeckTeamA(gameData, eventDeckId);
            }
            runtime.PrepareGameDataForLocalServer(gameData);
            runtime.ApplyTutorialGameType(gameData, dynamicGame.DungeonID);
            var runtimeData = runtime.Invoke(server, "GetGameRuntimeData");
            if (!runtime.TryApplyDungeonGameTeamData(gameData, runtimeData, out error))
            {
                return false;
            }
            runtime.PrepareGameDataForLocalServer(gameData);
            runtime.RefreshTutorialTeamADeck(gameData, dynamicGame.StageID, dynamicGame.DungeonID);
            runtime.ApplyTutorialGameType(gameData, dynamicGame.DungeonID);
            runtime.Invoke(server, "SetGameData", gameData);
            if (runtimeData != null)
            {
                runtime.Invoke(server, "SetGameRuntimeData", runtimeData);
            }
            runtime.SuppressPlayerDynamicRespawns(server, gameData);
            runtime.ApplyTutorialGameType(gameData, dynamicGame.DungeonID);
            // The Unity client builds its unit pool from GAME_LOAD_ACK. Send the
            // same gameData that NKCGameServerLocal just mutated so runtime
            // gameUnitUIDs resolve to the same unit/team on both sides.
            gameLoadAck = runtime.BuildGameLoadAck(gameData);
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

    private static bool ShouldApplyEventDeck(int stageId, int dungeonId, int eventDeckId)
    {
        if (eventDeckId <= 0) return false;
        // Tutorial GAME_LOAD_ACK starts from the captured official 804. Rebuilding
        // tutorial event decks here can throw when the local table set is missing
        // ship limit-break metadata, and it also mutates tutorial deck layout that
        // the client scripts expect. Keep the captured/team data and let
        // NKMDungeonManager.MakeGameTeamData hydrate dungeon-side runtime data.
        return !IsTutorialStage(stageId) && !IsTutorialDungeon(dungeonId);
    }

    private static bool ShouldApplyTutorialEventDeckTeamA(int stageId, int dungeonId, int eventDeckId)
    {
        if (eventDeckId <= 1004 || eventDeckId > 1007) return false;
        return IsTutorialStage(stageId) || IsTutorialDungeon(dungeonId);
    }

    private static bool IsTutorialStage(int stageId)
    {
        return stageId is 11211 or 11212 or 11213 or 11214;
    }

    private static bool IsTutorialDungeon(int dungeonId)
    {
        return dungeonId is 1004 or 1005 or 1006 or 1007;
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

            // Tutorial phases carry dungeon events and UI triggers in the sync
            // stream. Drain only one local-server frame here so phase 2+ scripts
            // see the same steady cadence they get during the battle loop.
            packets.AddRange(session.UpdateAndDrain(ManagedFrameDelta, 1));
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

    public static bool TryHandlePause(
        PauseCommandData data,
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
            error = "pause request required";
            return false;
        }

        try
        {
            session.EnsureStarted();
            var packets = session.HandlePause(data.Req);
            response = new HostResponse
            {
                Ok = true,
                DynamicGame = data.DynamicGame,
                BattleState = data.BattleState,
                Packets = packets
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

    public static bool TryHandleUnitSkill(
        UnitSkillCommandData data,
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
            error = "unit skill request required";
            return false;
        }

        try
        {
            session.EnsureStarted();
            var packets = session.HandleUnitSkill(data.Req);
            response = new HostResponse
            {
                Ok = true,
                DynamicGame = data.DynamicGame,
                BattleState = data.BattleState,
                Packets = packets
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

    public static bool TryHandleShipSkill(
        ShipSkillCommandData data,
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
            error = "ship skill request required";
            return false;
        }

        try
        {
            session.EnsureStarted();
            var packets = session.HandleShipSkill(data.Req);
            response = new HostResponse
            {
                Ok = true,
                DynamicGame = data.DynamicGame,
                BattleState = data.BattleState,
                Packets = packets
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
            // Keep managed sync frame-based, but do not let reflection/packet
            // serialization stalls make the server simulation run slower than
            // the client. If the listener falls behind, catch up with a small
            // number of normal 33 ms frames and drain after each frame so
            // tutorial events and damage packets stay in their original order.
            var requestedDelta = (float)Math.Max(data.Delta ?? ManagedFrameDelta, 0.001);
            var frames = Math.Clamp((int)Math.Ceiling(requestedDelta / ManagedFrameDelta), 1, ManagedMaxCatchUpFrames);
            var delta = Math.Min(requestedDelta, ManagedFrameDelta * frames);
            var packets = session.UpdateAndDrain(delta, frames);
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
        private bool finishStateFlushedWithGameEnd;

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
            // Run one frame after the command so the ACK is not held behind a
            // hidden warm-up loop. The regular 33ms battle pump carries follow-up
            // movement/attack syncs.
            packets.AddRange(UpdateAndDrainUntilResponsive(ManagedActionPrimeFrames));
            return packets;
        }

        public List<HostPacket> HandlePause(PauseReq req)
        {
            var request = runtime.Create("ClientPacket.Game.NKMPacket_GAME_PAUSE_REQ");
            runtime.SetField(request, "isPause", req.IsPause);
            runtime.SetField(request, "isPauseEvent", req.IsPauseEvent);

            var method = runtime.GetMethod(server.GetType(), "OnRecv", runtime.GetType("ClientPacket.Game.NKMPacket_GAME_PAUSE_REQ"));
            var errorCode = method.Invoke(server, [request]);

            var ack = runtime.Create("ClientPacket.Game.NKMPacket_GAME_PAUSE_ACK");
            runtime.SetField(ack, "errorCode", errorCode);
            runtime.SetField(ack, "isPause", req.IsPause);
            runtime.SetField(ack, "isPauseEvent", req.IsPauseEvent);

            return [runtime.SerializePacket(ack, GamePauseAck, "managed-pause")];
        }

        public List<HostPacket> HandleUnitSkill(UnitSkillReq req)
        {
            var request = runtime.Create("ClientPacket.Game.NKMPacket_GAME_USE_UNIT_SKILL_REQ");
            runtime.SetField(request, "gameUnitUID", req.GameUnitUID);

            var teamType = runtime.GetType("NKM.NKM_TEAM_TYPE");
            var userDataType = runtime.GetType("NKM.NKMUserData");
            var method = runtime.GetMethod(
                server.GetType(),
                "OnRecv",
                runtime.GetType("ClientPacket.Game.NKMPacket_GAME_USE_UNIT_SKILL_REQ"),
                teamType,
                typeof(byte).MakeByRefType(),
                userDataType);
            var skillStateId = (byte)0;
            var args = new object?[] { request, Enum.ToObject(teamType, 1), skillStateId, null };
            var errorCode = method.Invoke(server, args);
            skillStateId = Convert.ToByte(args[2], CultureInfo.InvariantCulture);

            var ack = runtime.Create("ClientPacket.Game.NKMPacket_GAME_USE_UNIT_SKILL_ACK");
            runtime.SetField(ack, "errorCode", errorCode);
            runtime.SetField(ack, "gameUnitUID", req.GameUnitUID);
            runtime.SetField(ack, "skillStateID", (sbyte)skillStateId);

            var packets = new List<HostPacket>
            {
                runtime.SerializePacket(ack, GameUseUnitSkillAck, "managed-unit-skill")
            };
            packets.AddRange(UpdateAndDrainUntilResponsive(ManagedActionPrimeFrames));
            return packets;
        }

        public List<HostPacket> HandleShipSkill(ShipSkillReq req)
        {
            var request = runtime.Create("ClientPacket.Game.NKMPacket_GAME_SHIP_SKILL_REQ");
            runtime.SetField(request, "gameUnitUID", req.GameUnitUID);
            runtime.SetField(request, "shipSkillID", req.ShipSkillID);
            runtime.SetField(request, "skillPosX", req.SkillPosX);

            var ack = runtime.Create("ClientPacket.Game.NKMPacket_GAME_SHIP_SKILL_ACK");
            runtime.SetField(ack, "gameUnitUID", req.GameUnitUID);
            runtime.SetField(ack, "shipSkillID", req.ShipSkillID);
            runtime.SetField(ack, "skillPosX", req.SkillPosX);

            var method = runtime.GetMethod(
                server.GetType(),
                "OnRecv",
                runtime.GetType("ClientPacket.Game.NKMPacket_GAME_SHIP_SKILL_REQ"),
                runtime.GetType("ClientPacket.Game.NKMPacket_GAME_SHIP_SKILL_ACK"));
            var errorCode = method.Invoke(server, [request, ack]);
            runtime.SetField(ack, "errorCode", errorCode);

            var packets = new List<HostPacket>
            {
                runtime.SerializePacket(ack, GameShipSkillAck, "managed-ship-skill")
            };
            packets.AddRange(UpdateAndDrainUntilResponsive(ManagedActionPrimeFrames));
            return packets;
        }

        private List<HostPacket> UpdateAndDrainUntilResponsive(int maxFrames)
        {
            var result = new List<HostPacket>();
            HostPacket? lastQuietSync = null;
            var frames = Math.Max(1, maxFrames);
            for (var index = 0; index < frames; index += 1)
            {
                var packets = UpdateAndDrain(ManagedFrameDelta, 1);
                foreach (var packet in packets)
                {
                    if (IsQuietGameSync(packet))
                    {
                        lastQuietSync = packet;
                        continue;
                    }

                    result.Add(packet);
                }

                if (result.Any(packet => packet.PacketId == GameSync))
                {
                    return result;
                }
            }

            if (!result.Any(packet => packet.PacketId == GameSync) && lastQuietSync != null)
            {
                result.Add(lastQuietSync);
            }

            return result;
        }

        private static bool IsQuietGameSync(HostPacket packet)
        {
            if (packet.PacketId != GameSync || string.IsNullOrWhiteSpace(packet.PayloadBase64)) return false;
            try
            {
                return Convert.FromBase64String(packet.PayloadBase64).Length <= QuietGameSyncPayloadBytes;
            }
            catch
            {
                return false;
            }
        }

        public List<HostPacket> UpdateAndDrain(float delta, int frames = 1)
        {
            var frameCount = Math.Max(1, frames);
            var frameDelta = delta / frameCount;
            var output = new List<HostPacket>();
            for (var index = 0; index < frameCount; index += 1)
            {
                runtime.Invoke(server, "Update", frameDelta);
                var framePackets = runtime.DrainClientPackets($"managed-session-{sessionId}");
                if (!finishStateFlushedWithGameEnd && framePackets.Any(packet => packet.PacketId == GameEnd))
                {
                    finishStateFlushedWithGameEnd = true;
                    output.AddRange(FlushFinishStateSync());
                }
                output.AddRange(framePackets);
            }
            return output;
        }

        private List<HostPacket> FlushFinishStateSync()
        {
            var runtimeData = runtime.Invoke(server, "GetGameRuntimeData");
            if (runtimeData == null) return [];

            var gameStateType = runtime.GetType("NKM.NKM_GAME_STATE");
            var teamType = runtime.GetType("NKM.NKM_TEAM_TYPE");
            var finishState = Enum.Parse(gameStateType, "NGS_FINISH");
            var winTeam = runtime.GetField(runtimeData, "m_WinTeam") ?? Enum.Parse(teamType, "NTT_A1");
            var waveId = Convert.ToInt32(runtime.GetField(runtimeData, "m_WaveID") ?? 0, CultureInfo.InvariantCulture);

            // GAME_END_NOT carries result data, but the client plays victory and
            // outro from NGS_FINISH. Make that state sync precede 811 in the same
            // burst so the result packet cannot strand the client in NGS_PLAY.
            runtime.GetMethod(server.GetType(), "SyncGameStateChange", gameStateType, teamType, typeof(int)).Invoke(server, [finishState, winTeam, waveId]);
            runtime.GetMethod(server.GetType(), "ForceSyncDataPackFlushThisFrame").Invoke(server, []);
            runtime.GetMethod(server.GetType(), "SyncDataPackFlush").Invoke(server, []);
            return runtime.DrainClientPackets($"managed-finish-state-{sessionId}");
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

        public void ApplyTutorialGameType(object gameData, int dungeonId)
        {
            if (!IsTutorialDungeon(dungeonId)) return;

            // Client-side tutorial chaining is gated on NKMGameData.GetGameType()
            // being NGT_TUTORIAL after battle end. NKCGameServerLocal can mutate
            // prepared game data, so pin this value around each preparation step.
            SetField(gameData, "m_NKM_GAME_TYPE", Enum.Parse(GetType("NKM.NKM_GAME_TYPE"), "NGT_TUTORIAL"));
        }

        private static bool IsTutorialDungeon(int dungeonId)
        {
            return dungeonId is 1004 or 1005 or 1006 or 1007;
        }

        public void ApplyTutorialEventDeckTeamA(object gameData, int eventDeckId)
        {
            // Later tutorial phases use event decks 1005..1007. The regular
            // MakeEventDeckShipData path can fail when local ship level-break
            // tables are incomplete, so hydrate Team A with the event-deck NPC
            // units directly and keep/replace the ship only when that is safe.
            if (eventDeckId <= 1004 || eventDeckId > 1007) return;

            var teamA = GetField(gameData, "m_NKMGameTeamDataA");
            if (teamA == null) return;

            var dungeonManagerType = GetType("NKM.NKMDungeonManager");
            var eventDeckTemplet = GetEventDeckTemplet(dungeonManagerType, eventDeckId);
            if (eventDeckTemplet == null) return;

            ApplyTutorialEventDeckShip(teamA, dungeonManagerType, eventDeckTemplet);
            ApplyEventDeckUnits(teamA, dungeonManagerType, eventDeckTemplet);
            RefreshTeamDeck(gameData, teamA, resetDeck: true);
        }

        public void RefreshTutorialTeamADeck(object gameData, int stageId, int dungeonId)
        {
            if (!IsTutorialDungeon(dungeonId) && stageId is not (11211 or 11212 or 11213 or 11214)) return;
            if (stageId == 11211 || dungeonId == 1004) return;

            var teamA = GetField(gameData, "m_NKMGameTeamDataA");
            if (teamA == null) return;
            RefreshTeamDeck(gameData, teamA, resetDeck: true);
        }

        public void ApplyEventDeckTeamA(object gameData, int eventDeckId)
        {
            if (eventDeckId <= 0) return;

            var teamA = GetField(gameData, "m_NKMGameTeamDataA");
            if (teamA == null) return;

            var dungeonManagerType = GetType("NKM.NKMDungeonManager");
            var eventDeckTemplet = GetEventDeckTemplet(dungeonManagerType, eventDeckId);
            if (eventDeckTemplet == null) return;

            var eventDeckData = Create("NKM.NKMEventDeckData");
            var inventoryData = Create("NKM.NKMInventoryData");
            var teamType = GetType("NKM.NKM_TEAM_TYPE");
            var teamA1 = Enum.Parse(teamType, "NTT_A1");

            var makeShip = dungeonManagerType.GetMethod(
                "MakeEventDeckShipData",
                BindingFlags.Public | BindingFlags.Static,
                null,
                [
                    GetType("NKM.NKMArmyData"),
                    eventDeckTemplet.GetType(),
                    GetType("NKM.NKMDeckCondition"),
                    eventDeckData.GetType(),
                    teamType,
                    typeof(bool)
                ],
                null);
            var ship = makeShip?.Invoke(null, [null, eventDeckTemplet, null, eventDeckData, teamA1, false]);
            SetField(teamA, "m_MainShip", ship);

            var makeUnits = dungeonManagerType.GetMethod(
                "MakeEventDeckUnitDataList",
                BindingFlags.Public | BindingFlags.Static,
                null,
                [
                    GetType("NKM.NKMArmyData"),
                    eventDeckTemplet.GetType(),
                    GetType("NKM.NKMDeckCondition"),
                    eventDeckData.GetType(),
                    inventoryData.GetType(),
                    teamType,
                    typeof(bool)
                ],
                null);
            var gameUnitDataList = makeUnits?.Invoke(null, [null, eventDeckTemplet, null, eventDeckData, inventoryData, teamA1, false]);
            var unitList = GetField(teamA, "m_listUnitData");
            unitList?.GetType().GetMethod("Clear", BindingFlags.Public | BindingFlags.Instance)?.Invoke(unitList, null);

            long firstUnitUid = 0;
            if (gameUnitDataList is IEnumerable units)
            {
                var add = unitList?.GetType().GetMethod("Add", BindingFlags.Public | BindingFlags.Instance);
                foreach (var gameUnitData in units)
                {
                    var unit = GetField(gameUnitData, "unit");
                    if (unit == null) continue;
                    add?.Invoke(unitList, [unit]);
                    if (firstUnitUid == 0)
                    {
                        firstUnitUid = Convert.ToInt64(GetField(unit, "m_UnitUID"), CultureInfo.InvariantCulture);
                    }
                }
            }

            if (firstUnitUid > 0)
            {
                SetField(teamA, "m_LeaderUnitUID", firstUnitUid);
            }

            RefreshTeamDeck(gameData, teamA, resetDeck: true);
        }

        private object? GetEventDeckTemplet(Type dungeonManagerType, int eventDeckId)
        {
            var getEventDeck = dungeonManagerType.GetMethod(
                "GetEventDeckTemplet",
                BindingFlags.Public | BindingFlags.Static,
                null,
                [typeof(int)],
                null);
            return getEventDeck?.Invoke(null, [eventDeckId]);
        }

        private void ApplyTutorialEventDeckShip(object teamA, Type dungeonManagerType, object eventDeckTemplet)
        {
            object? shipSlot = null;
            int unitId = 0;
            int level = 1;
            int skinId = 0;
            int tacticLevel = 0;
            long npcUid = 0;
            try
            {
                shipSlot = GetField(eventDeckTemplet, "ShipSlot");
                if (shipSlot == null) return;

                unitId = Convert.ToInt32(GetField(shipSlot, "m_ID") ?? 0, CultureInfo.InvariantCulture);
                if (unitId <= 0) return;

                level = Convert.ToInt32(GetField(shipSlot, "m_Level") ?? 1, CultureInfo.InvariantCulture);
                skinId = Convert.ToInt32(GetField(shipSlot, "m_SkinID") ?? 0, CultureInfo.InvariantCulture);
                tacticLevel = Convert.ToInt32(GetField(shipSlot, "m_TacticLevel") ?? 0, CultureInfo.InvariantCulture);
                npcUid = Convert.ToInt64(
                    GetType("NKM.NpcUid").GetMethod("Get", BindingFlags.Public | BindingFlags.Static)!.Invoke(null, null),
                    CultureInfo.InvariantCulture);

                var makeUnitDataFromId = dungeonManagerType.GetMethod(
                    "MakeUnitDataFromID",
                    BindingFlags.Public | BindingFlags.Static,
                    null,
                    [typeof(int), typeof(long), typeof(int), typeof(int), typeof(int), typeof(int), typeof(int), typeof(int)],
                    null);
                var ship = makeUnitDataFromId?.Invoke(null, [unitId, npcUid, level, -1, skinId, tacticLevel, -1, -1])
                    ?? CreateBasicTutorialUnit(unitId, npcUid, level, skinId, tacticLevel);
                if (ship != null)
                {
                    SetField(teamA, "m_MainShip", ship);
                }
            }
            catch
            {
                if (unitId <= 0 || npcUid <= 0) return;
                // If local ship limit-break tables are incomplete, build just
                // the serialized unit shell the client needs for tutorial load.
                var ship = CreateBasicTutorialUnit(unitId, npcUid, level, skinId, tacticLevel);
                SetField(teamA, "m_MainShip", ship);
            }
        }

        private object CreateBasicTutorialUnit(int unitId, long unitUid, int level, int skinId, int tacticLevel)
        {
            var unit = Create("NKM.NKMUnitData");
            SetField(unit, "m_UnitID", unitId);
            SetField(unit, "m_UnitUID", unitUid);
            SetField(unit, "m_UnitLevel", level);
            SetField(unit, "m_SkinID", skinId);
            SetField(unit, "tacticLevel", tacticLevel);
            return unit;
        }

        private void ApplyEventDeckUnits(object teamA, Type dungeonManagerType, object eventDeckTemplet)
        {
            var eventDeckData = Create("NKM.NKMEventDeckData");
            var inventoryData = Create("NKM.NKMInventoryData");
            var teamType = GetType("NKM.NKM_TEAM_TYPE");
            var teamA1 = Enum.Parse(teamType, "NTT_A1");

            var makeUnits = dungeonManagerType.GetMethod(
                "MakeEventDeckUnitDataList",
                BindingFlags.Public | BindingFlags.Static,
                null,
                [
                    GetType("NKM.NKMArmyData"),
                    eventDeckTemplet.GetType(),
                    GetType("NKM.NKMDeckCondition"),
                    eventDeckData.GetType(),
                    inventoryData.GetType(),
                    teamType,
                    typeof(bool)
                ],
                null);
            var gameUnitDataList = makeUnits?.Invoke(null, [null, eventDeckTemplet, null, eventDeckData, inventoryData, teamA1, false]);
            var unitList = GetField(teamA, "m_listUnitData");
            unitList?.GetType().GetMethod("Clear", BindingFlags.Public | BindingFlags.Instance)?.Invoke(unitList, null);

            long firstUnitUid = 0;
            if (gameUnitDataList is IEnumerable units)
            {
                var add = unitList?.GetType().GetMethod("Add", BindingFlags.Public | BindingFlags.Instance);
                foreach (var gameUnitData in units)
                {
                    var unit = GetField(gameUnitData, "unit");
                    if (unit == null) continue;
                    add?.Invoke(unitList, [unit]);
                    if (firstUnitUid == 0)
                    {
                        firstUnitUid = Convert.ToInt64(GetField(unit, "m_UnitUID"), CultureInfo.InvariantCulture);
                    }
                }
            }

            if (firstUnitUid > 0)
            {
                SetField(teamA, "m_LeaderUnitUID", firstUnitUid);
            }
        }

        private void RefreshTeamDeck(object gameData, object teamData, bool resetDeck)
        {
            EnsureLeaderUnitUid(teamData);
            if (resetDeck)
            {
                var deckData = GetField(teamData, "m_DeckData");
                deckData?.GetType()
                    .GetMethod("Init", BindingFlags.Public | BindingFlags.Instance)
                    ?.Invoke(deckData, null);
            }

            var shuffle = gameData.GetType().GetMethod(
                "DoNotShuffleDeck",
                BindingFlags.Public | BindingFlags.Instance,
                null,
                [teamData.GetType()],
                null);
            shuffle?.Invoke(gameData, [teamData]);

            gameData.GetType()
                .GetMethod("InitRespawnLimitCount", BindingFlags.Public | BindingFlags.Instance, null, Type.EmptyTypes, null)
                ?.Invoke(gameData, null);
        }

        private void EnsureLeaderUnitUid(object teamData)
        {
            var leader = Convert.ToInt64(GetField(teamData, "m_LeaderUnitUID") ?? 0, CultureInfo.InvariantCulture);
            if (leader > 0) return;

            var firstUnitUid = GetFirstUnitUid(teamData);
            if (firstUnitUid > 0)
            {
                SetField(teamData, "m_LeaderUnitUID", firstUnitUid);
            }
        }

        private long GetFirstUnitUid(object teamData)
        {
            if (GetField(teamData, "m_listUnitData") is not IEnumerable units) return 0;
            foreach (var unit in units)
            {
                if (unit == null) continue;
                var unitUid = Convert.ToInt64(GetField(unit, "m_UnitUID") ?? 0, CultureInfo.InvariantCulture);
                if (unitUid > 0) return unitUid;
            }
            return 0;
        }

        public void SuppressPlayerDynamicRespawns(object server, object gameData)
        {
            // Player deck units can carry unit-template summon pools. In the
            // online tutorial those server-side dynamic spawns are not useful
            // for our local bridge and can materialize extra units at the
            // player's deploy position. Keep dungeon/team-B event waves intact.
            var teamA = GetField(gameData, "m_NKMGameTeamDataA");
            if (teamA != null)
            {
                ClearCollectionField(teamA, "m_listDynamicRespawnUnitData");
            }

            ClearPlayerUnitDynamicRespawnPools(server, "m_dicNKMUnitPool");
            ClearPlayerUnitDynamicRespawnPools(server, "m_dicNKMUnit");
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

        private void ClearPlayerUnitDynamicRespawnPools(object server, string unitDictionaryFieldName)
        {
            if (GetField(server, unitDictionaryFieldName) is not IDictionary units) return;

            foreach (DictionaryEntry entry in units)
            {
                var unit = entry.Value;
                if (unit == null || !IsPlayerTeamUnit(unit)) continue;
                ClearCollectionField(unit, "m_dicDynamicRespawnPool");
                ClearCollectionField(unit, "m_dicUnitChangeRespawnPool");
            }
        }

        private static bool IsPlayerTeamUnit(object unit)
        {
            var method = unit.GetType().GetMethod("IsATeam", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
            return method != null && Convert.ToBoolean(method.Invoke(unit, null), CultureInfo.InvariantCulture);
        }

        public Type GetType(string typeName)
        {
            return assembly.GetType(typeName, throwOnError: true)!;
        }

        public MethodInfo GetMethod(Type owner, string name, params Type[] parameterTypes)
        {
            var method = FindMethod(owner, name, parameterTypes);
            if (method == null)
            {
                throw new MissingMethodException(owner.FullName, name);
            }
            return method;
        }

        public object? Invoke(object target, string methodName, params object?[] args)
        {
            var parameterTypes = args.Select(arg => arg?.GetType() ?? typeof(object)).ToArray();
            var method = FindMethod(target.GetType(), methodName, parameterTypes) ?? FindMethodByName(target.GetType(), methodName);
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

        public HostPacket BuildGameLoadAck(object gameData)
        {
            var packet = Create("ClientPacket.Game.NKMPacket_GAME_LOAD_ACK");
            SetField(packet, "errorCode", 0);
            SetField(packet, "gameData", gameData);
            return SerializePacket(packet, GameLoadAck, "managed-game-load");
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
            return FindField(target.GetType(), fieldName)?.GetValue(target);
        }

        public void SetField(object target, string fieldName, object? value)
        {
            var field = FindField(target.GetType(), fieldName)
                ?? throw new MissingFieldException(target.GetType().FullName, fieldName);
            field.SetValue(target, ConvertForField(value, field.FieldType));
        }

        private static FieldInfo? FindField(Type type, string fieldName)
        {
            for (var current = type; current != null; current = current.BaseType)
            {
                var field = current.GetField(fieldName, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance);
                if (field != null) return field;
            }

            return null;
        }

        private static MethodInfo? FindMethod(Type type, string methodName, params Type[] parameterTypes)
        {
            for (var current = type; current != null; current = current.BaseType)
            {
                var method = current.GetMethod(methodName, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance, null, parameterTypes, null);
                if (method != null) return method;
            }

            return null;
        }

        private static MethodInfo? FindMethodByName(Type type, string methodName)
        {
            for (var current = type; current != null; current = current.BaseType)
            {
                var method = current
                    .GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance)
                    .FirstOrDefault(candidate => string.Equals(candidate.Name, methodName, StringComparison.Ordinal));
                if (method != null) return method;
            }

            return null;
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
            if (targetType == typeof(sbyte)) return Convert.ToSByte(value, CultureInfo.InvariantCulture);
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
