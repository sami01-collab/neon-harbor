// NEON HARBOR — bootstrap and game loop. Builds the world and the game
// state, runs a fixed-step simulation, wires the menus and the save system,
// and exposes a small debug handle (window.__game) for playtesting.

import { CONFIG, rankFor } from './config.js';
import { createRng } from './random.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer, updatePlayer, updateBullets, burst } from './player.js';
import {
  createVehicle,
  spawnTrafficCar,
  spawnParkedCar,
  updateTrafficCar,
  resolveVehicleCollisions,
} from './vehicles.js';
import { createPed, updatePed, targetPedCount } from './pedestrians.js';
import { createCamera, updateCamera, render } from './render.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { saveGame, loadGame, clearSave, saveExists } from './save.js';
import { setupShot } from './shots.js';

const STEP = 1 / 60;
const DEFAULT_SEED = 'neon-harbor-1';

function queryParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    shot: params.get('shot'),
    seed: params.get('seed') || DEFAULT_SEED,
  };
}

function createState(seed, canvas) {
  const world = createWorld(seed);
  const rng = createRng(seed + ':game');
  const spawn = world.landmarks.spawn;
  const state = {
    seed,
    world,
    rng,
    mode: 'menu', // 'menu' | 'playing' | 'paused' | 'wasted'
    now: 0,
    timeHours: CONFIG.startHour,
    cash: 250,
    wanted: 0,
    player: createPlayer(spawn.x, spawn.y),
    vehicles: [],
    peds: [],
    bullets: [],
    particles: [],
    skidmarks: [],
    cashDrops: [],
    messages: [],
    threats: [],
    events: [],
    camera: createCamera(),
    mouseWorld: { x: spawn.x, y: spawn.y },
    stats: {
      lifetimeCash: 250,
      carsStolen: 0,
      distanceDriven: 0,
      shotsFired: 0,
      pedsHit: 0,
      bustsEscaped: 0,
      bestWanted: 0,
    },
    settings: { muted: false },
    missionsCompleted: [],
    currentMission: 0,
    objective: 'Free roam — explore Neon Harbor',
    rank: 'Nobody',
    lastCrimeAt: -100,
    lastWantedDropAt: 0,
    nextCashSpawn: 0,
    nextPedSpawn: 0,
    nextTrafficSpawn: 0,
    autosaveTimer: 0,
    wastedTimer: 0,
    demoDrive: false,
    menuPan: false,
    demoTurnUntil: 0,
    demoTargetAngle: null,
    audio: null,
    input: null,
    hud: null,
  };

  // These use `this` (not the closed-over state) because New Game and
  // Continue copy a fresh state object onto the live one.
  state.addMessage = function (text) {
    this.messages.push({ text, at: this.now });
    if (this.messages.length > 20) this.messages.shift();
  };
  state.addWanted = function (amount, reason) {
    if (this.now - this.lastCrimeAt < CONFIG.wantedCrimeCooldown) return;
    this.lastCrimeAt = this.now;
    const before = this.wanted;
    this.wanted = Math.min(5, this.wanted + amount);
    this.stats.bestWanted = Math.max(this.stats.bestWanted, this.wanted);
    if (this.wanted > before) {
      this.addMessage(`WANTED — ${this.wanted} star${this.wanted > 1 ? 's' : ''} (${reason})`);
    }
  };
  state.addCash = function (amount, reason) {
    this.cash += amount;
    if (amount > 0) this.stats.lifetimeCash += amount;
    this.rank = rankFor(this.stats.lifetimeCash);
    if (reason) this.addMessage(`+$${amount} — ${reason}`);
  };

  // Traffic, parked cars, pedestrians and cash drops.
  for (let i = 0; i < CONFIG.trafficCount; i++) {
    state.vehicles.push(spawnTrafficCar(world, rng, state.player));
  }
  for (let i = 0; i < CONFIG.parkedCount; i++) {
    state.vehicles.push(spawnParkedCar(world, rng));
  }
  for (let i = 0; i < CONFIG.pedCount; i++) {
    state.peds.push(createPed(world, rng, state.player));
  }
  for (let i = 0; i < CONFIG.cashDropCount; i++) {
    const p = world.randomRoadPoint(rng);
    state.cashDrops.push({
      x: p.x,
      y: p.y,
      amount: rng.int(CONFIG.cashDropMin, CONFIG.cashDropMax),
    });
  }
  state.camera.x = spawn.x;
  state.camera.y = spawn.y;
  return state;
}

