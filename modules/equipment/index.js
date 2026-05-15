const { dateTimeBinaryNow, toBigInt } = require("../packet-codec");
const {
  getEquipTemplet,
  getAllEquipIds,
  getEquipRandomStatRecords,
  getAllEquipRandomStatRecords,
  getEquipSetOptionIds,
  getRandomEquipId,
} = require("../game-data");
const { ensureInventory } = require("../inventory");

const DEFAULT_NEXT_EQUIP_UID = 9100000000000001n;
const DEFAULT_STAT_TYPES = Object.freeze([
  "NST_ATK",
  "NST_HP",
  "NST_DEF",
  "NST_ATTACK_SPEED_RATE",
  "NST_SKILL_COOL_TIME_REDUCE_RATE",
  "NST_DAMAGE_REDUCE_RATE",
]);
const EQUIP_POSITION_INDEX = Object.freeze({
  IEP_WEAPON: 0,
  IEP_DEFENCE: 1,
  IEP_ACC: 2,
  IEP_ACC2: 3,
});

function ensureEquipInventory(user) {
  const inventory = ensureInventory(user);
  inventory.equips = inventory.equips && typeof inventory.equips === "object" ? inventory.equips : {};
  inventory.equipPresets = Array.isArray(inventory.equipPresets) ? inventory.equipPresets : [];
  user.nextEquipUid = String(toBigInt(user.nextEquipUid, DEFAULT_NEXT_EQUIP_UID));

  for (const [key, value] of Object.entries(inventory.equips)) {
    const equip = normalizeEquip(value);
    if (!equip) {
      delete inventory.equips[key];
      continue;
    }
    if (String(key) !== String(equip.equipUid)) delete inventory.equips[key];
    inventory.equips[String(equip.equipUid)] = equip;
  }
  normalizeEquipPresets(inventory);
  return inventory;
}

function getEquipItems(user) {
  const inventory = ensureEquipInventory(user);
  return Object.values(inventory.equips)
    .map(normalizeEquip)
    .filter(Boolean)
    .sort((a, b) => Number(toBigInt(a.equipUid) - toBigInt(b.equipUid)));
}

function getEquipItem(user, equipUid) {
  const inventory = ensureEquipInventory(user);
  const equip = normalizeEquip(inventory.equips[String(toBigInt(equipUid))]);
  if (equip) inventory.equips[String(equip.equipUid)] = equip;
  return equip;
}

function grantEquipItem(user, equipId, options = {}) {
  if (!user) return null;
  let numericEquipId = Number(equipId);
  if (!Number.isInteger(numericEquipId) || numericEquipId <= 0) {
    numericEquipId = getRandomEquipId(Number(user.localEquipGrantCursor || 0));
    user.localEquipGrantCursor = Number(user.localEquipGrantCursor || 0) + 1;
  }
  const templet = getEquipTemplet(numericEquipId);
  if (!templet) return null;

  const inventory = ensureEquipInventory(user);
  const equipUid = allocateEquipUid(user);
  const equip = createEquipData(numericEquipId, equipUid, {
    ...options,
    cursor: Number(user.localEquipStatCursor || 0),
  });
  user.localEquipStatCursor = Number(user.localEquipStatCursor || 0) + 1;
  inventory.equips[equip.equipUid] = equip;
  markInventoryTouched(inventory);
  return equip;
}

function createEquipData(equipId, equipUid, options = {}) {
  const templet = getEquipTemplet(equipId) || {};
  const customMainStat = normalizeCustomMainStat(options.customMainStat);
  const customSubstats = normalizeCustomSubstats(options.customSubstats);
  const stats = [customMainStat ? buildCustomMainStat(templet, customMainStat) : defaultMainStat(templet, options)];
  for (let slot = 1; slot <= 2; slot += 1) {
    const groupId = slot === 1 ? templet.m_StatGroupID : templet.m_StatGroupID_2;
    const custom = customSubstats.find((entry) => Number(entry.slot) === slot);
    const rolled = custom
      ? buildCustomSubstat(groupId, custom, { overrideUnsupportedSubstats: options.overrideUnsupportedSubstats })
      : rollStatFromGroup(groupId, options.cursor || 0);
    if (rolled) stats.push(rolled);
  }
  while (stats.length < 3) stats.push(rollFallbackStat(stats.length + Number(options.cursor || 0)));

  return normalizeEquip({
    equipUid: equipUid.toString(),
    itemEquipId: Number(equipId),
    ownerUnitUid: "-1",
    enchantLevel: Number(options.enchantLevel || 0),
    enchantExp: Number(options.enchantExp || 0),
    stats,
    locked: Boolean(options.locked),
    precision: Number(options.precision != null ? options.precision : 100),
    precision2: Number(options.precision2 != null ? options.precision2 : 100),
    setOptionId: Number(options.setOptionId || pickSetOptionId(templet, options.cursor || 0)),
    imprintUnitId: Number(options.imprintUnitId || 0),
    potentialOptions: options.potentialOptions || buildDefaultPotentialOptions(templet),
    regDate: String(options.regDate || dateTimeBinaryNow()),
  });
}

