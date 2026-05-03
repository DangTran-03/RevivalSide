module.exports = {
  packetId: 1200,
  name: "CUTSCENE_DUNGEON_START_REQ",
  handle(ctx, socket, packet) {
    const dungeonId = ctx.readCutsceneDungeonReq(packet.payload) || 1004;
    if (ctx.config.REPLAY_CAPTURED_GAME_FLOW && ctx.capturedGameFlow) {
      ctx.sendServerGamePacket(
        socket,
        ctx.constants.CUTSCENE_DUNGEON_START_ACK,
        ctx.buildCutsceneDungeonStartAckPayload(dungeonId),
        `cutscene-start dungeonID=${dungeonId}`
      );
      return true;
    }
    ctx.sendResponse(socket, packet.sequence, ctx.constants.CUTSCENE_DUNGEON_START_ACK, () =>
      ctx.buildEncryptedPacket(packet.sequence, ctx.constants.CUTSCENE_DUNGEON_START_ACK, ctx.buildCutsceneDungeonStartAckPayload(dungeonId))
    );
    return true;
  },
};
