// NEON HARBOR — combat helpers. Explosions: when a car wrecks it blows
// up, hurting nearby cars, pedestrians and the player, and a blast can
// chain into other damaged cars. Vehicle damage funnels through
// damageVehicle so a wreck always queues its wreck event exactly once.

import { damagePlayer } from './player.js';
import { hitPed } from './pedestrians.js';

const BLAST_RADIUS = 95;
const BLAST_VEHICLE_DAMAGE = 45;
const BLAST_PLAYER_DAMAGE = 25;

function explosionParticles(state, x, y) {
  // Fireball: fast orange sparks in a ring, then slow dark smoke.
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + Math.random() * 0.3;
    const s = 60 + Math.random() * 240;
    state.particles.push({
      x, y,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: 0.5 + Math.random() * 0.4, maxLife: 0.9,
      size: 3 + Math.random() * 4,
      color: i % 3 === 0 ? '#ffd23d' : '#ff7a2d',
    });
  }
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 20 + Math.random() * 50;
    state.particles.push({
      x: x + Math.cos(a) * 8, y: y + Math.sin(a) * 8,
      vx: Math.cos(a) * s, vy: Math.sin(a) * s - 20,
      life: 0.9 + Math.random() * 0.6, maxLife: 1.5,
      size: 5 + Math.random() * 5,
      color: '#555555',
    });
  }
}

// Damage a vehicle; wrecks it (and queues the wreck event) at zero health.
export function damageVehicle(state, v, amount, byPlayer) {
  if (v.wrecked) return;
  v.health -= amount;
  if (v.health <= 0) {
    v.wrecked = true;
    state.events.push({ kind: 'wreck', x: v.x, y: v.y, byPlayer: !!byPlayer, vehicle: v });
  }
}

// A wrecked car explodes: splash damage to everything nearby.
export function explodeVehicle(state, v) {
  explosionParticles(state, v.x, v.y);
  const byPlayer = v.driver === 'player' || state.player.vehicle === v;
  // Nearby cars take blast damage (this can chain into more wrecks).
  for (const other of state.vehicles) {
    if (other === v || other.wrecked || other.sinking) continue;
    if (Math.hypot(other.x - v.x, other.y - v.y) < BLAST_RADIUS) {
      damageVehicle(state, other, BLAST_VEHICLE_DAMAGE, byPlayer);
    }
  }
  // Nearby pedestrians.
  let pedDown = false;
  for (const p of state.peds) {
    if (p.state === 'dead') continue;
    if (Math.hypot(p.x - v.x, p.y - v.y) < BLAST_RADIUS) {
      if (hitPed(p, 100, v.x, v.y)) pedDown = true;
    }
  }
  if (pedDown && byPlayer) {
    state.addWanted(1, 'Explosion caught a pedestrian');
    state.stats.pedsHit++;
  }
  // The player, on foot or in another car.
  const player = state.player;
  if (!player.dead && player.vehicle !== v) {
    if (Math.hypot(player.x - v.x, player.y - v.y) < BLAST_RADIUS) {
      damagePlayer(player, state, BLAST_PLAYER_DAMAGE, v.x, v.y);
    }
  }
}