function removeEquipItems(user, equipUids) {
  const inventory = ensureEquipInventory(user);
  const army = ensureArmy(user);
  const removed = [];
  for (const equipUid of Array.isArray(equipUids) ? equipUids : []) {
    const key = String(toBigInt(equipUid));
    const equip = normalizeEquip(inventory.equips[key]);
    if (!equip || equip.locked) continue;
    unequipFromAnyUnit(army, key);
    delete inventory.equips[key];
    removed.push(key);
  }
  if (removed.length) markInventoryTouched(inventory);
  return removed;
}

function equipItemToUnit(user, unitUid, equipUid, position = null) {
  const inventory = ensureEquipInventory(user);
  const army = ensureArmy(user);
  const key = String(toBigInt(equipUid));
  const equip = normalizeEquip(inventory.equips[key]);
  const unit = getUnitByUid(army, unitUid);
  if (!equip || !unit) return { equip: null, unit: null, unequipItemUID: "0", position: normalizePosition(position) };

  const slot = normalizePosition(position != null ? position : inferEquipPosition(equip));
  unit.equipItemUids = normalizeFixedArray(unit.equipItemUids, 4, 0);
  const unequipItemUID = String(toBigInt(unit.equipItemUids[slot] || 0));
  if (unequipItemUID !== "0" && inventory.equips[unequipItemUID]) inventory.equips[unequipItemUID].ownerUnitUid = "-1";
  unequipFromAnyUnit(army, key);
  unit.equipItemUids[slot] = key;
  equip.ownerUnitUid = String(toBigInt(unit.unitUid));
  inventory.equips[key] = equip;
  markInventoryTouched(inventory);
  return { equip, unit, unequipItemUID, position: slot };
}

function unequipItem(user, equipUid) {
  const inventory = ensureEquipInventory(user);
  const army = ensureArmy(user);
  const key = String(toBigInt(equipUid));
  const equip = normalizeEquip(inventory.equips[key]);
  const owner = findEquipOwnerUnit(army, key) || (equip && toBigInt(equip.ownerUnitUid) > 0n ? { unit: getUnitByUid(army, equip.ownerUnitUid), position: inferEquipPosition(equip) } : null);
  const position = owner && owner.position != null ? owner.position : equip ? inferEquipPosition(equip) : 0;
  unequipFromAnyUnit(army, key);
  if (equip) {
    equip.ownerUnitUid = "-1";
    inventory.equips[key] = equip;
  }
  markInventoryTouched(inventory);
  return { equip, unit: owner && owner.unit, unequipItemUID: key, position };
}

function lockEquipItem(user, equipUid, isLock) {
  const equip = getEquipItem(user, equipUid);
  if (!equip) return null;
  equip.locked = Boolean(isLock);
  ensureEquipInventory(user).equips[equip.equipUid] = equip;
  markInventoryTouched(user.inventory);
  return equip;
}

function enchantEquipItem(user, equipUid, consumeEquipUids = [], options = {}) {
  const equip = getEquipItem(user, equipUid);
  if (!equip) return null;
  const consumed = removeEquipItems(user, consumeEquipUids);
  const addLevel = Math.max(1, Number(options.levels || consumed.length || 1));
  equip.enchantLevel = Math.min(10, Number(equip.enchantLevel || 0) + addLevel);
  equip.enchantExp = Number(equip.enchantExp || 0);
  ensureEquipInventory(user).equips[equip.equipUid] = equip;
  markInventoryTouched(user.inventory);
  return { equip, consumed };
}

