const { sendCounterPassLobbyNotifications } = require("../modules/event-pass");

module.exports = {
  packetId: 604,
  name: "SERVER_TIME_REQ",
  handle(ctx, socket, packet) {
    const replay = socket.session && socket.session.gameReplay;
    const serverTicks = ctx.dateTimeTicksNow
      ? ctx.dateTimeTicksNow()
      : BigInt(Date.now()) * 10000n + 621355968000000000n;
    if (ctx.config.DYNAMIC_BATTLE_MANAGER && replay && replay.dynamicGame) {
      ctx.sendServerGamePacket(socket, ctx.constants.SERVER_TIME_ACK, ctx.writeSignedVarLong(serverTicks), "server-time");
      if (ctx.capturedGameFlow) ctx.skipCapturedGameThroughPacketId(socket, ctx.constants.SERVER_TIME_ACK);
      sendCounterPassLobbyNotifications(ctx, socket, "server-time-counter-pass", { resendIfNoAck: true });
      return true;
    }
    if (ctx.config.REPLAY_CAPTURED_GAME_FLOW && ctx.capturedGameFlow) {
      ctx.skipStaleTutorialGameLoadReplay(socket, "server-time");
      ctx.sendCapturedGameThroughPacketId(socket, ctx.constants.SERVER_TIME_ACK, "server-time");
      sendCounterPassLobbyNotifications(ctx, socket, "server-time-counter-pass", { resendIfNoAck: true });
      return true;
    }
    ctx.sendGameResponse(
      socket,
      packet,
      ctx.constants.SERVER_TIME_ACK,
      ctx.writeSignedVarLong(serverTicks),
      "server-time"
    );
    sendCounterPassLobbyNotifications(ctx, socket, "server-time-counter-pass", { resendIfNoAck: true });
    return true;
  },
};
