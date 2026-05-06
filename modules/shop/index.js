const fs = require("fs");
const path = require("path");
const { toBigInt } = require("../inventory");
const { buildUnitData, buildOperatorData, buildEquipItemData } = require("../packet-codec");
const {
  createEmptyReward,
  isRealMoneyResourceProduct,
  grantShopProduct,
  spendShopPrice,
  grantFallbackResource,
  getPurchaseKey,
  hasCompletedPurchase,
  markCompletedPurchase,
  makeLocalOrderId,
} = require("../resource");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const PACKETS = Object.freeze({
  SHOP_FIX_SHOP_BUY_REQ: 2400,
  SHOP_FIX_SHOP_CASH_BUY_REQ: 2401,
  SHOP_FIX_SHOP_BUY_ACK: 2402,
  SHOP_RANDOM_SHOP_BUY_REQ: 2403,
  SHOP_RANDOM_SHOP_BUY_ACK: 2404,
  SHOP_FIXED_LIST_REQ: 2405,
  SHOP_FIXED_LIST_ACK: 2406,
  SHOP_REFRESH_REQ: 2407,
  SHOP_REFRESH_ACK: 2408,
  SHOP_FIX_SHOP_CASH_BUY_POSSIBLE_REQ: 2410,
  SHOP_FIX_SHOP_CASH_BUY_POSSIBLE_ACK: 2411,
  SHOP_CHAIN_TAB_RESET_TIME_REQ: 2412,
  SHOP_CHAIN_TAB_RESET_TIME_ACK: 2413,
  SHOP_BUY_BUNDLE_TAB_REQ: 2414,
  SHOP_BUY_BUNDLE_TAB_ACK: 2415,
  ZLONG_USE_COUPON_REQ: 2417,
  ZLONG_USE_COUPON_ACK: 2418,
  ZLONG_USE_COUPON_REQ2: 2419,
  GAMEBASE_BUY_REQ: 2420,
  GAMEBASE_BUY_ACK: 2421,
  STEAM_BUY_INIT_REQ: 2424,
  STEAM_BUY_INIT_ACK: 2425,
  STEAM_BUY_REQ: 2426,
  SHOP_RANDOM_SHOP_BUY_LIST_REQ: 2428,
  SHOP_RANDOM_SHOP_BUY_LIST_ACK: 2429,
});

const SHOP_TEMPLET_FILES = [
  path.join(ROOT_DIR, "gameplay-tables-json", "StreamingAssets", "ab_script", "luac", "LUA_SHOP_TEMPLET_01.json"),
  path.join(ROOT_DIR, "gameplay-tables-json", "StreamingAssets", "ab_script", "luac", "LUA_SHOP_TEMPLET_02.json"),
  path.join(ROOT_DIR, "gameplay-tables-json", "Assetbundles", "ab_script", "luac", "LUA_SHOP_TEMPLET_01.json"),
  path.join(ROOT_DIR, "gameplay-tables-json", "Assetbundles", "ab_script", "luac", "LUA_SHOP_TEMPLET_02.json"),
];

let cachedCatalog = null;
const INCLUDE_BEGINNER_PACKS = process.env.CS_SHOP_INCLUDE_BEGINNER_PACKS === "1";
function createShopHandler(packetId, name) {
  return {
    packetId,
    name,
    handle(ctx, socket, packet) {
      ctx.socket = socket;
      const request = decodeShopRequest(ctx, packetId, packet.payload);
      const response = buildShopResponse(ctx, packetId, request);
      if (!response) return false;
      console.log(`[shop:${name}] ACK packetId=${response.packetId} ${formatShopRequest(request)}`);
      ctx.sendResponse(socket, packet.sequence, response.packetId, () =>
        ctx.buildEncryptedPacket(packet.sequence, response.packetId, response.payload)
      );
      return true;
    },
  };
}