function rollEquipPrecision(user, equipUid, optionId = 0) {
  const equip = getEquipItem(user, equipUid);
  if (!equip) return null;
  const slot = normalizeOptionSlot(optionId);
  const next = Math.min(100, Number(slot === 2 ? equip.precision2 : equip.precision) + 10);
  if (slot === 2) equip.precision2 = next;
  else equip.precision = next;
  ensureEquipInventory(user).equips[equip.equipUid] = equip;
  markInventoryTouched(user.inventory);
  return { equip, precision: next };
}

function rollEquipSubstat(user, equipUid, optionId = 0, forcedStatType = null) {
  const equip = getEquipItem(user, equipUid);
  if (!equip) return null;
  const templet = getEquipTemplet(equip.itemEquipId) || {};
  const slot = normalizeOptionSlot(optionId);
  const groupId = slot === 2 ? templet.m_StatGroupID_2 : templet.m_StatGroupID;
  const cursor = Number(user.localEquipStatCursor || 0);
  user.localEquipStatCursor = cursor + 1;
  const rolled = forcedStatType
    ? statForType(forcedStatType, groupId)
    : rollStatFromGroup(groupId, cursor) || rollFallbackStat(cursor);
  equip.tuningCandidate = {
    equipUid: equip.equipUid,
    option1: slot === 1 ? rolled.type : (equip.stats[1] && equip.stats[1].type) || "NST_HP",
    option2: slot === 2 ? rolled.type : (equip.stats[2] && equip.stats[2].type) || "NST_ATK",
    setOptionId: Number(equip.setOptionId || 0),
    slot,
    stat: rolled,
  };
  ensureEquipInventory(user).equips[equip.equipUid] = equip;
  markInventoryTouched(user.inventory);
  return { equip, candidate: equip.tuningCandidate };
}

function validateEquipCustomSubstats(equipId, customSubstats = [], options = {}) {
  const templet = getEquipTemplet(equipId);
  if (!templet) return { ok: false, unsupported: [], substats: [], error: `No gear id ${equipId} exists in local tables.` };
  const substats = normalizeCustomSubstats(customSubstats);
  const unsupported = [];
  for (const substat of substats) {
    const slot = normalizeSubstatSlot(substat.slot);
    const groupId = slot === 1 ? templet.m_StatGroupID : templet.m_StatGroupID_2;
    if (!findStatRecord(groupId, substat.type)) {
      unsupported.push({ slot, type: substat.type, groupId: Number(groupId || 0) });
    }
  }
  return {
    ok: unsupported.length === 0 || options.overrideUnsupportedSubstats === true,
    unsupported,
    substats,
  };
}

function confirmEquipSubstat(user, equipUid, optionId = 0) {
  const equip = getEquipItem(user, equipUid);
  if (!equip) return null;
  const candidate = equip.tuningCandidate || null;
  if (candidate && candidate.stat) {
    const slot = normalizeOptionSlot(optionId || candidate.slot || 1);
    equip.stats = normalizeStats(equip.stats);
    equip.stats[slot] = candidate.stat;
  }
  equip.tuningCandidate = null;
  ensureEquipInventory(user).equips[equip.equipUid] = equip;
  markInventoryTouched(user.inventory);
  return { equip, candidate };
}

function cancelEquipTuning(user) {
  const inventory = ensureEquipInventory(user);
  let candidate = null;
  for (const equip of Object.values(inventory.equips)) {
    if (equip && equip.tuningCandidate) {
      candidate = equip.tuningCandidate;
      equip.tuningCandidate = null;
    }
  }
  markInventoryTouched(inventory);
  return candidate || { equipUid: 0, option1: 0, option2: 0, setOptionId: 0 };
}

function rollSetOption(user, equipUid, forcedSetOptionId = null) {
  const equip = getEquipItem(user, equipUid);
  if (!equip) return null;
  const templet = getEquipTemplet(equip.itemEquipId) || {};
  const setOptionId = Number(forcedSetOptionId || pickSetOptionId(templet, Number(user.localEquipSetCursor || 0)));
  user.localEquipSetCursor = Number(user.localEquipSetCursor || 0) + 1;
  equip.tuningCandidate = {
    equipUid: equip.equipUid,
    option1: (equip.stats[1] && equip.stats[1].type) || "NST_HP",
    option2: (equip.stats[2] && equip.stats[2].type) || "NST_ATK",
    setOptionId,
  };
  ensureEquipInventory(user).equips[equip.equipUid] = equip;
  markInventoryTouched(user.inventory);
  return { equip, setOptionId, candidate: equip.tuningCandidate };
}

