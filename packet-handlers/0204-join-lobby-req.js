const { ensureLoginRewardPosts } = require("../modules/admin");
const { ensureAttendanceRewardPosts } = require("../modules/attendance");

module.exports = {
  packetId: 204,
  name: "JOIN_LOBBY_REQ",
  handle(ctx, socket, packet) {
    const joinReq = ctx.decodeJoinLobbyReq(packet.payload);
    const user = ctx.findUserByAccessToken(joinReq.accessToken) || socket.session.user || ctx.createEphemeralUser();
    socket.session.user = user;
    if (ctx.config.USE_LOCAL_USER_DB && user.userUid) {
      user.lastJoinAt = new Date().toISOString();
      const rewardPosts = ensureLoginRewardPosts(user);
      const attendancePosts = ensureAttendanceRewardPosts(user);
      if (rewardPosts > 0 || attendancePosts > 0) {
        console.log(
          `[user-db] queued inbox rewards uid=${user.userUid} loginPosts=${rewardPosts} attendancePosts=${attendancePosts}`
        );
      }
      ctx.saveUserDb();
    }

    const replay = socket.session.gameReplay;
    replay.inGameFlow = true;

    if (ctx.config.REPLAY_CAPTURED_GAME_FLOW && ctx.capturedGameFlow) {
      if (ctx.shouldUseLocalJoinLobbyAck(user)) {
        if (!replay.bootLobbyTemplateSent) {
          sendJoinLobbyBootTemplates(ctx, socket, replay, user);
        }
        const joinLobbyPayload = ctx.buildJoinLobbyAckPayload(user);
        if (ctx.config.USE_LOCAL_USER_DB && user.userUid) ctx.saveUserDb();
        ctx.sendServerGamePacket(
          socket,
          ctx.constants.JOIN_LOBBY_ACK,
          joinLobbyPayload,
          "join-lobby-local-progress"
        );
        replay.localJoinLobbyAckSent = true;
        sendPostLobbyBootTemplates(ctx, socket, replay);
        ctx.skipCapturedGameThroughPacketId(socket, ctx.constants.JOIN_LOBBY_ACK);
      } else {
        if (ctx.hasTutorialProgress(user)) {
          console.log("[JOIN_LOBBY_REQ] using captured lobby ACK; local account overlay disabled");
        }
        ctx.sendCapturedGameThroughPacketId(socket, ctx.constants.JOIN_LOBBY_ACK, "join-lobby");
      }
      return true;
    }

    if (!replay.bootLobbyTemplateSent) {
      sendJoinLobbyBootTemplates(ctx, socket, replay, user);
    }
    const joinLobbyPayload = ctx.buildJoinLobbyAckPayload(user);
    if (ctx.config.USE_LOCAL_USER_DB && user.userUid) ctx.saveUserDb();
    ctx.sendGameResponse(
      socket,
      packet,
      ctx.constants.JOIN_LOBBY_ACK,
      joinLobbyPayload,
      "join-lobby-local-progress"
    );
    replay.localJoinLobbyAckSent = true;
    sendPostLobbyBootTemplates(ctx, socket, replay);
    return true;
  },
};

function sendJoinLobbyBootTemplates(ctx, socket, replay) {
  ctx.sendCapturedGameTemplateRange(socket, 1, 1, "join-lobby-boot");
  ctx.sendServerGamePacket(
    socket,
    1644,
    Buffer.concat([ctx.writeSignedVarInt(0), ctx.writeSignedVarInt(0)]),
    "join-lobby-boot-company-buff"
  );
  ctx.sendCapturedGameTemplateRange(socket, 3, 7, "join-lobby-boot");
  replay.bootLobbyTemplateSent = true;
}

function sendPostLobbyBootTemplates(ctx, socket, replay) {
  if (replay.bootPostListTemplateSent) return;
  // In the official boot these notifies arrive immediately after JOIN_LOBBY_ACK
  // and before POST_LIST_REQ. They include the mission/achievement prompt data.
  ctx.sendCapturedGameTemplateRange(socket, 9, 18, "post-lobby-boot");
  replay.bootPostListTemplateSent = true;
}
