using System.Buffers.Binary;
using System.Text;

namespace RevivalSide.CombatHost;

internal static class PacketBuilder
{
    public static byte[] BuildRespawnAck(string? unitUID, bool assistUnit)
    {
        using var writer = new BinaryPayloadWriter();
        writer.WriteSignedVarInt(0);
        writer.WriteSignedVarLong(ParseLong(unitUID));
        writer.WriteBool(assistUnit);
        return writer.ToArray();
    }

    public static byte[] BuildSyntheticGameSync(double gameTime)
    {
        using var writer = new BinaryPayloadWriter();
        writer.WriteFloat(gameTime);
        writer.WriteFloat(gameTime);
        writer.WriteNullableObject(w =>
        {
            w.WriteVarInt(0);
        });
        writer.WriteBool(false);
        return writer.ToArray();
    }

    public static byte[] BuildGameSync(BattleState state)
    {
        var baseEntry = new GameSyncBaseEntry
        {
            GameTime = state.GameTime,
            RemainGameTime = state.RemainGameTime,
            RespawnCostA1 = state.RespawnCostA1,
            RespawnCostB1 = state.RespawnCostB1,
            Units = state.Units,
            DieUnits = state.PendingDieUnitUIDs.Count > 0 ? [state.PendingDieUnitUIDs.ToList()] : [],
            Decks = state.PendingDeckSyncs.ToList(),
            GameStates = state.PendingGameStates.ToList(),
            DungeonEvents = state.PendingDungeonEvents.ToList()
        };

        var payload = BuildNptGameSyncDataPack(state.GameTime, state.AbsoluteGameTime, [baseEntry], false);

        foreach (var unit in state.Units)
        {
            unit.Respawn = false;
        }
        state.PendingDieUnitUIDs.Clear();
        state.PendingDeckSyncs.Clear();
        state.PendingGameStates.Clear();
        state.PendingDungeonEvents.Clear();
        return payload;
    }

    public static byte[] BuildNptGameSyncDataPack(
        double gameTime,
        double absoluteGameTime,
        IReadOnlyList<GameSyncBaseEntry> baseEntries,
        bool simulationGame)
    {
        using var writer = new BinaryPayloadWriter();
        writer.WriteFloat(gameTime);
        writer.WriteFloat(absoluteGameTime);
        writer.WriteNullableObject(w =>
        {
            w.WriteObjectList(baseEntries, (itemWriter, entry) =>
            {
                itemWriter.WriteNullableObject(inner => WriteGameSyncDataBase(inner, entry));
            });
        });
        writer.WriteBool(simulationGame);
        return writer.ToArray();
    }

    private static void WriteGameSyncDataBase(BinaryPayloadWriter writer, GameSyncBaseEntry entry)
    {
        writer.WriteHalfFloat(entry.GameTime);
        writer.WriteHalfFloat(entry.RemainGameTime);
        writer.WriteHalfFloat(entry.ShipDamage);
        writer.WriteHalfFloat(entry.RespawnCostA1);
        writer.WriteHalfFloat(entry.RespawnCostB1);
        writer.WriteHalfFloat(entry.RespawnCostAssistA1);
        writer.WriteHalfFloat(entry.RespawnCostAssistB1);
        writer.WriteHalfFloat(entry.UsedRespawnCostA1);
        writer.WriteHalfFloat(entry.UsedRespawnCostB1);
        writer.WriteSignedVarInt(0);
        writer.WriteSignedVarInt(0);
        writer.WriteSignedVarInt(0);

        writer.WriteObjectList(entry.DieUnits, (itemWriter, dieUnits) =>
        {
            itemWriter.WriteNullableObject(inner =>
            {
                inner.WriteVarInt((uint)dieUnits.Count);
                foreach (var gameUnitUID in dieUnits)
                {
                    inner.WriteSignedVarInt(gameUnitUID);
                }
            });
        });

        writer.WriteObjectList(entry.Units, (itemWriter, unit) =>
        {
            itemWriter.WriteNullableObject(inner =>
            {
                inner.WriteNullableObject(unitWriter => WriteNkmUnitSyncData(unitWriter, unit));
            });
        });

        writer.WriteObjectList(Array.Empty<byte[]>(), static (_, _) => { });
        writer.WriteObjectList(Array.Empty<byte[]>(), static (_, _) => { });

        writer.WriteObjectList(entry.Decks, (itemWriter, deck) =>
        {
            itemWriter.WriteNullableObject(inner => WriteGameSyncDataDeck(inner, deck));
        });

        writer.WriteObjectList(Array.Empty<byte[]>(), static (_, _) => { });

        writer.WriteObjectList(entry.GameStates, (itemWriter, state) =>
        {
            itemWriter.WriteNullableObject(inner => WriteGameSyncDataGameState(inner, state));
        });

        writer.WriteObjectList(entry.DungeonEvents, (itemWriter, dungeonEvent) =>
        {
            itemWriter.WriteNullableObject(inner => WriteGameSyncDataDungeonEvent(inner, dungeonEvent));
        });

        writer.WriteObjectList(Array.Empty<byte[]>(), static (_, _) => { });
        writer.WriteObjectList(Array.Empty<byte[]>(), static (_, _) => { });
        writer.WriteNullObject();
    }

