const {
  writeString,
  writeBool,
  writeByte,
  writeSignedVarInt,
  writeSignedVarLong,
  writeInt64LE,
  writeFloatLE,
  writeNullableObject,
  writeNullableObjectOrNull,
  writeNullObject,
  writeObjectList,
  writeObjectMapInt,
  writeIntList,
  buildItemMiscData,
  buildRewardData,
  readBool,
  readByte,
  readSignedVarInt,
  readSignedVarIntList,
  readSignedVarLong,
  toBigInt,
} = require("../packet-codec");
const { readGameplayTableRecords } = require("../gameplay-jsons");
const { grantMiscItem, getMiscItem, spendMiscItem } = require("../inventory");
const { ensureArmy, getArmyUnits, buildPlayerDeckForGameLoad } = require("../unit");

const TICKS_AT_UNIX_EPOCH = 621355968000000000n;
const DATE_TIME_LOCAL_MASK = 0x4000000000000000n;
const DATE_TIME_TICK_MASK = 0x3fffffffffffffffn;
const TICKS_PER_SECOND = 10000000n;
const TICKS_PER_MINUTE = TICKS_PER_SECOND * 60n;
const TICKS_PER_HOUR = TICKS_PER_MINUTE * 60n;
const TICKS_PER_DAY = TICKS_PER_HOUR * 24n;

const ITEM_ID_CREDIT = 1;
const ITEM_ID_ETERNIUM = 2;
const ITEM_ID_INFORMATION = 5;
const ITEM_ID_QUARTZ = 101;
const ITEM_ID_DIVE_PERMIT = 1065;

const NEC_OK = 0;
const NEC_FAIL_INSUFFICIENT_CASH = 91;
const NEC_FAIL_INSUFFICIENT_CREDIT = 93;
const NEC_FAIL_WORLDMAP_INVALID_CITY_ID = 149;
const NEC_FAIL_WORLDMAP_FULL_AREA = 151;
const NEC_FAIL_WORLDMAP_CITY_ALREADY_OPENED = 153;

const CITY_OPEN_CASH_COSTS = Object.freeze([0, 800, 2400, 4500, 8000, 12500]);
const CITY_OPEN_CREDIT_COSTS = Object.freeze([0, 100000, 200000, 400000, 800000, 1600000]);
const CITY_UNLOCK_LEVELS = Object.freeze([0, 1, 10, 25, 35, 45, 55]);
const STRICT_BRANCH_UNLOCK_ERRORS = envFlagDefault(false, "CS_WORLDMAP_STRICT_BRANCH_UNLOCK");

const WORLD_MAP_PACKET_IDS = [2000, 2002, 2004, 2006, 2008, 2010, 2012, 2014, 2016, 2018, 2020, 2022, 2024];
const DIVE_PACKET_IDS = [1206, 1208, 1210, 1212, 1215, 1217, 1249];
const RAID_PACKET_IDS = [802, 885, 2200, 2202, 2204, 2206, 2208, 2210, 2212, 2214, 2217, 2219];

let tableCache = null;

function createWorldMapHandlers() {
  return [...WORLD_MAP_PACKET_IDS, ...DIVE_PACKET_IDS, ...RAID_PACKET_IDS].map((packetId) => ({
    packetId,
    name: `WORLD_MAP_${packetId}`,
    handle(ctx, socket, packet) {
      const user = getSocketUser(ctx, socket);
      const now = getContextNow(ctx);
      const req = decodeRequest(ctx, packetId, packet.payload);
      if (packetId === 802) return handleRaidGameLoad(ctx, socket, packet, user, req, { now });
      const response = buildPacketResponse(user, packetId, req, { now });
      console.log(`[world-map:${packetId}] ${describeRequest(packetId, req)} ACK packetId=${response.packetId}`);
      ctx.sendResponse(socket, packet.sequence, response.packetId, () =>
        ctx.buildEncryptedPacket(packet.sequence, response.packetId, response.payload)
      );
      if (ctx.config && ctx.config.USE_LOCAL_USER_DB && typeof ctx.saveUserDb === "function") ctx.saveUserDb();
      return true;
    },
  }));
}

function buildPacketResponse(user, packetId, req, options = {}) {
  switch (packetId) {
    case 2000:
      return ack(2001, [writeSignedVarInt(0), writeNullableObject(buildWorldMapData(user, options))]);
    case 2002: {
      const result = unlockCity(user, req.cityID, { ...options, isCash: req.isCash });
      return ack(2003, [
        writeSignedVarInt(result.errorCode || NEC_OK),
        result.city ? writeNullableObject(buildWorldMapCityData(result.city)) : writeNullObject(),
        result.costItem ? writeNullableObject(buildItemMiscData(result.costItem)) : writeNullObject(),
      ]);
    }
    case 2004: {
      const city = setCityLeader(user, req.cityID, req.leaderUID, options);
      return ack(2005, [writeSignedVarInt(0), writeSignedVarInt(city.cityID), writeSignedVarLong(toBigInt(city.leaderUnitUID))]);
    }
    case 2006: {
      const result = startWorldMapMission(user, req.cityID, req.missionID, options);
      return ack(2007, [
        writeSignedVarInt(0),
        writeSignedVarInt(result.city.cityID),
        writeSignedVarInt(result.missionID),
        writeSignedVarLong(result.completeTime),
      ]);
    }
    case 2008: {
      const city = cancelWorldMapMission(user, req.cityID, options);
      return ack(2009, [writeSignedVarInt(0), writeSignedVarInt(city.cityID)]);
    }
    case 2010: {
      const city = refreshWorldMapMissionList(user, req.cityID, { ...options, force: true });
      return ack(2011, [writeSignedVarInt(0), writeSignedVarInt(city.cityID), writeIntList(city.mission.stMissionIDList), writeNullObject()]);
    }
    case 2012: {
      const result = completeWorldMapMission(user, req.cityID, options);
      return ack(2013, [
        writeSignedVarInt(0),
        writeSignedVarInt(result.city.cityID),
        writeSignedVarInt(result.clearedMissionID),
        writeSignedVarInt(result.city.level),
        writeSignedVarInt(result.city.exp),
        writeIntList(result.city.mission.stMissionIDList),
        writeNullableObject(buildRewardData(result.reward || {})),
        writeBool(result.isSuccess),
        writeNullableObjectOrNull(result.worldMapEventGroup ? buildWorldMapEventGroupData(result.worldMapEventGroup) : null),
      ]);
    }
    case 2014: {
      const city = clearWorldMapEvent(user, req.cityID, options);
      return ack(2015, [writeSignedVarInt(0), writeSignedVarInt(city.cityID)]);
    }
    case 2016: {
      const result = collectWorldMapIncome(user, options);
      return ack(2017, [writeSignedVarInt(0), writeMiscItemList(result.items)]);
    }
    case 2018: {
      const result = buildCityBuilding(user, req.cityID, req.buildID, options);
      return ack(2019, [
        writeSignedVarInt(0),
        writeSignedVarInt(result.city.cityID),
        writeSignedVarInt(result.building.id),
        writeMiscItemList(result.costItems),
      ]);
    }
    case 2020: {
      const result = levelUpCityBuilding(user, req.cityID, req.buildID, options);
      return ack(2021, [
        writeSignedVarInt(0),
        writeSignedVarInt(result.city.cityID),
        writeNullableObject(buildWorldMapBuildingData(result.building)),
        writeMiscItemList(result.costItems),
      ]);
    }
    case 2022: {
      const result = expireCityBuilding(user, req.cityID, req.buildID, options);
      return ack(2023, [
        writeSignedVarInt(0),
        writeSignedVarInt(result.city.cityID),
        writeSignedVarInt(req.buildID),
        writeNullableObjectOrNull(result.item ? buildItemMiscData(result.item) : null),
      ]);
    }
    case 2024: {
      const city = clearWorldMapEvent(user, req.cityID, options);
      return ack(2025, [writeSignedVarInt(0), writeSignedVarInt(city.cityID)]);
    }
    case 1206: {
      const result = startDive(user, req, options);
      return ack(1207, [
        writeSignedVarInt(0),
        writeSignedVarInt(result.cityID),
        writeNullableObject(buildDiveGameData(result.dive)),
        writeMiscItemList(result.costItems),
      ]);
    }
    case 1208: {
      const result = moveDiveForward(user, req.slotIndex, options);
      return ack(1209, [writeSignedVarInt(0), writeNullableObject(buildDiveSyncData(result.syncData))]);
    }
    case 1210:
      giveUpDive(user);
      return ack(1211, [writeSignedVarInt(0)]);
    case 1212:
      setDiveAuto(user, req.isAuto);
      return ack(1213, [writeSignedVarInt(0), writeBool(Boolean(req.isAuto))]);
    case 1215: {
      const result = selectDiveArtifact(user, req.artifactID);
      return ack(1216, [writeSignedVarInt(0), writeNullableObject(buildDiveSyncData(result.syncData))]);
    }
    case 1217: {
      const result = suicideDiveSquad(user, req.selectDeckIndex);
      return ack(1218, [writeSignedVarInt(0), writeNullableObject(buildDiveSyncData(result.syncData))]);
    }
    case 1249: {
      const result = skipDive(user, req, options);
      return ack(1250, [
        writeSignedVarInt(0),
        writeObjectList(result.rewards.map((reward) => writeNullableObject(buildRewardData(reward)))),
        writeMiscItemList(result.costItems),
        writeSignedVarInt(result.deletedEventCityId),
      ]);
    }
    case 885: {
      const result = sweepRaid(user, req.raidUid, options);
      return ack(886, [
        writeSignedVarInt(0),
        writeSignedVarLong(result.raidUid),
        writeNullableObject(buildRaidBossResultData(result.bossResult)),
        writeMiscItemList(result.costItems),
        writeNullableObject(buildRaidDetailData(user, result.raid)),
      ]);
    }
    case 2200:
      return ack(2201, [writeSignedVarInt(0), writeObjectList(getActiveRaids(user, options).map((raid) => writeNullableObject(buildMyRaidData(raid))))]);
    case 2202:
      return ack(2203, [writeSignedVarInt(0), writeObjectList([])]);
    case 2204: {
      const raid = getRaidByUid(user, req.raidUID, options) || ensureSoloRaid(user, 1, options);
      raid.isCoop = false;
      return ack(2205, [writeSignedVarInt(0), writeSignedVarLong(toBigInt(raid.raidUID)), writeObjectList([])]);
    }
    case 2206:
      return ack(2207, [writeSignedVarInt(0), writeObjectList([])]);
    case 2208: {
      const raid = getRaidByUid(user, req.raidUID, options) || ensureSoloRaid(user, 1, options);
      raid.isNew = false;
      return ack(2209, [writeSignedVarInt(0), writeNullableObject(buildRaidDetailData(user, raid))]);
    }
    case 2210:
      return ack(2211, [writeSignedVarInt(0), writeObjectList(getRaidResults(user).map((raid) => writeNullableObject(buildRaidResultData(user, raid))))]);
    case 2212: {
      const result = acceptRaidResult(user, req.raidUID, options);
      return ack(2213, [
        writeSignedVarInt(0),
        writeSignedVarLong(result.raidUid),
        writeNullableObject(buildRewardData(result.reward || {})),
        writeSignedVarInt(result.rewardRaidPoint),
      ]);
    }
    case 2214: {
      const result = acceptAllRaidResults(user, options);
      return ack(2215, [
        writeSignedVarInt(0),
        writeObjectList(result.raidUids.map((raidUid) => writeSignedVarLong(raidUid))),
        writeNullableObject(buildRewardData(result.reward || {})),
        writeSignedVarInt(result.rewardRaidPoint),
      ]);
    }
    case 2217:
      return ack(2218, [writeSignedVarInt(0), writeNullableObject(buildRewardData({}))]);
    case 2219:
      return ack(2220, [writeSignedVarInt(0), writeNullableObject(buildRewardData({})), writeNullableObject(buildRaidSeasonData(user, options))]);
    default:
      return ack(packetId + 1, [writeSignedVarInt(0)]);
  }
}

