using System.Text.Json;

namespace RevivalSide.CombatHost;

public sealed class HostRequest
{
    public string Command { get; set; } = "";
    public HostOptions? Options { get; set; }
    public JsonElement Data { get; set; }
}

public sealed class HostOptions
{
    public string ManagedDir { get; set; } = "";
    public string GameplayTablesDir { get; set; } = "";
    public double SyncIntervalSeconds { get; set; } = 0.25;
    public int DefaultUnitDamage { get; set; } = 10;
    public int DefaultUnitAttackRange { get; set; } = 130;
    public int DefaultUnitMoveSpeed { get; set; } = 55;
    public double DefaultUnitAttackCooldown { get; set; } = 1.2;
    public int StaticUnitDamage { get; set; } = 8;
    public int StaticUnitAttackRange { get; set; } = 180;
    public double StaticUnitAttackCooldown { get; set; } = 1.6;
    public int DefaultDeployedUnitHp { get; set; } = 1989;
}

public sealed class HostResponse
{
    public bool Ok { get; set; }
    public string? Error { get; set; }
    public string? Summary { get; set; }
    public string? PacketType { get; set; }
    public int? SerializedPayloadSize { get; set; }
    public DynamicGameState? DynamicGame { get; set; }
    public BattleState? BattleState { get; set; }
    public BattleSimState? BattleSim { get; set; }
    public string? PayloadBase64 { get; set; }
    public List<HostPacket>? Packets { get; set; }
    public HostDeployResult? Deployed { get; set; }
    public HostResult? Result { get; set; }
}

public sealed class HostPacket
{
    public int PacketId { get; set; }
    public string Label { get; set; } = "";
    public string PayloadBase64 { get; set; } = "";
}

public sealed class HostDeployResult
{
    public bool Handled { get; set; }
    public string Mode { get; set; } = "";
    public UnitState? Unit { get; set; }
    public List<UnitState>? Spawned { get; set; }
}

public sealed class HostResult
{
    public bool Finished { get; set; }
    public bool Win { get; set; }
    public double GameTime { get; set; }
}

public sealed class PacketValidationData
{
    public int PacketId { get; set; }
    public string PayloadBase64 { get; set; } = "";
}

public sealed class JoinLobbyMergeData
{
    public string OfficialPayloadBase64 { get; set; } = "";
    public string LocalPayloadBase64 { get; set; } = "";
}

public sealed class JoinLobbyNormalizeData
{
    public string LocalPayloadBase64 { get; set; } = "";
}
