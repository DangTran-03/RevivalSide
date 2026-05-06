const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const TABLE_ROOTS = [
  path.join(ROOT_DIR, "gameplay-tables-json", "Assetbundles"),
  path.join(ROOT_DIR, "gameplay-tables-json", "StreamingAssets"),
];

let cachedData = null;

function loadGameData() {
  if (cachedData) return cachedData;

  const miscItems = new Map();
  const miscItemsByStrId = new Map();
  for (const record of readRecords("ab_script_item_templet", "LUA_ITEM_MISC_TEMPLET.json")) {
    const itemId = Number(record && record.m_ItemMiscID);
    if (!Number.isInteger(itemId) || itemId <= 0 || miscItems.has(itemId)) continue;
    miscItems.set(itemId, record);
    if (record.m_ItemMiscStrID) miscItemsByStrId.set(String(record.m_ItemMiscStrID), record);
  }

  const randomItemBoxes = groupByNumber(readRecords("ab_script", "LUA_RANDOM_ITEM_BOX.json"), "m_RewardGroupID");
  const customPackageBoxes = groupByNumber(readRecords("ab_script", "LUA_CUSTOM_PACKAGE_ITEM_BOX.json"), "m_CustomRewardGroupID");
  const acqPackages = groupByNumber(readRecords("ab_script", "LUA_ACQ_PACKAGE_TEMPLET.json"), "m_PackageID");
  const rewardGroups = groupByNumber(readRecords("ab_script", "LUA_REWARD_TEMPLET_CL.json"), "m_RewardGroupID");

  const unitById = new Map();
  const unitByStrId = new Map();
  for (const fileName of [
    "LUA_UNIT_TEMPLET_BASE.json",
    "LUA_UNIT_TEMPLET_BASE2.json",
    "LUA_UNIT_TEMPLET_BASE_SD.json",
    "LUA_UNIT_TEMPLET_BASE_OPR.json",
  ]) {
    for (const record of readRecords("ab_script_unit_data", fileName)) {
      const unitId = Number(record && record.m_UnitID);
      if (!Number.isInteger(unitId) || unitId <= 0 || unitById.has(unitId)) continue;
      unitById.set(unitId, record);
      if (record.m_UnitStrID) unitByStrId.set(String(record.m_UnitStrID), record);
    }
  }

  const collectionUnits = readRecords("ab_script", "LUA_COLLECTION_UNIT_TEMPLET.json");
  for (const record of collectionUnits) {
    const unitId = Number(record && record.m_UnitID);
    if (!Number.isInteger(unitId) || unitId <= 0) continue;
    if (!unitById.has(unitId)) unitById.set(unitId, record);
    if (record.m_UnitStrID && !unitByStrId.has(String(record.m_UnitStrID))) {
      unitByStrId.set(String(record.m_UnitStrID), record);
    }
  }

  const pieceByItemId = new Map();
  for (const record of readRecords("ab_script_item_templet", "LUA_PIECE_TEMPLET.json")) {
    const itemId = Number(record && record.m_PieceID);
    if (Number.isInteger(itemId) && itemId > 0) pieceByItemId.set(itemId, record);
  }

  const contracts = new Map();
  for (const record of readRecords("ab_script", "LUA_CONTRACT.json")) {
    const contractId = Number(record && record.m_ContractID);
    if (Number.isInteger(contractId) && contractId > 0 && !contracts.has(contractId)) contracts.set(contractId, record);
  }

  const contractTabs = new Map();
  for (const record of readRecords("ab_script", "LUA_CONTRACT_TAB_TABLE.json")) {
    const contractId = Number(record && record.m_ContractID);
    if (!Number.isInteger(contractId) || contractId <= 0 || contractTabs.has(contractId)) continue;
    contractTabs.set(contractId, record);
  }

  const contractUnitPools = readRecords("ab_script", "LUA_CONTRACT_UNIT_POOL.json");
  const selectableContractUnitPools = readRecords("ab_script", "LUA_SELECTABLE_CONTRACT_UNIT_POOL.json");
  const customPickupContracts = readRecords("ab_script", "LUA_CONTRACT_CUSTOM_PICKUP.json");
  const randomGradeTables = new Map();
  for (const record of readRecords("ab_script", "LUA_RANDOM_GRADE_TABLE.json")) {
    const id = Number(record && record.m_RandomGradeID);
    if (Number.isInteger(id) && id > 0 && !randomGradeTables.has(id)) randomGradeTables.set(id, record);
    if (record && record.m_RandomGradeStrID && !randomGradeTables.has(String(record.m_RandomGradeStrID))) {
      randomGradeTables.set(String(record.m_RandomGradeStrID), record);
    }
  }
  const miscContracts = new Map();
  for (const record of readRecords("ab_script", "LUA_MISC_CONTRACT.json")) {
    const contractId = Number(record && record.m_ContractID);
    if (Number.isInteger(contractId) && contractId > 0) miscContracts.set(contractId, record);
  }

  const equipById = new Map();
  for (const record of readRecords("ab_script_item_templet", "LUA_ITEM_EQUIP_TEMPLET.json")) {
    const equipId = Number(record && record.m_ItemEquipID);
    if (Number.isInteger(equipId) && equipId > 0 && !equipById.has(equipId)) equipById.set(equipId, record);
  }
  const equipRandomStats = groupByNumber(readRecords("ab_script", "LUA_ITEM_EQUIP_RANDOM_STAT.json"), "m_StatGroupID");
  const equipSetOptions = new Map();
  for (const record of readRecords("ab_script_item_templet", "LUA_ITEM_EQUIP_SET_OPTION.json")) {
    const setId = Number(record && record.m_EquipSetID);
    if (Number.isInteger(setId) && setId > 0 && !equipSetOptions.has(setId)) equipSetOptions.set(setId, record);
  }
  const skinById = new Map();
  for (const record of readRecords("ab_script", "LUA_SKIN_TEMPLET.json")) {
    const skinId = Number(record && record.m_SkinID);
    if (Number.isInteger(skinId) && skinId > 0 && !skinById.has(skinId)) skinById.set(skinId, record);
  }

  const emoticonById = new Map();
  for (const record of readRecords("ab_script_item_templet", "LUA_ITEM_EMOTICON_TEMPLET.json")) {
    const emoticonId = Number(record && record.m_EmoticonID);
    if (Number.isInteger(emoticonId) && emoticonId > 0 && !emoticonById.has(emoticonId)) emoticonById.set(emoticonId, record);
  }

  const unitExpTable = new Map();
  for (const record of readRecords("ab_script_unit_data", "LUA_UNIT_EXP_TABLE.json")) {
    const level = Number(record && record.m_iLevel);
    if (!Number.isInteger(level) || level <= 0 || unitExpTable.has(level)) continue;
    unitExpTable.set(level, record);
  }

  const operatorExpTable = new Map();
  for (const record of readRecords("ab_script_unit_data", "LUA_OPERATOR_EXP_TEMPLET.json")) {
    const level = Number(record && record.m_iLevel);
    const grade = normalizeOperatorGrade(record && record.m_NKM_UNIT_GRADE);
    if (!Number.isInteger(level) || level <= 0 || !grade) continue;
    if (!operatorExpTable.has(grade)) operatorExpTable.set(grade, new Map());
    const byLevel = operatorExpTable.get(grade);
    if (!byLevel.has(level)) byLevel.set(level, record);
  }

  const contentUnlocksByDungeonId = groupByNumber(
    readRecords("ab_script", "LUA_CONTENTS_UNLOCK_TEMPLET.json").filter(
      (record) => String(record && record.m_UnlockReqType) === "SURT_CLEAR_DUNGEON"
    ),
    "m_UnlockReqValue"
  );

  cachedData = {
    miscItems,
    miscItemsByStrId,
    randomItemBoxes,
    customPackageBoxes,
    acqPackages,
    rewardGroups,
    unitById,
    unitByStrId,
    pieceByItemId,
    contracts,
    contractTabs,
    contractUnitPools,
    selectableContractUnitPools,
    customPickupContracts,
    randomGradeTables,
    miscContracts,
    equipById,
    equipRandomStats,
    equipSetOptions,
    skinById,
    emoticonById,
    unitExpTable,
    operatorExpTable,
    contentUnlocksByDungeonId,
  };
  return cachedData;
}