function ack(packetId, parts) {
  return { packetId, payload: Buffer.concat(parts) };
}

function handleRaidGameLoad(ctx, socket, packet, user, req, options = {}) {
  const raid = getRaidByUid(user, req.raidUID, options) || ensureSoloRaid(user, firstCityId(), options);
  const raidTemplet = getRaidTemplet(raid.stageID);
  const dungeonID = positiveInt(raidTemplet && raidTemplet.m_DungeonID) || raid.stageID;
  const stageFromTables =
    ctx && typeof ctx.getGenericStageForRequest === "function"
      ? ctx.getGenericStageForRequest({ stageID: raid.stageID, dungeonID })
      : null;
  const gameReq = {
    stageID: Number((stageFromTables && stageFromTables.stageId) || raid.stageID),
    dungeonID,
    gameType: 12,
    deckIndex: { deckType: 1, index: Number(req.selectDeckIndex || 0) || 0 },
    raidUID: toBigInt(raid.raidUID),
    buffList: Array.isArray(req.buffList) ? req.buffList : [],
    isTryAssist: Boolean(req.isTryAssist),
    supportingUserUid: toBigInt(req.supportingUserUid || 0),
  };
  const playerDeck = buildPlayerDeckForGameLoad(user, gameReq);
  const stage = {
    ...(stageFromTables || {}),
    stageId: gameReq.stageID,
    dungeonID,
    mapID: Number(stageFromTables && stageFromTables.mapID) || 0,
    gameType: 12,
    tutorial: false,
    cutsceneOnly: false,
    initialUnits: [],
    autoDeployUnits: [],
    initialRemainGameTime: 180,
    playerDeck,
    raidUID: String(raid.raidUID),
  };
  if (socket.session && socket.session.gameReplay) {
    socket.session.gameReplay.lastGameLoadReq = {
      stageID: gameReq.stageID,
      dungeonID,
      raidUID: String(raid.raidUID),
    };
  }
  if (ctx.config && ctx.config.DYNAMIC_BATTLE_MANAGER && typeof ctx.sendDynamicGameLoadAck === "function") {
    if (ctx.sendDynamicGameLoadAck(socket, gameReq, stage)) {
      console.log(`[world-map:802] raidUID=${raid.raidUID} stageID=${gameReq.stageID} dungeonID=${dungeonID} dynamic GAME_LOAD_ACK`);
      return true;
    }
  }
  const payload =
    typeof ctx.buildGameLoadAck === "function"
      ? ctx.buildGameLoadAck({ stageID: gameReq.stageID, dungeonID, mapID: stage.mapID, raidUID: toBigInt(raid.raidUID), gameType: 12 })
      : Buffer.concat([writeSignedVarInt(0), writeNullObject(), writeObjectList([])]);
  const ackPacketId = (ctx.constants && ctx.constants.GAME_LOAD_ACK) || 804;
  console.log(`[world-map:802] raidUID=${raid.raidUID} stageID=${gameReq.stageID} dungeonID=${dungeonID} ACK packetId=${ackPacketId}`);
  ctx.sendResponse(socket, packet.sequence, ackPacketId, () => ctx.buildEncryptedPacket(packet.sequence, ackPacketId, payload));
  if (ctx.config && ctx.config.USE_LOCAL_USER_DB && typeof ctx.saveUserDb === "function") ctx.saveUserDb();
  return true;
}

function buildWorldMapData(user, options = {}) {
  const state = ensureWorldMapState(user, options);
  refreshWorldMapState(user, options);
  const cityEntries = Object.values(state.cities)
    .sort((a, b) => a.cityID - b.cityID)
    .map((city) => [city.cityID, buildWorldMapCityData(city)]);
  return Buffer.concat([writeObjectMapInt(cityEntries), writeInt64LE(toBigInt(state.collectLastResetDate || binaryNow(options)))]);
}

function getWorldMapCityIds(user, options = {}) {
  const state = options.includeDefaults ? ensureWorldMapState(user, options) : ensureBareWorldMapState(user, options);
  return uniquePositiveIntsInOrder(
    Object.entries(state.cities || {}).map(([key, city]) => positiveInt(city && city.cityID) || positiveInt(key))
  ).sort((a, b) => a - b);
}

function buildWorldMapCityData(city) {
  const normalized = normalizeCityState(city || {}, Number(city && city.cityID) || 1);
  const buildingEntries = Object.values(normalized.buildings)
    .sort((a, b) => a.id - b.id)
    .map((building) => [building.id, buildWorldMapBuildingData(building)]);
  return Buffer.concat([
    writeSignedVarInt(normalized.cityID),
    writeSignedVarLong(toBigInt(normalized.leaderUnitUID || 0)),
    writeSignedVarInt(normalized.exp),
    writeSignedVarInt(normalized.level),
    writeNullableObject(buildWorldMapMissionData(normalized.mission)),
    writeNullableObjectOrNull(isActiveEventGroup(normalized.eventGroup) ? buildWorldMapEventGroupData(normalized.eventGroup) : null),
    writeObjectMapInt(buildingEntries),
  ]);
}

function buildWorldMapMissionData(mission) {
  const data = normalizeMissionState(mission || {});
  return Buffer.concat([
    writeSignedVarInt(data.currentMissionID),
    writeSignedVarLong(toBigInt(data.completeTime || 0)),
    writeInt64LE(toBigInt(data.startDate || 0)),
    writeIntList(data.stMissionIDList),
  ]);
}

function buildWorldMapEventGroupData(group) {
  const data = normalizeEventGroup(group || {});
  return Buffer.concat([
    writeSignedVarInt(data.worldmapEventID),
    writeInt64LE(toBigInt(data.eventGroupEndDate || 0)),
    writeSignedVarLong(toBigInt(data.eventUid || 0)),
  ]);
}

function buildWorldMapBuildingData(building) {
  const data = normalizeBuildingState(building || {}, Number(building && building.id) || 1);
  return Buffer.concat([
    writeSignedVarLong(toBigInt(data.buildUID || 0)),
    writeSignedVarInt(data.id),
    writeSignedVarInt(data.level),
  ]);
}

function buildActiveDiveGameData(user, options = {}) {
  const state = ensureWorldMapState(user, options);
  const dive = state.dive && state.dive.active ? normalizeDiveState(state.dive.active, options) : null;
  return dive ? buildDiveGameData(dive) : null;
}

function buildDiveClearData(user, options = {}) {
  const state = ensureWorldMapState(user, options);
  return writeIntList(state.diveClearStages);
}

function buildDiveHistoryData(user, options = {}) {
  const state = ensureWorldMapState(user, options);
  return writeIntList(state.diveHistoryStages);
}

function hasWorldMapProgress(user) {
  if (envFlagDefault(false, "CS_WORLDMAP_UNLOCK_ALL_BRANCHES")) return true;
  const state = user && user.worldMap && typeof user.worldMap === "object" ? user.worldMap : null;
  if (!state) return false;

  const cities = state.cities && typeof state.cities === "object" ? Object.entries(state.cities) : [];
  const defaultCityIds = new Set(getDefaultCityIds().map(String));
  let cityCount = 0;
  for (const [key, city] of cities) {
    if (!city || typeof city !== "object") continue;
    cityCount += 1;
    const cityID = positiveInt(city.cityID) || positiveInt(key);
    if (cityID && !defaultCityIds.has(String(cityID))) return true;
    if (positiveInt(city.level) > 1 || positiveInt(city.exp) > 0) return true;
    if (toBigInt(city.leaderUnitUID || city.leaderUID || 0) > 0n) return true;

    const mission = city.mission && typeof city.mission === "object" ? city.mission : {};
    if (positiveInt(mission.currentMissionID) > 0) return true;
    if (toBigInt(mission.completeTime || 0) > 0n || toBigInt(mission.startDate || 0) > 0n) return true;
    if (positiveInt(mission.refreshNonce) > 0) return true;

    const eventGroup = city.eventGroup && typeof city.eventGroup === "object" ? city.eventGroup : {};
    if (positiveInt(eventGroup.worldmapEventID) > 0 || toBigInt(eventGroup.eventUid || 0) > 0n) return true;

    const buildings = city.buildings && typeof city.buildings === "object" ? Object.entries(city.buildings) : [];
    for (const [buildingKey, building] of buildings) {
      const buildID = positiveInt(building && building.id) || positiveInt(buildingKey);
      if (buildID && buildID !== 1) return true;
      if (positiveInt(building && building.level) > 1) return true;
      if (toBigInt(building && (building.buildUID || building.uid) || 0) > 0n) return true;
    }
  }
  if (cityCount > defaultCityIds.size) return true;
  if (state.raids && typeof state.raids === "object" && Object.keys(state.raids).length > 0) return true;
  if (state.raidResults && typeof state.raidResults === "object" && Object.keys(state.raidResults).length > 0) return true;
  if (state.dive && typeof state.dive === "object" && state.dive.active) return true;
  if (Array.isArray(state.diveClearStages) && state.diveClearStages.length > 0) return true;
  if (Array.isArray(state.diveHistoryStages) && state.diveHistoryStages.length > 0) return true;
  return false;
}

