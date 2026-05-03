module.exports = {
  packetId: 807,
  name: "GAME_LOAD_COMPLETE_REQ",
  handle(ctx, socket) {
    if (!ctx.config.REPLAY_CAPTURED_GAME_FLOW || !ctx.capturedGameFlow) return false;
    socket.session.gameReplay.loadCompleteReceived = true;
    if (ctx.config.DYNAMIC_BATTLE_MANAGER && socket.session.gameReplay.dynamicGame) {
      const packets = ctx.buildInitialBattlePackets(socket.session.gameReplay);
      for (const item of packets) {
        ctx.sendServerGamePacket(
          socket,
          item.packetId,
          item.payload,
          item.label || (item.packetId === ctx.constants.NPT_GAME_SYNC_DATA_PACK_NOT ? "managed-game-sync" : "managed-game-start")
        );
      }
      socket.session.gameReplay.tutorialReplayPhase = "dynamic";
      if (socket.session.gameReplay.dynamicGame) socket.session.gameReplay.dynamicGame.initialUnitsSent = true;
      return true;
    }
    ctx.sendCapturedGameUntilBeforePacketIds(socket, [ctx.constants.HEART_BIT_ACK], "game-load-complete");
    return true;
  },
};
