// NEON HARBOR — tuning constants. One place for every number that shapes
// how the city looks and the game feels, so stage 2 can tune without hunting.

export const CONFIG = {
  // World
  worldSize: 2000,
  roadSpacing: 200, // distance between parallel roads
  roadOffset: 100, // first road sits at x/y = 100
  roadHalf: 20, // half the asphalt width
  sidewalk: 9, // sidewalk band each side of the asphalt
  waterSouth: 1800, // y >= this is harbour water
  waterEast: 1800, // x >= this is harbour water
  beachWest: 64, // x < this is sand
  boardwalkEast: 96, // sand ends, boardwalk runs to the first avenue

  // Time — one full day lasts about six minutes of real play.
  dayLengthSec: 360,
  startHour: 10.0,

  // Player on foot
  walkSpeed: 135,
  sprintSpeed: 215,
  playerRadius: 10,
  playerHealth: 100,
  punchRange: 34,
  punchDamage: 15,
  punchCooldown: 0.35,

  // Shooting
  bulletSpeed: 950,
  bulletLife: 0.9,
  bulletDamage: 34,
  fireCooldown: 0.22,
  gunRange: 520,

  // Wanted
  wantedCrimeCooldown: 4, // seconds between wanted increments

  // Police
  policeSightRange: 520, // cruisers spot the player within this range (with line of sight)
  policeOfficerSight: 340,
  policeEvadeBase: 6, // seconds hidden to lose the cops, before the per-star bonus
  policeEvadePerStar: 2,
  policeBustTime: 1.5, // seconds pinned by an officer on foot before busted
  policeBoxedBustTime: 2.5, // seconds stopped with 2+ cruisers alongside
  policeShootStars: 4, // police open fire at this wanted level
  roadblockStars: 3, // roadblocks go up at this wanted level

  // Cash
  cashDropCount: 9,
  cashDropMin: 40,
  cashDropMax: 220,
  cashPickupRadius: 26,
  cashRespawnSec: 25,

  // Traffic / pedestrians
  trafficCount: 26,
  pedCount: 42,
  parkedCount: 18,

  // Camera
  cameraLead: 26, // camera leans ahead of the player's motion

  // Colours
  colors: {
    grass: '#3d7a44',
    grassDark: '#356b3b',
    park: '#4c8a4f',
    sand: '#d9c48c',
    boardwalk: '#a9805a',
    waterDeep: '#0d3a5c',
    waterShallow: '#14608f',
    asphalt: '#33373d',
    asphaltDark: '#2b2e33',
    sidewalk: '#8d9299',
    curb: '#6f747b',
    laneDash: '#e8e3c8',
    crosswalk: '#d8d8d8',
  },

  // Car types: size in world units, speeds in units/second.
  carTypes: {
    sedan: {
      label: 'Sedan', w: 34, h: 17, topSpeed: 330, accel: 210, brake: 420,
      turn: 2.6, grip: 7.5, health: 100,
      colors: ['#b03a3a', '#3a6db0', '#c8c8c8', '#3a3a3a', '#7a5aa0', '#b07a3a'],
    },
    taxi: {
      label: 'Taxi', w: 34, h: 17, topSpeed: 330, accel: 215, brake: 420,
      turn: 2.6, grip: 7.5, health: 100,
      colors: ['#e8c832'],
    },
    pickup: {
      label: 'Pickup', w: 38, h: 18, topSpeed: 300, accel: 190, brake: 380,
      turn: 2.3, grip: 7.0, health: 130,
      colors: ['#5a7a4a', '#8a4a3a', '#4a6a7a', '#c8c8c8'],
    },
    van: {
      label: 'Van', w: 40, h: 19, topSpeed: 260, accel: 160, brake: 340,
      turn: 2.0, grip: 6.5, health: 150,
      colors: ['#d8d8d8', '#4a5a7a', '#7a7a7a'],
    },
    sports: {
      label: 'Sports', w: 35, h: 16, topSpeed: 460, accel: 300, brake: 480,
      turn: 3.1, grip: 8.6, health: 80,
      colors: ['#d8232a', '#f2a007', '#20b8d8', '#e8e8e8', '#7020d8'],
    },
    police: {
      label: 'Police Cruiser', w: 35, h: 17, topSpeed: 400, accel: 280, brake: 460,
      turn: 2.9, grip: 8.2, health: 140,
      colors: ['#1a2a4a'],
    },
    armored: {
      label: 'Armoured Truck', w: 46, h: 20, topSpeed: 240, accel: 130, brake: 300,
      turn: 1.8, grip: 6.0, health: 300,
      colors: ['#5a6a72'],
    },
  },

  // District palettes for building bodies.
  districtColors: {
    downtown: ['#5a6a8a', '#6a5a7a', '#4a6a7a', '#7a6a5a', '#5a7a6a', '#8a7a5a'],
    docks: ['#7a6a58', '#6a7a72', '#8a7a68', '#5f6b7a'],
    oldtown: ['#a08a6a', '#8a7a5a', '#9a8a7a', '#7a8a6a'],
    beach: ['#d8c8a8', '#c8b898', '#e0d0b0', '#b8c8c8'],
    suburbs: ['#b8a898', '#a8b898', '#c8b8a8', '#98a8b8'],
  },

  neonColors: ['#ff2d78', '#22e6ff', '#ffe600', '#7dff2d', '#ff7a2d', '#c84bff'],

  // Rank titles by lifetime cash earned.
  ranks: [
    [0, 'Nobody'],
    [1000, 'Wheelman'],
    [5000, 'Runner'],
    [15000, 'Fixer'],
    [40000, 'Harbor King'],
    [100000, 'Legend of Neon Harbor'],
  ],
};

export function rankFor(lifetimeCash) {
  let rank = CONFIG.ranks[0][1];
  for (const [threshold, name] of CONFIG.ranks) {
    if (lifetimeCash >= threshold) rank = name;
  }
  return rank;
}
