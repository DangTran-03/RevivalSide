module.exports = {
  packetId: 400,
  name: "FRIEND_LIST_REQ",
  handle(ctx, socket, packet) {
    socket.session.gameReplay.friendListCount += 1;
    if (ctx.config.REPLAY_CAPTURED_GAME_FLOW && ctx.capturedGameFlow) {
      ctx.sendCapturedGameThroughPacketId(socket, ctx.constants.FRIEND_LIST_ACK, "friend-list");
      return true;
    }
    ctx.sendGameResponse(
      socket,
      packet,
      ctx.constants.FRIEND_LIST_ACK,
      ctx.buildFriendListAckPayload(),
      "friend-list"
    );
    return true;
  },
};
