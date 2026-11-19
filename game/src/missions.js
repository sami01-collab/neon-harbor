// NEON HARBOR — story missions. Rook works for Marlow, a fixer running a
// harbour crew. Six missions unlock in order; each has a briefing, steps
// with an on-screen objective and a map marker, and a cash payout. After
// the sixth, free roam continues with random cash drops. A failed timed
// mission restarts itself so the player is never stuck.

import { createVehicle } from './vehicles.js';

export const MISSIONS = [
  {
    id: 0, name: 'First Wheels', payout: 500,
    briefing: 'Marlow needs a driver. Steal a car — any car — and bring it to my garage.',
  },
  {
    id: 1, name: 'Harbor Run', payout: 800,
    briefing: 'Five cash drops on the docks, and the tide waits for no one. Grab them all before the clock runs out.',
  },
  {
    id: 2, name: 'Getaway', payout: 1000,
    briefing: 'The job went loud and the cops are on you. Lose them, then get back to the safehouse.',
  },
  {
    id: 3, name: 'The Drop', payout: 1200,
    briefing: 'A bag of cash is waiting on the docks. Grab it on foot, then get out of there by car.',
  },
  {
    id: 4, name: 'Night Shift', payout: 1500,
    briefing: 'A night delivery. Pick up the package at the docks and bring it to the garage — patrols are out.',
  },
  {
    id: 5, name: 'The Big One', payout: 3000,
    briefing: 'An armoured truck is sitting downtown, full of harbour payroll. Take it. Every cop in the city will follow.',
  },
];

// Fixed spots for the scripted mission content.
const DOCK_DROPS = [
  { x: 420, y: 1745 }, { x: 820, y: 1730 }, { x: 1150, y: 1755 },
  { x: 1520, y: 1725 }, { x: 1730, y: 1420 },
];
const DROP_ZONE = { x: 1050, y: 1700, r: 120 };
const NIGHT_PICKUP = { x: 1500, y: 1650 };
const TRUCK_SPOT = { x: 1100, y: 760 };

export function createMissionState() {
  return {
    active: false,
    step: 0,
    timer: 0,
    collected: 0,
    total: 0,
    progress: 0,
    nextAt: 0, // game time when the next mission's briefing lands
    data: {},
  };
}

function inRange(p, target, r) {
  return Math.hypot(p.x - target.x, p.y - target.y) < r;
}

function fmtTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function showBanner(state, title, sub, seconds = 4) {
  state.banner = { title, sub, until: state.now + seconds };
}

export function startMission(state, index, restoring = false) {
  const def = MISSIONS[index];
  if (!def) return;
  state.currentMission = index;
  const m = state.mission;
  m.active = true;
  m.step = 0;
  m.timer = 0;
  m.collected = 0;
  m.total = 0;
  m.progress = 0;
  m.nextAt = 0;
  m.data = {};

  if (index === 0) {
    // A guaranteed car near the spawn so the tutorial never strands the player.
    const car = createVehicle('sedan', 560, 940, Math.PI / 2, '#3a6db0');
    car.driver = 'parked';
    state.vehicles.push(car);
    m.data.car = { x: 560, y: 940 };
    state.objective = 'Steal a car — any car will do (E)';
  } else if (index === 1) {
    m.total = DOCK_DROPS.length;
    m.timer = 150;
    for (const d of DOCK_DROPS) {
      state.cashDrops.push({ x: d.x, y: d.y, amount: 120, mission: true });
    }
    state.objective = `Harbor Run — 0/${m.total} drops`;
  } else if (index === 2) {
    if (!restoring) {
      state.wanted = 2;
      state.lastCrimeAt = state.now;
      state.stats.bestWanted = Math.max(state.stats.bestWanted, 2);
    }
    state.objective = 'Lose the cops — break line of sight';
  } else if (index === 3) {
    m.data.zone = { ...DROP_ZONE };
    state.objective = 'Get to the marked zone on the docks — on foot';
  } else if (index === 4) {
    if (!restoring) state.timeHours = 21.5;
    if (!restoring) {
      state.wanted = Math.max(state.wanted, 1);
      state.lastCrimeAt = state.now;
      state.stats.bestWanted = Math.max(state.stats.bestWanted, state.wanted);
    }
    m.timer = 240;
    state.objective = 'Pick up the package at the docks';
  } else if (index === 5) {
    const truck = createVehicle('armored', TRUCK_SPOT.x, TRUCK_SPOT.y, 0);
    truck.driver = 'parked';
    state.vehicles.push(truck);
    m.data.truckId = truck.id;
    m.data.truck = { x: TRUCK_SPOT.x, y: TRUCK_SPOT.y };
    state.objective = 'Steal the armoured truck downtown';
  }

  showBanner(state, def.name, def.briefing, 5);
  state.addMessage(`Mission: ${def.name} — $${def.payout}`);
}

