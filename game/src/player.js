// NEON HARBOR — the player. On foot: walk, sprint, punch, aim with the
// mouse and shoot. In a car: drive via the vehicle physics, enter and exit
// with E. Stealing a car in view of a pedestrian raises the wanted level.
// Bullets live here too: a simple point model with building, pedestrian
// and vehicle hits.

import { CONFIG } from './config.js';
import { driveVehicle, vehicleCircles } from './vehicles.js';
import { hitPed } from './pedestrians.js';

export function createPlayer(x, y) {
  return {
    x, y,
    angle: 0, // facing, toward the mouse while on foot
    health: CONFIG.playerHealth,
    vehicle: null,
    moving: false,
    sprinting: false,
    fireCooldown: 0,
    punchCooldown: 0,
    hurtCooldown: 0,
    lastDamageAt: -100,
    dead: false,
    walkPhase: 0,
  };
}

export function burst(state, x, y, color, count, speed, life = 0.5, size = 3) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.3 + Math.random() * 0.7);
    state.particles.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: life * (0.6 + Math.random() * 0.7),
      maxLife: life,
      size: size * (0.6 + Math.random() * 0.8),
      color,
    });
  }
}

function nearestVehicle(state, x, y, maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const v of state.vehicles) {
    if (v.sinking) continue;
    const d = Math.hypot(v.x - x, v.y - y);
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}

function witnessNearby(state, x, y, radius) {
  for (const p of state.peds) {
    if (p.state !== 'dead' && Math.hypot(p.x - x, p.y - y) < radius) return true;
  }
  return false;
}

export function updatePlayer(player, state, dt) {
  const input = state.input;
  const world = state.world;
  player.fireCooldown = Math.max(0, player.fireCooldown - dt);
  player.punchCooldown = Math.max(0, player.punchCooldown - dt);
  player.hurtCooldown = Math.max(0, player.hurtCooldown - dt);

  // Slow health recovery after a quiet stretch.
  if (!player.dead && player.health < CONFIG.playerHealth && state.now - player.lastDamageAt > 8) {
    player.health = Math.min(CONFIG.playerHealth, player.health + 5 * dt);
  }

  // --- In a car ----------------------------------------------------------
  if (player.vehicle) {
    const v = player.vehicle;
    if (v.wrecked || v.sinking) {
      // The car died under the player: bail out beside it.
      exitVehicle(player, state);
      return;
    }
    const throttle =
      (input.isDown('KeyW') || input.isDown('ArrowUp') ? 1 : 0) +
      (input.isDown('KeyS') || input.isDown('ArrowDown') ? -1 : 0);
    const steer =
      (input.isDown('KeyA') || input.isDown('ArrowLeft') ? -1 : 0) +
      (input.isDown('KeyD') || input.isDown('ArrowRight') ? 1 : 0);
    const handbrake = input.isDown('Space');
    driveVehicle(v, { throttle, steer, handbrake }, dt, world, state.events);
    player.x = v.x;
    player.y = v.y;
    player.angle = v.angle;
    state.stats.distanceDriven += Math.abs(v.speed) * dt;
    if (v.skidTimer > 0) {
      v.skidTimer -= dt;
      state.skidmarks.push({ x: v.x, y: v.y, angle: v.angle, life: 6 });
    }
    state.audio.engine(Math.min(1, Math.abs(v.speed) / v.spec.topSpeed), true);
    if (input.wasPressed('KeyE')) exitVehicle(player, state);
    return;
  }

  state.audio.engine(0, false);

  // --- On foot -----------------------------------------------------------
  let mx = 0;
  let my = 0;
  if (input.isDown('KeyW') || input.isDown('ArrowUp')) my -= 1;
  if (input.isDown('KeyS') || input.isDown('ArrowDown')) my += 1;
  if (input.isDown('KeyA') || input.isDown('ArrowLeft')) mx -= 1;
  if (input.isDown('KeyD') || input.isDown('ArrowRight')) mx += 1;
  player.sprinting = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
  player.moving = mx !== 0 || my !== 0;
  if (player.moving) {
    const len = Math.hypot(mx, my);
    const speed = player.sprinting ? CONFIG.sprintSpeed : CONFIG.walkSpeed;
    const nx = player.x + (mx / len) * speed * dt;
    const ny = player.y + (my / len) * speed * dt;
    const fixed = world.collideCircle(nx, ny, CONFIG.playerRadius);
    player.x = fixed.x;
    player.y = fixed.y;
    player.walkPhase += dt * (player.sprinting ? 13 : 9);
  }

  // Face the mouse.
  const m = state.mouseWorld;
  player.angle = Math.atan2(m.y - player.y, m.x - player.x);

  // Shoot with the mouse button.
  if (input.mouse.down && player.fireCooldown <= 0) {
    player.fireCooldown = CONFIG.fireCooldown;
    fireBullet(player, state);
  }

  // Punch with F.
  if (input.wasPressed('KeyF') && player.punchCooldown <= 0) {
    player.punchCooldown = CONFIG.punchCooldown;
    punch(player, state);
  }

  // Enter a car with E.
  if (input.wasPressed('KeyE')) {
    const v = nearestVehicle(state, player.x, player.y, 52);
    if (v) enterVehicle(player, v, state);
    else state.addMessage('No car nearby — press E next to one.');
  }

  // Traffic can run the player down.
  if (player.hurtCooldown <= 0) {
    for (const v of state.vehicles) {
      if (v.wrecked || v.driver === 'parked') continue;
      const speed = Math.hypot(v.vx, v.vy);
      if (speed < 40) continue;
      for (const c of vehicleCircles(v)) {
        if (Math.hypot(player.x - c.x, player.y - c.y) < c.r + CONFIG.playerRadius) {
          damagePlayer(player, state, 12 + speed * 0.06, v.x, v.y);
          player.hurtCooldown = 0.6;
          break;
        }
      }
      if (player.hurtCooldown > 0) break;
    }
  }
}