function confirmSetOption(user, equipUid, setOptionId = null) {
  const equip = getEquipItem(user, equipUid);
  if (!equip) return null;
  const candidate = equip.tuningCandidate || null;
  const nextSetId = Number(setOptionId || (candidate && candidate.setOptionId) || equip.setOptionId || 0);
  equip.setOptionId = nextSetId;
  equip.tuningCandidate = null;
  ensureEquipInventory(user).equips[equip.equipUid] = equip;
  markInventoryTouched(user.inventory);
  return { equip, setOptionId: nextSetId, candidate };
}

function imprintEquip(user, equipUid, unitId) {
  const equip = getEquipItem(user, equipUid);
  if (!equip) return null;
  equip.imprintUnitId = Number(unitId || 0);
  ensureEquipInventory(user).equips[equip.equipUid] = equip;
  markInventoryTouched(user.inventory);
  return equip;
}

function openPotentialSocket(user, equipUid, socketIndex) {
  const equip = getEquipItem(user, equipUid);
  if (!equip) return null;
  const index = Math.max(0, Math.min(2, Number(socketIndex || 0)));
  equip.potentialOptions = Array.isArray(equip.potentialOptions) ? equip.potentialOptions : [];
  if (!equip.potentialOptions.length) equip.potentialOptions.push(buildDefaultPotentialOption(equip));
  const option = equip.potentialOptions[0];
  option.sockets = normalizeFixedArray(option.sockets, 3, null);
  if (!option.sockets[index]) option.sockets[index] = { statValue: 0.01 * (index + 1), precision: 50 };
  ensureEquipInventory(user).equips[equip.equipUid] = equip;
  markInventoryTouched(user.inventory);
  return equip;
}

function rollPotentialOption(user, equipUid, socketIndex) {
  const equip = getEquipItem(user, equipUid);
  if (!equip) return null;
  const index = Math.max(0, Math.min(2, Number(socketIndex || 0)));
  const precision = 50 + ((Number(user.localEquipPotentialCursor || 0) * 7) % 51);
  user.localEquipPotentialCursor = Number(user.localEquipPotentialCursor || 0) + 1;
  equip.potentialCandidate = {
    equipUid: equip.equipUid,
    precision,
    socketIndex: index,
    accumulateCount: 0,
  };
  ensureEquipInventory(user).equips[equip.equipUid] = equip;
  markInventoryTouched(user.inventory);
  return { equip, candidate: equip.potentialCandidate };
}

function confirmPotentialOption(user, equipUid, socketIndex) {
  const equip = getEquipItem(user, equipUid);
  if (!equip) return null;
  const candidate = equip.potentialCandidate;
  if (candidate) {
    const index = Math.max(0, Math.min(2, Number(socketIndex != null ? socketIndex : candidate.socketIndex || 0)));
    equip.potentialOptions = Array.isArray(equip.potentialOptions) ? equip.potentialOptions : [];
    if (!equip.potentialOptions.length) equip.potentialOptions.push(buildDefaultPotentialOption(equip));
    const option = equip.potentialOptions[0];
    option.sockets = normalizeFixedArray(option.sockets, 3, null);
    option.sockets[index] = { statValue: Number(candidate.precision || 0) / 10000, precision: Number(candidate.precision || 0) };
    option.precisionChangeCount = Number(option.precisionChangeCount || 0) + 1;
  }
  equip.potentialCandidate = null;
  ensureEquipInventory(user).equips[equip.equipUid] = equip;
  markInventoryTouched(user.inventory);
  return equip;
}

function getEquipPresets(user) {
  return ensureEquipInventory(user).equipPresets.slice();
}

function addEquipPresets(user, count) {
  const inventory = ensureEquipInventory(user);
  const addCount = Math.max(1, Number(count || 1));
  for (let i = 0; i < addCount; i += 1) {
    const nextIndex = inventory.equipPresets.length;
    inventory.equipPresets.push({ presetIndex: nextIndex, presetType: 0, presetName: "", equipUids: [0, 0, 0, 0] });
  }
  normalizeEquipPresets(inventory);
  markInventoryTouched(inventory);
  return inventory.equipPresets.length;
}

