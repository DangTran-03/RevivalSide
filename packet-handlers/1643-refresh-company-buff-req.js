const REFRESH_COMPANY_BUFF_ACK = 1644;

module.exports = {
  packetId: 1643,
  name: "REFRESH_COMPANY_BUFF_REQ",
  handle(ctx, socket, packet) {
    // Do not replay the captured 1644 here: that fixture contains expired buff
    // records, which makes the client show an expiry banner and immediately ask
    // for the list again. A success ACK with an empty buff list keeps the scene
    // load path satisfied without injecting stale account state.
    const payload = Buffer.concat([ctx.writeSignedVarInt(0), ctx.writeSignedVarInt(0)]);
    if (socket.session && socket.session.gameReplay) {
      ctx.sendServerGamePacket(socket, REFRESH_COMPANY_BUFF_ACK, payload, "refresh-company-buff");
      return true;
    }
    ctx.sendResponse(socket, packet.sequence, REFRESH_COMPANY_BUFF_ACK, () =>
      ctx.buildEncryptedPacket(packet.sequence, REFRESH_COMPANY_BUFF_ACK, payload)
    );
    return true;
  },
};
