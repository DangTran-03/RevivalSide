module.exports = {
  packetId: 204,
  name: "JOIN_LOBBY_REQ",
  handle(ctx, socket, packet) {
    if (ctx.config.REPLAY_CAPTURED_GAME_FLOW && ctx.capturedGameFlow) {
      socket.session.gameReplay.inGameFlow = true;
      ctx.sendCapturedGameThroughPacketId(socket, ctx.constants.JOIN_LOBBY_ACK, "join-lobby");
      return true;
    }

    const joinReq = ctx.decodeJoinLobbyReq(packet.payload);
    const user = ctx.findUserByAccessToken(joinReq.accessToken) || socket.session.user || ctx.createEphemeralUser();
    socket.session.user = user;
    if (ctx.config.USE_LOCAL_USER_DB && user.userUid) {
      user.lastJoinAt = new Date().toISOString();
      ctx.saveUserDb();
    }
    ctx.sendResponse(socket, packet.sequence, ctx.constants.JOIN_LOBBY_ACK, () =>
      ctx.buildEncryptedPacket(packet.sequence, ctx.constants.JOIN_LOBBY_ACK, ctx.buildMinimalJoinLobbyPayload(user))
    );
    return true;
  },
};
