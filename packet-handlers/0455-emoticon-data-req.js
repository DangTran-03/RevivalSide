module.exports = {
  packetId: 455,
  name: "EMOTICON_DATA_REQ",
  handle(ctx, socket, packet) {
    console.log("[community:EMOTICON_DATA_REQ] ACK packetId=456 presets=0 emoticons=0");
    ctx.sendGameResponse(
      socket,
      packet,
      ctx.constants.EMOTICON_DATA_ACK,
      ctx.buildEmoticonDataAckPayload(),
      "emoticon-data"
    );
    return true;
  },
};
