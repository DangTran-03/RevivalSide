module.exports = {
  packetId: 1200,
  name: "CUTSCENE_DUNGEON_START_REQ",
  handle(ctx, socket, packet) {
    const dungeonId = ctx.resolveCutsceneDungeonId(socket, ctx.readCutsceneDungeonReq(packet.payload));
    if (ctx.config.REPLAY_CAPTURED_GAME_FLOW && ctx.capturedGameFlow) {
      ctx.sendServerGamePacket(
        socket,
        ctx.constants.CUTSCENE_DUNGEON_START_ACK,
        ctx.buildCutsceneDungeonStartAckPayload(dungeonId),
        `cutscene-start dungeonID=${dungeonId}`
      );
      return true;
    }
    ctx.sendGameResponse(
      socket,
      packet,
      ctx.constants.CUTSCENE_DUNGEON_START_ACK,
      ctx.buildCutsceneDungeonStartAckPayload(dungeonId),
      `cutscene-start dungeonID=${dungeonId}`
    );
    return true;
  },
};