function ensureWorldMapState(user, options = {}) {
  if (!user || typeof user !== "object") {
    return {
      schemaVersion: 1,
      cities: {},
      raids: {},
      raidResults: {},
      diveClearStages: [],
      diveHistoryStages: [],
      collectLastResetDate: String(binaryNow(options)),
      nextUid: "900000000001",
    };
  }

  user.worldMap = user.worldMap && typeof user.worldMap === "object" ? user.worldMap : {};
  const state = user.worldMap;
  state.schemaVersion = 1;
  state.cities = state.cities && typeof state.cities === "object" ? state.cities : {};
  state.raids = state.raids && typeof state.raids === "object" ? state.raids : {};
  state.raidResults = state.raidResults && typeof state.raidResults === "object" ? state.raidResults : {};
  state.dive = state.dive && typeof state.dive === "object" ? state.dive : {};
  state.diveClearStages = uniquePositiveInts(state.diveClearStages);
  state.diveHistoryStages = uniquePositiveInts(state.diveHistoryStages);
  state.collectLastResetDate = String(state.collectLastResetDate || binaryNow(options));
  state.nextUid = String(state.nextUid || defaultNextUid(user));

  const cityIds = getDefaultCityIds();
  for (const cityID of cityIds) ensureCityState(user, cityID, options);
  refreshWorldMapState(user, options);
  return state;
}

function refreshWorldMapState(user, options = {}) {
  const state = ensureBareWorldMapState(user, options);
  const now = ticksNow(options);
  for (const city of Object.values(state.cities)) {
    normalizeCityState(city, city.cityID || 1);
    if (isActiveEventGroup(city.eventGroup) && ticksFromDateTimeBinary(city.eventGroup.eventGroupEndDate) <= now) {
      city.eventGroup = normalizeEventGroup(null);
    }
    refreshCityMissionList(user, city, options);
  }
  for (const [raidUid, raid] of Object.entries(state.raids)) {
    const normalized = normalizeRaidState(raid);
    if (toBigInt(normalized.expireDate) <= now || Number(normalized.curHP || 0) <= 0) {
      delete state.raids[raidUid];
    } else {
      state.raids[raidUid] = normalized;
    }
  }
  return state;
}

function ensureBareWorldMapState(user, options = {}) {
  if (!user || typeof user !== "object") return ensureWorldMapState(null, options);
  user.worldMap = user.worldMap && typeof user.worldMap === "object" ? user.worldMap : {};
  const state = user.worldMap;
  state.cities = state.cities && typeof state.cities === "object" ? state.cities : {};
  state.raids = state.raids && typeof state.raids === "object" ? state.raids : {};
  state.raidResults = state.raidResults && typeof state.raidResults === "object" ? state.raidResults : {};
  state.dive = state.dive && typeof state.dive === "object" ? state.dive : {};
  return state;
}

function unlockCity(user, cityID, options = {}) {
  const requestedCityID = positiveInt(cityID) || firstCityId();
  if (!isKnownCityId(requestedCityID)) {
    return { errorCode: NEC_FAIL_WORLDMAP_INVALID_CITY_ID, city: null, costItem: null, established: false };
  }

  const state = ensureWorldMapState(user, options);
  if (state.cities[String(requestedCityID)]) {
    return {
      errorCode: STRICT_BRANCH_UNLOCK_ERRORS ? NEC_FAIL_WORLDMAP_CITY_ALREADY_OPENED : NEC_OK,
      city: ensureCityState(user, requestedCityID, options),
      costItem: null,
      established: false,
    };
  }

  const unlockedCityCount = getUnlockedCityCount(state);
  if (STRICT_BRANCH_UNLOCK_ERRORS && !options.isCash && unlockedCityCount >= getPossibleCityCount(user)) {
    return { errorCode: NEC_FAIL_WORLDMAP_FULL_AREA, city: null, costItem: null, established: false };
  }

  const itemId = options.isCash ? ITEM_ID_QUARTZ : ITEM_ID_CREDIT;
  const cost = getCityOpenCost(unlockedCityCount, Boolean(options.isCash));
  if (STRICT_BRANCH_UNLOCK_ERRORS && cost > 0 && getMiscItemBalance(user, itemId) < BigInt(cost)) {
    return {
      errorCode: options.isCash ? NEC_FAIL_INSUFFICIENT_CASH : NEC_FAIL_INSUFFICIENT_CREDIT,
      city: null,
      costItem: null,
      established: false,
    };
  }

  const costItem = cost > 0 ? spendMiscItem(user, itemId, cost, { regDate: String(binaryNow(options)) }) : null;
  const city = ensureCityState(user, requestedCityID, options);
  refreshCityMissionList(user, city, options);
  return { errorCode: NEC_OK, city, costItem, established: true };
}

function ensureCityState(user, cityID, options = {}) {
  const state = ensureBareWorldMapState(user, options);
  const id = positiveInt(cityID) || firstCityId();
  const key = String(id);
  state.cities[key] = normalizeCityState(state.cities[key] || {}, id);
  if (!state.cities[key].mission.stMissionIDList.length) refreshCityMissionList(user, state.cities[key], { ...options, force: true });
  return state.cities[key];
}

function normalizeCityState(city, cityID) {
  const data = city && typeof city === "object" ? city : {};
  data.cityID = positiveInt(data.cityID) || positiveInt(cityID) || 1;
  data.leaderUnitUID = String(data.leaderUnitUID || data.leaderUID || "0");
  data.exp = Math.max(0, Number(data.exp || 0) || 0);
  data.level = clampPositiveInt(data.level, 1, getCityMaxLevel(data.cityID));
  data.mission = normalizeMissionState(data.mission);
  data.eventGroup = normalizeEventGroup(data.eventGroup);
  data.buildings = data.buildings && typeof data.buildings === "object" ? data.buildings : {};
  for (const [key, value] of Object.entries(data.buildings)) {
    const id = positiveInt((value && value.id) || key);
    if (!id) {
      delete data.buildings[key];
      continue;
    }
    if (String(key) !== String(id)) delete data.buildings[key];
    data.buildings[String(id)] = normalizeBuildingState(value, id);
  }
  if (!data.buildings["1"]) data.buildings["1"] = normalizeBuildingState({ id: 1, level: 1 }, 1);
  return data;
}

function normalizeMissionState(mission) {
  const data = mission && typeof mission === "object" ? mission : {};
  return {
    currentMissionID: positiveInt(data.currentMissionID) || 0,
    completeTime: String(toBigInt(data.completeTime || 0)),
    startDate: String(toBigInt(data.startDate || 0)),
    stMissionIDList: uniquePositiveInts(data.stMissionIDList),
    refreshToken: String(data.refreshToken || ""),
    refreshNonce: Math.max(0, Number(data.refreshNonce || 0) || 0),
  };
}

function normalizeEventGroup(group) {
  const data = group && typeof group === "object" ? group : {};
  return {
    worldmapEventID: positiveInt(data.worldmapEventID) || 0,
    eventGroupEndDate: String(toBigInt(data.eventGroupEndDate || 0)),
    eventUid: String(toBigInt(data.eventUid || 0)),
  };
}

function normalizeBuildingState(building, buildID) {
  const data = building && typeof building === "object" ? building : {};
  return {
    buildUID: String(toBigInt(data.buildUID || data.uid || 0)),
    id: positiveInt(data.id) || positiveInt(buildID) || 1,
    level: clampPositiveInt(data.level, 1, 10),
  };
}

function setCityLeader(user, cityID, leaderUID, options = {}) {
  const city = ensureCityState(user, cityID, options);
  city.leaderUnitUID = String(toBigInt(leaderUID || 0));
  return city;
}

function startWorldMapMission(user, cityID, missionID, options = {}) {
  const city = ensureCityState(user, cityID, options);
  refreshCityMissionList(user, city, options);
  const selectedMissionID = positiveInt(missionID) || city.mission.stMissionIDList[0] || firstMissionId();
  if (!city.mission.stMissionIDList.includes(selectedMissionID)) {
    city.mission.stMissionIDList = [selectedMissionID, ...city.mission.stMissionIDList].slice(0, 4);
  }
  const mission = getMissionById(selectedMissionID);
  const nowBinary = binaryNow(options);
  const completeTime = ticksNow(options) + BigInt(Math.max(1, Number(mission && mission.m_MissionTime) || 60)) * TICKS_PER_MINUTE;
  city.mission.currentMissionID = selectedMissionID;
  city.mission.startDate = String(nowBinary);
  city.mission.completeTime = String(completeTime);
  return { city, missionID: selectedMissionID, completeTime };
}

function cancelWorldMapMission(user, cityID, options = {}) {
  const city = ensureCityState(user, cityID, options);
  city.mission.currentMissionID = 0;
  city.mission.completeTime = "0";
  city.mission.startDate = "0";
  return city;
}

function refreshWorldMapMissionList(user, cityID, options = {}) {
  const city = ensureCityState(user, cityID, options);
  city.mission.refreshNonce += options.force ? 1 : 0;
  refreshCityMissionList(user, city, { ...options, force: true });
  return city;
}

function refreshCityMissionList(user, city, options = {}) {
  const mission = normalizeMissionState(city.mission);
  const token = `${dayKeyFromTicks(ticksNow(options))}:${mission.refreshNonce}`;
  if (!options.force && mission.refreshToken === token && mission.stMissionIDList.length >= 4) {
    city.mission = mission;
    return city;
  }
  const ids = chooseMissionIds(user, city, token, 4);
  if (mission.currentMissionID > 0 && !ids.includes(mission.currentMissionID)) ids[0] = mission.currentMissionID;
  mission.stMissionIDList = uniquePositiveIntsInOrder(ids).slice(0, 4);
  mission.refreshToken = token;
  city.mission = mission;
  return city;
}