function applySave(state, data) {
  state.cash = data.cash;
  state.stats.lifetimeCash = data.lifetimeCash;
  state.wanted = data.wanted || 0;
  state.timeHours = data.timeHours ?? CONFIG.startHour;
  state.player.x = data.player.x;
  state.player.y = data.player.y;
  state.player.angle = data.player.angle || 0;
  state.player.health = data.player.health ?? CONFIG.playerHealth;
  state.missionsCompleted = data.missionsCompleted || [];
  state.currentMission = data.currentMission || 0;
  Object.assign(state.stats, data.stats || {});
  Object.assign(state.settings, data.settings || {});
  state.rank = rankFor(state.stats.lifetimeCash);
  if (data.vehicle) {
    const v = createVehicle(data.vehicle.type, data.vehicle.x, data.vehicle.y, data.vehicle.angle, data.vehicle.color);
    v.driver = 'player';
    v.health = data.vehicle.health ?? v.spec.health;
    state.vehicles.push(v);
    state.player.vehicle = v;
  }
  state.camera.x = state.player.x;
  state.camera.y = state.player.y;
}

function spawnCashDrop(state) {
  const p = state.world.randomRoadPoint(state.rng);
  state.cashDrops.push({
    x: p.x,
    y: p.y,
    amount: state.rng.int(CONFIG.cashDropMin, CONFIG.cashDropMax),
  });
}

// --- Demo driver (screenshot scenes): throttle + lane keeping -------------
function demoDriveInput(state) {
  const v = state.player.vehicle;
  if (!v) return null;
  const world = state.world;
  const speed = Math.hypot(v.vx, v.vy);
  let throttle = speed < v.spec.topSpeed * 0.62 ? 0.85 : 0.1;
  // Which axis are we travelling on?
  const verticalTravel = Math.abs(Math.sin(v.angle)) > Math.abs(Math.cos(v.angle));
  const axis = verticalTravel ? 'v' : 'h';
  const along = axis === 'v' ? v.y : v.x;
  const dir = axis === 'v' ? Math.sign(Math.sin(v.angle)) || 1 : Math.sign(Math.cos(v.angle)) || 1;
  // At a junction, sometimes turn.
  const lines = axis === 'v' ? world.horizontal : world.vertical;
  let nextDist = Infinity;
  for (const line of lines) {
    const d = (line - along) * dir;
    if (d > 0 && d < nextDist) nextDist = d;
  }
  if (state.demoTargetAngle === null && !state.demoNoTurn && nextDist < 40 && Math.random() < 0.45) {
    const turnLeft = Math.random() < 0.5;
    const base = axis === 'v' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
    state.demoTargetAngle = base + (turnLeft ? -Math.PI / 2 : Math.PI / 2);
    state.demoTurnUntil = state.now + 2.5;
  }
  if (state.demoTargetAngle !== null) {
    if (state.now > state.demoTurnUntil) state.demoTargetAngle = null;
    else {
      let diff = state.demoTargetAngle - v.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) < 0.15) state.demoTargetAngle = null;
      else return { throttle, steer: Math.max(-1, Math.min(1, diff * 2.5)), handbrake: false };
    }
  }
  // Lane keeping by pure pursuit: aim at a point on the lane centreline
  // 90 units ahead, on the road of the axis we are actually travelling on.
  const roadLines = axis === 'v' ? world.vertical : world.horizontal;
  const pos = axis === 'v' ? v.x : v.y;
  let roadCoord = roadLines[0];
  let bestD = Infinity;
  for (const line of roadLines) {
    const d = Math.abs(line - pos);
    if (d < bestD) { bestD = d; roadCoord = line; }
  }
  const laneOff = axis === 'v' ? (dir > 0 ? -10 : 10) : (dir > 0 ? 10 : -10);
  const lookAhead = 90;
  const tx = axis === 'v' ? roadCoord + laneOff : along + dir * lookAhead;
  const ty = axis === 'v' ? along + dir * lookAhead : roadCoord + laneOff;
  const target = Math.atan2(ty - v.y, tx - v.x);
  let diff = target - v.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  // Near the end of a road, turn around instead of driving into the harbour.
  if ((dir > 0 && along > 1680) || (dir < 0 && along < 120)) {
    throttle = 0.4;
    return { throttle, steer: 1, handbrake: false };
  }
  return { throttle, steer: Math.max(-1, Math.min(1, diff * 2.2)), handbrake: false };
}

