const {
  readSignedVarInt,
  readSignedVarLong,
  readSignedVarIntList,
} = require("../../packet-codec");
const { buildPlayerDeckForGameLoad } = require("../../unit");

const SHADOW_PALACE_START_ACK = 1222;
const PHASE_START_ACK = 1228;
const TRIM_START_ACK = 1235;
const FIERCE_DATA_ACK = 845;
const FIERCE_PENALTY_ACK = 858;
const EXPLORE_INFO_ACK = 1256;
const EXPLORE_ENTER_ACK = 1258;
const DEFENCE_GAME_START_ACK = 3901;

module.exports = [
  {
    packetId: 844,
    name: "FIERCE_DATA_REQ",
    handle(ctx, socket, packet) {
      ctx.sendGameResponse(socket, packet, FIERCE_DATA_ACK, ctx.buildFierceDataAckPayload(socket.session && socket.session.user), "fierce-data");
      return true;
    },
  },
  {
    packetId: 857,
    name: "FIERCE_PENALTY_REQ",
    handle(ctx, socket, packet) {
      const req = decodeFiercePenaltyReq(ctx, packet.payload);
      ctx.sendGameResponse(socket, packet, FIERCE_PENALTY_ACK, ctx.buildFiercePenaltyAckPayload(req), "fierce-penalty");
      return true;
    },
  },
  {
    packetId: 1221,
    name: "SHADOW_PALACE_START_REQ",
    handle(ctx, socket, packet) {
      const req = decodeSingleIntReq(ctx, packet.payload, "palaceId");
      ctx.sendGameResponse(
        socket,
        packet,
        SHADOW_PALACE_START_ACK,
        ctx.buildShadowPalaceStartAckPayload(req, socket.session && socket.session.user),
        "shadow-palace-start"
      );
      return true;
    },
  },
  {
    packetId: 1227,
    name: "PHASE_START_REQ",
    handle(ctx, socket, packet) {
      const req = decodePhaseStartReq(ctx, packet.payload);
      ctx.sendGameResponse(
        socket,
        packet,
        PHASE_START_ACK,
        ctx.buildPhaseStartAckPayload(req, socket.session && socket.session.user),
        "phase-start"
      );
      return true;
    },
  },
  {
    packetId: 1234,
    name: "TRIM_START_REQ",
    handle(ctx, socket, packet) {
      const req = decodeTrimStartReq(ctx, packet.payload);
      ctx.sendGameResponse(
        socket,
        packet,
        TRIM_START_ACK,
        ctx.buildTrimStartAckPayload(req, socket.session && socket.session.user),
        "trim-start"
      );
      return true;
    },
  },
  {
    packetId: 1255,
    name: "EXPLORE_INFO_REQ",
    handle(ctx, socket, packet) {
      const req = decodeSingleIntReq(ctx, packet.payload, "templetId");
      ctx.sendGameResponse(socket, packet, EXPLORE_INFO_ACK, ctx.buildExploreInfoAckPayload(req, socket.session && socket.session.user), "explore-info");
      return true;
    },
  },
  {
    packetId: 1257,
    name: "EXPLORE_ENTER_REQ",
    handle(ctx, socket, packet) {
      const req = decodeSingleIntReq(ctx, packet.payload, "templetId");
      ctx.sendGameResponse(socket, packet, EXPLORE_ENTER_ACK, ctx.buildExploreEnterAckPayload(req, socket.session && socket.session.user), "explore-enter");
      return true;
    },
  },
  {
    packetId: 3900,
    name: "DEFENCE_GAME_START_REQ",
    handle(ctx, socket, packet) {
      const req = decodeSingleIntReq(ctx, packet.payload, "defenceTempletId");
      const stage = ctx.getGenericStageForRequest ? ctx.getGenericStageForRequest({ defenceTempletId: req.defenceTempletId }) : null;
      const user = socket.session && socket.session.user;
      const loadReq = {
        selectDeckIndex: 0,
        stageID: Number((stage && stage.stageId) || 0),
        dungeonID: Number((stage && stage.dungeonID) || 0),
        defenceTempletId: req.defenceTempletId,
      };
      const playerDeck = stage && !stage.cutsceneOnly
        ? buildPlayerDeckForGameLoad(user, loadReq) || buildPlayerIdentityForGameLoad(user)
        : null;
      const payload = ctx.buildDefenceGameStartAckPayload(socket, loadReq, {
        stage: stage && playerDeck ? { ...stage, playerDeck } : stage,
      });
      ctx.sendGameResponse(socket, packet, DEFENCE_GAME_START_ACK, payload, "defence-game-start");
      return true;
    },
  },
];

function decodeSingleIntReq(ctx, payload, fieldName) {
  try {
    const decrypted = ctx.decryptCopy(payload);
    return { [fieldName]: readSignedVarInt(decrypted, 0).value };
  } catch (_) {
    return { [fieldName]: 0 };
  }
}

function decodePhaseStartReq(ctx, payload) {
  try {
    const decrypted = ctx.decryptCopy(payload);
    const stageId = readSignedVarInt(decrypted, 0);
    let supportingUserUid = 0n;
    try {
      supportingUserUid = readSignedVarLong(decrypted, Math.max(stageId.offset, decrypted.length - 10)).value;
    } catch (_) {
      supportingUserUid = 0n;
    }
    return { stageId: stageId.value, supportingUserUid };
  } catch (_) {
    return { stageId: 0, supportingUserUid: 0n };
  }
}

function decodeTrimStartReq(ctx, payload) {
  try {
    const decrypted = ctx.decryptCopy(payload);
    const trimId = readSignedVarInt(decrypted, 0);
    const trimLevel = readSignedVarInt(decrypted, trimId.offset);
    return { trimId: trimId.value, trimLevel: trimLevel.value };
  } catch (_) {
    return { trimId: 0, trimLevel: 1 };
  }
}

function decodeFiercePenaltyReq(ctx, payload) {
  try {
    const decrypted = ctx.decryptCopy(payload);
    const boss = readSignedVarInt(decrypted, 0);
    const penalties = readSignedVarIntList(decrypted, boss.offset);
    return { fierceBossId: boss.value, penaltyIds: penalties.value };
  } catch (_) {
    return { fierceBossId: 0, penaltyIds: [] };
  }
}

function buildPlayerIdentityForGameLoad(user) {
  if (!user) return null;
  return {
    userUid: String(user.userUid || "0"),
    nickname: String(user.nickname || "LocalAdmin"),
    userLevel: Number(user.level || 1),
    units: [],
  };
}
