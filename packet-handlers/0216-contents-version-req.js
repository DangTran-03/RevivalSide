module.exports = {
  packetId: 216,
  name: "CONTENTS_VERSION_REQ",
  handle(ctx, socket, packet) {
    const official = ctx.capturedTcpProfiles.contentsVersionAck;
    ctx.setLastAckContents(
      official ? official.contentsVersion : ctx.config.CONTENTS_VERSION,
      official ? official.contentsTag : ctx.config.CONTENTS_TAGS
    );
    ctx.sendResponse(socket, packet.sequence, ctx.constants.CONTENTS_VERSION_ACK, () => {
      const captured = ctx.capturedTcpResponses.get(ctx.constants.CONTENTS_VERSION_ACK);
      if (ctx.config.REPLAY_CAPTURED_CONTENTS_VERSION && captured) {
        console.log(
          `[capture-replay] packetId=${ctx.constants.CONTENTS_VERSION_ACK} compressed=${captured.compressed ? 1 : 0} payloadSize=${captured.payload.length}`
        );
        if (captured.raw && captured.sequence === packet.sequence) return captured.raw;
        return ctx.buildFramedPacket(packet.sequence, ctx.constants.CONTENTS_VERSION_ACK, captured.payload, captured.compressed);
      }
      return ctx.buildContentsVersionAck(packet.sequence);
    });
    return true;
  },
};
