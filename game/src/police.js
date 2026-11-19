// NEON HARBOR — police. The wanted level drives a real pursuit: cruisers
// spawn at the map edges and chase the player (ramming, cutting ahead of
// them, boxing them in), on-foot officers chase a player on foot,
// roadblocks go up at 3+ stars, and police shoot at 4+ stars. Breaking
// line of sight starts an evade timer; staying hidden until it runs out
// clears the wanted level. Getting caught on foot at low speed, or boxed
// in while stopped in a car, means busted.

import { CONFIG } from './config.js';
import { createVehicle, driveVehicle } from './vehicles.js';

// Seconds hidden to lose the cops: longer at higher wanted levels.
export function evadeTotalFor(wanted) {
  return CONFIG.policeEvadeBase + wanted * CONFIG.policeEvadePerStar;
}

function cruisersWanted(wanted) {
  return Math.min(5, Math.max(0, wanted));
}

function officersWanted(wanted) {
  if (wanted >= 5) return 4;
  if (wanted >= 4) return 3;
  if (wanted >= 2) return 2;
  if (wanted >= 1) return 1;
  return 0;
}

export function createPoliceState() {
  return {
    officers: [], // on-foot officers chasing the player
    roadblocks: [], // parked cruisers blocking a road ahead
    lastSeen: null, // last place any police unit saw the player
    seen: false, // some police unit can see the player right now
    evadeTimer: 0, // counts down while hidden; zero clears the wanted level
    bustTimer: 0, // time spent pinned by police
    bustWarned: false,
    busted: false, // main.js picks this up and shows the busted screen
    spawnTimer: 0,
    officerTimer: 0,
    roadblockTimer: 0,
    visionTimer: 0,
    searchUntil: 0,
    searchX: 0,
    searchY: 0,
  };
}

// --- Line of sight --------------------------------------------------------
// A police unit sees the player only with an unblocked line between them;
// buildings break sight, which is what makes hiding work.