function ensureEquipPreset(user, presetIndex) {
  const inventory = ensureEquipInventory(user);
  const index = Math.max(0, Number(presetIndex || 0));
  while (inventory.equipPresets.length <= index) {
    inventory.equipPresets.push({ presetIndex: inventory.equipPresets.length, presetType: 0, presetName: "", equipUids: [0, 0, 0, 0] });
  }
  normalizeEquipPresets(inventory);
  return inventory.equipPresets[index];
}

function setEquipPresetName(user, presetIndex, name) {
  const preset = ensureEquipPreset(user, presetIndex);
  preset.presetName = String(name || "").slice(0, 32);
  markInventoryTouched(user.inventory);
  return preset;
}

function registerEquipPreset(user, presetIndex, position, equipUid) {
  const preset = ensureEquipPreset(user, presetIndex);
  const slot = normalizePosition(position);
  preset.equipUids = normalizeFixedArray(preset.equipUids, 4, 0);
  preset.equipUids[slot] = String(toBigInt(equipUid));
  markInventoryTouched(user.inventory);
  return preset;
}

function registerEquipPresetFromUnit(user, unitUid, presetIndex) {
  const army = ensureArmy(user);
  const unit = getUnitByUid(army, unitUid);
  const preset = ensureEquipPreset(user, presetIndex);
  preset.equipUids = normalizeFixedArray(unit ? unit.equipItemUids : [], 4, 0);
  markInventoryTouched(user.inventory);
  return preset;
}

function applyEquipPreset(user, presetIndex, unitUid) {
  const preset = ensureEquipPreset(user, presetIndex);
  const update = { unitUid: String(toBigInt(unitUid)), equipUids: normalizeFixedArray(preset.equipUids, 4, 0) };
  const army = ensureArmy(user);
  const unit = getUnitByUid(army, unitUid);
  if (unit) {
    for (let index = 0; index < 4; index += 1) {
      const equipUid = preset.equipUids[index];
      if (toBigInt(equipUid) > 0n) equipItemToUnit(user, unitUid, equipUid, index);
    }
    update.equipUids = normalizeFixedArray(unit.equipItemUids, 4, 0);
  }
  return update;
}

function clearEquipPresets(user, presetIndices) {
  const indices = new Set((Array.isArray(presetIndices) ? presetIndices : []).map(Number));
  const inventory = ensureEquipInventory(user);
  for (const preset of inventory.equipPresets) {
    if (indices.has(Number(preset.presetIndex))) preset.equipUids = [0, 0, 0, 0];
  }
  markInventoryTouched(inventory);
  return inventory.equipPresets.slice();
}

function changeEquipPresetIndices(user, changes) {
  const inventory = ensureEquipInventory(user);
  for (const change of Array.isArray(changes) ? changes : []) {
    const from = Number(change.from != null ? change.from : change.presetIndex);
    const to = Number(change.to != null ? change.to : change.changeIndex);
    if (!Number.isInteger(from) || !Number.isInteger(to)) continue;
    ensureEquipPreset(user, Math.max(from, to));
    const tmp = inventory.equipPresets[from];
    inventory.equipPresets[from] = inventory.equipPresets[to];
    inventory.equipPresets[to] = tmp;
  }
  normalizeEquipPresets(inventory);
  markInventoryTouched(inventory);
  return inventory.equipPresets.slice();
}

function normalizeEquip(value) {
  if (!value || typeof value !== "object") return null;
  const equipUid = toBigInt(value.equipUid != null ? value.equipUid : value.m_ItemUid || 0);
  const itemEquipId = Number(value.itemEquipId != null ? value.itemEquipId : value.m_ItemEquipID || 0);
  if (equipUid <= 0n || !Number.isInteger(itemEquipId) || itemEquipId <= 0) return null;
  return {
    ...value,
    equipUid: equipUid.toString(),
    itemEquipId,
    ownerUnitUid: String(toBigInt(value.ownerUnitUid != null ? value.ownerUnitUid : value.m_OwnerUnitUID != null ? value.m_OwnerUnitUID : -1)),
    enchantLevel: Number(value.enchantLevel != null ? value.enchantLevel : value.m_EnchantLevel || 0) || 0,
    enchantExp: Number(value.enchantExp != null ? value.enchantExp : value.m_EnchantExp || 0) || 0,
    stats: normalizeStats(value.stats || value.m_Stat),
    locked: Boolean(value.locked || value.m_bLock),
    precision: Number(value.precision != null ? value.precision : value.m_Precision || 0) || 0,
    precision2: Number(value.precision2 != null ? value.precision2 : value.m_Precision2 || 0) || 0,
    setOptionId: Number(value.setOptionId != null ? value.setOptionId : value.m_SetOptionId || 0) || 0,
    imprintUnitId: Number(value.imprintUnitId != null ? value.imprintUnitId : value.m_ImprintUnitId || 0) || 0,
    potentialOptions: Array.isArray(value.potentialOptions) ? value.potentialOptions : [],
    regDate: String(value.regDate || "0"),
  };
}

