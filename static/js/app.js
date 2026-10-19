import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { COCO, dist, angleUp, angleDown, EMA, EMAAngle, kAt, lerp, clamp, KptFilter } from './poseMap.js';

const video = document.getElementById('video');
const overlay = document.getElementById('overlay');
const ctx = overlay.getContext('2d');
const startBtn = document.getElementById('startBtn');
const camSelect = document.getElementById('camSelect');
const toggleMirror = document.getElementById('toggleMirror');
const statsEl = document.getElementById('stats');
const sceneDiv = document.getElementById('scene');

let ws = null;
let mirror = true;
let currentId = -1;
let devices = [];
let stream = null;
let lastFps = 0;
let awaiting = false;
const kptFilter = new KptFilter();

/* ============ WEBCAM + WS ============ */

async function listCams() {
  try {
    const d = await navigator.mediaDevices.enumerateDevices();
    devices = d.filter(x => x.kind === 'videoinput');
    camSelect.innerHTML = '';
    devices.forEach((d2, i) => {
      const o = document.createElement('option');
      o.value = d2.deviceId;
      o.text = d2.label || `Camara ${i + 1}`;
      camSelect.appendChild(o);
    });
  } catch (e) { console.warn(e); }
}

async function startCam(deviceId = null, facing = 'environment') {
  if (stream) stream.getTracks().forEach(t => t.stop());
  const constraints = {
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: facing, deviceId: deviceId ? { exact: deviceId } : undefined },
    audio: false
  };
  stream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = stream;
  await video.play();
  overlay.width = video.videoWidth || 640;
  overlay.height = video.videoHeight || 480;
}

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => { console.log('WS conectado'); sendFrames(); };
  ws.onmessage = (ev) => {
    awaiting = false;
    try {
      const m = JSON.parse(ev.data);
      if (m.type === 'pose') {
        lastFps = m.fps || 0;
        drawOverlay(m.persons);
        const person = pickPerson(m.persons);
        if (person) {
          const t = performance.now() / 1000;
          updateRobot(kptFilter.filter(person.kpts, t));
        }
        statsEl.textContent = `FPS: ${lastFps} | ID: ${currentId >= 0 ? currentId : '-'}`;
      }
    } catch (e) { console.warn(e); }
    setTimeout(sendFrames, 0);
  };
  ws.onclose = () => { awaiting = false; setTimeout(connectWS, 1200); };
}

function pickPerson(persons) {
  if (!persons || persons.length === 0) return null;
  let found = persons.find(p => p.track_id === currentId);
  if (!found) {
    found = persons.reduce((a, b) => (b.conf > a.conf ? b : a), persons[0]);
    currentId = found.track_id;
  }
  return found;
}

function sendFrames() {
  if (awaiting) return;
  if (ws && ws.readyState === 1 && video.videoWidth) {
    const c = document.createElement('canvas');
    c.width = Math.min(video.videoWidth || 640, 640);
    c.height = Math.round(c.width * (video.videoHeight / video.videoWidth));
    const g = c.getContext('2d');
    if (mirror) { g.translate(c.width, 0); g.scale(-1, 1); }
    g.drawImage(video, 0, 0, c.width, c.height);
    awaiting = true;
    ws.send(JSON.stringify({ type: 'frame', image: c.toDataURL('image/jpeg', 0.65) }));
  } else setTimeout(sendFrames, 200);
}

startBtn.onclick = async () => {
  try {
    await listCams();
    const back = devices.find(d => /back|rear|trasera/i.test(d.label));
    await startCam(back ? back.deviceId : null, back ? 'environment' : 'user');
    applyMirror();
    connectWS();
    startBtn.textContent = 'Camara activa';
    startBtn.disabled = true;
  } catch (e) { alert('No se pudo abrir la camara: ' + e.message); }
};
toggleMirror.onclick = () => { mirror = !mirror; applyMirror(); };
function applyMirror() {
  video.style.transform = mirror ? 'scaleX(-1)' : 'none';
  overlay.style.transform = mirror ? 'scaleX(-1)' : 'none';
}

