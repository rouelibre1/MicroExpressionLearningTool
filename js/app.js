import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { PARTS } from './parts.js';
import { GROUPS, AUS, MUSCLES, EMOTIONS, structure } from './data.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const stage = $('#stage');
const canvas = $('#scene');
const tooltip = $('#tooltip');
const detail = $('#detail');
const labelsBox = $('#labels');
const leaders = $('#leaders');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const narrow = window.matchMedia('(max-width: 820px)');

const state = {
  emotion: null,   // id d'émotion
  sel: null,       // clé de la structure sélectionnée (id de muscle ou « S:nom »)
  preview: null,   // clé survolée dans une liste
  hover: null,     // clé survolée dans la scène
  skin: false,
  bones: true,
  isolate: true,
  labels: !narrow.matches,
};

const muscleById = new Map(MUSCLES.map((m) => [m.id, m]));
const muscleByPart = new Map();
for (const m of MUSCLES) for (const p of m.parts) muscleByPart.set(p, m);
const emotionById = new Map(EMOTIONS.map((e) => [e.id, e]));
const KIND_LABEL = {
  os: 'Os', dent: 'Dent', cartilage: 'Cartilage', fascia: 'Aponévrose', oeil: 'Œil',
  levres: 'Repère', gencive: 'Gencive', repere: 'Repère', peau: 'Peau',
};

/** Émotions dans lesquelles un muscle intervient. */
function emotionsOf(muscleId) {
  return EMOTIONS.filter((e) => e.lignes.some((l) => l.muscles.includes(muscleId)));
}

/** Rôle de chaque muscle dans une émotion : « contract » ou « relax ». */
function rolesOf(emotion) {
  const roles = new Map();
  if (!emotion) return roles;
  for (const l of emotion.lignes) {
    for (const id of l.muscles) {
      if (!l.relache) roles.set(id, 'contract');
      else if (!roles.has(id)) roles.set(id, 'relax');
    }
  }
  return roles;
}

// ───────────────────────────── Scène 3D ─────────────────────────────

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 1, 400);
scene.add(camera);
scene.add(new THREE.HemisphereLight(0xffffff, 0x4a4340, 1.25));
const key = new THREE.DirectionalLight(0xffffff, 2.1);
key.position.set(-18, 26, 40);   // éclairage solidaire de la caméra
camera.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.55);
fill.position.set(30, -10, 20);
camera.add(fill);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.09;
controls.minDistance = 12;
controls.maxDistance = 160;
controls.zoomSpeed = 0.9;

const HOME_TARGET = new THREE.Vector3(0, 0.6, 1.5);
const HOME_RADIUS = 17.5;
const FACE_TARGET = new THREE.Vector3(0, 1.4, 3);   // cadrage du visage pour les émotions
const VIEWS = {
  face: { az: 0, pol: 88 },
  'trois-quarts': { az: 38, pol: 84 },
  profil: { az: 90, pol: 88 },
  dos: { az: 180, pol: 88 },
};

let dirty = true;
const requestRender = () => { dirty = true; };
controls.addEventListener('change', requestRender);

function cssColor(name) {
  return new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
}
const COLORS = {
  contract: cssColor('--hl-3d'),
  relax: cssColor('--relax-3d'),
  focus: cssColor('--focus-3d'),
};

const BASE = {
  muscle: { color: 0xa5433b, roughness: 0.58 },
  os: { color: 0xe4dac4, roughness: 0.75 },
  dent: { color: 0xf3f0e6, roughness: 0.3 },
  cartilage: { color: 0xc6d3d4, roughness: 0.6 },
  fascia: { color: 0xd8cdbb, roughness: 0.65 },
  oeil: { color: 0xf1efe9, roughness: 0.2 },
  levres: { color: 0xbd6e66, roughness: 0.5 },
  gencive: { color: 0xc46b6a, roughness: 0.45 },
  repere: { color: 0xc49c86, roughness: 0.7 },
  peau: { color: 0xd9b59f, roughness: 0.75 },
};

