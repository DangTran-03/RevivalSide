module.exports = {
  packetId: 818,
  name: "GAME_SHIP_SKILL_REQ",
  handle(ctx, socket, packet) {
    const req = ctx.decodeGameShipSkillReq(packet.payload);
    if (req) {
      console.log(
        `[GAME_SHIP_SKILL_REQ] gameUnitUID=${req.gameUnitUID} shipSkillID=${req.shipSkillID} posX=${req.skillPosX.toFixed(2)}`
      );
    }
    if (ctx.config.DYNAMIC_BATTLE_MANAGER && ctx.handleDynamicBattleShipSkill(socket, req)) {
      return true;
    }
    return false;
  },
};
