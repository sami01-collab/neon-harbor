// NEON HARBOR — pedestrians. They walk the sidewalks along the road grid,
// cross at junctions, and run from gunfire, crashes and speeding cars.
// Density scales with the time of day: the city quiets down at night.

import { CONFIG } from './config.js';

const SHIRT_COLORS = ['#d84a4a', '#4a8ad8', '#4ad88a', '#d8c84a', '#d84ad8', '#e8e8e8', '#4a4a4a', '#e88a4a', '#7a4ad8', '#4ad8d8'];
const SKIN_COLORS = ['#f2c89b', '#c88a5a', '#8a5a3a', '#e8b88a', '#6a4530'];

let nextId = 1;

export function createPed(world, rng, near) {
  const verticalRoad = rng.chance(0.5);
  const coord = rng.pick(verticalRoad ? world.vertical : world.horizontal);
  const along = rng.range(80, 1720);
  const side = rng.chance(0.5) ? 1 : -1;
  const off = (CONFIG.roadHalf + CONFIG.sidewalk / 2) * side;
  const p = {
    id: nextId++,
    x: verticalRoad ? coord + off : along,
    y: verticalRoad ? along : coord + off,
    angle: 0,
    speed: rng.range(28, 52),
    roadAxis: verticalRoad ? 'v' : 'h',
    roadCoord: coord,
    dir: rng.chance(0.5) ? 1 : -1,
    side,
    state: 'walk', // 'walk' | 'flee' | 'dead'
    fleeUntil: 0,
    fleeX: 0,
    fleeY: 0,
    deadTimer: 0,
    shirt: rng.pick(SHIRT_COLORS),
    skin: rng.pick(SKIN_COLORS),
    walkPhase: rng.range(0, Math.PI * 2),
    lastJunction: '',
  };
  p.angle = headingFor(p);
  if (near) {
    // Spawn a fair distance from the player so peds do not pop in on screen.
    for (let tries = 0; tries < 10 && Math.hypot(p.x - near.x, p.y - near.y) < 380; tries++) {
      const q = createPed(world, rng, null);
      Object.assign(p, q);
    }
  }
  return p;
}

function headingFor(p) {
  if (p.roadAxis === 'v') return p.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  return p.dir > 0 ? 0 : Math.PI;
}

// How many pedestrians the city should hold right now (quieter at night).
export function targetPedCount(hour) {
  if (hour >= 23 || hour < 5) return Math.floor(CONFIG.pedCount * 0.35);
  if (hour >= 19 || hour < 7) return Math.floor(CONFIG.pedCount * 0.6);
  return CONFIG.pedCount;
}

export function updatePed(p, dt, world, threats, now, vehicles) {
  if (p.state === 'dead') {
    p.deadTimer += dt;
    return;
  }
  // Flee from nearby threats; also bolt from a fast car heading at them.
  if (p.state !== 'flee') {
    for (const t of threats) {
      if (Math.hypot(p.x - t.x, p.y - t.y) < 260) {
        startFlee(p, t.x, t.y, now);
        break;
      }
    }
  }
  if (p.state !== 'flee') {
    for (const v of vehicles) {
      if (v.wrecked) continue;
      const speed = Math.hypot(v.vx, v.vy);
      if (speed < 150) continue;
      const dx = p.x - v.x;
      const dy = p.y - v.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 120 || dist < 1) continue;
      const closing = (dx * v.vx + dy * v.vy) / dist;
      if (closing > 100) {
        startFlee(p, v.x, v.y, now);
        break;
      }
    }
  }

  if (p.state === 'flee') {
    if (now > p.fleeUntil) {
      // Calm down: rejoin the nearest sidewalk.
      p.state = 'walk';
      const near = world.nearestRoad(p.x, p.y);
      p.roadAxis = near.axis;
      p.roadCoord = near.coord;
      p.side = Math.random() < 0.5 ? 1 : -1;
      p.dir = Math.random() < 0.5 ? 1 : -1;
    } else {
      const dx = p.x - p.fleeX;
      const dy = p.y - p.fleeY;
      const d = Math.hypot(dx, dy) || 1;
      const run = p.speed * 2.6;
      p.angle = Math.atan2(dy / d, dx / d);
      const nx = p.x + (dx / d) * run * dt;
      const ny = p.y + (dy / d) * run * dt;
      const fixed = world.collideCircle(nx, ny, CONFIG.playerRadius * 0.8);
      p.x = fixed.x;
      p.y = fixed.y;
      p.walkPhase += dt * 14;
      return;
    }
  }

  // Walking: follow the sidewalk; at junctions, sometimes turn or cross.
  const along = p.roadAxis === 'v' ? p.y : p.x;
  const lines = p.roadAxis === 'v' ? world.horizontal : world.vertical;
  let nextLine = null;
  let nextDist = Infinity;
  for (const line of lines) {
    const d = (line - along) * p.dir;
    if (d > 0 && d < nextDist) {
      nextDist = d;
      nextLine = line;
    }
  }
  if (nextLine === null || (p.dir > 0 && along > 1760) || (p.dir < 0 && along < 40)) {
    p.dir *= -1;
    p.lastJunction = '';
  } else if (nextDist < 14) {
    const key = p.roadAxis + p.roadCoord + '@' + nextLine;
    if (p.lastJunction !== key) {
      p.lastJunction = key;
      const roll = Math.random();
      if (roll < 0.3) {
        // Turn onto the crossing road.
        p.roadAxis = p.roadAxis === 'v' ? 'h' : 'v';
        p.roadCoord = nextLine;
        p.dir = Math.random() < 0.5 ? 1 : -1;
        p.side = Math.random() < 0.5 ? 1 : -1;
      } else if (roll < 0.45) {
        // Cross the street to the other sidewalk.
        p.side *= -1;
      }
    }
  }

  const targetAngle = headingFor(p);
  let diff = targetAngle - p.angle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  p.angle += diff * Math.min(1, 6 * dt);

  const off = (CONFIG.roadHalf + CONFIG.sidewalk / 2) * p.side;
  if (p.roadAxis === 'v') {
    p.x += (p.roadCoord + off - p.x) * Math.min(1, 3 * dt);
  } else {
    p.y += (p.roadCoord + off - p.y) * Math.min(1, 3 * dt);
  }
  p.x += Math.cos(p.angle) * p.speed * dt;
  p.y += Math.sin(p.angle) * p.speed * dt;
  p.walkPhase += dt * 8;
}

function startFlee(p, tx, ty, now) {
  p.state = 'flee';
  p.fleeX = tx;
  p.fleeY = ty;
  p.fleeUntil = now + 2.5 + Math.random() * 2;
}

// A pedestrian hit by a car or a bullet. Returns true if the hit killed them.
export function hitPed(p, damage, fromX, fromY) {
  if (p.state === 'dead') return false;
  p.state = 'dead';
  p.deadTimer = 0;
  // Fall away from the impact.
  const dx = p.x - fromX;
  const dy = p.y - fromY;
  const d = Math.hypot(dx, dy) || 1;
  p.angle = Math.atan2(dy / d, dx / d);
  return true;
}
