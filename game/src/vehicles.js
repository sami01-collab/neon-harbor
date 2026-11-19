// NEON HARBOR — vehicles. Arcade car physics with a drift model (the
// velocity vector lags the heading, and the handbrake cuts lateral grip),
// seven car types with distinct feel, traffic AI that follows the road
// grid, slows for cars ahead and flees gunfire, and car-vs-car and
// car-vs-building collision. Angles are radians, 0 = east, PI/2 = south
// (screen coordinates, y down).

import { CONFIG } from './config.js';

let nextId = 1;

export function createVehicle(type, x, y, angle, color) {
  const spec = CONFIG.carTypes[type] || CONFIG.carTypes.sedan;
  return {
    id: nextId++,
    type,
    spec,
    x, y, angle,
    vx: 0, vy: 0,
    speed: 0, // forward speed, signed
    color: color || spec.colors[0],
    health: spec.health,
    wrecked: false,
    sinking: false,
    driver: null, // 'player' | 'traffic' | 'parked' | null
    // Traffic AI state.
    roadAxis: 'v',
    roadCoord: 0,
    dir: 1,
    targetSpeed: 0,
    cruiseSpeed: 0,
    lastJunction: '',
    fleeUntil: 0,
    brakeLight: false,
    // Visual state.
    skidTimer: 0,
    smokeTimer: 0,
  };
}

// Two circles approximating the car body, for collision.
export function vehicleCircles(v) {
  const fx = Math.cos(v.angle);
  const fy = Math.sin(v.angle);
  const off = v.spec.w * 0.27;
  const r = v.spec.h * 0.62;
  return [
    { x: v.x + fx * off, y: v.y + fy * off, r },
    { x: v.x - fx * off, y: v.y - fy * off, r },
  ];
}

// --- Player driving physics --------------------------------------------
// input: { throttle: -1..1, steer: -1..1 (left is -1), handbrake: bool }
// Police cruisers drive through the same physics with isPlayer=false, so
// their crashes never count as the player's crimes.
export function driveVehicle(v, input, dt, world, events, isPlayer = true) {
  if (v.wrecked) {
    v.vx *= Math.exp(-2 * dt);
    v.vy *= Math.exp(-2 * dt);
    v.x += v.vx * dt;
    v.y += v.vy * dt;
    v.speed = 0;
    return;
  }
  const spec = v.spec;
  const fx = Math.cos(v.angle);
  const fy = Math.sin(v.angle);
  const rx = -fy;
  const ry = fx;

  // Split velocity into forward and lateral parts.
  let vf = v.vx * fx + v.vy * fy;
  let vr = v.vx * rx + v.vy * ry;

  // Steering: stronger at moderate speed, useless standing still, and it
  // flips in reverse. Handbrake sharpens the turn for drifts.
  const speedRatio = Math.min(1, Math.abs(vf) / spec.topSpeed);
  const steerAuthority = Math.min(1, Math.abs(vf) / 60) * (1 - speedRatio * 0.45);
  const turnRate = spec.turn * (input.handbrake ? 1.35 : 1);
  v.angle += input.steer * turnRate * steerAuthority * dt * (vf < -1 ? -1 : 1);

  // Recompute the forward vector after turning.
  const nfx = Math.cos(v.angle);
  const nfy = Math.sin(v.angle);
  const nrx = -nfy;
  const nry = nfx;
  vf = v.vx * nfx + v.vy * nfy;
  vr = v.vx * nrx + v.vy * nry;

  // Throttle / brake / reverse.
  if (input.throttle > 0) {
    vf += spec.accel * input.throttle * dt;
  } else if (input.throttle < 0) {
    if (vf > 8) {
      vf += spec.brake * input.throttle * dt; // braking
      v.brakeLight = true;
    } else {
      vf += spec.accel * 0.55 * input.throttle * dt; // reversing
    }
  }
  if (input.throttle >= 0) v.brakeLight = false;

  // Drag and rolling resistance.
  vf -= vf * 0.35 * dt;
  if (Math.abs(vf) < 2 && input.throttle === 0) vf = 0;
  vf = Math.max(-spec.topSpeed * 0.38, Math.min(spec.topSpeed, vf));

  // Lateral grip: the handbrake cuts it so the tail slides.
  const grip = input.handbrake ? 1.1 : spec.grip;
  vr *= Math.exp(-grip * dt);
  if (input.handbrake && Math.abs(vf) > 120) v.skidTimer = 0.1;

  v.vx = nfx * vf + nrx * vr;
  v.vy = nfy * vf + nry * vr;
  v.speed = vf;

  v.x += v.vx * dt;
  v.y += v.vy * dt;

  collideWithWorld(v, world, events, isPlayer);
}