/** Structure affichée : un ou plusieurs maillages partageant la même clé. */
const entries = [];
const entriesByKey = new Map();

function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

function register(mesh) {
  const fma = mesh.name;
  const en = PARTS[fma];
  if (!en) { mesh.visible = false; return; }
  const side = /\bright\b/.test(en) ? 'R' : /\bleft\b/.test(en) ? 'L' : 'M';
  const base = en.replace(/\b(right|left) /, '');
  const muscle = muscleByPart.get(base) || null;
  const info = muscle ? { fr: muscle.fr, kind: 'muscle' } : structure(base);
  if (!info) { mesh.visible = false; return; }

  if (!mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals();
  const spec = BASE[info.kind];
  const color = new THREE.Color(spec.color);
  if (info.kind === 'muscle') {
    // légère variation de teinte pour distinguer les muscles voisins
    const t = hash01(muscle.id);
    color.offsetHSL((t - 0.5) * 0.035, 0, (hash01(muscle.id + 'l') - 0.5) * 0.09);
  }
  if (base === 'set of eyebrows') color.set(0x4b3a31);
  mesh.material = new THREE.MeshStandardMaterial({
    color, roughness: spec.roughness, metalness: 0,
    side: info.kind === 'peau' ? THREE.DoubleSide : THREE.FrontSide,
  });

  mesh.updateWorldMatrix(true, false);
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
  const center = box.getCenter(new THREE.Vector3());
  // direction « vers l'extérieur » depuis l'axe du crâne, pour ancrer les étiquettes
  const outward = new THREE.Vector3(center.x, 0, center.z + 2.5);
  if (outward.lengthSq() < 1e-4) outward.set(0, 0, 1);
  outward.normalize();
  const pos = mesh.geometry.attributes.position;
  const step = Math.max(1, Math.floor(pos.count / 500));
  const v = new THREE.Vector3();
  const anchor = center.clone();
  let best = -Infinity;
  for (let i = 0; i < pos.count; i += step) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    const d = v.clone().sub(center);
    const along = d.dot(outward);
    const score = along - 0.8 * Math.sqrt(Math.max(d.lengthSq() - along * along, 0));
    if (score > best) { best = score; anchor.copy(v); }
  }

  const entry = {
    mesh, fma, base, side, muscle, kind: info.kind, fr: info.fr,
    key: muscle ? muscle.id : `S:${base}`,
    baseColor: color.clone(), box, center, anchor, outward, role: null, ghost: false,
  };
  mesh.userData.entry = entry;
  entries.push(entry);
  if (!entriesByKey.has(entry.key)) entriesByKey.set(entry.key, []);
  entriesByKey.get(entry.key).push(entry);
}

/** Ajoute iris et pupille sur chaque globe oculaire, pour donner un regard au modèle. */
function addIrises(root) {
  const eyes = entries.find((e) => e.kind === 'oeil');
  if (!eyes) return;
  const pos = eyes.mesh.geometry.attributes.position;
  const v = new THREE.Vector3();
  const boxes = { L: new THREE.Box3(), R: new THREE.Box3() };
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(eyes.mesh.matrixWorld);
    boxes[v.x > 0 ? 'L' : 'R'].expandByPoint(v);
  }
  const iris = new THREE.MeshStandardMaterial({ color: 0x5f7480, roughness: 0.25 });
  const pupil = new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.15 });
  const group = new THREE.Group();
  for (const box of Object.values(boxes)) {
    const size = box.getSize(new THREE.Vector3());
    const r = Math.min(size.x, size.y) / 2;
    const c = box.getCenter(new THREE.Vector3());
    c.z = box.max.z - r;   // centre de la sphère dont la cornée est le pôle antérieur
    for (const [mat, radius, lift] of [[iris, 0.58, 1.012], [pupil, 0.24, 1.02]]) {
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(r * lift, 40, 10, 0, Math.PI * 2, 0, Math.asin(Math.min(radius / r, 1))),
        mat,
      );
      cap.rotation.x = Math.PI / 2;   // pôle de la calotte vers l'avant (+Z)
      cap.position.copy(c);
      group.add(cap);
    }
  }
  eyes.extras = group;
  root.add(group);
}

