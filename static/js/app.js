import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { COCO, kp3 } from './poseMap.js';

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

function connectWS(){
  const proto = location.protocol==='https:'?'wss':'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = ()=>{ console.log('WS open'); sendFrames(); };
  ws.onmessage = (ev)=>{
    try{ const m = JSON.parse(ev.data); if(m.type==='pose'){ drawOverlay(m.persons); updateAvatar(m.persons); statsEl.textContent = `FPS: ${m.fps||0} | ID: ${currentId}`; } }catch(e){}
  };
  ws.onclose = ()=>{ setTimeout(connectWS, 1000); };
}

function drawOverlay(persons){
  ctx.clearRect(0,0,overlay.width,overlay.height);
  for(const p of persons){
    if(currentId===-1 || p.track_id===currentId) currentId = p.track_id;
    if(p.track_id!==currentId) continue;
    const k = p.kpts;
    // hombros-codos-muñecas
    drawLine(k[COCO.L_SH], k[COCO.L_EL], k[COCO.L_WR]);
    drawLine(k[COCO.R_SH], k[COCO.R_EL], k[COCO.R_WR]);
    drawLine(k[COCO.L_SH], k[COCO.R_SH]);
    drawLine(k[COCO.L_HIP], k[COCO.R_HIP]);
    drawLine(k[COCO.L_HIP], k[COCO.L_KN], k[COCO.L_AN]);
    drawLine(k[COCO.R_HIP], k[COCO.R_KN], k[COCO.R_AN]);
    drawLine(k[COCO.NOSE], k[COCO.L_EYE], k[COCO.L_EAR]);
    drawLine(k[COCO.NOSE], k[COCO.R_EYE], k[COCO.R_EAR]);
    drawPoint(k[COCO.NOSE]);
  }
}
function drawLine(a,b,c){
  if(!a||!b||a.c<0.25||b.c<0.25) return;
  ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); if(c) { if(c.c>0.25){ ctx.lineTo(c.x,c.y);} }
  ctx.strokeStyle='#0f0'; ctx.lineWidth=3; ctx.stroke();
}
function drawPoint(a){ if(!a||a.c<0.25) return; ctx.beginPath(); ctx.arc(a.x,a.y,4,0,Math.PI*2); ctx.fillStyle='#0ff'; ctx.fill(); }

async function listCams(){
  try{ const d=await navigator.mediaDevices.enumerateDevices(); devices=d.filter(x=>x.kind==='videoinput'); camSelect.innerHTML='';
    devices.forEach((d,i)=>{ const o=document.createElement('option'); o.value=d.deviceId; o.text=d.label||`Cámara ${i+1}`; camSelect.appendChild(o); });
  }catch(e){}
}
async function startCam(deviceId=null, facing='environment'){
  if(stream) stream.getTracks().forEach(t=>t.stop());
  const constraints={video:{width:{ideal:1280},height:{ideal:720},facingMode:facing, deviceId: deviceId?{exact:deviceId}:undefined},audio:false};
  stream=await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject=stream;
  await video.play();
  overlay.width=video.videoWidth||640; overlay.height=video.videoHeight||480;
}

startBtn.onclick=async ()=>{
  await listCams();
  const back = devices.find(d=>/back|rear|environment/i.test(d.label));
  await startCam(back?back.deviceId:null,'environment');
  connectWS();
};
toggleMirror.onclick=()=>{ mirror=!mirror; video.style.transform=mirror?'scaleX(-1)':'none'; overlay.style.transform=mirror?'scaleX(-1)':'none'; };

// Envío frames
function sendFrames(){
  if(ws&&ws.readyState===1){
    const c=document.createElement('canvas'); c.width=Math.min(video.videoWidth||640,640); c.height=Math.min(video.videoHeight||480,480);
    const g=c.getContext('2d');
    if(mirror){ g.scale(-1,1); g.drawImage(video,-c.width,0,c.width,c.height); }else{ g.drawImage(video,0,0,c.width,c.height); }
    c.toBlob(b=>{ if(b){ ws.send(JSON.stringify({type:'frame', image:c.toDataURL('image/jpeg',0.6)})); } setTimeout(sendFrames,80); }, 'image/jpeg', 0.6);
  }else setTimeout(sendFrames,150);
}

// Three.js
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});
renderer.setSize(sceneDiv.clientWidth, sceneDiv.clientHeight);
sceneDiv.appendChild(renderer.domElement);
const scene=new THREE.Scene();
scene.background=new THREE.Color(0x0b0d1f);
const camera=new THREE.PerspectiveCamera(45,sceneDiv.clientWidth/sceneDiv.clientHeight,0.1,100);
camera.position.set(0,1.6,3);
const light=new THREE.DirectionalLight(0xffffff,2); light.position.set(3,5,2); scene.add(light); scene.add(new THREE.AmbientLight(0x404040,2));
const ctrl=new OrbitControls(camera,renderer.domElement); ctrl.enableDamping=true;
let mixer=null, modelRoot=null;
const loader=new GLTFLoader();
loader.load('/static/models/humanoid.glb',g=>{
  modelRoot=g.scene; scene.add(modelRoot);
  modelRoot.scale.set(1,1,1);
  modelRoot.position.y=-1;
},{},{e=>{ console.warn('Falta humanoid.glb (se usará placeholder)'); addPlaceholder(); }});
function addPlaceholder(){
  const group=new THREE.Group();
  group.add(new THREE.Mesh(new THREE.CylinderGeometry(0.25,0.25,1.6), new THREE.MeshStandardMaterial({color:0x4fc3f7})));
  group.position.y=-0.2; scene.add(group); modelRoot=group;
}
function animate(){ requestAnimationFrame(animate); ctrl.update(); renderer.render(scene,camera); } animate();
window.addEventListener('resize',()=>{ camera.aspect=sceneDiv.clientWidth/sceneDiv.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(sceneDiv.clientWidth,sceneDiv.clientHeight); });

// Mapeo placeholder (simple): mover hombros/codos si existen
function updateAvatar(persons){
  if(!modelRoot) return;
  for(const p of persons){
    if(currentId===-1||p.track_id===currentId){ currentId=p.track_id; applyKpts(p.kpts); break; }
  }
}
function applyKpts(k){
  // Aquí iría rotación de huesos con Three.js SkeletonUtils
  // Por ahora solo feedback visual (ya dibujamos overlay)
}
