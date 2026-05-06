const { getTutorialStageForRequest, isTutorialDungeonId, isTutorialStageId } = require("../stages/tutorialStage");
const { getEpisode1StageForRequest } = require("../stages/episode1Stage");
const { buildPlayerDeckForGameLoad } = require("../modules/unit");

module.exports = {
  packetId: 801,
  name: "GAME_LOAD_REQ",
  handle(ctx, socket, packet) {
    ctx.logGameLoadReq(packet.payload);
    const req = ctx.decodeGameLoadReq(packet.payload);
    // Stage selection can arrive with a stale/captured dungeonID. Prefer the
    // selected stageID first so Act 2+ does not get pulled back into 1004.
    // Tutorial stages must come from tutorialStage.js, not the Episode 1 catalog
    // wrapper, because that module carries the phase-specific tutorial runtime.
    const requestedStageId = Number((req && req.stageID) || 0);
    const requestedDungeonId = Number((req && req.dungeonID) || 0);
    const explicitTutorial = isTutorialStageId(requestedStageId) || isTutorialDungeonId(requestedDungeonId);
    const stage = (explicitTutorial
      ? getTutorialStageForRequest({ stageID: requestedStageId, dungeonID: requestedDungeonId })
      : getEpisode1StageForRequest({ stageID: requestedStageId, dungeonID: 0 })) ||
      getEpisode1StageForRequest(req) ||
      getTutorialStageForRequest(req);
    if (stage) {
      req.stageID = stage.stageId;
      req.dungeonID = stage.dungeonID;
    }
    if (socket.session && socket.session.gameReplay) {
      socket.session.gameReplay.lastGameLoadReq = {
        stageID: Number((req && req.stageID) || 0),
        dungeonID: Number((req && req.dungeonID) || 0),
      };
    }
    const usesEventDeck = stage && Number(stage.eventDeckId || stage.EventDeckId || 0) > 0;
    const playerDeck =
      stage && !stage.cutsceneOnly
        ? stage.tutorial || usesEventDeck
          ? buildPlayerIdentityForGameLoad(socket.session && socket.session.user)
          : buildPlayerDeckForGameLoad(socket.session && socket.session.user, req) ||
            buildPlayerIdentityForGameLoad(socket.session && socket.session.user)
        : null;
    if (playerDeck && !stage.tutorial && playerDeck.units && playerDeck.units.length) {
      console.log(
        `[game-load] selectedDeck deckType=${playerDeck.deckType} index=${playerDeck.deckIndex} units=${playerDeck.units
          .map((unit) => `${unit.slotIndex}:${unit.unitId}/${unit.unitUid}`)
          .join(",")} ship=${playerDeck.shipUnitId}/${playerDeck.shipUid} operator=${playerDeck.operatorId}/${playerDeck.operatorUid}`
      );
    } else if (stage && usesEventDeck) {
      console.log(`[game-load] eventDeck=${stage.eventDeckId || stage.EventDeckId} stageID=${stage.stageId} dungeonID=${stage.dungeonID}`);
    }
    const activeStage =
      stage && !stage.cutsceneOnly
        ? {
            ...stage,
            playerDeck,
          }
        : stage;
    if (ctx.config.REPLAY_CAPTURED_GAME_FLOW && ctx.capturedGameFlow) {
      ctx.logCapturedClientPacketMatch(packet, 10, "game-load");
    }
    if (!activeStage || activeStage.tutorial) ctx.maybeSendTutorialCutsceneClear(socket, packet.payload);
    if (ctx.config.DYNAMIC_BATTLE_MANAGER && activeStage && !activeStage.cutsceneOnly && ctx.sendDynamicGameLoadAck(socket, req, activeStage)) {
      return true;
    }
    if (ctx.config.REPLAY_CAPTURED_GAME_FLOW && ctx.capturedGameFlow) {
      ctx.sendCapturedGameThroughPacketId(socket, ctx.constants.GAME_LOAD_ACK, "game-load");
      ctx.scheduleCapturedGameAutoAdvance(socket);
      return true;
    }
    return false;
  },
};

function buildPlayerIdentityForGameLoad(user) {
  if (!user) return null;
  return {
    userUid: String(user.userUid || "0"),
    nickname: String(user.nickname || "LocalAdmin"),
    userLevel: Number(user.level || 1),
    units: [],
  };
}
