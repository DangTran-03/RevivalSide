module.exports = {
  packetId: 607,
  name: "INFORM_MY_LOADING_PROGRESS_REQ",
  handle(ctx) {
    if (ctx.config.VERBOSE_CAPTURE_LOGS) {
      console.log("[capture-game] INFORM_MY_LOADING_PROGRESS_REQ observed; official flow sends no direct ACK");
    }
    return true;
  },
};
