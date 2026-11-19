// NEON HARBOR — scripted screenshot scenes. A ?shot=<name> query parameter
// puts the game into a fixed, reproducible pose for screenshots: fixed seed,
// fixed time of day, fixed player position and vehicle. The playtest and
// the screenshot script drive these scenes; the chase scene runs a genuine
// police pursuit through the stage-2 chase AI.

import { createVehicle } from './vehicles.js';
import { spawnCruiser } from './police.js';
import { startMission } from './missions.js';

export const SHOT_NAMES = ['start', 'drive', 'foot', 'chase'];

function putPlayerInCar(state, type, x, y, angle, color, speed = 0) {
  const v = createVehicle(type, x, y, angle, color);
  v.driver = 'player';
  v.speed = speed;
  v.vx = Math.cos(angle) * speed;
  v.vy = Math.sin(angle) * speed;
  state.vehicles.push(v);
  state.player.vehicle = v;
  state.player.x = x;
  state.player.y = y;
  state.player.angle = angle;
  return v;
}

// Clear traffic near a point so a scripted drive starts on an open road.
function clearTrafficNear(state, x, y, radius) {
  state.vehicles = state.vehicles.filter(
    (v) => v.driver !== 'traffic' || Math.hypot(v.x - x, v.y - y) > radius,
  );
}

function dropCashNear(state, x, y, amount) {
  state.cashDrops.push({ x, y, amount });
}

// Each scene mutates the fresh state and returns whether the game should
// start playing immediately (false only for the start screen).
export function setupShot(state, name) {
  const world = state.world;
  state.demoDrive = false;
  state.menuPan = false;

  if (name === 'start') {
    // Start screen over a dusk panorama of downtown.
    state.timeHours = 18.15;
    state.camera.x = 1000;
    state.camera.y = 900;
    state.menuPan = true;
    state.objective = 'Free roam — explore Neon Harbor';
    return false;
  }

  if (name === 'drive') {
    // Night drive downtown: neon, traffic, headlights.
    state.timeHours = 21.6;
    state.cash = 1250;
    clearTrafficNear(state, 910, 1000, 700);
    putPlayerInCar(state, 'sports', 910, 760, Math.PI / 2, '#d8232a', 260);
    state.demoDrive = true;
    state.demoNoTurn = true;
    state.objective = 'Free roam — explore Neon Harbor';
    return true;
  }

  if (name === 'foot') {
    // On-foot cash grab at the docks in daylight — mission 4, The Drop,
    // with its marked grab zone and cash on the ground.
    state.timeHours = 11.2;
    state.cash = 480;
    state.player.x = 1010;
    state.player.y = 1745;
    state.player.angle = -Math.PI / 2;
    dropCashNear(state, 1065, 1752, 150);
    dropCashNear(state, 985, 1708, 90);
    startMission(state, 3);
    state.banner = null; // keep the briefing out of the frame
    return true;
  }

  if (name === 'chase') {
    // A real pursuit at dusk: three stars, three cruisers on the player's
    // tail under the live chase AI, mission 3 (Getaway) running.
    state.timeHours = 18.35;
    state.cash = 3420;
    clearTrafficNear(state, 1100, 900, 700);
    putPlayerInCar(state, 'sedan', 1090, 640, Math.PI / 2, '#b03a3a', 240);
    startMission(state, 2);
    state.banner = null; // keep the briefing out of the frame
    state.wanted = 3;
    state.lastCrimeAt = state.now;
    state.stats.bestWanted = 3;
    state.police.lastSeen = { x: state.player.x, y: state.player.y };
    state.police.seen = true;
    spawnCruiser(state, 1090, 500, Math.PI / 2, 'chase');
    spawnCruiser(state, 1112, 420, Math.PI / 2, 'cut');
    spawnCruiser(state, 1068, 360, Math.PI / 2, 'flank');
    state.demoDrive = true;
    state.demoNoTurn = true;
    state.objective = 'Lose the cops — break line of sight';
    state.addMessage('WANTED — 3 stars');
    return true;
  }

  return false;
}
