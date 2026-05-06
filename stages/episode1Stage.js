const { TUTORIAL_STAGE_CHAIN } = require("./tutorialStage");

const DEFAULT_EPISODE_RUNTIME = Object.freeze({
  gameUnitUIDIndex: 30,
  initialGameTime: 4,
  initialRemainGameTime: 180,
  respawnCostA1: 10,
  respawnCostB1: 10,
  gameState: Object.freeze({
    state: 3,
    winTeam: 0,
    waveId: 1,
  }),
  teamA: Object.freeze({
    units: Object.freeze([]),
  }),
  teamB: Object.freeze({
    units: Object.freeze([]),
  }),
  deployableGameUnitUIDGroups: Object.freeze([
    Object.freeze([5, 6]),
    Object.freeze([8, 9]),
    Object.freeze([10, 11]),
    Object.freeze([12, 13]),
    Object.freeze([14, 15]),
    Object.freeze([16, 17]),
    Object.freeze([18, 19]),
    Object.freeze([20, 21]),
  ]),
  autoDeployUnits: Object.freeze([]),
});

function tutorialStage(stage, actId, stageIndex) {
  return Object.freeze({
    ...stage,
    episodeId: 2,
    actId,
    stageIndex,
    tutorial: true,
    cutsceneOnly: false,
  });
}

function battleStage(data) {
  return Object.freeze({
    episodeId: 2,
    eventDeckId: 0,
    tutorial: false,
    cutsceneOnly: false,
    ...data,
  });
}

function cutsceneStage(data) {
  return Object.freeze({
    episodeId: 2,
    eventDeckId: 0,
    mapID: 0,
    mapStrID: "",
    tutorial: false,
    cutsceneOnly: true,
    ...data,
  });
}

