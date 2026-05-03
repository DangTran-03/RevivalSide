module.exports = {
  packetId: 204,
  name: "JOIN_LOBBY_REQ",
  handle(ctx, socket, packet) {
    const joinReq = ctx.decodeJoinLobbyReq(packet.payload);
    const user = ctx.findUserByAccessToken(joinReq.accessToken) || socket.session.user || ctx.createEphemeralUser();
    socket.session.user = user;
    if (ctx.config.USE_LOCAL_USER_DB && user.userUid) {
      user.lastJoinAt = new Date().toISOString();
      ctx.saveUserDb();
    }

    if (ctx.config.REPLAY_CAPTURED_GAME_FLOW && ctx.capturedGameFlow) {
      socket.session.gameReplay.inGameFlow = true;
      if (ctx.hasTutorialProgress(user)) {
        ctx.sendServerGamePacket(socket, ctx.constants.JOIN_LOBBY_ACK, ctx.buildMinimalJoinLobbyPayload(user), "join-lobby-local-progress");
      } else {
        ctx.sendCapturedGameThroughPacketId(socket, ctx.constants.JOIN_LOBBY_ACK, "join-lobby");
      }
      return true;
    }

    ctx.sendResponse(socket, packet.sequence, ctx.constants.JOIN_LOBBY_ACK, () =>
      ctx.buildEncryptedPacket(packet.sequence, ctx.constants.JOIN_LOBBY_ACK, ctx.buildMinimalJoinLobbyPayload(user))
    );
    return true;
  },
};
