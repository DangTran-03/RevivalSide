module.exports = {
  packetId: 1243,
  name: "FAVORITES_STAGE_REQ",
  handle(ctx, socket) {
    if (!ctx.config.REPLAY_CAPTURED_GAME_FLOW || !ctx.capturedGameFlow) return false;
    ctx.sendCapturedGameThroughPacketId(socket, ctx.constants.FAVORITES_STAGE_ACK, "favorites-stage");
    return true;
  },
};