const EPISODE1_STAGE_CHAIN = Object.freeze([
  tutorialStage(TUTORIAL_STAGE_CHAIN[0], 1, 1),
  tutorialStage(TUTORIAL_STAGE_CHAIN[1], 1, 2),
  tutorialStage(TUTORIAL_STAGE_CHAIN[2], 1, 3),
  tutorialStage(TUTORIAL_STAGE_CHAIN[3], 1, 4),
  battleStage({
    stageId: 11222,
    stageStrID: "STAGE_MAINSTREAM_11222",
    dungeonID: 1001211,
    dungeonStrID: "NKM_MAIN_BATTLE_EP1_2_1_HARD_BOSS_A",
    mapID: 1010,
    mapStrID: "AB_MAP_GAME_COUNTERSIDE_RUIN",
    actId: 2,
    stageIndex: 1,
  }),
  battleStage({
    stageId: 11223,
    stageStrID: "STAGE_MAINSTREAM_11223",
    dungeonID: 1001221,
    dungeonStrID: "NKM_MAIN_BATTLE_EP1_2_2_HARD_BOSS_A",
    mapID: 1010,
    mapStrID: "AB_MAP_GAME_COUNTERSIDE_RUIN",
    actId: 2,
    stageIndex: 2,
  }),
  battleStage({
    stageId: 11224,
    stageStrID: "STAGE_MAINSTREAM_11224",
    dungeonID: 1001231,
    dungeonStrID: "NKM_MAIN_BATTLE_EP1_2_3_HARD_BOSS_A",
    mapID: 1010,
    mapStrID: "AB_MAP_GAME_COUNTERSIDE_RUIN",
    actId: 2,
    stageIndex: 3,
  }),
  battleStage({
    stageId: 11225,
    stageStrID: "STAGE_MAINSTREAM_11225",
    dungeonID: 1001241,
    dungeonStrID: "NKM_MAIN_BATTLE_EP1_2_4_ACT_BOSS_A",
    eventDeckId: 1001241,
    mapID: 1010,
    mapStrID: "AB_MAP_GAME_COUNTERSIDE_RUIN",
    actId: 2,
    stageIndex: 4,
  }),
  battleStage({
    stageId: 11231,
    stageStrID: "STAGE_MAINSTREAM_11231",
    dungeonID: 1001311,
    dungeonStrID: "NKM_MAIN_BATTLE_EP1_3_1_HARD_BOSS_A",
    mapID: 1010,
    mapStrID: "AB_MAP_GAME_COUNTERSIDE_RUIN",
    actId: 3,
    stageIndex: 1,
  }),
  battleStage({
    stageId: 11232,
    stageStrID: "STAGE_MAINSTREAM_11232",
    dungeonID: 1001321,
    dungeonStrID: "NKM_MAIN_BATTLE_EP1_3_2_HARD_BOSS_A",
    mapID: 1010,
    mapStrID: "AB_MAP_GAME_COUNTERSIDE_RUIN",
    actId: 3,
    stageIndex: 2,
  }),
  battleStage({
    stageId: 11233,
    stageStrID: "STAGE_MAINSTREAM_11233",
    dungeonID: 1001332,
    dungeonStrID: "NKM_MAIN_BATTLE_EP1_3_3_MEDIUM_BOSS_B",
    mapID: 1010,
    mapStrID: "AB_MAP_GAME_COUNTERSIDE_RUIN",
    actId: 3,
    stageIndex: 3,
  }),
  battleStage({
    stageId: 11234,
    stageStrID: "STAGE_MAINSTREAM_11234",
    dungeonID: 1001341,
    dungeonStrID: "NKM_MAIN_BATTLE_EP1_3_4_ACT_BOSS_A",
    mapID: 1010,
    mapStrID: "AB_MAP_GAME_COUNTERSIDE_RUIN",
    actId: 3,
    stageIndex: 4,
  }),
  cutsceneStage({
    stageId: 11235,
    stageStrID: "STAGE_MAINSTREAM_11235",
    dungeonID: 10104,
    dungeonStrID: "NKM_DUNGEON_EP1_ACT3_INTERLUDE",
    actId: 3,
    stageIndex: 5,
  }),
  battleStage({
    stageId: 11241,
    stageStrID: "STAGE_MAINSTREAM_11241",
    dungeonID: 1001411,
    dungeonStrID: "NKM_MAIN_BATTLE_EP1_4_1_HARD_BOSS_A",
    mapID: 1036,
    mapStrID: "AB_MAP_GAME_COUNTERSIDE_ANCIENT",
    actId: 4,
    stageIndex: 1,
  }),
  battleStage({
    stageId: 11242,
    stageStrID: "STAGE_MAINSTREAM_11242",
    dungeonID: 1001421,
    dungeonStrID: "NKM_MAIN_BATTLE_EP1_4_2_HARD_BOSS_A",
    mapID: 1036,
    mapStrID: "AB_MAP_GAME_COUNTERSIDE_ANCIENT",
    actId: 4,
    stageIndex: 2,
  }),
  battleStage({
    stageId: 11243,
    stageStrID: "STAGE_MAINSTREAM_11243",
    dungeonID: 1001431,
    dungeonStrID: "NKM_MAIN_BATTLE_EP1_4_3_HARD_BOSS_A",
    mapID: 1036,
    mapStrID: "AB_MAP_GAME_COUNTERSIDE_ANCIENT",
    actId: 4,
    stageIndex: 3,
  }),
  battleStage({
    stageId: 11244,
    stageStrID: "STAGE_MAINSTREAM_11244",
    dungeonID: 1001441,
    dungeonStrID: "NKM_MAIN_BATTLE_EP1_4_4_EP_BOSS_A",
    mapID: 1036,
    mapStrID: "AB_MAP_GAME_COUNTERSIDE_ANCIENT",
    actId: 4,
    stageIndex: 4,
  }),
  cutsceneStage({
    stageId: 11245,
    stageStrID: "STAGE_MAINSTREAM_11245",
    dungeonID: 10105,
    dungeonStrID: "NKM_DUNGEON_EP1_ACT4_EPLIOGUE",
    actId: 4,
    stageIndex: 5,
  }),
]);

const EPISODE1_STAGE_BY_STAGE_ID = new Map(EPISODE1_STAGE_CHAIN.map((stage) => [stage.stageId, stage]));
const EPISODE1_STAGE_BY_DUNGEON_ID = new Map(EPISODE1_STAGE_CHAIN.map((stage) => [stage.dungeonID, stage]));