function getMiscItemTemplet(itemId) {
  return loadGameData().miscItems.get(Number(itemId)) || null;
}

function getAllMiscItemIds() {
  return Array.from(loadGameData().miscItems.keys()).sort((a, b) => a - b);
}

function getUnitTemplet(unitIdOrStrId) {
  const data = loadGameData();
  if (typeof unitIdOrStrId === "string" && !/^\d+$/.test(unitIdOrStrId)) {
    return data.unitByStrId.get(unitIdOrStrId) || null;
  }
  return data.unitById.get(Number(unitIdOrStrId)) || null;
}

function resolveUnitId(unitIdOrStrId) {
  const templet = getUnitTemplet(unitIdOrStrId);
  return Number(templet && templet.m_UnitID) || Number(unitIdOrStrId) || 0;
}

function getPlayableUnitIds(options = {}) {
  const includeOperators = options.includeOperators === true;
  return Array.from(loadGameData().unitById.values())
    .filter((record) => {
      if (!record || record.m_bMonster === true) return false;
      const type = String(record.m_NKM_UNIT_TYPE || "");
      const style = String(record.m_NKM_UNIT_STYLE_TYPE || "");
      if (type === "NUT_SYSTEM" || type === "NUT_SHIP") return false;
      if (type === "NUT_OPERATOR" && !includeOperators) return false;
      if (style === "NUST_TRAINER") return false;
      return Number(record.m_UnitID) > 0;
    })
    .map((record) => Number(record.m_UnitID))
    .sort((a, b) => a - b);
}