function segSeg(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d1 = (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
  const d2 = (x2 - x1) * (y4 - y1) - (y2 - y1) * (x4 - x1);
  const d3 = (x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3);
  const d4 = (x4 - x3) * (y2 - y3) - (y4 - y3) * (x2 - x3);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function segmentHitsRect(x1, y1, x2, y2, b) {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  if (b.x > maxX || b.x + b.w < minX || b.y > maxY || b.y + b.h < minY) return false;
  if (x1 >= b.x && x1 <= b.x + b.w && y1 >= b.y && y1 <= b.y + b.h) return true;
  if (x2 >= b.x && x2 <= b.x + b.w && y2 >= b.y && y2 <= b.y + b.h) return true;
  return segSeg(x1, y1, x2, y2, b.x, b.y, b.x + b.w, b.y) ||
    segSeg(x1, y1, x2, y2, b.x + b.w, b.y, b.x + b.w, b.y + b.h) ||
    segSeg(x1, y1, x2, y2, b.x + b.w, b.y + b.h, b.x, b.y + b.h) ||
    segSeg(x1, y1, x2, y2, b.x, b.y + b.h, b.x, b.y);
}

export function hasLineOfSight(world, x1, y1, x2, y2) {
  for (const b of world.buildings) {
    if (segmentHitsRect(x1, y1, x2, y2, b)) return false;
  }
  return true;
}

function anyPoliceSeesPlayer(state) {
  const player = state.player;
  const world = state.world;
  for (const v of state.vehicles) {
    if ((v.driver !== 'police' && v.driver !== 'roadblock') || v.wrecked || v.sinking) continue;
    if (Math.hypot(v.x - player.x, v.y - player.y) > CONFIG.policeSightRange) continue;
    if (hasLineOfSight(world, v.x, v.y, player.x, player.y)) return true;
  }
  for (const o of state.police.officers) {
    if (o.state === 'down') continue;
    if (Math.hypot(o.x - player.x, o.y - player.y) > CONFIG.policeOfficerSight) continue;
    if (hasLineOfSight(world, o.x, o.y, player.x, player.y)) return true;
  }
  return false;
}

// Is there a police unit close enough to witness a crime?
export function policeNearby(state, x, y, radius) {
  for (const v of state.vehicles) {
    if (v.type !== 'police' || v.wrecked || v.sinking) continue;
    if (v.driver === 'player') continue;
    if (Math.hypot(v.x - x, v.y - y) < radius) return true;
  }
  for (const o of state.police.officers) {
    if (o.state !== 'down' && Math.hypot(o.x - x, o.y - y) < radius) return true;
  }
  return false;
}

// --- Spawning ---------------------------------------------------------------

export function spawnCruiser(state, x, y, angle, role) {
  const v = createVehicle('police', x, y, angle);
  v.driver = 'police';
  v.policeRole = role || 'chase'; // 'chase' | 'cut' | 'flank'
  v.policeSide = Math.random() < 0.5 ? 1 : -1;
  v.stuckTimer = 0;
  v.reverseUntil = 0;
  v.throttleIntent = 0;
  state.vehicles.push(v);
  return v;
}

// Cruisers arrive from the map edge: the end of the road nearest the
// player, far enough away that they are not on screen when they appear.
function spawnCruiserAtEdge(state) {
  const world = state.world;
  const p = state.player;
  const near = world.nearestRoad(p.x, p.y);
  const along = near.axis === 'v' ? p.y : p.x;
  const dLow = Math.abs(80 - along);
  const dHigh = Math.abs(1720 - along);
  let end = dLow < dHigh ? 80 : 1720;
  if (Math.min(dLow, dHigh) < 500) end = dLow < dHigh ? 1720 : 80;
  end += (Math.random() - 0.5) * 40;
  const x = near.axis === 'v' ? near.coord : end;
  const y = near.axis === 'v' ? end : near.coord;
  const angle = near.axis === 'v'
    ? (end > along ? -Math.PI / 2 : Math.PI / 2)
    : (end > along ? Math.PI : 0);
  const roles = ['chase', 'cut', 'flank', 'chase', 'cut'];
  const existing = state.vehicles.filter((v) => v.driver === 'police').length;
  return spawnCruiser(state, x, y, angle, roles[existing % roles.length]);
}

export function createOfficer(x, y) {
  return {
    x, y,
    angle: 0,
    state: 'chase', // 'chase' | 'down'
    downTimer: 0,
    fireCooldown: 0,
    walkPhase: Math.random() * Math.PI * 2,
    speed: 200, // fast, but a sprinting player can outrun them
  };
}

function spawnOfficerNear(state) {
  const world = state.world;
  const p = state.player;
  const near = world.nearestRoad(p.x, p.y);
  const along = near.axis === 'v' ? p.y : p.x;
  const dir = Math.random() < 0.5 ? 1 : -1;
  let a = along + dir * (170 + Math.random() * 90);
  a = Math.max(60, Math.min(1740, a));
  const off = (Math.random() < 0.5 ? 1 : -1) * (CONFIG.roadHalf + 5);
  const x = near.axis === 'v' ? near.coord + off : a;
  const y = near.axis === 'v' ? a : near.coord + off;
  const fixed = world.collideCircle(x, y, 10);
  const o = createOfficer(fixed.x, fixed.y);
  state.police.officers.push(o);
  return o;
}

// Remove every police unit (wanted cleared, busted, respawn, new game).
export function clearPolice(state) {
  const police = state.police;
  // A cruiser the player stole and drives stays theirs.
  state.vehicles = state.vehicles.filter((v) => v.type !== 'police' || v.driver === 'player');
  police.officers = [];
  police.roadblocks = [];
  police.lastSeen = null;
  police.seen = false;
  police.evadeTimer = 0;
  police.bustTimer = 0;
  police.bustWarned = false;
  police.busted = false;
  state.audio.sirenStop();
}

// --- Cruiser chase AI ---------------------------------------------------------

function updateCruiser(state, v, dt) {
  const police = state.police;
  const player = state.player;
  const wanted = state.wanted;
  const fwdSpeed = v.vx * Math.cos(v.angle) + v.vy * Math.sin(v.angle);

  // Stuck detection: full throttle but barely moving means wedged on a
  // building or another car — reverse briefly to get free.
  if (Math.abs(fwdSpeed) < 12 && v.throttleIntent > 0.5) {
    v.stuckTimer = (v.stuckTimer || 0) + dt;
  } else {
    v.stuckTimer = 0;
  }
  if (v.stuckTimer > 2.2) {
    v.reverseUntil = state.now + 0.9;
    v.stuckTimer = 0;
  }

  // Target point: the player when seen, the last seen spot when hidden,
  // and a slow search around that spot once the cruiser gets there.
  let tx;
  let ty;
  if (police.seen) {
    tx = player.x;
    ty = player.y;
    const pvx = player.vehicle ? player.vehicle.vx : 0;
    const pvy = player.vehicle ? player.vehicle.vy : 0;
    if (v.policeRole === 'cut') {
      // Aim ahead of the player to cut them off.
      tx += pvx * 0.85;
      ty += pvy * 0.85;
    } else if (v.policeRole === 'flank') {
      // Aim beside the player to squeeze them from the side.
      const sp = Math.hypot(pvx, pvy);
      const hx = sp > 30 ? pvx / sp : Math.cos(player.angle);
      const hy = sp > 30 ? pvy / sp : Math.sin(player.angle);
      const side = v.policeSide || 1;
      tx += -hy * 70 * side;
      ty += hx * 70 * side;
    }
  } else if (police.lastSeen) {
    const dLast = Math.hypot(v.x - police.lastSeen.x, v.y - police.lastSeen.y);
    if (dLast < 80) {
      if (state.now > police.searchUntil) {
        police.searchUntil = state.now + 4;
        const a = Math.random() * Math.PI * 2;
        const r = 120 + Math.random() * 120;
        police.searchX = police.lastSeen.x + Math.cos(a) * r;
        police.searchY = police.lastSeen.y + Math.sin(a) * r;
      }
      tx = police.searchX;
      ty = police.searchY;
    } else {
      tx = police.lastSeen.x;
      ty = police.lastSeen.y;
    }
  } else {
    tx = player.x;
    ty = player.y;
  }

  // Pure pursuit steering toward the target, with a speed cap that grows
  // with the wanted level (searching cruisers cruise slowly).
  const desired = Math.atan2(ty - v.y, tx - v.x);
  let diff = desired - v.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const searching = !police.seen;
  const speedScale = searching ? 0.45 : Math.min(1, 0.8 + wanted * 0.045);
  const targetSpeed = v.spec.topSpeed * speedScale;
  let throttle = fwdSpeed < targetSpeed ? 1 : 0.15;
  let steer = Math.max(-1, Math.min(1, diff * 2.4));
  let handbrake = Math.abs(diff) > 2.1 && Math.abs(fwdSpeed) > 160;
  if (state.now < (v.reverseUntil || 0)) {
    throttle = -1;
    steer = -steer;
    handbrake = false;
  }
  v.throttleIntent = throttle;
  driveVehicle(v, { throttle, steer, handbrake }, dt, state.world, state.events, false);
}

// --- Officers -------------------------------------------------------------------

function updateOfficers(state, dt) {
  const police = state.police;
  const player = state.player;
  for (const o of police.officers) {
    if (o.state === 'down') {
      o.downTimer -= dt;
      if (o.downTimer <= 0) o.state = 'chase';
      continue;
    }
    o.fireCooldown = Math.max(0, o.fireCooldown - dt);
    const tx = police.seen ? player.x : (police.lastSeen ? police.lastSeen.x : o.x);
    const ty = police.seen ? player.y : (police.lastSeen ? police.lastSeen.y : o.y);
    const dx = tx - o.x;
    const dy = ty - o.y;
    const d = Math.hypot(dx, dy);
    if (d > 24) {
      const nx = o.x + (dx / d) * o.speed * dt;
      const ny = o.y + (dy / d) * o.speed * dt;
      const fixed = state.world.collideCircle(nx, ny, 10);
      o.x = fixed.x;
      o.y = fixed.y;
      o.angle = Math.atan2(dy, dx);
      o.walkPhase += dt * 12;
    }
    // At 4+ stars officers open fire when they have the player in sight.
    if (state.wanted >= CONFIG.policeShootStars && police.seen && o.fireCooldown <= 0) {
      const pd = Math.hypot(player.x - o.x, player.y - o.y);
      if (pd < 430 && hasLineOfSight(state.world, o.x, o.y, player.x, player.y)) {
        o.fireCooldown = 0.9 + Math.random() * 0.5;
        const aim = Math.atan2(player.y - o.y, player.x - o.x) + (Math.random() - 0.5) * 0.22;
        state.bullets.push({
          x: o.x + Math.cos(aim) * 16,
          y: o.y + Math.sin(aim) * 16,
          vx: Math.cos(aim) * CONFIG.bulletSpeed,
          vy: Math.sin(aim) * CONFIG.bulletSpeed,
          life: CONFIG.bulletLife,
          fromPlayer: false,
        });
        state.audio.gunshot();
        state.threats.push({ x: o.x, y: o.y, until: state.now + 1.5 });
      }
    }
  }
  // Drop officers who ended up hopelessly far from the action.
  police.officers = police.officers.filter(
    (o) => Math.hypot(o.x - player.x, o.y - player.y) < 1400,
  );
}

// --- Roadblocks -------------------------------------------------------------------

function placeRoadblock(state) {
  const player = state.player;
  const world = state.world;
  const pv = player.vehicle;
  const speed = Math.hypot(pv.vx, pv.vy) || 1;
  const nx = pv.vx / speed;
  const ny = pv.vy / speed;
  // A point ahead of the player, snapped onto the nearest road.
  let ax = player.x + nx * 330;
  let ay = player.y + ny * 330;
  const near = world.nearestRoad(ax, ay);
  if (near.axis === 'v') ax = near.coord;
  else ay = near.coord;
  ax = Math.max(80, Math.min(1760, ax));
  ay = Math.max(80, Math.min(1760, ay));
  if (world.isWater(ax, ay)) return;
  // Two cruisers parked across the road, nose to tail.
  const spots = near.axis === 'v'
    ? [{ x: ax, y: ay - 17, angle: 0 }, { x: ax, y: ay + 17, angle: Math.PI }]
    : [{ x: ax - 17, y: ay, angle: Math.PI / 2 }, { x: ax + 17, y: ay, angle: -Math.PI / 2 }];
  for (const s of spots) {
    const v = createVehicle('police', s.x, s.y, s.angle);
    v.driver = 'roadblock';
    state.vehicles.push(v);
    state.police.roadblocks.push(v);
  }
  state.addMessage('Roadblock ahead!');
}

function removeRoadblocks(state) {
  const blocks = new Set(state.police.roadblocks);
  state.vehicles = state.vehicles.filter((v) => !blocks.has(v));
  state.police.roadblocks = [];
}

function updateRoadblocks(state, dt) {
  const police = state.police;
  const player = state.player;
  police.roadblocks = police.roadblocks.filter((v) => !v.wrecked && !v.sinking);
  if (police.roadblocks.length > 0) {
    // The block is spent once the player is well past it.
    const b = police.roadblocks[0];
    if (Math.hypot(b.x - player.x, b.y - player.y) > 600) removeRoadblocks(state);
    return;
  }
  police.roadblockTimer -= dt;
  if (police.roadblockTimer > 0) return;
  if (!player.vehicle) return;
  if (Math.hypot(player.vehicle.vx, player.vehicle.vy) < 90) return;
  placeRoadblock(state);
  police.roadblockTimer = 8;
}

// --- Bust -------------------------------------------------------------------------

function checkBust(state, dt) {
  const police = state.police;
  const player = state.player;
  let pressure = false;
  let threshold = CONFIG.policeBustTime;
  if (!player.vehicle && !player.dead) {
    // On foot: an officer next to a slow or standing player grabs them.
    const pSpeed = player.moving
      ? (player.sprinting ? CONFIG.sprintSpeed : CONFIG.walkSpeed)
      : 0;
    if (pSpeed < 80) {
      for (const o of police.officers) {
        if (o.state === 'down') continue;
        if (Math.hypot(o.x - player.x, o.y - player.y) < 34) {
          pressure = true;
          break;
        }
      }
    }
  } else if (player.vehicle) {
    // In a car: stopped with two or more cruisers alongside means boxed in.
    const v = player.vehicle;
    if (!v.wrecked && Math.abs(v.speed) < 25) {
      let near = 0;
      for (const c of state.vehicles) {
        if (c.driver === 'police' && !c.wrecked && Math.hypot(c.x - v.x, c.y - v.y) < 110) near++;
      }
      if (near >= 2) {
        pressure = true;
        threshold = CONFIG.policeBoxedBustTime;
      }
    }
  }
  if (pressure) {
    police.bustTimer += dt;
    if (police.bustTimer > 0.7 && !police.bustWarned) {
      police.bustWarned = true;
      state.addMessage('The cops are on you — RUN!');
    }
    if (police.bustTimer >= threshold) police.busted = true;
  } else {
    police.bustTimer = 0;
    police.bustWarned = false;
  }
}

// --- Main update --------------------------------------------------------------------

export function updatePolice(state, dt) {
  const police = state.police;
  const player = state.player;
  const wanted = state.wanted;

  if (wanted <= 0) {
    if (police.officers.length > 0 ||
        state.vehicles.some((v) => v.driver === 'police' || v.driver === 'roadblock')) {
      clearPolice(state);
    }
    state.audio.sirenStop();
    return;
  }

  // Vision, throttled: seeing the player resets the evade timer and
  // updates the last seen spot every cruiser is heading for.
  police.visionTimer -= dt;
  if (police.visionTimer <= 0) {
    police.visionTimer = 0.15;
    police.seen = anyPoliceSeesPlayer(state);
    if (police.seen) {
      police.lastSeen = { x: player.x, y: player.y };
      police.evadeTimer = evadeTotalFor(wanted);
    }
  }

  const cruisers = state.vehicles.filter((v) => v.driver === 'police' && !v.wrecked);
  const units = cruisers.length + police.officers.filter((o) => o.state !== 'down').length;

  // Evade: hidden from every unit, the timer runs out and the heat is off.
  // It only runs once police are actually out looking.
  if (!police.seen && units > 0) {
    if (police.evadeTimer <= 0) police.evadeTimer = evadeTotalFor(wanted);
    police.evadeTimer -= dt;
    if (police.evadeTimer <= 0) {
      state.wanted = 0;
      state.stats.bustsEscaped++;
      state.addMessage('You lost them — wanted level clear.');
      clearPolice(state);
      return;
    }
  }

  // Spawn cruisers up to the wanted level's count.
  police.spawnTimer -= dt;
  if (cruisers.length < cruisersWanted(wanted) && police.spawnTimer <= 0) {
    police.spawnTimer = 1.2;
    spawnCruiserAtEdge(state);
  }

  // Officers only chase a player on foot; driving off leaves them behind.
  if (!player.vehicle) {
    police.officerTimer -= dt;
    const live = police.officers.filter((o) => o.state !== 'down').length;
    if (live < officersWanted(wanted) && police.officerTimer <= 0) {
      police.officerTimer = 1.5;
      spawnOfficerNear(state);
    }
  } else if (police.officers.length > 0) {
    police.officers = [];
  }

  for (const v of state.vehicles) {
    if (v.driver === 'police' && !v.wrecked && !v.sinking) updateCruiser(state, v, dt);
  }
  updateOfficers(state, dt);

  if (wanted >= CONFIG.roadblockStars) updateRoadblocks(state, dt);
  else if (police.roadblocks.length > 0) removeRoadblocks(state);

  checkBust(state, dt);

  // The siren follows the pursuit.
  const active = state.vehicles.some((v) => v.driver === 'police' && !v.wrecked);
  if (active) state.audio.sirenStart();
  else state.audio.sirenStop();
}