export function damagePlayer(player, state, amount, fromX, fromY) {
  if (player.dead) return;
  player.health -= amount;
  player.lastDamageAt = state.now;
  burst(state, player.x, player.y, '#c8352c', 8, 120, 0.4, 3);
  if (fromX !== undefined) {
    const dx = player.x - fromX;
    const dy = player.y - fromY;
    const d = Math.hypot(dx, dy) || 1;
    const fixed = state.world.collideCircle(player.x + (dx / d) * 22, player.y + (dy / d) * 22, CONFIG.playerRadius);
    player.x = fixed.x;
    player.y = fixed.y;
  }
  if (player.health <= 0) {
    player.health = 0;
    player.dead = true;
  }
}

function fireBullet(player, state) {
  const m = state.mouseWorld;
  const angle = Math.atan2(m.y - player.y, m.x - player.x);
  const gx = player.x + Math.cos(angle) * 18;
  const gy = player.y + Math.sin(angle) * 18;
  state.bullets.push({
    x: gx, y: gy,
    vx: Math.cos(angle) * CONFIG.bulletSpeed,
    vy: Math.sin(angle) * CONFIG.bulletSpeed,
    life: CONFIG.bulletLife,
    fromPlayer: true,
  });
  state.stats.shotsFired++;
  state.audio.gunshot();
  burst(state, gx, gy, '#ffe08a', 4, 90, 0.12, 2.5);
  state.threats.push({ x: player.x, y: player.y, until: state.now + 1.5 });
  if (witnessNearby(state, player.x, player.y, 300)) {
    state.addWanted(1, 'Shots fired');
  }
}

