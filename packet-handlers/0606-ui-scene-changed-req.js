module.exports = {
  packetId: 606,
  name: "UI_SCEN_CHANGED_REQ",
  handle(ctx) {
    if (ctx.config.VERBOSE_CAPTURE_LOGS) {
      console.log("[capture-game] UI_SCEN_CHANGED_REQ observed; official flow sends no direct ACK");
    }
    return true;
  },
};