function buildCashBuyPossibleResponse(ctx, request) {
  const productMarketID = request.productMarketID || "";
  const productId = resolveProductId(findProductIdByMarketId(productMarketID));
  const record = findProductRecord(productId);
  if (isRealMoneyResourceProduct(record)) {
    console.log(`[resource] bypass real-money validation productId=${productId} marketId=${JSON.stringify(productMarketID)}`);
    return {
      packetId: PACKETS.SHOP_FIX_SHOP_BUY_ACK,
      payload: buildShopFixBuyAck(ctx, request, productId, { source: "cash", dedupe: false }),
    };
  }
  return {
    packetId: PACKETS.SHOP_FIX_SHOP_CASH_BUY_POSSIBLE_ACK,
    payload: buildCashBuyPossibleAck(ctx, productMarketID, request.selectIndices || [], productId),
  };
}

function buildSteamBuyInitResponse(ctx, request) {
  const productId = resolveProductId(request.productId || 0);
  const record = findProductRecord(productId);
  if (isRealMoneyResourceProduct(record)) {
    console.log(`[resource] bypass Steam validation productId=${productId}`);
    return {
      packetId: PACKETS.SHOP_FIX_SHOP_BUY_ACK,
      payload: buildShopFixBuyAck(ctx, request, productId, { source: "steam", dedupe: false }),
    };
  }
  return {
    packetId: PACKETS.STEAM_BUY_INIT_ACK,
    payload: buildSteamBuyInitAck(ctx, productId),
  };
}

function buildShopResponse(ctx, packetId, request) {
  switch (packetId) {
    case PACKETS.SHOP_FIXED_LIST_REQ:
      return {
        packetId: PACKETS.SHOP_FIXED_LIST_ACK,
        payload: buildShopFixedListAck(ctx),
      };
    default:
      return buildShopResponseInner(ctx, packetId, request);
  }
}

function buildShopResponseInner(ctx, packetId, request) {
  switch (packetId) {
    case PACKETS.SHOP_FIX_SHOP_BUY_REQ:
      return {
        packetId: PACKETS.SHOP_FIX_SHOP_BUY_ACK,
        payload: buildShopFixBuyAck(ctx, request, resolveProductId(request.productID)),
      };
    case PACKETS.SHOP_FIX_SHOP_CASH_BUY_REQ:
      return {
        packetId: PACKETS.SHOP_FIX_SHOP_BUY_ACK,
        payload: buildShopFixBuyAck(ctx, request, resolveProductId(findProductIdByMarketId(request.productMarketID)), {
          source: "cash",
          dedupe: false,
        }),
      };
    case PACKETS.GAMEBASE_BUY_REQ:
      return {
        packetId: PACKETS.GAMEBASE_BUY_ACK,
        payload: buildGamebaseBuyAck(
          ctx,
          request,
          resolveProductId(
            findProductIdByPaymentId(request.paymentId) ||
              findProductIdByPaymentId(request.paymentSeq) ||
              findProductIdByMarketId(request.paymentId)
          )
        ),
      };
    case PACKETS.STEAM_BUY_REQ:
      return {
        packetId: PACKETS.SHOP_FIX_SHOP_BUY_ACK,
        payload: buildShopFixBuyAck(ctx, request, resolveProductId(request.productId), { source: "steam" }),
      };
    case PACKETS.SHOP_RANDOM_SHOP_BUY_REQ:
      return {
        packetId: PACKETS.SHOP_RANDOM_SHOP_BUY_ACK,
        payload: buildRandomShopBuyAck(ctx, request.slotIndex || 0),
      };
    case PACKETS.SHOP_RANDOM_SHOP_BUY_LIST_REQ:
      return {
        packetId: PACKETS.SHOP_RANDOM_SHOP_BUY_LIST_ACK,
        payload: buildRandomShopBuyListAck(ctx, request.slotIndexes || []),
      };
    case PACKETS.SHOP_REFRESH_REQ:
      return {
        packetId: PACKETS.SHOP_REFRESH_ACK,
        payload: buildShopRefreshAck(ctx),
      };
    case PACKETS.SHOP_FIX_SHOP_CASH_BUY_POSSIBLE_REQ:
      return buildCashBuyPossibleResponse(ctx, request);
    case PACKETS.STEAM_BUY_INIT_REQ:
      return buildSteamBuyInitResponse(ctx, request);
    case PACKETS.SHOP_CHAIN_TAB_RESET_TIME_REQ:
      return {
        packetId: PACKETS.SHOP_CHAIN_TAB_RESET_TIME_ACK,
        payload: Buffer.concat([ctx.writeSignedVarInt(0), writeObjectList([])]),
      };
    case PACKETS.SHOP_BUY_BUNDLE_TAB_REQ:
      return {
        packetId: PACKETS.SHOP_BUY_BUNDLE_TAB_ACK,
        payload: buildBundleTabBuyAck(ctx),
      };
    case PACKETS.ZLONG_USE_COUPON_REQ:
    case PACKETS.ZLONG_USE_COUPON_REQ2:
      return {
        packetId: PACKETS.ZLONG_USE_COUPON_ACK,
        payload: buildCouponAck(ctx),
      };
    default:
      return null;
  }
}