function punch(player, state) {
  state.audio.punch();
  const reach = CONFIG.punchRange;
  const fx = Math.cos(player.angle);
  const fy = Math.sin(player.angle);
  for (const p of state.peds) {
    if (p.state === 'dead') continue;
    const dx = p.x - player.x;
    const dy = p.y - player.y;
    const d = Math.hypot(dx, dy);
    if (d > reach + 12) continue;
    if (d > 1 && (dx * fx + dy * fy) / d < 0.3) continue;
    if (hitPed(p, CONFIG.punchDamage, player.x, player.y)) {
      burst(state, p.x, p.y, '#c8352c', 10, 140, 0.5, 3);
      state.addWanted(1, 'Pedestrian down');
      state.stats.pedsHit++;
    }
    return;
  }
  // A whiff still makes a little noise.
  burst(state, player.x + fx * 20, player.y + fy * 20, '#ffffff', 2, 40, 0.15, 2);
}

function enterVehicle(player, v, state) {
  if (v.wrecked) {
    state.addMessage('That car is wrecked.');
    return;
  }
  const wasTraffic = v.driver === 'traffic';
  const wasParked = v.driver === 'parked';
  v.driver = 'player';
  player.vehicle = v;
  state.audio.click();
  if (wasTraffic || wasParked) {
    state.stats.carsStolen++;
    if (witnessNearby(state, player.x, player.y, 180)) {
      state.addWanted(1, 'Car stolen in view');
      state.addMessage(`Stole a ${v.spec.label} — someone saw!`);
    } else {
      state.addMessage(`Stole a ${v.spec.label} — clean getaway.`);
    }
  } else {
    state.addMessage(`Back in the ${v.spec.label}.`);
  }
}

function exitVehicle(player, state) {
  const v = player.vehicle;
  if (!v) return;
  // Step out to the car's left side.
  const lx = -Math.sin(v.angle);
  const ly = Math.cos(v.angle);
  const fixed = state.world.collideCircle(
    v.x + lx * (v.spec.h + 14),
    v.y + ly * (v.spec.h + 14),
    CONFIG.playerRadius,
  );
  player.x = fixed.x;
  player.y = fixed.y;
  player.vehicle = null;
  if (v.driver === 'player') v.driver = 'parked';
  state.audio.engineStop();
  state.audio.click();
}

// --- Bullets --------------------------------------------------------------

function pointInBuilding(world, x, y) {
  for (const b of world.buildings) {
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return true;
  }
  return false;
}

export function updateBullets(state, dt) {
  const world = state.world;
  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const b = state.bullets[i];
    b.life -= dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    let dead = b.life <= 0;
    if (!dead && (b.x < 0 || b.y < 0 || b.x >= world.size || b.y >= world.size)) dead = true;
    if (!dead && pointInBuilding(world, b.x, b.y)) {
      burst(state, b.x, b.y, '#d8d8d8', 3, 80, 0.25, 2);
      dead = true;
    }
    if (!dead && world.isWater(b.x, b.y)) {
      burst(state, b.x, b.y, '#7ac8e8', 4, 60, 0.3, 2);
      dead = true;
    }
    if (!dead) {
      for (const p of state.peds) {
        if (p.state === 'dead') continue;
        if (Math.hypot(p.x - b.x, p.y - b.y) < 13) {
          if (hitPed(p, CONFIG.bulletDamage, state.player.x, state.player.y)) {
            burst(state, p.x, p.y, '#c8352c', 12, 160, 0.5, 3);
            state.addWanted(1, 'Pedestrian down');
            state.stats.pedsHit++;
          }
          dead = true;
          break;
        }
      }
    }
    if (!dead) {
      for (const v of state.vehicles) {
        if (v === state.player.vehicle || v.sinking) continue;
        for (const c of vehicleCircles(v)) {
          if (Math.hypot(b.x - c.x, b.y - c.y) < c.r) {
            v.health -= CONFIG.bulletDamage;
            burst(state, b.x, b.y, '#ffb84a', 5, 120, 0.3, 2.5);
            if (v.health <= 0 && !v.wrecked) {
              v.wrecked = true;
              state.events.push({ kind: 'wreck', x: v.x, y: v.y, byPlayer: true, vehicle: v });
            }
            dead = true;
            break;
          }
        }
        if (dead) break;
      }
    }
    if (dead) state.bullets.splice(i, 1);
  }
}