function normalizeStats(stats) {
  const list = Array.isArray(stats) ? stats.slice(0, 3) : [];
  const result = list.map((stat, index) => ({
    type: String((stat && (stat.type || stat.statType)) || (index === 0 ? "NST_HP" : DEFAULT_STAT_TYPES[index] || "NST_ATK")),
    value: Number(stat && (stat.value != null ? stat.value : stat.stat_value || 0)) || 0,
    levelValue: Number(stat && (stat.levelValue != null ? stat.levelValue : stat.stat_level_value || 0)) || 0,
  }));
  while (result.length < 3) result.push(rollFallbackStat(result.length));
  return result;
}

function rollStatFromGroup(groupId, cursor = 0) {
  const records = getEquipRandomStatRecords(groupId);
  if (!records.length) return null;
  const record = records[Math.abs(Number(cursor) || 0) % records.length];
  return statForType(record.m_StatType, groupId, record);
}

function defaultMainStat(templet, options = {}) {
  return {
    type: templet.STAT_TYPE_1 || options.statType || "NST_HP",
    value: Number(templet.STAT_VALUE_1 || options.statValue || 0),
    levelValue: Number(templet.STAT_LEVELUP_VALUE_1 || options.statLevelValue || 0),
  };
}

function buildCustomMainStat(templet, mainStat) {
  const defaultStatType = normalizeStatType(templet && templet.STAT_TYPE_1) || "NST_HP";
  const usesDefaultType = isDefaultMainStatType(mainStat && mainStat.type);
  const statType = usesDefaultType ? defaultStatType : normalizeStatType(mainStat && mainStat.type) || defaultStatType;
  const templetMatches = usesDefaultType || normalizeStatType(templet && templet.STAT_TYPE_1) === statType;
  const valueFallback = templetMatches
    ? finiteNumber(templet && templet.STAT_VALUE_1, maxMainStatValueForType(statType))
    : maxMainStatValueForType(statType);
  const levelFallback = templetMatches
    ? finiteNumber(templet && templet.STAT_LEVELUP_VALUE_1, maxMainStatLevelValueForType(statType))
    : maxMainStatLevelValueForType(statType);
  return {
    type: statType,
    value: mainStat && mainStat.valueKind === "max" ? valueFallback : finiteNumber(mainStat && mainStat.value, valueFallback),
    levelValue:
      mainStat && (mainStat.levelValueKind === "max" || mainStat.levelValue == null)
        ? levelFallback
        : finiteNumber(mainStat && mainStat.levelValue, levelFallback),
  };
}

function statForType(statType, _groupId = 0, record = null) {
  const data = record || {};
  const min = Number(data.m_MinStatValue != null ? data.m_MinStatValue : data.m_MinStat || 0.01);
  const max = Number(data.m_MaxStatValue != null ? data.m_MaxStatValue : data.m_MaxStat || min || 0.01);
  return {
    type: String(statType || "NST_HP"),
    value: Number.isFinite(max) ? max : min,
    levelValue: 0,
  };
}

function normalizeCustomMainStat(mainStat) {
  if (!mainStat || typeof mainStat !== "object") return null;
  const type = isDefaultMainStatType(mainStat.type) ? "DEFAULT" : normalizeStatType(mainStat.type);
  if (!type) return null;
  const normalized = {
    type,
    value: mainStat.valueKind === "max" ? null : finiteNumber(mainStat.value, 0),
    valueKind: mainStat.valueKind === "max" ? "max" : "custom",
  };
  if (mainStat.levelValueKind === "max") {
    normalized.levelValueKind = "max";
    normalized.levelValue = null;
  } else if (mainStat.levelValue != null) {
    normalized.levelValueKind = "custom";
    normalized.levelValue = finiteNumber(mainStat.levelValue, 0);
  }
  return normalized;
}