function completeWorldMapMission(user, cityID, options = {}) {
  const city = ensureCityState(user, cityID, options);
  const missionID = positiveInt(city.mission.currentMissionID);
  const mission = getMissionById(missionID);
  const now = ticksNow(options);
  const completeTime = toBigInt(city.mission.completeTime || 0);
  const canComplete = missionID > 0 && (completeTime <= now || envFlagDefault(false, "CS_WORLDMAP_ALLOW_EARLY_COMPLETE"));
  if (!canComplete) {
    return {
      city,
      clearedMissionID: missionID || 0,
      reward: {},
      isSuccess: false,
      worldMapEventGroup: isActiveEventGroup(city.eventGroup) ? city.eventGroup : null,
    };
  }

  const reward = grantMissionReward(user, mission, options);
  city.exp = Math.max(0, city.exp + (Number(mission && mission.m_RewardCityEXP) || 0));
  city.level = computeCityLevel(city.cityID, city.exp);
  city.mission.currentMissionID = 0;
  city.mission.completeTime = "0";
  city.mission.startDate = "0";
  refreshWorldMapMissionList(user, city.cityID, { ...options, force: true });
  const worldMapEventGroup = maybeSpawnRaidEvent(user, city, mission, options);
  return {
    city,
    clearedMissionID: missionID,
    reward,
    isSuccess: true,
    worldMapEventGroup,
  };
}

function grantMissionReward(user, mission, options = {}) {
  const miscItems = [];
  const now = String(binaryNow(options));
  const rows = [
    [ITEM_ID_CREDIT, Number(mission && mission.m_RewardCredit) || 0],
    [ITEM_ID_ETERNIUM, Number(mission && mission.m_RewardEternium) || 0],
    [ITEM_ID_INFORMATION, Number(mission && mission.m_RewardInformation) || 0],
  ];
  for (const [itemId, count] of rows) {
    const item = grantMiscItem(user, itemId, count, 0, { regDate: now });
    if (item) miscItems.push(item);
  }
  const rewardType = String((mission && mission.m_CompleteReward_Type) || "").toUpperCase();
  const rewardId = positiveInt(mission && mission.m_CompleteReward_ID);
  const rewardQuantity = Math.max(0, Number(mission && mission.m_CompleteRewardQuantity) || 0);
  if (rewardType === "RT_MISC" && rewardId > 0 && rewardQuantity > 0) {
    const item = grantMiscItem(user, rewardId, rewardQuantity, 0, { regDate: now });
    if (item) miscItems.push(item);
  }
  return { miscItems };
}

function maybeSpawnRaidEvent(user, city, mission, options = {}) {
  const chanceFromEnv = process.env.CS_WORLDMAP_RAID_CHANCE;
  const tableChance = Number(mission && mission.m_WorldmapEventRatio) || 0;
  const chance = chanceFromEnv == null ? (tableChance > 0 ? tableChance : 20) : Math.max(0, Number(chanceFromEnv) || 0);
  if (chance <= 0 && !envFlag("CS_WORLDMAP_FORCE_RAID")) return null;
  const seed = `${city.cityID}:${mission && mission.m_WorldmapMissionID}:${city.exp}:${dayKeyFromTicks(ticksNow(options))}`;
  const roll = hashString(seed) % 100;
  if (!envFlag("CS_WORLDMAP_FORCE_RAID") && roll >= chance) return null;

  const tables = getTables();
  const groupID = positiveInt(mission && mission.m_WorldmapEventGroup) || 1;
  const candidates = tables.worldMapEventGroups.filter(
    (row) => Number(row.GROUP_ID || 0) === groupID && String(row.WORLDMAP_EVENT_TYPE || "").toUpperCase() === "WET_RAID"
  );
  const event = candidates.length ? candidates[hashString(seed + ":event") % candidates.length] : tables.worldMapEventGroups[0] || null;
  const durationHours = Math.max(1, Number(event && event.EVENT_DURATION_TIME) || 6);
  const expireTicks = ticksNow(options) + BigInt(durationHours) * TICKS_PER_HOUR;
  const raid = ensureSoloRaid(user, city.cityID, {
    ...options,
    expireTicks,
    worldmapEventID: positiveInt(event && event.EVENT_ID) || 2001001,
  });
  city.eventGroup = {
    worldmapEventID: positiveInt(event && event.EVENT_ID) || 2001001,
    eventGroupEndDate: String(binaryFromTicks(expireTicks)),
    eventUid: String(raid.raidUID),
  };
  return city.eventGroup;
}

function clearWorldMapEvent(user, cityID, options = {}) {
  const city = ensureCityState(user, cityID, options);
  const eventUid = toBigInt(city.eventGroup && city.eventGroup.eventUid);
  city.eventGroup = normalizeEventGroup(null);
  const state = ensureWorldMapState(user, options);
  if (eventUid > 0n) delete state.raids[String(eventUid)];
  return city;
}

function collectWorldMapIncome(user, options = {}) {
  const state = ensureWorldMapState(user, options);
  const now = ticksNow(options);
  const last = ticksFromDateTimeBinary(state.collectLastResetDate || 0) || now;
  const elapsedHours = Number(clampBigInt((now - last) / TICKS_PER_HOUR, 1n, 168n));
  const cityPower = Object.values(state.cities).reduce((sum, city) => sum + Math.max(1, Number(city.level || 1)), 0);
  const credit = Math.max(0, cityPower * elapsedHours * 250);
  const info = Math.max(0, cityPower * elapsedHours * 5);
  const items = [];
  const regDate = String(binaryNow(options));
  const creditItem = grantMiscItem(user, ITEM_ID_CREDIT, credit, 0, { regDate });
  const infoItem = grantMiscItem(user, ITEM_ID_INFORMATION, info, 0, { regDate });
  if (creditItem) items.push(creditItem);
  if (infoItem) items.push(infoItem);
  state.collectLastResetDate = String(binaryNow(options));
  return { items };
}

function buildCityBuilding(user, cityID, buildID, options = {}) {
  const city = ensureCityState(user, cityID, options);
  const id = positiveInt(buildID) || 1;
  const existing = city.buildings[String(id)];
  const costItems = [];
  if (!existing) {
    const row = getBuildingRow(id, 1);
    const costCredit = Math.max(0, Number(row && row.COST_CREDIT) || 0);
    const spent = costCredit > 0 ? spendMiscItem(user, ITEM_ID_CREDIT, costCredit, { regDate: String(binaryNow(options)) }) : null;
    if (spent) costItems.push(spent);
    city.buildings[String(id)] = {
      buildUID: String(nextWorldMapUid(user, options)),
      id,
      level: 1,
    };
  }
  return { city, building: city.buildings[String(id)], costItems };
}

function levelUpCityBuilding(user, cityID, buildID, options = {}) {
  const city = ensureCityState(user, cityID, options);
  const id = positiveInt(buildID) || 1;
  if (!city.buildings[String(id)]) city.buildings[String(id)] = { buildUID: String(nextWorldMapUid(user, options)), id, level: 1 };
  const building = city.buildings[String(id)];
  const nextLevel = building.level + 1;
  const row = getBuildingRow(id, nextLevel);
  const costItems = [];
  if (row) {
    const costCredit = Math.max(0, Number(row.COST_CREDIT) || 0);
    const spent = costCredit > 0 ? spendMiscItem(user, ITEM_ID_CREDIT, costCredit, { regDate: String(binaryNow(options)) }) : null;
    if (spent) costItems.push(spent);
    building.level = nextLevel;
  }
  return { city, building, costItems };
}

function expireCityBuilding(user, cityID, buildID, options = {}) {
  const city = ensureCityState(user, cityID, options);
  const id = positiveInt(buildID) || 0;
  const building = city.buildings[String(id)];
  let item = null;
  if (building && id !== 1) {
    const row = getBuildingRow(id, building.level);
    const clearCredit = Math.max(0, Number(row && row.CLEAR_CREDIT) || 0);
    delete city.buildings[String(id)];
    if (clearCredit > 0) item = grantMiscItem(user, ITEM_ID_CREDIT, clearCredit, 0, { regDate: String(binaryNow(options)) });
  }
  return { city, item };
}

function startDive(user, req, options = {}) {
  const state = ensureWorldMapState(user, options);
  const city = ensureCityState(user, req.cityID || firstCityId(), options);
  const stageID = positiveInt(req.stageID) || firstDiveStageId();
  const dive = createDiveState(user, {
    stageID,
    deckIndexes: req.deckIndexeList,
    cityID: city.cityID,
    now: options.now,
  });
  state.dive.active = dive;
  const templet = getDiveTemplet(stageID);
  const costItems = [];
  const costItemId = positiveInt(templet && templet.STAGE_REQ_ITEM_ID) || ITEM_ID_DIVE_PERMIT;
  const costCount = Math.max(0, Number(templet && templet.STAGE_REQ_ITEM_COUNT) || 1);
  const spent = spendMiscItem(user, costItemId, costCount, { regDate: String(binaryNow(options)) });
  if (spent) costItems.push(spent);
  return { cityID: city.cityID, dive, costItems };
}

function createDiveState(user, options = {}) {
  const stageID = positiveInt(options.stageID) || firstDiveStageId();
  const templet = getDiveTemplet(stageID);
  const slotCount = Math.max(1, Math.min(5, Number(templet && templet.SLOT_COUNT) || 3));
  const randomSetCount = Math.max(1, Number(templet && templet.RANDOM_SET_COUNT) || 2);
  const slotSets = [
    { slots: [{ sectorType: 1, eventType: 0, eventValue: 0 }] },
    { slots: Array.from({ length: slotCount }, (_, index) => createDiveSlot(stageID, index, false)) },
  ];
  const deckIndexes = uniquePositiveInts(options.deckIndexes).slice(0, Math.max(1, Number(templet && templet.SQUAD_COUNT) || 4));
  if (!deckIndexes.length) deckIndexes.push(0);
  const squads = {};
  for (const deckIndex of deckIndexes) squads[String(deckIndex)] = { state: 0, deckIndex, curHp: 100000, maxHp: 100000, supply: 2 };
  const leaderDeckIndex = deckIndexes[0] || 0;
  return normalizeDiveState(
    {
      diveUid: String(nextWorldMapUid(user, options)),
      cityID: positiveInt(options.cityID) || firstCityId(),
      isAuto: false,
      floor: {
        stageID,
        slotSets,
        expireDate: String(ticksNow(options) + TICKS_PER_DAY),
        randomSetCount,
      },
      player: {
        base: {
          state: 0,
          prevSlotSetIndex: 0,
          prevSlotIndex: 0,
          slotSetIndex: 0,
          slotIndex: 0,
          distance: 0,
          leaderDeckIndex,
          reservedDungeonID: 0,
          reservedDeckIndex: -1,
          artifacts: [],
          reservedArtifacts: [],
        },
        squads,
      },
    },
    options
  );
}

function createDiveSlot(stageID, index, boss) {
  const sectorType = boss ? 2 : [8, 10, 6, 4][index % 4];
  const eventType = boss ? 2 : [1, 3, 6, 7][index % 4];
  const eventValue = boss ? getDiveBossDungeonId(stageID) : getDiveDungeonId(stageID);
  return { sectorType, eventType, eventValue };
}

