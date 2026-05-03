module.exports = {
  packetId: 3904,
  name: "DEFENCE_INFO_REQ",
  handle(ctx, socket) {
    if (!ctx.config.REPLAY_CAPTURED_GAME_FLOW || !ctx.capturedGameFlow) return false;
    ctx.sendCapturedGameThroughPacketId(socket, ctx.constants.DEFENCE_INFO_ACK, "defence-info");
    return true;
  },
};
