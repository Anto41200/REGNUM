// ============================================================
//  REGNUM — map.js  v0.16
//  Moteur de rendu cartographique style CK3 / carte médiévale
// ============================================================

'use strict';

/* ─────────────────────────────────────────────
   NOISE / MATH UTILITIES
───────────────────────────────────────────── */
function hash(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
function smoothNoise(x, y) {
  let s = 0, w = 0;
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const wt = 1 / (Math.abs(dx) + Math.abs(dy) + 1);
      s += hash(x + dx, y + dy) * wt; w += wt;
    }
  }
  return s / w;
}
function fbm(x, y, oct = 4) {
  let v = 0, amp = 1, freq = 1, max = 0;
  for (let i = 0; i < oct; i++) {
    v += smoothNoise(x * freq, y * freq) * amp;
    max += amp; amp *= 0.5; freq *= 2.1;
  }
  return v / max;
}
function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, mn, mx) { return Math.max(mn, Math.min(mx, v)); }
function lerpColor(c1, c2, t) {
  return [
    Math.floor(lerp(c1[0], c2[0], t)),
    Math.floor(lerp(c1[1], c2[1], t)),
    Math.floor(lerp(c1[2], c2[2], t)),
  ];
}
function rgb(c) { return `rgb(${c[0]},${c[1]},${c[2]})`; }
function rgba(c, a) { return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }

/* ─────────────────────────────────────────────
   ELEVATION MAP  (W×H continuous float 0..1)
───────────────────────────────────────────── */
const MAP_W = 26, MAP_H = 18;
let elevMap = null;

function buildElevationMap() {
  elevMap = new Float32Array(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      // Island shape: fade near borders
      const bx = Math.min(x, MAP_W - 1 - x) / (MAP_W * 0.18);
      const by = Math.min(y, MAP_H - 1 - y) / (MAP_H * 0.18);
      const border = clamp(Math.min(bx, by), 0, 1);
      const n = fbm(x * 0.28, y * 0.28, 5);
      elevMap[y * MAP_W + x] = clamp(n * border, 0, 1);
    }
  }
}

function getElev(x, y) {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return 0;
  return elevMap[y * MAP_W + x];
}

/* ─────────────────────────────────────────────
   RIVER GENERATION
───────────────────────────────────────────── */
let rivers = [];   // array of [{px,py}]

function generateRivers() {
  rivers = [];
  // Find 4 mountain peaks and flow downhill to sea
  const sources = [];
  for (let y = 2; y < MAP_H - 2; y++) {
    for (let x = 2; x < MAP_W - 2; x++) {
      if (getElev(x, y) > 0.62 && hash(x * 3.1, y * 7.3) > 0.82) {
        sources.push({ x, y });
      }
    }
  }
  // Keep only 5 well-spread sources
  const chosen = [];
  for (const s of sources) {
    if (chosen.every(c => Math.abs(c.x - s.x) + Math.abs(c.y - s.y) > 4)) chosen.push(s);
    if (chosen.length >= 5) break;
  }

  for (const src of chosen) {
    const path = [];
    let cx = src.x + 0.5, cy = src.y + 0.5;
    const seen = new Set();
    for (let step = 0; step < 80; step++) {
      path.push({ px: cx, py: cy });
      const key = `${Math.floor(cx)},${Math.floor(cy)}`;
      if (seen.has(key)) break;
      seen.add(key);
      const e = getElev(Math.floor(cx), Math.floor(cy));
      if (e < 0.10) break;

      // Sinuosity: biased downhill + small random meander
      let bestDx = 0, bestDy = 0, bestE = e;
      const dirs = [];
      for (let tries = 0; tries < 16; tries++) {
        const angle = Math.atan2(
          (getElev(Math.floor(cx), Math.floor(cy) + 1) - getElev(Math.floor(cx), Math.floor(cy) - 1)),
          (getElev(Math.floor(cx) + 1, Math.floor(cy)) - getElev(Math.floor(cx) - 1, Math.floor(cy)))
        ) + (hash(cx * 5 + step, cy * 7) - 0.5) * 1.2;
        dirs.push({ dx: Math.cos(angle), dy: Math.sin(angle) });
      }
      // Steepest descent with meander
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (!dx && !dy) continue;
          const ne = getElev(Math.floor(cx + dx * 0.7), Math.floor(cy + dy * 0.7));
          if (ne < bestE) { bestE = ne; bestDx = dx; bestDy = dy; }
        }
      }
      const meander = hash(cx * 13.7 + step, cy * 9.3 + step * 0.7) * 0.6 - 0.3;
      cx += (bestDx + meander) * 0.55;
      cy += (bestDy + meander * 0.5) * 0.55;
      cx = clamp(cx, 0.5, MAP_W - 0.5);
      cy = clamp(cy, 0.5, MAP_H - 0.5);
    }
    if (path.length > 6) rivers.push(path);
  }
}

/* ─────────────────────────────────────────────
   COAST IRREGULARITY DATA
───────────────────────────────────────────── */
// Pre-baked per-edge beach offsets for a hand-crafted look
function getCoastJitter(x, y, side) {
  return (hash(x * 41.3 + y * 17.7 + side * 100) - 0.5) * 0.35;
}

/* ─────────────────────────────────────────────
   HILLSHADING
───────────────────────────────────────────── */
// Sun from NW, elevation 45°
const SUN_AZ = -Math.PI * 0.6;
const SUN_EL = Math.PI * 0.35;

function hillshade(x, y) {
  // Sobel on elevation
  const dzdx = (getElev(x + 1, y) - getElev(x - 1, y)) * 0.5;
  const dzdy = (getElev(x, y + 1) - getElev(x, y - 1)) * 0.5;
  const slope = Math.sqrt(dzdx * dzdx + dzdy * dzdy);
  const aspect = Math.atan2(dzdy, dzdx);
  const hs = Math.cos(SUN_EL) * Math.cos(Math.atan(slope * 8)) +
    Math.sin(SUN_EL) * Math.sin(Math.atan(slope * 8)) *
    Math.cos(SUN_AZ - aspect);
  return clamp(hs, 0, 1);
}