function isDefaultMainStatType(value) {
  return ["DEFAULT", "NATIVE", "ORIGINAL"].includes(String(value || "").trim().toUpperCase());
}

function buildCustomSubstat(groupId, substat, options = {}) {
  const statType = normalizeStatType(substat && substat.type);
  const record = findStatRecord(groupId, statType);
  if (!record && options.overrideUnsupportedSubstats !== true) return null;
  const value = substat && substat.valueKind === "max"
    ? maxStatValueForType(statType, record)
    : finiteNumber(substat && substat.value, maxStatValueForType(statType, record));
  return {
    type: statType,
    value,
    levelValue: finiteNumber(substat && substat.levelValue, 0),
  };
}

function normalizeCustomSubstats(substats) {
  const list = Array.isArray(substats) ? substats : [];
  return list
    .map((substat, index) => {
      const type = normalizeStatType(substat && substat.type);
      if (!type) return null;
      return {
        slot: normalizeSubstatSlot(substat.slot != null ? substat.slot : index + 1),
        type,
        value: substat && substat.valueKind === "max" ? null : finiteNumber(substat && substat.value, 0),
        valueKind: substat && substat.valueKind === "max" ? "max" : "custom",
        levelValue: finiteNumber(substat && substat.levelValue, 0),
      };
    })
    .filter(Boolean)
    .slice(0, 2);
}

function normalizeStatType(statType) {
  const text = String(statType || "").trim().toUpperCase();
  if (!text) return "";
  return text.startsWith("NST_") ? text : `NST_${text}`;
}

function normalizeSubstatSlot(slot) {
  return Number(slot) === 2 ? 2 : 1;
}

function findStatRecord(groupId, statType) {
  const normalized = normalizeStatType(statType);
  return getEquipRandomStatRecords(groupId).find((record) => normalizeStatType(record && record.m_StatType) === normalized) || null;
}

function maxStatValueForType(statType, preferredRecord = null) {
  const direct = statMaxValue(preferredRecord);
  if (direct != null) return direct;
  const normalized = normalizeStatType(statType);
  const records = getAllEquipRandomStatRecords().filter((record) => normalizeStatType(record && record.m_StatType) === normalized);
  const values = records.map(statMaxValue).filter((value) => value != null);
  if (values.length) return Math.max(...values);
  return normalized.includes("RATE") ? 0.1 : 100;
}

function maxMainStatValueForType(statType) {
  return maxMainStatFieldForType(statType, "STAT_VALUE_1");
}

function maxMainStatLevelValueForType(statType) {
  return maxMainStatFieldForType(statType, "STAT_LEVELUP_VALUE_1");
}

function maxMainStatFieldForType(statType, fieldName) {
  const normalized = normalizeStatType(statType);
  const values = getAllEquipIds()
    .map((equipId) => getEquipTemplet(equipId))
    .filter((record) => normalizeStatType(record && record.STAT_TYPE_1) === normalized)
    .map((record) => Number(record && record[fieldName]))
    .filter((value) => Number.isFinite(value));
  if (values.length) return Math.max(...values);
  return normalized.includes("RATE") ? 0.1 : 100;
}