function cloneUnit(unit, team) {
  return {
    ...unit,
    team,
    maxHp: unit.hp,
    targetUID: 0,
    subTargetUID: 0,
    speedX: 0,
    speedY: 0,
    speedZ: 0,
    savedPosX: unit.x,
  };
}

function cloneStage(stage) {
  if (!stage) return null;
  return {
    ...DEFAULT_EPISODE_RUNTIME,
    ...stage,
    gameState: { ...(stage.gameState || DEFAULT_EPISODE_RUNTIME.gameState) },
    teamA: {
      units: (stage.teamA && stage.teamA.units ? stage.teamA.units : []).map((unit) => ({ ...unit })),
    },
    teamB: {
      units: (stage.teamB && stage.teamB.units ? stage.teamB.units : []).map((unit) => ({ ...unit })),
    },
    deployableGameUnitUIDGroups: (stage.deployableGameUnitUIDGroups || DEFAULT_EPISODE_RUNTIME.deployableGameUnitUIDGroups).map((group) =>
      group.slice()
    ),
    autoDeployUnits: (stage.autoDeployUnits || []).map((unit) => ({
      ...unit,
      gameUnitUIDs: unit.gameUnitUIDs.slice(),
    })),
    initialUnits: [
      ...(stage.teamA && stage.teamA.units ? stage.teamA.units : []).map((unit) => cloneUnit(unit, 1)),
      ...(stage.teamB && stage.teamB.units ? stage.teamB.units : []).map((unit) => cloneUnit(unit, 3)),
    ],
  };
}

function getEpisode1StageByStageId(stageId) {
  const stage = EPISODE1_STAGE_BY_STAGE_ID.get(Number(stageId));
  return stage ? cloneStage(stage) : null;
}

function getEpisode1StageByDungeonId(dungeonId) {
  const stage = EPISODE1_STAGE_BY_DUNGEON_ID.get(Number(dungeonId));
  return stage ? cloneStage(stage) : null;
}

function getEpisode1StageForRequest(req) {
  if (!req) return null;
  return getEpisode1StageByStageId(req.stageID) || getEpisode1StageByDungeonId(req.dungeonID);
}

function isEpisode1StageId(stageId) {
  return EPISODE1_STAGE_BY_STAGE_ID.has(Number(stageId));
}

function isEpisode1DungeonId(dungeonId) {
  return EPISODE1_STAGE_BY_DUNGEON_ID.has(Number(dungeonId));
}

function isEpisode1CutsceneDungeonId(dungeonId) {
  const stage = EPISODE1_STAGE_BY_DUNGEON_ID.get(Number(dungeonId));
  return Boolean(stage && stage.cutsceneOnly);
}

function mapIdForStageDungeon(stageId, dungeonId) {
  const stage = EPISODE1_STAGE_BY_STAGE_ID.get(Number(stageId)) || EPISODE1_STAGE_BY_DUNGEON_ID.get(Number(dungeonId));
  return stage && Number(stage.mapID) > 0 ? stage.mapID : 0;
}

function stageIdForDungeonId(dungeonId) {
  const stage = EPISODE1_STAGE_BY_DUNGEON_ID.get(Number(dungeonId));
  return stage ? stage.stageId : 0;
}

function tutorialPhaseKey(stage) {
  return String(stage && (stage.dungeonID || stage.dungeonId || stage.stageId || ""));
}

function getTutorialPhaseForStage(user, stage) {
  const tutorial = user && user.tutorial && typeof user.tutorial === "object" ? user.tutorial : null;
  const phases = tutorial && tutorial.phases && typeof tutorial.phases === "object" ? tutorial.phases : null;
  if (!phases) return null;
  return phases[tutorialPhaseKey(stage)] || phases[String(stage.stageId)] || null;
}

function isTutorialCompleteForEpisode(user) {
  const tutorial = user && user.tutorial && typeof user.tutorial === "object" ? user.tutorial : null;
  if (!tutorial || tutorial.enabled === false) return true;
  if (tutorial.completed === true) return true;
  const phases = tutorial.phases && typeof tutorial.phases === "object" ? tutorial.phases : null;
  if (!phases) return false;
  return TUTORIAL_STAGE_CHAIN.every((stage) => {
    const phase = phases[tutorialPhaseKey(stage)] || phases[String(stage.stageId)];
    return phase && phase.completed === true;
  });
}