// Muscles profonds, recouverts par d'autres muscles de l'expression
const DEEP = new Set(['corrugateur', 'releveur-angle', 'buccinateur', 'pterygoidien-medial', 'pterygoidien-lateral']);
const GHOST_TINT = new THREE.Color(0x8d7f7b);
const DIM_TINT = new THREE.Color(0x4a3a38);
const BLACK = new THREE.Color(0x000000);

/** Applique l'état courant (émotion, sélection, calques) aux matériaux. */
function applyState() {
  const emotion = emotionById.get(state.emotion) || null;
  const roles = rolesOf(emotion);
  const focusKey = state.preview || state.sel;
  const anyHighlight = roles.size > 0 || (focusKey && entriesByKey.has(focusKey));

  for (const e of entries) {
    const mat = e.mesh.material;
    let visible = true;
    if (e.kind === 'peau' || e.base === 'set of eyebrows') visible = state.skin;
    else if (['os', 'dent', 'cartilage', 'gencive'].includes(e.kind)) visible = state.bones;

    let role = null;
    if (e.key === focusKey) role = 'focus';
    else if (e.muscle && roles.has(e.muscle.id)) {
      const oneSided = emotion.cote && e.side !== 'M' && e.side !== emotion.cote;
      if (!oneSided) role = roles.get(e.muscle.id);
    }
    e.role = role;

    const soft = e.kind === 'muscle' || e.kind === 'fascia' || e.kind === 'levres';
    let ghost = false;
    mat.emissive.copy(BLACK);
    if (role) {
      mat.color.copy(COLORS[role]);
      mat.emissive.copy(COLORS[role]).multiplyScalar(0.07);
    } else if (anyHighlight && soft) {
      if (state.isolate) {
        ghost = true;
        mat.color.copy(e.baseColor).lerp(GHOST_TINT, 0.55);
      } else {
        mat.color.copy(e.baseColor).lerp(DIM_TINT, 0.6);
      }
    } else {
      mat.color.copy(e.baseColor);
    }
    if (e.kind === 'peau') ghost = true;
    if (e.key === state.hover && !role) mat.emissive.setRGB(0.16, 0.13, 0.06);
    else if (e.key === state.hover) mat.emissive.multiplyScalar(3);

    const opacity = e.kind === 'peau' ? 0.42 : ghost ? 0.16 : 1;
    if (mat.transparent !== ghost) { mat.transparent = ghost; mat.needsUpdate = true; }
    mat.opacity = opacity;
    mat.depthWrite = !ghost;
    e.mesh.renderOrder = e.kind === 'peau' ? 3 : ghost ? 2 : role ? 1 : 0;
    e.ghost = ghost;
    e.mesh.visible = visible;
    // vue « en transparence » : le muscle sélectionné, ou un muscle profond d'une émotion,
    // reste repérable même quand un autre muscle le recouvre
    const through = role === 'focus' || (role && e.muscle && DEEP.has(e.muscle.id));
    if (through && !e.xray) {
      e.xray = new THREE.Mesh(e.mesh.geometry, new THREE.MeshBasicMaterial({
        transparent: true, depthTest: false, depthWrite: false,
      }));
      e.xray.raycast = () => {};
      e.xray.renderOrder = 4;
      e.mesh.add(e.xray);
    }
    if (e.xray) {
      e.xray.visible = !!through;
      if (through) {
        e.xray.material.color.copy(COLORS[role]).multiplyScalar(role === 'focus' ? 1 : 0.5);
        e.xray.material.opacity = role === 'focus' ? 0.72 : 0.5;
      }
    }
    if (e.extras) e.extras.visible = visible;
  }
  if (state.emotion || state.sel) $('#hint').classList.add('is-used');
  rebuildLabels();
  requestRender();
}

// ─────────────────────────── Caméra et vues ──────────────────────────

let flight = null;

