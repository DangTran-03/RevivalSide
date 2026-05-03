module.exports = {
  packetId: 829,
  name: "GAME_USE_UNIT_SKILL_REQ",
  handle(ctx, socket, packet) {
    const req = ctx.decodeGameUnitSkillReq(packet.payload);
    if (req) {
      console.log(`[GAME_USE_UNIT_SKILL_REQ] gameUnitUID=${req.gameUnitUID}`);
    }
    if (ctx.config.DYNAMIC_BATTLE_MANAGER && ctx.handleDynamicBattleUnitSkill(socket, req)) {
      return true;
    }
    return false;
  },
};