// --- Simulation ------------------------------------------------------------

function updatePlaying(state, dt) {
  state.now += dt;
  state.timeHours = (state.timeHours + (dt / CONFIG.dayLengthSec) * 24) % 24;

  // Mouse position in world coordinates (for aiming).
  const canvas = state.canvas;
  state.mouseWorld.x = state.camera.x - canvas.width / 2 + state.input.mouse.x;
  state.mouseWorld.y = state.camera.y - canvas.height / 2 + state.input.mouse.y;

  // Demo driver overrides the keyboard for screenshot scenes.
  if (state.demoDrive && state.player.vehicle) {
    const demo = demoDriveInput(state);
    if (demo) {
      const input = state.input;
      input._testSet('KeyW', demo.throttle > 0.3);
      input._testSet('KeyS', false);
      input._testSet('KeyA', demo.steer < -0.15);
      input._testSet('KeyD', demo.steer > 0.15);
      input._testSet('Space', demo.handbrake);
    }
  }

  updatePlayer(state.player, state, dt);
  updateBullets(state, dt);

  // Traffic and parked cars.
  const threats = state.threats.filter((t) => state.now < t.until);
  state.threats = threats;
  for (const v of state.vehicles) {
    if (v.driver === 'traffic') {
      updateTrafficCar(v, dt, state.world, state.vehicles, threats, state.now);
    } else if (v.driver !== 'player' && (v.vx !== 0 || v.vy !== 0)) {
      // A bumped parked car coasts to a stop.
      v.vx *= Math.exp(-2 * dt);
      v.vy *= Math.exp(-2 * dt);
      v.x += v.vx * dt;
      v.y += v.vy * dt;
      if (Math.hypot(v.vx, v.vy) < 1) { v.vx = 0; v.vy = 0; }
    }
    if (v.wrecked && !v.sinking && Math.random() < dt * 2) {
      burst(state, v.x, v.y, '#555555', 1, 20, 0.9, 5);
    }
  }
  resolveVehicleCollisions(state.vehicles, state.events);

  // Pedestrians.
  for (let i = state.peds.length - 1; i >= 0; i--) {
    const p = state.peds[i];
    updatePed(p, dt, state.world, threats, state.now, state.vehicles);
    // Remove long-dead bodies and peds who wandered far from the player.
    if ((p.state === 'dead' && p.deadTimer > 25) ||
        Math.hypot(p.x - state.player.x, p.y - state.player.y) > 1100) {
      state.peds.splice(i, 1);
    }
  }
  const targetPeds = targetPedCount(state.timeHours);
  if (state.peds.length < targetPeds && state.now > state.nextPedSpawn) {
    state.nextPedSpawn = state.now + 1.5;
    state.peds.push(createPed(state.world, state.rng, state.player));
  }

  // Keep traffic topped up after thefts and wrecks.
  const trafficCount = state.vehicles.filter((v) => v.driver === 'traffic').length;
  if (trafficCount < CONFIG.trafficCount && state.now > state.nextTrafficSpawn) {
    state.nextTrafficSpawn = state.now + 2;
    state.vehicles.push(spawnTrafficCar(state.world, state.rng, state.player));
  }

  // Particles and skid marks decay.
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const pt = state.particles[i];
    pt.life -= dt;
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.vx *= Math.exp(-2 * dt);
    pt.vy *= Math.exp(-2 * dt);
    if (pt.life <= 0) state.particles.splice(i, 1);
  }
  for (let i = state.skidmarks.length - 1; i >= 0; i--) {
    state.skidmarks[i].life -= dt;
    if (state.skidmarks[i].life <= 0) state.skidmarks.splice(i, 1);
  }

  // Cash pickups.
  for (let i = state.cashDrops.length - 1; i >= 0; i--) {
    const drop = state.cashDrops[i];
    if (Math.hypot(state.player.x - drop.x, state.player.y - drop.y) < CONFIG.cashPickupRadius) {
      state.cashDrops.splice(i, 1);
      state.addCash(drop.amount, 'Cash found');
      state.audio.pickup();
      burst(state, drop.x, drop.y, '#3cdc78', 10, 120, 0.5, 3);
    }
  }
  if (state.cashDrops.length < CONFIG.cashDropCount && state.now > state.nextCashSpawn) {
    state.nextCashSpawn = state.now + 4;
    spawnCashDrop(state);
  }

  // Wanted decay: a quiet stretch drops one star at a time.
  if (state.wanted > 0 && state.now - state.lastCrimeAt > CONFIG.wantedDecaySec) {
    state.lastCrimeAt = state.now;
    state.wanted -= 1;
    if (state.wanted === 0) {
      state.stats.bustsEscaped++;
      state.addMessage('You lost them — wanted level clear.');
    } else {
      state.addMessage(`Wanted level down — ${state.wanted} star${state.wanted > 1 ? 's' : ''}.`);
    }
  }

  // Event sounds and effects.
  for (const ev of state.events) {
    if (ev.kind === 'crash') {
      state.audio.crash(ev.strength);
      burst(state, ev.x, ev.y, '#ffb84a', 6, 140, 0.35, 2.5);
      if (ev.byPlayer) state.addWanted(1, 'Hit a car');
    } else if (ev.kind === 'wreck') {
      state.audio.explosion();
      burst(state, ev.x, ev.y, '#ff7a2d', 22, 220, 0.7, 4);
      burst(state, ev.x, ev.y, '#555555', 12, 90, 1.2, 5);
    } else if (ev.kind === 'splash') {
      state.audio.splash();
      burst(state, ev.x, ev.y, '#7ac8e8', 20, 160, 0.6, 3);
      state.addMessage('The car went into the harbour!');
    }
  }
  state.events.length = 0;

  // Wasted.
  if (state.player.dead && state.mode === 'playing') {
    state.wastedTimer = 0;
    state.audio.engineStop();
    setMode(state, 'wasted');
  }

  // Autosave every 45 seconds of play.
  state.autosaveTimer += dt;
  if (state.autosaveTimer > 45) {
    state.autosaveTimer = 0;
    saveGame(state);
  }

  updateCamera(state.camera, state.player.vehicle || state.player, dt, state.canvas.width, state.canvas.height, state.world.size);
}

