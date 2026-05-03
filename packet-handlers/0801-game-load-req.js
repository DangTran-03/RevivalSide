const { getTutorialStage } = require("../stages/tutorialStage");

module.exports = {
  packetId: 801,
  name: "GAME_LOAD_REQ",
  handle(ctx, socket, packet) {
    ctx.logGameLoadReq(packet.payload);
    const req = ctx.decodeGameLoadReq(packet.payload);
    const stage = req && Number(req.stageID) === 11211 ? getTutorialStage() : null;
    if (ctx.config.REPLAY_CAPTURED_GAME_FLOW && ctx.capturedGameFlow) {
      ctx.logCapturedClientPacketMatch(packet, 10, "game-load");
      ctx.maybeSendTutorialCutsceneClear(socket, packet.payload);
      if (ctx.config.DYNAMIC_BATTLE_MANAGER && stage && ctx.sendDynamicGameLoadAck(socket, req, stage)) {
        return true;
      }
      ctx.sendCapturedGameThroughPacketId(socket, ctx.constants.GAME_LOAD_ACK, "game-load");
      ctx.scheduleCapturedGameAutoAdvance(socket);
      return true;
    }
    return false;
  },
};
