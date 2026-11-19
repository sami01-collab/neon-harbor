// NEON HARBOR — the city. A seeded procedural harbour city on a road grid:
// avenues and streets, building blocks, a harbour along the south and east
// edges, a beach and boardwalk along the west edge, and five districts.
// Everything is generated from the seed, so the same seed builds the same
// city every time. The module also answers collision and road queries for
// the cars, pedestrians and player.

import { CONFIG } from './config.js';
import { createRng } from './random.js';

const S = CONFIG.worldSize;

// Road centre lines: 100, 300, ... 1700 on both axes.
function roadLines() {
  const lines = [];
  for (let c = CONFIG.roadOffset; c < CONFIG.waterEast; c += CONFIG.roadSpacing) {
    lines.push(c);
  }
  return lines;
}

export function districtAt(x, y) {
  if (x < CONFIG.boardwalkEast) return 'beach';
  if (x >= 1680 || y >= 1680) return 'docks';
  if (x >= 600 && x <= 1400 && y >= 500 && y <= 1300) return 'downtown';
  if (x < 700 && y < 700) return 'oldtown';
  return 'suburbs';
}

export function createWorld(seed) {
  const rng = createRng(seed);
  const vertical = roadLines();
  const horizontal = roadLines();
  const edge = CONFIG.roadHalf + CONFIG.sidewalk; // road centre to block edge

  const buildings = [];
  const lamps = [];
  const containers = [];
  const cranes = [];
  const piers = [];
  const trees = [];
  const parks = [];
  const neonSigns = [];
  const parkedSpots = [];

  // --- Building blocks between the roads -------------------------------
  // Block columns/rows: the strips between neighbouring road centrelines,
  // plus the edge strips (north of the first street, east/south docks).
  const colEdges = [0, ...vertical, S];
  const rowEdges = [0, ...horizontal, S];

  // A couple of blocks become parks instead of buildings.
  const parkKeys = new Set();
  while (parkKeys.size < 3) {
    const ci = rng.int(1, vertical.length - 1);
    const ri = rng.int(1, horizontal.length - 1);
    const key = ci + ':' + ri;
    // Keep parks out of downtown and the docks.
    const cx = (colEdges[ci] + colEdges[ci + 1]) / 2;
    const cy = (rowEdges[ri] + rowEdges[ri + 1]) / 2;
    if (districtAt(cx, cy) === 'suburbs') parkKeys.add(key);
  }

  for (let ci = 0; ci < colEdges.length - 1; ci++) {
    for (let ri = 0; ri < rowEdges.length - 1; ri++) {
      const x0 = colEdges[ci] === 0 ? CONFIG.boardwalkEast : colEdges[ci] + edge;
      const x1 = colEdges[ci + 1] === S ? CONFIG.waterEast : colEdges[ci + 1] - edge;
      const y0 = rowEdges[ri] === 0 ? edge : rowEdges[ri] + edge;
      const y1 = rowEdges[ri + 1] === S ? CONFIG.waterSouth : rowEdges[ri + 1] - edge;
      if (x1 - x0 < 40 || y1 - y0 < 40) continue;
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const district = districtAt(cx, cy);
      if (district === 'beach') continue;

      if (parkKeys.has(ci + ':' + ri)) {
        parks.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        const nTrees = rng.int(6, 11);
        for (let t = 0; t < nTrees; t++) {
          trees.push({ x: rng.range(x0 + 8, x1 - 8), y: rng.range(y0 + 8, y1 - 8), r: rng.range(7, 11) });
        }
        continue;
      }

      const palette = CONFIG.districtColors[district] || CONFIG.districtColors.suburbs;
      if (district === 'downtown') {
        // One tall tower, sometimes two.
        const two = rng.chance(0.35);
        const slots = two
          ? [{ x: x0 + 6, y: y0 + 6, w: (x1 - x0) / 2 - 10, h: y1 - y0 - 12 },
             { x: x0 + (x1 - x0) / 2 + 4, y: y0 + 6, w: (x1 - x0) / 2 - 10, h: y1 - y0 - 12 }]
          : [{ x: x0 + 10, y: y0 + 10, w: x1 - x0 - 20, h: y1 - y0 - 20 }];
        for (const s of slots) {
          const floors = rng.int(5, 12);
          const b = {
            x: s.x, y: s.y, w: s.w, h: s.h, floors,
            color: rng.pick(palette), district,
            roof: rng.pick(['#3a3f46', '#464b52', '#2f3338']),
          };
          buildings.push(b);
          if (rng.chance(0.6)) {
            neonSigns.push({
              x: b.x + b.w / 2, y: b.y + 4,
              text: rng.pick(['NEON', 'HARBOUR', '24H', 'HOTEL', 'BAR', 'CLUB', 'PIER 9', 'ROOK', 'LUXE', 'DIVE']),
              color: rng.pick(CONFIG.neonColors),
              vertical: rng.chance(0.4),
            });
          }
        }
      } else if (district === 'docks') {
        // Low wide warehouses, sometimes with a container yard instead.
        if (rng.chance(0.3)) {
          const n = rng.int(3, 7);
          for (let k = 0; k < n; k++) {
            containers.push({
              x: rng.range(x0 + 4, x1 - 30), y: rng.range(y0 + 4, y1 - 16),
              w: 26, h: 11,
              color: rng.pick(['#b03a2e', '#2e7ab0', '#3a8a4a', '#c8a02e', '#7a5aa0', '#c85a2e']),
              angle: rng.chance(0.5) ? 0 : Math.PI / 2,
            });
          }
        } else {
          buildings.push({
            x: x0 + 6, y: y0 + 6, w: x1 - x0 - 12, h: y1 - y0 - 12,
            floors: rng.int(1, 2), color: rng.pick(palette), district,
            roof: '#4a4f55',
          });
        }
      } else if (district === 'suburbs') {
        // Four small houses with gardens.
        const mx = (x0 + x1) / 2;
        const my = (y0 + y1) / 2;
        for (const [hx, hy] of [[x0 + 8, y0 + 8], [mx + 4, y0 + 8], [x0 + 8, my + 4], [mx + 4, my + 4]]) {
          buildings.push({
            x: hx, y: hy, w: (x1 - x0) / 2 - 16, h: (y1 - y0) / 2 - 16,
            floors: rng.int(1, 2), color: rng.pick(palette), district,
            roof: rng.pick(['#8a4a3a', '#5a4a3a', '#3a4a5a']),
          });
          if (rng.chance(0.7)) trees.push({ x: hx + rng.range(4, 20), y: hy + rng.range(4, 20), r: rng.range(5, 8) });
        }
      } else {
        // Old Town: two or four compact blocks.
        const twoByTwo = rng.chance(0.5);
        const slots = twoByTwo
          ? [[x0 + 6, y0 + 6], [x0 + (x1 - x0) / 2 + 3, y0 + 6], [x0 + 6, y0 + (y1 - y0) / 2 + 3], [x0 + (x1 - x0) / 2 + 3, y0 + (y1 - y0) / 2 + 3]]
          : [[x0 + 8, y0 + 8], [x0 + (x1 - x0) / 2 + 4, y0 + 8]];
        for (const [bx, by] of slots) {
          buildings.push({
            x: bx, y: by,
            w: (x1 - x0) / (twoByTwo ? 2 : 2) - 12,
            h: (y1 - y0) / (twoByTwo ? 2 : 1) - 12,
            floors: rng.int(2, 3), color: rng.pick(palette), district,
            roof: rng.pick(['#6a4a3a', '#4a3a2a', '#5a5a4a']),
          });
        }
      }
    }
  }

  // --- Docks: piers, cranes, container yards ---------------------------
  for (let i = 0; i < 4; i++) {
    const px = 300 + i * 420 + rng.range(-40, 40);
    piers.push({ x: px, y: CONFIG.waterSouth - 6, w: 44, h: 150 });
  }
  for (let i = 0; i < 3; i++) {
    const py = 350 + i * 480 + rng.range(-40, 40);
    piers.push({ x: CONFIG.waterEast - 6, y: py, w: 150, h: 44 });
  }
  for (let i = 0; i < 5; i++) {
    cranes.push({
      x: rng.range(300, 1650), y: CONFIG.waterSouth - rng.range(28, 60),
      angle: rng.range(-0.4, 0.4),
    });
  }
  for (let i = 0; i < 3; i++) {
    cranes.push({
      x: CONFIG.waterEast - rng.range(28, 60), y: rng.range(300, 1650),
      angle: Math.PI / 2 + rng.range(-0.4, 0.4),
    });
  }
  // Extra container stacks along the quays.
  for (let i = 0; i < 26; i++) {
    const south = rng.chance(0.6);
    containers.push({
      x: south ? rng.range(120, 1720) : rng.range(1720, 1770),
      y: south ? rng.range(1730, 1780) : rng.range(120, 1720),
      w: 26, h: 11,
      color: rng.pick(['#b03a2e', '#2e7ab0', '#3a8a4a', '#c8a02e', '#7a5aa0']),
      angle: south ? (rng.chance(0.5) ? 0 : Math.PI / 2) : Math.PI / 2,
    });
  }

  // --- Street lamps along the roads ------------------------------------
  for (const vx of vertical) {
    for (let y = 60; y < CONFIG.waterSouth; y += 100) {
      lamps.push({ x: vx + CONFIG.roadHalf + 4, y });
    }
  }
  for (const hy of horizontal) {
    for (let x = 140; x < CONFIG.waterEast; x += 100) {
      lamps.push({ x, y: hy + CONFIG.roadHalf + 4 });
    }
  }

  // --- Parked car spots along road edges -------------------------------
  for (let i = 0; i < CONFIG.parkedCount * 3; i++) {
    const verticalRoad = rng.chance(0.5);
    const coord = rng.pick(verticalRoad ? vertical : horizontal);
    const along = rng.range(140, 1700);
    const side = rng.chance(0.5) ? 1 : -1;
    const off = (CONFIG.roadHalf - 8) * side;
    parkedSpots.push({
      x: verticalRoad ? coord + off : along,
      y: verticalRoad ? along : coord + off,
      angle: verticalRoad ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : (side > 0 ? 0 : Math.PI),
    });
  }

  // --- Landmarks (fixed, for missions and respawn) ---------------------
  const landmarks = {
    garage: { x: 900, y: 1100, label: "Marlow's Garage" },
    safehouse: { x: 500, y: 300, label: 'Safehouse' },
    hospital: { x: 1300, y: 500, label: 'Harbor General' },
    policeStation: { x: 1100, y: 900, label: 'Central Precinct' },
    spawn: { x: 500, y: 900, label: 'Spawn' },
  };

  // --- Query helpers ----------------------------------------------------
  function isOnPier(x, y) {
    for (const p of piers) {
      if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return true;
    }
    return false;
  }

  function isWater(x, y) {
    if (x < 0 || y < 0 || x >= S || y >= S) return false;
    if (x >= CONFIG.waterEast || y >= CONFIG.waterSouth) return !isOnPier(x, y);
    return false;
  }

  function isRoad(x, y) {
    if (x < 0 || y < 0 || x >= CONFIG.waterEast || y >= CONFIG.waterSouth) return false;
    for (const vx of vertical) if (Math.abs(x - vx) <= CONFIG.roadHalf) return true;
    for (const hy of horizontal) if (Math.abs(y - hy) <= CONFIG.roadHalf) return true;
    return false;
  }

  function nearestRoad(x, y) {
    let best = null;
    let bestDist = Infinity;
    for (const vx of vertical) {
      const d = Math.abs(x - vx);
      if (d < bestDist) { bestDist = d; best = { axis: 'v', coord: vx }; }
    }
    for (const hy of horizontal) {
      const d = Math.abs(y - hy);
      if (d < bestDist) { bestDist = d; best = { axis: 'h', coord: hy }; }
    }
    return { ...best, dist: bestDist };
  }

  // Push a circle out of buildings, water and the world edge. Returns the
  // corrected position and whether a collision happened.
  function collideCircle(x, y, r) {
    let hit = false;
    // World bounds.
    if (x < r) { x = r; hit = true; }
    if (y < r) { y = r; hit = true; }
    if (x > S - r) { x = S - r; hit = true; }
    if (y > S - r) { y = S - r; hit = true; }
    // Water: push back onto dry land (piers are safe).
    if (isWater(x, y)) {
      hit = true;
      if (x >= CONFIG.waterEast && y < CONFIG.waterSouth) x = CONFIG.waterEast - r - 1;
      else if (y >= CONFIG.waterSouth && x < CONFIG.waterEast) y = CONFIG.waterSouth - r - 1;
      else {
        // Corner: push out along the nearer edge.
        if (CONFIG.waterEast - x < CONFIG.waterSouth - y) x = CONFIG.waterEast - r - 1;
        else y = CONFIG.waterSouth - r - 1;
      }
    }
    // Buildings: circle vs axis-aligned rectangle, push out along the
    // smallest penetration axis.
    for (const b of buildings) {
      const cx = Math.max(b.x, Math.min(x, b.x + b.w));
      const cy = Math.max(b.y, Math.min(y, b.y + b.h));
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r) {
        hit = true;
        if (d2 > 0.0001) {
          const d = Math.sqrt(d2);
          x = cx + (dx / d) * r;
          y = cy + (dy / d) * r;
        } else {
          // Centre inside the rectangle: push out the nearest side.
          const left = x - b.x;
          const right = b.x + b.w - x;
          const top = y - b.y;
          const bottom = b.y + b.h - y;
          const m = Math.min(left, right, top, bottom);
          if (m === left) x = b.x - r;
          else if (m === right) x = b.x + b.w + r;
          else if (m === top) y = b.y - r;
          else y = b.y + b.h + r;
        }
      }
    }
    return { x, y, hit };
  }

  function randomRoadPoint(r) {
    if (r.chance(0.5)) {
      return { x: r.pick(vertical), y: r.range(80, 1720) };
    }
    return { x: r.range(80, 1720), y: r.pick(horizontal) };
  }

  return {
    seed,
    size: S,
    vertical,
    horizontal,
    buildings,
    lamps,
    containers,
    cranes,
    piers,
    trees,
    parks,
    neonSigns,
    parkedSpots,
    landmarks,
    districtAt,
    isWater,
    isRoad,
    nearestRoad,
    collideCircle,
    randomRoadPoint,
  };
}
