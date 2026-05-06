module.exports = {
  packetId: 453,
  name: "GREETING_MESSAGE_REQ",
  handle(ctx, socket, packet) {
    if (ctx.config.REPLAY_CAPTURED_GAME_FLOW && ctx.capturedGameFlow) {
      ctx.sendCapturedGameThroughPacketId(socket, ctx.constants.GREETING_MESSAGE_ACK, "greeting-message");
      return true;
    }
    ctx.sendGameResponse(
      socket,
      packet,
      ctx.constants.GREETING_MESSAGE_ACK,
      ctx.buildGreetingMessageAckPayload(),
      "greeting-message"
    );
    return true;
  },
};