function buildShopFixedListAck(ctx) {
  const productIds = loadShopCatalog().productIds;
  return Buffer.concat([
    ctx.writeSignedVarInt(0),
    writeIntList(ctx, productIds),
    writeObjectList([]), // InstantProductList
  ]);
}

function buildShopFixBuyAck(ctx, request, productId, options = {}) {
  const result = options.skipGrant
    ? { reward: createEmptyReward(), costItem: null }
    : processProductPurchase(ctx, productId, request && request.productCount, {
        source: options.source || "shop-buy",
        request,
        dedupe: options.dedupe,
      });
  return Buffer.concat([
    ctx.writeSignedVarInt(0),
    writeNullableObject(buildRewardData(ctx, result.reward)),
    ctx.writeSignedVarInt(productId || 0),
    writeNullableObject(buildPurchaseHistory(ctx, productId || 0, request && request.productCount)),
    writeNullableObjectOrNull(result.costItem ? buildItemMiscData(ctx, result.costItem) : null), // costItemData
    writeNullObject(), // subscriptionData
    writeDoubleLE(0),
  ]);
}

function buildGamebaseBuyAck(ctx, request, productId) {
  const result = processProductPurchase(ctx, productId, request && request.productCount, {
    source: "gamebase",
    request,
  });
  return Buffer.concat([
    ctx.writeSignedVarInt(0),
    writeNullableObject(buildRewardData(ctx, result.reward)),
    ctx.writeSignedVarInt(productId || 0),
    writeNullableObject(buildPurchaseHistory(ctx, productId || 0, request && request.productCount)),
    writeNullableObjectOrNull(result.costItem ? buildItemMiscData(ctx, result.costItem) : null), // costItemData
    writeNullObject(), // subscriptionData
    writeDoubleLE(0),
  ]);
}

function buildRandomShopBuyAck(ctx, slotIndex) {
  const reward = grantFallbackReward(ctx);
  return Buffer.concat([
    ctx.writeSignedVarInt(0),
    ctx.writeSignedVarInt(slotIndex || 0),
    writeNullableObject(buildRewardData(ctx, reward)),
    writeNullObject(), // costItemData
  ]);
}

function buildRandomShopBuyListAck(ctx, slotIndexes) {
  const reward = grantFallbackReward(ctx, Math.max(1, (slotIndexes || []).length));
  return Buffer.concat([
    ctx.writeSignedVarInt(0),
    writeIntList(ctx, slotIndexes),
    writeNullableObject(buildRewardData(ctx, reward)),
    writeObjectList([]), // costItemDatas
  ]);
}