function fitDistance(radius) {
  const half = THREE.MathUtils.degToRad(camera.fov / 2);
  const aspect = Math.min(camera.aspect, 1);
  return radius / Math.sin(half) / Math.max(aspect, 0.45);
}

function flyTo(target, dir, dist) {
  setHover(null);   // le modèle va bouger sous le pointeur
  const endPos = target.clone().add(dir.clone().normalize().multiplyScalar(dist));
  if (reduceMotion.matches) {
    controls.target.copy(target); camera.position.copy(endPos); controls.update(); requestRender();
    return;
  }
  // interpolation en coordonnées sphériques autour de la cible, pour tourner autour du modèle
  const from = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  const to = new THREE.Spherical().setFromVector3(endPos.clone().sub(target));
  let dTheta = to.theta - from.theta;
  dTheta = ((dTheta + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  flight = { t0: performance.now(), dur: 650, from, to, dTheta, target0: controls.target.clone(), target1: target.clone() };
}

function stepFlight(now) {
  if (!flight) return;
  const k = Math.min((now - flight.t0) / flight.dur, 1);
  const s = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  const sph = new THREE.Spherical(
    THREE.MathUtils.lerp(flight.from.radius, flight.to.radius, s),
    THREE.MathUtils.lerp(flight.from.phi, flight.to.phi, s),
    flight.from.theta + flight.dTheta * s,
  );
  controls.target.lerpVectors(flight.target0, flight.target1, s);
  camera.position.setFromSpherical(sph).add(controls.target);
  if (k >= 1) flight = null;
  requestRender();
}

function setView(name) {
  const v = VIEWS[name];
  const sph = new THREE.Spherical(1, THREE.MathUtils.degToRad(v.pol), THREE.MathUtils.degToRad(v.az));
  flyTo(HOME_TARGET.clone(), new THREE.Vector3().setFromSpherical(sph), fitDistance(HOME_RADIUS));
}

/** Cadre un ensemble de structures, vues de face ou depuis leur côté. */
function frame(list) {
  if (!list.length) return;
  const box = new THREE.Box3();
  for (const e of list) box.union(e.box);
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 4.5);
  // pour une paire de muscles, on regarde depuis le côté gauche du sujet :
  // les muscles latéraux (temporal, masséter…) se présentent de profil, ceux du visage de face
  const side = new THREE.Box3();
  for (const e of list) if (e.side !== 'R') side.union(e.box);
  const from = side.isEmpty() ? center : side.getCenter(new THREE.Vector3());
  const dir = new THREE.Vector3(from.x, 0, from.z + 1.5);
  if (dir.length() < 2.5) dir.set(0.32, 0, 1);
  dir.normalize(); dir.y = 0.08;
  // garde un peu de contexte autour de la structure
  flyTo(center, dir, fitDistance(THREE.MathUtils.clamp(radius * 1.9, 11, 17)));
}

// ─────────────────────────── Survol et clic ──────────────────────────

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function pick(ev) {
  const r = canvas.getBoundingClientRect();
  pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const targets = entries.filter((e) => e.mesh.visible && e.kind !== 'peau').map((e) => e.mesh);
  const hits = raycaster.intersectObjects(targets, false);
  let firstGhost = null;
  for (const h of hits) {
    const e = h.object.userData.entry;
    if (e.ghost) { firstGhost = firstGhost || e; continue; }
    // une structure opaque arrête le rayon ; un muscle en surbrillance l'emporte sur les fantômes
    return e.role ? e : (firstGhost || e);
  }
  return firstGhost;
}

let down = null;
let hoverQueued = null;

canvas.addEventListener('pointerdown', (ev) => {
  down = { x: ev.clientX, y: ev.clientY };
  flight = null;
  $('#hint').classList.add('is-used');
});
canvas.addEventListener('pointerup', (ev) => {
  if (!down) return;
  const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
  down = null;
  if (moved > 6) return;
  const e = pick(ev);
  select(e ? e.key : null);
});
canvas.addEventListener('pointermove', (ev) => {
  if (ev.pointerType === 'touch' || ev.buttons) { setHover(null); return; }
  if (hoverQueued) { hoverQueued = ev; return; }
  hoverQueued = ev;
  requestAnimationFrame(() => {
    const last = hoverQueued; hoverQueued = null;
    const e = pick(last);
    setHover(e ? e.key : null, e, last);
  });
});
canvas.addEventListener('pointerleave', () => setHover(null));

function setHover(key, entry, ev) {
  if (key && entry) {
    const r = stage.getBoundingClientRect();
    tooltip.textContent = entry.fr;
    tooltip.hidden = false;
    const x = Math.min(ev.clientX - r.left + 14, r.width - tooltip.offsetWidth - 8);
    tooltip.style.transform = `translate(${Math.max(8, x)}px, ${ev.clientY - r.top + 16}px)`;
  } else {
    tooltip.hidden = true;
  }
  canvas.style.cursor = key ? 'pointer' : 'grab';
  if (state.hover === key) return;
  state.hover = key;
  markRows();
  applyState();
}

// ───────────────────────────── Étiquettes ────────────────────────────

let labelItems = [];
let labelSig = '';

function rebuildLabels() {
  const keys = [];
  const seen = new Set();
  if (state.labels) {
    for (const e of entries) {
      if (e.role && e.mesh.visible && !seen.has(e.key)) { seen.add(e.key); keys.push([e.key, e.role, e.fr]); }
    }
  }
  const sig = keys.map((k) => k[0] + k[1]).join('|');
  if (sig === labelSig) return;
  labelSig = sig;
  labelsBox.textContent = '';
  leaders.textContent = '';
  labelItems = keys.map(([key, role, fr]) => {
    const btn = el('button', `label label--${role}`, fr);
    btn.type = 'button';
    btn.addEventListener('click', () => select(key));
    btn.addEventListener('pointerenter', () => setPreview(key));
    btn.addEventListener('pointerleave', () => setPreview(null));
    labelsBox.append(btn);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    line.setAttribute('class', `leader leader--${role}`);
    dot.setAttribute('class', `leader-dot leader--${role}`);
    dot.setAttribute('r', '3.2');
    leaders.append(line, dot);
    return { key, role, btn, line, dot, w: btn.offsetWidth, h: btn.offsetHeight };
  });
}

const tmp = new THREE.Vector3();
const toCam = new THREE.Vector3();

function layoutLabels() {
  if (!labelItems.length) return;
  const W = stage.clientWidth, H = stage.clientHeight;
  const placed = [];
  for (const it of labelItems) {
    let bestEntry = null, bestX = -Infinity, bestY = 0;
    for (const e of entriesByKey.get(it.key)) {
      if (e.role !== it.role || !e.mesh.visible) continue;
      toCam.copy(camera.position).sub(e.anchor).normalize();
      if (toCam.dot(e.outward) < 0.08) continue;
      tmp.copy(e.anchor).project(camera);
      if (tmp.z > 1) continue;
      const x = (tmp.x * 0.5 + 0.5) * W, y = (-tmp.y * 0.5 + 0.5) * H;
      if (x > bestX) { bestX = x; bestY = y; bestEntry = e; }
    }
    const show = !!bestEntry && bestX > 0 && bestX < W && bestY > 0 && bestY < H;
    it.btn.classList.toggle('is-off', !show);
    it.line.style.display = it.dot.style.display = show ? '' : 'none';
    if (show) placed.push({ it, ax: bestX, ay: bestY });
  }
  // colonne de droite, sans chevauchement, dans l'ordre vertical des ancres
  placed.sort((a, b) => a.ay - b.ay);
  const gap = 6, top = 64, bottom = H - 14;
  let y = top;
  for (const p of placed) { p.y = Math.max(p.ay - p.it.h / 2, y); y = p.y + p.it.h + gap; }
  let limit = bottom;
  for (let i = placed.length - 1; i >= 0; i--) {
    const p = placed[i];
    if (p.y + p.it.h > limit) p.y = limit - p.it.h;
    limit = p.y - gap;
  }
  let offY = 0;
  for (const p of labelItems.filter((it) => it.btn.classList.contains('is-off'))) {
    p.btn.style.transform = `translate(0, ${H + 40 + offY}px)`; offY += 30;
  }
  for (const p of placed) {
    const left = W - 12 - p.it.w;
    const cy = p.y + p.it.h / 2;
    p.it.btn.style.transform = `translate(${left}px, ${p.y}px)`;
    const elbow = Math.max(left - 22, p.ax + 6);
    p.it.line.setAttribute('points', `${p.ax.toFixed(1)},${p.ay.toFixed(1)} ${elbow.toFixed(1)},${cy.toFixed(1)} ${(left - 3).toFixed(1)},${cy.toFixed(1)}`);
    p.it.dot.setAttribute('cx', p.ax.toFixed(1));
    p.it.dot.setAttribute('cy', p.ay.toFixed(1));
  }
}

// ──────────────────────────── Interface ──────────────────────────────

function select(key, { focus = false } = {}) {
  state.sel = key && entriesByKey.has(key) ? key : null;
  state.preview = null;
  renderDetail();
  markRows();
  applyState();
  if (focus && state.sel) frame(entriesByKey.get(state.sel));
}

function setPreview(key) {
  if (state.preview === key) return;
  state.preview = key;
  applyState();
}

function setEmotion(id, { focus = true } = {}) {
  state.emotion = id && emotionById.has(id) ? id : null;
  for (const b of document.querySelectorAll('.emotion')) {
    b.setAttribute('aria-pressed', String(b.dataset.id === state.emotion));
  }
  renderEmotion();
  renderDetail();
  markRows();
  applyState();
  try { history.replaceState(null, '', state.emotion ? `#${state.emotion}` : location.pathname + location.search); } catch { /* aperçu sans historique */ }
  if (state.emotion && focus) flyTo(FACE_TARGET.clone(), new THREE.Vector3(0.3, 0.07, 1), fitDistance(14.5));
}

function auChip(au) {
  const c = el('span', 'au', au.replace('AU', 'AU '));
  c.title = AUS[au] || '';
  return c;
}

function muscleButton(m, extraClass) {
  const b = el('button', `muscle-link ${extraClass || ''}`);
  b.type = 'button';
  b.dataset.key = m.id;
  b.append(el('span', 'fr', m.fr), el('span', 'la', m.la));
  b.addEventListener('click', () => select(m.id, { focus: true }));
  b.addEventListener('pointerenter', () => setPreview(m.id));
  b.addEventListener('pointerleave', () => setPreview(null));
  b.addEventListener('focus', () => setPreview(m.id));
  b.addEventListener('blur', () => setPreview(null));
  return b;
}

function buildEmotionBar() {
  const bar = $('#emotion-bar');
  for (const e of EMOTIONS) {
    const b = el('button', 'emotion', e.fr);
    b.type = 'button';
    b.dataset.id = e.id;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => setEmotion(state.emotion === e.id ? null : e.id));
    bar.append(b);
  }
}

