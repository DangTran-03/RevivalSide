const { dateTimeBinaryNow, toBigInt } = require("../packet-codec");

const DEFAULT_MAX_USER_LEVEL = Number(process.env.CS_MAX_USER_LEVEL || 120);
const DEFAULT_MISSION_EXP = Number(process.env.CS_DEFAULT_MISSION_EXP || 50);
const DEFAULT_STAGE_EXP = Number(process.env.CS_DEFAULT_STAGE_EXP || 75);
const DEFAULT_ACHIEVEMENT_POINT = Number(process.env.CS_DEFAULT_ACHIEVEMENT_POINT || 10);
const DEFAULT_PROFILE_EMBLEM_SLOTS = Number(process.env.CS_PROFILE_EMBLEM_SLOTS || 3);

function ensureAccountProgress(user) {
  if (!user || typeof user !== "object") return user;
  user.level = clampInt(user.level, 1, DEFAULT_MAX_USER_LEVEL);
  user.exp = String(nonNegativeInt(user.exp));
  user.totalExp = String(nonNegativeBigInt(user.totalExp));
  user.achievePoint = String(nonNegativeBigInt(user.achievePoint));
  user.completedMissions =
    user.completedMissions && typeof user.completedMissions === "object" ? user.completedMissions : {};
  user.profileEmblems = normalizeEmblems(user.profileEmblems);
  user.friendIntro = String(user.friendIntro || "");
  user.selfiFrameId = Number(user.selfiFrameId || user.frameId || 0) || 0;
  user.frameId = Number(user.frameId || user.selfiFrameId || 0) || 0;
  user.titleId = Number(user.titleId || 0) || 0;
  user.mainUnitId = Number(user.mainUnitId || 0) || 0;
  user.mainUnitSkinId = Number(user.mainUnitSkinId || 0) || 0;
  user.mainUnitTacticLevel = Number(user.mainUnitTacticLevel || 0) || 0;
  return user;
}

function grantUserExp(user, amount, options = {}) {
  ensureAccountProgress(user);
  const grant = nonNegativeInt(amount);
  if (!user || grant <= 0) {
    return {
      userExp: 0,
      beforeLevel: user ? Number(user.level || 1) : 1,
      afterLevel: user ? Number(user.level || 1) : 1,
      beforeExp: user ? nonNegativeInt(user.exp) : 0,
      afterExp: user ? nonNegativeInt(user.exp) : 0,
      leveledUp: false,
    };
  }

  const beforeLevel = clampInt(user.level, 1, DEFAULT_MAX_USER_LEVEL);
  const beforeExp = nonNegativeInt(user.exp);
  let level = beforeLevel;
  let exp = beforeExp + grant;

  while (level < DEFAULT_MAX_USER_LEVEL) {
    const required = expToNextLevel(level);
    if (exp < required) break;
    exp -= required;
    level += 1;
  }

  if (level >= DEFAULT_MAX_USER_LEVEL) {
    level = DEFAULT_MAX_USER_LEVEL;
    exp = Math.min(exp, expToNextLevel(level) - 1);
  }

  user.level = level;
  user.exp = String(exp);
  user.totalExp = String(nonNegativeBigInt(user.totalExp) + BigInt(grant));
  if (options.reason) user.lastExpReason = String(options.reason);
  user.lastExpAt = new Date().toISOString();

  return {
    userExp: grant,
    beforeLevel,
    afterLevel: level,
    beforeExp,
    afterExp: exp,
    leveledUp: level > beforeLevel,
  };
}

function expToNextLevel(level) {
  const current = Math.max(1, Number(level) || 1);
  return Math.max(100, 100 + (current - 1) * 50);
}

