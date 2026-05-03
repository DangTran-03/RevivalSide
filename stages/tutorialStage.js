// Single-stage definition for tutorial dungeon 1004.
//
// These values are intentionally sourced from the captured tutorial flow:
// - stage/dungeon/map/gameUnitUIDIndex come from the captured GAME_LOAD_ACK (804) template.
// - initial sync units come from captured tutorial GAME_SYNC (822) packets in the same flow.
// The GAME_LOAD_ACK builder still preserves the full captured NKMGameData binary layout; this module
// only supplies known-safe patch values and the unit state used by generated 822 packets.

const TUTORIAL_STAGE = Object.freeze({
  stageId: 11211,
  dungeonID: 1004,
  mapID: 1064,
  gameUnitUIDIndex: 18,
  initialGameTime: 4,
  initialRemainGameTime: 180,
  respawnCostA1: 10,
  respawnCostB1: 10,
  gameState: {
    state: 3,
    winTeam: 0,
    waveId: 1,
  },
  teamA: Object.freeze({
    units: Object.freeze([
      // Captured first ship/core sync from server_031_822.payload.bin.
      Object.freeze({
        role: "ship",
        gameUnitUID: 1,
        hp: 23712,
        x: -200,
        z: -110,
        right: true,
        playState: 1,
        respawn: true,
        stateId: 11,
        stateChangeCount: 1,
        seed: 84,
      }),
    ]),
  }),
  teamB: Object.freeze({
    units: Object.freeze([
      // Captured early enemy/core sync from server_038_822.payload.bin.
      Object.freeze({
        role: "enemy",
        gameUnitUID: 4,
        hp: 1989,
        x: 1300,
        z: -110,
        right: false,
        playState: 1,
        respawn: false,
        stateId: 12,
        stateChangeCount: 2,
        seed: 10,
      }),
    ]),
  }),
  deployableGameUnitUIDGroups: Object.freeze([
    Object.freeze([5, 6]),
    Object.freeze([8, 9]),
  ]),
  autoDeployUnits: Object.freeze([
    // Captured tutorial GAME_RESPAWN_REQ used unitUID=1000807049. The server ACKs this long
    // unit UID with 817, then the generated 822 sync instantiates the assigned game-unit UIDs.
    Object.freeze({
      unitUID: "1000807049",
      assistUnit: false,
      gameUnitUIDs: Object.freeze([5, 6]),
      x: 400,
      z: -180,
      hp: 1989,
      right: true,
      playState: 1,
      stateId: 13,
      stateChangeCount: 1,
      seed: 51,
    }),
  ]),
});

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

function getTutorialStage() {
  return {
    ...TUTORIAL_STAGE,
    gameState: { ...TUTORIAL_STAGE.gameState },
    teamA: {
      units: TUTORIAL_STAGE.teamA.units.map((unit) => ({ ...unit })),
    },
    teamB: {
      units: TUTORIAL_STAGE.teamB.units.map((unit) => ({ ...unit })),
    },
    deployableGameUnitUIDGroups: TUTORIAL_STAGE.deployableGameUnitUIDGroups.map((group) => group.slice()),
    autoDeployUnits: TUTORIAL_STAGE.autoDeployUnits.map((unit) => ({
      ...unit,
      gameUnitUIDs: unit.gameUnitUIDs.slice(),
    })),
    initialUnits: [
      ...TUTORIAL_STAGE.teamA.units.map((unit) => cloneUnit(unit, 1)),
      ...TUTORIAL_STAGE.teamB.units.map((unit) => cloneUnit(unit, 3)),
    ],
  };
}

module.exports = {
  getTutorialStage,
};