function completeMission(state) {
  const def = MISSIONS[state.currentMission];
  const rankBefore = state.rank;
  state.missionsCompleted.push(def.id);
  state.addCash(def.payout, `${def.name} complete`);
  const next = state.currentMission + 1;
  state.currentMission = next;
  state.mission.active = false;
  let sub = `+$${def.payout}`;
  if (state.rank !== rankBefore) sub += ` — new rank: ${state.rank}`;
  showBanner(state, `${def.name} complete!`, sub, 4);
  state.addMessage(`${def.name} complete — $${def.payout}`);
  if (next < MISSIONS.length) {
    state.mission.nextAt = state.now + 3;
  } else {
    state.objective = 'Free roam — the city is yours, Rook';
    state.addMessage('All missions done. Neon Harbor is yours, Rook.');
  }
}

function failMission(state, reason) {
  const index = state.currentMission;
  state.addMessage(reason);
  // Clear this mission's drops so a retry starts clean.
  state.cashDrops = state.cashDrops.filter((d) => !d.mission);
  startMission(state, index);
}

export function restartMission(state) {
  if (state.currentMission >= MISSIONS.length) return false;
  state.cashDrops = state.cashDrops.filter((d) => !d.mission);
  startMission(state, state.currentMission);
  return true;
}

// Called from the cash-pickup loop when a mission drop is collected.
export function onMissionDrop(state) {
  if (state.currentMission === 1 && state.mission.active) {
    state.mission.collected++;
  }
}

export function updateMissions(state, dt) {
  const m = state.mission;
  if (!m.active) {
    if (state.currentMission >= MISSIONS.length) {
      state.objective = 'Free roam — the city is yours, Rook';
    } else if (m.nextAt && state.now >= m.nextAt) {
      m.nextAt = 0;
      startMission(state, state.currentMission);
    }
    return;
  }

  const player = state.player;
  const world = state.world;
  const garage = world.landmarks.garage;
  const safe = world.landmarks.safehouse;

  if (state.currentMission === 0) {
    // First Wheels: steal any car, then drive it to Marlow's garage.
    if (m.step === 0) {
      if (player.vehicle) {
        m.step = 1;
        state.objective = "Drive to Marlow's garage (M)";
        state.addMessage("Nice wheels. Now get them to Marlow's garage.");
      }
    } else if (player.vehicle && inRange(player, garage, 60)) {
      completeMission(state);
    }
  } else if (state.currentMission === 1) {
    // Harbor Run: five dock drops against the clock.
    m.timer -= dt;
    state.objective = `Harbor Run — ${m.collected}/${m.total} drops (${fmtTime(m.timer)} left)`;
    if (m.collected >= m.total) {
      completeMission(state);
    } else if (m.timer <= 0) {
      failMission(state, 'Too slow — the drops are gone. Marlow wants another run.');
    }
  } else if (state.currentMission === 2) {
    // Getaway: lose the heat, then reach the safehouse.
    if (m.step === 0) {
      if (state.wanted === 0) {
        m.step = 1;
        state.objective = 'Reach the safehouse';
        state.addMessage('Clean. Get back to the safehouse.');
      }
    } else if (inRange(player, safe, 60)) {
      completeMission(state);
    }
  } else if (state.currentMission === 3) {
    // The Drop: an on-foot cash grab in the marked zone, then escape by car.
    const zone = m.data.zone || DROP_ZONE;
    if (m.step === 0) {
      if (!player.vehicle && inRange(player, zone, zone.r)) {
        m.step = 1;
        state.objective = 'Grab the cash — stay in the zone';
      } else if (player.vehicle) {
        state.objective = 'Get out of the car — the grab is on foot';
      }
    } else if (m.step === 1) {
      if (player.vehicle) {
        state.objective = 'Get out of the car — the grab is on foot';
      } else if (inRange(player, zone, zone.r)) {
        m.progress += dt;
        state.objective = `Grabbing the cash… ${Math.ceil(4 - m.progress)}s`;
        if (m.progress >= 4) {
          m.step = 2;
          state.objective = 'Escape by car — reach the safehouse';
          state.addMessage('Cash grabbed. Get to a car and run!');
        }
      } else {
        state.objective = 'Get back to the marked zone';
      }
    } else if (m.step === 2) {
      if (player.vehicle && inRange(player, safe, 60)) completeMission(state);
    }
  } else if (state.currentMission === 4) {
    // Night Shift: pick up at the docks, deliver to the garage on a timer.
    if (m.step === 0) {
      if (inRange(player, NIGHT_PICKUP, 55)) {
        m.step = 1;
        m.timer = 240;
        state.objective = "Deliver the package to Marlow's garage";
        state.addMessage('Package collected. Deliver it to the garage.');
      }
    } else {
      m.timer -= dt;
      state.objective = `Deliver the package (${fmtTime(m.timer)} left)`;
      if (inRange(player, garage, 60)) {
        completeMission(state);
      } else if (m.timer <= 0) {
        failMission(state, 'The delivery window closed. Marlow wants another run.');
      }
    }
  } else if (state.currentMission === 5) {
    // The Big One: steal the armoured truck, hold off the police, deliver it.
    const truck = state.vehicles.find((v) => v.id === m.data.truckId);
    if (truck && truck.wrecked) {
      failMission(state, 'The truck is wrecked — the job is blown. Marlow found another one.');
      return;
    }
    if (m.step === 0) {
      if (player.vehicle && player.vehicle.type === 'armored') {
        m.step = 1;
        state.wanted = 4;
        state.lastCrimeAt = state.now;
        state.stats.bestWanted = Math.max(state.stats.bestWanted, 4);
        state.objective = "Deliver the truck to Marlow's garage";
        state.addMessage('Every cop in the city is coming. Drive!');
      }
    } else if (player.vehicle && player.vehicle.type === 'armored' && inRange(player, garage, 60)) {
      completeMission(state);
    }
  }
}

