// NEON HARBOR — rendering. A top-down canvas camera follows the player and
// draws the city, cars, people and effects, then a lighting pass turns day
// into orange dusk and dark neon night. Everything is drawn in code: no
// images, no assets.

import { CONFIG } from './config.js';

// Daylight for an hour of the game clock: 1 = full day, ~0.2 = deep night.
// Also returns a dusk factor (0..1) for the orange tint near sunset.
export function lightForHour(hour) {
  const h = ((hour % 24) + 24) % 24;
  let level;
  if (h >= 7 && h < 17) level = 1;
  else if (h >= 17 && h < 19.5) level = 1 - ((h - 17) / 2.5) * 0.78;
  else if (h >= 19.5 || h < 5.5) level = 0.22;
  else level = 0.22 + ((h - 5.5) / 1.5) * 0.78; // dawn
  let dusk = 0;
  if (h >= 16.5 && h < 19.5) dusk = 1 - Math.abs(h - 18) / 1.5;
  return { level, dusk: Math.max(0, dusk), night: level < 0.5 };
}

export function createCamera() {
  return { x: 1000, y: 1000, zoom: 1 };
}

export function updateCamera(camera, target, dt, viewW, viewH, worldSize) {
  const lead = CONFIG.cameraLead;
  const tx = target.x + (target.vx || 0) * 0.25 + Math.cos(target.angle || 0) * lead * 0.4;
  const ty = target.y + (target.vy || 0) * 0.25 + Math.sin(target.angle || 0) * lead * 0.4;
  const k = Math.min(1, 4.5 * dt);
  camera.x += (tx - camera.x) * k;
  camera.y += (ty - camera.y) * k;
  const hw = viewW / 2;
  const hh = viewH / 2;
  camera.x = Math.max(hw - 80, Math.min(worldSize - hw + 80, camera.x));
  camera.y = Math.max(hh - 80, Math.min(worldSize - hh + 80, camera.y));
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function render(state, ctx, canvas) {
  const world = state.world;
  const viewW = canvas.width;
  const viewH = canvas.height;
  const cam = state.camera;
  const hour = state.timeHours;
  const light = lightForHour(hour);
  const night = light.night;
  const time = state.now;

  const left = cam.x - viewW / 2;
  const top = cam.y - viewH / 2;
  const right = left + viewW;
  const bottom = top + viewH;
  const inView = (x, y, m = 60) => x > left - m && x < right + m && y > top - m && y < bottom + m;

  ctx.save();
  ctx.clearRect(0, 0, viewW, viewH);
  ctx.translate(-left, -top);

  // --- Ground ------------------------------------------------------------
  ctx.fillStyle = CONFIG.colors.grass;
  ctx.fillRect(left, top, viewW, viewH);
  // Mow stripes for a little texture on open ground.
  ctx.fillStyle = CONFIG.colors.grassDark;
  const stripeH = 90;
  const firstStripe = Math.floor(top / stripeH) * stripeH;
  for (let y = firstStripe; y < bottom; y += stripeH * 2) {
    ctx.fillRect(left, y, viewW, stripeH);
  }
  // Beach and boardwalk on the west edge.
  ctx.fillStyle = CONFIG.colors.sand;
  ctx.fillRect(0, 0, CONFIG.beachWest, world.size);
  ctx.fillStyle = CONFIG.colors.boardwalk;
  ctx.fillRect(CONFIG.beachWest, 0, CONFIG.boardwalkEast - CONFIG.beachWest, world.size);
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 1;
  for (let y = 0; y < world.size; y += 24) {
    ctx.beginPath();
    ctx.moveTo(CONFIG.beachWest, y);
    ctx.lineTo(CONFIG.boardwalkEast, y);
    ctx.stroke();
  }
  // Harbour water, south and east.
  const waterGrad = ctx.createLinearGradient(0, CONFIG.waterSouth, 0, world.size);
  waterGrad.addColorStop(0, CONFIG.colors.waterShallow);
  waterGrad.addColorStop(1, CONFIG.colors.waterDeep);
  ctx.fillStyle = waterGrad;
  ctx.fillRect(0, CONFIG.waterSouth, world.size, world.size - CONFIG.waterSouth);
  ctx.fillRect(CONFIG.waterEast, 0, world.size - CONFIG.waterEast, CONFIG.waterSouth);
  // Animated wave strokes.
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2;
  const waveGap = 54;
  for (let wy = Math.max(CONFIG.waterSouth, Math.floor(top / waveGap) * waveGap); wy < bottom; wy += waveGap) {
    for (let wx = Math.floor(left / waveGap) * waveGap; wx < right; wx += waveGap) {
      if (wx < CONFIG.waterEast && wy < CONFIG.waterSouth) continue;
      const phase = Math.sin(wx * 0.05 + wy * 0.03 + time * 1.4);
      ctx.beginPath();
      ctx.moveTo(wx, wy + phase * 3);
      ctx.lineTo(wx + 22, wy + phase * 3);
      ctx.stroke();
    }
  }

  // --- Piers ---------------------------------------------------------------
  for (const p of world.piers) {
    if (!inView(p.x + p.w / 2, p.y + p.h / 2, 100)) continue;
    ctx.fillStyle = '#8a6a48';
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = '#6a4e30';
    if (p.w < p.h) {
      for (let y = p.y; y < p.y + p.h; y += 16) ctx.fillRect(p.x, y, p.w, 3);
    } else {
      for (let x = p.x; x < p.x + p.w; x += 16) ctx.fillRect(x, p.y, 3, p.h);
    }
  }

  // --- Roads ---------------------------------------------------------------
  const roadW = CONFIG.roadHalf * 2;
  const walkW = roadW + CONFIG.sidewalk * 2;
  ctx.fillStyle = CONFIG.colors.sidewalk;
  for (const vx of world.vertical) ctx.fillRect(vx - walkW / 2, 0, walkW, CONFIG.waterSouth);
  for (const hy of world.horizontal) ctx.fillRect(0, hy - walkW / 2, CONFIG.waterEast, walkW);
  ctx.fillStyle = CONFIG.colors.asphalt;
  for (const vx of world.vertical) ctx.fillRect(vx - CONFIG.roadHalf, 0, roadW, CONFIG.waterSouth);
  for (const hy of world.horizontal) ctx.fillRect(0, hy - CONFIG.roadHalf, CONFIG.waterEast, roadW);
  // Centre dashes.
  ctx.fillStyle = CONFIG.colors.laneDash;
  for (const vx of world.vertical) {
    for (let y = 20; y < CONFIG.waterSouth; y += 44) {
      let onJunction = false;
      for (const hy of world.horizontal) if (Math.abs(y - hy) < 34) { onJunction = true; break; }
      if (!onJunction) ctx.fillRect(vx - 1.5, y, 3, 20);
    }
  }
  for (const hy of world.horizontal) {
    for (let x = 20; x < CONFIG.waterEast; x += 44) {
      let onJunction = false;
      for (const vx of world.vertical) if (Math.abs(x - vx) < 34) { onJunction = true; break; }
      if (!onJunction) ctx.fillRect(x, hy - 1.5, 20, 3);
    }
  }
  // Crosswalks at every junction.
  ctx.fillStyle = CONFIG.colors.crosswalk;
  for (const vx of world.vertical) {
    for (const hy of world.horizontal) {
      if (!inView(vx, hy, 40)) continue;
      for (let i = -3; i <= 3; i++) {
        ctx.fillRect(vx + i * 6 - 2, hy - CONFIG.roadHalf - 6, 4, 6);
        ctx.fillRect(vx + i * 6 - 2, hy + CONFIG.roadHalf, 4, 6);
      }
    }
  }

  // --- Parks and trees -------------------------------------------------------
  for (const park of world.parks) {
    if (!inView(park.x + park.w / 2, park.y + park.h / 2, 100)) continue;
    ctx.fillStyle = CONFIG.colors.park;
    ctx.fillRect(park.x, park.y, park.w, park.h);
  }
  for (const t of world.trees) {
    if (!inView(t.x, t.y, 20)) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(t.x + 3, t.y + 4, t.r, t.r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = night ? '#1e4a26' : '#2e6b34';
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = night ? '#2a5a30' : '#3d8a44';
    ctx.beginPath();
    ctx.arc(t.x - t.r * 0.25, t.y - t.r * 0.25, t.r * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- Buildings ---------------------------------------------------------------
  for (const b of world.buildings) {
    if (!inView(b.x + b.w / 2, b.y + b.h / 2, 120)) continue;
    const hOff = Math.min(14, b.floors * 1.6);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(b.x + hOff, b.y + hOff, b.w, b.h);
    ctx.fillStyle = b.color;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = b.roof;
    ctx.fillRect(b.x + 3, b.y + 3, b.w - 6, b.h - 6);
    // Windows: a grid that lights up at night.
    const cols = Math.max(1, Math.floor(b.w / 16));
    const rows = Math.max(1, Math.floor(b.h / 16));
    for (let cx = 0; cx < cols; cx++) {
      for (let cy = 0; cy < rows; cy++) {
        const wx = b.x + 6 + cx * ((b.w - 12) / cols);
        const wy = b.y + 6 + cy * ((b.h - 12) / rows);
        const lit = night && ((cx * 7 + cy * 13 + b.floors * 3) % 5 < 2);
        ctx.fillStyle = lit ? '#ffd76a' : (night ? '#1a2233' : '#22344a');
        ctx.fillRect(wx, wy, 7, 7);
      }
    }
  }

  // --- Containers, cranes ---------------------------------------------------------
  for (const c of world.containers) {
    if (!inView(c.x, c.y, 30)) continue;
    ctx.save();
    ctx.translate(c.x + c.w / 2, c.y + c.h / 2);
    ctx.rotate(c.angle);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-c.w / 2 + 2, -c.h / 2 + 3, c.w, c.h);
    ctx.fillStyle = c.color;
    ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 5, -c.h / 2);
      ctx.lineTo(i * 5, c.h / 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  for (const crane of world.cranes) {
    if (!inView(crane.x, crane.y, 80)) continue;
    ctx.save();
    ctx.translate(crane.x, crane.y);
    ctx.rotate(crane.angle);
    ctx.fillStyle = '#c8a02e';
    ctx.fillRect(-6, -6, 12, 12);
    ctx.fillRect(-3, -6, 6, -58);
    ctx.fillRect(-3, -64, 78, 6);
    ctx.fillRect(70, -64, 3, 34);
    ctx.fillStyle = '#8a6a1a';
    ctx.fillRect(66, -32, 11, 8);
    ctx.restore();
  }

  // --- Street lamps (poles; the glow comes in the lighting pass) -------------------
  ctx.fillStyle = '#5a5f66';
  for (const lamp of world.lamps) {
    if (!inView(lamp.x, lamp.y, 10)) continue;
    ctx.beginPath();
    ctx.arc(lamp.x, lamp.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- Skid marks -------------------------------------------------------------------
  for (const s of state.skidmarks) {
    if (!inView(s.x, s.y, 20)) continue;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    ctx.fillStyle = `rgba(10,10,10,${0.35 * Math.min(1, s.life / 6)})`;
    ctx.fillRect(-8, -7, 16, 3);
    ctx.fillRect(-8, 4, 16, 3);
    ctx.restore();
  }

  // --- Cash drops ---------------------------------------------------------------------
  for (const drop of state.cashDrops) {
    if (!inView(drop.x, drop.y, 20)) continue;
    const pulse = 1 + Math.sin(time * 4 + drop.x) * 0.15;
    ctx.save();
    ctx.translate(drop.x, drop.y);
    ctx.fillStyle = 'rgba(60,220,120,0.25)';
    ctx.beginPath();
    ctx.arc(0, 0, 20 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2fae5f';
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#eafff0';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', 0, 1);
    ctx.restore();
  }

  // --- Garage marker (Marlow's) ----------------------------------------------------------
  const g = world.landmarks.garage;
  if (inView(g.x, g.y, 40)) {
    const bob = Math.sin(time * 2.4) * 4;
    ctx.save();
    ctx.translate(g.x, g.y - 30 + bob);
    ctx.fillStyle = 'rgba(255,210,40,0.9)';
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(9, 0);
    ctx.lineTo(0, 12);
    ctx.lineTo(-9, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('M', 0, 0);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,210,40,0.18)';
    ctx.fillRect(g.x - 3, g.y - 90, 6, 90);
  }

  // --- Cars -------------------------------------------------------------------------------
  for (const v of state.vehicles) {
    if (!inView(v.x, v.y, 60)) continue;
    drawCar(ctx, v, night, time);
  }

  // --- Pedestrians --------------------------------------------------------------------------
  for (const p of state.peds) {
    if (!inView(p.x, p.y, 20)) continue;
    drawPed(ctx, p);
  }

  // --- Player on foot -------------------------------------------------------------------------
  const player = state.player;
  if (!player.vehicle && !player.dead) {
    drawPlayerOnFoot(ctx, player, time);
  }

  // --- Bullets ----------------------------------------------------------------------------------
  ctx.strokeStyle = '#ffe08a';
  ctx.lineWidth = 2;
  for (const b of state.bullets) {
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02);
    ctx.stroke();
  }

  // --- Particles ----------------------------------------------------------------------------------
  for (const pt of state.particles) {
    const a = Math.max(0, pt.life / pt.maxLife);
    ctx.globalAlpha = a;
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // --- Neon signs (night only) ---------------------------------------------------------------------
  if (night || light.dusk > 0.3) {
    for (const s of world.neonSigns) {
      if (!inView(s.x, s.y, 30)) continue;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = s.color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = s.color;
      if (s.vertical) {
        ctx.rotate(Math.PI / 2);
      }
      ctx.fillText(s.text, 0, 0);
      ctx.restore();
    }
  }

  ctx.restore();

  // --- Lighting pass (screen space) ------------------------------------------------------------------
  if (light.level < 0.999) {
    const darkness = (1 - light.level) * 0.66;
    ctx.fillStyle = `rgba(7,9,28,${darkness})`;
    ctx.fillRect(0, 0, viewW, viewH);
    // Dusk orange wash.
    if (light.dusk > 0.01) {
      ctx.fillStyle = `rgba(255,110,40,${light.dusk * 0.1})`;
      ctx.fillRect(0, 0, viewW, viewH);
    }
    // Punch light back in around lamps, the player and headlights.
    if (night) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const px = player.x - left;
      const py = player.y - top;
      glow(ctx, px, py, 240, 'rgba(255,220,160,0.20)');
      for (const lamp of world.lamps) {
        const lx = lamp.x - left;
        const ly = lamp.y - top;
        if (lx < -100 || lx > viewW + 100 || ly < -100 || ly > viewH + 100) continue;
        glow(ctx, lx, ly, 95, 'rgba(255,200,120,0.13)');
      }
      for (const v of state.vehicles) {
        if (v.wrecked || v.sinking) continue;
        if (!inView(v.x, v.y, 80)) continue;
        const fx = Math.cos(v.angle);
        const fy = Math.sin(v.angle);
        const hx = v.x + fx * (v.spec.w / 2 + 40) - left;
        const hy = v.y + fy * (v.spec.w / 2 + 40) - top;
        glow(ctx, hx, hy, 120, 'rgba(255,240,190,0.16)');
      }
      ctx.restore();
    }
  }
}

function glow(ctx, x, y, radius, color) {
  const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
  grad.addColorStop(0, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawCar(ctx, v, night, time) {
  ctx.save();
  ctx.translate(v.x, v.y);
  ctx.rotate(v.angle);
  const w = v.spec.w;
  const h = v.spec.h;
  if (v.sinking) {
    ctx.globalAlpha = 0.55;
    ctx.rotate(0.12);
  }
  // Shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(2, 3, w / 2, h / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  // Body.
  ctx.fillStyle = v.wrecked ? '#2a2a2a' : v.color;
  roundRect(ctx, -w / 2, -h / 2, w, h, 5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Windshield and rear window.
  ctx.fillStyle = v.wrecked ? '#1a1a1a' : '#a8d4e8';
  roundRect(ctx, w * 0.08, -h / 2 + 2, w * 0.2, h - 4, 2);
  ctx.fill();
  roundRect(ctx, -w * 0.34, -h / 2 + 2, w * 0.16, h - 4, 2);
  ctx.fill();
  // Roof.
  ctx.fillStyle = v.wrecked ? '#222222' : shade(v.color, -18);
  roundRect(ctx, -w * 0.18, -h / 2 + 3, w * 0.26, h - 6, 2);
  ctx.fill();
  // Type details.
  if (v.type === 'taxi') {
    ctx.fillStyle = '#ffe600';
    ctx.fillRect(-4, -3, 8, 6);
    ctx.fillStyle = '#111111';
    ctx.font = 'bold 5px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('TAXI', 0, 0);
  }
  if (v.type === 'police') {
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(-w * 0.1, -h / 2, w * 0.22, h);
    // Flashing light bar.
    const phase = Math.floor(time * 4) % 2 === 0;
    ctx.fillStyle = phase ? '#ff2d2d' : '#2d5aff';
    ctx.fillRect(-2, -h / 2 - 1, 5, 4);
    ctx.fillStyle = phase ? '#2d5aff' : '#ff2d2d';
    ctx.fillRect(-2, h / 2 - 3, 5, 4);
  }
  if (v.type === 'armored') {
    ctx.fillStyle = '#c8a02e';
    ctx.fillRect(-w / 2 + 2, -2, w - 4, 4);
  }
  // Headlights and tail lights.
  if (night && !v.wrecked) {
    ctx.fillStyle = '#fff6c8';
    ctx.beginPath();
    ctx.arc(w / 2 - 1, -h / 2 + 3, 2.2, 0, Math.PI * 2);
    ctx.arc(w / 2 - 1, h / 2 - 3, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = v.brakeLight ? '#ff2d2d' : '#a02020';
  ctx.fillRect(-w / 2, -h / 2 + 2, 2.5, 4);
  ctx.fillRect(-w / 2, h / 2 - 6, 2.5, 4);
  ctx.restore();
}

function drawPed(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  if (p.state === 'dead') {
    ctx.fillStyle = 'rgba(120,10,10,0.5)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 12, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(p.angle);
    ctx.fillStyle = p.shirt;
    roundRect(ctx, -10, -4, 20, 8, 4);
    ctx.fill();
    ctx.fillStyle = p.skin;
    ctx.beginPath();
    ctx.arc(11, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  const bob = Math.sin(p.walkPhase) * 1.2;
  ctx.rotate(p.angle);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(1, 2, 7, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = p.shirt;
  ctx.beginPath();
  ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = p.skin;
  ctx.beginPath();
  ctx.arc(3 + bob * 0.3, 0, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPlayerOnFoot(ctx, player, time) {
  ctx.save();
  ctx.translate(player.x, player.y);
  const bob = player.moving ? Math.sin(player.walkPhase) * 1.4 : Math.sin(time * 2) * 0.5;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(1, 3, 8, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.rotate(player.angle);
  // Jacket (Rook wears teal).
  ctx.fillStyle = '#18a8a0';
  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0d7a74';
  ctx.beginPath();
  ctx.arc(-2, 0, 5, 0, Math.PI * 2);
  ctx.fill();
  // Head.
  ctx.fillStyle = '#e8b88a';
  ctx.beginPath();
  ctx.arc(4 + bob * 0.3, 0, 4.5, 0, Math.PI * 2);
  ctx.fill();
  // Gun.
  ctx.fillStyle = '#222222';
  ctx.fillRect(6, -1.5, 11, 3);
  ctx.restore();
}

// Darken a #rrggbb colour by an amount.
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amount));
  const b = Math.max(0, Math.min(255, (n & 0xff) + amount));
  return `rgb(${r},${g},${b})`;
}