function normalizeDiveState(dive, options = {}) {
  const data = dive && typeof dive === "object" ? dive : {};
  const stageID = positiveInt(data.stageID || data.floor && data.floor.stageID) || firstDiveStageId();
  const templet = getDiveTemplet(stageID);
  const randomSetCount = Math.max(1, Number((data.floor && data.floor.randomSetCount) || (templet && templet.RANDOM_SET_COUNT)) || 2);
  const floor = data.floor && typeof data.floor === "object" ? data.floor : {};
  const slotSets = Array.isArray(floor.slotSets) && floor.slotSets.length ? floor.slotSets : [{ slots: [{ sectorType: 1, eventType: 0, eventValue: 0 }] }];
  const player = data.player && typeof data.player === "object" ? data.player : {};
  const base = player.base && typeof player.base === "object" ? player.base : {};
  return {
    diveUid: String(toBigInt(data.diveUid || data.DiveUid || 0)),
    cityID: positiveInt(data.cityID) || firstCityId(),
    isAuto: Boolean(data.isAuto),
    floor: {
      stageID,
      randomSetCount,
      slotSets: slotSets.map((set) => ({
        slots: (Array.isArray(set && set.slots) ? set.slots : []).map((slot) => ({
          sectorType: Math.max(0, Number(slot && slot.sectorType) || 0),
          eventType: Math.max(0, Number(slot && slot.eventType) || 0),
          eventValue: Math.max(0, Number(slot && slot.eventValue) || 0),
        })),
      })),
      expireDate: String(toBigInt(floor.expireDate || ticksNow(options) + TICKS_PER_DAY)),
    },
    player: {
      base: {
        state: Math.max(0, Number(base.state || 0) || 0),
        prevSlotSetIndex: Number(base.prevSlotSetIndex || 0) || 0,
        prevSlotIndex: Number(base.prevSlotIndex || 0) || 0,
        slotSetIndex: Number(base.slotSetIndex != null ? base.slotSetIndex : 0) || 0,
        slotIndex: Number(base.slotIndex || 0) || 0,
        distance: Math.max(0, Number(base.distance || 0) || 0),
        leaderDeckIndex: Number(base.leaderDeckIndex || 0) || 0,
        reservedDungeonID: Number(base.reservedDungeonID || 0) || 0,
        reservedDeckIndex: Number(base.reservedDeckIndex != null ? base.reservedDeckIndex : -1) || -1,
        artifacts: uniquePositiveInts(base.artifacts),
        reservedArtifacts: uniquePositiveInts(base.reservedArtifacts),
      },
      squads: normalizeDiveSquads(player.squads),
    },
  };
}

function normalizeDiveSquads(squads) {
  const result = {};
  const source = squads && typeof squads === "object" ? squads : {};
  for (const [key, squad] of Object.entries(source)) {
    const deckIndex = Number((squad && squad.deckIndex) || key) || 0;
    result[String(deckIndex)] = {
      state: Math.max(0, Number(squad && squad.state) || 0),
      deckIndex,
      curHp: Math.max(0, Number(squad && squad.curHp) || 100000),
      maxHp: Math.max(1, Number(squad && squad.maxHp) || 100000),
      supply: Math.max(0, Number(squad && squad.supply) || 2),
    };
  }
  return result;
}

function moveDiveForward(user, slotIndex, options = {}) {
  const dive = getActiveDive(user, options) || createDiveState(user, options);
  const base = dive.player.base;
  const nextSetIndex = Math.min(dive.floor.slotSets.length - 1, base.distance === 0 ? 1 : base.slotSetIndex + 1);
  const slots = dive.floor.slotSets[nextSetIndex] ? dive.floor.slotSets[nextSetIndex].slots : [];
  const nextSlotIndex = Math.max(0, Math.min(Math.max(0, slots.length - 1), Number(slotIndex || 0) || 0));
  base.prevSlotSetIndex = base.slotSetIndex;
  base.prevSlotIndex = base.slotIndex;
  base.slotSetIndex = nextSetIndex;
  base.slotIndex = nextSlotIndex;
  base.distance += 1;
  const reachedBoss = base.distance >= Number(dive.floor.randomSetCount || 2);
  if (reachedBoss) {
    base.state = 1;
    base.reservedDungeonID = getDiveBossDungeonId(dive.floor.stageID);
    if (dive.floor.slotSets.length < nextSetIndex + 2) {
      dive.floor.slotSets.push({ slots: [createDiveSlot(dive.floor.stageID, 0, true)] });
    }
  } else {
    base.state = 0;
  }
  setActiveDive(user, dive, options);
  return { dive, syncData: { updatedPlayer: base } };
}

function giveUpDive(user) {
  if (user && user.worldMap && user.worldMap.dive) user.worldMap.dive.active = null;
}

function setDiveAuto(user, isAuto, options = {}) {
  const dive = getActiveDive(user, options);
  if (dive) {
    dive.isAuto = Boolean(isAuto);
    setActiveDive(user, dive, options);
  } else {
    const state = ensureWorldMapState(user, options);
    state.dive.isAuto = Boolean(isAuto);
  }
}

function selectDiveArtifact(user, artifactID, options = {}) {
  const dive = getActiveDive(user, options) || createDiveState(user, options);
  const id = positiveInt(artifactID);
  if (id > 0 && !dive.player.base.artifacts.includes(id)) dive.player.base.artifacts.push(id);
  dive.player.base.state = 0;
  setActiveDive(user, dive, options);
  return { dive, syncData: { updatedPlayer: dive.player.base } };
}

function suicideDiveSquad(user, deckIndex, options = {}) {
  const dive = getActiveDive(user, options) || createDiveState(user, options);
  const key = String(Number(deckIndex || 0) || 0);
  if (dive.player.squads[key]) {
    dive.player.squads[key].state = 1;
    dive.player.squads[key].curHp = 0;
  }
  setActiveDive(user, dive, options);
  return { dive, syncData: { updatedSquads: dive.player.squads[key] ? [dive.player.squads[key]] : [] } };
}

function skipDive(user, req, options = {}) {
  const stageID = positiveInt(req.stageId) || firstDiveStageId();
  const skipCount = Math.max(1, Math.min(99, Number(req.skipCount || 1) || 1));
  const templet = getDiveTemplet(stageID);
  const rewards = [];
  const costItems = [];
  const regDate = String(binaryNow(options));
  for (let index = 0; index < skipCount; index += 1) {
    rewards.push(grantDiveReward(user, templet, regDate));
  }
  const costItemId = positiveInt(templet && templet.STAGE_REQ_ITEM_ID) || ITEM_ID_DIVE_PERMIT;
  const costCount = Math.max(0, Number(templet && templet.STAGE_REQ_ITEM_COUNT) || 1) * skipCount;
  const spent = spendMiscItem(user, costItemId, costCount, { regDate });
  if (spent) costItems.push(spent);
  markDiveCleared(user, stageID, options);
  giveUpDive(user);
  return { rewards, costItems, deletedEventCityId: 0 };
}

function grantDiveReward(user, templet, regDate) {
  const miscItems = [];
  for (let index = 1; index <= 3; index += 1) {
    const type = String((templet && templet[`FIRSTREWARD_TYPE_${index}`]) || "").toUpperCase();
    const id = positiveInt(templet && templet[`FIRSTREWARD_ID_${index}`]);
    const quantity = Math.max(0, Number(templet && templet[`FIRSTREWARD_QUANTITY_${index}`]) || 0);
    if (type === "RT_MISC" && id > 0 && quantity > 0) {
      const item = grantMiscItem(user, id, quantity, 0, { regDate });
      if (item) miscItems.push(item);
    }
  }
  if (!miscItems.length) {
    const item = grantMiscItem(user, ITEM_ID_CREDIT, 10000, 0, { regDate });
    if (item) miscItems.push(item);
  }
  return { miscItems };
}

function markDiveCleared(user, stageID, options = {}) {
  const state = ensureWorldMapState(user, options);
  state.diveClearStages = uniquePositiveInts([...state.diveClearStages, stageID]);
  state.diveHistoryStages = uniquePositiveInts([...state.diveHistoryStages, stageID]);
}

function getActiveDive(user, options = {}) {
  const state = ensureWorldMapState(user, options);
  if (!state.dive || !state.dive.active) return null;
  const dive = normalizeDiveState(state.dive.active, options);
  state.dive.active = dive;
  return dive;
}

function setActiveDive(user, dive, options = {}) {
  const state = ensureWorldMapState(user, options);
  state.dive.active = normalizeDiveState(dive, options);
}

function buildDiveGameData(dive) {
  const data = normalizeDiveState(dive || {});
  return Buffer.concat([
    writeSignedVarLong(toBigInt(data.diveUid || 0)),
    writeNullableObject(buildDiveFloorData(data.floor)),
    writeNullableObject(buildDivePlayerData(data.player)),
  ]);
}

function buildDiveFloorData(floor) {
  const data = floor || {};
  return Buffer.concat([
    writeSignedVarInt(positiveInt(data.stageID) || firstDiveStageId()),
    writeObjectList((Array.isArray(data.slotSets) ? data.slotSets : []).map((slotSet) => writeNullableObject(buildDiveSlotSetData(slotSet)))),
    writeSignedVarLong(toBigInt(data.expireDate || 0)),
  ]);
}

function buildDiveSlotSetData(slotSet) {
  return writeObjectList((Array.isArray(slotSet && slotSet.slots) ? slotSet.slots : []).map((slot) => writeNullableObject(buildDiveSlotData(slot))));
}

function buildDiveSlotData(slot) {
  const data = slot || {};
  return Buffer.concat([
    writeSignedVarInt(Number(data.sectorType || 0) || 0),
    writeSignedVarInt(Number(data.eventType || 0) || 0),
    writeSignedVarInt(Number(data.eventValue || 0) || 0),
  ]);
}

function buildDivePlayerData(player) {
  const data = player || {};
  const squads = normalizeDiveSquads(data.squads);
  const entries = Object.values(squads)
    .sort((a, b) => a.deckIndex - b.deckIndex)
    .map((squad) => [squad.deckIndex, buildDiveSquadData(squad)]);
  return Buffer.concat([writeNullableObject(buildDivePlayerBaseData(data.base || {})), writeObjectMapInt(entries)]);
}