function updateMenu(state, dt) {
  state.now += dt;
  state.timeHours = (state.timeHours + (dt / CONFIG.dayLengthSec) * 24) % 24;
  for (const v of state.vehicles) {
    if (v.driver === 'traffic') updateTrafficCar(v, dt, state.world, state.vehicles, [], state.now);
  }
  for (const p of state.peds) {
    updatePed(p, dt, state.world, [], state.now, state.vehicles);
  }
  if (state.menuPan) {
    const t = state.now * 0.05;
    state.camera.x = 1000 + Math.cos(t) * 320;
    state.camera.y = 900 + Math.sin(t * 1.3) * 220;
  }
}

// --- Menus and overlays ------------------------------------------------------

function showOnly(ids, visibleId) {
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.style.display = id === visibleId ? 'flex' : 'none';
  }
}

const OVERLAYS = ['overlay-start', 'overlay-pause', 'overlay-help', 'overlay-wasted'];

function setMode(state, mode) {
  state.mode = mode;
  const hud = document.getElementById('hud');
  if (mode === 'playing') {
    showOnly(OVERLAYS, null);
    hud.style.display = 'block';
    state.audio.bassStop();
  } else if (mode === 'paused') {
    showOnly(OVERLAYS, 'overlay-pause');
  } else if (mode === 'menu') {
    showOnly(OVERLAYS, 'overlay-start');
    hud.style.display = 'none';
    document.getElementById('btn-continue').style.display = saveExists() ? 'block' : 'none';
  } else if (mode === 'wasted') {
    showOnly(OVERLAYS, 'overlay-wasted');
  }
}

