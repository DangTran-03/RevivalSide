module.exports = {
  packetId: 453,
  name: "GREETING_MESSAGE_REQ",
  handle(ctx, socket) {
    if (!ctx.config.REPLAY_CAPTURED_GAME_FLOW || !ctx.capturedGameFlow) return false;
    ctx.sendCapturedGameThroughPacketId(socket, ctx.constants.GREETING_MESSAGE_ACK, "greeting-message");
    return true;
  },
};
