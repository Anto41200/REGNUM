// ============================================================
//  REGNUM — map.js  v0.16.2
//  Moteur cartographique style CK3 — frontières organiques
//  Dual-mode: politique (dézoom) / relief détaillé (zoom)
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
   ELEVATION MAP
───────────────────────────────────────────── */
const MAP_W = 26, MAP_H = 18;
let elevMap = null;

function buildElevationMap() {
  elevMap = new Float32Array(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
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
let rivers = [];

function generateRivers() {
  rivers = [];
  const sources = [];
  for (let y = 2; y < MAP_H - 2; y++) {
    for (let x = 2; x < MAP_W - 2; x++) {
      if (getElev(x, y) > 0.62 && hash(x * 3.1, y * 7.3) > 0.82) {
        sources.push({ x, y });
      }
    }
  }
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
      let bestDx = 0, bestDy = 0, bestE = e;
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
   HILLSHADING
───────────────────────────────────────────── */
const SUN_AZ = -Math.PI * 0.6;
const SUN_EL = Math.PI * 0.35;

function hillshade(x, y) {
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
   TERRAIN COLOR — plus lumineux
───────────────────────────────────────────── */
const TERRAIN_PALETTES = {
  plains:   [[95, 148, 52],  [118, 172, 68]],
  forest:   [[38,  95, 28],  [52,  118, 38]],
  mountain: [[148, 138, 122],[168, 155, 135]],
  hills:    [[105, 140, 68], [125, 162, 82]],
  water:    [[42,  98, 168], [55,  122, 198]],
  capital:  [[145, 108, 32], [168, 128, 48]],
  coast:    [[212, 192, 142],[228, 208, 162]],
};

const SEASON_BRIGHT = [1.08, 1.18, 1.00, 0.82];
const SEASON_SNOW_THRESH = [1.5, 1.8, 1.3, 0.55];

function terrainColor(tile, elev, season) {
  const pal = TERRAIN_PALETTES[tile.type] || TERRAIN_PALETTES.plains;
  const n = hash(tile.x * 73.1 + tile.y * 143.7);
  let c = lerpColor(pal[0], pal[1], n);
  const altTint = clamp(elev - 0.45, 0, 1);
  c = lerpColor(c, [195, 205, 215], altTint * 0.32);
  const br = SEASON_BRIGHT[season];
  c = c.map(v => clamp(Math.floor(v * br), 0, 255));
  if (season === 3 && tile.type !== 'water') {
    const grey = (c[0] + c[1] + c[2]) / 3;
    c = c.map(v => Math.floor(lerp(v, grey, 0.35)));
  }
  if (elev > SEASON_SNOW_THRESH[season] && tile.type === 'mountain') {
    c = lerpColor(c, [242, 245, 252], clamp((elev - SEASON_SNOW_THRESH[season]) * 3, 0, 1));
  }
  return c;
}

/* ─────────────────────────────────────────────
   VORONOI ORGANIC TERRITORY SYSTEM
   Chaque territory est défini par un ensemble de
   sites Voronoï + du bruit de Perlin sur les bords
───────────────────────────────────────────── */

// Résolution du canvas Voronoï (pixels par tile)
const VOI_RES = 8;
let voronoiCanvas = null;
let voronoiCtx = null;
let voronoiData = null; // ImageData owner map
let voronoiW = 0, voronoiH = 0;

// Définition des factions avec couleurs politiques
const FACTION_COLORS = {
  player: { r: 210, g: 175, b: 55,  name: 'Auvray' },
  enemy1: { r: 175, g: 45,  b: 45,  name: 'Blois' },
  enemy2: { r: 55,  g: 105, b: 195, name: 'Bretagne' },
  ally1:  { r: 58,  g: 168, b: 62,  name: 'Clairvaux' },
  none:   { r: 0,   g: 0,   b: 0,   name: '' },
};

// Génère une carte de propriété par pixel via Voronoï bruité
function buildVoronoiMap(W, H, sc) {
  // Taille canvas Voronoï en pixels terrain
  const vw = Math.ceil(MAP_W * VOI_RES);
  const vh = Math.ceil(MAP_H * VOI_RES);

  if (voronoiCanvas && voronoiData && voronoiW === vw && voronoiH === vh) return;
  voronoiW = vw; voronoiH = vh;

  voronoiCanvas = document.createElement('canvas');
  voronoiCanvas.width = vw;
  voronoiCanvas.height = vh;
  voronoiCtx = voronoiCanvas.getContext('2d');

  // Build per-pixel owner map avec bruit
  voronoiData = new Uint8Array(vw * vh); // 0=none,1=player,2=enemy1,3=enemy2,4=ally1

  const ownerIndex = { player: 1, enemy1: 2, enemy2: 3, ally1: 4 };

  for (let py = 0; py < vh; py++) {
    for (let px = 0; px < vw; px++) {
      // Tile coords
      const tx = px / VOI_RES;
      const ty = py / VOI_RES;
      const txi = Math.floor(tx);
      const tyi = Math.floor(ty);

      if (typeof G === 'undefined') { voronoiData[py * vw + px] = 0; continue; }

      // Bruit pour déformer les bords
      const noiseScale = 0.18;
      const nx = fbm(tx * noiseScale, ty * noiseScale, 3) * 1.6 - 0.8;
      const ny = fbm(tx * noiseScale + 50, ty * noiseScale + 50, 3) * 1.6 - 0.8;
      const jtx = tx + nx;
      const jty = ty + ny;

      // Tile la plus proche dans les coordonnées bruitées
      const nearTx = Math.round(clamp(jtx, 0, MAP_W - 1));
      const nearTy = Math.round(clamp(jty, 0, MAP_H - 1));

      const tile = G.tiles.find(t => t.x === nearTx && t.y === nearTy);
      const owner = tile ? tile.owner : null;

      // Ignorer l'eau
      const baseTile = G.tiles.find(t => t.x === txi && t.y === tyi);
      if (baseTile && baseTile.type === 'water') {
        voronoiData[py * vw + px] = 0;
      } else {
        voronoiData[py * vw + px] = owner ? (ownerIndex[owner] || 0) : 0;
      }
    }
  }

  // Render voronoi onto canvas (pour visualisation debug — pas utilisé directement)
  const img = voronoiCtx.createImageData(vw, vh);
  const d = img.data;
  const indexColor = [
    { r: 0, g: 0, b: 0 },
    FACTION_COLORS.player,
    FACTION_COLORS.enemy1,
    FACTION_COLORS.enemy2,
    FACTION_COLORS.ally1,
  ];
  for (let i = 0; i < vw * vh; i++) {
    const c = indexColor[voronoiData[i]] || indexColor[0];
    d[i * 4]     = c.r;
    d[i * 4 + 1] = c.g;
    d[i * 4 + 2] = c.b;
    d[i * 4 + 3] = voronoiData[i] > 0 ? 180 : 0;
  }
  voronoiCtx.putImageData(img, 0, 0);
}

/* Invalide le voronoi si les territoires changent */
function invalidateVoronoi() {
  voronoiData = null;
}

/* ─────────────────────────────────────────────
   BORDER DETECTION sur la carte Voronoï
   Renvoie un tableau de segments de bord
───────────────────────────────────────────── */
function detectVoronoiBorders() {
  if (!voronoiData) return [];
  const segs = [];
  const vw = voronoiW, vh = voronoiH;

  for (let py = 0; py < vh - 1; py++) {
    for (let px = 0; px < vw - 1; px++) {
      const c = voronoiData[py * vw + px];
      const r = voronoiData[py * vw + px + 1];
      const b = voronoiData[(py + 1) * vw + px];
      if (c !== r && (c > 0 || r > 0)) segs.push({ x1: px + 1, y1: py, x2: px + 1, y2: py + 1, ownerA: c, ownerB: r });
      if (c !== b && (c > 0 || b > 0)) segs.push({ x1: px, y1: py + 1, x2: px + 1, y2: py + 1, ownerA: c, ownerB: b });
    }
  }
  return segs;
}

/* ─────────────────────────────────────────────
   DRAW POLITICAL MODE (dézoom)
   Aplats de couleur + noms de régions style CK3
───────────────────────────────────────────── */
function drawPoliticalMode(ctx, W, H, ox, oy, sc, season) {
  const TW = 48, TH = 40;

  // 1. Fond eau
  const waterGrad = ctx.createLinearGradient(0, 0, 0, H);
  waterGrad.addColorStop(0, '#1e3a5f');
  waterGrad.addColorStop(0.5, '#163050');
  waterGrad.addColorStop(1, '#0e2038');
  ctx.fillStyle = waterGrad;
  ctx.fillRect(0, 0, W, H);

  // 2. Ondulations eau animées
  const t = Date.now() * 0.0004;
  ctx.save();
  for (let wy = 0; wy < H; wy += 28) {
    ctx.strokeStyle = `rgba(80,150,230,0.08)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let wx = 0; wx < W; wx += 4) {
      const y = wy + Math.sin(wx * 0.02 + t) * 3;
      if (wx === 0) ctx.moveTo(wx, y); else ctx.lineTo(wx, y);
    }
    ctx.stroke();
  }
  ctx.restore();

  // S'assurer que la carte Voronoï est construite
  buildVoronoiMap(W, H, sc);

  // 3. Dessiner les aplats de couleur territory par tile mais
  //    avec la forme Voronoï bruitée
  if (voronoiCanvas) {
    ctx.save();
    // Mapper le voronoi canvas vers l'espace écran
    const scaleX = (MAP_W * TW * sc) / voronoiW;
    const scaleY = (MAP_H * TH * sc) / voronoiH;
    ctx.translate(ox, oy);
    ctx.scale(scaleX, scaleY);
    // Dessiner avec lissage désactivé pour préserver les bords
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(voronoiCanvas, 0, 0);
    ctx.restore();
  }

  // 4. Overlay gradient sur zones neutres (légèrement plus sombres)
  G.tiles.forEach(tile => {
    if (tile.type === 'water' || tile.owner) return;
    const px = tile.x * TW * sc + ox;
    const py = tile.y * TH * sc + oy;
    const tw = TW * sc, th = TH * sc;
    if (px > W || py > H || px + tw < 0 || py + th < 0) return;
    ctx.fillStyle = 'rgba(20,15,8,0.45)';
    ctx.fillRect(px, py, tw, th);
  });

  // 5. Dessin des frontières organiques (bords Voronoï)
  drawOrganicBorders(ctx, ox, oy, sc, TW, TH, W, H);

  // 6. Rivières (toujours visibles)
  drawRiversOnMap(ctx, ox, oy, sc, TW, TH, W, H, season);

  // 7. Icônes de capitales/villes
  G.tiles.forEach(tile => {
    if (!tile.special) return;
    const px = tile.x * TW * sc + ox + TW * sc * 0.5;
    const py = tile.y * TH * sc + oy + TH * sc * 0.5;
    if (px < -20 || py < -20 || px > W + 20 || py > H + 20) return;

    const icons = { capital: '🏰', village: '🏠', monastery: '⛪', ruin: '🗿' };
    const icon = icons[tile.special];
    if (!icon) return;

    const fontSize = tile.special === 'capital' ? Math.max(12, 16 * sc) : Math.max(8, 11 * sc);
    ctx.font = `${fontSize}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Halo
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.arc(px, py, fontSize * 0.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillText(icon, px, py);
  });

  // 8. Noms de régions
  drawRegionLabels(ctx, ox, oy, sc, TW, TH, W, H);

  // 9. Minimap
  drawMinimap(ctx, W, H, sc);

  // 10. Parchment léger
  buildParchmentTexture(W, H);
  if (parchmentCanvas) {
    ctx.globalAlpha = 0.08;
    ctx.drawImage(parchmentCanvas, 0, 0);
    ctx.globalAlpha = 1;
  }

  // 11. Vignette
  const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, Math.max(W, H) * 0.8);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // 12. Compass
  drawCompass(ctx, W - 44, 44, 28);
}

/* ─────────────────────────────────────────────
   FRONTIÈRES ORGANIQUES
───────────────────────────────────────────── */
function drawOrganicBorders(ctx, ox, oy, sc, TW, TH, W, H) {
  if (!voronoiData) return;

  const segs = detectVoronoiBorders();
  if (segs.length === 0) return;

  const vw = voronoiW, vh = voronoiH;
  const scaleX = (MAP_W * TW * sc) / vw;
  const scaleY = (MAP_H * TH * sc) / vh;

  const indexColor = [
    null,
    FACTION_COLORS.player,
    FACTION_COLORS.enemy1,
    FACTION_COLORS.enemy2,
    FACTION_COLORS.ally1,
  ];

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Grouper les segments par paire de factions pour les dessiner ensemble
  // On fait deux passes : ombre (épaisse) puis trait coloré
  for (let pass = 0; pass < 2; pass++) {
    segs.forEach(seg => {
      const ownerMax = Math.max(seg.ownerA, seg.ownerB);
      if (ownerMax === 0) return;

      const x1 = seg.x1 * scaleX + ox;
      const y1 = seg.y1 * scaleY + oy;
      const x2 = seg.x2 * scaleX + ox;
      const y2 = seg.y2 * scaleY + oy;

      if (x1 < -10 && x2 < -10) return;
      if (y1 < -10 && y2 < -10) return;
      if (x1 > W + 10 && x2 > W + 10) return;

      const dominantOwner = seg.ownerA > 0 ? seg.ownerA : seg.ownerB;
      const fc = indexColor[dominantOwner];
      if (!fc) return;

      if (pass === 0) {
        // Ombre sombre épaisse
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 3.5 * sc;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      } else {
        // Ligne colorée + brillance
        ctx.strokeStyle = `rgba(${fc.r},${fc.g},${fc.b},0.88)`;
        ctx.lineWidth = 1.8 * sc;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        // Reflet clair sur le dessus
        ctx.strokeStyle = `rgba(255,255,255,0.25)`;
        ctx.lineWidth = 0.6 * sc;
        ctx.beginPath();
        ctx.moveTo(x1 - sc * 0.3, y1 - sc * 0.3);
        ctx.lineTo(x2 - sc * 0.3, y2 - sc * 0.3);
        ctx.stroke();
      }
    });
  }
  ctx.restore();
}

/* ─────────────────────────────────────────────
   NOMS DE RÉGIONS style CK3
───────────────────────────────────────────── */
function drawRegionLabels(ctx, ox, oy, sc, TW, TH, W, H) {
  const labels = [
    { x: 12, y: 8,  name: 'AUVRAY',    owner: 'player',  sub: 'Comté' },
    { x: 4,  y: 6,  name: 'BLOIS',     owner: 'enemy1',  sub: 'Comté de Blois' },
    { x: 21, y: 5,  name: 'BRETAGNE',  owner: 'enemy2',  sub: 'Duché' },
    { x: 13, y: 16, name: 'CLAIRVAUX', owner: 'ally1',   sub: 'Abbaye' },
  ];

  labels.forEach(lbl => {
    const px = lbl.x * TW * sc + ox + TW * sc * 0.5;
    const py = lbl.y * TH * sc + oy + TH * sc;
    if (px < -120 || py < -30 || px > W + 120 || py > H + 30) return;

    const fc = FACTION_COLORS[lbl.owner] || FACTION_COLORS.none;
    const mainSize = Math.max(11, Math.floor(18 * Math.max(sc, 0.3)));
    const subSize = Math.max(8, Math.floor(10 * Math.max(sc, 0.3)));

    ctx.save();
    ctx.textAlign = 'center';

    // Nom principal — style CK3 italic spread
    ctx.font = `italic ${mainSize}px 'Cinzel', 'Georgia', serif`;
    const textW = ctx.measureText(lbl.name).width;

    // Drop shadow
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillText(lbl.name, px + 1.5, py + 1.5);

    // Texte coloré lumineux
    const gradient = ctx.createLinearGradient(px - textW / 2, py - mainSize, px + textW / 2, py);
    gradient.addColorStop(0, `rgba(${Math.min(255, fc.r + 60)},${Math.min(255, fc.g + 60)},${Math.min(255, fc.b + 60)},0.95)`);
    gradient.addColorStop(1, `rgba(${fc.r},${fc.g},${fc.b},0.85)`);
    ctx.fillStyle = gradient;
    ctx.fillText(lbl.name, px, py);

    // Sous-titre
    if (sc > 0.45) {
      ctx.font = `${subSize}px 'IM Fell English', serif`;
      ctx.fillStyle = `rgba(${fc.r},${fc.g},${fc.b},0.55)`;
      ctx.fillText(lbl.sub, px, py + mainSize * 1.1);
    }

    // Ligne décorative sous le nom
    ctx.strokeStyle = `rgba(${fc.r},${fc.g},${fc.b},0.35)`;
    ctx.lineWidth = 0.7;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(px - textW * 0.45, py + 5);
    ctx.lineTo(px + textW * 0.45, py + 5);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.restore();
  });
}

/* ─────────────────────────────────────────────
   DRAW DETAIL MODE (zoom) — rendu CK3 texturé
───────────────────────────────────────────── */
function drawDetailMode(ctx, W, H, ox, oy, sc, season) {
  const TW = 48, TH = 40;

  // 0. Fond ciel/ambiance
  const skyCol = ['#1a3012', '#1e3808', '#1e1808', '#080e18'];
  ctx.fillStyle = skyCol[season];
  ctx.fillRect(0, 0, W, H);

  // 1. Terrain tuile par tuile
  G.tiles.forEach(tile => {
    const px = tile.x * TW * sc + ox;
    const py = tile.y * TH * sc + oy;
    const tw = TW * sc, th = TH * sc;
    if (px > W || py > H || px + tw < 0 || py + th < 0) return;

    const elev = getElev(tile.x, tile.y);
    const hs = hillshade(tile.x, tile.y);
    let col = terrainColor(tile, elev, season);

    // Hillshade plus marqué (relief plus visible)
    const hsMod = lerp(0.5, 1.25, hs);
    col = col.map(v => clamp(Math.floor(v * hsMod), 0, 255));

    // Variation
    const nv = hash(tile.x * 73.1, tile.y * 143.7);
    col = col.map(v => clamp(v + (nv - 0.5) * 18, 0, 255));

    ctx.globalAlpha = 1;
    ctx.fillStyle = rgb(col);
    ctx.fillRect(px, py, tw, th);

    // Micro-texture terrain
    drawTerrainTexture(ctx, tile, px, py, tw, th, sc, season, elev);

    // Coast
    if (tile.type !== 'water') {
      const dirs = [{dx:0,dy:-1},{dx:0,dy:1},{dx:-1,dy:0},{dx:1,dy:0}];
      const hasWater = dirs.some(({dx,dy}) => {
        const n = G.tiles.find(t => t.x===tile.x+dx && t.y===tile.y+dy);
        return n && n.type === 'water';
      });
      if (hasWater) {
        const grad = ctx.createLinearGradient(px, py, px + tw, py + th);
        grad.addColorStop(0, 'rgba(210,188,132,0.0)');
        grad.addColorStop(0.55, 'rgba(210,188,132,0.0)');
        grad.addColorStop(1, 'rgba(210,188,132,0.62)');
        ctx.fillStyle = grad;
        ctx.fillRect(px, py, tw, th);
      }
    }

    // Water waves
    if (tile.type === 'water') {
      drawWaterWaves(ctx, px, py, tw, th, sc, tile);
    }

    // Fields
    if (tile.type === 'plains' && sc > 0.6) {
      const nearVillage = G.tiles.some(t =>
        (t.special === 'village' || t.special === 'capital') &&
        Math.abs(t.x - tile.x) <= 2 && Math.abs(t.y - tile.y) <= 2
      );
      if (nearVillage && hash(tile.x * 19 + tile.y, tile.y * 23) > 0.45) {
        ctx.globalAlpha = 0.62;
        drawFields(ctx, px, py, tw, th, sc, season);
        ctx.globalAlpha = 1;
      }
    }

    // Fog of War (CORRIGÉ: pas de ctx.rect sans beginPath)
    drawFogOfWar(ctx, tile, px, py, tw, th, sc);

    // Territory overlay (subtil en mode détail)
    if (tile.owner) {
      const fc = FACTION_COLORS[tile.owner];
      if (fc) {
        ctx.fillStyle = `rgba(${fc.r},${fc.g},${fc.b},${tile.owner === 'player' ? 0.06 : 0.04})`;
        ctx.fillRect(px, py, tw, th);
      }
    }

    // Selected
    if (G.selectedTile && G.selectedTile.x === tile.x && G.selectedTile.y === tile.y) {
      ctx.fillStyle = 'rgba(240,192,64,0.10)';
      ctx.fillRect(px, py, tw, th);
      ctx.strokeStyle = 'rgba(240,192,64,0.95)';
      ctx.lineWidth = 2.2 * sc;
      ctx.setLineDash([3 * sc, 2 * sc]);
      ctx.strokeRect(px + 1, py + 1, tw - 2, th - 2);
      ctx.setLineDash([]);
    }
  });

  // 2. Routes
  if (sc > 0.4) drawRoads(ctx, G, TW, TH, ox, oy, sc);

  // 3. Rivières
  drawRiversOnMap(ctx, ox, oy, sc, TW, TH, W, H, season);

  // 4. Frontières organiques (plus fines en mode détail)
  buildVoronoiMap(W, H, sc);
  drawOrganicBorders(ctx, ox, oy, sc * 0.7, TW, TH, W, H);

  // 5. Bâtiments
  G.tiles.forEach(tile => {
    if (!tile.special) return;
    const px = tile.x * TW * sc + ox;
    const py = tile.y * TH * sc + oy;
    const tw = TW * sc, th = TH * sc;
    if (px > W || py > H || px + tw < 0 || py + th < 0) return;
    if (sc < 0.38) return;
    if (!tile.owner && sc < 0.6) return;

    const cx2 = px + tw * 0.5;
    const cy2 = py + th * 0.72;

    ctx.globalAlpha = tile.owner === 'player' ? 1 : tile.owner ? 0.82 : 0.5;
    drawBuilding(ctx, tile.special, cx2, cy2, sc);
    ctx.globalAlpha = 1;

    if (sc > 0.65) {
      const names = { capital: 'Auvray', village: 'Village', ruin: 'Ruines', monastery: 'Abbaye' };
      const name = names[tile.special] || '';
      ctx.font = `${Math.max(8, Math.floor(9 * sc))}px 'Cinzel', serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillText(name, cx2 + 1, py + th * 0.92 + 1);
      ctx.fillStyle = tile.owner === 'player' ? 'rgba(240,200,80,0.95)' : 'rgba(210,185,145,0.85)';
      ctx.fillText(name, cx2, py + th * 0.92);
    }
  });

  // 6. Boucliers héraldiques
  if (sc > 0.55) {
    const centers = {
      player: {x:12,y:8}, enemy1:{x:4,y:6}, enemy2:{x:21,y:5}, ally1:{x:13,y:16}
    };
    Object.entries(centers).forEach(([owner, {x, y}]) => {
      if (owner !== 'player' && sc < 0.7) return;
      const fogTile = G.tiles.find(t => t.x === x && t.y === y);
      if (!fogTile || (!fogTile.owner && sc < 0.8)) return;
      const cx2 = x * TW * sc + ox + TW * sc * 0.5;
      const cy2 = y * TH * sc + oy + TH * sc * 0.3;
      ctx.globalAlpha = owner === 'player' ? 0.95 : 0.75;
      drawShield(ctx, cx2, cy2, 6 * sc, owner);
      ctx.globalAlpha = 1;
    });
  }

  // 7. Labels territoires (en mode zoom, plus petits)
  if (sc > 0.65) {
    drawRegionLabels(ctx, ox, oy, sc * 0.6, TW, TH, W, H);
  }

  // 8. Haze atmosphérique
  G.tiles.forEach(tile => {
    if (tile.type === 'plains' || tile.type === 'hills') {
      const elev = getElev(tile.x, tile.y);
      if (elev < 0.3) {
        const px = tile.x * TW * sc + ox;
        const py = tile.y * TH * sc + oy;
        const tw = TW * sc, th = TH * sc;
        const hazeFactor = (0.3 - elev) * (season === 3 ? 1.4 : 0.7);
        ctx.fillStyle = `rgba(150,168,185,${hazeFactor * 0.10})`;
        ctx.fillRect(px, py, tw, th);
      }
    }
  });

  // 9. Parchment overlay
  buildParchmentTexture(W, H);
  if (parchmentCanvas) {
    ctx.globalAlpha = 0.14;
    ctx.drawImage(parchmentCanvas, 0, 0);
    ctx.globalAlpha = 1;
  }

  // 10. Vignette
  const vig = ctx.createRadialGradient(W/2, H/2, H*0.2, W/2, H/2, Math.max(W,H)*0.75);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.68)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // 11. Légende
  drawLegend(ctx, W, H, sc);

  // 12. Compass
  drawCompass(ctx, W - 44, 44, 24 * sc);

  // 13. Minimap
  drawMinimap(ctx, W, H, sc);
}

/* ─────────────────────────────────────────────
   TEXTURES MICRO-TERRAIN
───────────────────────────────────────────── */
function drawTerrainTexture(ctx, tile, px, py, tw, th, sc, season, elev) {
  ctx.save();

  if (tile.type === 'forest' || (tile.type === 'hills' && sc > 0.5)) {
    // Arbres organiques — v0.16.2
    const treeCount = tile.type === 'forest' ? 6 : 3;
    const treeType = tile.y < 6 ? 'conifer' : 'deciduous';
    for (let ti = 0; ti < treeCount; ti++) {
      const tx2 = px + (0.12 + hash(tile.x * 17 + ti, tile.y * 11) * 0.76) * tw;
      const ty2 = py + (0.5 + hash(tile.x * 11 + ti, tile.y * 17 + ti) * 0.38) * th;
      if (sc > 0.45) {
        ctx.globalAlpha = 0.92;
        drawTreeOrganic(ctx, tx2, ty2, sc * 0.6, treeType, season, tile.x * 100 + ti);
      }
    }
    ctx.globalAlpha = 1;
  }

  if (tile.type === 'mountain' && sc > 0.42) {
    drawMountainSilhouette(ctx, tile, px, py, tw, th, sc, elev, season);
  }

  if (tile.type === 'plains' && sc > 0.75) {
    // Herbe micro-texture
    const grassCol = season === 3 ? 'rgba(138,138,118,0.22)' : 'rgba(65,130,38,0.22)';
    ctx.strokeStyle = grassCol;
    ctx.lineWidth = 0.5 * sc;
    for (let gi = 0; gi < 10; gi++) {
      const gx = px + hash(tile.x * 7 + gi, tile.y * 11) * tw;
      const gy = py + hash(tile.x * 11 + gi, tile.y * 7 + gi) * th;
      const gh = (2 + hash(gi, tile.x + tile.y) * 3) * sc;
      const lean = (hash(gi * 3, tile.x * tile.y) - 0.5) * sc * 0.8;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.quadraticCurveTo(gx + lean, gy - gh * 0.6, gx + lean * 1.5, gy - gh);
      ctx.stroke();
    }
  }

  ctx.restore();
}

/* ─────────────────────────────────────────────
   ARBRES ORGANIQUES — v0.16.2
   Multi-blobs, ombre portée, reflet lumière
───────────────────────────────────────────── */
function drawTreeOrganic(ctx, tx, ty, sc, type, season, seed2) {
  const h = hash(seed2 * 0.1, seed2 * 0.07);
  const h2 = hash(seed2 * 0.13, seed2 * 0.19);
  const trunkH = (3.5 + h * 3.5) * sc;
  const cr = (3.2 + h * 2.8) * sc;
  const lean = (h2 - 0.5) * sc * 1.2;

  // Ombre au sol (ellipse)
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(tx + cr * 0.3, ty + 1 * sc, cr * 0.85, cr * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Tronc
  ctx.fillStyle = `rgb(${50 + h * 22 | 0},${35 + h * 12 | 0},${18 | 0})`;
  ctx.fillRect(tx - 0.9 * sc + lean * 0.3, ty - trunkH, 1.8 * sc, trunkH);

  if (type === 'conifer') {
    // Épicéa — 3 niveaux pyramidaux organiques
    const baseGreen = season === 3
      ? lerpColor([28, 72, 18], [195, 210, 220], 0.12)
      : [28, 72, 18];

    for (let tier = 0; tier < 3; tier++) {
      const cy = ty - trunkH * 0.5 - tier * cr * 0.72;
      const r = cr * (1.35 - tier * 0.32);
      const darkC = lerpColor(baseGreen, [0, 0, 0], 0.3);
      const lightC = lerpColor(baseGreen, [255, 255, 255], 0.15);

      // Corps principal
      ctx.fillStyle = rgba(baseGreen, 0.92);
      ctx.beginPath();
      ctx.moveTo(tx + lean, cy - r * 1.5);
      ctx.lineTo(tx + lean + r * 1.05, cy + r * 0.55);
      ctx.lineTo(tx + lean - r * 1.05, cy + r * 0.55);
      ctx.closePath();
      ctx.fill();

      // Face sombre (droite)
      ctx.fillStyle = rgba(darkC, 0.45);
      ctx.beginPath();
      ctx.moveTo(tx + lean, cy - r * 1.5);
      ctx.lineTo(tx + lean + r * 1.05, cy + r * 0.55);
      ctx.lineTo(tx + lean, cy + r * 0.1);
      ctx.closePath();
      ctx.fill();

      // Reflet lumière (gauche haut)
      ctx.fillStyle = rgba(lightC, 0.3);
      ctx.beginPath();
      ctx.moveTo(tx + lean, cy - r * 1.5);
      ctx.lineTo(tx + lean - r * 0.6, cy - r * 0.2);
      ctx.lineTo(tx + lean - r * 0.3, cy - r * 0.8);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    // Feuillu — 4 blobs organiques superposés
    let colBase;
    if (season === 0) colBase = [48, 125, 30];
    else if (season === 1) colBase = [38, 112, 22];
    else if (season === 2) colBase = [175, 92, 24];
    else colBase = [62, 52, 42];

    const darkC = lerpColor(colBase, [0, 0, 0], 0.42);
    const lightC = lerpColor(colBase, [255, 255, 255], 0.22);

    // 4 blobs décalés pour couronne organique
    const blobs = [
      { dx: 0,              dy: -cr * 0.9, r: cr * 0.95 },
      { dx: cr * 0.55,      dy: -cr * 0.4, r: cr * 0.78 },
      { dx: -cr * 0.55,     dy: -cr * 0.4, r: cr * 0.75 },
      { dx: (h - 0.5) * cr, dy: -cr * 1.3, r: cr * 0.58 },
    ];

    if (season !== 3) {
      // Passe ombre : blobs sombres légèrement décalés
      blobs.forEach(b => {
        ctx.fillStyle = rgba(darkC, 0.35);
        ctx.beginPath();
        ctx.arc(tx + lean + b.dx + cr * 0.22, ty - trunkH + b.dy + cr * 0.18, b.r * 0.92, 0, Math.PI * 2);
        ctx.fill();
      });

      // Passe principale
      blobs.forEach(b => {
        ctx.fillStyle = rgba(colBase, 0.88);
        ctx.beginPath();
        ctx.arc(tx + lean + b.dx, ty - trunkH + b.dy, b.r, 0, Math.PI * 2);
        ctx.fill();
      });

      // Reflet lumière (blob lumineux en haut-gauche)
      ctx.fillStyle = rgba(lightC, 0.32);
      ctx.beginPath();
      ctx.arc(tx + lean - cr * 0.28, ty - trunkH - cr * 1.0, cr * 0.42, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Hiver: tronc avec quelques branches
      ctx.strokeStyle = `rgb(${50 + h * 20 | 0},${35 + h * 10 | 0},18)`;
      ctx.lineWidth = 1.2 * sc;
      for (let b = 0; b < 4; b++) {
        const bAngle = -Math.PI * 0.5 + (hash(seed2 + b, b * 17) - 0.5) * 1.2;
        const bLen = cr * (0.5 + hash(b, seed2 * 0.3) * 0.5);
        ctx.beginPath();
        ctx.moveTo(tx + lean, ty - trunkH);
        ctx.lineTo(tx + lean + Math.cos(bAngle) * bLen, ty - trunkH + Math.sin(bAngle) * bLen);
        ctx.stroke();
      }
    }
  }
}

/* ─────────────────────────────────────────────
   MONTAGNE — silhouette réaliste
───────────────────────────────────────────── */
function drawMountainSilhouette(ctx, tile, px, py, tw, th, sc, elev, season) {
  const mk = hash(tile.x * 37, tile.y * 29);
  const mk2 = hash(tile.x * 53, tile.y * 41);

  // 1-2 pics par tuile
  const peaks = [
    { peakX: px + tw * (0.25 + mk * 0.25), peakY: py + th * (0.04 + mk * 0.1) },
    { peakX: px + tw * (0.55 + mk2 * 0.2), peakY: py + th * (0.08 + mk2 * 0.08) },
  ];

  peaks.forEach((p, i) => {
    const spread = tw * (0.28 + mk * 0.12 + i * 0.08);

    // Face sombre (shadow side — EST)
    const shadowCol = `rgba(0,0,0,${0.28 + mk * 0.18})`;
    ctx.fillStyle = shadowCol;
    ctx.beginPath();
    ctx.moveTo(px + tw * (0.1 + i * 0.2), py + th * 0.92);
    ctx.lineTo(p.peakX, p.peakY);
    ctx.lineTo(px + tw * (0.7 + i * 0.15), py + th * 0.92);
    ctx.closePath();
    ctx.fill();

    // Face lumière (light side — OUEST)
    const lightCol = `rgba(255,255,255,${0.06 + mk * 0.06})`;
    ctx.fillStyle = lightCol;
    ctx.beginPath();
    ctx.moveTo(px + tw * (0.1 + i * 0.2), py + th * 0.92);
    ctx.lineTo(p.peakX, p.peakY);
    ctx.lineTo(px + tw * (0.4 + i * 0.1), py + th * 0.92);
    ctx.closePath();
    ctx.fill();

    // Neige
    const snowThresh = season === 3 ? 0.45 : season === 2 ? 0.6 : 0.7;
    if (elev > snowThresh) {
      const snowAmt = clamp((elev - snowThresh) * 2.5, 0, 1);
      ctx.fillStyle = `rgba(238,242,252,${0.72 * snowAmt})`;
      const sw = spread * snowAmt * 0.55;
      ctx.beginPath();
      ctx.moveTo(p.peakX - sw * 0.6, p.peakY + th * 0.12 * snowAmt);
      ctx.lineTo(p.peakX, p.peakY);
      ctx.lineTo(p.peakX + sw * 0.6, p.peakY + th * 0.12 * snowAmt);
      ctx.quadraticCurveTo(p.peakX, p.peakY + th * 0.05, p.peakX - sw * 0.6, p.peakY + th * 0.12 * snowAmt);
      ctx.closePath();
      ctx.fill();
    }
  });
}

/* ─────────────────────────────────────────────
   ONDULATIONS EAU
───────────────────────────────────────────── */
function drawWaterWaves(ctx, px, py, tw, th, sc, tile) {
  if (sc < 0.5) return;
  const t = Date.now() * 0.0003;
  ctx.strokeStyle = 'rgba(80,160,240,0.18)';
  ctx.lineWidth = 0.7 * sc;
  for (let wi = 0; wi < 3; wi++) {
    const wy = py + th * (0.22 + wi * 0.26);
    const wOff = (t + tile.x * 0.38 + wi * 0.55) % (tw);
    ctx.beginPath();
    ctx.moveTo(px, wy);
    for (let wx = 0; wx <= tw; wx += 4 * sc) {
      ctx.lineTo(px + wx, wy + Math.sin((wx + wOff) * 0.42) * 0.85 * sc);
    }
    ctx.stroke();
  }
}

/* ─────────────────────────────────────────────
   RIVIÈRES (partagé entre les deux modes)
───────────────────────────────────────────── */
function drawRiversOnMap(ctx, ox, oy, sc, TW, TH, W, H, season) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  rivers.forEach((path) => {
    if (path.length < 3) return;
    for (let i = 1; i < path.length; i++) {
      const t = i / (path.length - 1);
      const width = lerp(1.0, 4.2, t) * sc;
      const p0 = path[i - 1];
      const p1 = path[i];
      const gx0 = p0.px * TW * sc + ox;
      const gy0 = p0.py * TH * sc + oy;
      const gx1 = p1.px * TW * sc + ox;
      const gy1 = p1.py * TH * sc + oy;

      ctx.strokeStyle = `rgba(42,98,168,${0.72 + t * 0.2})`;
      ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(gx0, gy0); ctx.lineTo(gx1, gy1); ctx.stroke();

      ctx.strokeStyle = `rgba(95,168,248,${0.20 + t * 0.10})`;
      ctx.lineWidth = width * 0.28;
      ctx.beginPath(); ctx.moveTo(gx0 - sc, gy0 - sc); ctx.lineTo(gx1 - sc, gy1 - sc); ctx.stroke();
    }
  });
  ctx.restore();
}

/* ─────────────────────────────────────────────
   CULTIVATED FIELDS
───────────────────────────────────────────── */
function drawFields(ctx, px, py, tw, th, sc, season) {
  const cols = season === 1 ? ['#e8d040','#d4c030'] :
    season === 2 ? ['#c8a020','#b89018'] :
    season === 3 ? ['#a0a090','#909080'] :
    ['#82cc42','#72bb32'];
  const rows = 4, cols2 = 5;
  const fw = tw / cols2, fh = th / rows;
  for (let fy = 0; fy < rows; fy++) {
    for (let fx = 0; fx < cols2; fx++) {
      const c = (fx + fy) % 2 === 0 ? cols[0] : cols[1];
      ctx.fillStyle = c;
      ctx.fillRect(px + fx * fw + 1, py + fy * fh + 1, fw - 2, fh - 2);
    }
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.10)';
  ctx.lineWidth = 0.5;
  for (let fy = 0; fy <= rows; fy++) {
    ctx.beginPath();
    ctx.moveTo(px, py + fy * fh);
    ctx.lineTo(px + tw, py + fy * fh);
    ctx.stroke();
  }
}

/* ─────────────────────────────────────────────
   BUILDING FOOTPRINTS
───────────────────────────────────────────── */
function drawBuilding(ctx, type, cx, cy, sc) {
  const s = sc * 0.9;
  ctx.save();
  ctx.translate(cx, cy);

  if (type === 'capital' || type === 'castle') {
    ctx.fillStyle = '#2a1e0e';
    ctx.strokeStyle = '#6a5030';
    ctx.lineWidth = 0.5 * s;
    ctx.fillRect(-5 * s, -9 * s, 10 * s, 10 * s);
    for (let i = -5; i <= 3; i += 2.5) ctx.fillRect(i * s, -12 * s, 2 * s, 3 * s);
    ctx.fillRect(-8 * s, -7 * s, 5 * s, 8 * s);
    ctx.fillRect(-8.5 * s, -10 * s, 6 * s, 3 * s);
    ctx.fillRect(3 * s, -7 * s, 5 * s, 8 * s);
    ctx.fillRect(2.5 * s, -10 * s, 6 * s, 3 * s);
    ctx.fillStyle = '#0a0604';
    ctx.beginPath();
    ctx.arc(0, 0.5 * s, 2.5 * s, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(-2.5 * s, -4.5 * s, 5 * s, 5 * s);
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
      const ox2 = (i - count / 2 + 0.5) * 7 * s;
      const oy2 = hash(i * 17, i * 31) * 3 * s - 2 * s;
      ctx.fillStyle = `rgb(${lerpColor([160,130,95],[140,110,75],hash(i,i*3)).join(',')})`;
      ctx.fillRect(ox2 - 3 * s, oy2 - 2 * s, 6 * s, 5 * s);
      ctx.fillStyle = `rgb(${lerpColor([100,50,30],[130,70,40],hash(i*5,i)).join(',')})`;
      ctx.beginPath();
      ctx.moveTo(ox2 - 4 * s, oy2 - 2 * s);
      ctx.lineTo(ox2, oy2 - 7 * s);
      ctx.lineTo(ox2 + 4 * s, oy2 - 2 * s);
      ctx.closePath();
      ctx.fill();
    }

  } else if (type === 'monastery') {
    ctx.fillStyle = '#c8b880';
    ctx.fillRect(-3 * s, -10 * s, 6 * s, 10 * s);
    ctx.fillRect(-0.8 * s, -14 * s, 1.6 * s, 5 * s);
    ctx.fillRect(-3 * s, -12 * s, 6 * s, 1.6 * s);
    ctx.fillRect(-6 * s, -5 * s, 12 * s, 7 * s);
    ctx.fillStyle = '#1a1208';
    ctx.beginPath(); ctx.arc(-1.5 * s, -3 * s, 1.2 * s, Math.PI, 0); ctx.fill();
    ctx.beginPath(); ctx.arc(1.5 * s, -3 * s, 1.2 * s, Math.PI, 0); ctx.fill();

  } else if (type === 'ruin') {
    ctx.fillStyle = '#6a6055';
    ctx.fillRect(-6 * s, -4 * s, 4 * s, 6 * s);
    ctx.fillRect(2 * s, -6 * s, 4 * s, 8 * s);
    ctx.fillRect(-5 * s, -1 * s, 10 * s, 2 * s);
    ctx.strokeStyle = '#3a3028';
    ctx.lineWidth = 0.7 * s;
    ctx.beginPath(); ctx.moveTo(3 * s, -6 * s); ctx.lineTo(4.5 * s, -2 * s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-5 * s, -4 * s); ctx.lineTo(-3 * s, -1 * s); ctx.stroke();
  }

  ctx.restore();
}

/* ─────────────────────────────────────────────
   HERALDIC SHIELD
───────────────────────────────────────────── */
const FACTION_HERALDRY = {
  player: { bg:[30,18,5],   fg:[232,184,48], pattern:'cross',    border:[200,160,40] },
  enemy1: { bg:[80,12,12],  fg:[220,180,80], pattern:'chevron',  border:[160,40,40] },
  enemy2: { bg:[12,40,100], fg:[200,200,80], pattern:'diagonal', border:[40,80,180] },
  ally1:  { bg:[18,60,12],  fg:[220,200,80], pattern:'saltire',  border:[60,140,40] },
};

function drawShield(ctx, cx, cy, size, owner) {
  const h = FACTION_HERALDRY[owner];
  if (!h) return;
  const s = size;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(-s, -s);
  ctx.lineTo(s, -s);
  ctx.lineTo(s, 0);
  ctx.quadraticCurveTo(s, s * 1.2, 0, s * 1.5);
  ctx.quadraticCurveTo(-s, s * 1.2, -s, 0);
  ctx.closePath();
  ctx.fillStyle = rgb(h.bg);
  ctx.fill();
  ctx.save(); ctx.clip();
  ctx.fillStyle = rgba(h.fg, 0.85);
  if (h.pattern === 'cross') {
    ctx.fillRect(-s * 0.2, -s * 1.1, s * 0.4, s * 2.7);
    ctx.fillRect(-s * 1.1, -s * 0.2, s * 2.2, s * 0.4);
  } else if (h.pattern === 'chevron') {
    ctx.beginPath();
    ctx.moveTo(-s*1.1, s*0.4); ctx.lineTo(0,-s*0.5); ctx.lineTo(s*1.1, s*0.4);
    ctx.lineTo(s*1.1, s*0.9); ctx.lineTo(0, 0); ctx.lineTo(-s*1.1, s*0.9);
    ctx.closePath(); ctx.fill();
  } else if (h.pattern === 'diagonal') {
    ctx.save(); ctx.rotate(Math.PI*0.25);
    ctx.fillRect(-s*0.2, -s*2, s*0.4, s*4); ctx.restore();
  } else if (h.pattern === 'saltire') {
    ctx.save(); ctx.rotate(Math.PI*0.25);
    ctx.fillRect(-s*0.15, -s*1.5, s*0.3, s*3);
    ctx.fillRect(-s*1.5, -s*0.15, s*3, s*0.3);
    ctx.restore();
  }
  ctx.restore();
  ctx.strokeStyle = rgb(h.border);
  ctx.lineWidth = s * 0.18;
  ctx.beginPath();
  ctx.moveTo(-s, -s);
  ctx.lineTo(s, -s); ctx.lineTo(s, 0);
  ctx.quadraticCurveTo(s, s*1.2, 0, s*1.5);
  ctx.quadraticCurveTo(-s, s*1.2, -s, 0);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/* ─────────────────────────────────────────────
   FOG OF WAR — CORRIGÉ (beginPath avant rect)
───────────────────────────────────────────── */
function drawFogOfWar(ctx, tile, px, py, tw, th, sc) {
  const fogLevel = tile.owner === 'player' ? 0 : tile.owner ? 0.52 : 0.80;
  if (fogLevel < 0.1) return;

  ctx.fillStyle = `rgba(4,3,2,${fogLevel * 0.75})`;
  ctx.fillRect(px, py, tw, th);

  if (fogLevel > 0.5) {
    ctx.save();
    ctx.beginPath(); // ← BUGFIX: était manquant, causait des clips parasites
    ctx.rect(px, py, tw, th);
    ctx.clip();
    ctx.strokeStyle = `rgba(10,6,2,${fogLevel * 0.45})`;
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
   ROADS
───────────────────────────────────────────── */
function drawRoads(ctx, G, TW, TH, ox, oy, sc) {
  const capital = G.tiles.find(t => t.special === 'capital');
  const pois = G.tiles.filter(t => t.special && t.special !== 'capital');
  if (!capital) return;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  pois.forEach(dest => {
    const pts = [];
    let cx2 = capital.x + 0.5, cy2 = capital.y + 0.5;
    const dx = dest.x + 0.5 - cx2, dy = dest.y + 0.5 - cy2;
    const steps = Math.ceil(Math.sqrt(dx * dx + dy * dy) * 2.5);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const jx = (hash(cx2 * 13 + i, cy2 * 7 + i) - 0.5) * 0.45;
      const jy = (hash(cx2 * 7 + i, cy2 * 13 + i) - 0.5) * 0.45;
      pts.push({
        x: (cx2 + dx * t + jx) * TW * sc + ox + TW * sc * 0.5,
        y: (cy2 + dy * t + jy) * TH * sc + oy + TH * sc * 0.5,
      });
    }
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass === 0 ? 'rgba(110,85,50,0.65)' : 'rgba(165,135,88,0.45)';
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
   PARCHMENT TEXTURE — CORRIGÉ (pas de rebuild si inutile)
───────────────────────────────────────────── */
let parchmentCanvas = null;
let parchmentW = 0, parchmentH = 0;

function buildParchmentTexture(w, h) {
  // BUGFIX: ne rebuild que si dimensions ont changé
  if (parchmentCanvas && parchmentW === w && parchmentH === h) return;
  parchmentW = w; parchmentH = h;

  parchmentCanvas = document.createElement('canvas');
  parchmentCanvas.width = w; parchmentCanvas.height = h;
  const pCtx = parchmentCanvas.getContext('2d');
  const img = pCtx.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < w * h; i++) {
    const px2 = i % w, py2 = (i / w) | 0;
    const n = fbm(px2 * 0.04, py2 * 0.04, 3) * 0.5 +
      hash(px2 * 2.7, py2 * 2.7) * 0.3 +
      hash(px2 * 0.3 + 77, py2 * 0.3) * 0.2;
    const sepia = Math.floor(n * 32);
    d[i*4]   = 200 + sepia;
    d[i*4+1] = 175 + sepia * 0.8;
    d[i*4+2] = 130 + sepia * 0.5;
    d[i*4+3] = Math.floor(n * 28 + 6);
  }
  pCtx.putImageData(img, 0, 0);
}

/* ─────────────────────────────────────────────
   MINIMAP (coin bas-gauche)
───────────────────────────────────────────── */
function drawMinimap(ctx, W, H, sc) {
  const TW = 48, TH = 40;
  const mw = 130, mh = 88;
  const mx = 14, my = H - mh - 14;

  ctx.save();

  // Fond minimap
  ctx.fillStyle = 'rgba(8,5,2,0.88)';
  ctx.strokeStyle = 'rgba(184,146,30,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(mx - 2, my - 2, mw + 4, mh + 4, 2);
  ctx.fill();
  ctx.stroke();

  // Tuiles minimap
  const tsw = mw / MAP_W;
  const tsh = mh / MAP_H;

  G.tiles.forEach(tile => {
    const mpx = mx + tile.x * tsw;
    const mpy = my + tile.y * tsh;

    if (tile.type === 'water') {
      ctx.fillStyle = 'rgba(30,70,138,0.9)';
    } else if (tile.owner) {
      const fc = FACTION_COLORS[tile.owner];
      ctx.fillStyle = fc ? `rgba(${fc.r},${fc.g},${fc.b},0.82)` : 'rgba(80,72,62,0.7)';
    } else {
      ctx.fillStyle = tile.type === 'mountain' ? 'rgba(118,110,95,0.7)' :
                      tile.type === 'forest'   ? 'rgba(32,82,20,0.7)' :
                                                 'rgba(72,118,42,0.7)';
    }
    ctx.fillRect(mpx, mpy, tsw + 0.5, tsh + 0.5);
  });

  // Viewport rectangle
  const vpX = -G.map.offsetX / (TW * sc);
  const vpY = -G.map.offsetY / (TH * sc);
  const vpW = W / (TW * sc);
  const vpH = H / (TH * sc);

  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2]);
  ctx.strokeRect(
    mx + vpX * tsw,
    my + vpY * tsh,
    vpW * tsw,
    vpH * tsh
  );
  ctx.setLineDash([]);

  // Titre minimap
  ctx.fillStyle = 'rgba(184,146,30,0.6)';
  ctx.font = '7px Cinzel, serif';
  ctx.textAlign = 'left';
  ctx.fillText('CARTE', mx + 2, my - 5);

  ctx.restore();
}

/* ─────────────────────────────────────────────
   LÉGENDE (mode détail)
───────────────────────────────────────────── */
function drawLegend(ctx, W, H, sc) {
  const lx = W - 150, ly = H - 116;
  ctx.fillStyle = 'rgba(8,5,2,0.90)';
  ctx.beginPath();
  ctx.roundRect(lx - 6, ly - 10, 150, 116, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(184,146,30,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(lx - 6, ly - 10, 150, 116, 3);
  ctx.stroke();
  ctx.fillStyle = 'rgba(184,146,30,0.6)';
  ctx.fillRect(lx + 4, ly - 10, 132, 1);

  ctx.font = '9px Cinzel, serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const legendItems = [
    [FACTION_COLORS.player, 'Votre territoire'],
    [FACTION_COLORS.enemy1, 'Comte de Blois'],
    [FACTION_COLORS.enemy2, 'Duc de Bretagne'],
    [FACTION_COLORS.ally1,  'Abbaye de Clairvaux'],
  ];
  legendItems.forEach(([fc, name], i) => {
    const iy = ly + i * 22 + 4;
    ctx.fillStyle = `rgb(${fc.r},${fc.g},${fc.b})`;
    ctx.fillRect(lx, iy, 14, 10);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(lx, iy, 14, 10);
    ctx.fillStyle = 'rgba(228,210,170,0.88)';
    ctx.fillText(name, lx + 20, iy + 5);
  });
}

/* ─────────────────────────────────────────────
   COMPASS ROSE
───────────────────────────────────────────── */
function drawCompass(ctx, cx, cy, r) {
  r = clamp(r, 14, 38);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalAlpha = 0.6;

  ctx.strokeStyle = 'rgba(184,146,30,0.5)';
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.arc(0, 0, r * 1.2, 0, Math.PI * 2); ctx.stroke();

  const dirs = [
    {label:'N',angle:0},{label:'S',angle:Math.PI},
    {label:'E',angle:Math.PI*0.5},{label:'O',angle:Math.PI*1.5},
  ];
  dirs.forEach(({label, angle}) => {
    ctx.save(); ctx.rotate(angle);
    ctx.fillStyle = label === 'N' ? '#e8b830' : 'rgba(200,185,155,0.8)';
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.lineTo(r*0.22, 0); ctx.lineTo(0, r*0.35);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = label === 'N' ? '#c09018' : 'rgba(140,125,100,0.8)';
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.lineTo(-r*0.22, 0); ctx.lineTo(0, r*0.35);
    ctx.closePath(); ctx.fill();
    ctx.font = `bold ${Math.max(7, r*0.38)}px Cinzel, serif`;
    ctx.fillStyle = label === 'N' ? '#f0d060' : 'rgba(220,200,160,0.9)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, -r*1.52);
    ctx.restore();
  });

  ctx.fillStyle = '#c8921e';
  ctx.beginPath(); ctx.arc(0, 0, r*0.12, 0, Math.PI*2); ctx.fill();

  ctx.globalAlpha = 1;
  ctx.restore();
}

/* ─────────────────────────────────────────────
   MAIN DRAW FUNCTION
───────────────────────────────────────────── */
window.drawMap = function drawMap() {
  const canvas = document.getElementById('map-canvas');
  const container = document.getElementById('map-container');

  const newW = container.clientWidth;
  const newH = container.clientHeight;

  // BUGFIX: resize sans invalider le parchment si même taille
  if (canvas.width !== newW || canvas.height !== newH) {
    canvas.width = newW;
    canvas.height = newH;
    // Invalider parchment + voronoi si taille change
    parchmentCanvas = null;
    voronoiData = null;
  }

  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  if (!elevMap) { buildElevationMap(); generateRivers(); }

  const season = (typeof G !== 'undefined') ? G.season : 0;
  const ox = G.map.offsetX, oy = G.map.offsetY, sc = G.map.scale;
  const TW = 48, TH = 40;

  // Seuil de basculement : < 0.62 → mode politique, > 0.62 → mode détail
  const ZOOM_THRESHOLD = 0.62;

  if (sc < ZOOM_THRESHOLD) {
    drawPoliticalMode(ctx, W, H, ox, oy, sc, season);
  } else {
    drawDetailMode(ctx, W, H, ox, oy, sc, season);
  }
};

/* ─────────────────────────────────────────────
   ANIMATED LOOP
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

console.log('[map.js v0.16.2] Moteur cartographique — frontières organiques, dual-zoom ✓');