/* ============ OVERLAY 2D (esqueleto) ============ */

function drawOverlay(persons) {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  const p = pickPerson(persons);
  if (!p) return;
  const k = p.kpts;
  const pair = (a, b) => { const A = kAt(k, a), B = kAt(k, b); if (A && B) seg(A, B); };
  const chain = (a, b, c) => { const A = kAt(k, a), B = kAt(k, b), C = kAt(k, c); if (A && B && C) { seg(A, B); seg(B, C); } };

  chain(COCO.L_SH, COCO.L_EL, COCO.L_WR);
  chain(COCO.R_SH, COCO.R_EL, COCO.R_WR);
  pair(COCO.L_SH, COCO.R_SH);
  pair(COCO.L_HIP, COCO.R_HIP);
  pair(COCO.L_SH, COCO.L_HIP);
  pair(COCO.R_SH, COCO.R_HIP);
  chain(COCO.L_HIP, COCO.L_KN, COCO.L_AN);
  chain(COCO.R_HIP, COCO.R_KN, COCO.R_AN);
  pair(COCO.NOSE, COCO.L_SH);
  pair(COCO.NOSE, COCO.R_SH);

  for (const i of Object.values(COCO)) {
    const A = kAt(k, i);
    if (A) { ctx.beginPath(); ctx.arc(A.x, A.y, 3.5, 0, Math.PI * 2); ctx.fillStyle = '#0ff'; ctx.fill(); }
  }
}
function seg(A, B) {
  ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y);
  ctx.strokeStyle = '#0f0'; ctx.lineWidth = 3; ctx.stroke();
}

/* ============ THREE.JS + ROBOT ============ */

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(sceneDiv.clientWidth, sceneDiv.clientHeight);
sceneDiv.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d1f);
scene.fog = new THREE.Fog(0x0b0d1f, 8, 16);

const camera = new THREE.PerspectiveCamera(45, sceneDiv.clientWidth / sceneDiv.clientHeight, 0.1, 100);
camera.position.set(0, 1.1, 4.6);

const dirLight = new THREE.DirectionalLight(0xffffff, 2.4);
dirLight.position.set(3, 6, 4);
scene.add(dirLight);
const rim = new THREE.DirectionalLight(0x66aaff, 1.2);
rim.position.set(-4, 3, -3);
scene.add(rim);
scene.add(new THREE.AmbientLight(0x506080, 1.4));

const grid = new THREE.GridHelper(20, 40, 0x2a3a6a, 0x16233f);
grid.position.y = -1.55;
scene.add(grid);

const ctrl = new OrbitControls(camera, renderer.domElement);
ctrl.enableDamping = true;
ctrl.target.set(0, 0.35, 0);
ctrl.maxPolarAngle = Math.PI * 0.55;
ctrl.minDistance = 2;
ctrl.maxDistance = 9;

// Materiales estilo robot plateado (I, Robot)
const MAT = {
  body: new THREE.MeshStandardMaterial({ color: 0xcfd6e6, metalness: 0.95, roughness: 0.28 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2b3145, metalness: 0.7, roughness: 0.45 }),
  glow: new THREE.MeshStandardMaterial({ color: 0x33e0ff, emissive: 0x19c8ff, emissiveIntensity: 1.6, metalness: 0.3, roughness: 0.3 }),
  visor: new THREE.MeshStandardMaterial({ color: 0x06121c, emissive: 0x0a7ea8, emissiveIntensity: 1.1, metalness: 0.6, roughness: 0.2 })
};