function completeMission(user, request = {}, options = {}) {
  ensureAccountProgress(user);
  const missionID = Number(request.missionID || request.missionId || request.id || 0);
  if (!user || !Number.isInteger(missionID) || missionID <= 0) {
    return emptyMissionResult(request);
  }

  const tabId = Number(request.tabId || request.tabID || 1) || 1;
  const groupId = Number(request.groupId || request.groupID || missionID) || missionID;
  const existing = user.completedMissions[String(missionID)] || {};
  const now = String(options.now || dateTimeBinaryNow());
  const times = Math.max(Number(existing.times || 0), Number(request.times || options.times || 1));
  const firstClaim = existing.rewardClaimed !== true;
  const expGrant = firstClaim ? nonNegativeInt(options.exp != null ? options.exp : DEFAULT_MISSION_EXP) : 0;
  const achievementPoint = firstClaim
    ? nonNegativeBigInt(options.achievePoint != null ? options.achievePoint : defaultMissionAchievementPoint(tabId))
    : 0n;
  const expResult = grantUserExp(user, expGrant, { reason: `mission:${missionID}` });

  user.completedMissions[String(missionID)] = {
    tabId,
    groupId,
    missionID,
    times,
    lastUpdateDate: now,
    isComplete: true,
    rewardClaimed: true,
    completedAt: existing.completedAt || new Date().toISOString(),
    claimedAt: new Date().toISOString(),
  };

  if (achievementPoint > 0n) {
    user.achievePoint = String(nonNegativeBigInt(user.achievePoint) + achievementPoint);
  }

  return {
    missionID,
    tabId,
    groupId,
    changed: firstClaim,
    exp: expResult,
    reward: {
      userExp: expGrant,
      bonusRatioOfUserExp: 0,
      achievePoint: achievementPoint.toString(),
    },
  };
}

function completeAllMissionsForTab(user, tabId, options = {}) {
  ensureAccountProgress(user);
  const numericTabId = Number(tabId || 0);
  if (!user || !Number.isInteger(numericTabId) || numericTabId <= 0) {
    return { missionIDs: [], reward: emptyReward() };
  }

  const missions = Object.values(user.completedMissions || {}).filter(
    (mission) => Number(mission && mission.tabId) === numericTabId && mission.rewardClaimed !== true
  );
  const missionIDs = [];
  const reward = emptyReward();
  for (const mission of missions) {
    const result = completeMission(user, mission, options);
    if (!result.missionID) continue;
    missionIDs.push(result.missionID);
    reward.userExp += Number(result.reward.userExp || 0);
    reward.achievePoint = String(nonNegativeBigInt(reward.achievePoint) + nonNegativeBigInt(result.reward.achievePoint));
  }
  return { missionIDs, reward };
}

function updateMissionProgress(user, request = {}, options = {}) {
  ensureAccountProgress(user);
  const missionID = Number(request.missionID || request.missionId || request.id || 0);
  if (!user || !Number.isInteger(missionID) || missionID <= 0) return null;
  const existing = user.completedMissions[String(missionID)] || {};
  const tabId = Number(request.tabId || existing.tabId || options.tabId || 1) || 1;
  const groupId = Number(request.groupId || existing.groupId || options.groupId || missionID) || missionID;
  const times = Math.max(Number(existing.times || 0), Number(request.times || options.times || 1));
  const mission = {
    tabId,
    groupId,
    missionID,
    times,
    lastUpdateDate: String(options.now || dateTimeBinaryNow()),
    isComplete: Boolean(options.isComplete != null ? options.isComplete : existing.isComplete),
    rewardClaimed: Boolean(existing.rewardClaimed),
    completedAt: existing.completedAt || "",
    claimedAt: existing.claimedAt || "",
  };
  user.completedMissions[String(missionID)] = mission;
  return mission;
}

function grantStageClearExp(user, stageId, dungeonId, options = {}) {
  const amount = nonNegativeInt(options.exp != null ? options.exp : DEFAULT_STAGE_EXP);
  return grantUserExp(user, amount, { reason: `stage:${Number(stageId || 0)}:${Number(dungeonId || 0)}` });
}

