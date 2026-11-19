// NEON HARBOR — scripted screenshot scenes. A ?shot=<name> query parameter
// puts the game into a fixed, reproducible pose for screenshots: fixed seed,
// fixed time of day, fixed player position and vehicle. The playtest and
// the screenshot script drive these scenes; the chase scene is a stand-in
// until stage 2 adds real police chase AI.

import { createVehicle } from './vehicles.js';

export const SHOT_NAMES = ['start', 'drive', 'foot', 'chase'];

function putPlayerInCar(state, type, x, y, angle, color) {
  const v = createVehicle(type, x, y, angle, color);
  v.driver = 'player';
  state.vehicles.push(v);
  state.player.vehicle = v;
  state.player.x = x;
  state.player.y = y;
  state.player.angle = angle;
  return v;
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
    putPlayerInCar(state, 'sports', 910, 760, Math.PI / 2, '#d8232a');
    state.demoDrive = true;
    state.objective = 'Free roam — explore Neon Harbor';
    return true;
  }

  if (name === 'foot') {
    // On-foot cash grab at the docks in daylight.
    state.timeHours = 11.2;
    state.cash = 480;
    state.player.x = 1010;
    state.player.y = 1745;
    state.player.angle = -Math.PI / 2;
    dropCashNear(state, 1065, 1752, 150);
    dropCashNear(state, 985, 1708, 90);
    state.objective = 'Grab the cash on the docks';
    return true;
  }

  if (name === 'chase') {
    // STAGE 1 STAND-IN: dusk pursuit pose — three stars, two cruisers on
    // the player's tail. Stage 2 replaces the posed cruisers with real
    // police chase AI and roadblocks.
    state.timeHours = 18.35;
    state.cash = 3420;
    state.wanted = 3;
    putPlayerInCar(state, 'sedan', 1110, 640, Math.PI / 2, '#b03a3a');
    const c1 = createVehicle('police', 1090, 540, Math.PI / 2);
    c1.driver = 'traffic';
    c1.roadAxis = 'v';
    c1.roadCoord = 1100;
    c1.dir = 1;
    c1.cruiseSpeed = 300;
    c1.speed = 300;
    const c2 = createVehicle('police', 1110, 470, Math.PI / 2);
    c2.driver = 'traffic';
    c2.roadAxis = 'v';
    c2.roadCoord = 1100;
    c2.dir = 1;
    c2.cruiseSpeed = 290;
    c2.speed = 290;
    state.vehicles.push(c1, c2);
    state.demoDrive = true;
    state.objective = 'Lose the cops — break line of sight';
    state.addMessage('WANTED — 3 stars');
    return true;
  }

  return false;
}
