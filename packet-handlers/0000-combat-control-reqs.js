const { readSignedVarInt, writeBool, writeSignedVarInt } = require("../modules/packet-codec");

const GAME_AUTO_RESPAWN_REQ = 820;
const GAME_AUTO_RESPAWN_ACK = 821;
const GAME_SPEED_2X_REQ = 825;
const GAME_SPEED_2X_ACK = 826;
const GAME_AUTO_SKILL_CHANGE_REQ = 827;
const GAME_AUTO_SKILL_CHANGE_ACK = 828;

module.exports = [
  {
    packetId: GAME_AUTO_RESPAWN_REQ,
    name: "GAME_AUTO_RESPAWN_REQ",
    handle(ctx, socket, packet) {
      const payload = ctx.decryptCopy(packet.payload);
      const enabled = payload.length > 0 ? payload.readUInt8(0) !== 0 : false;
      rememberCombatControl(ctx, socket, { autoRespawnEnabled: enabled });
      ctx.sendGameResponse(
        socket,
        packet,
        GAME_AUTO_RESPAWN_ACK,
        Buffer.concat([writeSignedVarInt(0), writeBool(enabled)]),
        "game-auto-respawn"
      );
      return true;
    },
  },
  {
    packetId: GAME_SPEED_2X_REQ,
    name: "GAME_SPEED_2X_REQ",
    handle(ctx, socket, packet) {
      const speedType = clampEnum(readEnumRequest(ctx, packet, 0), 0, 5);
      rememberCombatControl(ctx, socket, { gameSpeedType: speedType });
      ctx.sendGameResponse(
        socket,
        packet,
        GAME_SPEED_2X_ACK,
        Buffer.concat([writeSignedVarInt(0), writeSignedVarInt(speedType)]),
        "game-speed"
      );
      return true;
    },
  },
  {
    packetId: GAME_AUTO_SKILL_CHANGE_REQ,
    name: "GAME_AUTO_SKILL_CHANGE_REQ",
    handle(ctx, socket, packet) {
      const autoSkillType = clampEnum(readEnumRequest(ctx, packet, 1), 0, 1);
      rememberCombatControl(ctx, socket, { autoSkillType });
      ctx.sendGameResponse(
        socket,
        packet,
        GAME_AUTO_SKILL_CHANGE_ACK,
        Buffer.concat([writeSignedVarInt(0), writeSignedVarInt(autoSkillType)]),
        "game-auto-skill"
      );
      return true;
    },
  },
];

function readEnumRequest(ctx, packet, fallback) {
  try {
    const payload = ctx.decryptCopy(packet.payload);
    if (!payload.length) return fallback;
    return readSignedVarInt(payload, 0).value;
  } catch (_) {
    return fallback;
  }
}

function clampEnum(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric | 0));
}

function rememberCombatControl(ctx, socket, controls) {
  if (ctx && typeof ctx.applyCombatControls === "function") {
    ctx.applyCombatControls(socket, controls);
    return;
  }
  if (!socket || !socket.session || !socket.session.gameReplay) return;
  Object.assign(socket.session.gameReplay, controls);
}