function buildDivePlayerBaseData(base) {
  const data = base || {};
  return Buffer.concat([
    writeSignedVarInt(Number(data.state || 0) || 0),
    writeSignedVarInt(Number(data.prevSlotSetIndex || 0) || 0),
    writeSignedVarInt(Number(data.prevSlotIndex || 0) || 0),
    writeSignedVarInt(Number(data.slotSetIndex != null ? data.slotSetIndex : 0) || 0),
    writeSignedVarInt(Number(data.slotIndex || 0) || 0),
    writeSignedVarInt(Number(data.distance || 0) || 0),
    writeSignedVarInt(Number(data.leaderDeckIndex || 0) || 0),
    writeSignedVarInt(Number(data.reservedDungeonID || 0) || 0),
    writeSignedVarInt(Number(data.reservedDeckIndex != null ? data.reservedDeckIndex : -1) || -1),
    writeIntList(data.artifacts || []),
    writeIntList(data.reservedArtifacts || []),
  ]);
}

function buildDiveSquadData(squad) {
  const data = squad || {};
  return Buffer.concat([
    writeSignedVarInt(Number(data.state || 0) || 0),
    writeSignedVarInt(Number(data.deckIndex || 0) || 0),
    writeFloatLE(Number(data.curHp || 0) || 0),
    writeFloatLE(Number(data.maxHp || 0) || 0),
    writeSignedVarInt(Number(data.supply || 0) || 0),
  ]);
}

function buildDiveSyncData(syncData) {
  const data = syncData || {};
  return Buffer.concat([
    writeNullableObjectOrNull(data.updatedPlayer ? buildDivePlayerBaseData(data.updatedPlayer) : null),
    writeObjectList((Array.isArray(data.updatedSquads) ? data.updatedSquads : []).map((squad) => writeNullableObject(buildDiveSquadData(squad)))),
    writeObjectList((Array.isArray(data.addedSlotSets) ? data.addedSlotSets : []).map((slotSet) => writeNullableObject(buildDiveSlotSetData(slotSet)))),
    writeObjectList((Array.isArray(data.updatedSlots) ? data.updatedSlots : []).map((slot) => writeNullableObject(buildDiveSlotWithIndexesData(slot)))),
    writeNullableObjectOrNull(data.rewardData ? buildRewardData(data.rewardData) : null),
    writeNullableObjectOrNull(data.artifactRewardData ? buildRewardData(data.artifactRewardData) : null),
    writeNullableObjectOrNull(data.stormMiscReward ? buildItemMiscData(data.stormMiscReward) : null),
  ]);
}

function buildDiveSlotWithIndexesData(slotWithIndexes) {
  const data = slotWithIndexes || {};
  return Buffer.concat([
    writeNullableObject(buildDiveSlotData(data.slot || {})),
    writeSignedVarInt(Number(data.slotSetIndex || 0) || 0),
    writeSignedVarInt(Number(data.slotIndex || 0) || 0),
  ]);
}

function ensureSoloRaid(user, cityID, options = {}) {
  const state = ensureWorldMapState(user, options);
  const raidUid = String(options.raidUid ? toBigInt(options.raidUid) : nextWorldMapUid(user, options));
  const existing = state.raids[raidUid];
  if (existing) return normalizeRaidState(existing);
  const stageID = chooseSoloRaidStage(cityID, options);
  const raidTemplet = getRaidTemplet(stageID);
  const maxHP = Math.max(100000, Number(raidTemplet && raidTemplet.Raid_Damage_Basis) || 100000);
  const expireTicks = toBigInt(options.expireTicks || ticksNow(options) + 6n * TICKS_PER_HOUR);
  const raid = normalizeRaidState({
    raidUID: raidUid,
    stageID,
    cityID: positiveInt(cityID) || firstCityId(),
    curHP: maxHP,
    maxHP,
    isCoop: false,
    isNew: true,
    expireDate: String(expireTicks),
    seasonID: currentRaidSeasonId(options),
    worldmapEventID: positiveInt(options.worldmapEventID) || 0,
  });
  state.raids[raidUid] = raid;
  return raid;
}

function normalizeRaidState(raid) {
  const data = raid && typeof raid === "object" ? raid : {};
  const stageID = positiveInt(data.stageID) || chooseSoloRaidStage(1);
  const raidTemplet = getRaidTemplet(stageID);
  const maxHP = Math.max(1, Number(data.maxHP || data.maxHp || (raidTemplet && raidTemplet.Raid_Damage_Basis) || 100000) || 100000);
  return {
    raidUID: String(toBigInt(data.raidUID || data.raidUid || 0)),
    stageID,
    cityID: positiveInt(data.cityID) || firstCityId(),
    curHP: Math.max(0, Number(data.curHP != null ? data.curHP : maxHP) || maxHP),
    maxHP,
    isCoop: Boolean(data.isCoop),
    isNew: data.isNew !== false,
    expireDate: String(toBigInt(data.expireDate || 0)),
    seasonID: positiveInt(data.seasonID) || currentRaidSeasonId(),
    damage: Math.max(0, Number(data.damage || 0) || 0),
    tryCount: Math.max(0, Number(data.tryCount || 0) || 0),
    accepted: Boolean(data.accepted),
    worldmapEventID: positiveInt(data.worldmapEventID) || 0,
  };
}

function getActiveRaids(user, options = {}) {
  const state = ensureWorldMapState(user, options);
  refreshWorldMapState(user, options);
  if (envFlagDefault(false, "CS_WORLDMAP_DEFAULT_SOLO_RAID") && !Object.keys(state.raids).length) {
    ensureSoloRaid(user, firstCityId(), options);
  }
  return Object.values(state.raids).map(normalizeRaidState).filter((raid) => toBigInt(raid.expireDate) > ticksNow(options));
}

function getRaidByUid(user, raidUID, options = {}) {
  const state = ensureWorldMapState(user, options);
  const key = String(toBigInt(raidUID || 0));
  return state.raids[key] ? normalizeRaidState(state.raids[key]) : null;
}

function sweepRaid(user, raidUID, options = {}) {
  const state = ensureWorldMapState(user, options);
  const raid = getRaidByUid(user, raidUID, options) || ensureSoloRaid(user, firstCityId(), options);
  const initHp = Number(raid.curHP || raid.maxHP);
  const damage = initHp;
  raid.curHP = 0;
  raid.damage = Number(raid.damage || 0) + damage;
  raid.tryCount = Number(raid.tryCount || 0) + 1;
  state.raidResults[String(raid.raidUID)] = normalizeRaidState({ ...raid, accepted: false });
  delete state.raids[String(raid.raidUID)];
  const raidTemplet = getRaidTemplet(raid.stageID);
  const costItems = [];
  const costItemId = positiveInt(raidTemplet && raidTemplet.m_StageReqItemID);
  const costCount = Math.max(0, Number(raidTemplet && raidTemplet.m_StageReqItemCount) || 0);
  if (costItemId > 0 && costCount > 0) {
    const spent = spendMiscItem(user, costItemId, costCount, { regDate: String(binaryNow(options)) });
    if (spent) costItems.push(spent);
  }
  return {
    raidUid: toBigInt(raid.raidUID),
    raid,
    costItems,
    bossResult: {
      initHp,
      curHP: 0,
      maxHp: Number(raid.maxHP || initHp),
      damage,
    },
  };
}

function getRaidResults(user, options = {}) {
  const state = ensureWorldMapState(user, options);
  return Object.values(state.raidResults || {}).map(normalizeRaidState).filter((raid) => !raid.accepted);
}

function acceptRaidResult(user, raidUID, options = {}) {
  const state = ensureWorldMapState(user, options);
  const key = String(toBigInt(raidUID || 0));
  const raid = state.raidResults[key] ? normalizeRaidState(state.raidResults[key]) : null;
  if (!raid) return { raidUid: toBigInt(raidUID || 0), reward: {}, rewardRaidPoint: 0 };
  const result = grantRaidReward(user, raid, options);
  state.raidResults[key].accepted = true;
  delete state.raidResults[key];
  return { raidUid: toBigInt(raid.raidUID), ...result };
}

function acceptAllRaidResults(user, options = {}) {
  const results = getRaidResults(user, options);
  const reward = { miscItems: [] };
  let rewardRaidPoint = 0;
  const raidUids = [];
  for (const raid of results) {
    const accepted = acceptRaidResult(user, raid.raidUID, options);
    raidUids.push(toBigInt(raid.raidUID));
    rewardRaidPoint += accepted.rewardRaidPoint;
    reward.miscItems.push(...((accepted.reward && accepted.reward.miscItems) || []));
  }
  return { raidUids, reward, rewardRaidPoint };
}

function grantRaidReward(user, raid, options = {}) {
  const raidTemplet = getRaidTemplet(raid.stageID);
  const rewardRaidPoint = Math.max(0, Number(raidTemplet && raidTemplet.m_RewardRaidPoint_Victory) || Number(raid.stageID) || 0);
  const miscItems = [];
  const regDate = String(binaryNow(options));
  const credit = grantMiscItem(user, ITEM_ID_CREDIT, Math.max(10000, Math.round(Number(raid.maxHP || 100000) / 5)), 0, { regDate });
  const info = grantMiscItem(user, ITEM_ID_INFORMATION, Math.max(25, Math.round(Number(raid.maxHP || 100000) / 2000)), 0, { regDate });
  if (credit) miscItems.push(credit);
  if (info) miscItems.push(info);
  return { reward: { miscItems }, rewardRaidPoint };
}

function buildMyRaidData(raid) {
  const data = normalizeRaidState(raid);
  return Buffer.concat([
    writeSignedVarLong(toBigInt(data.raidUID)),
    writeSignedVarInt(data.stageID),
    writeSignedVarInt(data.cityID),
    writeFloatLE(data.curHP),
    writeFloatLE(data.maxHP),
    writeBool(Boolean(data.isCoop)),
    writeBool(Boolean(data.isNew)),
    writeSignedVarLong(toBigInt(data.expireDate)),
    writeSignedVarInt(data.seasonID),
  ]);
}

function buildRaidDetailData(user, raid) {
  const data = normalizeRaidState(raid);
  return Buffer.concat([
    writeSignedVarLong(toBigInt(data.raidUID)),
    writeSignedVarInt(data.stageID),
    writeSignedVarLong(toBigInt(user && user.userUid ? user.userUid : 0)),
    writeSignedVarLong(toBigInt(user && user.friendCode ? user.friendCode : user && user.userUid ? user.userUid : 0)),
    writeSignedVarInt(data.cityID),
    writeFloatLE(data.curHP),
    writeFloatLE(data.maxHP),
    writeBool(Boolean(data.isCoop)),
    writeBool(Boolean(data.isNew)),
    writeSignedVarLong(toBigInt(data.expireDate)),
    writeObjectList([writeNullableObject(buildRaidJoinData(user, data))]),
    writeSignedVarInt(data.seasonID),
  ]);
}