function getPlayableShipIds() {
  return Array.from(loadGameData().unitById.values())
    .filter((record) => {
      if (!record || record.m_bMonster === true) return false;
      return String(record.m_NKM_UNIT_TYPE || "") === "NUT_SHIP" && Number(record.m_UnitID) > 0;
    })
    .map((record) => Number(record.m_UnitID))
    .sort((a, b) => a - b);
}

function getPlayableOperatorIds() {
  return Array.from(loadGameData().unitById.values())
    .filter((record) => {
      if (!record || record.m_bMonster === true) return false;
      return String(record.m_NKM_UNIT_TYPE || "") === "NUT_OPERATOR" && Number(record.m_UnitID) > 0;
    })
    .map((record) => Number(record.m_UnitID))
    .sort((a, b) => a - b);
}

function getContractRecord(contractId) {
  return loadGameData().contracts.get(Number(contractId)) || null;
}

function getContractTabRecord(contractId) {
  return loadGameData().contractTabs.get(Number(contractId)) || null;
}

function getVisibleContractIds() {
  const data = loadGameData();
  const ids = new Set([...data.contracts.keys(), ...data.contractTabs.keys()]);
  return Array.from(ids)
    .filter((id) => {
      const tab = data.contractTabs.get(id);
      if (!tab) return true;
      if (tab.m_bEnabled === false || tab.m_bVisible === false) return false;
      return true;
    })
    .sort((a, b) => {
      const aTab = data.contractTabs.get(a) || {};
      const bTab = data.contractTabs.get(b) || {};
      return Number(aTab.m_Priority || 0) - Number(bTab.m_Priority || 0) || a - b;
    });
}