    private static void WriteNkmUnitSyncData(BinaryPayloadWriter writer, UnitState unit)
    {
        var seed = unit.Seed == 0 ? 51 : unit.Seed;
        var encryptedHp = Math.Max(0, unit.Hp) + seed;
        writer.WriteByte(seed);
        writer.WriteSignedVarInt(unit.PlayState == 0 ? 1 : unit.PlayState);
        writer.WriteObjectList(Array.Empty<byte[]>(), static (_, _) => { });
        writer.WriteBool(unit.Respawn);
        writer.WriteBool(false);
        writer.WriteSignedVarInt(unit.GameUnitUID);
        writer.WriteSignedVarInt(unit.TargetUID);
        writer.WriteSignedVarInt(unit.SubTargetUID);
        writer.WriteFloat(encryptedHp);
        writer.WriteFloat(unit.X);
        writer.WriteFloat(unit.Z);
        writer.WriteFloat(unit.JumpY);
        writer.WriteVarInt(BinaryPayloadWriter.FloatToHalf(unit.SpeedX));
        writer.WriteVarInt(BinaryPayloadWriter.FloatToHalf(unit.SpeedY));
        writer.WriteVarInt(BinaryPayloadWriter.FloatToHalf(unit.SpeedZ));
        writer.WriteBool(unit.Right);
        writer.WriteByte(unit.StateId);
        writer.WriteSByte(unit.StateChangeCount);
        writer.WriteBool(unit.DamageSpeedXNegative);
        writer.WriteBool(false);
        writer.WriteVarInt(BinaryPayloadWriter.FloatToHalf(0));
        writer.WriteVarInt(BinaryPayloadWriter.FloatToHalf(0));
        writer.WriteVarInt(BinaryPayloadWriter.FloatToHalf(0));
        writer.WriteVarInt(BinaryPayloadWriter.FloatToHalf(0));
        writer.WriteVarInt(BinaryPayloadWriter.FloatToHalf(0));
        writer.WriteVarInt(BinaryPayloadWriter.FloatToHalf(0));
        writer.WriteVarInt(BinaryPayloadWriter.FloatToHalf(0));
        writer.WriteVarInt(BinaryPayloadWriter.FloatToHalf(0));
        writer.WriteSignedVarInt(0);
        writer.WriteObjectList(Array.Empty<byte[]>(), static (_, _) => { });
        writer.WriteObjectMapShort([]);
        writer.WriteObjectList(Array.Empty<byte[]>(), static (_, _) => { });
        writer.WriteObjectList(Array.Empty<byte[]>(), static (_, _) => { });
        writer.WriteStringIntMap([]);
        writer.WriteObjectList(Array.Empty<byte[]>(), static (_, _) => { });
        writer.WriteFloat(unit.SavedPosX == 0 ? unit.X : unit.SavedPosX);
        writer.WriteFloat(unit.SavedPosY);
    }

    private static void WriteGameSyncDataDeck(BinaryPayloadWriter writer, DeckSync deck)
    {
        writer.WriteSignedVarInt(deck.Team);
        writer.WriteSByte(deck.UnitDeckIndex);
        writer.WriteSignedVarLong(ParseLong(deck.UnitDeckUID, -1));
        writer.WriteSignedVarLong(ParseLong(deck.DeckUsedAddUnitUID, -1));
        writer.WriteSByte(deck.DeckUsedRemoveIndex);
        writer.WriteSignedVarLong(ParseLong(deck.DeckTombAddUnitUID, -1));
        writer.WriteSByte(deck.AutoRespawnIndex);
        writer.WriteSignedVarLong(ParseLong(deck.NextDeckUnitUID, -1));
    }

    private static void WriteGameSyncDataGameState(BinaryPayloadWriter writer, GameStateSync state)
    {
        writer.WriteSignedVarInt(state.State == 0 ? 3 : state.State);
        writer.WriteSignedVarInt(state.WinTeam);
        writer.WriteSignedVarInt(state.WaveId == 0 ? 1 : state.WaveId);
    }

    private static void WriteGameSyncDataDungeonEvent(BinaryPayloadWriter writer, DungeonEventSync dungeonEvent)
    {
        writer.WriteSignedVarInt(dungeonEvent.ActionType);
        writer.WriteSignedVarInt(dungeonEvent.EventId);
        writer.WriteSignedVarInt(dungeonEvent.ActionValue);
        writer.WriteString(dungeonEvent.ActionString ?? "");
        writer.WriteBool(dungeonEvent.Pause);
        writer.WriteSignedVarInt(dungeonEvent.Team);
    }

    private static long ParseLong(string? value, long fallback = 0)
    {
        return long.TryParse(value, out var parsed) ? parsed : fallback;
    }
}

