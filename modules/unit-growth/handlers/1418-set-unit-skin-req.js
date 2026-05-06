const { writeSignedVarInt, writeSignedVarLong, readSignedVarInt, readSignedVarLong, toBigInt } = require("../../packet-codec");
const { setUnitSkin } = require("../../unit");

module.exports = {
  packetId: 1418,
  name: "SET_UNIT_SKIN_REQ",
  handle(ctx, socket, packet) {
    const user = (socket.session && socket.session.user) || ctx.createEphemeralUser();
    if (socket.session) socket.session.user = user;
    const request = decode(ctx, packet.payload);
    setUnitSkin(user, request.unitUID, request.skinID);
    console.log(`[skin] set unitUID=${request.unitUID} skinID=${request.skinID}`);
    ctx.sendGameResponse(
      socket,
      packet,
      1419,
      Buffer.concat([
        writeSignedVarInt(0),
        writeSignedVarLong(toBigInt(request.unitUID || 0)),
        writeSignedVarInt(Number(request.skinID || 0) || 0),
      ]),
      "set-unit-skin"
    );
    if (ctx.config.USE_LOCAL_USER_DB) ctx.saveUserDb();
    return true;
  },
};

function decode(ctx, encryptedPayload) {
  try {
    const payload = ctx.decryptCopy(encryptedPayload);
    const unit = readSignedVarLong(payload, 0);
    const skin = readSignedVarInt(payload, unit.offset);
    return { unitUID: unit.value, skinID: skin.value };
  } catch (err) {
    console.log(`[skin] request decode failed: ${err.message}`);
    return { unitUID: 0n, skinID: 0 };
  }
}
