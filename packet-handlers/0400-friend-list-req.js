module.exports = {
  packetId: 400,
  name: "FRIEND_LIST_REQ",
  handle(ctx, socket) {
    if (!ctx.config.REPLAY_CAPTURED_GAME_FLOW || !ctx.capturedGameFlow) return false;
    socket.session.gameReplay.friendListCount += 1;
    ctx.sendCapturedGameThroughPacketId(socket, ctx.constants.FRIEND_LIST_ACK, "friend-list");
    return true;
  },
};
