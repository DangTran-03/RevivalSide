const {
  writeBool,
  writeSignedVarInt,
  writeSignedVarLong,
  writeNullableObject,
  writeObjectList,
  writeIntList,
  readSignedVarInt,
  buildRewardData,
} = require("../packet-codec");
const {
  completeAllMissionsForTab,
  completeMission,
  updateMissionProgress,
} = require("../account-progression");

const MISSION_COMPLETE_REQ = 1620;
const MISSION_COMPLETE_ACK = 1621;
const MISSION_COMPLETE_ALL_REQ = 1624;
const MISSION_COMPLETE_ALL_ACK = 1625;
const MISSION_UPDATE_NOT = 1619;

function createMissionHandlers() {
  return [
    {
      packetId: MISSION_COMPLETE_REQ,
      name: "MISSION_COMPLETE_REQ",
      handle(ctx, socket, packet) {
        const user = getSocketUser(ctx, socket);
        const req = decodeMissionCompleteReq(ctx, packet.payload);
        const result = completeMission(user, req, { now: ctx.dateTimeBinaryNow ? ctx.dateTimeBinaryNow() : undefined });
        console.log(
          `[mission] complete uid=${user.userUid || "(ephemeral)"} missionID=${result.missionID} tabId=${result.tabId} groupId=${result.groupId} exp=${result.reward.userExp} achievePoint=${result.reward.achievePoint}`
        );
        send(ctx, socket, packet, MISSION_COMPLETE_ACK, buildMissionCompleteAckPayload(req, result));
        persist(ctx);
        return true;
      },
    },
    {
      packetId: MISSION_COMPLETE_ALL_REQ,
      name: "MISSION_COMPLETE_ALL_REQ",
      handle(ctx, socket, packet) {
        const user = getSocketUser(ctx, socket);
        const tabId = decodeMissionCompleteAllReq(ctx, packet.payload).tabId;
        const result = completeAllMissionsForTab(user, tabId, { now: ctx.dateTimeBinaryNow ? ctx.dateTimeBinaryNow() : undefined });
        console.log(
          `[mission] complete-all uid=${user.userUid || "(ephemeral)"} tabId=${tabId} missions=${result.missionIDs.length} exp=${result.reward.userExp} achievePoint=${result.reward.achievePoint}`
        );
        send(ctx, socket, packet, MISSION_COMPLETE_ALL_ACK, buildMissionCompleteAllAckPayload(result));
        persist(ctx);
        return true;
      },
    },
  ];
}

function buildMissionCompleteAckPayload(req, result = {}) {
  const missionID = Number((result && result.missionID) || (req && req.missionID) || 0);
  return Buffer.concat([
    writeSignedVarInt(0),
    writeSignedVarInt(missionID),
    writeNullableObject(buildRewardData(result.reward || {})),
    writeNullableObject(buildAdditionalRewardData()),
  ]);
}

function buildMissionCompleteAllAckPayload(result = {}) {
  return Buffer.concat([
    writeSignedVarInt(0),
    writeIntList(result.missionIDs || []),
    writeNullableObject(buildRewardData(result.reward || {})),
    writeNullableObject(buildAdditionalRewardData()),
  ]);
}

function buildMissionUpdateNotPayload(missions = []) {
  return writeObjectList(missions.map((mission) => writeNullableObject(buildMissionData(mission))));
}

function buildMissionData(mission = {}) {
  return Buffer.concat([
    writeSignedVarInt(Number(mission.tabId || 1)),
    writeSignedVarInt(Number(mission.missionID || mission.mission_id || 0)),
    writeSignedVarInt(Number(mission.groupId || mission.group_id || mission.missionID || 0)),
    writeSignedVarLong(BigInt(Math.max(0, Number(mission.times || 0)))),
    writeSignedVarLong(BigInt(mission.lastUpdateDate || 0)),
    writeBool(mission.isComplete === true),
  ]);
}

function buildAdditionalRewardData() {
  return Buffer.concat([writeSignedVarLong(0n), writeSignedVarLong(0n), writeSignedVarLong(0n)]);
}

function decodeMissionCompleteReq(ctx, encryptedPayload) {
  if (ctx && typeof ctx.decodeMissionCompleteReq === "function") return ctx.decodeMissionCompleteReq(encryptedPayload);
  const payload = decrypt(ctx, encryptedPayload);
  let offset = 0;
  const tabId = readSignedVarInt(payload, offset);
  offset = tabId.offset;
  const groupId = readSignedVarInt(payload, offset);
  offset = groupId.offset;
  const missionID = readSignedVarInt(payload, offset);
  return { tabId: tabId.value, groupId: groupId.value, missionID: missionID.value };
}

function decodeMissionCompleteAllReq(ctx, encryptedPayload) {
  const payload = decrypt(ctx, encryptedPayload);
  try {
    const tabId = readSignedVarInt(payload, 0);
    return { tabId: tabId.value };
  } catch (_) {
    return { tabId: 0 };
  }
}

function decrypt(ctx, payload) {
  try {
    return ctx && typeof ctx.decryptCopy === "function" ? ctx.decryptCopy(payload) : Buffer.alloc(0);
  } catch (_) {
    return Buffer.alloc(0);
  }
}

function send(ctx, socket, packet, packetId, payload) {
  ctx.sendResponse(socket, packet.sequence, packetId, () => ctx.buildEncryptedPacket(packet.sequence, packetId, payload));
}

function persist(ctx) {
  if (ctx && ctx.config && ctx.config.USE_LOCAL_USER_DB && typeof ctx.saveUserDb === "function") ctx.saveUserDb();
}

function getSocketUser(ctx, socket) {
  if (socket && socket.session && socket.session.user) return socket.session.user;
  const user = ctx && typeof ctx.createEphemeralUser === "function" ? ctx.createEphemeralUser() : {};
  if (socket && socket.session) socket.session.user = user;
  return user;
}

module.exports = {
  MISSION_COMPLETE_REQ,
  MISSION_COMPLETE_ACK,
  MISSION_COMPLETE_ALL_REQ,
  MISSION_COMPLETE_ALL_ACK,
  MISSION_UPDATE_NOT,
  createMissionHandlers,
  buildMissionCompleteAckPayload,
  buildMissionCompleteAllAckPayload,
  buildMissionUpdateNotPayload,
  buildMissionData,
  completeMission,
  completeAllMissionsForTab,
  updateMissionProgress,
};
