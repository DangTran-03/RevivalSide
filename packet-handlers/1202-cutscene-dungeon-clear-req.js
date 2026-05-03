module.exports = {
  packetId: 1202,
  name: "CUTSCENE_DUNGEON_CLEAR_REQ",
  handle(ctx, socket, packet) {
    const dungeonId = ctx.readCutsceneDungeonReq(packet.payload) || 1004;
    if (ctx.config.REPLAY_CAPTURED_GAME_FLOW && ctx.capturedGameFlow) {
      ctx.sendServerGamePacket(
        socket,
        ctx.constants.CUTSCENE_DUNGEON_CLEAR_ACK,
        ctx.buildCutsceneDungeonClearAckPayload(dungeonId),
        `cutscene-clear dungeonID=${dungeonId}`
      );
      return true;
    }
    ctx.sendResponse(socket, packet.sequence, ctx.constants.CUTSCENE_DUNGEON_CLEAR_ACK, () =>
      ctx.buildEncryptedPacket(packet.sequence, ctx.constants.CUTSCENE_DUNGEON_CLEAR_ACK, ctx.buildCutsceneDungeonClearAckPayload(dungeonId))
    );
    return true;
  },
};