function renderEmotion() {
  const box = $('#emotion-card');
  const e = emotionById.get(state.emotion);
  box.hidden = !e;
  box.textContent = '';
  if (!e) return;
  const head = el('div', 'emotion-head');
  head.append(el('h2', null, e.fr), el('p', 'formule', e.formule.replace(/AU(\d+)/g, 'AU $1')));
  box.append(head, el('p', 'resume', e.resume));
  const list = el('ol', 'au-list');
  for (const l of e.lignes) {
    const li = el('li', 'au-row');
    const left = el('div', 'au-cell');
    left.append(auChip(l.au));
    const right = el('div', 'au-body');
    const title = el('p', 'au-name', AUS[l.au]);
    if (l.precision) title.append(el('span', 'precision', l.precision));
    right.append(title);
    for (const id of l.muscles) {
      const m = muscleById.get(id);
      const b = muscleButton(m, l.relache ? 'is-relax' : 'is-contract');
      if (l.relache) b.append(el('span', 'tag', 'se relâche'));
      right.append(b);
    }
    for (const name of l.absent || []) {
      const p = el('p', 'absent');
      p.append(el('span', 'fr', name), el('span', 'tag', 'absent du modèle 3D'));
      right.append(p);
    }
    li.append(left, right);
    list.append(li);
  }
  box.append(list);
  const legend = el('p', 'legend');
  legend.append(el('span', 'swatch swatch--contract'), 'se contracte ');
  if (e.lignes.some((l) => l.relache)) legend.append(el('span', 'swatch swatch--relax'), 'se relâche ');
  legend.append(el('span', 'swatch swatch--focus'), 'muscle sélectionné');
  box.append(legend);
}