function getContractPoolUnitIds(contractIdOrPoolId) {
  const contract = getContractRecord(contractIdOrPoolId);
  const entries = getContractPoolUnitEntries(contractIdOrPoolId);
  return uniquePositiveInts([
    ...(contract ? getContractAdditionalUnitIds(contract) : []),
    ...entries.map((entry) => entry.unitId),
  ]).filter(isContractRewardUnitId);
}

function getContractPoolUnitEntries(contractIdOrPoolId, options = {}) {
  const data = loadGameData();
  const contract = getContractRecord(contractIdOrPoolId);
  const poolId = contract && contract.m_UnitPoolID != null ? contract.m_UnitPoolID : contractIdOrPoolId;
  let records = data.contractUnitPools.filter((record) => matchesPool(record, poolId));
  if (!records.length) records = data.selectableContractUnitPools.filter((record) => matchesPool(record, poolId));
  const includeOperators = options.includeOperators === true;
  const seen = new Set();
  const entries = [];
  for (const record of records) {
    const unitId = resolveUnitId(record.m_UnitStrId || record.m_UnitID || record.m_UnitId);
    if (!Number.isInteger(unitId) || unitId <= 0 || seen.has(unitId)) continue;
    if (includeOperators ? !isContractRewardOperatorId(unitId) : !isContractRewardUnitId(unitId)) continue;
    seen.add(unitId);
    const unitRecord = getUnitTemplet(unitId) || {};
    entries.push({
      unitId,
      ratio: Math.max(1, Number(record.m_Ratio || 1)),
      grade: normalizeUnitGrade(unitRecord.m_NKM_UNIT_GRADE),
      pickupTarget: record.m_PickupTarget === true || record.m_CustomPickupTarget === true,
      record,
    });
  }
  return entries;
}

function isContractRewardUnitId(unitId) {
  const record = getUnitTemplet(unitId);
  if (!record || record.m_bMonster === true) return false;
  const type = String(record.m_NKM_UNIT_TYPE || "");
  const style = String(record.m_NKM_UNIT_STYLE_TYPE || "");
  return type !== "NUT_SYSTEM" && type !== "NUT_SHIP" && type !== "NUT_OPERATOR" && style !== "NUST_TRAINER";
}

function isContractRewardOperatorId(unitId) {
  const record = getUnitTemplet(unitId);
  if (!record || record.m_bMonster === true) return false;
  return String(record.m_NKM_UNIT_TYPE || "") === "NUT_OPERATOR";
}

function normalizeUnitGrade(value) {
  const text = String(value || "").toUpperCase();
  if (text.includes("SSR")) return "SSR";
  if (text.includes("SR")) return "SR";
  if (text.includes("R")) return "R";
  if (text.includes("N")) return "N";
  return "";
}

function getRandomGradeTable(randomGradeIdOrStrId) {
  const data = loadGameData();
  if (randomGradeIdOrStrId == null) return null;
  const asNumber = Number(randomGradeIdOrStrId);
  if (Number.isInteger(asNumber) && data.randomGradeTables.has(asNumber)) return data.randomGradeTables.get(asNumber);
  return data.randomGradeTables.get(String(randomGradeIdOrStrId)) || null;
}

function getMiscContractRecord(contractId) {
  return loadGameData().miscContracts.get(Number(contractId)) || null;
}

function getCustomPickupContractRecords() {
  return loadGameData().customPickupContracts.slice();
}

function getPieceTemplet(itemId) {
  return loadGameData().pieceByItemId.get(Number(itemId)) || null;
}

function getRandomBoxRewards(groupId) {
  return (loadGameData().randomItemBoxes.get(Number(groupId)) || []).slice();
}

function getCustomPackageRewards(groupId) {
  return (loadGameData().customPackageBoxes.get(Number(groupId)) || []).slice();
}

function getAcqPackageRewards(packageId) {
  return (loadGameData().acqPackages.get(Number(packageId)) || []).slice();
}

