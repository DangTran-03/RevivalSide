module.exports = {
  packetId: 1243,
  name: "FAVORITES_STAGE_REQ",
  handle(ctx, socket, packet) {
    if (ctx.config.REPLAY_CAPTURED_GAME_FLOW && ctx.capturedGameFlow) {
      ctx.sendCapturedGameThroughPacketId(socket, ctx.constants.FAVORITES_STAGE_ACK, "favorites-stage");
      return true;
    }
    ctx.sendGameResponse(
      socket,
      packet,
      ctx.constants.FAVORITES_STAGE_ACK,
      ctx.buildFavoritesStageAckPayload(),
      "favorites-stage"
    );
    return true;
  },
};
