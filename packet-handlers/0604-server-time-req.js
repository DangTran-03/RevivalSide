module.exports = {
  packetId: 604,
  name: "SERVER_TIME_REQ",
  handle(ctx, socket, packet) {
    const replay = socket.session && socket.session.gameReplay;
    if (ctx.config.DYNAMIC_BATTLE_MANAGER && replay && replay.dynamicGame) {
      const ticks = BigInt(Date.now()) * 10000n + 621355968000000000n;
      ctx.sendServerGamePacket(socket, ctx.constants.SERVER_TIME_ACK, ctx.writeSignedVarLong(ticks), "server-time");
      if (ctx.capturedGameFlow) ctx.skipCapturedGameThroughPacketId(socket, ctx.constants.SERVER_TIME_ACK);
      return true;
    }
    if (ctx.config.REPLAY_CAPTURED_GAME_FLOW && ctx.capturedGameFlow) {
      ctx.skipStaleTutorialGameLoadReplay(socket, "server-time");
      ctx.sendCapturedGameThroughPacketId(socket, ctx.constants.SERVER_TIME_ACK, "server-time");
      return true;
    }
    ctx.sendGameResponse(
      socket,
      packet,
      ctx.constants.SERVER_TIME_ACK,
      ctx.writeSignedVarLong(BigInt(Date.now()) * 10000n + 621355968000000000n),
      "server-time"
    );
    return true;
  },
};