function getRewardGroupRecords(groupId) {
  return (loadGameData().rewardGroups.get(Number(groupId)) || []).slice();
}

function getEquipTemplet(equipId) {
  return loadGameData().equipById.get(Number(equipId)) || null;
}

function getAllEquipIds(options = {}) {
  const includeEnchantModules = options.includeEnchantModules === true;
  return Array.from(loadGameData().equipById.values())
    .filter((record) => includeEnchantModules || String(record.m_ItemEquipPosition || "") !== "IEP_ENCHANT")
    .map((record) => Number(record.m_ItemEquipID))
    .filter((id) => Number.isInteger(id) && id > 0)
    .sort((a, b) => a - b);
}

function getRandomEquipId(seed = 0, options = {}) {
  const ids = getAllEquipIds(options);
  if (!ids.length) return 0;
  return ids[Math.abs(Number(seed) || 0) % ids.length];
}

function getEquipRandomStatRecords(groupId) {
  return (loadGameData().equipRandomStats.get(Number(groupId)) || []).slice();
}

function getAllEquipRandomStatRecords() {
  return Array.from(loadGameData().equipRandomStats.values()).flat().slice();
}

function getEquipSetOptionIds(equipTemplet = null) {
  const explicit = Array.isArray(equipTemplet && equipTemplet.m_SetGroup)
    ? equipTemplet.m_SetGroup.map(Number).filter((id) => Number.isInteger(id) && id > 0)
    : [];
  if (explicit.length) return explicit;
  return Array.from(loadGameData().equipSetOptions.keys()).sort((a, b) => a - b);
}

function getEquipSetOption(setOptionId) {
  return loadGameData().equipSetOptions.get(Number(setOptionId)) || null;
}

function getAllEquipSetOptionRecords() {
  return Array.from(loadGameData().equipSetOptions.values()).slice();
}

function getSkinTemplet(skinId) {
  return loadGameData().skinById.get(Number(skinId)) || null;
}

function getAllSkinIds() {
  return Array.from(loadGameData().skinById.keys()).sort((a, b) => a - b);
}

function getEmoticonTemplet(emoticonId) {
  return loadGameData().emoticonById.get(Number(emoticonId)) || null;
}

function getAllEmoticonIds() {
  return Array.from(loadGameData().emoticonById.keys()).sort((a, b) => a - b);
}

function getUnitExpRecord(level) {
  return loadGameData().unitExpTable.get(Number(level)) || null;
}

function getTotalExpForUnitLevel(level) {
  const record = getUnitExpRecord(level);
  return Number(record && record.m_iExpCumulated) || 0;
}

function getUnitLevelByTotalExp(totalExp, maxLevel = 110) {
  const data = loadGameData();
  const exp = Math.max(0, Number(totalExp) || 0);
  const cap = Math.max(1, Number(maxLevel) || 1);
  let result = 1;
  for (const level of Array.from(data.unitExpTable.keys()).sort((a, b) => a - b)) {
    if (level > cap) break;
    const record = data.unitExpTable.get(level);
    const cumulated = Number(record && record.m_iExpCumulated) || 0;
    if (cumulated <= exp) result = level;
    else break;
  }
  if (data.unitExpTable.size > 0) return Math.max(1, Math.min(cap, result));
  return Math.max(1, Math.min(cap, 1 + Math.floor(exp / 100)));
}

function getOperatorExpRecord(grade, level) {
  const byLevel = loadGameData().operatorExpTable.get(normalizeOperatorGrade(grade));
  return (byLevel && byLevel.get(Number(level))) || null;
}

function getOperatorTotalExpForLevel(grade, level) {
  const record = getOperatorExpRecord(grade, level);
  return Number(record && record.m_iExpCumulatedOpr) || 0;
}

function getOperatorRequiredExpForLevel(grade, level) {
  const record = getOperatorExpRecord(grade, level);
  return Number(record && record.m_iExpRequiredOpr) || 0;
}

