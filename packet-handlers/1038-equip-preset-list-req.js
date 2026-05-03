module.exports = {
  packetId: 1038,
  name: "EQUIP_PRESET_LIST_REQ",
  handle(ctx, socket) {
    if (!ctx.config.REPLAY_CAPTURED_GAME_FLOW || !ctx.capturedGameFlow) return false;
    ctx.sendCapturedGameThroughPacketId(socket, ctx.constants.EQUIP_PRESET_LIST_ACK, "equip-preset-list");
    return true;
  },
};
