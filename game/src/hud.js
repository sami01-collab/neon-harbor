// NEON HARBOR — the HUD: a DOM overlay (cash, wanted stars, health, speed,
// objective, clock, hints, message feed) plus a small minimap canvas that
// shows roads, water, the player arrow, the garage marker, police and cash
// drops. Updates are throttled so the DOM is not rewritten every frame.

import { missionMarker } from './missions.js';

export function createHud(doc) {
  const el = {
    cash: doc.getElementById('hud-cash'),
    stars: doc.getElementById('hud-stars'),
    healthFill: doc.getElementById('hud-health-fill'),
    healthText: doc.getElementById('hud-health-text'),
    speed: doc.getElementById('hud-speed'),
    speedValue: doc.getElementById('hud-speed-value'),
    objective: doc.getElementById('hud-objective'),
    clock: doc.getElementById('hud-clock'),
    hint: doc.getElementById('hud-hint'),
    messages: doc.getElementById('hud-messages'),
    rank: doc.getElementById('hud-rank'),
    minimap: doc.getElementById('minimap'),
    banner: doc.getElementById('mission-banner'),
    bannerTitle: doc.getElementById('mission-banner-title'),
    bannerSub: doc.getElementById('mission-banner-sub'),
  };
  const mctx = el.minimap ? el.minimap.getContext('2d') : null;
  let lastTextUpdate = 0;
  let lastMinimap = 0;
  let lastMessageCount = -1;

  function formatClock(hours) {
    const h = Math.floor(hours) % 24;
    const m = Math.floor((hours % 1) * 60);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  function updateText(state) {
    el.cash.textContent = '$' + Math.floor(state.cash).toLocaleString('en-US');
    const stars = '★'.repeat(state.wanted) + '☆'.repeat(5 - state.wanted);
    el.stars.textContent = stars;
    el.stars.classList.toggle('wanted-hot', state.wanted > 0);
    const hp = Math.max(0, Math.ceil(state.player.health));
    el.healthFill.style.width = hp + '%';
    el.healthFill.classList.toggle('health-low', hp <= 30);
    el.healthText.textContent = hp;
    el.clock.textContent = formatClock(state.timeHours);
    el.objective.textContent = state.objective;
    el.rank.textContent = state.rank;
    if (state.player.vehicle) {
      el.speed.style.display = 'block';
      el.speedValue.textContent = Math.round(Math.abs(state.player.vehicle.speed) * 0.6);
    } else {
      el.speed.style.display = 'none';
    }
    el.hint.textContent = hintFor(state);
  }

  function hintFor(state) {
    const player = state.player;
    // Police pressure outranks everything else in the hint line.
    if (state.police && state.police.bustTimer > 0.5) return 'The cops are grabbing you — RUN!';
    if (state.wanted > 0 && state.police && !state.police.seen && state.police.evadeTimer > 0) {
      return `LOSING THE COPS — stay hidden (${Math.ceil(state.police.evadeTimer)}s)`;
    }
    if (player.vehicle) {
      if (player.vehicle.health < 35) return 'Your car is falling apart — find another ride. (E to exit)';
      return 'WASD drive · Space handbrake · E exit car';
    }
    // A car close enough to steal?
    for (const v of state.vehicles) {
      if (v.sinking || v.wrecked) continue;
      if (Math.hypot(v.x - player.x, v.y - player.y) < 56) {
        return `Press E to steal the ${v.spec.label}`;
      }
    }
    if (player.health <= 30) return 'Health low — lie low and it recovers';
    return 'WASD move · Shift sprint · Click shoot · F punch · E enter car';
  }

  function updateMessages(state) {
    if (state.messages.length === lastMessageCount) return;
    lastMessageCount = state.messages.length;
    const recent = state.messages.slice(-4);
    el.messages.innerHTML = '';
    for (const msg of recent) {
      const div = doc.createElement('div');
      div.className = 'hud-message';
      if (state.now - msg.at > 6) div.classList.add('hud-message-old');
      div.textContent = msg.text;
      el.messages.appendChild(div);
    }
  }

  function updateMinimap(state) {
    if (!mctx) return;
    const world = state.world;
    const size = el.minimap.width;
    const scale = size / world.size;
    mctx.clearRect(0, 0, size, size);
    // Land.
    mctx.fillStyle = '#2e5a33';
    mctx.fillRect(0, 0, size, size);
    // Water.
    mctx.fillStyle = '#14608f';
    mctx.fillRect(0, 1800 * scale, size, size - 1800 * scale);
    mctx.fillRect(1800 * scale, 0, size - 1800 * scale, 1800 * scale);
    // Roads.
    mctx.strokeStyle = '#9a9a9a';
    mctx.lineWidth = 2;
    for (const vx of world.vertical) {
      mctx.beginPath();
      mctx.moveTo(vx * scale, 0);
      mctx.lineTo(vx * scale, 1800 * scale);
      mctx.stroke();
    }
    for (const hy of world.horizontal) {
      mctx.beginPath();
      mctx.moveTo(0, hy * scale);
      mctx.lineTo(1800 * scale, hy * scale);
      mctx.stroke();
    }
    // Cash drops.
    mctx.fillStyle = '#3cdc78';
    for (const drop of state.cashDrops) {
      mctx.beginPath();
      mctx.arc(drop.x * scale, drop.y * scale, 2.5, 0, Math.PI * 2);
      mctx.fill();
    }
    // Police (any police cruiser shows blue) and on-foot officers.
    mctx.fillStyle = '#4a8aff';
    for (const v of state.vehicles) {
      if (v.type !== 'police' || v.sinking) continue;
      mctx.beginPath();
      mctx.arc(v.x * scale, v.y * scale, 2.5, 0, Math.PI * 2);
      mctx.fill();
    }
    if (state.police) {
      for (const o of state.police.officers) {
        if (o.state === 'down') continue;
        mctx.beginPath();
        mctx.arc(o.x * scale, o.y * scale, 2, 0, Math.PI * 2);
        mctx.fill();
      }
    }
    // Mission marker (pulsing gold diamond).
    const marker = missionMarker(state);
    if (marker) {
      const pulse = 3.5 + Math.sin(state.now * 4) * 1;
      mctx.fillStyle = '#ffd228';
      mctx.save();
      mctx.translate(marker.x * scale, marker.y * scale);
      mctx.rotate(Math.PI / 4);
      mctx.fillRect(-pulse, -pulse, pulse * 2, pulse * 2);
      mctx.restore();
    }
    // Garage marker.
    const g = world.landmarks.garage;
    mctx.fillStyle = '#ffd228';
    mctx.save();
    mctx.translate(g.x * scale, g.y * scale);
    mctx.rotate(Math.PI / 4);
    mctx.fillRect(-3.5, -3.5, 7, 7);
    mctx.restore();
    // Player arrow.
    const p = state.player;
    mctx.save();
    mctx.translate(p.x * scale, p.y * scale);
    mctx.rotate(p.angle);
    mctx.fillStyle = '#ffffff';
    mctx.strokeStyle = '#111111';
    mctx.lineWidth = 1;
    mctx.beginPath();
    mctx.moveTo(6, 0);
    mctx.lineTo(-4, -4);
    mctx.lineTo(-4, 4);
    mctx.closePath();
    mctx.fill();
    mctx.stroke();
    mctx.restore();
    // North tick.
    mctx.fillStyle = 'rgba(255,255,255,0.8)';
    mctx.font = 'bold 9px sans-serif';
    mctx.textAlign = 'center';
    mctx.fillText('N', size / 2, 10);
  }

  function updateBanner(state) {
    if (!el.banner) return;
    if (state.banner && state.now < state.banner.until) {
      el.banner.style.display = 'block';
      if (el.bannerTitle.textContent !== state.banner.title) {
        el.bannerTitle.textContent = state.banner.title;
      }
      if (el.bannerSub.textContent !== state.banner.sub) {
        el.bannerSub.textContent = state.banner.sub;
      }
    } else if (el.banner.style.display !== 'none') {
      el.banner.style.display = 'none';
    }
  }

  return {
    update(state, dt) {
      lastTextUpdate += dt;
      lastMinimap += dt;
      if (lastTextUpdate > 0.12) {
        lastTextUpdate = 0;
        updateText(state);
      }
      updateMessages(state);
      updateBanner(state);
      if (lastMinimap > 0.08) {
        lastMinimap = 0;
        updateMinimap(state);
      }
    },
    // Force a full refresh (after loading a save, for example).
    refresh(state) {
      updateText(state);
      lastMessageCount = -1;
      updateMessages(state);
      updateMinimap(state);
    },
  };
}
