// NEON HARBOR — save and load. Progress lives in localStorage as one JSON
// document: cash, missions, position, vehicle, stats and settings. Loading
// validates the shape so a corrupt or foreign save never breaks the game.

import { serializeMission } from './missions.js';

const KEY = 'neon-harbor-save-v1';

export function saveExists() {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

export function saveGame(state) {
  const data = {
    version: 1,
    savedAt: Date.now(),
    cash: state.cash,
    lifetimeCash: state.stats.lifetimeCash,
    wanted: state.wanted,
    timeHours: state.timeHours,
    player: {
      x: state.player.x,
      y: state.player.y,
      angle: state.player.angle,
      health: state.player.health,
    },
    vehicle: state.player.vehicle
      ? {
          type: state.player.vehicle.type,
          x: state.player.vehicle.x,
          y: state.player.vehicle.y,
          angle: state.player.vehicle.angle,
          color: state.player.vehicle.color,
          health: state.player.vehicle.health,
        }
      : null,
    missionsCompleted: state.missionsCompleted,
    currentMission: state.currentMission,
    mission: serializeMission(state),
    stats: { ...state.stats },
    settings: { ...state.settings },
    seed: state.seed,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || data.version !== 1 || typeof data.cash !== 'number') return null;
    if (!data.player || typeof data.player.x !== 'number') return null;
    return data;
  } catch {
    return null;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable — nothing to clear.
  }
}