/* ─────────────────────────────────────────────
   TERRAIN COLOR (with season + elevation tint)
───────────────────────────────────────────── */
const TERRAIN_PALETTES = {
  plains:   [[72, 120, 36], [90, 145, 48]],
  forest:   [[24,  65, 14], [36,  88, 22]],
  mountain: [[115, 108, 95], [140, 130, 112]],
  hills:    [[85, 112, 50], [100, 130, 62]],
  water:    [[20,  58, 125], [30, 78, 158]],
  capital:  [[125, 95, 22], [145, 112, 35]],
  coast:    [[195, 178, 128], [210, 195, 148]],
};

// Season modifiers  [spring, summer, autumn, winter]
const SEASON_SAT = [1.05, 1.12, 0.88, 0.62];
const SEASON_BRIGHT = [1.02, 1.08, 0.95, 0.78];
const SEASON_SNOW_THRESH = [1.5, 1.8, 1.3, 0.55]; // elev above which snow

function terrainColor(tile, elev, season) {
  const pal = TERRAIN_PALETTES[tile.type] || TERRAIN_PALETTES.plains;
  const n = hash(tile.x * 73.1 + tile.y * 143.7);
  let c = lerpColor(pal[0], pal[1], n);

  // Elevation tint: higher = cooler/lighter (atmospheric perspective)
  const altTint = clamp(elev - 0.45, 0, 1);
  c = lerpColor(c, [185, 195, 205], altTint * 0.35);

  // Season
  const sat = SEASON_SAT[season];
  const br = SEASON_BRIGHT[season];
  c = c.map(v => clamp(Math.floor(v * br), 0, 255));
  if (season === 3 && tile.type !== 'water') {
    // desaturate in winter
    const grey = (c[0] + c[1] + c[2]) / 3;
    c = c.map(v => Math.floor(lerp(v, grey, 0.4)));
  }

  // Snow on peaks in winter/autumn
  if (elev > SEASON_SNOW_THRESH[season] && tile.type === 'mountain') {
    c = lerpColor(c, [235, 238, 245], clamp((elev - SEASON_SNOW_THRESH[season]) * 3, 0, 1));
  }

  return c;
}