function repairRewardedEpisodeClears(user) {
  const cursors = user && user.localStageRewardCursors && typeof user.localStageRewardCursors === "object" ? user.localStageRewardCursors : {};
  for (const stage of EPISODE1_STAGE_CHAIN) {
    if (!stage || stage.tutorial) continue;
    const dungeonKey = String(stage.dungeonID);
    const stageKey = String(stage.stageId);
    const previousClear = user.dungeonClear[dungeonKey] || null;
    const previousPlay = user.stagePlayData[stageKey] || null;
    const existing = user.episode1.stages[stageKey] || {};
    const rewardClearCount = Math.max(0, Math.trunc(Number(cursors[`credit:${stage.dungeonID}`] || 0) || 0));
    if (!previousClear && !previousPlay && existing.completed !== true && rewardClearCount <= 0) continue;

    const completedAt = existing.completedAt || new Date().toISOString();
    user.dungeonClear[dungeonKey] = {
      ...(previousClear || {}),
      dungeonId: stage.dungeonID,
      stageId: stage.stageId,
      missionResult1: true,
      missionResult2: true,
      clearedAt: completedAt,
    };

    if (!previousPlay && existing.completed !== true && rewardClearCount <= 0) continue;
    user.stagePlayData[stageKey] = {
      ...(previousPlay || {}),
      stageId: Number((previousPlay && previousPlay.stageId) || stage.stageId),
      playCount: Math.max(1, Number((previousPlay && previousPlay.playCount) || 0), rewardClearCount),
      totalPlayCount: Math.max(1, Number((previousPlay && previousPlay.totalPlayCount) || 0), rewardClearCount),
      bestClearTimeSec: Number((previousPlay && previousPlay.bestClearTimeSec) || existing.bestClearTimeSec || 0),
    };
  }
}

function ensureEpisode1State(user) {
  if (!user || typeof user !== "object") return null;
  user.episode1 = user.episode1 && typeof user.episode1 === "object" ? user.episode1 : {};
  user.episode1.stages = user.episode1.stages && typeof user.episode1.stages === "object" ? user.episode1.stages : {};
  user.unlockedStageIds = Array.isArray(user.unlockedStageIds) ? user.unlockedStageIds : [];
  const existingUnlocked = new Set(user.unlockedStageIds.map(Number).filter((id) => Number.isInteger(id) && id > 0));
  const unlocked = new Set([...existingUnlocked].filter((id) => !EPISODE1_STAGE_BY_STAGE_ID.has(id)));
  user.dungeonClear = user.dungeonClear && typeof user.dungeonClear === "object" ? user.dungeonClear : {};
  user.stagePlayData = user.stagePlayData && typeof user.stagePlayData === "object" ? user.stagePlayData : {};
  repairRewardedEpisodeClears(user);
  const dungeonClear = user.dungeonClear;
  const stagePlayData = user.stagePlayData;
  const tutorialComplete = isTutorialCompleteForEpisode(user);
  let previousTutorialPhaseComplete = true;
  let nextPostTutorialStageUnlocked = tutorialComplete;

  for (const stage of EPISODE1_STAGE_CHAIN) {
    const existing = user.episode1.stages[String(stage.stageId)] || {};
    const clear = dungeonClear[String(stage.dungeonID)];
    const play = stagePlayData[String(stage.stageId)];
    const phase = stage.tutorial ? getTutorialPhaseForStage(user, stage) : null;
    const tutorialPhaseComplete = Boolean(tutorialComplete || (phase && phase.completed === true));
    const completed = stage.tutorial ? tutorialPhaseComplete || Boolean(clear) : Boolean(clear) || Boolean(play) || existing.completed === true;
    const hasLocalProgress = Boolean(clear) || Boolean(play) || completed;
    const stageUnlocked = stage.tutorial ? previousTutorialPhaseComplete || completed : nextPostTutorialStageUnlocked || hasLocalProgress;

    if (stageUnlocked) unlocked.add(stage.stageId);
    if (stage.tutorial) previousTutorialPhaseComplete = completed;
    else nextPostTutorialStageUnlocked = completed;

    const stageState = {
      episodeId: 2,
      actId: stage.actId,
      stageIndex: stage.stageIndex,
      stageId: stage.stageId,
      dungeonId: stage.dungeonID,
      stageStrID: stage.stageStrID,
      dungeonStrID: stage.dungeonStrID,
      mapID: stage.mapID,
      cutsceneOnly: Boolean(stage.cutsceneOnly),
      unlocked: stageUnlocked,
      completed,
      completedAt: completed ? existing.completedAt || (clear && clear.clearedAt) || "" : "",
      bestClearTimeSec: completed ? Number(existing.bestClearTimeSec || (play && play.bestClearTimeSec) || 0) : 0,
      missionResult1: completed ? (clear ? clear.missionResult1 !== false : existing.missionResult1 !== false) : false,
      missionResult2: completed ? (clear ? clear.missionResult2 !== false : existing.missionResult2 !== false) : false,
    };
    user.episode1.stages[String(stage.stageId)] = stageState;
    if (completed) backfillCompletedEpisodeStageState(user, stage, stageState);
  }

  user.unlockedStageIds = Array.from(unlocked).sort((a, b) => a - b);
  user.episode1.unlocked = true;
  user.episode1.completed = EPISODE1_STAGE_CHAIN.every((stage) => {
    const state = user.episode1.stages[String(stage.stageId)];
    return state && state.completed === true;
  });
  return user.episode1;
}