function buildRaidJoinData(user, raid) {
  const mainUnit = getMainUnitForProfile(user);
  return Buffer.concat([
    writeSignedVarLong(toBigInt(user && user.userUid ? user.userUid : 0)),
    writeSignedVarLong(toBigInt(user && user.friendCode ? user.friendCode : user && user.userUid ? user.userUid : 0)),
    writeString(String((user && user.nickname) || "LocalAdmin")),
    writeSignedVarInt(Number(mainUnit.unitId || 0) || 0),
    writeSignedVarInt(Number(mainUnit.skinId || 0) || 0),
    writeFloatLE(Number(raid.damage || 0) || 0),
    writeBool(true),
    writeSignedVarInt(Number(raid.tryCount || 0) || 0),
    writeNullObject(),
    writeBool(false),
    writeSignedVarInt(Number(user && user.level) || 1),
    writeSignedVarInt(0),
  ]);
}

function buildRaidResultData(user, raid) {
  const data = normalizeRaidState(raid);
  const mainUnit = getMainUnitForProfile(user);
  return Buffer.concat([
    writeSignedVarLong(toBigInt(data.raidUID)),
    writeSignedVarInt(data.stageID),
    writeSignedVarLong(toBigInt(user && user.userUid ? user.userUid : 0)),
    writeSignedVarLong(toBigInt(user && user.friendCode ? user.friendCode : user && user.userUid ? user.userUid : 0)),
    writeString(String((user && user.nickname) || "LocalAdmin")),
    writeSignedVarInt(Number(mainUnit.unitId || 0) || 0),
    writeSignedVarInt(Number(mainUnit.skinId || 0) || 0),
    writeSignedVarInt(Number(mainUnit.tacticLevel || 0) || 0),
    writeSignedVarInt(data.cityID),
    writeFloatLE(data.curHP),
    writeFloatLE(data.maxHP),
    writeBool(Boolean(data.isCoop)),
    writeSignedVarLong(toBigInt(data.expireDate)),
    writeBool(true),
    writeSignedVarInt(Number(data.tryCount || 0) || 0),
    writeFloatLE(Number(data.damage || data.maxHP) || 0),
    writeBool(false),
    writeSignedVarInt(data.seasonID),
    writeNullObject(),
    writeObjectList([writeNullableObject(buildRaidJoinData(user, data))]),
  ]);
}

function buildRaidBossResultData(result) {
  const data = result || {};
  return Buffer.concat([
    writeFloatLE(Number(data.initHp || 0) || 0),
    writeFloatLE(Number(data.curHP || 0) || 0),
    writeFloatLE(Number(data.maxHp || 0) || 0),
    writeFloatLE(Number(data.damage || 0) || 0),
  ]);
}

function buildRaidSeasonData(user, options = {}) {
  const season = ensureRaidSeasonState(user, options);
  return Buffer.concat([
    writeSignedVarInt(season.seasonId),
    writeSignedVarInt(season.monthlyPoint),
    writeSignedVarInt(season.tryAssistCount),
    writeSignedVarInt(season.recvRewardRaidPoint),
    writeFloatLE(Number(season.highestDamage || 0) || 0),
    writeInt64LE(toBigInt(season.latestUpdateTime || binaryNow(options))),
  ]);
}

function ensureRaidSeasonState(user, options = {}) {
  const state = ensureWorldMapState(user, options);
  state.raidSeason = state.raidSeason && typeof state.raidSeason === "object" ? state.raidSeason : {};
  state.raidSeason.seasonId = positiveInt(state.raidSeason.seasonId) || currentRaidSeasonId(options);
  state.raidSeason.monthlyPoint = Math.max(0, Number(state.raidSeason.monthlyPoint || 0) || 0);
  state.raidSeason.tryAssistCount = Math.max(0, Number(state.raidSeason.tryAssistCount || 0) || 0);
  state.raidSeason.recvRewardRaidPoint = Math.max(0, Number(state.raidSeason.recvRewardRaidPoint || 0) || 0);
  state.raidSeason.highestDamage = Math.max(0, Number(state.raidSeason.highestDamage || 0) || 0);
  state.raidSeason.latestUpdateTime = String(state.raidSeason.latestUpdateTime || binaryNow(options));
  return state.raidSeason;
}

function getMainUnitForProfile(user) {
  try {
    const units = getArmyUnits(user);
    const unit = units.find((entry) => entry && Number(entry.unitId || 0) > 0) || {};
    return {
      unitId: Number(unit.unitId || 0) || 0,
      skinId: Number(unit.skinId || 0) || 0,
      tacticLevel: Number(unit.tacticLevel || 0) || 0,
    };
  } catch (_) {
    return { unitId: 0, skinId: 0, tacticLevel: 0 };
  }
}

function writeMiscItemList(items) {
  return writeObjectList((Array.isArray(items) ? items : []).filter(Boolean).map((item) => writeNullableObject(buildItemMiscData(item))));
}

function chooseMissionIds(user, city, token, count) {
  const candidates = missionCandidatesForCity(user, city);
  const ids = uniquePositiveInts(candidates.map((row) => positiveInt(row.m_WorldmapMissionID)));
  if (ids.length <= 1) return ids.slice(0, count);
  const ordered = ids.slice().sort((a, b) => a - b);
  const parts = String(token || "").split(":");
  const nonce = Math.max(0, Number(parts[1] || 0) || 0);
  const offset = (dayNumberFromKey(parts[0]) + nonce) % ordered.length;
  return ordered.slice(offset).concat(ordered.slice(0, offset)).slice(0, count);
}

function missionCandidatesForCity(user, city) {
  const tables = getTables();
  const poolID = missionPoolForCity(city.cityID);
  const managerLevel = Math.max(Number(user && user.level) || 1, Number(city.level || 1) * 10);
  const enabled = tables.worldMapMissionsEnabled.length ? tables.worldMapMissionsEnabled : tables.worldMapMissions;
  let candidates = enabled.filter(
    (row) =>
      Number(row.m_WorldmapMissionPoolID || 0) === poolID &&
      Number(row.m_ReqManagerLevel || 0) <= managerLevel &&
      Number(row.m_WorldMapMissionLevel || 1) <= Math.max(1, Number(city.level || 1))
  );
  if (candidates.length < 4) {
    candidates = enabled.filter((row) => Number(row.m_WorldmapMissionPoolID || 0) === poolID && Number(row.m_ReqManagerLevel || 0) <= managerLevel);
  }
  if (candidates.length < 4) candidates = enabled.filter((row) => Number(row.m_WorldmapMissionPoolID || 0) === poolID);
  if (candidates.length < 4) candidates = enabled;
  return candidates.length ? candidates : [{ m_WorldmapMissionID: 1104101, m_MissionTime: 60 }];
}

function getTables() {
  if (tableCache) return tableCache;
  const worldMapCities = readGameplayTableRecords("ab_script", "LUA_WORLDMAP_CITY_TEMPLET.json", { logLabel: "world-map" });
  const worldMapBuildings = readGameplayTableRecords("ab_script", "LUA_WORLDMAP_CITY_BUILDING.json", { logLabel: "world-map" });
  const worldMapExp = readGameplayTableRecords("ab_script", "LUA_WORLDMAP_CITY_EXP_TABLE.json", { logLabel: "world-map" });
  const worldMapMissions = readGameplayTableRecords("ab_script", "LUA_WORLDMAP_MISSION_TEMPLET.json", { logLabel: "world-map" });
  const worldMapEventGroups = readGameplayTableRecords("ab_script", "LUA_WORLDMAP_EVENT_GROUP.json", { logLabel: "world-map" });
  const diveTemplets = readGameplayTableRecords("ab_script", "LUA_DIVE_TEMPLET.json", { logLabel: "world-map" });
  const raidTemplets = readGameplayTableRecords("ab_script", "LUA_RAID_TEMPLET.json", { logLabel: "world-map" });
  const raidSeasons = readGameplayTableRecords("ab_script", "LUA_RAID_SEASON_TEMPLET.json", { logLabel: "world-map" });
  tableCache = {
    worldMapCities,
    worldMapBuildings,
    worldMapExp,
    worldMapMissions,
    worldMapMissionsEnabled: worldMapMissions.filter((row) => row && row.m_bEnableMission === true),
    worldMapEventGroups,
    diveTemplets,
    raidTemplets,
    raidSeasons,
    missionsById: new Map(worldMapMissions.map((row) => [Number(row.m_WorldmapMissionID || 0), row])),
    divesByStageId: new Map(diveTemplets.map((row) => [Number(row.STAGE_ID || 0), row])),
    raidsByStageId: new Map(raidTemplets.map((row) => [Number(row.m_StageID || 0), row])),
  };
  return tableCache;
}

function getDefaultCityIds() {
  const cities = getTables().worldMapCities.map((row) => positiveInt(row.m_CityID)).filter(Boolean).sort((a, b) => a - b);
  if (!cities.length) return [1];
  if (envFlagDefault(false, "CS_WORLDMAP_UNLOCK_ALL_BRANCHES")) return cities;
  return [cities[0]];
}

function isKnownCityId(cityID) {
  const id = positiveInt(cityID);
  return id > 0 && getTables().worldMapCities.some((row) => positiveInt(row.m_CityID) === id);
}

function getUnlockedCityCount(state) {
  const cities = state && state.cities && typeof state.cities === "object" ? state.cities : {};
  return Object.values(cities).filter((city) => city && positiveInt(city.cityID)).length;
}

function getCityOpenCost(unlockedCityCount, isCash) {
  const costs = parseCityOpenCostsEnv(isCash ? "CS_WORLDMAP_CITY_OPEN_CASH_COSTS" : "CS_WORLDMAP_CITY_OPEN_CREDIT_COSTS") ||
    (isCash ? CITY_OPEN_CASH_COSTS : CITY_OPEN_CREDIT_COSTS);
  const index = Math.max(0, Number(unlockedCityCount || 0) || 0);
  return Math.max(0, Number(costs[index] || 0) || 0);
}

function parseCityOpenCostsEnv(key) {
  const raw = process.env[key];
  if (raw == null || String(raw).trim() === "") return null;
  const costs = String(raw)
    .split(",")
    .map((value) => Math.max(0, Number(String(value).trim()) || 0));
  return costs.length ? costs : null;
}