function buildMuscleList() {
  const box = $('#muscle-list');
  for (const g of GROUPS) {
    const section = el('section', 'group');
    section.dataset.group = g.id;
    section.append(el('h3', null, g.fr));
    for (const m of MUSCLES.filter((x) => x.group === g.id)) {
      if (!entriesByKey.has(m.id)) continue;
      const b = muscleButton(m, 'row');
      b.dataset.search = `${m.fr} ${m.la} ${m.aus.join(' ')} ${m.aus.map((a) => a.replace('AU', 'AU ')).join(' ')}`
        .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      if (m.aus.length) {
        const chips = el('span', 'chips');
        for (const au of m.aus) chips.append(auChip(au));
        b.append(chips);
      }
      section.append(b);
    }
    box.append(section);
  }
  $('#search').addEventListener('input', (ev) => {
    const q = ev.target.value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    let any = false;
    for (const section of box.querySelectorAll('.group')) {
      let shown = 0;
      for (const b of section.querySelectorAll('.row')) {
        const ok = !q || b.dataset.search.includes(q);
        b.hidden = !ok;
        if (ok) shown++;
      }
      section.hidden = shown === 0;
      any = any || shown > 0;
    }
    $('#no-result').hidden = any;
  });
}

function markRows() {
  for (const b of document.querySelectorAll('.muscle-link')) {
    b.classList.toggle('is-selected', b.dataset.key === state.sel);
    b.classList.toggle('is-hover', b.dataset.key === state.hover);
  }
}