function backfillCompletedEpisodeStageState(user, stage, state) {
  const dungeonKey = String(stage.dungeonID);
  const stageKey = String(stage.stageId);
  const previousClear = user.dungeonClear[dungeonKey] || {};
  const completedAt = previousClear.clearedAt || state.completedAt || new Date().toISOString();
  user.dungeonClear[dungeonKey] = {
    ...previousClear,
    dungeonId: Number(previousClear.dungeonId || stage.dungeonID),
    stageId: Number(previousClear.stageId || stage.stageId),
    missionResult1: previousClear.missionResult1 === true || state.missionResult1 !== false,
    missionResult2: previousClear.missionResult2 === true || state.missionResult2 !== false,
    clearedAt: completedAt,
  };

  const previousPlay = user.stagePlayData[stageKey] || {};
  const playCount = Math.max(1, Number(previousPlay.playCount || 0));
  user.stagePlayData[stageKey] = {
    ...previousPlay,
    stageId: Number(previousPlay.stageId || stage.stageId),
    playCount,
    totalPlayCount: Math.max(playCount, Number(previousPlay.totalPlayCount || 0), 1),
    bestClearTimeSec: Number(previousPlay.bestClearTimeSec || state.bestClearTimeSec || 0),
  };
}

function recordEpisode1DungeonClearForUser(user, dungeonId, stageId, battleState = {}, options = {}) {
  if (!user) return false;
  const stage = getEpisode1StageByDungeonId(dungeonId) || getEpisode1StageByStageId(stageId);
  if (!stage) return false;
  if (stage.tutorial) return false;
  ensureEpisode1State(user);
  user.dungeonClear = user.dungeonClear && typeof user.dungeonClear === "object" ? user.dungeonClear : {};
  user.stagePlayData = user.stagePlayData && typeof user.stagePlayData === "object" ? user.stagePlayData : {};
  const resolvedStageId = Number(stage.stageId || stageId || 0);
  const resolvedDungeonId = Number(stage.dungeonID || dungeonId || 0);
  const bestClearTimeSec = Math.max(0, Math.round(Number((battleState && (battleState.gameTime || battleState.GameTime)) || 0)));
  const previousClear = user.dungeonClear[String(resolvedDungeonId)] || {};
  const missionResults =
    battleState && battleState.missionResults && typeof battleState.missionResults === "object"
      ? battleState.missionResults
      : battleState || {};
  const forceMissionSuccess =
    options.forceMissionSuccess === true ||
    (battleState && (battleState.forceMissionSuccess === true || battleState.ForceMissionSuccess === true));
  const missionResult1 =
    previousClear.missionResult1 === true ||
    forceMissionSuccess ||
    missionResults.missionResult1 === true ||
    missionResults.MissionResult1 === true ||
    (missionResults.missionResult1 !== false && missionResults.MissionResult1 !== false);
  const missionResult2 =
    previousClear.missionResult2 === true ||
    forceMissionSuccess ||
    missionResults.missionResult2 === true ||
    missionResults.MissionResult2 === true ||
    (missionResults.missionResult2 !== false && missionResults.MissionResult2 !== false);
  const previousStagePlay = user.stagePlayData[String(resolvedStageId)] || {};
  const clearTimeCandidates = [Number(previousStagePlay.bestClearTimeSec || 0), bestClearTimeSec].filter((value) => value > 0);
  const bestRecordedClearTimeSec = clearTimeCandidates.length > 0 ? Math.min(...clearTimeCandidates) : bestClearTimeSec;

  user.dungeonClear[String(resolvedDungeonId)] = {
    dungeonId: resolvedDungeonId,
    missionResult1,
    missionResult2,
    clearedAt: previousClear.clearedAt || new Date().toISOString(),
  };
  user.stagePlayData[String(resolvedStageId)] = {
    stageId: resolvedStageId,
    playCount: Number(previousStagePlay.playCount || 0) + 1,
    totalPlayCount: Number(previousStagePlay.totalPlayCount || 0) + 1,
    bestClearTimeSec: bestRecordedClearTimeSec,
  };
  user.unlockedStageIds = Array.isArray(user.unlockedStageIds) ? user.unlockedStageIds : [];
  if (!user.unlockedStageIds.includes(resolvedStageId)) user.unlockedStageIds.push(resolvedStageId);
  const state = user.episode1.stages[String(resolvedStageId)];
  if (state) {
    state.completed = true;
    state.completedAt = state.completedAt || new Date().toISOString();
    state.bestClearTimeSec = bestRecordedClearTimeSec;
    state.missionResult1 = state.missionResult1 === true || missionResult1;
    state.missionResult2 = state.missionResult2 === true || missionResult2;
  }
  ensureEpisode1State(user);
  if (typeof options.save === "function") options.save();
  return true;
}