function respawn(state) {
  const hospital = state.world.landmarks.hospital;
  const penalty = Math.max(100, Math.floor(state.cash * 0.1));
  state.cash = Math.max(0, state.cash - penalty);
  state.addMessage(`Hospital bill: -$${penalty}`);
  state.player.dead = false;
  state.player.health = CONFIG.playerHealth;
  state.player.vehicle = null;
  state.player.x = hospital.x;
  state.player.y = hospital.y + 40;
  state.wanted = 0;
  state.camera.x = state.player.x;
  state.camera.y = state.player.y;
  setMode(state, 'playing');
}

// --- Bootstrap -----------------------------------------------------------------

function main() {
  const canvas = document.getElementById('game');
  const params = queryParams();
  const state = createState(params.seed, canvas);
  state.canvas = canvas;

  state.audio = createAudio();
  state.input = createInput(canvas);
  state.hud = createHud(document);

  // Audio unlocks on the first gesture, as browsers require.
  const unlock = () => {
    state.audio.unlock();
    if (state.mode === 'menu') state.audio.bassStart();
  };
  window.addEventListener('keydown', unlock, { once: false });
  window.addEventListener('pointerdown', unlock, { once: false });

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  // Menu buttons.
  document.getElementById('btn-new').addEventListener('click', () => {
    state.audio.unlock();
    state.audio.click();
    if (saveExists() && !window.confirm('Start a new game? Your saved progress will be wiped.')) return;
    clearSave();
    const fresh = createState(params.seed, canvas);
    Object.assign(state, fresh);
    state.audio = createAudio();
    state.audio.setMuted(false);
    state.input = createInput(canvas);
    state.hud = createHud(document);
    state.canvas = canvas;
    setMode(state, 'playing');
    state.addMessage('Welcome to Neon Harbor, Rook.');
    state.addMessage('Steal a car and head for Marlow\'s garage (M on the map).');
    state.hud.refresh(state);
  });
  document.getElementById('btn-continue').addEventListener('click', () => {
    state.audio.unlock();
    state.audio.click();
    const data = loadGame();
    if (!data) return;
    const fresh = createState(data.seed || params.seed, canvas);
    Object.assign(state, fresh);
    state.audio = createAudio();
    state.input = createInput(canvas);
    state.hud = createHud(document);
    state.canvas = canvas;
    applySave(state, data);
    state.audio.setMuted(state.settings.muted);
    setMode(state, 'playing');
    state.addMessage('Welcome back, Rook.');
    state.hud.refresh(state);
  });
  document.getElementById('btn-help').addEventListener('click', () => {
    state.audio.click();
    showOnly(OVERLAYS, 'overlay-help');
  });
  document.getElementById('btn-help-back').addEventListener('click', () => {
    state.audio.click();
    showOnly(OVERLAYS, state.mode === 'playing' || state.mode === 'paused' ? 'overlay-pause' : 'overlay-start');
    if (state.mode === 'playing') setMode(state, 'playing');
  });
  document.getElementById('btn-resume').addEventListener('click', () => {
    state.audio.click();
    setMode(state, 'playing');
  });
  document.getElementById('btn-save').addEventListener('click', () => {
    state.audio.click();
    saveGame(state);
    state.addMessage('Progress saved.');
    setMode(state, 'playing');
  });
  document.getElementById('btn-restart').addEventListener('click', () => {
    state.audio.click();
    const safe = state.world.landmarks.safehouse;
    if (state.player.vehicle) state.player.vehicle.driver = 'parked';
    state.player.vehicle = null;
    state.player.x = safe.x;
    state.player.y = safe.y;
    state.player.health = CONFIG.playerHealth;
    state.wanted = 0;
    state.camera.x = safe.x;
    state.camera.y = safe.y;
    state.addMessage('Back at the safehouse.');
    setMode(state, 'playing');
  });
  document.getElementById('btn-mute').addEventListener('click', () => {
    toggleMute(state);
  });
  document.getElementById('btn-quit').addEventListener('click', () => {
    state.audio.click();
    saveGame(state);
    setMode(state, 'menu');
  });
  document.getElementById('btn-respawn').addEventListener('click', () => {
    state.audio.click();
    respawn(state);
  });

  function toggleMute(s) {
    s.settings.muted = !s.settings.muted;
    s.audio.setMuted(s.settings.muted);
    const btn = document.getElementById('btn-mute');
    if (btn) btn.textContent = s.settings.muted ? 'Unmute (M)' : 'Mute (M)';
    s.addMessage(s.settings.muted ? 'Sound off.' : 'Sound on.');
  }
  state.toggleMute = () => toggleMute(state);

  // Autosave when the tab hides.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.mode === 'playing') saveGame(state);
  });

  // Screenshot scenes (?shot=...): pose the game, then start it.
  let shotReady = false;
  if (params.shot) {
    const started = setupShot(state, params.shot);
    if (started) {
      setMode(state, 'playing');
    } else {
      setMode(state, 'menu');
    }
    state.hud.refresh(state);
  } else {
    setMode(state, 'menu');
  }

  // Debug handle for playtests (not part of the game itself).
  window.__game = {
    state,
    version: 'neon-harbor-stage1',
    teleport(x, y) {
      state.player.x = x;
      state.player.y = y;
      if (state.player.vehicle) {
        state.player.vehicle.x = x;
        state.player.vehicle.y = y;
      }
      state.camera.x = x;
      state.camera.y = y;
    },
    giveCar(type) {
      const v = createVehicle(type || 'sedan', state.player.x + 40, state.player.y, 0);
      v.driver = 'player';
      state.vehicles.push(v);
      state.player.vehicle = v;
      return v;
    },
    setTime(h) {
      state.timeHours = h;
    },
    addCash(n) {
      state.addCash(n);
    },
    setWanted(n) {
      state.wanted = n;
    },
    start() {
      setMode(state, 'playing');
    },
  };

  // Fixed-step loop.
  const ctx = canvas.getContext('2d');
  let last = performance.now();
  let acc = 0;
  let frames = 0;
  function frame(nowMs) {
    requestAnimationFrame(frame);
    const dtMs = Math.min(100, nowMs - last);
    last = nowMs;
    acc += dtMs / 1000;
    let steps = 0;
    while (acc >= STEP && steps < 5) {
      if (state.mode === 'playing') updatePlaying(state, STEP);
      else if (state.mode === 'menu') updateMenu(state, STEP);
      else if (state.mode === 'wasted') {
        state.wastedTimer += STEP;
        // The world freezes on the wasted screen; the overlay covers it.
      }
      acc -= STEP;
      steps++;
    }
    if (steps === 5) acc = 0;

    // Global keys.
    if (state.input.wasPressed('KeyM')) toggleMute(state);
    if (state.input.anyPressed('KeyP', 'Escape')) {
      if (state.mode === 'playing') {
        setMode(state, 'paused');
        saveGame(state);
      } else if (state.mode === 'paused') {
        setMode(state, 'playing');
      }
    }
    if (state.input.wasPressed('KeyH')) {
      if (state.mode === 'playing') setMode(state, 'paused');
      showOnly(OVERLAYS, 'overlay-help');
    }

    render(state, ctx, canvas);
    if (state.mode === 'playing' || state.mode === 'paused' || state.mode === 'wasted') {
      state.hud.update(state, dtMs / 1000);
    }
    state.input.endFrame();

    frames++;
    if (!shotReady && frames >= 3) {
      shotReady = true;
      window.__shotReady = true;
    }
  }
  requestAnimationFrame(frame);
}

main();