function getPossibleCityCount(user) {
  const override = positiveInt(process.env.CS_WORLDMAP_MAX_BRANCHES);
  if (override) return Math.min(override, Math.max(1, getTables().worldMapCities.length || override));

  const userLevel = Math.max(0, Number((user && (user.level || user.m_UserLevel || user.userLevel)) || 1) || 1);
  if (userLevel <= 0) return 0;
  for (let index = 0; index < CITY_UNLOCK_LEVELS.length; index += 1) {
    if (userLevel < CITY_UNLOCK_LEVELS[index]) return Math.max(0, index - 1);
  }
  return Math.max(1, getTables().worldMapCities.length || 6);
}

function getMiscItemBalance(user, itemId) {
  const item = getMiscItem(user, itemId);
  return toBigInt(item && item.countFree) + toBigInt(item && item.countPaid);
}

function firstCityId() {
  const city = getTables().worldMapCities.find((row) => positiveInt(row.m_CityID));
  return positiveInt(city && city.m_CityID) || 1;
}

function firstMissionId() {
  const mission = (getTables().worldMapMissionsEnabled[0] || getTables().worldMapMissions[0] || {}).m_WorldmapMissionID;
  return positiveInt(mission) || 1104101;
}

function firstDiveStageId() {
  const templet = getTables().diveTemplets.find((row) => positiveInt(row.STAGE_ID));
  return positiveInt(templet && templet.STAGE_ID) || 1010;
}

function getMissionById(missionID) {
  return getTables().missionsById.get(Number(missionID || 0)) || null;
}

function getDiveTemplet(stageID) {
  return getTables().divesByStageId.get(Number(stageID || 0)) || getTables().diveTemplets[0] || null;
}

function getRaidTemplet(stageID) {
  return getTables().raidsByStageId.get(Number(stageID || 0)) || getTables().raidTemplets[0] || null;
}

function getBuildingRow(buildID, level) {
  return getTables().worldMapBuildings.find((row) => Number(row.ID || 0) === Number(buildID || 0) && Number(row.LEVEL || 0) === Number(level || 0)) || null;
}

function getCityMaxLevel(cityID) {
  const row = getTables().worldMapCities.find((entry) => Number(entry.m_CityID || 0) === Number(cityID || 0));
  return Math.max(1, Number(row && row.m_MaxLevel) || 10);
}

function computeCityLevel(cityID, exp) {
  const maxLevel = getCityMaxLevel(cityID);
  let level = 1;
  for (const row of getTables().worldMapExp) {
    const rowLevel = positiveInt(row.m_iLevel);
    if (rowLevel > 0 && rowLevel <= maxLevel && Number(exp || 0) >= Number(row.m_iExpCumulated || 0)) level = Math.max(level, rowLevel);
  }
  return Math.max(1, Math.min(maxLevel, level));
}

function missionPoolForCity(cityID) {
  return ((Math.max(1, Number(cityID || 1)) - 1) % 3) + 1;
}

function chooseSoloRaidStage(cityID) {
  const raids = getTables().raidTemplets
    .filter((row) => Array.isArray(row.listContentsTagAllow) && row.listContentsTagAllow.includes("SINGLE_RAID"))
    .sort((a, b) => Number(a.m_StageID || 0) - Number(b.m_StageID || 0));
  if (!raids.length) return 11015;
  const index = Math.min(raids.length - 1, Math.max(0, Number(cityID || 1) - 1));
  return positiveInt(raids[index].m_StageID) || 11015;
}

function currentRaidSeasonId() {
  const explicit = positiveInt(process.env.CS_RAID_SEASON_ID);
  if (explicit) return explicit;
  const seasons = getTables().raidSeasons.map((row) => positiveInt(row.Raid_Season_ID)).filter(Boolean).sort((a, b) => a - b);
  return seasons[0] || 10001;
}

function getDiveDungeonId(stageID) {
  const templet = getDiveTemplet(stageID);
  return positiveInt(templet && templet.STAGE_ID) || positiveInt(stageID) || 1010;
}

function getDiveBossDungeonId(stageID) {
  const templet = getDiveTemplet(stageID);
  return positiveInt(templet && templet.BOSS_EVENT_GROUP_ID) || positiveInt(templet && templet.STAGE_ID) || positiveInt(stageID) || 1010;
}

function defaultNextUid(user) {
  return String(toBigInt(user && user.userUid ? user.userUid : 1000000000n) * 1000000n + 500000n);
}

function nextWorldMapUid(user, options = {}) {
  const state = ensureBareWorldMapState(user, options);
  state.nextUid = String(state.nextUid || defaultNextUid(user));
  const next = toBigInt(state.nextUid || 0);
  state.nextUid = String(next + 1n);
  return next;
}

function getSocketUser(ctx, socket) {
  const user = (socket.session && socket.session.user) || (typeof ctx.createEphemeralUser === "function" ? ctx.createEphemeralUser() : {});
  if (socket.session) socket.session.user = user;
  try {
    ensureArmy(user);
  } catch (_) {
    // Army seeding is best-effort here; world-map packets can still serialize without a roster.
  }
  return user;
}

function decodeRequest(ctx, packetId, encryptedPayload) {
  let payload = Buffer.alloc(0);
  try {
    payload = typeof ctx.decryptCopy === "function" ? ctx.decryptCopy(encryptedPayload) : encryptedPayload || Buffer.alloc(0);
  } catch (_) {
    payload = Buffer.alloc(0);
  }
  const reader = createReader(payload);
  try {
    switch (packetId) {
      case 802:
        return {
          selectDeckIndex: reader.byte(),
          raidUID: reader.long(),
          buffList: reader.intList(),
          isTryAssist: reader.bool(),
          supportingUserUid: reader.long(),
        };
      case 2002:
        return { cityID: reader.int(), isCash: reader.bool() };
      case 2004:
        return { cityID: reader.int(), leaderUID: reader.long() };
      case 2006:
      case 2008:
        return { cityID: reader.int(), missionID: reader.int() };
      case 2010:
      case 2012:
      case 2014:
      case 2024:
        return { cityID: reader.int() };
      case 2018:
      case 2020:
      case 2022:
        return { cityID: reader.int(), buildID: reader.int() };
      case 1206:
        return { cityID: reader.int(), stageID: reader.int(), deckIndexeList: reader.intList(), isDiveStorm: reader.bool() };
      case 1208:
        return { slotIndex: reader.int() };
      case 1212:
        return { isAuto: reader.bool() };
      case 1215:
        return { artifactID: reader.int() };
      case 1217:
        return { selectDeckIndex: reader.byte() };
      case 1249:
        return { stageId: reader.int(), skipCount: reader.int(), cityId: reader.int() };
      case 885:
        return { raidUid: reader.long(), isTryAssist: reader.bool() };
      case 2204:
      case 2208:
      case 2212:
        return { raidUID: reader.long() };
      case 2217:
        return { raidPointReward: reader.int() };
      default:
        return {};
    }
  } catch (err) {
    console.log(`[world-map:${packetId}] request decode failed: ${err.message}`);
    return {};
  }
}

function createReader(payload) {
  let offset = 0;
  return {
    int() {
      const read = readSignedVarInt(payload, offset);
      offset = read.offset;
      return read.value;
    },
    long() {
      const read = readSignedVarLong(payload, offset);
      offset = read.offset;
      return read.value;
    },
    bool() {
      const read = readBool(payload, offset);
      offset = read.offset;
      return read.value;
    },
    byte() {
      const read = readByte(payload, offset);
      offset = read.offset;
      return read.value;
    },
    intList() {
      const read = readSignedVarIntList(payload, offset);
      offset = read.offset;
      return read.value;
    },
  };
}

function describeRequest(packetId, req) {
  if (!req || !Object.keys(req).length) return "req={}";
  return Object.entries(req)
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join("/") : String(value)}`)
    .join(" ");
}

function getContextNow(ctx) {
  try {
    if (ctx && typeof ctx.dateTimeBinaryNow === "function") return ctx.dateTimeBinaryNow();
  } catch (_) {
    // fall through to local clock
  }
  return binaryNow();
}

function binaryNow(options = {}) {
  if (options && options.now != null) return toBigInt(options.now);
  return binaryFromTicks(BigInt(Date.now()) * 10000n + TICKS_AT_UNIX_EPOCH);
}

function ticksNow(options = {}) {
  return ticksFromDateTimeBinary(binaryNow(options));
}

function binaryFromTicks(ticks) {
  return (toBigInt(ticks) & DATE_TIME_TICK_MASK) | DATE_TIME_LOCAL_MASK;
}

function ticksFromDateTimeBinary(value) {
  const raw = toBigInt(value || 0);
  return raw > 0n ? raw & DATE_TIME_TICK_MASK : 0n;
}

function dayKeyFromTicks(ticks) {
  const unixMs = Number((toBigInt(ticks) - TICKS_AT_UNIX_EPOCH) / 10000n);
  const date = Number.isFinite(unixMs) ? new Date(unixMs) : new Date();
  return Number.isNaN(date.getTime()) ? "1970-01-01" : date.toISOString().slice(0, 10);
}

function dayNumberFromKey(dayKey) {
  const time = Date.parse(`${String(dayKey || "").slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(time)) return 0;
  return Math.floor(time / 86400000);
}

function positiveInt(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function clampPositiveInt(value, min, max) {
  const number = positiveInt(value) || min;
  return Math.max(min, Math.min(max, number));
}

function clampBigInt(value, min, max) {
  let result = toBigInt(value);
  if (result < min) result = min;
  if (result > max) result = max;
  return result;
}

function uniquePositiveInts(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => positiveInt(value)).filter(Boolean))).sort((a, b) => a - b);
}

function uniquePositiveIntsInOrder(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const id = positiveInt(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

function isActiveEventGroup(group) {
  return positiveInt(group && group.worldmapEventID) > 0 && toBigInt(group && group.eventUid) > 0n;
}

function envFlag(...keys) {
  return keys.some((key) => {
    const value = process.env[key];
    if (value == null) return false;
    const normalized = String(value).trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
  });
}

function envFlagDefault(defaultValue, ...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value == null) continue;
    const normalized = String(value).trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return Boolean(defaultValue);
}

function hashString(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

module.exports = {
  createWorldMapHandlers,
  ensureWorldMapState,
  buildWorldMapData,
  getWorldMapCityIds,
  buildWorldMapCityData,
  buildActiveDiveGameData,
  buildDiveClearData,
  buildDiveHistoryData,
  hasWorldMapProgress,
  refreshWorldMapState,
  unlockCity,
  startWorldMapMission,
  completeWorldMapMission,
};