function buildShopRefreshAck(ctx) {
  return Buffer.concat([
    ctx.writeSignedVarInt(0),
    writeNullObject(), // randomShopData
    writeNullObject(), // costItemData
  ]);
}

function buildCashBuyPossibleAck(ctx, productMarketID, selectIndices, productId = 0) {
  return Buffer.concat([
    ctx.writeSignedVarInt(0),
    writeString(productMarketID || ""),
    writeNullableObject(buildPurchaseHistory(ctx, productId || 0, 0)),
    writeIntList(ctx, selectIndices),
  ]);
}

function buildBundleTabBuyAck(ctx) {
  const reward = grantFallbackReward(ctx);
  return Buffer.concat([
    ctx.writeSignedVarInt(0),
    writeNullableObject(buildRewardData(ctx, reward)),
    writeNullObject(), // costItemData
    writeObjectList([]), // history
    writeObjectList([]), // subscriptionData
  ]);
}

function buildCouponAck(ctx) {
  const reward = grantFallbackReward(ctx);
  return Buffer.concat([
    ctx.writeSignedVarInt(0),
    ctx.writeSignedVarInt(0), // zlongInfoCode
    writeNullableObject(buildRewardData(ctx, reward)),
  ]);
}

function buildSteamBuyInitAck(ctx, productId) {
  return Buffer.concat([
    ctx.writeSignedVarInt(0),
    ctx.writeSignedVarInt(productId || 0),
    writeString(makeLocalOrderId(productId)),
  ]);
}

function decodeShopRequest(ctx, packetId, encryptedPayload) {
  const payload = safeDecrypt(ctx, encryptedPayload);
  const reader = createReader(payload);
  try {
    switch (packetId) {
      case PACKETS.SHOP_FIX_SHOP_BUY_REQ:
        return {
          productID: reader.int(),
          productCount: reader.int(),
          selectIndices: reader.intList(),
        };
      case PACKETS.SHOP_FIX_SHOP_CASH_BUY_REQ:
        return {
          productMarketID: reader.string(),
          validationToken: reader.string(),
          realCash: reader.double(),
          currencyType: reader.int(),
          currencyCode: reader.string(),
          selectIndices: reader.intList(),
        };
      case PACKETS.SHOP_RANDOM_SHOP_BUY_REQ:
        return { slotIndex: reader.int() };
      case PACKETS.SHOP_REFRESH_REQ:
        return { isUseCash: reader.bool() };
      case PACKETS.SHOP_FIX_SHOP_CASH_BUY_POSSIBLE_REQ:
        return {
          productMarketID: reader.string(),
          selectIndices: reader.intList(),
        };
      case PACKETS.SHOP_BUY_BUNDLE_TAB_REQ:
        return {
          tabType: reader.string(),
          subIndex: reader.int(),
        };
      case PACKETS.ZLONG_USE_COUPON_REQ:
        return { couponCode: reader.string() };
      case PACKETS.ZLONG_USE_COUPON_REQ2:
        return {
          couponCode: reader.string(),
          zlongServerId: reader.int(),
        };
      case PACKETS.GAMEBASE_BUY_REQ:
        return {
          paymentSeq: reader.string(),
          accessToken: reader.string(),
          selectIndices: reader.intList(),
          paymentId: reader.string(),
        };
      case PACKETS.STEAM_BUY_INIT_REQ:
        return {
          steamId: reader.string(),
          productId: reader.int(),
          language: reader.string(),
          country: reader.string(),
          itemShopDesc: reader.string(),
        };
      case PACKETS.STEAM_BUY_REQ:
        return {
          steamId: reader.string(),
          orderId: reader.string(),
          productId: reader.int(),
          country: reader.string(),
          currency: reader.string(),
          selectIndices: reader.intList(),
        };
      case PACKETS.SHOP_RANDOM_SHOP_BUY_LIST_REQ:
        return { slotIndexes: reader.intList() };
      default:
        return {};
    }
  } catch (err) {
    console.log(`[shop] request decode failed packetId=${packetId}: ${err.message}`);
    return {};
  }
}

