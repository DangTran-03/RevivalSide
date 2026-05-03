module.exports = {
  packetId: 231,
  name: "STEAM_LOGIN_REQ",
  handle(ctx, socket, packet) {
    const loginReq = ctx.decodeSteamLoginReq(packet.payload);
    socket.session.steamLogin = loginReq;

    if (ctx.config.USE_LOCAL_USER_DB) {
      const user = ctx.getOrCreateUserForSteam(loginReq);
      ctx.issueUserTokens(user, loginReq.accessToken);
      socket.session.user = user;
      ctx.setLastEffectiveAccessToken(user.accessToken || "");
      ctx.saveUserDb();
      console.log(
        `[user-db] login uid=${user.userUid} friendCode=${user.friendCode} nickname=${JSON.stringify(user.nickname)} tokenLen=${(user.accessToken || "").length}`
      );
    }

    ctx.sendResponse(socket, packet.sequence, ctx.constants.LOGIN_ACK, () => {
      const captured = ctx.capturedTcpResponses.get(ctx.constants.LOGIN_ACK);
      if (ctx.config.REPLAY_CAPTURED_LOGIN_ACK && captured) {
        return ctx.buildCapturedLoginAck(packet.sequence, socket.session.user);
      }
      if (captured) {
        console.log(`[official-compare] packetId=${ctx.constants.LOGIN_ACK} using local payload instead of captured official payloadSize=${captured.payload.length}`);
      }
      return ctx.buildLoginAck(packet.sequence, socket.session.user);
    });
    return true;
  },
};
