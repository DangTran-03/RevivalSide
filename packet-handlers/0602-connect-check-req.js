module.exports = {
  packetId: 602,
  name: "CONNECT_CHECK_REQ",
  handle(ctx, socket, packet) {
    ctx.sendResponse(socket, packet.sequence, ctx.constants.CONNECT_CHECK_ACK, () =>
      ctx.buildEncryptedPacket(packet.sequence, ctx.constants.CONNECT_CHECK_ACK, Buffer.alloc(0))
    );
    return true;
  },
};