internal sealed class GameSyncBaseEntry
{
    public double GameTime { get; set; }
    public double RemainGameTime { get; set; } = 180;
    public double ShipDamage { get; set; }
    public double RespawnCostA1 { get; set; } = 10;
    public double RespawnCostB1 { get; set; } = 10;
    public double RespawnCostAssistA1 { get; set; }
    public double RespawnCostAssistB1 { get; set; }
    public double UsedRespawnCostA1 { get; set; }
    public double UsedRespawnCostB1 { get; set; }
    public List<List<int>> DieUnits { get; set; } = [];
    public List<UnitState> Units { get; set; } = [];
    public List<DeckSync> Decks { get; set; } = [];
    public List<GameStateSync> GameStates { get; set; } = [];
    public List<DungeonEventSync> DungeonEvents { get; set; } = [];
}

internal sealed class BinaryPayloadWriter : IDisposable
{
    private readonly MemoryStream stream = new();

    public byte[] ToArray() => stream.ToArray();

    public void Dispose() => stream.Dispose();

    public void WriteString(string? value)
    {
        if (value == null)
        {
            WriteSignedVarInt(-1);
            return;
        }

        var bytes = Encoding.UTF8.GetBytes(value);
        WriteSignedVarInt(bytes.Length);
        stream.Write(bytes);
    }

    public void WriteObjectList<T>(IReadOnlyCollection<T> values, Action<BinaryPayloadWriter, T> writeItem)
    {
        WriteVarInt((uint)values.Count);
        foreach (var value in values)
        {
            writeItem(this, value);
        }
    }

    public void WriteObjectMapShort(IReadOnlyCollection<(int Key, Action<BinaryPayloadWriter> WritePayload)> entries)
    {
        WriteVarInt((uint)entries.Count);
        foreach (var (key, writePayload) in entries)
        {
            WriteSignedVarInt(key);
            WriteNullableObject(writePayload);
        }
    }

    public void WriteStringIntMap(IReadOnlyCollection<(string Key, int Value)> entries)
    {
        WriteVarInt((uint)entries.Count);
        foreach (var (key, value) in entries)
        {
            WriteString(key);
            WriteSignedVarInt(value);
        }
    }

    public void WriteNullableObject(Action<BinaryPayloadWriter> writePayload)
    {
        WriteBool(true);
        writePayload(this);
    }

    public void WriteNullObject()
    {
        WriteBool(false);
    }

    public void WriteBool(bool value)
    {
        stream.WriteByte(value ? (byte)1 : (byte)0);
    }

    public void WriteByte(int value)
    {
        stream.WriteByte((byte)(value & 0xff));
    }

    public void WriteSByte(int value)
    {
        stream.WriteByte(unchecked((byte)(sbyte)value));
    }

    public void WriteFloat(double value)
    {
        Span<byte> buffer = stackalloc byte[4];
        BinaryPrimitives.WriteSingleLittleEndian(buffer, (float)value);
        stream.Write(buffer);
    }

    public void WriteHalfFloat(double value)
    {
        WriteVarInt((uint)Math.Max(0, Math.Truncate(value * 100)));
    }

    public void WriteVarInt(uint value)
    {
        var current = value;
        while (current > 0x7f)
        {
            stream.WriteByte((byte)((current & 0x7f) | 0x80));
            current >>= 7;
        }
        stream.WriteByte((byte)current);
    }

    public void WriteSignedVarInt(int value)
    {
        WriteVarInt(ZigZagEncode32(value));
    }

    public void WriteSignedVarLong(long value)
    {
        WriteVarLong(ZigZagEncode64(value));
    }

    private void WriteVarLong(ulong value)
    {
        var current = value;
        while (current > 0x7f)
        {
            stream.WriteByte((byte)((current & 0x7f) | 0x80));
            current >>= 7;
        }
        stream.WriteByte((byte)current);
    }

    public static uint FloatToHalf(double value)
    {
        var f = (float)value;
        if (!float.IsFinite(f) || f == 0) return 0;
        f = Math.Clamp(f, -50000, 50000);
        var bits = BitConverter.SingleToUInt32Bits(f);
        var sign = (bits >> 16) & 0x8000;
        var exponent = (int)((bits >> 23) & 0xff) - 127 + 15;
        var mantissa = bits & 0x7fffff;
        if (exponent <= 0)
        {
            if (exponent < -10) return sign;
            mantissa = (mantissa | 0x800000) >> (1 - exponent);
            return sign | ((mantissa + 0x1000) >> 13);
        }
        if (exponent >= 31) return sign | 0x7c00;
        return sign | ((uint)exponent << 10) | ((mantissa + 0x1000) >> 13);
    }

    private static uint ZigZagEncode32(int value)
    {
        return unchecked((uint)((value << 1) ^ (value >> 31)));
    }

    private static ulong ZigZagEncode64(long value)
    {
        return unchecked((ulong)((value << 1) ^ (value >> 63)));
    }
}