function resetEpisode1PostTutorialProgress(user) {
  if (!user || typeof user !== "object") return false;
  const postTutorialStages = EPISODE1_STAGE_CHAIN.filter((stage) => stage && !stage.tutorial);
  const postTutorialStageIds = new Set(postTutorialStages.map((stage) => Number(stage.stageId)));
  const postTutorialDungeonIds = new Set(postTutorialStages.map((stage) => Number(stage.dungeonID)));
  let changed = false;

  user.dungeonClear = user.dungeonClear && typeof user.dungeonClear === "object" ? user.dungeonClear : {};
  user.stagePlayData = user.stagePlayData && typeof user.stagePlayData === "object" ? user.stagePlayData : {};

  for (const stage of postTutorialStages) {
    const dungeonKey = String(stage.dungeonID);
    const stageKey = String(stage.stageId);
    if (Object.prototype.hasOwnProperty.call(user.dungeonClear, dungeonKey)) {
      delete user.dungeonClear[dungeonKey];
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(user.stagePlayData, stageKey)) {
      delete user.stagePlayData[stageKey];
      changed = true;
    }
  }

  if (Array.isArray(user.unlockedStageIds)) {
    const nextUnlocked = user.unlockedStageIds.filter((stageId) => !postTutorialStageIds.has(Number(stageId)));
    if (
      nextUnlocked.length !== user.unlockedStageIds.length ||
      nextUnlocked.some((stageId, index) => stageId !== user.unlockedStageIds[index])
    ) {
      user.unlockedStageIds = nextUnlocked;
      changed = true;
    }
  } else {
    user.unlockedStageIds = [];
  }

  if (user.episode1 && typeof user.episode1 === "object") {
    user.episode1.stages =
      user.episode1.stages && typeof user.episode1.stages === "object" ? user.episode1.stages : {};
    for (const stage of postTutorialStages) {
      const stageKey = String(stage.stageId);
      if (Object.prototype.hasOwnProperty.call(user.episode1.stages, stageKey)) {
        delete user.episode1.stages[stageKey];
        changed = true;
      }
    }
    if (user.episode1.completed) changed = true;
    user.episode1.completed = false;
  }

  if (user.localStageRewardCursors && typeof user.localStageRewardCursors === "object") {
    for (const stage of postTutorialStages) {
      const cursorKey = `credit:${stage.dungeonID}`;
      if (Object.prototype.hasOwnProperty.call(user.localStageRewardCursors, cursorKey)) {
        delete user.localStageRewardCursors[cursorKey];
        changed = true;
      }
    }
  }

  if (user.clearConditions && typeof user.clearConditions === "object") {
    const clearDungeons =
      user.clearConditions.dungeons && typeof user.clearConditions.dungeons === "object"
        ? user.clearConditions.dungeons
        : null;
    const clearStages =
      user.clearConditions.stages && typeof user.clearConditions.stages === "object" ? user.clearConditions.stages : null;
    if (clearDungeons) {
      for (const dungeonId of postTutorialDungeonIds) {
        const key = String(dungeonId);
        if (Object.prototype.hasOwnProperty.call(clearDungeons, key)) {
          delete clearDungeons[key];
          changed = true;
        }
      }
    }
    if (clearStages) {
      for (const stageId of postTutorialStageIds) {
        const key = String(stageId);
        if (Object.prototype.hasOwnProperty.call(clearStages, key)) {
          delete clearStages[key];
          changed = true;
        }
      }
    }
  }

  if (user.gameplayUnlocks && typeof user.gameplayUnlocks === "object") {
    const removedUnlockKeys = new Set();
    const byDungeon =
      user.gameplayUnlocks.byDungeon && typeof user.gameplayUnlocks.byDungeon === "object"
        ? user.gameplayUnlocks.byDungeon
        : null;
    const byKey =
      user.gameplayUnlocks.byKey && typeof user.gameplayUnlocks.byKey === "object" ? user.gameplayUnlocks.byKey : null;
    if (byDungeon) {
      for (const dungeonId of postTutorialDungeonIds) {
        const key = String(dungeonId);
        const unlockKeys = Array.isArray(byDungeon[key]) ? byDungeon[key] : [];
        for (const unlockKey of unlockKeys) removedUnlockKeys.add(String(unlockKey));
        if (Object.prototype.hasOwnProperty.call(byDungeon, key)) {
          delete byDungeon[key];
          changed = true;
        }
      }
    }
    if (byKey) {
      for (const [key, unlock] of Object.entries(byKey)) {
        const stageId = Number(unlock && unlock.stageId);
        const reqValue = Number(unlock && unlock.reqValue);
        if (removedUnlockKeys.has(String(key)) || postTutorialStageIds.has(stageId) || postTutorialDungeonIds.has(reqValue)) {
          delete byKey[key];
          changed = true;
        }
      }
    }
  }

  if (user.persistentCutsceneViews && typeof user.persistentCutsceneViews === "object") {
    for (const [key, view] of Object.entries(user.persistentCutsceneViews)) {
      const dungeonId = Number((view && view.dungeonId) || key);
      const stageId = Number((view && view.stageId) || key);
      if (postTutorialDungeonIds.has(dungeonId) || postTutorialStageIds.has(stageId)) {
        delete user.persistentCutsceneViews[key];
        changed = true;
      }
    }
  }

  ensureEpisode1State(user);
  return changed;
}

module.exports = {
  EPISODE1_STAGE_CHAIN,
  getEpisode1StageByStageId,
  getEpisode1StageByDungeonId,
  getEpisode1StageForRequest,
  isEpisode1StageId,
  isEpisode1DungeonId,
  isEpisode1CutsceneDungeonId,
  mapIdForStageDungeon,
  stageIdForDungeonId,
  ensureEpisode1State,
  recordEpisode1DungeonClearForUser,
  resetEpisode1PostTutorialProgress,
};
