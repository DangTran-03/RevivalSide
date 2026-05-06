module.exports = {
  packetId: 3904,
  name: "DEFENCE_INFO_REQ",
  handle(ctx, socket, packet) {
    if (ctx.config.REPLAY_CAPTURED_GAME_FLOW && ctx.capturedGameFlow) {
      ctx.sendCapturedGameThroughPacketId(socket, ctx.constants.DEFENCE_INFO_ACK, "defence-info");
      return true;
    }
    ctx.sendGameResponse(
      socket,
      packet,
      ctx.constants.DEFENCE_INFO_ACK,
      ctx.buildDefenceInfoAckPayload(),
      "defence-info"
    );
    return true;
  },
};
