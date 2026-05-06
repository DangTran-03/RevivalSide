const GAME_OPTION_CHANGE_ACK = 1637;

module.exports = {
  packetId: 1636,
  name: "GAME_OPTION_CHANGE_REQ",
  handle(ctx, socket, packet) {
    // ACK mirrors the requested option payload with a success errorCode prefix.
    // The request body is already the option tuple:
    // actionCameraType, trackCamera, viewSkillCutIn, autoSyncFriendDeck,
    // defaultPvpAutoRespawn.
    const requestOptions = ctx.decryptCopy(packet.payload);
    const payload = Buffer.concat([ctx.writeSignedVarInt(0), requestOptions]);
    if (socket.session && socket.session.gameReplay) {
      ctx.sendServerGamePacket(socket, GAME_OPTION_CHANGE_ACK, payload, "game-option-change");
      return true;
    }
    ctx.sendGameResponse(socket, packet, GAME_OPTION_CHANGE_ACK, payload, "game-option-change");
    return true;
  },
};
