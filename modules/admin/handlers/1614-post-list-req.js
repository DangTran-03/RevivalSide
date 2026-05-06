const { createAdminHandler } = require("..");

const adminHandler = createAdminHandler(1614, "POST_LIST_REQ");

module.exports = {
  ...adminHandler,
  handle(ctx, socket, packet) {
    const replay = socket.session && socket.session.gameReplay;
    if (ctx.config.REPLAY_CAPTURED_GAME_FLOW && ctx.capturedGameFlow && replay && !replay.localJoinLobbyAckSent) {
      ctx.sendCapturedGameThroughPacketId(socket, ctx.constants.POST_LIST_ACK, "post-list");
      return true;
    }
    if (replay && !replay.bootPostListTemplateSent) {
      // Official boot emits shop/raid/mission/achievement notices around
      // POST_LIST_REQ. Keep replay disabled, but preserve those prompt notifies.
      ctx.sendCapturedGameTemplateRange(socket, 9, 18, "post-list-boot");
      replay.bootPostListTemplateSent = true;
    }
    const handled = adminHandler.handle(ctx, socket, packet);
    if (ctx.capturedGameFlow) ctx.skipCapturedGameThroughPacketId(socket, ctx.constants.POST_LIST_ACK);
    return handled;
  },
};