function getOperatorMaxLevel(grade) {
  const byLevel = loadGameData().operatorExpTable.get(normalizeOperatorGrade(grade));
  if (!byLevel || byLevel.size <= 0) return 100;
  return Math.max(...Array.from(byLevel.keys()));
}

function getOperatorLevelByTotalExp(grade, totalExp, maxLevel = getOperatorMaxLevel(grade)) {
  const byLevel = loadGameData().operatorExpTable.get(normalizeOperatorGrade(grade));
  const exp = Math.max(0, Number(totalExp) || 0);
  const cap = Math.max(1, Number(maxLevel) || 1);
  if (!byLevel || byLevel.size <= 0) return Math.max(1, Math.min(cap, 1 + Math.floor(exp / 100)));

  let result = 1;
  for (const level of Array.from(byLevel.keys()).sort((a, b) => a - b)) {
    if (level > cap) break;
    const record = byLevel.get(level);
    const cumulated = Number(record && record.m_iExpCumulatedOpr) || 0;
    if (cumulated <= exp) result = level;
    else break;
  }
  return Math.max(1, Math.min(cap, result));
}

function getContentUnlocksForDungeon(dungeonId) {
  return (loadGameData().contentUnlocksByDungeonId.get(Number(dungeonId)) || []).slice();
}

function getContractAdditionalUnitIds(contract) {
  if (!contract || !contract.m_addUnitStrId) return [];
  const unitId = resolveUnitId(contract.m_addUnitStrId);
  return unitId > 0 ? [unitId] : [];
}

function matchesPool(record, poolId) {
  if (!record || poolId == null) return false;
  const poolText = String(poolId);
  return String(record.m_UnitPoolStrId || "") === poolText || Number(record.m_UnitPoolId) === Number(poolId);
}

function uniquePositiveInts(values) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  );
}

function normalizeOperatorGrade(grade) {
  return String(grade || "").trim().toUpperCase();
}

function groupByNumber(records, key) {
  const map = new Map();
  for (const record of records) {
    const value = Number(record && record[key]);
    if (!Number.isInteger(value) || value <= 0) continue;
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(record);
  }
  return map;
}

function readRecords(directory, fileName) {
  for (const root of TABLE_ROOTS) {
    const filePath = path.join(root, directory, "luac", fileName);
    if (!fs.existsSync(filePath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (Array.isArray(parsed.records)) return parsed.records;
    } catch (err) {
      console.log(`[game-data] failed to load ${filePath}: ${err.message}`);
    }
  }
  return [];
}

module.exports = {
  loadGameData,
  getMiscItemTemplet,
  getAllMiscItemIds,
  getUnitTemplet,
  resolveUnitId,
  getPlayableUnitIds,
  getPlayableShipIds,
  getPlayableOperatorIds,
  getContractRecord,
  getContractTabRecord,
  getVisibleContractIds,
  getContractPoolUnitIds,
  getContractPoolUnitEntries,
  getMiscContractRecord,
  getCustomPickupContractRecords,
  getRandomGradeTable,
  getPieceTemplet,
  getRandomBoxRewards,
  getCustomPackageRewards,
  getAcqPackageRewards,
  getRewardGroupRecords,
  getEquipTemplet,
  getAllEquipIds,
  getRandomEquipId,
  getEquipRandomStatRecords,
  getAllEquipRandomStatRecords,
  getEquipSetOptionIds,
  getEquipSetOption,
  getAllEquipSetOptionRecords,
  getSkinTemplet,
  getAllSkinIds,
  getEmoticonTemplet,
  getAllEmoticonIds,
  getUnitExpRecord,
  getTotalExpForUnitLevel,
  getUnitLevelByTotalExp,
  getOperatorExpRecord,
  getOperatorTotalExpForLevel,
  getOperatorRequiredExpForLevel,
  getOperatorMaxLevel,
  getOperatorLevelByTotalExp,
  getContentUnlocksForDungeon,
};