function buildMissionDataEntries(user) {
  ensureAccountProgress(user);
  return Object.entries(user.completedMissions || {})
    .map(([key, mission]) => {
      const missionId = Number((mission && mission.missionID) || key);
      if (!Number.isInteger(missionId) || missionId <= 0) return null;
      const groupId = Number((mission && mission.groupId) || missionId);
      return [groupId, mission];
    })
    .filter(Boolean);
}

function getAchievePoint(user) {
  ensureAccountProgress(user);
  return nonNegativeBigInt(user && user.achievePoint);
}

function setProfileMainUnit(user, unitId, skinId = 0, tacticLevel = 0) {
  ensureAccountProgress(user);
  user.mainUnitId = Math.max(0, Number(unitId) || 0);
  user.mainUnitSkinId = Math.max(0, Number(skinId) || 0);
  user.mainUnitTacticLevel = Math.max(0, Number(tacticLevel) || 0);
}

function setProfileIntro(user, intro) {
  ensureAccountProgress(user);
  user.friendIntro = String(intro || "").slice(0, 80);
}

function setProfileFrame(user, frameId) {
  ensureAccountProgress(user);
  user.selfiFrameId = Math.max(0, Number(frameId) || 0);
  user.frameId = user.selfiFrameId;
}

function setProfileTitle(user, titleId) {
  ensureAccountProgress(user);
  user.titleId = Math.max(0, Number(titleId) || 0);
}

function setProfileEmblem(user, index, itemId, count = 1) {
  ensureAccountProgress(user);
  const slot = Math.max(0, Math.min(DEFAULT_PROFILE_EMBLEM_SLOTS - 1, Number(index) || 0));
  const emblems = normalizeEmblems(user.profileEmblems);
  emblems[slot] = {
    id: Math.max(0, Number(itemId) || 0),
    count: String(nonNegativeBigInt(count || 1)),
  };
  user.profileEmblems = emblems;
  return { index: slot, itemId: emblems[slot].id, count: emblems[slot].count };
}

function normalizeEmblems(values) {
  const source = Array.isArray(values) ? values : [];
  const result = source.slice(0, DEFAULT_PROFILE_EMBLEM_SLOTS).map((entry) => ({
    id: Math.max(0, Number(entry && entry.id) || 0),
    count: String(nonNegativeBigInt(entry && entry.count != null ? entry.count : 0)),
  }));
  while (result.length < DEFAULT_PROFILE_EMBLEM_SLOTS) result.push({ id: 0, count: "0" });
  return result;
}

function emptyMissionResult(request = {}) {
  return {
    missionID: Number(request.missionID || 0) || 0,
    tabId: Number(request.tabId || 1) || 1,
    groupId: Number(request.groupId || request.missionID || 0) || 0,
    changed: false,
    exp: { userExp: 0 },
    reward: emptyReward(),
  };
}

function emptyReward() {
  return { userExp: 0, bonusRatioOfUserExp: 0, achievePoint: "0" };
}

function defaultMissionAchievementPoint(tabId) {
  const numericTabId = Number(tabId || 0);
  return numericTabId > 0 ? DEFAULT_ACHIEVEMENT_POINT : 0;
}

function clampInt(value, min, max) {
  const numeric = Math.trunc(Number(value));
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
}

function nonNegativeInt(value) {
  const numeric = Math.trunc(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function nonNegativeBigInt(value) {
  const number = toBigInt(value, 0n);
  return number > 0n ? number : 0n;
}

module.exports = {
  DEFAULT_MISSION_EXP,
  DEFAULT_STAGE_EXP,
  DEFAULT_ACHIEVEMENT_POINT,
  ensureAccountProgress,
  grantUserExp,
  grantStageClearExp,
  completeMission,
  completeAllMissionsForTab,
  updateMissionProgress,
  buildMissionDataEntries,
  getAchievePoint,
  setProfileMainUnit,
  setProfileIntro,
  setProfileFrame,
  setProfileTitle,
  setProfileEmblem,
  expToNextLevel,
};