/* ─────────────────────────────────────────────
   BUILDING FOOTPRINTS (per tile type)
───────────────────────────────────────────── */
function drawBuilding(ctx, type, cx, cy, sc) {
  const s = sc * 0.9;
  ctx.save();
  ctx.translate(cx, cy);

  if (type === 'capital' || type === 'castle') {
    // Castle silhouette
    ctx.fillStyle = '#2a1e0e';
    ctx.strokeStyle = '#6a5030';
    ctx.lineWidth = 0.5 * s;
    // Keep
    ctx.fillRect(-5 * s, -9 * s, 10 * s, 10 * s);
    // Battlements
    for (let i = -5; i <= 3; i += 2.5) {
      ctx.fillRect(i * s, -12 * s, 2 * s, 3 * s);
    }
    // Tower left
    ctx.fillRect(-8 * s, -7 * s, 5 * s, 8 * s);
    ctx.fillRect(-8.5 * s, -10 * s, 6 * s, 3 * s);
    // Tower right
    ctx.fillRect(3 * s, -7 * s, 5 * s, 8 * s);
    ctx.fillRect(2.5 * s, -10 * s, 6 * s, 3 * s);
    // Gate
    ctx.fillStyle = '#0a0604';
    ctx.beginPath();
    ctx.arc(0, 0.5 * s, 2.5 * s, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(-2.5 * s, -4.5 * s, 5 * s, 5 * s);
    // Flag
    ctx.fillStyle = '#c8921e';
    ctx.fillRect(0, -12 * s, 0.8 * s, -5 * s);
    ctx.beginPath();
    ctx.moveTo(0.8 * s, -17 * s);
    ctx.lineTo(0.8 * s, -12 * s);
    ctx.lineTo(5 * s, -14.5 * s);
    ctx.closePath();
    ctx.fill();

  } else if (type === 'village' || type === 'town') {
    const count = type === 'town' ? 4 : 2;
    for (let i = 0; i < count; i++) {
      const ox = (i - count / 2 + 0.5) * 7 * s;
      const oy = hash(i * 17, i * 31) * 3 * s - 2 * s;
      // House body
      ctx.fillStyle = lerpColor([160, 130, 95], [140, 110, 75], hash(i, i * 3)).join(',');
      ctx.fillStyle = `rgb(${lerpColor([160, 130, 95], [140, 110, 75], hash(i, i * 3)).join(',')})`;
      ctx.fillRect(ox - 3 * s, oy - 2 * s, 6 * s, 5 * s);
      // Roof
      ctx.fillStyle = `rgb(${lerpColor([100, 50, 30], [130, 70, 40], hash(i * 5, i)).join(',')})`;
      ctx.beginPath();
      ctx.moveTo(ox - 4 * s, oy - 2 * s);
      ctx.lineTo(ox, oy - 7 * s);
      ctx.lineTo(ox + 4 * s, oy - 2 * s);
      ctx.closePath();
      ctx.fill();
    }

  } else if (type === 'monastery') {
    // Cross + bell tower
    ctx.fillStyle = '#c8b880';
    ctx.strokeStyle = '#8a7840';
    ctx.lineWidth = 0.8 * s;
    // Tower
    ctx.fillRect(-3 * s, -10 * s, 6 * s, 10 * s);
    // Cross on top
    ctx.fillRect(-0.8 * s, -14 * s, 1.6 * s, 5 * s);
    ctx.fillRect(-3 * s, -12 * s, 6 * s, 1.6 * s);
    // Nave
    ctx.fillRect(-6 * s, -5 * s, 12 * s, 7 * s);
    // Arched windows
    ctx.fillStyle = '#1a1208';
    ctx.beginPath(); ctx.arc(-1.5 * s, -3 * s, 1.2 * s, Math.PI, 0); ctx.fill();
    ctx.beginPath(); ctx.arc(1.5 * s, -3 * s, 1.2 * s, Math.PI, 0); ctx.fill();

  } else if (type === 'ruin') {
    // Broken walls
    ctx.fillStyle = '#6a6055';
    ctx.fillRect(-6 * s, -4 * s, 4 * s, 6 * s);
    ctx.fillRect(2 * s, -6 * s, 4 * s, 8 * s);
    ctx.fillRect(-5 * s, -1 * s, 10 * s, 2 * s);
    // Cracks
    ctx.strokeStyle = '#3a3028';
    ctx.lineWidth = 0.7 * s;
    ctx.beginPath(); ctx.moveTo(3 * s, -6 * s); ctx.lineTo(4.5 * s, -2 * s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-5 * s, -4 * s); ctx.lineTo(-3 * s, -1 * s); ctx.stroke();

  } else if (type === 'farm') {
    // Barn
    ctx.fillStyle = '#8a5030';
    ctx.fillRect(-5 * s, -3 * s, 10 * s, 6 * s);
    ctx.fillStyle = '#5a2010';
    ctx.beginPath();
    ctx.moveTo(-6 * s, -3 * s); ctx.lineTo(0, -8 * s); ctx.lineTo(6 * s, -3 * s);
    ctx.closePath(); ctx.fill();
    // Cross beams
    ctx.strokeStyle = '#3a1808'; ctx.lineWidth = 0.5 * s;
    ctx.beginPath(); ctx.moveTo(-5 * s, -3 * s); ctx.lineTo(5 * s, 3 * s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(5 * s, -3 * s); ctx.lineTo(-5 * s, 3 * s); ctx.stroke();

  } else if (type === 'mine') {
    // Mine entrance
    ctx.fillStyle = '#4a4038';
    ctx.fillRect(-5 * s, -3 * s, 10 * s, 5 * s);
    ctx.fillStyle = '#0a0806';
    ctx.beginPath(); ctx.arc(0, -1 * s, 3.5 * s, Math.PI, 0); ctx.fill();
    ctx.fillRect(-3.5 * s, -4 * s, 7 * s, 3 * s);
    // Timber frame
    ctx.strokeStyle = '#6a5030'; ctx.lineWidth = 0.8 * s;
    ctx.strokeRect(-5 * s, -3 * s, 10 * s, 5 * s);

  } else if (type === 'sawmill') {
    // Wooden cabin + log
    ctx.fillStyle = '#7a6040';
    ctx.fillRect(-5 * s, -3 * s, 8 * s, 5 * s);
    ctx.fillStyle = '#5a4020';
    ctx.beginPath();
    ctx.moveTo(-5.5 * s, -3 * s); ctx.lineTo(-1 * s, -7 * s); ctx.lineTo(3.5 * s, -3 * s);
    ctx.closePath(); ctx.fill();
    // Log
    ctx.fillStyle = '#8a6535';
    ctx.beginPath(); ctx.ellipse(4 * s, 1 * s, 4 * s, 1.5 * s, 0.3, 0, Math.PI * 2); ctx.fill();
  }

  ctx.restore();
}

/* ─────────────────────────────────────────────
   TREE DRAWING
───────────────────────────────────────────── */
function drawTree(ctx, tx, ty, sc, type = 'deciduous', season = 0) {
  const h = hash(tx * 17.3, ty * 31.7);
  const trunkH = (3 + h * 4) * sc;
  const cr = (2.5 + h * 2.5) * sc;

  // Trunk
  ctx.fillStyle = `rgb(${55 + h * 20 | 0},${38 + h * 10 | 0},${20 | 0})`;
  ctx.fillRect(tx - 0.7 * sc, ty - trunkH, 1.4 * sc, trunkH);

  if (type === 'conifer') {
    // Spruce — three tiers
    for (let tier = 0; tier < 3; tier++) {
      const cy = ty - trunkH * 0.6 - tier * cr * 0.7;
      const r = cr * (1.2 - tier * 0.3);
      const g = season === 3 ? lerpColor([30, 80, 20], [210, 220, 230], 0.15) : [30, 80, 20];
      ctx.fillStyle = rgba(g, 0.9);
      ctx.beginPath(); ctx.moveTo(tx, cy - r * 1.4); ctx.lineTo(tx + r, cy + r * 0.5); ctx.lineTo(tx - r, cy + r * 0.5); ctx.closePath(); ctx.fill();
    }
  } else {
    // Deciduous canopy
    let col;
    if (season === 0) col = [45, 110, 25];
    else if (season === 1) col = [35, 100, 18];
    else if (season === 2) col = [160, 80, 20]; // autumn gold
    else col = [55, 48, 38]; // winter bare

    const jitter = hash(tx * 53, ty * 71);
    if (season !== 3) {
      ctx.fillStyle = rgba(col, 0.88);
      ctx.beginPath();
      ctx.arc(tx + (jitter - 0.5) * sc, ty - trunkH - cr * 0.5, cr, 0, Math.PI * 2);
      ctx.fill();
      // Shadow blob
      ctx.fillStyle = rgba([col[0] * 0.5 | 0, col[1] * 0.5 | 0, col[2] * 0.5 | 0], 0.3);
      ctx.beginPath();
      ctx.arc(tx + cr * 0.25, ty - trunkH - cr * 0.3, cr * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/* ─────────────────────────────────────────────
   CULTIVATED FIELDS AROUND VILLAGES
───────────────────────────────────────────── */
function drawFields(ctx, px, py, tw, th, sc, season) {
  const cols = season === 1 ? ['#e8d040', '#d4c030'] : // summer: golden wheat
    season === 2 ? ['#c8a020', '#b89018'] : // autumn: harvested
    season === 3 ? ['#a0a090', '#909080'] : // winter: fallow
    ['#80c840', '#70b830']; // spring: green
  const rows = 4, cols2 = 5;
  const fw = tw / cols2, fh = th / rows;
  for (let fy = 0; fy < rows; fy++) {
    for (let fx = 0; fx < cols2; fx++) {
      const c = (fx + fy) % 2 === 0 ? cols[0] : cols[1];
      ctx.fillStyle = c;
      ctx.fillRect(px + fx * fw + 1, py + fy * fh + 1, fw - 2, fh - 2);
    }
  }
  // Row lines (furrows)
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 0.5;
  for (let fy = 0; fy <= rows; fy++) {
    ctx.beginPath();
    ctx.moveTo(px, py + fy * fh);
    ctx.lineTo(px + tw, py + fy * fh);
    ctx.stroke();
  }
}

/* ─────────────────────────────────────────────
   HERALDIC SHIELD (blason)
───────────────────────────────────────────── */
const FACTION_HERALDRY = {
  player:  { bg: [30, 18, 5],   fg: [232, 184, 48],  pattern: 'cross',    border: [200, 160, 40] },
  enemy1:  { bg: [80, 12, 12],  fg: [220, 180, 80],  pattern: 'chevron',  border: [160, 40, 40] },
  enemy2:  { bg: [12, 40, 100], fg: [200, 200, 80],  pattern: 'diagonal', border: [40, 80, 180] },
  ally1:   { bg: [18, 60, 12],  fg: [220, 200, 80],  pattern: 'saltire',  border: [60, 140, 40] },
};

function drawShield(ctx, cx, cy, size, owner) {
  const h = FACTION_HERALDRY[owner];
  if (!h) return;
  const s = size;

  ctx.save();
  ctx.translate(cx, cy);

  // Shield shape clip
  ctx.beginPath();
  ctx.moveTo(-s, -s);
  ctx.lineTo(s, -s);
  ctx.lineTo(s, 0);
  ctx.quadraticCurveTo(s, s * 1.2, 0, s * 1.5);
  ctx.quadraticCurveTo(-s, s * 1.2, -s, 0);
  ctx.closePath();

  // Fill background
  ctx.fillStyle = rgb(h.bg);
  ctx.fill();
  ctx.save(); ctx.clip();

  // Pattern
  ctx.fillStyle = rgba(h.fg, 0.85);
  if (h.pattern === 'cross') {
    ctx.fillRect(-s * 0.2, -s * 1.1, s * 0.4, s * 2.7);
    ctx.fillRect(-s * 1.1, -s * 0.2, s * 2.2, s * 0.4);
  } else if (h.pattern === 'chevron') {
    ctx.beginPath();
    ctx.moveTo(-s * 1.1, s * 0.4); ctx.lineTo(0, -s * 0.5); ctx.lineTo(s * 1.1, s * 0.4);
    ctx.lineTo(s * 1.1, s * 0.9); ctx.lineTo(0, 0); ctx.lineTo(-s * 1.1, s * 0.9);
    ctx.closePath(); ctx.fill();
  } else if (h.pattern === 'diagonal') {
    ctx.save(); ctx.rotate(Math.PI * 0.25);
    ctx.fillRect(-s * 0.2, -s * 2, s * 0.4, s * 4); ctx.restore();
  } else if (h.pattern === 'saltire') {
    ctx.save(); ctx.rotate(Math.PI * 0.25);
    ctx.fillRect(-s * 0.15, -s * 1.5, s * 0.3, s * 3);
    ctx.fillRect(-s * 1.5, -s * 0.15, s * 3, s * 0.3);
    ctx.restore();
  }

  ctx.restore(); // end clip

  // Border
  ctx.strokeStyle = rgb(h.border);
  ctx.lineWidth = s * 0.18;
  ctx.stroke();

  ctx.restore();
}

/* ─────────────────────────────────────────────
   IRREGULAR BORDER LINES (calligraphic ink)
───────────────────────────────────────────── */
function drawTerritoryBorders(ctx, G, TW, TH, ox, oy, sc) {
  const tiles = G.tiles;
  const ownerOf = (x, y) => {
    const t = tiles.find(t => t.x === x && t.y === y);
    return t ? t.owner : null;
  };

  const borderSegs = [];
  tiles.forEach(tile => {
    if (!tile.owner) return;
    const { x, y, owner } = tile;
    const neighbors = [
      { nx: x + 1, ny: y, side: 'right' },
      { nx: x - 1, ny: y, side: 'left' },
      { nx: x, ny: y + 1, side: 'bottom' },
      { nx: x, ny: y - 1, side: 'top' },
    ];
    neighbors.forEach(({ nx, ny, side }) => {
      const nOwner = ownerOf(nx, ny);
      if (nOwner !== owner) {
        borderSegs.push({ x, y, side, owner });
      }
    });
  });

  const COLORS = {
    player:  'rgba(220,180,50,0.85)',
    enemy1:  'rgba(200,60,60,0.75)',
    enemy2:  'rgba(60,110,200,0.75)',
    ally1:   'rgba(80,170,60,0.75)',
  };

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  borderSegs.forEach(({ x, y, side, owner }) => {
    const px = x * TW * sc + ox;
    const py = y * TH * sc + oy;
    const tw = TW * sc, th = TH * sc;

    let x1, y1, x2, y2;
    if (side === 'right') { x1 = px + tw; y1 = py; x2 = px + tw; y2 = py + th; }
    else if (side === 'left') { x1 = px; y1 = py; x2 = px; y2 = py + th; }
    else if (side === 'bottom') { x1 = px; y1 = py + th; x2 = px + tw; y2 = py + th; }
    else { x1 = px; y1 = py; x2 = px + tw; y2 = py; }

    // Irregular ink line: draw 2-3 overlapping strokes with slight jitter
    ctx.strokeStyle = COLORS[owner] || 'rgba(180,180,180,0.6)';
    const w = owner === 'player' ? 2.8 * sc : 1.8 * sc;
    for (let pass = 0; pass < 2; pass++) {
      const jx1 = (hash(x * 71 + y * 53 + side.length + pass) - 0.5) * 2 * sc;
      const jy1 = (hash(x * 53 + y * 41 + side.length + pass * 2) - 0.5) * 2 * sc;
      const jx2 = (hash(x * 41 + y * 71 + side.length + pass * 3) - 0.5) * 2 * sc;
      const jy2 = (hash(x * 37 + y * 67 + side.length + pass * 4) - 0.5) * 2 * sc;
      ctx.lineWidth = w * (0.7 + hash(x + pass, y + pass) * 0.6);
      ctx.globalAlpha = 0.55 + pass * 0.2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(x1 + jx1, y1 + jy1);
      // Slightly curved via a control point
      const mx = (x1 + x2) / 2 + jx1 * 0.5;
      const my = (y1 + y2) / 2 + jy1 * 0.5;
      ctx.quadraticCurveTo(mx, my, x2 + jx2, y2 + jy2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  });

  ctx.restore();
}

/* ─────────────────────────────────────────────
   PARCHMENT OVERLAY (SVG noise pattern via ImageData)
───────────────────────────────────────────── */
let parchmentCanvas = null;

function buildParchmentTexture(w, h) {
  if (parchmentCanvas && parchmentCanvas.width === w && parchmentCanvas.height === h) return;
  parchmentCanvas = document.createElement('canvas');
  parchmentCanvas.width = w; parchmentCanvas.height = h;
  const pCtx = parchmentCanvas.getContext('2d');
  const img = pCtx.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < w * h; i++) {
    const px = i % w, py = (i / w) | 0;
    // Multi-freq grain
    const n = fbm(px * 0.04, py * 0.04, 3) * 0.5 +
      hash(px * 2.7, py * 2.7) * 0.3 +
      hash(px * 0.3 + 77, py * 0.3) * 0.2;
    const sepia = Math.floor(n * 35);
    d[i * 4]     = 200 + sepia;
    d[i * 4 + 1] = 175 + sepia * 0.8;
    d[i * 4 + 2] = 130 + sepia * 0.5;
    d[i * 4 + 3] = Math.floor(n * 32 + 8); // very subtle
  }
  pCtx.putImageData(img, 0, 0);
}

/* ─────────────────────────────────────────────
   FOG OF WAR  (explored / unexplored)
   Simple: unexplored tiles have heavy ink hatch
───────────────────────────────────────────── */
function drawFogOfWar(ctx, tile, px, py, tw, th, sc) {
  // In this demo, player territory = explored, rest = fog with varying density
  const fogLevel = tile.owner === 'player' ? 0 :
    tile.owner ? 0.55 : 0.82;
  if (fogLevel < 0.1) return;

  // Dark fog
  ctx.fillStyle = `rgba(4,3,2,${fogLevel * 0.78})`;
  ctx.fillRect(px, py, tw, th);

  // Diagonal hatch lines (medieval ink)
  if (fogLevel > 0.5) {
    ctx.save();
    ctx.rect(px, py, tw, th);
    ctx.clip();
    ctx.strokeStyle = `rgba(10,6,2,${fogLevel * 0.5})`;
    ctx.lineWidth = 0.6 * sc;
    const spacing = 5 * sc;
    for (let d = -tw; d < tw + th; d += spacing) {
      ctx.beginPath();
      ctx.moveTo(px + d, py);
      ctx.lineTo(px + d + th, py + th);
      ctx.stroke();
    }
    ctx.restore();
  }
}

/* ─────────────────────────────────────────────
   ROAD DRAWING (dirt path style)
───────────────────────────────────────────── */
function drawRoads(ctx, G, TW, TH, ox, oy, sc) {
  // Connect capital to each village/monastery
  const capital = G.tiles.find(t => t.special === 'capital');
  const pois = G.tiles.filter(t => t.special && t.special !== 'capital');
  if (!capital) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  pois.forEach(dest => {
    // Simple A* not needed: draw a jittered polyline along the path
    const pts = [];
    let cx = capital.x + 0.5, cy = capital.y + 0.5;
    const dx = dest.x + 0.5 - cx, dy = dest.y + 0.5 - cy;
    const steps = Math.ceil(Math.sqrt(dx * dx + dy * dy) * 2.5);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const jx = (hash(cx * 13 + i, cy * 7 + i) - 0.5) * 0.45;
      const jy = (hash(cx * 7 + i, cy * 13 + i) - 0.5) * 0.45;
      pts.push({
        x: (cx + dx * t + jx) * TW * sc + ox + TW * sc * 0.5,
        y: (cy + dy * t + jy) * TH * sc + oy + TH * sc * 0.5,
      });
    }

    // Road: dirt color outer, lighter center
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? 'rgba(110,85,50,0.65)' : 'rgba(160,130,85,0.45)';
      ctx.lineWidth = pass === 0 ? 2.8 * sc : 1.2 * sc;
      ctx.setLineDash(pass === 0 ? [] : [3 * sc, 2 * sc]);
      ctx.beginPath();
      pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  });

  ctx.restore();
}

/* ─────────────────────────────────────────────
   BRIDGE at river × road crossings
───────────────────────────────────────────── */
function drawBridge(ctx, px, py, tw, th, sc, horizontal) {
  ctx.save();
  ctx.fillStyle = 'rgba(130,105,65,0.9)';
  ctx.strokeStyle = 'rgba(80,60,30,0.8)';
  ctx.lineWidth = 0.8 * sc;
  if (horizontal) {
    ctx.fillRect(px + tw * 0.35, py + th * 0.42, tw * 0.3, th * 0.16);
    ctx.strokeRect(px + tw * 0.35, py + th * 0.42, tw * 0.3, th * 0.16);
    // Planks
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(px + tw * (0.37 + i * 0.065), py + th * 0.42);
      ctx.lineTo(px + tw * (0.37 + i * 0.065), py + th * 0.58);
      ctx.stroke();
    }
  } else {
    ctx.fillRect(px + tw * 0.42, py + th * 0.35, tw * 0.16, th * 0.3);
    ctx.strokeRect(px + tw * 0.42, py + th * 0.35, tw * 0.16, th * 0.3);
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(px + tw * 0.42, py + th * (0.37 + i * 0.065));
      ctx.lineTo(px + tw * 0.58, py + th * (0.37 + i * 0.065));
      ctx.stroke();
    }
  }
  ctx.restore();
}

/* ─────────────────────────────────────────────
   MAIN DRAW FUNCTION — replaces old drawMap()
───────────────────────────────────────────── */
window.drawMap = function drawMap() {
  const canvas = document.getElementById('map-canvas');
  const container = document.getElementById('map-container');

  // Resize canvas to container
  if (canvas.width !== container.clientWidth || canvas.height !== container.clientHeight) {
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    buildParchmentTexture(canvas.width, canvas.height);
  }

  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  // Lazily build terrain data
  if (!elevMap) { buildElevationMap(); generateRivers(); }

  const season = (typeof G !== 'undefined') ? G.season : 0;
  const ox = G.map.offsetX, oy = G.map.offsetY, sc = G.map.scale;
  const TW = 48, TH = 40;

  /* ── 0. Background ── */
  const SEASON_SKY = ['#0d1508', '#0e1806', '#141008', '#070d14'];
  ctx.fillStyle = SEASON_SKY[season];
  ctx.fillRect(0, 0, W, H);

  /* ── 1. Terrain base tiles ── */
  G.tiles.forEach(tile => {
    const px = tile.x * TW * sc + ox;
    const py = tile.y * TH * sc + oy;
    const tw = TW * sc, th = TH * sc;
    if (px > W || py > H || px + tw < 0 || py + th < 0) return;

    const elev = getElev(tile.x, tile.y);
    const hs = hillshade(tile.x, tile.y);

    // Base terrain color
    let col = terrainColor(tile, elev, season);

    // Hillshade modulation
    const hsMod = lerp(0.55, 1.15, hs);
    col = col.map(v => clamp(Math.floor(v * hsMod), 0, 255));

    // Slight variation per tile
    const nv = hash(tile.x * 73.1, tile.y * 143.7);
    col = col.map(v => clamp(v + (nv - 0.5) * 14, 0, 255));

    ctx.globalAlpha = 1;
    ctx.fillStyle = rgb(col);
    ctx.fillRect(px, py, tw, th);

    /* ── Coast sand strip ── */
    if (tile.type !== 'water') {
      const dirs = [
        { dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }
      ];
      const hasWater = dirs.some(({ dx, dy }) => {
        const n = G.tiles.find(t => t.x === tile.x + dx && t.y === tile.y + dy);
        return n && n.type === 'water';
      });
      if (hasWater) {
        // Sandy beach gradient
        const grad = ctx.createLinearGradient(px, py, px + tw, py + th);
        grad.addColorStop(0, 'rgba(195,175,120,0.0)');
        grad.addColorStop(0.6, 'rgba(195,175,120,0.0)');
        grad.addColorStop(1, 'rgba(195,175,120,0.55)');
        ctx.fillStyle = grad;
        ctx.fillRect(px, py, tw, th);
      }
    }

    /* ── Water wave texture ── */
    if (tile.type === 'water' && sc > 0.55) {
      ctx.strokeStyle = 'rgba(60,120,200,0.22)';
      ctx.lineWidth = 0.7 * sc;
      for (let wi = 0; wi < 3; wi++) {
        const wy = py + th * (0.25 + wi * 0.25);
        const wOff = (Date.now() * 0.0003 + tile.x * 0.4 + wi * 0.5) % (tw);
        ctx.beginPath();
        ctx.moveTo(px, wy);
        for (let wx = 0; wx <= tw; wx += 4 * sc) {
          const amp = 0.8 * sc;
          ctx.lineTo(px + wx, wy + Math.sin((wx + wOff) * 0.4) * amp);
        }
        ctx.stroke();
      }
    }

    /* ── Cultivated fields near villages ── */
    if (tile.type === 'plains' && sc > 0.6) {
      const nearVillage = G.tiles.some(t =>
        (t.special === 'village' || t.special === 'capital') &&
        Math.abs(t.x - tile.x) <= 2 && Math.abs(t.y - tile.y) <= 2
      );
      if (nearVillage && hash(tile.x * 19 + tile.y, tile.y * 23) > 0.45) {
        ctx.globalAlpha = 0.65;
        drawFields(ctx, px, py, tw, th, sc, season);
        ctx.globalAlpha = 1;
      }
    }

    /* ── Grassland micro-texture on plains ── */
    if (tile.type === 'plains' && sc > 0.75) {
      const grassCol = season === 3 ? 'rgba(130,130,110,0.18)' : 'rgba(60,120,30,0.18)';
      ctx.strokeStyle = grassCol;
      ctx.lineWidth = 0.5 * sc;
      const gCount = 8;
      for (let gi = 0; gi < gCount; gi++) {
        const gx = px + hash(tile.x * 7 + gi, tile.y * 11) * tw;
        const gy = py + hash(tile.x * 11 + gi, tile.y * 7 + gi) * th;
        const gh = (2 + hash(gi, tile.x + tile.y) * 3) * sc;
        ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + sc * 0.5, gy - gh); ctx.stroke();
      }
    }

    /* ── Forest trees ── */
    if ((tile.type === 'forest' || tile.type === 'hills') && sc > 0.5) {
      const treeCount = tile.type === 'forest' ? 5 : 2;
      const treeType = tile.y < 6 ? 'conifer' : 'deciduous'; // north = conifer
      for (let ti = 0; ti < treeCount; ti++) {
        const tx = px + (0.15 + hash(tile.x * 17 + ti, tile.y * 11) * 0.7) * tw;
        const ty2 = py + (0.55 + hash(tile.x * 11 + ti, tile.y * 17 + ti) * 0.35) * th;
        ctx.globalAlpha = 0.88;
        drawTree(ctx, tx, ty2, sc * 0.55, treeType, season);
        ctx.globalAlpha = 1;
      }
    }

    /* ── Mountain silhouette ── */
    if (tile.type === 'mountain' && sc > 0.45) {
      const mk = hash(tile.x * 37, tile.y * 29);
      const peakX = px + tw * (0.3 + mk * 0.4);
      const peakY = py + th * (0.05 + mk * 0.1);
      // Shadow face
      ctx.fillStyle = `rgba(0,0,0,${0.2 + mk * 0.15})`;
      ctx.beginPath();
      ctx.moveTo(px + tw * 0.15, py + th * 0.9);
      ctx.lineTo(peakX, peakY);
      ctx.lineTo(px + tw * 0.85, py + th * 0.9);
      ctx.closePath(); ctx.fill();
      // Light face
      ctx.fillStyle = `rgba(255,255,255,${0.08 + mk * 0.06})`;
      ctx.beginPath();
      ctx.moveTo(px + tw * 0.15, py + th * 0.9);
      ctx.lineTo(peakX, peakY);
      ctx.lineTo(px + tw * 0.5, py + th * 0.9);
      ctx.closePath(); ctx.fill();
      // Snow cap (always on mountains)
      if (season === 3 || elev > 0.58) {
        ctx.fillStyle = 'rgba(230,235,245,0.75)';
        ctx.beginPath();
        ctx.moveTo(peakX - tw * 0.12, peakY + th * 0.2);
        ctx.lineTo(peakX, peakY);
        ctx.lineTo(peakX + tw * 0.12, peakY + th * 0.2);
        ctx.closePath(); ctx.fill();
      }
    }

    /* ── Fog of War ── */
    drawFogOfWar(ctx, tile, px, py, tw, th, sc);

    /* ── Territory color overlay ── */
    const ownerAlpha = tile.owner === 'player' ? 0.10 : tile.owner ? 0.06 : 0;
    const ownerColors = {
      player: [200, 160, 40],
      enemy1: [180, 40, 40],
      enemy2: [40, 90, 200],
      ally1:  [60, 160, 40],
    };
    if (tile.owner && ownerColors[tile.owner]) {
      ctx.fillStyle = rgba(ownerColors[tile.owner], ownerAlpha);
      ctx.fillRect(px, py, tw, th);
    }

    /* ── Selected tile highlight ── */
    if (G.selectedTile && G.selectedTile.x === tile.x && G.selectedTile.y === tile.y) {
      ctx.fillStyle = 'rgba(240,192,64,0.12)';
      ctx.fillRect(px, py, tw, th);
      ctx.strokeStyle = 'rgba(240,192,64,0.95)';
      ctx.lineWidth = 2.2 * sc;
      ctx.setLineDash([3 * sc, 2 * sc]);
      ctx.strokeRect(px + 1, py + 1, tw - 2, th - 2);
      ctx.setLineDash([]);
    }
  });

  /* ── 2. Roads (under rivers) ── */
  if (sc > 0.4) {
    drawRoads(ctx, G, TW, TH, ox, oy, sc);
  }

  /* ── 3. Rivers ── */
  ctx.save();
  rivers.forEach((path, ri) => {
    if (path.length < 3) return;
    // Width grows toward end (mouth)
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 1; i < path.length; i++) {
      const t = i / (path.length - 1);
      const width = lerp(1.2, 4.5, t) * sc;
      const p0 = path[i - 1];
      const p1 = path[i];
      const gx0 = p0.px * TW * sc + ox;
      const gy0 = p0.py * TH * sc + oy;
      const gx1 = p1.px * TW * sc + ox;
      const gy1 = p1.py * TH * sc + oy;

      // River body
      ctx.strokeStyle = `rgba(25,75,155,${0.70 + t * 0.2})`;
      ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(gx0, gy0); ctx.lineTo(gx1, gy1); ctx.stroke();

      // Glint
      ctx.strokeStyle = `rgba(80,150,230,${0.18 + t * 0.1})`;
      ctx.lineWidth = width * 0.3;
      ctx.beginPath(); ctx.moveTo(gx0 - sc, gy0 - sc); ctx.lineTo(gx1 - sc, gy1 - sc); ctx.stroke();
    }
  });
  ctx.restore();

  /* ── 4. Territory borders (calligraphic ink) ── */
  drawTerritoryBorders(ctx, G, TW, TH, ox, oy, sc);

  /* ── 5. Buildings & Icons ── */
  G.tiles.forEach(tile => {
    if (!tile.special) return;
    const px = tile.x * TW * sc + ox;
    const py = tile.y * TH * sc + oy;
    const tw = TW * sc, th = TH * sc;
    if (px > W || py > H || px + tw < 0 || py + th < 0) return;
    if (sc < 0.38) return;

    // Fog: don't show buildings in deep fog
    if (!tile.owner && sc < 0.6) return;

    const cx = px + tw * 0.5;
    const cy = py + th * 0.72;

    ctx.globalAlpha = tile.owner === 'player' ? 1 : tile.owner ? 0.82 : 0.5;
    drawBuilding(ctx, tile.special, cx, cy, sc);
    ctx.globalAlpha = 1;

    // Settlement name label
    if (sc > 0.65) {
      const names = { capital: 'Auvray', village: 'Village', ruin: 'Ruines', monastery: 'Abbaye' };
      const name = names[tile.special] || '';
      ctx.font = `${Math.max(8, Math.floor(9 * sc))}px 'Cinzel', serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillText(name, cx + 1, py + th * 0.92 + 1);
      ctx.fillStyle = tile.owner === 'player' ? 'rgba(240,200,80,0.95)' : 'rgba(210,185,145,0.85)';
      ctx.fillText(name, cx, py + th * 0.92);
    }
  });

  /* ── 6. Heraldic shields at territory centers ── */
  if (sc > 0.55) {
    const centers = {
      player:  { x: 12, y: 8 },
      enemy1:  { x: 4,  y: 6 },
      enemy2:  { x: 21, y: 5 },
      ally1:   { x: 13, y: 16 },
    };
    Object.entries(centers).forEach(([owner, { x, y }]) => {
      if (owner !== 'player' && sc < 0.7) return;
      const fogTile = G.tiles.find(t => t.x === x && t.y === y);
      if (!fogTile || (!fogTile.owner && sc < 0.8)) return;
      const cx = x * TW * sc + ox + TW * sc * 0.5;
      const cy = y * TH * sc + oy + TH * sc * 0.3;
      const shieldSize = 6 * sc;
      ctx.globalAlpha = owner === 'player' ? 0.95 : 0.75;
      drawShield(ctx, cx, cy, shieldSize, owner);
      ctx.globalAlpha = 1;
    });
  }

  /* ── 7. Territory name labels ── */
  if (sc > 0.5) {
    const labels = [
      [12, 8,  'AUVRAY',   'rgba(240,200,80,0.95)'],
      [4,  6,  'BLOIS',    'rgba(210,80,80,0.80)'],
      [21, 5,  'BRETAGNE', 'rgba(80,140,220,0.80)'],
      [13, 16, 'CLAIRVAUX','rgba(80,185,60,0.80)'],
    ];
    ctx.font = `bold ${Math.floor(10 * sc)}px 'Cinzel', serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    labels.forEach(([lx, ly, name, col]) => {
      const px = lx * TW * sc + ox + TW * sc * 0.5;
      const py = ly * TH * sc + oy + TH * sc * 1.7;
      // Drop shadow
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillText(name, px + 1, py + 1);
      ctx.fillStyle = col;
      ctx.fillText(name, px, py);

      // Thin decorative underline
      const tw2 = ctx.measureText(name).width;
      ctx.strokeStyle = col.replace('0.80', '0.35').replace('0.95', '0.4');
      ctx.lineWidth = 0.7;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(px - tw2 / 2, py + 8); ctx.lineTo(px + tw2 / 2, py + 8); ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  /* ── 8. Atmospheric valley haze ── */
  G.tiles.forEach(tile => {
    if (tile.type === 'plains' || tile.type === 'hills') {
      const elev = getElev(tile.x, tile.y);
      if (elev < 0.3) {
        const px = tile.x * TW * sc + ox;
        const py = tile.y * TH * sc + oy;
        const tw = TW * sc, th = TH * sc;
        const hazeFactor = (0.3 - elev) * (season === 3 ? 1.5 : 0.8);
        ctx.fillStyle = `rgba(140,160,175,${hazeFactor * 0.12})`;
        ctx.fillRect(px, py, tw, th);
      }
    }
  });

  /* ── 9. Parchment grain overlay ── */
  buildParchmentTexture(W, H);
  if (parchmentCanvas) {
    ctx.globalAlpha = 0.18;
    ctx.drawImage(parchmentCanvas, 0, 0);
    ctx.globalAlpha = 1;
  }

  /* ── 10. Vignette ── */
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, Math.max(W, H) * 0.75);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.75)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  /* ── 11. Map legend ── */
  const lx = W - 148, ly = H - 112;
  ctx.fillStyle = 'rgba(8,5,2,0.90)';
  ctx.beginPath();
  ctx.roundRect(lx - 6, ly - 10, 148, 112, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(184,146,30,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(lx - 6, ly - 10, 148, 112, 3);
  ctx.stroke();
  // Top gold rule
  ctx.fillStyle = 'rgba(184,146,30,0.6)';
  ctx.fillRect(lx + 4, ly - 10, 130, 1);

  ctx.font = '9px Cinzel, serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const legendItems = [
    [[200, 160, 40], 'Votre territoire'],
    [[180, 40,  40], 'Comte de Blois'],
    [[40,  90, 200], 'Duc de Bretagne'],
    [[60, 160,  40], 'Abbaye de Clairvaux'],
  ];
  legendItems.forEach(([col, name], i) => {
    const iy = ly + i * 22 + 4;
    ctx.fillStyle = rgb(col);
    ctx.fillRect(lx, iy, 14, 10);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(lx, iy, 14, 10);
    ctx.fillStyle = 'rgba(228,210,170,0.88)';
    ctx.fillText(name, lx + 20, iy + 5);
  });

  /* ── 12. Compass Rose ── */
  drawCompass(ctx, W - 44, 44, 24 * sc);
};

/* ─────────────────────────────────────────────
   COMPASS ROSE
───────────────────────────────────────────── */
function drawCompass(ctx, cx, cy, r) {
  r = clamp(r, 14, 38);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalAlpha = 0.55;

  // Outer ring
  ctx.strokeStyle = 'rgba(184,146,30,0.5)';
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.arc(0, 0, r * 1.2, 0, Math.PI * 2); ctx.stroke();

  const dirs = [
    { label: 'N', angle: 0 },
    { label: 'S', angle: Math.PI },
    { label: 'E', angle: Math.PI * 0.5 },
    { label: 'O', angle: Math.PI * 1.5 },
  ];

  dirs.forEach(({ label, angle }) => {
    ctx.save(); ctx.rotate(angle);
    // Spike
    ctx.fillStyle = label === 'N' ? '#e8b830' : 'rgba(200,185,155,0.8)';
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.22, 0);
    ctx.lineTo(0, r * 0.35);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = label === 'N' ? '#c09018' : 'rgba(140,125,100,0.8)';
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(-r * 0.22, 0);
    ctx.lineTo(0, r * 0.35);
    ctx.closePath(); ctx.fill();
    // Label
    ctx.font = `bold ${Math.max(7, r * 0.38)}px Cinzel, serif`;
    ctx.fillStyle = label === 'N' ? '#f0d060' : 'rgba(220,200,160,0.9)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, -r * 1.52);
    ctx.restore();
  });

  // Center dot
  ctx.fillStyle = '#c8921e';
  ctx.beginPath(); ctx.arc(0, 0, r * 0.12, 0, Math.PI * 2); ctx.fill();

  ctx.globalAlpha = 1;
  ctx.restore();
}

/* ─────────────────────────────────────────────
   ANIMATED LOOP (replaces old animateMap)
───────────────────────────────────────────── */
window.animateMap = function animateMap() {
  window.drawMap();
  requestAnimationFrame(window.animateMap);
};


/* ─────────────────────────────────────────────
   CENTER MAP
───────────────────────────────────────────── */
window.centerMap = function centerMap() {
  const cont = document.getElementById('map-container');
  const TW = 48, TH = 40;
  G.map.scale = 1;
  G.map.offsetX = cont.clientWidth / 2 - 12 * TW - TW / 2;
  G.map.offsetY = cont.clientHeight / 2 - 8 * TH - TH / 2;
};

console.log('[map.js v0.16] Moteur cartographique CK3 chargé ✓');