// Push a car out of buildings and handle water. Returns true on a hard hit.
function collideWithWorld(v, world, events, isPlayer) {
  let hardHit = false;
  for (const c of vehicleCircles(v)) {
    const fixed = world.collideCircle(c.x, c.y, c.r);
    if (fixed.hit) {
      const impact = Math.hypot(v.vx, v.vy);
      // Move the whole car by the correction applied to the circle.
      v.x += fixed.x - c.x;
      v.y += fixed.y - c.y;
      if (impact > 90) {
        hardHit = true;
        const damage = (impact - 90) * 0.12;
        v.health -= damage;
        v.vx *= 0.35;
        v.vy *= 0.35;
        v.speed *= 0.35;
        if (events) events.push({ kind: 'crash', x: v.x, y: v.y, strength: Math.min(1, impact / 400), byPlayer: isPlayer });
      } else {
        v.vx *= 0.6;
        v.vy *= 0.6;
      }
    }
  }
  // Water wrecks the car outright.
  if (world.isWater(v.x, v.y) && !v.wrecked) {
    v.wrecked = true;
    v.sinking = true;
    v.health = 0;
    v.vx = 0;
    v.vy = 0;
    v.speed = 0;
    if (events) events.push({ kind: 'splash', x: v.x, y: v.y, byPlayer: isPlayer, vehicle: v });
  }
  if (v.health <= 0 && !v.wrecked) {
    v.wrecked = true;
    if (events) events.push({ kind: 'wreck', x: v.x, y: v.y, byPlayer: isPlayer, vehicle: v });
  }
  return hardHit;
}

// Car-vs-car collision: circle pairs push apart and trade velocity.
export function resolveVehicleCollisions(vehicles, events) {
  for (let i = 0; i < vehicles.length; i++) {
    const a = vehicles[i];
    if (a.sinking) continue;
    const ac = vehicleCircles(a);
    for (let j = i + 1; j < vehicles.length; j++) {
      const b = vehicles[j];
      if (b.sinking) continue;
      const bc = vehicleCircles(b);
      for (const ca of ac) {
        for (const cb of bc) {
          const dx = cb.x - ca.x;
          const dy = cb.y - ca.y;
          const minD = ca.r + cb.r;
          const d2 = dx * dx + dy * dy;
          if (d2 >= minD * minD || d2 < 0.01) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const ny = dy / d;
          const overlap = (minD - d) / 2;
          a.x -= nx * overlap;
          a.y -= ny * overlap;
          b.x += nx * overlap;
          b.y += ny * overlap;
          // Trade some velocity along the impact normal.
          const relVx = b.vx - a.vx;
          const relVy = b.vy - a.vy;
          const impact = relVx * nx + relVy * ny;
          if (impact < 0) {
            const push = -impact * 0.55;
            a.vx -= nx * push;
            a.vy -= ny * push;
            b.vx += nx * push;
            b.vy += ny * push;
            const speed = Math.abs(impact);
            if (speed > 70) {
              const dmg = (speed - 70) * 0.1;
              a.health -= dmg;
              b.health -= dmg;
              if (events) {
                events.push({
                  kind: 'crash', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
                  strength: Math.min(1, speed / 400),
                  byPlayer: a.driver === 'player' || b.driver === 'player',
                  vehicleA: a, vehicleB: b,
                });
              }
            }
          }
        }
      }
    }
  }
  for (const v of vehicles) {
    if (v.health <= 0 && !v.wrecked) {
      v.wrecked = true;
      if (events) events.push({ kind: 'wreck', x: v.x, y: v.y, byPlayer: v.driver === 'player', vehicle: v });
    }
  }
}

// --- Traffic ------------------------------------------------------------

// Lane offset for right-hand traffic, in world units from the road centre.
function laneOffset(axis, dir) {
  if (axis === 'v') return dir > 0 ? -10 : 10; // southbound keeps west, northbound east
  return dir > 0 ? 10 : -10; // eastbound keeps south, westbound north
}

function headingAngle(axis, dir) {
  if (axis === 'v') return dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  return dir > 0 ? 0 : Math.PI;
}

function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function spawnTrafficCar(world, rng, minDistFrom) {
  const types = ['sedan', 'sedan', 'sedan', 'taxi', 'pickup', 'van', 'sports'];
  const type = rng.pick(types);
  let x;
  let y;
  let axis;
  let coord;
  let dir;
  for (let tries = 0; tries < 20; tries++) {
    axis = rng.chance(0.5) ? 'v' : 'h';
    coord = rng.pick(axis === 'v' ? world.vertical : world.horizontal);
    dir = rng.chance(0.5) ? 1 : -1;
    const along = rng.range(120, 1680);
    const off = laneOffset(axis, dir);
    x = axis === 'v' ? coord + off : along;
    y = axis === 'v' ? along : coord + off;
    if (!minDistFrom || Math.hypot(x - minDistFrom.x, y - minDistFrom.y) > 420) break;
  }
  const v = createVehicle(type, x, y, headingAngle(axis, dir));
  v.driver = 'traffic';
  v.roadAxis = axis;
  v.roadCoord = coord;
  v.dir = dir;
  v.cruiseSpeed = v.spec.topSpeed * rng.range(0.38, 0.5);
  v.speed = v.cruiseSpeed;
  v.color = rng.pick(v.spec.colors);
  return v;
}

