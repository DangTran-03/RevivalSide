module.exports = {
  packetId: 1614,
  name: "POST_LIST_REQ",
  handle(ctx, socket) {
    if (!ctx.config.REPLAY_CAPTURED_GAME_FLOW || !ctx.capturedGameFlow) return false;
    ctx.sendCapturedGameThroughPacketId(socket, ctx.constants.POST_LIST_ACK, "post-list");
    return true;
  },
};