// Un segmento: grupo pivote en la coyuntura; geometria extiende hacia -Y (por defecto "hacia abajo")
class Bone {
  constructor(len, thick, mat = MAT.body) {
    this.rest = len;
    this.g = new THREE.Group();
    const geo = new THREE.CylinderGeometry(thick, thick * 0.86, len, 14);
    geo.translate(0, -len / 2, 0);
    this.mesh = new THREE.Mesh(geo, mat);
    this.g.add(this.mesh);
    this.joint = new THREE.Group();          // coyuntura siguiente (en extremo)
    this.joint.position.y = -len;
    this.g.add(this.joint);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(thick * 1.25, 14, 12), MAT.dark);
    this.joint.add(ball);
  }
  // dx,dy en escena; down=true => por defecto apunta -Y
  set(dx, dy, len) {
    const l = Math.max(0.05, len || this.rest);
    this.g.rotation.z = downAngle(dx, dy);
    this.mesh.scale.y = l / this.rest;
    this.joint.position.y = -l;
    return this.joint;
  }
}
// Bone hacia arriba (torso/cuello): por defecto +Y
function upAngle(dx, dy) { return angleUp(dx, dy); }
// Bone hacia abajo
function downAngle(dx, dy) { return angleDown(dx, dy); }

const robot = new THREE.Group();
scene.add(robot);

// --- cadera ---
const hipG = new THREE.Group();
robot.add(hipG);
const hipMesh = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.26, 0.3), MAT.body);
hipMesh.position.y = -0.06;
hipG.add(hipMesh);

// --- torso (por defecto hacia ARRIBA, lo rotamos con angleUp) ---
const torsoBone = { rest: 1.0, g: new THREE.Group(), mesh: null, chest: null };
{
  const geo = new THREE.BoxGeometry(0.62, 1.0, 0.34);
  geo.translate(0, 0.5, 0);
  torsoBone.mesh = new THREE.Mesh(geo, MAT.body);
  torsoBone.g.add(torsoBone.mesh);
  torsoBone.chest = new THREE.Group();
  torsoBone.chest.position.y = 1.0;
  torsoBone.g.add(torsoBone.chest);
  hipG.add(torsoBone.g);
}
// pecho emisor
const chestGlow = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.06), MAT.glow);
chestGlow.position.set(0, 0.68, 0.18);
torsoBone.g.add(chestGlow);

// --- cabeza (cuello por defecto arriba) ---
const headBone = { g: new THREE.Group(), rest: 0.28, mesh: null };
{
  const geo = new THREE.CylinderGeometry(0.07, 0.08, 0.28, 12);
  geo.translate(0, 0.14, 0);
  headBone.g.add(new THREE.Mesh(geo, MAT.dark));
  const skull = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 0.3), MAT.body);
  skull.position.y = 0.42;
  headBone.g.add(skull);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.04), MAT.visor);
  visor.position.set(0, 0.44, 0.16);
  headBone.g.add(visor);
  torsoBone.chest.add(headBone.g);
}

// --- brazos (por defecto hacia abajo) ---
function makeArm(sign) {
  const sh = new THREE.Group();
  sh.position.set(sign * 0.4, 0.02, 0);
  torsoBone.chest.add(sh);
  const upper = new Bone(0.52, 0.075);
  sh.add(upper.g);
  const fore = new Bone(0.5, 0.065, MAT.body);
  upper.joint.add(fore.g);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.18, 0.1), MAT.dark);
  hand.position.y = -0.1;
  fore.joint.add(hand);
  return { sh, upper, fore };
}
const armL = makeArm(-1);
const armR = makeArm(1);

// --- piernas (por defecto hacia abajo) ---
function makeLeg(sign) {
  const hipJ = new THREE.Group();
  hipJ.position.set(sign * 0.17, -0.14, 0);
  hipG.add(hipJ);
  const thigh = new Bone(0.72, 0.1);
  hipJ.add(thigh.g);
  const shin = new Bone(0.7, 0.085, MAT.body);
  thigh.joint.add(shin.g);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.32), MAT.dark);
  foot.position.set(0, -0.05, 0.09);
  shin.joint.add(foot);
  return { hipJ, thigh, shin };
}
const legL = makeLeg(-1);
const legR = makeLeg(1);

