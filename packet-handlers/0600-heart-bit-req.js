module.exports = {
  packetId: 600,
  name: "HEART_BIT_REQ",
  handle(ctx, socket, packet) {
    const payload = ctx.decryptCopy(packet.payload);
    const time = ctx.safeReadSignedVarLong(payload, 0).value;
    console.log(`[HEART_BIT] reqTime=${time}`);

    const replay = socket.session.gameReplay;
    replay.heartbeatCount += 1;
    if (ctx.config.REPLAY_CAPTURED_GAME_FLOW && ctx.capturedGameFlow) {
      if (!replay.loadCompleteReceived) {
        ctx.sendServerGamePacket(socket, ctx.constants.HEART_BIT_ACK, ctx.writeSignedVarLong(time), "heart-bit");
        console.log("[capture-game] heartbeat before GAME_LOAD_COMPLETE_REQ; deferring game sync replay");
        return true;
      }
      if (ctx.config.DYNAMIC_BATTLE_MANAGER && replay.battleSim) {
        ctx.sendServerGamePacket(socket, ctx.constants.HEART_BIT_ACK, ctx.writeSignedVarLong(time), "heart-bit");
        return true;
      }
      if (ctx.config.DYNAMIC_BATTLE_MANAGER && replay.dynamicGame) {
        replay.syntheticGameTime = Math.max(4, Number(replay.syntheticGameTime || 4) + 0.5);
        ctx.sendServerGamePacket(socket, ctx.constants.HEART_BIT_ACK, ctx.writeSignedVarLong(time), "heart-bit");
        if (replay.dynamicBattleTimer) {
          return true;
        }
        const packets =
          replay.dynamicGame && !replay.dynamicGame.initialUnitsSent
            ? ctx.buildInitialBattlePackets(replay)
            : ctx.buildGameSyncPackets({
                battleState: replay.battleState,
                dynamicGame: replay.dynamicGame,
                gameTime: replay.syntheticGameTime,
                absoluteGameTime: replay.syntheticGameTime,
                gameStates: replay.heartbeatCount === 1 ? [{ state: 3, winTeam: 0, waveId: 1 }] : [],
              });
        for (const item of packets) {
          ctx.sendServerGamePacket(socket, item.packetId, item.payload, item.label || "dynamic-game-sync");
        }
        ctx.startDynamicBattleManager(socket, "heart-bit");
        return true;
      }
      ctx.sendCapturedHeartbeatReply(socket, time, "heart-bit");
      if (replay.nextServerIndex > ctx.capturedGameFlow.server.length) {
        if (!replay.officialCaptureExhaustedLogged) {
          console.log(
            `[official-missing] captured game flow exhausted after server index=${ctx.capturedGameFlow.server.length}; heartbeat ACK remains dynamic only`
          );
          replay.officialCaptureExhaustedLogged = true;
        }
      }
      return true;
    }
    ctx.sendResponse(socket, packet.sequence, ctx.constants.HEART_BIT_ACK, () =>
      ctx.buildEncryptedPacket(packet.sequence, ctx.constants.HEART_BIT_ACK, ctx.writeSignedVarLong(time))
    );
    return true;
  },
};