function renderDetail() {
  const key = state.sel;
  detail.hidden = !key;
  if (!key) return;
  const body = $('#detail-body');
  body.textContent = '';
  const m = muscleById.get(key);
  const list = entriesByKey.get(key);
  $('#detail-kind').textContent = m ? GROUPS.find((g) => g.id === m.group).fr : KIND_LABEL[list[0].kind];
  $('#detail-name').textContent = list[0].fr;
  $('#detail-latin').textContent = m ? m.la : '';
  $('#detail-latin').hidden = !m;
  const chips = $('#detail-aus');
  chips.textContent = '';
  if (!m) { $('#detail-more').hidden = true; return; }
  $('#detail-more').hidden = false;
  for (const au of m.aus) chips.append(auChip(au));

  const add = (title, text) => {
    if (!text) return;
    body.append(el('h4', null, title), el('p', null, text));
  };
  add('Action', m.action);
  if (m.aus.length) {
    body.append(el('h4', null, 'Unités d’action (FACS)'));
    const ul = el('ul', 'au-defs');
    for (const au of m.aus) {
      const li = el('li');
      li.append(auChip(au), el('span', null, AUS[au]));
      ul.append(li);
    }
    body.append(ul);
  }
  add('Origine', m.origine);
  add('Terminaison', m.insertion);
  if (m.note) body.append(el('p', 'note', m.note));
  const emos = emotionsOf(m.id);
  body.append(el('h4', null, 'Émotions'));
  if (emos.length) {
    const wrap = el('div', 'emo-chips');
    for (const e of emos) {
      const b = el('button', 'emo-chip', e.fr);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(e.id === state.emotion));
      b.addEventListener('click', () => setEmotion(e.id));
      wrap.append(b);
    }
    body.append(wrap);
  } else {
    body.append(el('p', 'muted', 'Ne participe à aucune des sept expressions prototypiques.'));
  }
}