/* ============ MAPEO POSE -> ROBOT ============ */

const sm = {
  torso: new EMAAngle(0.45), head: new EMAAngle(0.45),
  lu: new EMAAngle(0.5), lf: new EMAAngle(0.5),
  ru: new EMAAngle(0.5), rf: new EMAAngle(0.5),
  lt: new EMAAngle(0.5), ls: new EMAAngle(0.5),
  rt: new EMAAngle(0.5), rs: new EMAAngle(0.5),
  posX: new EMA(0.25), posY: new EMA(0.25),
  torsoLen: new EMA(0.2, 1.0),
  scale: new EMA(0.15, null),
  luLen: new EMA(0.3, null), lfLen: new EMA(0.3, null),
  ruLen: new EMA(0.3, null), rfLen: new EMA(0.3, null),
  ltLen: new EMA(0.3, null), lsLen: new EMA(0.3, null),
  rtLen: new EMA(0.3, null), rsLen: new EMA(0.3, null)
};

function v2(k) { return { x: k.x, y: -k.y }; } // px y-abajo -> y-arriba
function dvec(a, b) { return { x: b.x - a.x, y: b.y - a.y }; }
function dlen(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

function updateRobot(kpts) {
  const lSh = kAt(kpts, COCO.L_SH), rSh = kAt(kpts, COCO.R_SH);
  const lHip = kAt(kpts, COCO.L_HIP), rHip = kAt(kpts, COCO.R_HIP);
  if (!lHip || !rHip || !lSh || !rSh) return;

  const shMid = { x: (lSh.x + rSh.x) / 2, y: (lSh.y + rSh.y) / 2 };
  const hipMid = { x: (lHip.x + rHip.x) / 2, y: (lHip.y + rHip.y) / 2 };

  // Normalizacion: distancia cadera->hombros = 1 unidad escena
  const tLen = dlen(hipMid, shMid);
  if (tLen < 8) return;
  const scale = clamp(1.0 / tLen, 0.002, 0.25);
  const s = clamp(sm.scale.next(scale), 0.002, 0.25);

  // Posicion del robot (centro de imagen -> origen)
  const cx = overlay.width / 2, cy = overlay.height / 2;
  const px = sm.posX.next((hipMid.x - cx) * s);
  const py = sm.posY.next(-(hipMid.y - cy) * s + 0.35);
  robot.position.set(px, py, 0);

  // Longitud torso
  const tl = clamp(sm.torsoLen.next(1.0), 0.8, 1.15);
  torsoBone.mesh.scale.y = tl;
  torsoBone.chest.position.y = tl;

  // Vector torso (cadera -> hombros), por defecto +Y
  const tVec = dvec(v2(hipMid), v2(shMid));
  const tAng = sm.torso.next(upAngle(tVec.x, tVec.y));
  torsoBone.g.rotation.z = tAng;

  // Cadera neutra (piernas cuelgan de hipG, que no rota)
  hipG.rotation.z = 0;

  // Cabeza: vector hombros->nariz (por defecto arriba)
  const nose = kAt(kpts, COCO.NOSE) || kAt(kpts, COCO.L_EYE);
  if (nose) {
    const hVec2 = dvec(v2(hipMid), v2(nose));
    const hAng = sm.head.next(upAngle(hVec2.x, hVec2.y) - tAng);
    headBone.g.rotation.z = clamp(hAng, -0.7, 0.7);
  }

  // Brazos: proporcion por frame
  const upperRest = 0.52, foreRest = 0.5;

  function arm(shK, elK, wrK, sU, sF) {
    if (!shK || !elK || !wrK) return;
    const sh = v2(shK), el = v2(elK), wr = v2(wrK);
    const d1 = dvec(sh, el), d2 = dvec(el, wr);
    const lenU = sm[sU.lenKey].next(clamp(dlen(sh, el) * s, 0.15, 1.8));
    const lenF = sm[sF.lenKey].next(clamp(dlen(el, wr) * s, 0.15, 1.8));
    sU.g.rotation.z = sm[sU.key].next(downAngle(d1.x, d1.y) - tAng);
    sF.g.rotation.z = sm[sF.key].next(downAngle(d2.x, d2.y) - downAngle(d1.x, d1.y));
    sU.mesh.scale.y = clamp(lenU / upperRest, 0.3, 3.0);
    sU.joint.position.y = -upperRest * sU.mesh.scale.y;
    sF.mesh.scale.y = clamp(lenF / foreRest, 0.3, 3.0);
    sF.joint.position.y = -foreRest * sF.mesh.scale.y;
  }
  arm(lSh, kAt(kpts, COCO.L_EL), kAt(kpts, COCO.L_WR),
    { g: armL.upper.g, mesh: armL.upper.mesh, joint: armL.upper.joint, key: 'lu', lenKey: 'luLen' },
    { g: armL.fore.g, mesh: armL.fore.mesh, joint: armL.fore.joint, key: 'lf', lenKey: 'lfLen' });
  arm(rSh, kAt(kpts, COCO.R_EL), kAt(kpts, COCO.R_WR),
    { g: armR.upper.g, mesh: armR.upper.mesh, joint: armR.upper.joint, key: 'ru', lenKey: 'ruLen' },
    { g: armR.fore.g, mesh: armR.fore.mesh, joint: armR.fore.joint, key: 'rf', lenKey: 'rfLen' });

  // Piernas
  const thighRest = 0.72, shinRest = 0.7;
  function leg(hipK, knK, anK, sT, sS) {
    if (!hipK || !knK || !anK) return;
    const hp = v2(hipK), kn = v2(knK), an = v2(anK);
    const d1 = dvec(hp, kn), d2 = dvec(kn, an);
    const lenT = sm[sT.lenKey].next(clamp(dlen(hp, kn) * s, 0.2, 2.2));
    const lenS = sm[sS.lenKey].next(clamp(dlen(kn, an) * s, 0.2, 2.2));
    sT.g.rotation.z = sm[sT.key].next(downAngle(d1.x, d1.y));
    sS.g.rotation.z = sm[sS.key].next(downAngle(d2.x, d2.y) - downAngle(d1.x, d1.y));
    sT.mesh.scale.y = clamp(lenT / thighRest, 0.3, 3.0);
    sT.joint.position.y = -thighRest * sT.mesh.scale.y;
    sS.mesh.scale.y = clamp(lenS / shinRest, 0.3, 3.0);
    sS.joint.position.y = -shinRest * sS.mesh.scale.y;
  }
  leg(lHip, kAt(kpts, COCO.L_KN), kAt(kpts, COCO.L_AN),
    { g: legL.thigh.g, mesh: legL.thigh.mesh, joint: legL.thigh.joint, key: 'lt', lenKey: 'ltLen' },
    { g: legL.shin.g, mesh: legL.shin.mesh, joint: legL.shin.joint, key: 'ls', lenKey: 'lsLen' });
  leg(rHip, kAt(kpts, COCO.R_KN), kAt(kpts, COCO.R_AN),
    { g: legR.thigh.g, mesh: legR.thigh.mesh, joint: legR.thigh.joint, key: 'rt', lenKey: 'rtLen' },
    { g: legR.shin.g, mesh: legR.shin.mesh, joint: legR.shin.joint, key: 'rs', lenKey: 'rsLen' });
}

/* ============ LOOP ============ */
function animate() {
  requestAnimationFrame(animate);
  ctrl.update();
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = sceneDiv.clientWidth / sceneDiv.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(sceneDiv.clientWidth, sceneDiv.clientHeight);
});