// Where the current mission wants the player to go (world map + minimap).
export function missionMarker(state) {
  const m = state.mission;
  if (!m.active) return null;
  const world = state.world;
  const garage = world.landmarks.garage;
  const safe = world.landmarks.safehouse;
  switch (state.currentMission) {
    case 0:
      return m.step === 0
        ? { x: m.data.car?.x ?? 560, y: m.data.car?.y ?? 940, label: 'Steal a car' }
        : { x: garage.x, y: garage.y, label: "Marlow's Garage" };
    case 1: {
      let best = null;
      let bestD = Infinity;
      for (const d of state.cashDrops) {
        if (!d.mission) continue;
        const dist = Math.hypot(d.x - state.player.x, d.y - state.player.y);
        if (dist < bestD) {
          bestD = dist;
          best = d;
        }
      }
      return best ? { x: best.x, y: best.y, label: 'Cash drop' } : null;
    }
    case 2:
      return m.step === 0 ? null : { x: safe.x, y: safe.y, label: 'Safehouse' };
    case 3: {
      const zone = m.data.zone || DROP_ZONE;
      return m.step === 2
        ? { x: safe.x, y: safe.y, label: 'Safehouse' }
        : { x: zone.x, y: zone.y, label: 'Grab zone' };
    }
    case 4:
      return m.step === 0
        ? { x: NIGHT_PICKUP.x, y: NIGHT_PICKUP.y, label: 'Pickup' }
        : { x: garage.x, y: garage.y, label: "Marlow's Garage" };
    case 5:
      return m.step === 0
        ? { x: m.data.truck?.x ?? TRUCK_SPOT.x, y: m.data.truck?.y ?? TRUCK_SPOT.y, label: 'Armoured truck' }
        : { x: garage.x, y: garage.y, label: "Marlow's Garage" };
    default:
      return null;
  }
}

// --- Save / load ------------------------------------------------------------------

export function serializeMission(state) {
  const m = state.mission;
  return {
    index: state.currentMission,
    step: m.step,
    collected: m.collected,
    timer: Math.max(0, m.timer),
    progress: m.progress,
    active: m.active,
  };
}

export function restoreMission(state, saved) {
  if (!saved || saved.index === undefined) {
    // An old save with no mission data: start from the current mission.
    if (state.currentMission < MISSIONS.length) startMission(state, state.currentMission);
    return;
  }
  if (saved.index >= MISSIONS.length) {
    state.currentMission = saved.index;
    state.mission.active = false;
    state.objective = 'Free roam — the city is yours, Rook';
    return;
  }
  startMission(state, saved.index, true);
  const m = state.mission;
  m.step = saved.step || 0;
  m.collected = saved.collected || 0;
  if (saved.timer) m.timer = saved.timer;
  m.progress = saved.progress || 0;
  // Harbor Run: drops already collected stay collected.
  if (saved.index === 1 && m.collected > 0) {
    let remove = m.collected;
    state.cashDrops = state.cashDrops.filter((d) => {
      if (d.mission && remove > 0) {
        remove--;
        return false;
      }
      return true;
    });
  }
  // Re-derive the objective line (and any step that is already satisfied).
  updateMissions(state, 0);
}
