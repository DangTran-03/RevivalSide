module.exports = {
  packetId: 602,
  name: "CONNECT_CHECK_REQ",
  handle(ctx, socket, packet) {
    ctx.sendGameResponse(socket, packet, ctx.constants.CONNECT_CHECK_ACK, Buffer.alloc(0), "connect-check");
    return true;
  },
};