export function spawnParkedCar(world, rng) {
  const spot = rng.pick(world.parkedSpots);
  const types = ['sedan', 'sedan', 'pickup', 'van', 'sports', 'taxi'];
  const type = rng.pick(types);
  const v = createVehicle(type, spot.x, spot.y, spot.angle);
  v.driver = 'parked';
  v.color = rng.pick(v.spec.colors);
  return v;
}

// One traffic car for one frame. now is the game clock in seconds; threats
// is a list of recent {x, y} gunfire/crash points to flee from.
export function updateTrafficCar(v, dt, world, vehicles, threats, now) {
  if (v.wrecked || v.sinking) {
    v.vx *= Math.exp(-2 * dt);
    v.vy *= Math.exp(-2 * dt);
    v.x += v.vx * dt;
    v.y += v.vy * dt;
    return;
  }
  // Flee nearby gunfire or crashes.
  for (const t of threats) {
    if (Math.hypot(v.x - t.x, v.y - t.y) < 320) {
      v.fleeUntil = now + 3;
      break;
    }
  }
  const fleeing = now < v.fleeUntil;
  let target = fleeing ? v.spec.topSpeed * 0.85 : v.cruiseSpeed;

  // Slow or stop for a car ahead on the same road.
  const fx = Math.cos(v.angle);
  const fy = Math.sin(v.angle);
  for (const other of vehicles) {
    if (other === v || other.sinking) continue;
    const dx = other.x - v.x;
    const dy = other.y - v.y;
    const ahead = dx * fx + dy * fy;
    if (ahead < 0 || ahead > 85) continue;
    const lateral = Math.abs(dx * -fy + dy * fx);
    if (lateral > 17) continue;
    // Same direction of travel (or stopped).
    const otherSpeed = Math.hypot(other.vx, other.vy);
    const sameWay = otherSpeed < 5 || (other.vx * fx + other.vy * fy) > 0;
    if (!sameWay) continue;
    target = ahead < 42 ? 0 : Math.min(target, v.cruiseSpeed * 0.3);
  }

  // Junction decisions: at an intersection, sometimes turn.
  const along = v.roadAxis === 'v' ? v.y : v.x;
  const lines = v.roadAxis === 'v' ? world.horizontal : world.vertical;
  let nextLine = null;
  let nextDist = Infinity;
  for (const line of lines) {
    const d = (line - along) * v.dir;
    if (d > 0 && d < nextDist) {
      nextDist = d;
      nextLine = line;
    }
  }
  // Near the end of the road with no junction ahead: U-turn.
  if (nextLine === null || (v.dir > 0 && along > 1740) || (v.dir < 0 && along < 60)) {
    v.dir *= -1;
    v.lastJunction = '';
  } else if (nextDist < 26) {
    const key = v.roadAxis + v.roadCoord + '@' + nextLine;
    if (v.lastJunction !== key) {
      v.lastJunction = key;
      const roll = Math.random();
      if (roll > 0.62) {
        // Turn onto the crossing road. Left or right by the roll.
        const turnLeft = roll > 0.81;
        const newAxis = v.roadAxis === 'v' ? 'h' : 'v';
        let newDir;
        if (v.roadAxis === 'v') newDir = (v.dir > 0) === turnLeft ? 1 : -1;
        else newDir = (v.dir > 0) === turnLeft ? -1 : 1;
        v.roadAxis = newAxis;
        v.roadCoord = nextLine;
        v.dir = newDir;
      }
    }
  }

  // Ease speed and heading toward their targets.
  const accel = target > v.speed ? v.spec.accel * 0.5 : v.spec.brake;
  v.speed += Math.max(-accel * dt, Math.min(accel * dt, target - v.speed));
  if (v.speed < 0.5 && target === 0) v.speed = 0;
  v.brakeLight = target < v.speed - 20;
  const targetAngle = headingAngle(v.roadAxis, v.dir);
  v.angle = angleLerp(v.angle, targetAngle, Math.min(1, 2.8 * dt));

  // Ease onto the correct lane.
  const off = laneOffset(v.roadAxis, v.dir);
  if (v.roadAxis === 'v') {
    v.x += (v.roadCoord + off - v.x) * Math.min(1, 2.2 * dt);
  } else {
    v.y += (v.roadCoord + off - v.y) * Math.min(1, 2.2 * dt);
  }

  const mx = Math.cos(v.angle);
  const my = Math.sin(v.angle);
  v.vx = mx * v.speed;
  v.vy = my * v.speed;
  v.x += v.vx * dt;
  v.y += v.vy * dt;

  // Safety net: a turning car can clip a building corner.
  const fixed = world.collideCircle(v.x, v.y, v.spec.h * 0.6);
  if (fixed.hit) {
    v.x = fixed.x;
    v.y = fixed.y;
    v.speed *= 0.5;
  }
}