function statMaxValue(record) {
  if (!record) return null;
  const value = Number(record.m_MaxStatValue != null ? record.m_MaxStatValue : record.m_MaxStat);
  return Number.isFinite(value) ? value : null;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function rollFallbackStat(cursor = 0) {
  const type = DEFAULT_STAT_TYPES[Math.abs(Number(cursor) || 0) % DEFAULT_STAT_TYPES.length];
  return { type, value: type.includes("RATE") ? 0.1 : 100, levelValue: 0 };
}

function pickSetOptionId(templet, cursor = 0) {
  const ids = getEquipSetOptionIds(templet);
  if (!ids.length) return 0;
  return ids[Math.abs(Number(cursor) || 0) % ids.length];
}

function buildDefaultPotentialOptions(templet) {
  if (!templet || templet.m_bRelic !== true) return [];
  return [buildDefaultPotentialOption({ itemEquipId: templet.m_ItemEquipID })];
}

function buildDefaultPotentialOption(equip) {
  const stat = (equip.stats && equip.stats[1]) || rollFallbackStat(1);
  return {
    optionKey: Number((getEquipTemplet(equip.itemEquipId) || {}).m_PotentialOptionGroupID || 0),
    statType: stat.type,
    sockets: [null, null, null],
    precisionChangeCount: 0,
  };
}

function inferEquipPosition(equip) {
  const templet = getEquipTemplet(equip && equip.itemEquipId) || {};
  return EQUIP_POSITION_INDEX[String(templet.m_ItemEquipPosition || "")] != null
    ? EQUIP_POSITION_INDEX[String(templet.m_ItemEquipPosition || "")]
    : 0;
}

function normalizePosition(position) {
  const numeric = Number(position);
  return Number.isInteger(numeric) && numeric >= 0 && numeric <= 3 ? numeric : 0;
}

function normalizeOptionSlot(optionId) {
  const numeric = Number(optionId);
  if (numeric === 2) return 2;
  return 1;
}

function getUnitByUid(army, unitUid) {
  const key = String(toBigInt(unitUid));
  return army.units[key] || army.ships[key] || null;
}

function findEquipOwnerUnit(army, equipUid) {
  const key = String(toBigInt(equipUid));
  for (const unit of [...Object.values(army.units || {}), ...Object.values(army.ships || {})]) {
    if (!unit || !Array.isArray(unit.equipItemUids)) continue;
    const position = unit.equipItemUids.findIndex((uid) => String(toBigInt(uid)) === key);
    if (position >= 0) return { unit, position };
  }
  return null;
}

function unequipFromAnyUnit(army, equipUid) {
  const key = String(toBigInt(equipUid));
  for (const unit of [...Object.values(army.units || {}), ...Object.values(army.ships || {})]) {
    if (!unit || !Array.isArray(unit.equipItemUids)) continue;
    unit.equipItemUids = unit.equipItemUids.map((uid) => (String(toBigInt(uid)) === key ? 0 : uid));
  }
}

function allocateEquipUid(user) {
  const inventory = ensureEquipInventory(user);
  let next = toBigInt(user.nextEquipUid, DEFAULT_NEXT_EQUIP_UID);
  while (inventory.equips[next.toString()]) next += 1n;
  user.nextEquipUid = String(next + 1n);
  return next;
}

function normalizeEquipPresets(inventory) {
  inventory.equipPresets = (Array.isArray(inventory.equipPresets) ? inventory.equipPresets : []).map((preset, index) => ({
    presetIndex: Number(preset && preset.presetIndex != null ? preset.presetIndex : index) || index,
    presetType: Number(preset && preset.presetType || 0) || 0,
    presetName: String((preset && (preset.presetName || preset.name)) || ""),
    equipUids: normalizeFixedArray(preset && preset.equipUids, 4, 0),
  }));
  if (!inventory.equipPresets.length) {
    inventory.equipPresets.push({ presetIndex: 0, presetType: 0, presetName: "", equipUids: [0, 0, 0, 0] });
  }
  inventory.equipPresets.forEach((preset, index) => {
    preset.presetIndex = index;
  });
}

function markInventoryTouched(inventory) {
  if (inventory && typeof inventory === "object") inventory.localTouchedAt = new Date().toISOString();
}

function normalizeFixedArray(values, length, fallback) {
  const result = Array.isArray(values) ? values.slice(0, length) : [];
  while (result.length < length) result.push(fallback);
  return result;
}

module.exports = {
  ensureEquipInventory,
  getEquipItems,
  getEquipItem,
  grantEquipItem,
  createEquipData,
  validateEquipCustomSubstats,
  removeEquipItems,
  equipItemToUnit,
  unequipItem,
  lockEquipItem,
  enchantEquipItem,
  rollEquipPrecision,
  rollEquipSubstat,
  confirmEquipSubstat,
  cancelEquipTuning,
  rollSetOption,
  confirmSetOption,
  imprintEquip,
  openPotentialSocket,
  rollPotentialOption,
  confirmPotentialOption,
  getEquipPresets,
  addEquipPresets,
  ensureEquipPreset,
  setEquipPresetName,
  registerEquipPreset,
  registerEquipPresetFromUnit,
  applyEquipPreset,
  clearEquipPresets,
  changeEquipPresetIndices,
};