function safeDecrypt(ctx, payload) {
  try {
    return ctx.decryptCopy(payload);
  } catch (_) {
    return Buffer.alloc(0);
  }
}

function createReader(buffer) {
  let offset = 0;
  return {
    int() {
      const read = readSignedVarInt(buffer, offset);
      offset = read.offset;
      return read.value;
    },
    string() {
      const length = readSignedVarInt(buffer, offset);
      offset = length.offset;
      if (length.value < 0) return "";
      const end = Math.min(buffer.length, offset + length.value);
      const value = buffer.subarray(offset, end).toString("utf8");
      offset = end;
      return value;
    },
    intList() {
      const count = readVarInt(buffer, offset);
      offset = count.offset;
      const values = [];
      for (let index = 0; index < count.value; index += 1) {
        const read = readSignedVarInt(buffer, offset);
        offset = read.offset;
        values.push(read.value);
      }
      return values;
    },
    bool() {
      if (offset >= buffer.length) return false;
      return buffer.readUInt8(offset++) !== 0;
    },
    double() {
      if (offset + 8 > buffer.length) return 0;
      const value = buffer.readDoubleLE(offset);
      offset += 8;
      return value;
    },
  };
}

function loadShopCatalog() {
  if (cachedCatalog) return cachedCatalog;
  const productIds = new Set();
  const marketToProductId = new Map();
  const recordsByProductId = new Map();
  const priceItemIds = new Set();
  let suppressedProducts = 0;

  for (const filePath of SHOP_TEMPLET_FILES) {
    if (!fs.existsSync(filePath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      for (const record of parsed.records || []) {
        const productId = Number(record && record.m_ProductID);
        if (!Number.isInteger(productId) || productId <= 0) continue;
        recordsByProductId.set(productId, pickPreferredProductRecord(recordsByProductId.get(productId), record));
        const priceItemId = Number(record && record.m_PriceItemID);
        if (Number.isInteger(priceItemId) && priceItemId > 0) priceItemIds.add(priceItemId);
        if (shouldSuppressShopProduct(record)) {
          suppressedProducts += 1;
          continue;
        }
        productIds.add(productId);
        if (record.m_MarketID != null && String(record.m_MarketID).length > 0) {
          marketToProductId.set(String(record.m_MarketID), productId);
        }
      }
    } catch (err) {
      console.log(`[shop] failed to load ${filePath}: ${err.message}`);
    }
  }

  cachedCatalog = {
    productIds: Array.from(productIds).sort((a, b) => a - b),
    marketToProductId,
    recordsByProductId,
    priceItemIds: Array.from(priceItemIds).sort((a, b) => a - b),
  };
  console.log(
    `[shop] catalog loaded products=${cachedCatalog.productIds.length} marketIds=${marketToProductId.size} priceItems=${cachedCatalog.priceItemIds.length} suppressed=${suppressedProducts}`
  );
  return cachedCatalog;
}

function pickPreferredProductRecord(existing, incoming) {
  if (!existing) return incoming;
  return productRecordScore(incoming) > productRecordScore(existing) ? incoming : existing;
}

function productRecordScore(record) {
  if (!record) return 0;
  let score = 0;
  if (record.m_bEnabled === true) score += 4;
  if (record.m_bVisible === true) score += 2;
  if (!String(record.m_TabID || "").includes("NO_USE")) score += 1;
  return score;
}

function shouldSuppressShopProduct(record) {
  if (INCLUDE_BEGINNER_PACKS) return false;
  if (record && record.m_bUnlockBanner === true) return true;

  const searchableFields = [
    record && record.m_TabID,
    record && record.m_TabName,
    record && record.m_ItemName,
    record && record.m_Item_Desc,
    record && record.m_Item_Desc_Popup,
    record && record.m_TopBannerText,
    record && record.m_CardPrefab,
    ...(Array.isArray(record && record.listContentsTagAllow) ? record.listContentsTagAllow : []),
    ...(Array.isArray(record && record.listContentsTagIgnore) ? record.listContentsTagIgnore : []),
  ];

  const text = searchableFields.filter((value) => value != null).join(" ").toUpperCase();
  return text.includes("NEWBIE") || text.includes("BEGINNER") || text.includes("STARTER");
}

function findProductIdByMarketId(marketId) {
  if (!marketId) return 0;
  const catalog = loadShopCatalog();
  return catalog.marketToProductId.get(String(marketId)) || Number(marketId) || 0;
}

function findProductIdByPaymentId(paymentId) {
  const number = Number(paymentId);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function resolveProductId(productId) {
  const number = Number(productId);
  if (Number.isInteger(number) && number > 0) return number;
  return loadShopCatalog().productIds[0] || 0;
}

function findProductRecord(productId) {
  return loadShopCatalog().recordsByProductId.get(Number(productId)) || null;
}

function processProductPurchase(ctx, productId, productCount, options = {}) {
  const record = findProductRecord(productId);
  const user = getSessionUser(ctx);
  const source = options.source || "shop-buy";
  const shouldDedupe = options.dedupe !== false && (source === "steam" || source === "cash" || source === "gamebase");
  const purchaseKey = shouldDedupe ? getPurchaseKey(source, productId, options.request || {}) : "";
  if (shouldDedupe && hasCompletedPurchase(ctx.socket, purchaseKey)) return { reward: createEmptyReward(), costItem: null };
  const reward = record
    ? grantShopProduct(ctx, user, record, productCount)
    : grantFallbackResource(ctx, user, productCount);
  const costItem = record ? spendShopPrice(ctx, user, record, productCount) : null;
  if (shouldDedupe) markCompletedPurchase(ctx.socket, purchaseKey);
  persistUserDb(ctx);
  return { reward, costItem };
}

function grantFallbackReward(ctx, multiplier = 1) {
  const reward = grantFallbackResource(ctx, getSessionUser(ctx), multiplier);
  persistUserDb(ctx);
  return reward;
}

function getSessionUser(ctx) {
  return ctx && ctx.socket && ctx.socket.session ? ctx.socket.session.user : null;
}

function persistUserDb(ctx) {
  if (ctx && (!ctx.config || ctx.config.USE_LOCAL_USER_DB) && typeof ctx.saveUserDb === "function") ctx.saveUserDb();
}

function buildRewardData(ctx, reward) {
  const data = reward || createEmptyReward();
  const miscItems = Array.isArray(data.miscItems) ? data.miscItems : [];
  const skinIds = Array.isArray(data.skinIds) ? data.skinIds : [];
  const emoticonIds = Array.isArray(data.emoticonIds) ? data.emoticonIds : [];
  const units = Array.isArray(data.units) ? data.units : [];
  const operators = Array.isArray(data.operators) ? data.operators : [];
  const equips = Array.isArray(data.equips) ? data.equips : [];

  return Buffer.concat([
    ctx.writeSignedVarInt(0), // userExp
    ctx.writeSignedVarInt(0), // bonusRatioOfUserExp
    writeObjectList(units.map((unit) => writeNullableObject(buildUnitData(unit)))),
    writeObjectList(miscItems.map((item) => writeNullableObject(buildItemMiscData(ctx, item)))),
    writeObjectList(equips.map((equip) => writeNullableObject(buildEquipItemData(equip)))),
    writeObjectList([]), // unitExpDataList
    writeIntList(ctx, skinIds),
    writeObjectList([]), // moldItemDataList
    writeObjectList([]), // companyBuffDataList
    writeObjectList([]), // companyBuffDataList duplicate
    writeIntList(ctx, emoticonIds),
    ctx.writeSignedVarInt(0), // dailyMissionPoint
    ctx.writeSignedVarInt(0), // weeklyMissionPoint
    writeObjectList([]), // bingoTileList
    ctx.writeSignedVarLong(0n), // achievePoint
    writeObjectList(operators.map((operator) => writeNullableObject(buildOperatorData(operator)))),
    writeObjectList([]), // contractList
    writeObjectList([]), // interiors
  ]);
}

function buildItemMiscData(ctx, item) {
  return Buffer.concat([
    ctx.writeSignedVarInt(Number(item.itemId) || 0),
    ctx.writeSignedVarLong(toBigInt(item.countFree || 0)),
    ctx.writeSignedVarLong(toBigInt(item.countPaid || 0)),
    ctx.writeSignedVarInt(Number(item.bonusRatio || 0)),
    ctx.writeInt64LE(toBigInt(item.regDate || 0)),
  ]);
}

function buildPurchaseHistory(ctx, productId, productCount) {
  return Buffer.concat([
    ctx.writeSignedVarInt(Number(productId) || 0),
    ctx.writeSignedVarInt(0),
    ctx.writeSignedVarInt(0),
    ctx.writeSignedVarLong(0n),
  ]);
}

function formatShopRequest(request) {
  if (!request || typeof request !== "object") return "";
  const fields = [];
  for (const key of ["productID", "productId", "productMarketID", "slotIndex", "slotIndexes", "tabType", "subIndex", "paymentId", "couponCode"]) {
    if (request[key] == null) continue;
    const value = Array.isArray(request[key]) ? request[key].join(",") : request[key];
    fields.push(`${key}=${JSON.stringify(value)}`);
  }
  return fields.join(" ");
}

function writeString(value) {
  if (value == null) return writeSignedVarInt(-1);
  const bytes = Buffer.from(String(value), "utf8");
  return Buffer.concat([writeSignedVarInt(bytes.length), bytes]);
}

function writeIntList(ctx, values) {
  const list = Array.isArray(values) ? values : [];
  return Buffer.concat([writeVarInt(list.length), ...list.map((value) => ctx.writeSignedVarInt(Number(value) || 0))]);
}

function writeObjectList(values) {
  const list = Array.isArray(values) ? values : [];
  return Buffer.concat([writeVarInt(list.length), ...list]);
}

function writeNullableObject(payload) {
  return Buffer.concat([Buffer.from([1]), payload]);
}

function writeNullableObjectOrNull(payload) {
  return payload ? writeNullableObject(payload) : writeNullObject();
}

function writeNullObject() {
  return Buffer.from([0]);
}

function writeDoubleLE(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeDoubleLE(Number(value) || 0, 0);
  return buffer;
}

function writeSignedVarInt(value) {
  return writeVarInt(zigZagEncode32(value));
}

function writeVarInt(value) {
  let v = Number(value) >>> 0;
  const bytes = [];
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v);
  return Buffer.from(bytes);
}

function readSignedVarInt(buffer, offset) {
  const raw = readVarInt(buffer, offset);
  return { value: zigZagDecode32(raw.value), offset: raw.offset };
}

function readVarInt(buffer, offset) {
  let result = 0;
  let shift = 0;
  while (shift < 32) {
    if (offset >= buffer.length) throw new Error("truncated varint");
    const byte = buffer.readUInt8(offset++);
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: result >>> 0, offset };
    shift += 7;
  }
  throw new Error("varint too long");
}

function zigZagEncode32(value) {
  const v = Number(value) | 0;
  return ((v << 1) ^ (v >> 31)) >>> 0;
}

function zigZagDecode32(value) {
  return (value >>> 1) ^ -(value & 1);
}

module.exports = {
  PACKETS,
  createShopHandler,
  loadShopCatalog,
};
