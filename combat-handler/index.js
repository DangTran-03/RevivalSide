const syncBuilder = require("./syncBuilder");
const { createTickEngine } = require("./tick");
const { createBattleStateManager, buildCapturedRespawnUnitPools } = require("./battleState");
const { createDeployHandler } = require("./deploy");
const { createCsharpCombatHost } = require("./csharpHost");

// Combat handler facade.
//
// cs-listener.js owns sockets, encryption, packet ordering, and captured-flow
// routing. This facade owns combat state and tells the listener which combat
// payloads to send.

function createCombatHandler(options = {}) {
  const constants = options.constants || {};
  const config = options.config || {};
  const csharpHost = createCsharpCombatHost({
    enabled: Boolean(config.CSHARP_COMBAT_HOST),
    projectPath: config.CSHARP_COMBAT_HOST_PROJECT,
    dllPath: config.CSHARP_COMBAT_HOST_DLL,
    timeoutMs: config.CSHARP_COMBAT_HOST_TIMEOUT_MS,
    managedDir: config.COUNTERSIDE_MANAGED_DIR,
    gameplayTablesDir: config.GAMEPLAY_TABLES_DIR,
    dotnetPath: config.CSHARP_COMBAT_HOST_DOTNET,
    syncIntervalSeconds: Number(config.DYNAMIC_BATTLE_SYNC_INTERVAL_MS || 250) / 1000,
    defaultUnitDamage: options.defaultCombatStats && options.defaultCombatStats.damage,
    defaultUnitAttackRange: options.defaultCombatStats && options.defaultCombatStats.attackRange,
    defaultUnitMoveSpeed: options.defaultCombatStats && options.defaultCombatStats.moveSpeed,
    defaultUnitAttackCooldown: options.defaultCombatStats && options.defaultCombatStats.attackCooldown,
    staticUnitDamage: options.staticCombatStats && options.staticCombatStats.damage,
    staticUnitAttackRange: options.staticCombatStats && options.staticCombatStats.attackRange,
    staticUnitAttackCooldown: options.staticCombatStats && options.staticCombatStats.attackCooldown,
    defaultDeployedUnitHp: options.defaultDeployedUnitHp,
  });
  let csharpWarningPrinted = false;
  const tickEngine = createTickEngine({
    combatStateId: options.combatStateId,
    defaultCombatStats: options.defaultCombatStats,
    staticCombatStats: options.staticCombatStats,
    gameplayUnitStats: options.gameplayUnitStats,
  });
  const stateManager = createBattleStateManager({
    tick: tickEngine,
    capturedGameFlow: options.capturedGameFlow,
    capturedRespawnUnitPools: options.capturedRespawnUnitPools,
    parseCapturedGameSyncPayload: options.parseCapturedGameSyncPayload,
    extractGameLoadUnitPools: options.extractGameLoadUnitPools,
    dynamicBattleGameUnitGroups: config.DYNAMIC_BATTLE_GAME_UNIT_GROUPS,
    makeDynamicGameUid: options.makeDynamicGameUid,
    mapIdForStageDungeon: options.mapIdForStageDungeon,
  });
  const deployHandler = createDeployHandler({
    tick: tickEngine,
    syncBuilder,
    combatStateId: options.combatStateId,
    defaultDeployedUnitHp: options.defaultDeployedUnitHp,
    dynamicBattleGameUnitGroups: config.DYNAMIC_BATTLE_GAME_UNIT_GROUPS,
  });

  function startBattle(initialData) {
    if (csharpHost.enabled && initialData && initialData.replay && initialData.req) {
      const gameUID =
        initialData.gameUID ||
        (typeof options.makeDynamicGameUid === "function" ? options.makeDynamicGameUid() : BigInt(Date.now()) * 10000n);
      const response = csharpHost.request("startBattle", {
        req: initialData.req,
        stage: initialData.stage || {},
        gameUID: String(gameUID),
        gameLoadAckPayloadBase64: initialData.gameLoadAckPayloadBase64 || "",
      });
      if (response.ok && response.dynamicGame && response.battleState) {
        if (response.error && !response.dynamicGame.managedCombat) {
          warnCsharpFallback(response.error);
        }
        initialData.replay.dynamicGame = response.dynamicGame;
        initialData.replay.battleState = response.battleState;
        initialData.replay.dynamicGame.gameUID = gameUID;
        initialData.replay.battleState.gameUID = gameUID;
        initialData.replay.tutorialReplayPhase = response.dynamicGame.managedCombat ? "dynamic" : response.dynamicGame.tutorial ? "captured-bootstrap" : "dynamic";
        initialData.replay.syntheticGameTime = Number(response.battleState.gameTime || 4);
        initialData.replay.battleSim = null;
        initialData.replay.dynamicBattleResultSent = false;
        return response.dynamicGame;
      }
      warnCsharpFallback(response.error);
    }
    return stateManager.startBattle(initialData);
  }

  function attachGameLoadUnitPools(replay, activeStage, payload) {
    return stateManager.attachGameLoadUnitPools(replay, activeStage, payload);
  }

  function handleDeploy(request) {
    const replay = request && request.replay;
    if (csharpHost.enabled && replay && replay.battleState && replay.dynamicGame && request.req) {
      const response = csharpHost.request("handleDeploy", {
        dynamicGame: replay.dynamicGame,
        battleState: replay.battleState,
        req: request.req,
      });
      if (response.ok && response.deployed && response.deployed.handled) {
        applyHostState(replay, response);
        const ack = (response.packets || []).find((packet) => packet.packetId === 817);
        const sync = (response.packets || []).find((packet) => packet.packetId === 822);
        const packets = (response.packets || [])
          .filter((packet) => packet && packet.packetId && packet.payload)
          .map((packet) => ({ packetId: packet.packetId, payload: packet.payload, label: packet.label || "managed-deploy" }));
        return {
          handled: true,
          mode: response.deployed.mode || "battleState",
          deployed: response.deployed.unit || null,
          spawned: response.deployed.spawned || null,
          packets,
          ackPayload: ack && ack.payload,
          syncPayload: sync && sync.payload,
        };
      }
      if (replay.dynamicGame && replay.dynamicGame.managedCombat) {
        console.log(`[combat-host] managed deploy failed: ${summarizeHostError(response.error)}`);
        return { handled: false, mode: "managed-local-server", error: response.error || "managed deploy failed" };
      }
      warnCsharpFallback(response.error);
    }
    return deployHandler.handleDeploy(request.replay, request.req);
  }

  function tick(delta, battleState) {
    return tickEngine.continueBattleStateUnits(battleState, delta);
  }

  function buildSync(data = {}) {
    if (csharpHost.enabled && data.battleState) {
      const response = csharpHost.request("buildSync", {
        dynamicGame: data.dynamicGame,
        battleState: data.battleState,
        delta: data.delta == null ? 0.5 : Number(data.delta),
        skipSimulation: Boolean(data.skipSimulation),
      });
      if (response.ok) {
        if (response.battleState) replaceMutable(data.battleState, response.battleState);
        return response.payload || null;
      }
      if (data.dynamicGame && data.dynamicGame.managedCombat) {
        console.log(`[combat-host] managed sync failed: ${summarizeHostError(response.error)}`);
        return null;
      }
      warnCsharpFallback(response.error);
    }
    return syncBuilder.buildGameSync(data, { continueBattleStateUnits: tickEngine.continueBattleStateUnits });
  }

  function buildSyncPackets(data = {}) {
    if (csharpHost.enabled && data.battleState) {
      const response = csharpHost.request("buildSync", {
        dynamicGame: data.dynamicGame,
        battleState: data.battleState,
        delta: data.delta == null ? 0.5 : Number(data.delta),
        skipSimulation: Boolean(data.skipSimulation),
      });
      if (response.ok) {
        if (response.battleState) replaceMutable(data.battleState, response.battleState);
        if (Array.isArray(response.packets) && response.packets.length > 0) {
          return response.packets
            .filter((packet) => packet && packet.packetId && packet.payload)
            .map((packet) => ({ packetId: packet.packetId, payload: packet.payload, label: packet.label || "managed-sync" }));
        }
        if (response.payload) {
          return [{ packetId: constants.NPT_GAME_SYNC_DATA_PACK_NOT, payload: response.payload, label: "managed-sync" }];
        }
        return [];
      }
      if (data.dynamicGame && data.dynamicGame.managedCombat) {
        console.log(`[combat-host] managed sync packets failed: ${summarizeHostError(response.error)}`);
        return [];
      }
      warnCsharpFallback(response.error);
    }
    return [{ packetId: constants.NPT_GAME_SYNC_DATA_PACK_NOT, payload: buildSync(data), label: "dynamic-game-sync" }];
  }

  function buildInitialSync(replay) {
    if (csharpHost.enabled && replay && replay.battleState) {
      const response = csharpHost.request("buildInitialSync", {
        dynamicGame: replay.dynamicGame,
        battleState: replay.battleState,
      });
      if (response.ok && response.payload) {
        applyHostState(replay, response);
        return response.payload;
      }
      warnCsharpFallback(response.error);
    }
    return syncBuilder.buildInitialBattleSync(replay, { continueBattleStateUnits: tickEngine.continueBattleStateUnits });
  }

  function buildInitialPackets(replay) {
    if (csharpHost.enabled && replay && replay.battleState) {
      const response = csharpHost.request("buildInitialSync", {
        dynamicGame: replay.dynamicGame,
        battleState: replay.battleState,
      });
      if (response.ok) {
        applyHostState(replay, response);
        if (Array.isArray(response.packets) && response.packets.length > 0) {
          return response.packets
            .filter((packet) => packet && packet.packetId && packet.payload)
            .map((packet) => ({ packetId: packet.packetId, payload: packet.payload, label: packet.label || "managed-initial" }));
        }
        if (response.payload) {
          return [{ packetId: constants.NPT_GAME_SYNC_DATA_PACK_NOT, payload: response.payload, label: "managed-initial-sync" }];
        }
      }
      if (replay.dynamicGame && replay.dynamicGame.managedCombat) {
        console.log(`[combat-host] managed initial packets failed: ${summarizeHostError(response.error)}`);
        return [];
      }
      warnCsharpFallback(response.error);
    }
    return [{ packetId: constants.NPT_GAME_SYNC_DATA_PACK_NOT, payload: buildInitialSync(replay), label: "dynamic-game-sync" }];
  }

  function buildRespawnAck(data = {}) {
    if (csharpHost.enabled) {
      const response = csharpHost.request("buildRespawnAck", {
        unitUID: data.unitUID,
        assistUnit: Boolean(data.assistUnit),
      });
      if (response.ok && response.payload) return response.payload;
      warnCsharpFallback(response.error);
    }
    return syncBuilder.buildRespawnAck(data);
  }

  function buildGameRespawnAckPayload(unitUID, assistUnit) {
    return buildRespawnAck({ unitUID, assistUnit });
  }

  function buildSyntheticGameSyncPayload(gameTime) {
    if (csharpHost.enabled) {
      const response = csharpHost.request("buildSyntheticSync", { gameTime: Number(gameTime || 0) });
      if (response.ok && response.payload) return response.payload;
      warnCsharpFallback(response.error);
    }
    return syncBuilder.buildSyntheticGameSyncPayload(gameTime);
  }

  function startBattleLoop(socket, label, callbacks = {}) {
    const replay = socket.session && socket.session.gameReplay;
    if (!replay || replay.dynamicBattleTimer || !config.DYNAMIC_BATTLE_MANAGER) return false;
    const syncInterval = Number(config.DYNAMIC_BATTLE_SYNC_INTERVAL_MS || 250);
    console.log(`[battle-manager:${label}] started interval=${syncInterval}ms`);
    replay.dynamicBattleTimer = setInterval(() => {
      if (socket.destroyed) {
        if (typeof callbacks.stopTimers === "function") callbacks.stopTimers(socket);
        return;
      }
      const packets =
        replay.battleState && replay.dynamicGame
          ? buildSyncPackets({ dynamicGame: replay.dynamicGame, battleState: replay.battleState, delta: syncInterval / 1000 })
          : [{ packetId: constants.NPT_GAME_SYNC_DATA_PACK_NOT, payload: buildBattleSimSyncPayload(replay, syncInterval / 1000), label: "battle-manager-sync" }];
      for (const packet of packets) {
        callbacks.sendGamePacket(socket, packet.packetId, packet.payload, packet.label || "battle-manager-sync");
      }
      const finishedState = replay.battleState && replay.battleState.finished ? replay.battleState : replay.battleSim;
      if (finishedState && finishedState.finished && !replay.dynamicBattleResultSent) {
        replay.dynamicBattleResultSent = true;
        clearInterval(replay.dynamicBattleTimer);
        replay.dynamicBattleTimer = null;
        console.log(
          `[battle-manager] result=${finishedState.win ? "win" : "loss"} gameTime=${Number(
            finishedState.gameTime || 0
          ).toFixed(2)}`
        );
      }
    }, syncInterval);
    if (typeof replay.dynamicBattleTimer.unref === "function") replay.dynamicBattleTimer.unref();
    return true;
  }

  function transitionTutorialReplayToDynamic(replay, endIndex) {
    return stateManager.transitionTutorialReplayToDynamic(replay, endIndex);
  }

  function isFinished(replayOrState) {
    const state = replayOrState && replayOrState.battleState ? replayOrState.battleState : replayOrState;
    return Boolean(state && state.finished);
  }

  function getResult(replayOrState) {
    const state = replayOrState && replayOrState.battleState ? replayOrState.battleState : replayOrState;
    if (!state || !state.finished) return null;
    return { win: Boolean(state.win), gameTime: Number(state.gameTime || 0), state };
  }

  function buildBattleSimSyncPayload(replay, delta) {
    const sim = deployHandler.initBattleSimulator(replay);
    if (sim.finished && sim.finishSent) {
      return buildSync({ gameTime: sim.gameTime, absoluteGameTime: sim.absoluteGameTime, baseEntries: [] });
    }

    sim.tick += 1;
    sim.gameTime += delta;
    sim.absoluteGameTime += delta;
    sim.remainGameTime = Math.max(0, sim.remainGameTime - delta);
    sim.respawnCostA1 = tickEngine.clamp(sim.respawnCostA1 + delta * 0.8, 0, 10);
    sim.respawnCostB1 = tickEngine.clamp(sim.respawnCostB1 + delta * 0.8, 0, 10);

    const livePlayers = sim.units.filter((unit) => unit.team === 1 && unit.alive);
    for (const unit of livePlayers) advanceBattleUnit(sim, unit, delta);

    settleBattleOutcome(sim);

    const visibleUnits = sim.units
      .filter((unit) => unit.alive || unit.playState === 2)
      .map((unit) => {
        const respawn = unit.respawn;
        unit.respawn = false;
        const speedSign = unit.right ? 1 : -1;
        return {
          ...unit,
          respawn,
          hp: Math.max(0, unit.hp),
          speedX: Math.abs(unit.speedCurrent || 0),
          savedPosX: unit.x,
          right: unit.right,
          targetUID: unit.targetUID || 0,
          playState: unit.playState == null ? 1 : unit.playState,
          damageSpeedXNegative: speedSign < 0,
        };
      });

    for (const unit of sim.units) {
      if (unit.playState === 2) {
        unit.dyingFrames = (unit.dyingFrames || 0) + 1;
        if (unit.dyingFrames >= 2 && !unit.deadSynced) {
          unit.deadSynced = true;
          unit.playState = 0;
          sim.pendingDieUnitUIDs.push(unit.gameUnitUID);
        }
      }
    }

    const base = syncBuilder.buildGameSyncDataBase({
      gameTime: sim.gameTime,
      remainGameTime: sim.remainGameTime,
      respawnCostA1: sim.respawnCostA1,
      respawnCostB1: sim.respawnCostB1,
      respawnCostAssistA1: sim.respawnCostAssistA1,
      respawnCostAssistB1: sim.respawnCostAssistB1,
      usedRespawnCostA1: sim.usedRespawnCostA1,
      usedRespawnCostB1: sim.usedRespawnCostB1,
      dieUnits: sim.pendingDieUnitUIDs.length ? [sim.pendingDieUnitUIDs.splice(0)] : [],
      units: visibleUnits,
      decks: sim.pendingDeckSyncs.splice(0),
      gameStates: sim.pendingGameStates.splice(0),
    });

    if (sim.tick % 10 === 0 && !sim.finished) {
      const players = sim.units.filter((unit) => unit.team === 1 && unit.alive).length;
      console.log(`[battle-manager] t=${sim.gameTime.toFixed(1)} players=${players} targetHp=${sim.targetHp.toFixed(0)}`);
    }

    return buildSync({ gameTime: sim.gameTime, absoluteGameTime: sim.absoluteGameTime, baseEntries: [base] });
  }

  function advanceBattleUnit(sim, unit, delta) {
    if (unit.spawnGrace > 0) {
      unit.spawnGrace = Math.max(0, unit.spawnGrace - delta);
      tickEngine.setBattleUnitState(unit, 13);
      unit.speedCurrent = 0;
      return;
    }

    unit.attackTimer = Math.max(0, Number(unit.attackTimer || 0) - delta);
    unit.attackStateTime = Math.max(0, Number(unit.attackStateTime || 0) - delta);
    const target = sim.targetHp > 0 ? { gameUnitUID: sim.targetUID, x: sim.targetX } : null;
    unit.targetUID = target ? target.gameUnitUID : 0;
    if (!target) {
      unit.speedCurrent = 0;
      tickEngine.setBattleUnitState(unit, 12);
      return;
    }

    const dir = target.x >= unit.x ? 1 : -1;
    unit.right = dir >= 0;
    const distance = Math.abs(target.x - unit.x);
    if (distance > unit.attackRange) {
      const step = Math.min(unit.speedX * delta, distance - unit.attackRange);
      unit.speedCurrent = dir * unit.speedX;
      unit.x += dir * step;
      tickEngine.setBattleUnitState(unit, 13);
      unit.hitDone = false;
      return;
    }

    unit.speedCurrent = 0;
    if (unit.attackTimer <= 0) {
      unit.attackTimer = unit.attackCooldown;
      unit.attackStateTime = Math.max(unit.hitFrame + 0.1, unit.attackCooldown * 0.55);
      unit.hitDone = false;
      tickEngine.setBattleUnitState(unit, 45);
    }

    if (!unit.hitDone && unit.attackCooldown - unit.attackTimer >= unit.hitFrame) {
      unit.hitDone = true;
      sim.targetHp = Math.max(0, sim.targetHp - unit.attackDamage);
    }

    if (unit.attackStateTime <= 0 && unit.attackTimer > 0) {
      tickEngine.setBattleUnitState(unit, 12);
    }
  }

  function settleBattleOutcome(sim) {
    if (sim.finished) return;
    const livePlayers = sim.units.filter((unit) => unit.team === 1 && unit.alive);
    if (livePlayers.some((unit) => unit.x >= 1460) || (sim.targetHp <= 0 && livePlayers.length > 0)) {
      finishBattle(sim, true);
    } else if (sim.remainGameTime <= 0 || (sim.playerUnitCount > 0 && livePlayers.length === 0)) {
      finishBattle(sim, false);
    }
  }

  function finishBattle(sim, win) {
    sim.finished = true;
    sim.finishSent = true;
    sim.win = Boolean(win);
    sim.gameState = 4;
    sim.pendingGameStates.push({ state: 4, winTeam: win ? 1 : 3, waveId: sim.waveId });
  }

  function deployStageLineup(replay) {
    if (csharpHost.enabled && replay && replay.battleState && replay.dynamicGame) {
      const response = csharpHost.request("deployStageLineup", {
        dynamicGame: replay.dynamicGame,
        battleState: replay.battleState,
      });
      if (response.ok && response.deployed) {
        applyHostState(replay, response);
        return response.deployed.spawned || [];
      }
      warnCsharpFallback(response.error);
    }
    return stateManager.deployStageLineup(replay);
  }

  function applyHostState(replay, response) {
    if (!replay || !response) return;
    if (response.dynamicGame) {
      if (replay.dynamicGame) replaceMutable(replay.dynamicGame, response.dynamicGame);
      else replay.dynamicGame = response.dynamicGame;
    }
    if (response.battleState) {
      if (replay.battleState) replaceMutable(replay.battleState, response.battleState);
      else replay.battleState = response.battleState;
    }
  }

  function replaceMutable(target, source) {
    if (!target || !source) return source;
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, source);
    return target;
  }

  function warnCsharpFallback(error) {
    if (csharpWarningPrinted) return;
    csharpWarningPrinted = true;
    console.log(
      `[combat-host] managed CounterSide local server unavailable; using fallback combat host${
        error ? `: ${summarizeHostError(error)}` : ""
      }`
    );
  }

  function summarizeHostError(error) {
    const lines = String(error || "")
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return (
      lines.find((line) => line.startsWith("---> System.")) ||
      lines.find((line) => line.startsWith("System.") && !line.includes("TargetInvocationException")) ||
      lines[0] ||
      "unknown error"
    ).replace(/^---> /, "");
  }

  return {
    startBattle,
    handleDeploy,
    tick,
    buildSync,
    buildGameSync: buildSync,
    buildGameSyncPackets: buildSyncPackets,
    buildInitialBattleSync: buildInitialSync,
    buildInitialBattlePackets: buildInitialPackets,
    buildRespawnAck,
    buildGameRespawnAckPayload,
    buildGameEndNot: syncBuilder.buildGameEndNot,
    buildSyntheticGameSyncPayload,
    initBattleSimulator: deployHandler.initBattleSimulator,
    startBattleLoop,
    isFinished,
    getResult,
    deployStageLineup,
    attachGameLoadUnitPools,
    describeRuntimeGameUnitPools: stateManager.describeRuntimeGameUnitPools,
    transitionTutorialReplayToDynamic,
    buildBattleSimSyncPayload,
  };
}

module.exports = {
  createCombatHandler,
  buildCapturedRespawnUnitPools,
};