function bindToolbar() {
  for (const b of document.querySelectorAll('[data-view]')) {
    b.addEventListener('click', () => setView(b.dataset.view));
  }
  for (const b of document.querySelectorAll('[data-toggle]')) {
    const name = b.dataset.toggle;
    b.setAttribute('aria-pressed', String(state[name]));
    b.addEventListener('click', () => {
      state[name] = !state[name];
      b.setAttribute('aria-pressed', String(state[name]));
      applyState();
    });
  }
  $('#detail-close').addEventListener('click', () => select(null));
  $('#detail-focus').addEventListener('click', () => state.sel && frame(entriesByKey.get(state.sel)));
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && state.sel) select(null);
  });
  window.addEventListener('hashchange', () => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id !== (state.emotion || '')) setEmotion(id || null);
  });
}

// ─────────────────────────── Boucle de rendu ─────────────────────────

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  if (shift) camera.setViewOffset(w, h, -shift, 0, w, h);
  camera.updateProjectionMatrix();
  leaders.setAttribute('viewBox', `0 0 ${w} ${h}`);
  for (const it of labelItems) { it.w = it.btn.offsetWidth; it.h = it.btn.offsetHeight; }
  requestRender();
}
new ResizeObserver(resize).observe(stage);

// Quand la fiche d'un muscle est ouverte sur grand écran, l'image est décalée
// pour que le modèle reste centré dans la partie libre de la scène.
let shift = 0;
function stepShift() {
  const w = stage.clientWidth, h = stage.clientHeight;
  const open = !detail.hidden && !narrow.matches;
  const goal = open ? Math.min(detail.offsetWidth + 12, w * 0.45) / 2 : 0;
  if (Math.abs(goal - shift) < 0.5) {
    if (shift === goal) return;
    shift = goal;
  } else {
    shift = reduceMotion.matches ? goal : shift + (goal - shift) * 0.18;
  }
  if (shift) camera.setViewOffset(w, h, -shift, 0, w, h);
  else camera.clearViewOffset();
  requestRender();
}

function tick(now) {
  requestAnimationFrame(tick);
  stepFlight(now);
  stepShift();
  if (controls.update()) dirty = true;
  if (!dirty) return;
  dirty = false;
  camera.updateMatrixWorld();
  renderer.render(scene, camera);
  layoutLabels();
}

// ───────────────────────────── Démarrage ─────────────────────────────

function start() {
  buildEmotionBar();
  bindToolbar();
  $('#detail-more').open = !narrow.matches;
  resize();
  const sph = new THREE.Spherical(fitDistance(HOME_RADIUS), THREE.MathUtils.degToRad(84), THREE.MathUtils.degToRad(28));
  controls.target.copy(HOME_TARGET);
  camera.position.setFromSpherical(sph).add(HOME_TARGET);
  controls.update();
  requestAnimationFrame(tick);

  const loading = $('#loading');
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.load('assets/head.glb', (gltf) => {
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => { if (o.isMesh) register(o); });
    scene.add(gltf.scene);
    addIrises(scene);
    buildMuscleList();
    loading.hidden = true;
    stage.classList.add('is-ready');
    const initial = decodeURIComponent(location.hash.slice(1));
    if (emotionById.has(initial)) setEmotion(initial, { focus: !reduceMotion.matches });
    else applyState();
    window.__ecorche = { state, entries, select, setEmotion, setView };   // accès pour les tests automatisés
  }, (ev) => {
    if (ev.total) $('#loading-bar').style.width = `${Math.round((ev.loaded / ev.total) * 100)}%`;
  }, (err) => {
    console.error(err);
    loading.classList.add('is-error');
    $('#loading-text').textContent = 'Le modèle 3D n’a pas pu être chargé. Rechargez la page ; si le problème persiste, vérifiez que le fichier assets/head.glb est bien publié avec le site.';
  });
}

start();
