
/* ============================================================
   NOIR — "Transit" vertical slice (beats 6 → 8)
   Wake in 8001 → phone → corridor of doors → 8007 →
   fridge code → page numbers → dial → Piece #1 + Restock key.
   Engine rules per docs: PS2 320×240 + Bayer dither + posterize,
   three-layer lighting, texel-density texturing, wall-anchored
   props, no soft-locks.
   ============================================================ */
"use strict";
const $=id=>document.getElementById(id);

/* ---------------- Per-pixel lighting ----------------
   Every surface in the game is authored as MeshLambertMaterial, which three.js
   lights per VERTEX. Walls and floors here are single quads, so a lamp in the
   middle of a room lit nothing: the pool fell between the vertices. Route the
   constructor to a matte Phong material so light is evaluated per pixel. At a
   240-line render target this costs almost nothing. wetMat() below is the one
   deliberate exception that keeps a specular highlight (rain-slick ground). */
/* Point lights have no shadows, so a lamp on one side of a wall also lit the other side: the
   corridor's failing tube strobed straight through into the flats. Each point light can be
   given a room (an x/z box); the shader drops its contribution to any surface outside that
   box. Boxes are fed in the renderer's own light order every frame (see syncLightRooms). */
const LIGHT_BOX={min:{value:[]},max:{value:[]}}; for(let i=0;i<96;i++){ LIGHT_BOX.min.value.push(new THREE.Vector3(-1e6,0,-1e6)); LIGHT_BOX.max.value.push(new THREE.Vector3(1e6,0,1e6)); }
THREE.ShaderChunk.fog_pars_vertex+="\n#ifdef ROOM_POS\nvarying vec3 vRoomPos;\n#endif\n";
THREE.ShaderChunk.project_vertex+="\n#ifdef ROOM_POS\nvRoomPos=(modelMatrix*vec4(transformed,1.0)).xyz;\n#endif\n";
THREE.ShaderChunk.lights_pars_begin+="\n#ifdef ROOM_POS\nvarying vec3 vRoomPos;\n#if NUM_POINT_LIGHTS > 0\nuniform vec3 plBoxMin[ NUM_POINT_LIGHTS ];\nuniform vec3 plBoxMax[ NUM_POINT_LIGHTS ];\n#endif\n#endif\n";
{ const k="getPointDirectLightIrradiance( pointLight, geometry, directLight );", c=THREE.ShaderChunk.lights_fragment_begin;
  if(c.includes(k))THREE.ShaderChunk.lights_fragment_begin=c.replace(k,k+"\n#ifdef ROOM_POS\n\t\tdirectLight.color *= step( plBoxMin[ i ].x, vRoomPos.x ) * step( vRoomPos.x, plBoxMax[ i ].x ) * step( plBoxMin[ i ].z, vRoomPos.z ) * step( vRoomPos.z, plBoxMax[ i ].z );\n#endif\n");
  else console.warn("light rooms: shader hook not found; lights will not be bounded"); }
const _roomHook=sh=>{ sh.uniforms.plBoxMin=LIGHT_BOX.min; sh.uniforms.plBoxMax=LIGHT_BOX.max; };
{ const Phong=THREE.MeshPhongMaterial;
  THREE.MeshLambertMaterial=function(p){ const m=new Phong(p); m.specular.setHex(0x000000); m.shininess=1;
    m.defines={ROOM_POS:""}; m.onBeforeCompile=_roomHook; return m; }; }
const LIGHT_ROOMS={};   // zone -> [[x0,x1,z0,z1],...]
function syncLightRooms(){ let i=0; scene.traverseVisible(o=>{ if(!o.isPointLight||i>=96)return; const r=o.userData.room;
  if(r){ LIGHT_BOX.min.value[i].set(r[0],0,r[2]); LIGHT_BOX.max.value[i].set(r[1],0,r[3]); }
  else { LIGHT_BOX.min.value[i].set(-1e6,0,-1e6); LIGHT_BOX.max.value[i].set(1e6,0,1e6); } i++; }); }
function wetMat(m,amount=.5,shine=28){ m.specular.setScalar(amount); m.shininess=shine; return m; }

/* ---------------- Player settings (pause menu; kept in localStorage) ---------------- */
const SETTINGS=Object.assign({brightness:1,sens:1,volume:.8},(()=>{ try{ return JSON.parse(localStorage.getItem("noirSettings")||"{}"); }catch(e){ return {}; } })());
function saveSettings(){ try{ localStorage.setItem("noirSettings",JSON.stringify(SETTINGS)); }catch(e){} }

/* ---------------- Game timers ----------------
   Every scripted beat in the game goes through later()/cancelLater() so
   that (a) a timer that comes due while the pause menu is open is held and
   replayed, in order, on resume, and (b) loading a save can cancel everything
   still pending from the session being replaced. UI-only timers use uiTimeout. */
const uiTimeout=window.setTimeout.bind(window), _rawClear=window.clearTimeout.bind(window);
const gameTimers=new Map(); let _timerSeq=1, gamePaused=false, _pausedAt=0; let _held=[];
function _armTimer(tok,fn,ms){
  const due=performance.now()+ms;   // when it was MEANT to fire; a busy frame must not add its lateness to the replay
  gameTimers.set(tok,uiTimeout(()=>{
    if(gamePaused){ _held.push({tok,fn,due}); return; }
    gameTimers.delete(tok); fn(); },ms)); }
const later=(fn,ms)=>{ const tok=_timerSeq++; _armTimer(tok,fn,ms||0); return tok; };
const cancelLater=tok=>{ if(gameTimers.has(tok)){ _rawClear(gameTimers.get(tok)); gameTimers.delete(tok); }
  _held=_held.filter(h=>h.tok!==tok); };
function pauseGameTimers(){ if(gamePaused)return; gamePaused=true; _pausedAt=performance.now(); }
function resumeGameTimers(){ if(!gamePaused)return; gamePaused=false;
  const h=_held.sort((a,b)=>a.due-b.due); _held=[];
  for(const x of h)_armTimer(x.tok,x.fn,Math.max(0,x.due-_pausedAt)); }
function clearGameTimers(){ for(const id of gameTimers.values())_rawClear(id); gameTimers.clear(); _held=[]; }

/* ---------------- CONFIG (all tunables in one place) ---------------- */
const CFG={
  RW:320, RH:240,                 // internal render
  eye:1.6, radius:0.3, walk:2.5, run:3.9,
  ceilFlat:2.8, ceilHall:3.0,
  fogNear:3.5, fogFar:15,
  ambient:0.62, ambientColor:0x38404e,
  torch:{intensity:1.7,angle:0.44,dist:13,decay:1.4,drain:0.55,recharge:1.6,color:0xffe9c4},
  interactRange:2.6,
  code:"976345615",
  posterize:11.0
};

/* ---------------- Audio (procedural Web Audio) ---------------- */
const AU={ctx:null,master:null,rain:null,ringTimer:null,
  init(){ if(this.ctx)return; const C=window.AudioContext||window.webkitAudioContext; this.ctx=new C();
    this.master=this.ctx.createGain(); this.master.gain.value=SETTINGS.volume; this.master.connect(this.ctx.destination); this.startRain(); },
  noiseBuf(sec=2){ const b=this.ctx.createBuffer(1,this.ctx.sampleRate*sec,this.ctx.sampleRate); const d=b.getChannelData(0);
    for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1; return b; },
  startRain(){ const src=this.ctx.createBufferSource(); src.buffer=this.noiseBuf(3); src.loop=true;
    const lp=this.ctx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=900;
    const hp=this.ctx.createBiquadFilter(); hp.type="highpass"; hp.frequency.value=250;
    const g=this.ctx.createGain(); g.gain.value=.045;
    src.connect(hp);hp.connect(lp);lp.connect(g);g.connect(this.master); src.start(); this.rain=g;
    // low building hum
    const o=this.ctx.createOscillator(); o.type="sine"; o.frequency.value=48;
    const og=this.ctx.createGain(); og.gain.value=.02; o.connect(og);og.connect(this.master); o.start(); },
  blip(f,dur,type="sine",vol=.2,slide=0){ if(!this.ctx)return; const t=this.ctx.currentTime;
    const o=this.ctx.createOscillator(),g=this.ctx.createGain(); o.type=type; o.frequency.setValueAtTime(f,t);
    if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(20,f+slide),t+dur);
    g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    o.connect(g);g.connect(this.master); o.start(t); o.stop(t+dur+.02); },
  burst(dur=.08,f=800,vol=.3,q=2){ if(!this.ctx)return; const t=this.ctx.currentTime;
    const s=this.ctx.createBufferSource(); s.buffer=this.noiseBuf(dur+.05);
    const bp=this.ctx.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=f; bp.Q.value=q;
    const g=this.ctx.createGain(); g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    s.connect(bp);bp.connect(g);g.connect(this.master); s.start(t); s.stop(t+dur+.05); },
  step(run){ this.burst(.05,run?300:240,.10,1.2); },
  knock(){ this.burst(.06,180,.5,1.4); later(()=>this.burst(.06,170,.45,1.4),190); later(()=>this.burst(.06,160,.4,1.4),380); },
  rattle(){ this.burst(.15,700,.22,3); later(()=>this.burst(.12,650,.18,3),120); },
  paper(){ this.burst(.18,2600,.14,1); },
  creak(){ this.blip(160,1.1,"sawtooth",.05,-90); },
  thud(){ this.blip(90,.4,"sine",.5,-50); this.burst(.09,140,.35,1); },
  key(){ this.burst(.05,3200,.2,4); later(()=>this.burst(.05,2600,.16,4),90); },
  ringStart(){ if(this.ringTimer)return; const ring=()=>{ for(let i=0;i<9;i++){ later(()=>{this.blip(920,.05,"sine",.14); this.blip(650,.05,"sine",.14);},i*90);} };
    ring(); this.ringTimer=setInterval(ring,2400); },
  ringStop(){ clearInterval(this.ringTimer); this.ringTimer=null; },
  drone(){ if(!this.ctx)return; const t=this.ctx.currentTime;
    const o=this.ctx.createOscillator(),o2=this.ctx.createOscillator(),g=this.ctx.createGain();
    o.type="sawtooth";o.frequency.value=52; o2.type="sawtooth";o2.frequency.value=54.5;
    g.gain.setValueAtTime(.0001,t); g.gain.exponentialRampToValueAtTime(.10,t+1.5); g.gain.exponentialRampToValueAtTime(.0001,t+5);
    const lp=this.ctx.createBiquadFilter();lp.type="lowpass";lp.frequency.value=300;
    o.connect(lp);o2.connect(lp);lp.connect(g);g.connect(this.master); o.start(t);o2.start(t);o.stop(t+5.2);o2.stop(t+5.2); },
  dial(){ this.burst(.04,1400,.18,5); },
  dead(){ this.blip(420,.9,"square",.06); }
};

/* ---------------- Procedural textures (ps2ify: 256², nearest) ---------------- */
function tex(draw,size=256){
  const c=document.createElement("canvas"); c.width=c.height=size;
  const g=c.getContext("2d"); draw(g,size);
  const t=new THREE.CanvasTexture(c);
  t.magFilter=THREE.NearestFilter; t.minFilter=THREE.NearestFilter;
  t.wrapS=t.wrapT=THREE.RepeatWrapping; t.anisotropy=1;
  return t;
}
function grime(g,s,n,alpha,col="0,0,0"){ for(let i=0;i<n;i++){ const x=Math.random()*s,y=Math.random()*s,r=4+Math.random()*40;
  const rg=g.createRadialGradient(x,y,0,x,y,r); rg.addColorStop(0,`rgba(${col},${alpha})`); rg.addColorStop(1,`rgba(${col},0)`);
  g.fillStyle=rg; g.fillRect(x-r,y-r,r*2,r*2);} }
function speck(g,s,n,c){ g.fillStyle=c; for(let i=0;i<n;i++)g.fillRect(Math.random()*s,Math.random()*s,1+Math.random()*2,1+Math.random()*2); }

const TEX={};
TEX.wallpaper=tex((g,s)=>{ g.fillStyle="#6e6656";g.fillRect(0,0,s,s);
  for(let x=0;x<s;x+=32){ g.fillStyle=(x/32)%2?"#756c5b":"#685f4f"; g.fillRect(x,0,32,s); }
  g.fillStyle="rgba(120,105,80,.5)";
  for(let y=16;y<s;y+=48)for(let x=16;x<s;x+=32){ g.beginPath();g.arc(x,y,5,0,7);g.fill(); g.fillRect(x-1,y-10,2,6); }
  grime(g,s,26,.16); grime(g,s,8,.12,"60,45,20"); speck(g,s,140,"rgba(40,32,20,.4)");
  g.fillStyle="rgba(30,24,14,.35)"; g.fillRect(0,0,s,6); });
TEX.wallpaperOld=tex((g,s)=>{ g.fillStyle="#5d6062";g.fillRect(0,0,s,s);
  for(let x=0;x<s;x+=32){ g.fillStyle=(x/32)%2?"#63666a":"#585b5e"; g.fillRect(x,0,32,s); }
  g.fillStyle="rgba(110,115,125,.45)";
  for(let y=16;y<s;y+=48)for(let x=16;x<s;x+=32){ g.beginPath();g.arc(x,y,5,0,7);g.fill(); }
  // peeling strips
  for(let i=0;i<4;i++){ const x=Math.random()*s; g.fillStyle="#3f3a32"; g.fillRect(x,Math.random()*s*.4,10+Math.random()*14,60+Math.random()*120);
    g.fillStyle="rgba(200,195,180,.25)"; g.fillRect(x-2,Math.random()*s*.4,3,50);}
  grime(g,s,34,.2); speck(g,s,200,"rgba(30,28,24,.5)"); });
TEX.concrete=tex((g,s)=>{ g.fillStyle="#5a5b58";g.fillRect(0,0,s,s); speck(g,s,900,"rgba(70,72,68,.5)"); speck(g,s,500,"rgba(45,46,44,.5)");
  grime(g,s,20,.15); g.strokeStyle="rgba(35,36,34,.5)";
  for(let i=0;i<5;i++){ g.beginPath(); let x=Math.random()*s,y=0; g.moveTo(x,y);
    while(y<s){ y+=10+Math.random()*20; x+=(Math.random()-0.5)*22; g.lineTo(x,y);} g.stroke(); } });
TEX.woodFloor=tex((g,s)=>{ g.fillStyle="#5c4630";g.fillRect(0,0,s,s);
  for(let y=0;y<s;y+=32){ const off=(y/32)%2*64; g.fillStyle=`rgb(${86+Math.random()*16},${64+Math.random()*12},${42+Math.random()*8})`;
    g.fillRect(0,y,s,32); g.strokeStyle="rgba(30,20,10,.7)"; g.strokeRect(-1,y+.5,s+2,32);
    for(let x=off;x<s;x+=128){ g.beginPath();g.moveTo(x,y);g.lineTo(x,y+32);g.stroke(); } 
    g.strokeStyle="rgba(50,36,22,.4)"; for(let k=0;k<4;k++){ g.beginPath();g.moveTo(0,y+4+k*7+Math.random()*3);g.lineTo(s,y+4+k*7+Math.random()*3);g.stroke(); } }
  grime(g,s,14,.18); });
TEX.planksOld=tex((g,s)=>{ g.fillStyle="#4a3d2e";g.fillRect(0,0,s,s);
  for(let y=0;y<s;y+=36){ g.fillStyle=`rgb(${66+Math.random()*14},${56+Math.random()*10},${42+Math.random()*8})`;
    g.fillRect(0,y,s,36); g.strokeStyle="rgba(20,14,8,.8)"; g.strokeRect(-1,y+.5,s+2,36); }
  speck(g,s,300,"rgba(28,22,14,.5)"); grime(g,s,20,.22); });
TEX.tile=tex((g,s)=>{ g.fillStyle="#7b7f78";g.fillRect(0,0,s,s); g.strokeStyle="#4a4e48";
  for(let y=0;y<=s;y+=64)for(let x=0;x<=s;x+=64){ g.fillStyle=`rgb(${118+Math.random()*14},${122+Math.random()*12},${114+Math.random()*10})`;
    g.fillRect(x+2,y+2,60,60);} grime(g,s,24,.2); speck(g,s,120,"rgba(50,52,48,.5)"); });
TEX.ceiling=tex((g,s)=>{ g.fillStyle="#8a877c";g.fillRect(0,0,s,s); speck(g,s,600,"rgba(120,118,108,.4)");
  grime(g,s,10,.25,"90,72,40"); // water rings
  for(let i=0;i<4;i++){ const x=Math.random()*s,y=Math.random()*s; for(let r=14;r<50;r+=9){ g.strokeStyle="rgba(110,88,50,.28)"; g.beginPath();g.arc(x,y,r,0,7);g.stroke(); } } });
TEX.hallFloor=tex((g,s)=>{ g.fillStyle="#4f504c";g.fillRect(0,0,s,s); speck(g,s,900,"rgba(62,64,60,.6)"); speck(g,s,400,"rgba(38,39,37,.6)");
  grime(g,s,26,.2); g.strokeStyle="rgba(28,29,27,.6)";
  for(let i=0;i<7;i++){ g.beginPath(); let x=Math.random()*s,y=Math.random()*s; g.moveTo(x,y);
    for(let k=0;k<5;k++){x+=(Math.random()-.5)*60;y+=(Math.random()-.5)*60;g.lineTo(x,y);} g.stroke(); } });
TEX.doorWood=tex((g,s)=>{ g.fillStyle="#4e3a26";g.fillRect(0,0,s,s);
  g.strokeStyle="rgba(28,18,10,.6)"; for(let x=0;x<s;x+=8){ g.beginPath();g.moveTo(x+Math.random()*3,0);g.lineTo(x+Math.random()*3,s);g.stroke(); }
  g.strokeStyle="rgba(20,12,6,.9)"; g.lineWidth=4; g.strokeRect(30,24,s-60,s*.38); g.strokeRect(30,s*.5,s-60,s*.42); g.lineWidth=1; grime(g,s,10,.2); });
TEX.metal=tex((g,s)=>{ g.fillStyle="#6a6e70";g.fillRect(0,0,s,s);
  for(let y=0;y<s;y+=4){ g.fillStyle=`rgba(255,255,255,${.03+Math.random()*.04})`; g.fillRect(0,y,s,2);}
  grime(g,s,18,.25,"70,50,30"); speck(g,s,80,"rgba(120,80,40,.4)"); });
TEX.metroMetal=tex((g,s)=>{ g.fillStyle="#667078";g.fillRect(0,0,s,s);
  for(let y=0;y<s;y+=7){ g.fillStyle=`rgba(220,230,228,${.025+Math.random()*.035})`; g.fillRect(0,y,s,3); }
  for(let x=0;x<s;x+=42){ g.fillStyle="rgba(20,26,30,.16)"; g.fillRect(x,0,2,s); }
  grime(g,s,24,.22,"30,38,42"); speck(g,s,120,"rgba(190,180,150,.22)"); });
TEX.metroFloor=tex((g,s)=>{ g.fillStyle="#252b30";g.fillRect(0,0,s,s);
  for(let y=0;y<s;y+=28){ g.fillStyle="#30383b";g.fillRect(0,y,s,2); }
  for(let x=0;x<s;x+=32){ g.fillStyle="rgba(8,11,13,.28)";g.fillRect(x,0,2,s); }
  grime(g,s,32,.28); speck(g,s,180,"rgba(130,145,145,.18)"); });
TEX.runner=tex((g,s)=>{ g.fillStyle="#4a3230";g.fillRect(0,0,s,s); g.fillStyle="#57403a";
  g.fillRect(14,0,s-28,s); g.strokeStyle="#2e1f1c"; g.strokeRect(14,0,s-28,s);
  g.fillStyle="rgba(90,66,52,.5)"; for(let y=20;y<s;y+=42)g.fillRect(30,y,s-60,4); grime(g,s,20,.3); });
function plateTex(num){ return tex((g,s)=>{ g.fillStyle="#8a8064"; g.fillRect(0,0,s,s);
  g.strokeStyle="#3a3424"; g.lineWidth=10; g.strokeRect(8,8,s-16,s-16);
  g.fillStyle="#2e2818"; g.font="bold 92px 'Courier New'"; g.textAlign="center"; g.textBaseline="middle"; g.fillText(num,s/2,s/2+4); grime(g,s,8,.2); },128); }
TEX.photo=tex((g,s)=>{ // Thomas + Eileen, his face blurred to light
  g.fillStyle="#20242c"; g.fillRect(0,0,s,s);
  const sky=g.createLinearGradient(0,0,0,s); sky.addColorStop(0,"#3c4454");sky.addColorStop(.65,"#5a5648");sky.addColorStop(1,"#2c2a22");
  g.fillStyle=sky; g.fillRect(12,12,s-24,s-24);
  g.fillStyle="#23211c"; g.fillRect(12,s*.72,s-24,s*.28-12); // ledge
  // Eileen (left) — dark hair figure
  g.fillStyle="#191720"; g.beginPath(); g.ellipse(s*.38,s*.52,15,17,0,0,7); g.fill();
  g.fillRect(s*.38-18,s*.55,36,60); g.fillStyle="#0e0c12"; g.fillRect(s*.38-19,s*.4,10,52); g.fillRect(s*.38+9,s*.4,10,50);
  // Thomas (right) — face a blown-out light
  g.fillStyle="#2a2622"; g.fillRect(s*.6-16,s*.56,34,58);
  const glow=g.createRadialGradient(s*.62,s*.5,2,s*.62,s*.5,26); glow.addColorStop(0,"rgba(255,250,230,1)");glow.addColorStop(1,"rgba(255,250,230,0)");
  g.fillStyle=glow; g.fillRect(s*.62-28,s*.5-28,56,56);
  g.fillStyle="rgba(210,200,170,.16)"; g.fillRect(0,0,s,s); grime(g,s,10,.2,"120,100,60");
  g.strokeStyle="#d8d0bc"; g.lineWidth=10; g.strokeRect(5,5,s-10,s-10); });
TEX.noteSmall=tex((g,s)=>{ g.fillStyle="#cfc6ac"; g.fillRect(0,0,s,s); grime(g,s,8,.15,"120,100,60");
  g.strokeStyle="#6a5a3a"; for(let y=40;y<s;y+=28){g.beginPath();g.moveTo(24,y);g.lineTo(s-24,y+2);g.stroke();} },128);
TEX.bookRow=tex((g,s)=>{ g.fillStyle="#1c150e"; g.fillRect(0,0,s,s); let x=0;
  const cols=["#6a3a2e","#3a4a3e","#4a3a5a","#6a5a2e","#3a3a4e","#5a2e2e","#2e4a4a"];
  while(x<s){ const w=14+Math.random()*20,h=s*(.7+Math.random()*.28);
    g.fillStyle=cols[(Math.random()*cols.length)|0]; g.fillRect(x,s-h,w-3,h);
    g.fillStyle="rgba(0,0,0,.3)"; g.fillRect(x,s-h,2,h); x+=w; } },128);

/* ---------------- Three.js scene ---------------- */
const renderer=new THREE.WebGLRenderer({canvas:$("c"),antialias:false,preserveDrawingBuffer:true});
renderer.setPixelRatio(1);
const scene=new THREE.Scene();
scene.background=new THREE.Color(0x07070c);
scene.fog=new THREE.Fog(0x07070c,CFG.fogNear,CFG.fogFar);
const camera=new THREE.PerspectiveCamera(72,4/3,0.05,320);

/* ============ ZONE SYSTEM (full game) ============
   Environments live in separate groups at big world offsets; only the
   current zone's group is visible; colliders/interactables are zone-tagged. */
const ZONES={
  arrival: {ox:900,oz:0, bounds:[898.6,921.4,1.2,7.2], fog:[0x090b10,3,22], bg:0x090b10, rain:false},
  street:  {ox:-100,oz:0, bounds:[-101.7,-83.6,-1.7,29.7], fog:[0x0c0e16,7,62], bg:0x0a0c12, rain:true},
  dream1:  {ox: 100,oz:0, bounds:[ 98.4,101.6,-.6,23.6],   fog:[0x54565a,4,30], bg:0x54565a, rain:false},
  floor8:  {ox:   0,oz:0, bounds:[ .35,17.65,.35,8.85],    fog:[0x07070c,CFG.fogNear,CFG.fogFar], bg:0x07070c, rain:false},
  lobbyG:  {ox: 200,oz:0, bounds:[200.35,209.65,.35,5.65], fog:[0x07070c,3,24], bg:0x07070c, rain:false},
  alley:   {ox: 300,oz:0, bounds:[300.35,321.65,-3.65,5.65], fog:[0x0b0d14,5,44], bg:0x090b10, rain:true},
  restock: {ox: 400,oz:0, bounds:[400.35,409.65,.35,7.65], fog:[0x0a0908,2.5,18], bg:0x0a0908, rain:false},
  dream2:  {ox: 500,oz:0, bounds:[500.4,503.6,.4,45.6],    fog:[0x1a1c1e,3,16], bg:0x1a1c1e, rain:false},
  floor21: {ox: 600,oz:0, bounds:[600.35,617.65,.35,5.65], fog:[0x07070c,3,24], bg:0x07070c, rain:false},
  terrace: {ox: 700,oz:0, bounds:[700.4,719.6,.4,13.6],    fog:[0x05070c,4,32], bg:0x05070c, rain:true},
  metro:   {ox: 800,oz:0, bounds:[800.4,827.6,.4,9.6],     fog:[0x0b0d10,3,26], bg:0x0b0d10, rain:false},
};
const zoneGroups={}; let ZONE="floor8"; let curZone="floor8";
for(const k in ZONES){ zoneGroups[k]=new THREE.Group(); zoneGroups[k].visible=(k==="floor8"); zoneGroups[k].position.y=0; }
const _sceneAdd=scene.add.bind(scene);
scene.add=function(...o){ for(const m of o){ if(ZONE&&zoneGroups[ZONE])zoneGroups[ZONE].add(m); else _sceneAdd(m); } return scene; };
for(const k in ZONES)_sceneAdd(zoneGroups[k]);
function inZone(name,fn){ const p=ZONE; ZONE=name; fn(); ZONE=p; }
let onZoneEnter={}; // name -> fn fired after travel
function setZone(name){
  curZone=name;
  document.documentElement.dataset.zone=name;
  for(const k in zoneGroups)zoneGroups[k].visible=(k===name);
  const z=ZONES[name];
  player.floorY=(z.ground?z.ground(player.x,player.z):0)||0;
  scene.fog.color.setHex(z.fog[0]); scene.fog.near=z.fog[1]; baseFogFar=z.fog[2]; scene.fog.far=z.fog[2];
  scene.background.setHex(z.bg);
}
let baseFogFar=CFG.fogFar;
/* fade + travel */
let travelLock=false;
function fadeTo(cb,ms){ ms=ms||700; const f=$("fader"); f.style.transition=`opacity ${ms}ms`; f.style.opacity=1;
  later(()=>{ cb&&cb(); f.style.opacity=0; },ms+60); }
/* The thing the player just used. If it was a door (or the lift), travel() opens
   it under the fade, so a zone change reads as walking through rather than a cut. */
let usedMesh=null; const swings=[];
function swingTick(dt){ for(const s of swings){ s.t+=dt; const k=Math.min(1,s.t/.55), e=k*k*(3-2*k);
  if(s.leaves){ s.leaves[0].position.x=s.base[0]-e*.52; s.leaves[1].position.x=s.base[1]+e*.52; }
  else s.o.rotation.y=s.base-e*1.25; } }
function travel(zone,x,z,yaw,cb){ if(travelLock)return; travelLock=true;
  const used=usedMesh; usedMesh=null; let shut=null;
  if(used&&used.userData.isDoor){ const base=used.rotation.y; swings.push({o:used,base,t:0}); try{AU.creak();}catch(e){}
    shut=()=>{ used.rotation.y=base; }; }
  else if(used&&used.userData.leaves){ const L=used.userData.leaves, base=[L[0].position.x,L[1].position.x]; swings.push({leaves:L,base,t:0});
    shut=()=>{ L[0].position.x=base[0]; L[1].position.x=base[1]; }; }
  fadeTo(()=>{ swings.length=0; shut&&shut(); setZone(zone); player.x=x; player.z=z; if(yaw!==undefined)player.yaw=yaw; player.pitch=0;
    player.floorY=(ZONES[zone].ground?ZONES[zone].ground(x,z):0)||0;
    travelLock=false; onZoneEnter[zone]&&onZoneEnter[zone](); cb&&cb(); autosaveCheckpoint(); },700); }
/* scripted sequence runner: seq([[msFromPrev,fn],...]) */
function seq(steps){ let t=0; const ids=[]; for(const [d,fn] of steps){ t+=d; ids.push(later(fn,t)); } return ids; }

_sceneAdd(new THREE.AmbientLight(CFG.ambientColor,CFG.ambient));
const hemi=new THREE.HemisphereLight(0x40485a,0x1a160f,0.25); _sceneAdd(hemi);

/* PS2 post: low-res RT → posterize + Bayer8 + vignette + scanline + dread warp */
const rt=new THREE.WebGLRenderTarget(CFG.RW,CFG.RH,{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
const postScene=new THREE.Scene();
const postCam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
const postMat=new THREE.ShaderMaterial({
  uniforms:{tDiffuse:{value:rt.texture},res:{value:new THREE.Vector2(CFG.RW,CFG.RH)},time:{value:0},dread:{value:0},gain:{value:SETTINGS.brightness},levels:{value:CFG.posterize}},
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
  fragmentShader:`
    varying vec2 vUv; uniform sampler2D tDiffuse; uniform vec2 res; uniform float time,dread,levels,gain;
    float B2(vec2 a){a=floor(a);return fract(a.x/2.+a.y*a.y*.75);}
    float B4(vec2 a){return B2(.5*a)*.25+B2(a);}
    float B8(vec2 a){return B4(.5*a)*.25+B4(a);}
    void main(){
      vec2 uv=vUv;
      uv.x+=sin(uv.y*38.+time*3.1)*.002*dread;
      uv.y+=sin(uv.x*22.+time*2.3)*.0012*dread;
      vec2 px=floor(uv*res);
      vec3 c=texture2D(tDiffuse,(px+.5)/res).rgb;
      float d=B8(px);
      // quantise in sqrt space: the same number of levels, but spent where the
      // game lives (the darks), so shadows gradate instead of cross-hatching to black
      c=sqrt(max(c*1.1*gain+.004*gain,0.));
      c=floor(c*(levels-1.)+d)/(levels-1.);
      c*=c;
      // color bleed with dread
      vec3 cb=texture2D(tDiffuse,(px+vec2(1.5,0.))/res).rgb;
      c=mix(c,vec3(cb.r,c.g,c.b),dread*.35);
      // vignette
      float v=distance(vUv,vec2(.5));
      c*=smoothstep(.95,.35-.18*dread,v)*.92+.08;
      // scanlines
      c*=.94+.06*sin(px.y*3.14159);
      gl_FragColor=vec4(c,1.);
    }`});
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),postMat));
function onResize(){ renderer.setSize(innerWidth,innerHeight);
  // 240 lines always; the column count follows the window so pixels stay square
  // (4:3 → 320 wide, 16:9 → 426, capped at 21:9 so ultrawide doesn't fish-eye).
  const aspect=Math.max(1,Math.min(21/9,innerWidth/Math.max(1,innerHeight)));
  const rw=Math.round(CFG.RH*aspect);
  rt.setSize(rw,CFG.RH); postMat.uniforms.res.value.set(rw,CFG.RH);
  // Hold the HORIZONTAL field of view near 92 degrees. Keeping the old 72-degree vertical FOV on a
  // widescreen window gave ~115 degrees across, which shrank everything and made rooms feel like dollhouses.
  camera.fov=Math.max(50,Math.min(72,2*Math.atan(Math.tan(.8)/aspect)*180/Math.PI));
  camera.aspect=aspect; camera.updateProjectionMatrix(); }
addEventListener("resize",onResize); onResize();

/* ---------------- Materials with texel density ---------------- */
function surf(t,w,h,tile,tint){ // clone texture, repeat = dim/tile (uniform texel density per docs)
  const tx=t.clone(); tx.needsUpdate=true; tx.repeat.set(Math.max(.5,w/tile),Math.max(.5,h/tile));
  tx.offset.set(Math.random(),Math.random());
  const m=new THREE.MeshLambertMaterial({map:tx}); if(tint)m.color=new THREE.Color(tint); return m;
}
const colliders=[]; // {minX,maxX,minZ,maxZ,door?}
function addCollider(x,z,w,d,tag){ const c={minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2,tag,on:true,zone:ZONE}; colliders.push(c); return c; }
function box(w,h,d,mat){ return new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat); }

/* wall builder: axis 'x' (runs along x) or 'z'; from a to b at fixed other coord; gaps = [[start,end]] */
function wall(axis,a,b,fixed,h,y0,mat,tile,thick=0.16,gaps=[]){
  const segs=[]; let cur=a;
  const sorted=gaps.slice().sort((p,q)=>p[0]-q[0]);
  for(const gp of sorted){ if(gp[0]>cur)segs.push([cur,gp[0]]); cur=Math.max(cur,gp[1]); }
  if(cur<b)segs.push([cur,b]);
  for(const [s,e] of segs){ const len=e-s; if(len<=0.01)continue;
    const m=box(axis==="x"?len:thick,h,axis==="x"?thick:len, surf(mat,len,h,tile));
    if(axis==="x"){ m.position.set((s+e)/2,y0+h/2,fixed); addCollider((s+e)/2,fixed,len,thick); }
    else{ m.position.set(fixed,y0+h/2,(s+e)/2); addCollider(fixed,(s+e)/2,thick,len); }
    scene.add(m); }
  // lintels over gaps
  for(const gp of sorted){ const len=gp[1]-gp[0], lh=h-2.05; if(lh<=0.02)continue;
    const m=box(axis==="x"?len:thick,lh,axis==="x"?thick:len,surf(mat,len,lh,tile));
    if(axis==="x")m.position.set((gp[0]+gp[1])/2,y0+2.05+lh/2,fixed); else m.position.set(fixed,y0+2.05+lh/2,(gp[0]+gp[1])/2);
    scene.add(m); }
}
function floorPlane(x,z,w,d,t,tile,tint){ const m=new THREE.Mesh(new THREE.PlaneGeometry(w,d),surf(t,w,d,tile,tint));
  m.rotation.x=-Math.PI/2; m.position.set(x,0.001,z); scene.add(m); return m; }
function ceilPlane(x,z,w,d,h){ const m=new THREE.Mesh(new THREE.PlaneGeometry(w,d),surf(TEX.ceiling,w,d,1.4));
  m.rotation.x=Math.PI/2; m.position.set(x,h,z); scene.add(m); }
function baseboard(axis,a,b,fixed,inward){ const len=b-a; const m=box(axis==="x"?len:0.03,0.15,axis==="x"?0.03:len,new THREE.MeshLambertMaterial({color:0x2e2318}));
  if(axis==="x")m.position.set((a+b)/2,0.075,fixed+inward*0.10); else m.position.set(fixed+inward*0.10,0.075,(a+b)/2); scene.add(m); }

/* ---------------- Interactables ---------------- */
const interactables=[]; const ray=new THREE.Raycaster(); ray.far=CFG.interactRange;
function interact(mesh,prompt,fn,opts={}){ const e={mesh,prompt,fn,enabled:true,zone:ZONE,...opts};
  mesh.traverse?mesh.traverse(o=>o.userData.ix=e):(mesh.userData.ix=e); mesh.userData.ix=e; interactables.push(e); return e; }

/* ---------------- Props (own models, built from primitives) ---------------- */
const M={
  wood:new THREE.MeshLambertMaterial({color:0x5a4028}),
  woodDark:new THREE.MeshLambertMaterial({color:0x3c2c1a}),
  woodPale:new THREE.MeshLambertMaterial({color:0x7a6448}),
  cloth:new THREE.MeshLambertMaterial({color:0x4a4438}),
  clothCold:new THREE.MeshLambertMaterial({color:0x565a5e}),
  metal:new THREE.MeshLambertMaterial({color:0x5c6062}),
  metalDark:new THREE.MeshLambertMaterial({color:0x33383a}),
  white:new THREE.MeshLambertMaterial({color:0x9a9a90}),
  paper:new THREE.MeshLambertMaterial({map:TEX.noteSmall}),
  black:new THREE.MeshBasicMaterial({color:0x030304}),
  cardboard:new THREE.MeshLambertMaterial({color:0x554634}),
  phone:new THREE.MeshLambertMaterial({color:0x2a2e2a}),
};
const lam=(c,o)=>new THREE.MeshLambertMaterial(Object.assign({color:c},o||{}));
const rod=(rt,rb,h,seg,mat)=>new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg),mat);
function put(g,m,x,y,z,rx=0,ry=0,rz=0){ m.position.set(x,y,z); m.rotation.set(rx,ry,rz); g.add(m); return m; }
M.brass=wetMat(lam(0x9a7a3a),.6,40); M.chrome=wetMat(lam(0x8a9096),.8,60); M.enamel=wetMat(lam(0xa8aaa0),.25,20);
M.rubber=lam(0x0c0d0e); M.glassDark=wetMat(lam(0x0e1418),.9,80);
function group(...meshes){ const g=new THREE.Group(); meshes.forEach(m=>g.add(m)); return g; }
function at(m,x,y,z,ry=0){ m.position.set(x,y,z); m.rotation.y=ry; scene.add(m); return m; }

function mkChair(){ const g=group();
  put(g,box(.44,.04,.42,M.wood),0,.45,0);
  put(g,box(.38,.03,.36,M.cloth),0,.485,0);                                   // worn seat pad
  for(const[a,b]of[[-.18,-.18],[.18,-.18],[-.18,.18],[.18,.18]])put(g,rod(.022,.028,.45,6,M.woodDark),a,.225,b);
  for(const a of[-.18,.18])put(g,box(.035,.56,.035,M.woodDark),a,.75,-.19,-.08);          // back posts
  put(g,box(.42,.07,.03,M.wood),0,.98,-.215,-.08);                             // top rail
  for(const a of[-.1,0,.1])put(g,box(.035,.42,.018,M.wood),a,.74,-.2,-.08);   // slats
  put(g,box(.36,.025,.025,M.woodDark),0,.2,.18);
  for(const a of[-.18,.18])put(g,box(.025,.025,.36,M.woodDark),a,.16,0);
  return g; }
function mkTable(w=.9,d=.6,h=.72,mat=M.wood){ const g=group();
  put(g,box(w,.05,d,mat),0,h,0);
  put(g,box(w-.1,.09,.025,M.woodDark),0,h-.07,d/2-.07); put(g,box(w-.1,.09,.025,M.woodDark),0,h-.07,-(d/2-.07));   // apron
  put(g,box(.025,.09,d-.1,M.woodDark),w/2-.07,h-.07,0); put(g,box(.025,.09,d-.1,M.woodDark),-(w/2-.07),h-.07,0);
  for(const[a,b]of[[-1,-1],[1,-1],[-1,1],[1,1]])put(g,rod(.03,.022,h,6,M.woodDark),a*(w/2-.06),h/2,b*(d/2-.06));
  return g; }
function mkShelf(full){ const g=group();
  const woodM=new THREE.MeshLambertMaterial({map:TEX.doorWood});
  // carcass: two sides, top, bottom, back — open front
  const side=(x)=>{ const s=box(.04,1.9,.32,woodM); s.position.set(x,.95,0); g.add(s); };
  side(-.45); side(.45);
  const top=box(.94,.05,.32,woodM); top.position.set(0,1.9,0); g.add(top);
  const bot=box(.94,.05,.32,woodM); bot.position.set(0,.02,0); g.add(bot);
  const back=box(.9,1.9,.02,new THREE.MeshLambertMaterial({color:0x241a10})); back.position.set(0,.95,-.15); g.add(back);
  // 4 shelves + books
  const bookCols=[0x6a2a22,0x2a3a5a,0x3a5a2a,0x7a6a2a,0x4a2a4a,0x5a4a3a,0x2a4a4a,0x8a4a2a];
  for(let i=0;i<4;i++){ const y=.15+i*.44;
    const sh=box(.9,.03,.3,woodM); sh.position.set(0,y,0); g.add(sh);
    const rowFull = full || (i<1) || (i===1 && Math.random()<.5);
    if(rowFull){ let x=-.4; while(x<.4){ const w=.03+Math.random()*.05, h=.28+Math.random()*.1;
      const bk=box(w,h,.22,new THREE.MeshLambertMaterial({color:bookCols[(Math.random()*bookCols.length)|0]}));
      bk.position.set(x+w/2,y+.03+h/2,0); bk.rotation.z=(Math.random()<.12?.18:0); g.add(bk); x+=w+.006; }
      // a couple leaning + a lying book
      const lie=box(.18,.04,.24,new THREE.MeshLambertMaterial({color:bookCols[(Math.random()*bookCols.length)|0]}));
      lie.position.set(.24,y+.055,0); g.add(lie);
    } }
  return g; }
function mkBed(stripped){ const g=group();
  for(const[a,b]of[[-.48,-.95],[.48,-.95],[-.48,.95],[.48,.95]])put(g,box(.08,.3,.08,M.woodDark),a,.15,b);
  put(g,box(1.05,.14,2.0,M.woodDark),0,.26,0);                                 // rails
  put(g,box(1.0,.17,1.9,stripped?M.clothCold:M.cloth),0,.415,0);               // mattress
  put(g,box(1.02,.02,1.92,lam(stripped?0x4a4e52:0x3e3a30)),0,.335,0);          // piping seam
  if(stripped){ for(const z of[-.6,0,.6])put(g,box(1.0,.004,.03,lam(0x3c4044)),0,.502,z);      // bare ticking stripes
    put(g,box(.5,.05,.4,lam(0x6a6c66)),.1,.525,.6,0,.3,0); }                   // one folded sheet, left behind
  else { put(g,box(1.02,.045,1.2,lam(0x3c4438)),0,.52,.34);
    put(g,box(.56,.05,1.0,lam(0x36402e)),.24,.535,.3,0,.07,0);                 // slept one side only
    put(g,box(.5,.03,.5,lam(0x444c40)),-.2,.55,.1,0,-.2,.04);                  // thrown-back fold
    put(g,box(.44,.09,.3,M.white),-.24,.54,-.75,0,.06,0); put(g,box(.3,.03,.2,lam(0x86867c)),-.24,.59,-.75,0,.06,0);
    put(g,box(.44,.06,.3,lam(0x7c7c72)),.26,.525,-.76); }                       // her pillow, flat, unused
  put(g,box(1.05,.62,.05,M.woodDark),0,.62,-1.0);                              // headboard
  for(const a of[-.5,.5])put(g,box(.07,1.0,.07,M.woodDark),a,.5,-1.0);
  put(g,box(1.12,.05,.09,M.wood),0,.96,-1.0);
  put(g,box(1.05,.3,.05,M.woodDark),0,.42,1.0);                                // footboard
  return g; }
function mkWardrobe(open){ const g=group();
  const woodM=new THREE.MeshLambertMaterial({map:TEX.doorWood});
  const woodD=M.woodDark;
  // carcass (hollow-looking): sides, top, bottom, back
  const side=(x)=>{ const s=box(.05,2.0,.62,woodM); s.position.set(x,1.0,0); g.add(s); };
  side(-.66); side(.66);
  const top=box(1.37,.07,.62,woodM); top.position.set(0,2.0,0); g.add(top);
  const cornice=box(1.45,.06,.7,woodD); cornice.position.set(0,2.05,0); g.add(cornice);
  const bot=box(1.37,.07,.62,woodM); bot.position.set(0,.05,0); g.add(bot);
  const back=box(1.3,1.95,.02,new THREE.MeshLambertMaterial({color:0x201810})); back.position.set(0,1.0,-.3); g.add(back);
  // feet
  for(const fx of[-.55,.55])for(const fz of[-.24,.24]){ const ft=box(.08,.12,.08,woodD); ft.position.set(fx,.06,fz); g.add(ft); }
  // clothes rail + a few hanging garments (visible when open)
  const rail=new THREE.Mesh(new THREE.CylinderGeometry(.015,.015,1.2,6),M.metal); rail.rotation.z=Math.PI/2; rail.position.set(0,1.7,-.05); g.add(rail);
  const garМ=[0x2a2620,0x1a2028,0x3a2a22,0x24201a];
  const paneled=(dx,w)=>{ const d=box(w,1.85,.04,woodM);
    const p1=box(w-.14,.7,.02,woodD); p1.position.set(0,.42,.03); d.add(p1);
    const p2=box(w-.14,.7,.02,woodD); p2.position.set(0,-.42,.03); d.add(p2);
    const kn=new THREE.Mesh(new THREE.SphereGeometry(.03,8,8),M.metalDark); kn.position.set(dx>0?-(w/2-.08):(w/2-.08),0,.05); d.add(kn);
    return d; };
  if(open){
    // hanging garments
    for(let i=0;i<4;i++){ const gm=box(.24,.7,.08,new THREE.MeshLambertMaterial({color:garМ[i]})); gm.position.set(-.4+i*.26,1.28,-.05); gm.rotation.z=(Math.random()-.5)*.1; g.add(gm); }
    // left door swung open
    const dl=paneled(-1,.64); dl.position.set(-.66,1.0,.3); dl.rotation.y=1.15; g.add(dl);
    const dr=paneled(1,.64); dr.position.set(.66,1.0,.3); dr.rotation.y=-1.15; g.add(dr);
  } else {
    const dl=paneled(-1,.64); dl.position.set(-.33,1.0,.31); g.add(dl);
    const dr=paneled(1,.64); dr.position.set(.33,1.0,.31); g.add(dr);
  }
  return g; }
function mkNightstand(){ const g=group();
  put(g,box(.45,.46,.43,M.wood),0,.32,0);
  put(g,box(.5,.03,.47,M.woodDark),0,.565,0);
  for(const[a,b]of[[-.19,-.18],[.19,-.18],[-.19,.18],[.19,.18]])put(g,box(.04,.1,.04,M.woodDark),a,.05,b);
  for(const y of[.43,.23]){ put(g,box(.38,.16,.02,M.woodDark),0,y,.222); put(g,rod(.016,.016,.03,6,M.brass),0,y,.24,Math.PI/2); }
  return g; }
function mkFridge(){ const g=group(); const en=wetMat(lam(0x8a8e84),.3,18);
  put(g,box(.72,1.66,.58,en),0,.87,-.01);
  put(g,box(.7,.44,.03,en),0,1.46,.295); put(g,box(.7,1.12,.03,en),0,.64,.295);           // freezer + fridge doors
  put(g,box(.74,.025,.6,M.metalDark),0,1.215,0);                                           // gasket line
  put(g,box(.035,.3,.045,M.chrome),.29,1.44,.33); put(g,box(.035,.5,.045,M.chrome),.29,.9,.33);
  put(g,box(.66,.05,.5,M.metalDark),0,.025,0);                                             // kick grille
  for(let i=0;i<5;i++)put(g,box(.1,.012,.02,M.black),-.24+i*.12,.03,.26);
  put(g,box(.5,.03,.3,M.metalDark),0,1.715,-.1);                                           // dust on the coil cover
  put(g,box(.2,.16,.004,lam(0x4a4840)),-.12,.9,.312,0,0,-.06);                             // rust bloom
  return g; }
function mkStove(){ const g=group();
  put(g,box(.62,.86,.6,M.enamel),0,.45,0);
  put(g,box(.62,.035,.62,M.metalDark),0,.9,0);
  put(g,box(.62,.2,.03,M.enamel),0,1.0,-.29);                                              // splashback
  put(g,box(.5,.44,.02,lam(0x1c1c1a)),0,.42,.305); put(g,box(.36,.24,.012,M.glassDark),0,.44,.316);   // oven door + window
  put(g,box(.44,.03,.035,M.chrome),0,.69,.33);
  for(let i=0;i<4;i++)put(g,rod(.022,.022,.03,8,M.black),-.21+i*.14,.8,.31,Math.PI/2);    // knobs
  for(const[a,c]of[[-.15,-.13],[.15,-.13],[-.15,.15],[.15,.15]]){ put(g,rod(.09,.09,.012,10,M.black),a,.922,c);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(.065,.012,4,10),M.metalDark); put(g,ring,a,.932,c,Math.PI/2); }
  for(const a of[-.27,.27])for(const c of[-.26,.26])put(g,box(.05,.04,.05,M.black),a,.02,c);
  return g; }
function mkCounterSink(len){ const g=group();
  put(g,box(len,.8,.6,M.woodPale),0,.48,0); put(g,box(len-.04,.08,.5,M.black),0,.04,-.03);   // carcass on a recessed plinth
  put(g,box(len+.03,.04,.64,M.chrome),0,.92,0);
  const n=Math.max(2,Math.round(len/.5)), dw=(len-.06)/n;
  for(let i=0;i<n;i++){ const x=-len/2+.03+dw*(i+.5);
    put(g,box(dw-.03,.52,.018,M.wood),x,.4,.305); put(g,box(dw-.03,.14,.018,M.wood),x,.78,.305);   // door + drawer front
    put(g,box(.09,.014,.02,M.chrome),x,.78,.325); put(g,box(.014,.09,.02,M.chrome),x+(i%2?-1:1)*(dw/2-.07),.56,.325); }
  put(g,box(.5,.012,.38,M.metalDark),0,.943,.02); put(g,box(.44,.1,.32,lam(0x14171a)),0,.895,.02);   // basin, sunk
  put(g,rod(.016,.02,.22,6,M.chrome),0,1.05,-.2); put(g,rod(.014,.014,.16,6,M.chrome),0,1.15,-.13,Math.PI/2);
  put(g,rod(.012,.012,.05,6,M.chrome),0,1.125,-.055);
  for(const a of[-.09,.09])put(g,rod(.02,.02,.03,6,M.chrome),a,.955,-.2);
  put(g,box(len,.3,.02,lam(0x767a70)),0,1.1,-.31);                                         // tiled upstand
  return g; }
function mkRadiator(){ const g=group();
  for(let i=0;i<9;i++)put(g,box(.065,.52,.14,M.enamel),-.36+i*.09,.33,0);
  put(g,box(.82,.03,.16,M.metal),0,.6,0);
  put(g,rod(.02,.02,.9,6,M.metalDark),0,.1,0,0,0,Math.PI/2);
  for(const a of[-.4,.4])put(g,box(.04,.1,.06,M.metalDark),a,.05,0);
  put(g,rod(.03,.03,.05,6,M.brass),.45,.12,0,0,0,Math.PI/2);
  return g; }
function mkPhone(){ const g=group();
  put(g,box(.24,.05,.2,M.phone),0,.025,0); put(g,box(.2,.05,.16,M.phone),0,.07,-.01,-.18);  // wedge body
  for(const a of[-.07,.07])put(g,box(.035,.035,.07,M.phone),a,.1,-.05);                     // cradle
  put(g,box(.2,.03,.04,M.phone),0,.125,-.05);                                               // handset bar
  for(const a of[-.095,.095])put(g,rod(.028,.024,.04,8,M.phone),a,.11,-.05);                // ear + mouth cups
  put(g,rod(.062,.062,.012,12,lam(0x8a8478)),0,.082,.045,-.18);
  put(g,rod(.03,.03,.014,10,lam(0x2a2e2a)),0,.089,.046,-.18);
  for(let i=0;i<10;i++){ const a=.6+i*.52; put(g,rod(.008,.008,.016,5,M.black),Math.cos(a)*.046,.088-Math.sin(a)*.008,.045+Math.sin(a)*.046,-.18); }
  put(g,rod(.006,.006,.2,4,M.black),-.13,.012,.06,Math.PI/2,0,.5);                          // cord
  return g; }
/* ── prop makers: platform/street/corridor furniture (PS2-era readable silhouettes) ── */
function mkBench(){ const g=group(); const wood=new THREE.MeshLambertMaterial({map:TEX.doorWood});
  for(let i=0;i<3;i++)put(g,box(1.7,.045,.125,wood),0,.46,-.13+i*.14);
  for(let i=0;i<2;i++)put(g,box(1.7,.125,.04,wood),0,.64+i*.17,.21+i*.02,-.2);
  for(const lx of[-.76,0,.76]){                                                             // cast-iron frames
    put(g,box(.06,.44,.06,M.metalDark),lx,.22,-.17); put(g,box(.06,.44,.06,M.metalDark),lx,.22,.17);
    put(g,box(.06,.04,.46,M.metalDark),lx,.43,0); put(g,box(.05,.56,.05,M.metalDark),lx,.7,.23,-.2);
    put(g,box(.09,.02,.48,M.metalDark),lx,.01,0); }
  for(const lx of[-.82,.82]){ put(g,box(.05,.2,.05,M.metalDark),lx,.56,-.17); put(g,box(.05,.035,.42,M.metalDark),lx,.66,0); }   // armrests
  return g; }
function mkVending(on=true){ const g=group();
  const body=box(.9,1.8,.6,surf(TEX.metroMetal,.9,1.8,.55,on?0x63362e:0x3a3030)); body.position.y=.9; g.add(body);
  const face=tex((gg,s)=>{ gg.fillStyle="#160d0a"; gg.fillRect(0,0,s,s);
    for(let r=0;r<4;r++)for(let c=0;c<3;c++){ gg.fillStyle=["#8a3a2a","#3a5a6a","#6a6a3a","#5a3a5a"][(r+c)%4];
      gg.globalAlpha=.85; gg.fillRect(14+c*34,14+r*36,26,28); } gg.globalAlpha=1;
    gg.fillStyle="#0c0a08"; gg.fillRect(0,s-40,s,40); gg.fillStyle="#c8b070"; gg.font="bold 15px Courier New"; gg.fillText("D R I N K",10,s-16);
    grime(gg,s,9,.4); },128);
  const fp=new THREE.Mesh(new THREE.PlaneGeometry(.72,1.5),on?new THREE.MeshBasicMaterial({map:face}):new THREE.MeshLambertMaterial({map:face,color:0x858078}));
  fp.position.set(0,1.0,.31); g.add(fp);
  const slot=box(.3,.1,.04,M.metalDark); slot.position.set(0,.32,.31); g.add(slot);
  const coin=box(.08,.14,.035,M.metal); coin.position.set(.25,.58,.32); g.add(coin);
  const shelf=box(.68,.035,.04,M.metalDark); shelf.position.set(0,.83,.325); g.add(shelf);
  if(on){ const gl2=new THREE.PointLight(0x9ab0c0,.95,5,1.5); gl2.position.set(0,1.0,.62); g.add(gl2); } return g; }
function mkWallClock(h,m,dead=true){ const face=tex((g2,s)=>{ g2.clearRect(0,0,s,s);
  g2.fillStyle="#d8d2c0"; g2.beginPath(); g2.arc(s/2,s/2,s*.47,0,7); g2.fill();
  g2.strokeStyle="#26221c"; g2.lineWidth=7; g2.stroke(); g2.fillStyle="#26221c";
  for(let i=0;i<12;i++){ const a=i/12*Math.PI*2; g2.fillRect(s/2+Math.sin(a)*s*.38-2,s/2-Math.cos(a)*s*.38-2,5,5); }
  const ah=(h%12)/12*Math.PI*2+m/60*(Math.PI/6), am=m/60*Math.PI*2;
  g2.strokeStyle="#22201a"; g2.lineWidth=8; g2.beginPath(); g2.moveTo(s/2,s/2); g2.lineTo(s/2+Math.sin(ah)*s*.2,s/2-Math.cos(ah)*s*.2); g2.stroke();
  g2.lineWidth=4; g2.beginPath(); g2.moveTo(s/2,s/2); g2.lineTo(s/2+Math.sin(am)*s*.33,s/2-Math.cos(am)*s*.33); g2.stroke();
  if(dead){ g2.fillStyle="rgba(80,70,52,.22)"; g2.fillRect(0,0,s,s); } },128);
  const g=group(); const rim=new THREE.Mesh(new THREE.CylinderGeometry(.2,.2,.06,16),M.metalDark); rim.rotation.x=Math.PI/2; g.add(rim);
  const fp=new THREE.Mesh(new THREE.CircleGeometry(.175,16),new THREE.MeshLambertMaterial({map:face,transparent:true})); fp.position.z=.035; g.add(fp); return g; }
function mkSedan(){ const g=group(); const bodyM=wetMat(lam(0x2c3438),.55,36), glassM=M.glassDark, trim=wetMat(lam(0x15181a),.4,30);
  put(g,box(4.2,.46,1.7,bodyM),0,.6,0);                                                     // sill-to-beltline slab
  put(g,box(1.25,.1,1.62,bodyM),1.42,.86,0,0,0,-.05); put(g,box(1.0,.1,1.62,bodyM),-1.58,.86,0,0,0,.04);   // bonnet + boot lid
  put(g,box(1.9,.46,1.5,bodyM),-.12,1.08,0);                                                // greenhouse
  put(g,box(1.7,.04,1.4,bodyM),-.12,1.33,0);
  put(g,box(.05,.5,1.44,glassM),.93,1.04,0,0,0,.52); put(g,box(.05,.5,1.44,glassM),-1.17,1.04,0,0,0,-.58);
  for(const sz of[-.76,.76]){ put(g,box(.84,.34,.02,glassM),.33,1.09,sz); put(g,box(.84,.34,.02,glassM),-.58,1.09,sz);
    put(g,box(.05,.4,.03,bodyM),-.12,1.08,sz); put(g,box(.12,.07,.1,trim),.95,.96,sz*1.12);          // B-pillar, mirror
    put(g,box(.12,.03,.02,M.chrome),.3,.78,sz*1.125); put(g,box(.12,.03,.02,M.chrome),-.6,.78,sz*1.125); }   // door handles
  for(const [wx,wz] of[[-1.4,-.82],[1.4,-.82],[-1.4,.82],[1.4,.82]]){
    put(g,rod(.31,.31,.2,12,M.rubber),wx,.31,wz,Math.PI/2); put(g,rod(.17,.17,.21,8,lam(0x54585a)),wx,.31,wz,Math.PI/2);
    put(g,box(.78,.1,.06,trim),wx,.64,wz*1.04); }                                           // arch lip
  put(g,box(4.34,.14,1.76,trim),0,.38,0);                                                   // bumpers + sill
  put(g,box(.04,.2,1.0,trim),2.11,.62,0);                                                   // grille
  for(const hz of[-.62,.62]){ put(g,box(.03,.13,.26,new THREE.MeshBasicMaterial({color:0x4a463a})),2.115,.68,hz);
    put(g,box(.03,.1,.3,new THREE.MeshBasicMaterial({color:0x5a1410})),-2.115,.7,hz); }      // dead headlamps, dull tail-lamps
  put(g,box(.02,.1,.34,lam(0x8a8a78)),-2.12,.5,0);                                          // plate
  return g; }
function mkPhoneBooth(){ const g=group(); const fr=new THREE.MeshLambertMaterial({color:0x35424a});
  for(const [cx,cz] of[[-.42,-.42],[.42,-.42],[-.42,.42],[.42,.42]]){ const p=box(.08,2.3,.08,fr); p.position.set(cx,1.15,cz); g.add(p); }
  const roof=box(1.02,.1,1.02,fr); roof.position.y=2.33; g.add(roof);
  const base=box(1.0,.08,1.0,fr); base.position.y=.04; g.add(base);
  const glass=new THREE.MeshLambertMaterial({color:0x141c20,transparent:true,opacity:.65,side:THREE.DoubleSide});
  for(const rp of[[0,-.44,0],[-.44,0,Math.PI/2],[.44,0,Math.PI/2]]){ const pane=new THREE.Mesh(new THREE.PlaneGeometry(.8,1.9),glass);
    pane.position.set(rp[0],1.22,rp[1]); pane.rotation.y=rp[2]; g.add(pane); }
  const shelf=box(.34,.05,.42,M.metalDark); shelf.position.set(0,1.0,-.32); g.add(shelf);
  const ph=mkPhone(); ph.position.set(0,1.03,-.3); g.add(ph);
  const lamp=box(.5,.07,.5,new THREE.MeshBasicMaterial({color:0x8a9880})); lamp.position.y=2.26; g.add(lamp);
  const pl=new THREE.PointLight(0xaab898,1.1,5.5,1.5); pl.position.y=2.0; g.add(pl); return g; }
function mkHydrant(){ const g=group(); const m=new THREE.MeshLambertMaterial({color:0x6a2a20});
  const body=new THREE.Mesh(new THREE.CylinderGeometry(.13,.17,.6,8),m); body.position.y=.3; g.add(body);
  const cap=new THREE.Mesh(new THREE.SphereGeometry(.14,8,6),m); cap.position.y=.64; g.add(cap);
  for(const a of[0,Math.PI/2,Math.PI]){ const n=new THREE.Mesh(new THREE.CylinderGeometry(.055,.055,.15,6),m);
    n.rotation.z=Math.PI/2; n.rotation.y=a; n.position.set(Math.sin(a)*.17,.4,Math.cos(a)*.17); g.add(n); } return g; }
function mkHoseCab(){ const g=group(); const body=box(.55,.7,.14,new THREE.MeshLambertMaterial({color:0x6a2620})); g.add(body);
  const glass=new THREE.Mesh(new THREE.PlaneGeometry(.42,.55),new THREE.MeshLambertMaterial({color:0x191410})); glass.position.z=.075; g.add(glass);
  const hose=new THREE.Mesh(new THREE.TorusGeometry(.13,.045,6,12),new THREE.MeshLambertMaterial({color:0x7a3a30})); hose.position.z=.06; g.add(hose);
  const lbl=decal(tex((g2,s)=>{ g2.clearRect(0,0,s,s); g2.fillStyle="#d8cfae"; g2.font="bold 30px Courier New"; g2.textAlign="center";
    g2.fillText("FIRE HOSE",s/2,s/2+10); },256),.4,.09); lbl.position.set(0,.42,.02); g.add(lbl); return g; }
function mkBicycle(){ const g=group(); const mm=new THREE.MeshLambertMaterial({color:0x2e3a30});
  { const hp=new THREE.Mesh(new THREE.BoxGeometry(1.5,.95,.3),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));
    hp.position.y=.48; g.add(hp); }
  for(const wx of[-.55,.55]){ const w=new THREE.Mesh(new THREE.TorusGeometry(.3,.026,6,14),mm); w.position.set(wx,.31,0); g.add(w); }
  const t1=box(.78,.045,.045,mm); t1.position.set(.05,.54,0); t1.rotation.z=.22; g.add(t1);
  const t2=box(.62,.045,.045,mm); t2.position.set(-.22,.44,0); t2.rotation.z=-.62; g.add(t2);
  const t3=box(.5,.045,.045,mm); t3.position.set(.32,.5,0); t3.rotation.z=-1.1; g.add(t3);
  const seat=box(.2,.05,.09,M.metalDark); seat.position.set(-.34,.76,0); g.add(seat);
  const hb=box(.045,.24,.045,mm); hb.position.set(.52,.72,0); g.add(hb);
  const hbt=box(.05,.045,.34,mm); hbt.position.set(.52,.85,0); g.add(hbt); return g; }
function mkDoor(numTex){ // hinged door group; pivot at hinge
  const g=new THREE.Group(); g.userData.isDoor=true; const dk=lam(0x2c1f12);
  put(g,box(.9,2.05,.06,new THREE.MeshLambertMaterial({map:TEX.doorWood})),.45,1.025,0);
  for(const y of[1.48,.62])put(g,box(.62,.7,.074,dk),.45,y,0);                              // two raised panels, both faces
  for(const y of[1.48,.62])put(g,box(.5,.58,.084,new THREE.MeshLambertMaterial({map:TEX.doorWood,color:0xb0a898})),.45,y,0);
  put(g,box(.84,.16,.066,M.brass),.45,.1,0);                                                // kick plate
  for(const z of[-.05,.05]){ put(g,box(.05,.16,.012,M.brass),.8,1.0,z); put(g,rod(.03,.036,.05,8,M.brass),.8,1.0,z*1.5,Math.PI/2); }
  put(g,rod(.012,.012,.07,6,M.black),.45,1.5,0,Math.PI/2);                                  // peephole
  put(g,box(.24,.035,.07,M.brass),.45,1.04,0);                                              // letter slot
  for(const y of[.25,1.02,1.8])put(g,box(.03,.11,.08,M.metalDark),.0,y,0);                  // hinges
  if(numTex){ const p=new THREE.Mesh(new THREE.PlaneGeometry(.16,.16),new THREE.MeshLambertMaterial({map:numTex})); p.position.set(.45,1.9,.0325); g.add(p); }
  return g; }
/* door trim: jambs + header + threshold sill around a doorway. (cx,cy,cz)=center of the opening, ry=orientation, m=material */
function doorTrim(cx,cy,cz,ry=0,m){ m=m||M.woodDark; const g=new THREE.Group();
  const j1=box(.16,2.3,.2,m); j1.position.set(-.54,1.15,0); g.add(j1);
  const j2=box(.16,2.3,.2,m); j2.position.set(.54,1.15,0); g.add(j2);
  const hd=box(1.24,.34,.2,m); hd.position.set(0,2.2,0); g.add(hd);   // covers the leaf-top gap
  const sill=box(1.14,.035,.26,m); sill.position.set(0,.018,0); g.add(sill);
  g.position.set(cx,cy,cz); g.rotation.y=ry; scene.add(g); return g; }
function mkFrame(txr,w=.3,h=.38){ const g=group(); const f=box(w,h,.025,M.woodDark); g.add(f);
  const p=new THREE.Mesh(new THREE.PlaneGeometry(w-.05,h-.05),new THREE.MeshLambertMaterial({map:txr})); p.position.z=.014; g.add(p); return g; }
function mkNote(){ const n=new THREE.Mesh(new THREE.PlaneGeometry(.2,.28),M.paper); n.rotation.x=-Math.PI/2; return n; }
function mkBoxPile(n){ const g=group(); for(let i=0;i<n;i++){ const w=.4+Math.random()*.3;
  const b=box(w,.34,.42,M.cardboard); b.position.set((Math.random()-.5)*.7,.17+(i>2?.35:0),(Math.random()-.5)*.5); b.rotation.y=Math.random()*.6; g.add(b);
  const flap=box(w*.9,.02,.2,new THREE.MeshLambertMaterial({color:0x5c4a30})); flap.position.copy(b.position); flap.position.y+=.18; flap.rotation.y=b.rotation.y; flap.rotation.x=.5; g.add(flap);} return g; }
function mkCeilingLamp(color=0xc8a070,on=true,intensity=.85,dist=6){ const g=group();
  put(g,rod(.05,.05,.02,8,M.metalDark),0,-.01,0);
  put(g,box(.014,.3,.014,M.black),0,-.15,0);
  const shade=new THREE.Mesh(new THREE.ConeGeometry(.22,.17,12,1,true),new THREE.MeshLambertMaterial({color:0x4a4438,side:THREE.DoubleSide})); put(g,shade,0,-.34,0);
  const bulb=new THREE.Mesh(new THREE.SphereGeometry(.05,8,8),new THREE.MeshBasicMaterial({color:on?color:0x222220})); put(g,bulb,0,-.41,0);
  if(on){ const L=new THREE.PointLight(color,intensity*1.7,dist*1.35,1.5); L.position.y=-.55; g.add(L); g.userData.light=L; g.userData.bulb=bulb; }
  return g; }
function mkFluorescent(){ const g=group(); const tube=box(1.2,.05,.1,new THREE.MeshBasicMaterial({color:0xcfe0cc})); g.add(tube);
  put(g,box(1.3,.04,.24,M.metalDark),0,.045,0);
  for(const a of[-.63,.63])put(g,box(.04,.09,.2,M.metal),a,.0,0);
  for(const z of[-.11,.11])put(g,box(1.26,.05,.015,M.metal),0,.0,z,0,0,0);
  const L=new THREE.PointLight(0xb8ccb8,1.35,9,1.4); L.position.y=-.3; g.add(L); g.userData.light=L; g.userData.tube=tube; return g; }
function mkMetroFluorescent(){ const g=group();
  const tube=box(.86,.035,.09,new THREE.MeshBasicMaterial({color:0xc4d4c2})); g.add(tube);
  put(g,box(.94,.045,.16,M.metalDark),0,.04,0);
  for(const a of[-.45,.45])put(g,box(.03,.08,.14,M.metal),a,0,0);
  const L=new THREE.PointLight(0xb4c8b8,.95,7.5,1.4); L.position.y=-.2; g.add(L);
  g.userData.light=L; g.userData.tube=tube; return g; }
function mkSconce(on=true){ const g=group();
  put(g,box(.1,.24,.03,M.brass),0,0,0); put(g,box(.03,.03,.1,M.brass),0,.02,.05);
  const sh=new THREE.Mesh(new THREE.CylinderGeometry(.06,.1,.14,8,1,true),new THREE.MeshLambertMaterial({color:on?0xb89a62:0x5a5040,side:THREE.DoubleSide,emissive:on?0x3a2a10:0})); put(g,sh,0,.1,.1);
  if(on){ const L=new THREE.PointLight(0xd0a468,.95,5.5,1.5); L.position.set(0,.14,.22); g.add(L); g.userData.light=L;
    put(g,new THREE.Mesh(new THREE.SphereGeometry(.03,6,6),new THREE.MeshBasicMaterial({color:0xf0d0a0})),0,.09,.1); }
  return g; }
function mkMailboxes(){ const g=group(); const body=box(1.4,.7,.16,M.metal); body.position.y=1.2; g.add(body);
  for(let r=0;r<3;r++)for(let c=0;c<6;c++){ const d=box(.18,.18,.02,M.metalDark); d.position.set(-.58+c*.232,.96+r*.23,.085); g.add(d);}
  // overflowing 8001 box
  const p1=box(.16,.02,.1,M.paper); p1.position.set(-.58,1.02,.13); p1.rotation.z=.3; g.add(p1);
  const p2=p1.clone(); p2.position.set(-.55,.98,.15); p2.rotation.z=-.4; g.add(p2); return g; }
function mkElevator(){ const g=group();
  put(g,box(1.6,2.3,.14,M.metalDark),0,1.15,0);                                             // shaft surround
  put(g,box(1.44,2.08,.01,M.black),0,1.05,.076);                                            // the dark of the car, behind the doors
  // brushed steel leaves, each with a recessed panel and a scuffed kick plate
  const doorTex=tex((g2,s)=>{ g2.fillStyle="#7d8288"; g2.fillRect(0,0,s,s);
    for(let i=0;i<s;i+=3){ g2.fillStyle=i%9?"#767b81":"#868b91"; g2.fillRect(i,0,1,s); }
    g2.fillStyle="rgba(30,32,36,.25)"; g2.fillRect(0,0,s,10); g2.fillRect(0,s-14,s,14);
    for(let i=0;i<26;i++){ g2.fillStyle="rgba(40,42,46,.18)"; g2.fillRect(Math.random()*s,Math.random()*s,2,5+Math.random()*10); } },128);
  const dm=wetMat(new THREE.MeshLambertMaterial({map:doorTex,color:0xa8acb0}),.1,20), inset=lam(0x565c62);
  const leaf=x=>{ const d=box(.7,2.08,.06,dm); d.position.set(x,1.05,.06); g.add(d);
    put(d,box(.46,1.3,.012,inset),0,.18,.034); put(d,box(.66,.26,.012,lam(0x4a4e52)),0,-.88,.034);
    put(d,box(.012,2.08,.064,M.black),x<0?.35:-.35,0,.002); return d; };
  const dl=leaf(-.37), dr=leaf(.37); g.userData.leaves=[dl,dr];
  // stepped architrave and a grooved sill
  for(const a of[-.78,.78]){ put(g,box(.08,2.3,.2,M.metal),a,1.15,.04); put(g,box(.05,2.24,.26,M.chrome),a*.97,1.12,.05); }
  put(g,box(1.66,.1,.22,M.metal),0,2.33,.04);
  put(g,box(1.5,.05,.24,M.metal),0,.025,.09); for(let i=0;i<5;i++)put(g,box(1.44,.008,.012,M.black),0,.052,.0+i*.045);
  // transom: an indicator that knows three floors and is honest about only one of them
  put(g,box(1.0,.3,.05,lam(0x15181c)),0,2.2,.09);
  const ind=new THREE.Mesh(new THREE.PlaneGeometry(.92,.24),new THREE.MeshBasicMaterial({map:tex((g2,s)=>{ g2.fillStyle="#0c0e10"; g2.fillRect(0,0,s,s);
    g2.font="bold 56px Courier New"; g2.textAlign="center"; g2.textBaseline="middle";
    [["G",.2,"#5a4424"],["8",.5,"#f0b450"],["21",.8,"#5a4424"]].forEach(([t,x,c])=>{ g2.fillStyle=c; g2.fillText(t,s*x,s*.5); });
    g2.strokeStyle="#3a3020"; g2.lineWidth=3; g2.strokeRect(4,s*.22,s-8,s*.56); },256)}));
  ind.material.map.repeat.set(1,.56); ind.material.map.offset.set(0,.22); put(g,ind,0,2.2,.117);
  // call panel: two buttons, one of which still lights
  put(g,box(.15,.3,.04,M.chrome),.95,1.1,.05);
  put(g,rod(.026,.026,.02,10,new THREE.MeshBasicMaterial({color:0xe0a850})),.95,1.16,.076,Math.PI/2);
  put(g,rod(.026,.026,.02,10,lam(0x3c4046)),.95,1.05,.076,Math.PI/2);
  put(g,box(.09,.03,.006,M.black),.95,.975,.072);
  const il=new THREE.PointLight(0xc89a4a,.6,3.6,1.5); il.position.set(0,2.2,.5); g.add(il);
  return g; }
function mkPillBottle(){ const g=group(); const b=new THREE.Mesh(new THREE.CylinderGeometry(.03,.03,.09,8),new THREE.MeshLambertMaterial({color:0x9a6a34})); b.position.y=.045; g.add(b);
  const cap=new THREE.Mesh(new THREE.CylinderGeometry(.032,.032,.02,8),M.white); cap.position.y=.1; g.add(cap); return g; }
function mkKey(){ const g=group(); const head=new THREE.Mesh(new THREE.TorusGeometry(.03,.01,6,10),new THREE.MeshLambertMaterial({color:0x8a7a4a})); head.rotation.x=Math.PI/2; g.add(head);
  const shaft=box(.008,.008,.07,new THREE.MeshLambertMaterial({color:0x8a7a4a})); shaft.position.z=.05; g.add(shaft);
  const t1=box(.008,.02,.01,new THREE.MeshLambertMaterial({color:0x8a7a4a})); t1.position.set(0,-.012,.075); g.add(t1); return g; }
function mkPiece(){ const g=group(); const m=new THREE.MeshLambertMaterial({color:0x7a2a22});
  const a=box(.08,.02,.08,m); g.add(a); const nub=box(.03,.02,.03,m); nub.position.set(.05,0,0); g.add(nub);
  const hole=box(.03,.022,.03,M.black); hole.position.set(0,-.001,.05); g.add(hole); return g; }
function mkFigure(){ const g=group(); const bk=M.black;
  put(g,rod(.13,.2,.8,8,bk),0,1.08,0);                                                      // dress, narrow at the shoulder
  put(g,rod(.2,.3,.7,8,bk),0,.36,0);
  for(let i=0;i<9;i++){ const a=i/9*Math.PI*2; put(g,box(.1,.14+Math.random()*.16,.03,bk),Math.sin(a)*.28,.06,Math.cos(a)*.28,0,a,0); }   // torn hem
  put(g,box(.4,.09,.17,bk),0,1.46,0); put(g,rod(.045,.05,.12,6,bk),0,1.55,0);               // shoulders, neck
  const head=new THREE.Mesh(new THREE.SphereGeometry(.125,8,8),bk); head.scale.set(.9,1.1,.95); put(g,head,0,1.68,0);
  for(const sx of[-1,1]){ put(g,rod(.035,.03,.62,5,bk),sx*.215,1.15,0,0,0,sx*.06);        // arms that hang a little too long
    put(g,rod(.028,.022,.52,5,bk),sx*.245,.6,.02,.06,0,sx*.03); put(g,box(.05,.15,.03,bk),sx*.255,.3,.03); }
  // hair: a curtain where the face would be, and down the back past the waist
  for(let i=0;i<9;i++)put(g,box(.034,.5+Math.random()*.28,.03,bk),-.12+i*.03,1.5-Math.random()*.06,.115,-.06);
  for(let i=0;i<10;i++)put(g,box(.036,.8+Math.random()*.4,.035,bk),-.14+i*.031,1.3-Math.random()*.08,-.12,.1);
  for(const sx of[-1,1])put(g,box(.03,.62,.17,bk),sx*.125,1.42,0);
  // She is pure black, so in a dark room she vanished. A cold halo behind her and a little
  // light on the floor around her keep the silhouette legible without ever lighting HER.
  const halo=new THREE.Mesh(new THREE.PlaneGeometry(1.5,2.6),new THREE.MeshBasicMaterial({transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,opacity:.5,
    map:tex((c,s)=>{ c.clearRect(0,0,s,s); const r=c.createRadialGradient(s/2,s*.45,4,s/2,s*.45,s*.5);
      r.addColorStop(0,"rgba(120,150,190,.55)"); r.addColorStop(.5,"rgba(70,95,135,.2)"); r.addColorStop(1,"rgba(0,0,0,0)"); c.fillStyle=r; c.fillRect(0,0,s,s); },128)}));
  put(g,halo,0,1.05,-.3);
  const aura=new THREE.PointLight(0x7c96bc,.6,4.2,1.5); aura.position.set(0,1.0,-.5); g.add(aura);
  return g; }
/* ============================================================
   WORLD BUILD
   Corridor: x 0..18, z 0..2.2. Flats north (z 2.2..9.2).
   8001: x 0..9 (door x1.05..1.95) · 8007: x 9..18 (door x16.05..16.95)
   ============================================================ */
const H=CFG.ceilFlat, HH=CFG.ceilHall;
const doorGap8001=[1.05,1.95], doorGap8007=[16.05,16.95];

/* --- corridor shell --- */
floorPlane(9,1.1,18.4,2.2,TEX.hallFloor,1.2);
{ const r=new THREE.Mesh(new THREE.PlaneGeometry(16.5,.9),surf(TEX.runner,16.5,.9,1.6)); r.rotation.x=-Math.PI/2; r.position.set(9,.005,1.1); scene.add(r); }
ceilPlane(9,1.1,18.4,2.2,HH);
wall("x",0,18,2.2,HH,0,TEX.concrete,1.6,.16,[doorGap8001,doorGap8007]);     // north corridor wall
wall("x",0,18,0,HH,0,TEX.concrete,1.6,.16,[]);                              // south corridor wall (flat doors are dressing)
wall("z",0,2.2,0,HH,0,TEX.concrete,1.6,.16,[[0.6,1.6]]);                    // west end: elevator alcove opening — actually put elevator ON the wall; close it
wall("z",0,2.2,18,HH,0,TEX.concrete,1.6,.16,[[.65,1.55]]);                  // east end: stairwell door gap
// (removed floating wainscot band that read as a panel across the doors)
baseboard("x",0,18,2.2,-1); baseboard("x",0,18,0,1);

/* corridor lights: 3 fluorescents, one near 8007 flickering */
const flickers=[];
for(const [x,fl] of [[3.2,false],[9,false],[14.8,true]]){ const f=mkFluorescent(); f.position.set(x,HH-.12,1.1); scene.add(f); if(fl)flickers.push(f); }

/* elevator (focal, west end) + mailboxes */
const elev=mkElevator(); elev.position.set(.09,0,1.1); elev.rotation.y=Math.PI/2; scene.add(elev);
addCollider(.12,1.1,.3,1.8);
interact(elev,"Call the elevator",()=>{
  // Ending B: the letter is read; the lift lets him out onto the street
  if(GS.metroOpen){ AU.ding(); AU.elevRide();
    travel("street",-96,3,Math.PI,()=>{ AU.windStart();
      say(null,"The lobby, the chain on the doors — gone, or never there. The street takes him back without comment.",5600);
      setObjective("The <b>subway</b>, at the end of the street. Go to her."); }); return; }
  if(GS.elevG||GS.elev21){ AU.ding(); openElev("floor8"); }
  else { AU.rattle(); say(null,"The car never comes. It never has."); }
});
const mail=mkMailboxes(); mail.position.set(1.2,0,.1); scene.add(mail);
addCollider(1.2,.12,1.45,.25);
interact(mail,"Mailboxes",()=>say(null,"8001 is overflowing. He stopped collecting it months ago."));
/* radiator mid-corridor + garbage bags by 8004 (rule of lived-in) */
const rad=mkRadiator(); rad.position.set(13.4,0,.15); scene.add(rad);
{ const gb=group(); for(let i=0;i<3;i++){ const b=new THREE.Mesh(new THREE.SphereGeometry(.24,7,6),new THREE.MeshLambertMaterial({color:0x22261f}));
  b.scale.y=.7; b.position.set(i*.3-.3,.17,Math.random()*.1); gb.add(b);} gb.position.set(12.4,0,.3); scene.add(gb);
  addCollider(12.4,.3,.9,.5); interact(gb,"Garbage bags",()=>say(null,"Someone's week, left in the hall.")); }
/* EXIT sign over east door */
{ const s=tex((g,sz)=>{g.fillStyle="#1a0d0a";g.fillRect(0,0,sz,sz);g.fillStyle="#a83828";g.font="bold 70px Courier New";g.textAlign="center";g.fillText("EXIT",sz/2,sz/2+22);},128);
  const p=new THREE.Mesh(new THREE.PlaneGeometry(.55,.22),new THREE.MeshBasicMaterial({map:s})); p.position.set(17.9,2.35,1.1); p.rotation.y=-Math.PI/2; scene.add(p); }

/* corridor fake doors 8002–8006 on the south wall */
const doorBehav={
  "8002":()=>{AU.rattle(); say(null,"Locked. A television murmurs behind it — a laugh track for no one.");},
  /* corridor dressing is added right after the door table via dressFloor8() below */
  "8003":()=>{AU.rattle(); say(null,"Locked. Silence. The kind that's listening.");},
  "8005":()=>{AU.rattle(); say(null,"Locked. The knob is cold.");},
  "8006":()=>{AU.rattle(); say(null,"Locked. Dust on the threshold. Nobody's crossed it in years.");}
};
const doorXs={"8002":3.4,"8003":5.4,"8004":7.4,"8005":9.6,"8006":11.6};
let note8004Given=false, note8004Mesh=null;
for(const num of["8002","8003","8004","8005","8006"]){
  const d=mkDoor(plateTex(num)); d.position.set(doorXs[num]-.45,0,.1); scene.add(d);
  doorTrim(doorXs[num],0,.12);
  const fr=box(1.06,.08,.1,M.woodDark); fr.position.set(doorXs[num],2.09,.1); scene.add(fr);
  if(num==="8004"){
    interact(d,"Knock on 8004",()=>{ AU.knock();
      if(note8004Given)return say(null,"No answer. Whoever slid the note is done talking.");
      later(()=>{ AU.burst(.4,300,.2,1); /*chair scrape*/
        later(()=>{ AU.paper(); note8004Mesh=new THREE.Mesh(new THREE.PlaneGeometry(.32,.42),new THREE.MeshLambertMaterial({map:TEX.noteSmall,side:THREE.DoubleSide}));
          note8004Mesh.rotation.x=-Math.PI/2.2; note8004Mesh.position.set(doorXs["8004"],0.05,.7); scene.add(note8004Mesh);
          interact(note8004Mesh,"Take the note",()=>{ scene.remove(note8004Mesh); collectNote("n_8004"); AU.paper(); openNote("n_8004"); checkObjective(); },{range:2.6,zone:"floor8"});
          say(null,"A chair scrapes. Paper slides under the door.");
          dread=Math.min(1,dread+.25);
        },900); },600);
      note8004Given=true; });
  } else interact(d,`Knock on ${num}`,doorBehav[num]);
}
/* doormats at two doors */
for(const x of[doorXs["8003"],doorXs["8006"]]){ const m=box(.7,.02,.4,new THREE.MeshLambertMaterial({color:0x3a3226})); m.position.set(x,.011,.5); scene.add(m); }

/* stairwell door, east end (slice exit) */
const stairDoor=mkDoor(); stairDoor.position.set(17.92,0,.65); stairDoor.rotation.y=-Math.PI/2; scene.add(stairDoor);
doorTrim(17.92,0,1.1,Math.PI/2);
/* ── corridor dressing: a runner going threadbare, sconces mostly dead, the drip that owns the 8th floor ── */
{ const runner=new THREE.Mesh(new THREE.PlaneGeometry(16,1.1),new THREE.MeshLambertMaterial({color:0x3a2226}));
  runner.rotation.x=-Math.PI/2; runner.position.set(9,.013,1.1); scene.add(runner);
  const trim1=new THREE.Mesh(new THREE.PlaneGeometry(16,.08),new THREE.MeshLambertMaterial({color:0x574038}));
  trim1.rotation.x=-Math.PI/2; trim1.position.set(9,.014,.52); scene.add(trim1);
  const trim2=trim1.clone(); trim2.position.z=1.68; scene.add(trim2);
  for(const [sx,lit] of[[4.3,false],[9.5,true],[14.5,false]]){
    const sc=mkSconce(); sc.position.set(sx,2.05,.1); scene.add(sc);
    if(lit){ const sl=new THREE.PointLight(0xc89858,.5,4.5,1.8); sl.position.set(sx,2.15,.4); scene.add(sl); } }
  const hc=mkHoseCab(); hc.position.set(15.2,1.5,2.14); hc.rotation.y=Math.PI; scene.add(hc);
  interact(hc,"FIRE HOSE — break glass",()=>say(null,"The glass is already cracked. The hose inside has perished into one solid coil. Some emergencies outlast their equipment."));
  // the drip: ceiling stain, bucket, ring of water — the floor8 drip sound made flesh
  const stainTex=tex((g,s)=>{ g.clearRect(0,0,s,s);
    for(let i=0;i<7;i++){ const r=18+Math.random()*26, x=s/2+(Math.random()-.5)*44, y=s/2+(Math.random()-.5)*44;
      const gr=g.createRadialGradient(x,y,r*.2,x,y,r);
      gr.addColorStop(0,"rgba(58,50,40,.55)"); gr.addColorStop(.7,"rgba(48,42,34,.3)"); gr.addColorStop(1,"rgba(48,42,34,0)");
      g.fillStyle=gr; g.beginPath(); g.arc(x,y,r,0,7); g.fill(); }
    g.strokeStyle="rgba(70,60,46,.5)"; g.lineWidth=2; g.beginPath(); g.arc(s/2,s/2,52,0,7); g.stroke(); },128);
  const stain=new THREE.Mesh(new THREE.PlaneGeometry(1.4,1.4),new THREE.MeshLambertMaterial({map:stainTex,transparent:true,depthWrite:false}));
  stain.rotation.x=Math.PI/2; stain.position.set(11.2,2.685,1.6); scene.add(stain);
  const bucket=new THREE.Mesh(new THREE.CylinderGeometry(.17,.13,.3,10,1,true),new THREE.MeshLambertMaterial({map:TEX.metal,side:THREE.DoubleSide}));
  bucket.position.set(11.2,.15,1.6); scene.add(bucket); addCollider(11.2,1.6,.4,.4);
  { const hp=new THREE.Mesh(new THREE.BoxGeometry(.4,.34,.4),new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));
    hp.position.y=.02; bucket.add(hp); }
  const bw=new THREE.Mesh(new THREE.CircleGeometry(.13,10),new THREE.MeshLambertMaterial({color:0x18242a}));
  bw.rotation.x=-Math.PI/2; bw.position.set(11.2,.26,1.6); scene.add(bw);
  interact(bucket,"A bucket, half full",()=>say(null,"Someone put it here months ago and the ceiling has been keeping time into it ever since."));
}
addCollider(17.9,1.1,.2,1.0,"stair");
interact(stairDoor,"Stairwell",()=>{
  AU.rattle();
  if(inv.has("key_restock")) say(null,"Bolted since the eighties. But listen — the elevator shaft is humming. The car woke up when the key dropped.");
  else say(null,"Bolted from this side. Twenty floors of dark he has no business with tonight.");
});

/* ============ FLAT SHELLS ============ */
function flatShell(ox,mirror,skipWest){
  const X=x=>ox+(mirror?9-x:x); const S=2.2,N=9.2;
  const wallT=mirror?TEX.wallpaperOld:TEX.wallpaper;
  const floorT=mirror?TEX.planksOld:TEX.woodFloor;
  const tint=mirror?0xb9c2c8:null;
  floorPlane(ox+4.5,(S+N)/2,9,7,floorT,1.0);
  ceilPlane(ox+4.5,(S+N)/2,9,7,H);
  // outer walls (west & east & north)
  if(skipWest){
    // shared party wall already built by neighbour flat — add an interior wallpaper skin so no z-fight
    const p=new THREE.Mesh(new THREE.PlaneGeometry(N-S,H),surf(wallT,N-S,H,.6,tint));
    p.rotation.y=Math.PI/2; p.position.set(ox+.09,H/2,(S+N)/2); scene.add(p);
  } else {
    wall("z",S,N,ox,H,0,wallT,.6,.16);
  }
  wall("z",S,N,ox+9,H,0,wallT,.6,.16);
  wall("x",ox,ox+9,N,H,0,wallT,.6,.16);
  // interior south skin (over corridor wall) for wallpaper — thin panels either side of the door gap
  const dg=mirror?doorGap8007:doorGap8001;
  for(const seg of [[ox,dg[0]],[dg[1],ox+9]]){ const len=seg[1]-seg[0]; if(len<.05)continue;
    const p=new THREE.Mesh(new THREE.PlaneGeometry(len,H),surf(wallT,len,H,.6,tint)); p.position.set((seg[0]+seg[1])/2,H/2,S+.085); scene.add(p); }
  // entry divider z=3.8 with doorway
  const doorAt=mirror?[X(2.9),X(2.0)].sort((a,b)=>a-b):[2.0+ox,2.9+ox];
  wall("x",ox,ox+9,3.8,H,0,wallT,.6,.14,[doorAt]);
  // bedroom/kitchen divider z=7.0: bedroom door + kitchen opening
  const bd=mirror?[X(2.9),X(2.0)].sort((a,b)=>a-b):[ox+2.0,ox+2.9];
  const ko=mirror?[X(7.6),X(5.8)].sort((a,b)=>a-b):[ox+5.8,ox+7.6];
  wall("x",ox,ox+9,7.0,H,0,wallT,.6,.14,[bd,ko]);
  // bedroom/kitchen divider x
  wall("z",7.0,9.2,ox+4.5,H,0,wallT,.6,.14);
  baseboard("x",ox,ox+9,N,-1); baseboard("z",S,N,ox,1); baseboard("z",S,N,ox+9,-1); baseboard("x",ox,ox+9,S,1);
  return {X};
}
const F1=flatShell(0,false);
const F7=flatShell(9,true,true);

/* --- 8001 front door (hinged, functional) --- */
let phoneAnswered=false, door8001Open=false;
const d8001=mkDoor(plateTex("8001")); d8001.position.set(doorGap8001[0],0,2.2); scene.add(d8001);
doorTrim(doorGap8001[0]+.45,0,2.2);
const c8001=addCollider(1.5,2.2,1.0,.14,"door8001");
const ix8001=interact(d8001,"Front door",()=>{
  if(!phoneAnswered){ AU.rattle(); say("THOMAS","Locked. I locked it. The phone is still ringing."); return; }
  if(!door8001Open){ AU.creak(); door8001Open=true; c8001.on=false; ix8001.prompt="Front door";
    say(null,"The corridor. Seven doors. Six lives he never knew — and one that knows him."); setObjective("Find flat <b>8007</b> — the far end of the corridor. Knock as you go."); }
});

/* --- 8007 front door (opens on knock) --- */
let door8007Open=false;
const d8007=mkDoor(plateTex("8007")); d8007.position.set(doorGap8007[0],0,2.2); scene.add(d8007);
doorTrim(doorGap8007[0]+.45,0,2.2);
const c8007=addCollider(16.5,2.2,1.0,.14,"door8007");
const ix8007=interact(d8007,"Knock on 8007",()=>{
  if(door8007Open)return;
  AU.knock();
  later(()=>{ AU.creak(); door8007Open=true; c8007.on=false; dread=Math.min(1,dread+.3);
    say(null,"No hand touches it. The door of 8007 swings open on its own.");
    setObjective("Search <b>8007</b> — Eileen's old flat. She said: <b>find the note.</b>");
  },900);
});
/* animate doors opening (rotation) in tick */

/* ============ 8001 DRESSING ============ */
/* living: chair(wake) + side table + phone + pills, shelf half-empty W wall, radiator, photos */
const wakeChair=mkChair(); at(wakeChair,2.3,0,5.4,Math.PI+.26); addCollider(2.3,5.4,.5,.5);
const sideT=mkTable(.6,.5,.6); at(sideT,3.15,0,5.35,0); addCollider(3.15,5.35,.6,.5);
const phone1=mkPhone(); at(phone1,3.15,.65,5.3,-.4);
const pb1=mkPillBottle(); at(pb1,2.92,.65,5.56); const pb2=mkPillBottle(); at(pb2,2.98,.65,5.44,.6);
interact(pb1,"His medication",()=>say("THOMAS","One for the sleep. One for the things I see when I don't."));
const shelf1=mkShelf(false); at(shelf1,0.28,0,5.2,Math.PI/2); addCollider(.28,5.2,.36,.95);
interact(shelf1,"Bookshelf",()=>say("THOMAS","Half empty. Her half. I keep meaning to spread mine out. I don't."));
const rad1=mkRadiator(); at(rad1,4.6,0,3.96,Math.PI); // against entry divider, living side
const photoWall=mkFrame(TEX.photo,.34,.42); photoWall.position.set(5.5,1.55,3.9); photoWall.rotation.z=.06; scene.add(photoWall);
interact(photoWall,"The photograph",()=>{ say("THOMAS","Us. On the ledge. Her face is perfect. Mine is just… light."); dread=Math.min(1,dread+.1); });
/* (face-down frame is built in the Ending-B props block below) */
/* living lamp — warm, ON (he fell asleep with it on) */
const lamp1=mkCeilingLamp(0xc8a070,true,.95,6.5); lamp1.position.set(2.8,H,5.2); scene.add(lamp1);
/* entry sconce OFF */
const sc1=mkSconce(false); sc1.position.set(3.4,1.7,2.31); scene.add(sc1);

/* bedroom (x 0..4.5, z 7..9.2) */
const bed1=mkBed(false); at(bed1,1.1,0,8.1,Math.PI/2); addCollider(1.1,8.1,2.0,1.1);
const ns1=mkNightstand(); at(ns1,2.35,0,8.85,Math.PI); addCollider(2.35,8.85,.5,.5);
interact(ns1,"Her nightstand is gone",()=>say("THOMAS","One nightstand. There used to be two. I gave hers away in month three. I regret it every night."));
const ward1=mkWardrobe(true); at(ward1,3.75,0,8.78,Math.PI); addCollider(3.75,8.78,1.4,.7);
/* kitchenette (x 4.5..9, z 7..9.2): run along north wall */
const cs=mkCounterSink(1.5); at(cs,5.6,0,8.85,Math.PI); addCollider(5.6,8.85,1.5,.65);
const stove1=mkStove(); at(stove1,6.9,0,8.85,Math.PI); addCollider(6.9,8.85,.65,.65);
const fridge1=mkFridge(); at(fridge1,8.4,0,8.8,Math.PI); addCollider(8.4,8.8,.75,.62);
interact(fridge1,"Refrigerator",()=>say("THOMAS","One plate. One cup. You can count a year in dishes."));
const kt=mkTable(.8,.8,.72); at(kt,5.6,0,7.6); addCollider(5.6,7.6,.8,.8);
const kc=mkChair(); at(kc,6.2,0,7.6,-Math.PI/2);
/* cold under-cabinet glow */
{ const L=new THREE.PointLight(0x9ab0c0,.35,2.5,2); L.position.set(5.6,1.0,8.7); scene.add(L); }

/* ============ 8007 DRESSING (mirrored, one decade staler) ============ */
/* entry: telephone table + landline (dial) + weak sconce */
const telT=mkTable(.55,.4,.75,M.woodDark); at(telT,15.4,0,2.75,0); addCollider(15.4,2.75,.6,.45);
const phone7=mkPhone(); at(phone7,15.4,.78,2.75,.3);
interact(phone7,"Eileen's landline",()=>{ openDial(); });
// (removed lit sconce lamp beside the 8007 door)
/* living: two FULL bookshelves against interior wall (x=13.5 divider region → use west living wall x=9 side? mirrored: use wall x=18? Doc: interior wall). Place against north living divider z=7 facing south */
const shelf7a=mkShelf(true); at(shelf7a,12.75,0,6.7,Math.PI); addCollider(12.75,6.7,.95,.36);
const shelf7b=mkShelf(true); at(shelf7b,13.75,0,6.7,Math.PI); addCollider(13.75,6.7,.95,.36);
const pageCheck=()=>{ if(collected.has("p10")&&collected.has("p34")&&collected.has("p56"))
  setObjective("All three pages. <b>Dial the number</b> — Eileen's landline."); };
interact(shelf7b,"Her books — one is bookmarked",()=>{ collectNote("p10"); AU.paper(); openNote("p10"); pageCheck(); });
{ const tab=new THREE.Mesh(new THREE.PlaneGeometry(.05,.12),M.paper); tab.position.set(13.6,1.32,6.94); scene.add(tab); }
interact(shelf7a,"Full bookshelf",()=>say("THOMAS","Every spine is hers. This is what she looked like before me."));
/* dining table + 2 chairs, one pulled out */
const dtable=mkTable(1.1,.8,.74); at(dtable,13.2,0,5.2); addCollider(13.2,5.2,1.1,.8);
const dc1=mkChair(); at(dc1,13.2,0,4.6,0);
const dc2=mkChair(); at(dc2,13.5,0,5.95,Math.PI-.5); // pulled out, askew — as if someone just left
const grief=mkNote(); grief.position.set(13.2,.78,5.2); grief.rotation.z=.2; scene.add(grief);
interact(grief,"A long note in his handwriting",()=>{ collectNote("n_grief"); AU.paper(); openNote("n_grief"); });
/* boxes: wall row + one mid-floor cluster (page 34 in pile) */
const pile1=mkBoxPile(4); at(pile1,17.1,0,5.6,.3); addCollider(17.1,5.6,1.1,.9);
const pile2=mkBoxPile(5); at(pile2,14.6,0,3.9,-.4); addCollider(14.6,3.9,1.1,.9);
{ // labels in her hand, and the one box he keeps opening
  const lbl=(t)=>decal(tex((g,s)=>{ g.clearRect(0,0,s,s); g.fillStyle="#3a3226"; g.font="bold 34px Courier New";
    g.textAlign="center"; g.fillText(t,s/2,s/2+12); },256),.34,.11);
  const l1=lbl("BOOKS"); l1.position.set(16.9,.5,5.05); l1.rotation.y=Math.PI+.3; scene.add(l1);
  const l2=lbl("WINTER"); l2.position.set(17.35,.85,5.5); l2.rotation.y=Math.PI+.3; scene.add(l2);
  const l3=lbl("KITCHEN"); l3.position.set(14.35,.5,3.42); l3.rotation.y=Math.PI-.4; scene.add(l3);
  const ob=group(); const obm=box(.5,.34,.44,M.cardboard); obm.position.y=.17; ob.add(obm);
  for(const [fx,fr] of[[-.24,-1.9],[.24,1.9]]){ const flap=box(.22,.02,.44,new THREE.MeshLambertMaterial({color:0x5c4a30}));
    flap.position.set(fx,.36,0); flap.rotation.z=fr; ob.add(flap); }
  const cloth=box(.34,.06,.3,new THREE.MeshLambertMaterial({color:0x5a4a52})); cloth.position.set(-.04,.36,.02); cloth.rotation.y=.4; ob.add(cloth);
  const bk=box(.2,.05,.14,new THREE.MeshLambertMaterial({color:0x4a3428})); bk.position.set(.1,.39,-.06); bk.rotation.y=-.3; ob.add(bk);
  at(ob,15.7,0,5.15,.9); addCollider(15.7,5.15,.6,.55);
  interact(ob,"An opened box",()=>say("THOMAS","Her scarf. A paperback with her place still kept. I open a box, any box, and I look for her in it."));}
interact(pile2,"Half-packed boxes",()=>{ collectNote("p34"); AU.paper(); openNote("p34"); pageCheck(); });
{ const tab=new THREE.Mesh(new THREE.PlaneGeometry(.14,.1),M.paper); tab.rotation.x=-Math.PI/2.3; tab.rotation.z=.4; tab.position.set(14.5,1.08,3.8); scene.add(tab); }
interact(pile1,"Boxes against the wall",()=>say(null,"Taped, labeled in her hand: KITCHEN — BOOKS — WINTER. She was mid-move into 8001 when she stopped coming back."));
/* bedroom mirrored (x 13.5..18... actually mirrored bedroom sits x 13.5..18): stripped bed, open wardrobe, TWO nightstands, page 56 in one */
const bed7=mkBed(true); at(bed7,17.0,0,8.1,-Math.PI/2); addCollider(17.0,8.1,2.0,1.1);
const ns7a=mkNightstand(); at(ns7a,17.4,0,8.95,Math.PI); addCollider(17.4,8.95,.5,.5);
const ns7b=mkNightstand(); at(ns7b,17.4,0,7.25,0); addCollider(17.4,7.25,.5,.5);
interact(ns7a,"Nightstand — the drawer is stuck",()=>{ AU.burst(.2,400,.3,1); collectNote("p56"); openNote("p56"); pageCheck(); });
{ const tab=new THREE.Mesh(new THREE.PlaneGeometry(.1,.05),M.paper); tab.position.set(15.4,.52,8.57); scene.add(tab); }
interact(ns7b,"Nightstand",()=>say(null,"Both of them, here. Nobody took one away in this flat."));
const ward7=mkWardrobe(true); at(ward7,13.98,0,8.2,Math.PI/2); addCollider(13.98,8.2,.85,1.4);
interact(ward7,"Wardrobe, open and empty",()=>say(null,"Hangers. Dust. The shape of clothes that left."));
/* kitchenette mirrored (x 9..13.5): fridge carries THE note */
const fridge7=mkFridge(); at(fridge7,9.7,0,8.8,Math.PI); addCollider(9.7,8.8,.75,.62);
const fnote=new THREE.Mesh(new THREE.PlaneGeometry(.16,.2),M.paper); fnote.position.set(9.7,1.35,8.47); fnote.rotation.y=Math.PI; scene.add(fnote);
{ const mag=new THREE.Mesh(new THREE.CylinderGeometry(.015,.015,.01,8),new THREE.MeshLambertMaterial({color:0x7a2a22})); mag.rotation.x=Math.PI/2; mag.position.set(9.7,1.43,8.46); scene.add(mag); }
interact(fnote,"A note on the fridge",()=>{ collectNote("n_fridge"); AU.paper(); openNote("n_fridge");
  if(!(collected.has("p10")&&collected.has("p34")&&collected.has("p56")))
    setObjective("Her numbered pages: <b>the bookshelf · the half-packed boxes · the jammed drawer.</b> All in this flat."); });
interact(fridge7,"Her refrigerator",()=>say(null,"Unplugged. Propped open with a spoon so it wouldn't grow anything. She thought of things like that."));
const cs7=mkCounterSink(1.5); at(cs7,12.4,0,8.85,Math.PI); addCollider(12.4,8.85,1.5,.65);
const stove7=mkStove(); at(stove7,11.1,0,8.85,Math.PI); addCollider(11.1,8.85,.65,.65);
/* living room proper (ref SH2 flat 205: covered furniture, one chair alone in the middle of the room) */
{ const sofa=group(); const sheet=new THREE.MeshLambertMaterial({color:0x8f8878});
  const body=box(1.9,.62,.85,sheet); body.position.y=.34; sofa.add(body);
  const back=box(1.86,.48,.22,sheet); back.position.set(0,.7,-.32); back.rotation.x=-.12; sofa.add(back);
  for(const ax of[-.83,.83]){ const arm=box(.24,.28,.8,sheet); arm.position.set(ax,.66,0); sofa.add(arm); }
  const hem=box(1.98,.44,.88,new THREE.MeshLambertMaterial({color:0x746d5d})); hem.position.y=.2; sofa.add(hem);
  for(const fx of[-.5,.25,.7]){ const fold=box(.045,.52,.87,new THREE.MeshLambertMaterial({color:0x7d7666}));
    fold.position.set(fx,.32,0); sofa.add(fold); }
  at(sofa,10.6,0,5.9,Math.PI-.06); addCollider(10.6,5.9,2.1,1.0);
  interact(sofa,"A sofa under a dust sheet",()=>say(null,"The sheet has settled into the shape beneath it. Nobody has sat here in a year, and the sheet remembers that too."));
  const lc=mkChair(); at(lc,12.6,0,5.0,2.4); addCollider(12.6,5.0,.5,.5);
  interact(lc,"A chair, alone in the room",()=>say("THOMAS","Facing the boxes. Someone sat here deciding what was worth keeping. Then stopped deciding."));
  const fl7=group(); { const pole=box(.04,1.5,.04,M.metalDark); pole.position.y=.75; fl7.add(pole);
    const base7=new THREE.Mesh(new THREE.CylinderGeometry(.16,.18,.04,10),M.metalDark); base7.position.y=.02; fl7.add(base7);
    const shade7=new THREE.Mesh(new THREE.CylinderGeometry(.14,.2,.24,10,1,true),new THREE.MeshLambertMaterial({color:0x6a5c42,side:THREE.DoubleSide})); shade7.position.y=1.56; fl7.add(shade7); }
  at(fl7,9.55,0,6.55,0); addCollider(9.55,6.55,.4,.4);
  const kt7=mkTable(.8,.8,.72); at(kt7,12.4,0,7.62); addCollider(12.4,7.62,.8,.8);
  { const cup=new THREE.Mesh(new THREE.CylinderGeometry(.045,.04,.09,8),new THREE.MeshLambertMaterial({color:0xc8c0b0})); cup.position.set(12.25,.77,7.6); scene.add(cup); } }
/* old papers */
const op=mkNote(); op.position.set(12.4,.005,4.3); op.rotation.z=1.2; scene.add(op);
interact(op,"Loose papers",()=>say(null,"Grocery lists. A dentist's number. The archaeology of an ordinary life."));
/* NO ceiling light in 8007 — flashlight territory. Sconce only. */

/* reward drop items (hidden until dialed) */
const piece1=mkPiece(); piece1.position.set(15.0,.03,3.1); piece1.visible=false; scene.add(piece1);
const keyR=mkKey(); keyR.position.set(15.7,.03,3.2); keyR.rotation.y=1; keyR.visible=false; scene.add(keyR);
const ixPiece=interact(piece1,"Take Puzzle Piece #1",()=>{ piece1.visible=false; ixPiece.enabled=false; give("piece1","🧩","PIECE #1"); checkObjective(); }); ixPiece.enabled=false;
const ixKey=interact(keyR,"Take the Old Restock key",()=>{ keyR.visible=false; ixKey.enabled=false; give("key_restock","🗝","RESTOCK"); checkObjective(); }); ixKey.enabled=false;

/* The Figure (glimpse after puzzle solved, corridor west end) */
const figure=mkFigure(); figure.position.set(1.2,0,1.1); figure.visible=false; _sceneAdd(figure);
let figureShown=false, figureT=0;

/* ---------------- Notes & journal (hand-authored, per docs) ---------------- */
const NOTES={
  n_8004:{title:"NOTE · SLID UNDER THE DOOR OF 8004",body:
`They keep asking me how I'm <em>holding up</em>. As if grief were a weight you carry in your arms, and not the floor going out from under every room you enter.

The first month I called the precinct every morning. The desk sergeant learned my voice. <em>"No news, Mr. Reed."</em> By the third month he stopped saying my name.

I printed four hundred flyers. Her face looks wrong on them. Photocopies eat the eyes first.

If you are reading this: I did look for her. Whatever else is true — I looked.

— T.R.`},
  n_grief:{title:"A LONG NOTE, ON EILEEN'S TABLE",body:
`The detective cost me two months' pay and gave me a folder. Inside the folder: places she wasn't.

I stood in the station where they said a woman like her bought a ticket. I asked strangers. You learn the exact face people make when they decide you're broken — the kindness with a lock on it.

The doctor adjusted the dosage again. He says the phone isn't ringing. He says nobody rings that line.

It rang this morning. It was her voice. She said <em>find the note</em>.

So I'm in her old flat, going through her pages like a thief, because giving up feels like a second funeral and I have not survived the first one yet.

— T.R.`},
  n_fridge:{title:"ON THE REFRIGERATOR · HER HANDWRITING",body:
`<div class="digits">10 — 34 — 56</div>
Three numbers on a magnet-note, in Eileen's small, certain hand.

<em>Pages,</em> Thomas thinks. <em>She always talked in pages.</em>

Her numbered notes are still here — in the books, in the boxes, in the drawer she always jammed.`},
  p10:{title:"HER NOTES · PAGE 10",body:
`<em>"…the super swears the wiring is fine but the lamp still hums like a wasp. T. says he'll fix it. T. says a lot of things at</em> nine seven six <em>o'clock and forgets them by morning, which is one of the reasons I</em> — "

<div class="digits">9 7 6</div>
The rest of the page is water-blurred. The number is circled. Twice.`},
  p34:{title:"HER NOTES · PAGE 34",body:
`<em>"…moving three floors and it may as well be three countries. Boxes: kitchen, books, winter. Things I am not taking:</em> three four five <em>reasons to stay alone."</em>

<div class="digits">3 4 5</div>
Underlined so hard the pen tore the paper.`},
  p56:{title:"HER NOTES · PAGE 56",body:
`<em>"…if I ever go quiet, it will not be because I stopped. Some things end at</em> six one five <em>and it isn't anybody's fault. Remember the ledge. Remember I chose every minute."</em>

<div class="digits">6 1 5</div>
The drawer she always jammed. She knew he'd be the one to open it.`},
};
const JOURNAL_ORDER=["n_8004","n_grief","n_fridge","p10","p34","p56"];
const collected=new Set();
function collectNote(id){ if(collected.has(id))return; collected.add(id); toast("Journal updated — TAB"); renderJournal(); }

/* ---------------- Inventory ---------------- */
const inv=new Set(); const invMeta={};
function give(id,ic,lbl){ inv.add(id); invMeta[id]={ic,lbl}; AU.key(); toast(lbl+" acquired"); renderInv(); }
function renderInv(){ const el=$("inv"); el.innerHTML="";
  const ids=[...inv]; for(let i=0;i<6;i++){ const s=document.createElement("div"); s.className="slot"+(ids[i]?" full":"");
    if(ids[i]){ s.innerHTML=`<div class="ic">${invMeta[ids[i]].ic}</div>${invMeta[ids[i]].lbl}`; } el.appendChild(s);} }
renderInv();

/* ---------------- UI: subtitles / objective / toast / overlays ---------------- */
let subTimer=null;
function say(who,text,dur){ const el=$("subtitle");
  el.innerHTML=(who?`<span class="who">${who}</span>`:"")+text;
  cancelLater(subTimer); subTimer=later(()=>el.innerHTML="",dur||Math.max(2600,text.length*55)); }
function setObjective(html){ $("objText").innerHTML=html; $("objective").classList.remove("fadein"); void $("objective").offsetWidth; $("objective").classList.add("fadein"); }
function toast(t){ const el=$("toast"); const d=document.createElement("div"); d.textContent=t; d.className="fadein"; el.appendChild(d); uiTimeout(()=>d.remove(),3800); }

let uiOpen=null;
function openNote(id){ uiOpen="note"; document.exitPointerLock?.();
  $("noteTitle").textContent=NOTES[id].title; $("noteBody").innerHTML=NOTES[id].body; $("noteOverlay").classList.add("show"); }
function closeNote(){ $("noteOverlay").classList.remove("show"); uiOpen=null; relock(); }
function openJournal(){ uiOpen="journal"; document.exitPointerLock?.(); renderJournal(); $("journalOverlay").classList.add("show"); }
function closeJournal(){ $("journalOverlay").classList.remove("show"); uiOpen=null; relock(); }
function renderJournal(){ const L=$("jList"); L.innerHTML="";
  JOURNAL_ORDER.forEach(id=>{ const d=document.createElement("div"); const got=collected.has(id);
    d.className="jt"+(got?" got":""); d.textContent=got?NOTES[id].title:"— unread —";
    if(got)d.onclick=()=>{ [...L.children].forEach(c=>c.classList.remove("sel")); d.classList.add("sel");
      $("jRead").innerHTML=NOTES[id].body.replaceAll('<div class="digits">','<div style="font-size:26px;letter-spacing:8px;text-align:center;margin:14px 0;color:#c8a070">'); };
    L.appendChild(d); });
  if(!collected.size)$("jRead").textContent="No entries yet. Thomas hasn't found the words — or the notes."; }

/* dial UI */
let dialed="";
function openDial(){ uiOpen="dial"; document.exitPointerLock?.(); dialed=""; updDial(); $("dialOverlay").classList.add("show");
  if(!collected.has("n_fridge")) say("THOMAS","A dial tone. Waiting. For what number?",3000); }
function closeDial(){ $("dialOverlay").classList.remove("show"); uiOpen=null; relock(); }
function updDial(){ $("dialDisp").textContent=dialed.replace(/(\d{3})(?=\d)/g,"$1-")||"\u00a0"; }
{ const pad=$("dialPad"); "123456789*0#".split("").forEach(k=>{ const b=document.createElement("button"); b.textContent=k;
    b.onclick=()=>{ if(/\d/.test(k)&&dialed.length<9){ dialed+=k; AU.dial(); updDial(); } }; pad.appendChild(b); });
  $("dialClear").onclick=()=>{dialed="";updDial();};
  $("dialHang").onclick=closeDial;
  $("dialCall").onclick=()=>{
    if(dialed===CFG.code){ closeDial(); solvePuzzle(); }
    else { AU.dead(); say(null,"A flat, dead tone. The line doesn't want that number."); dialed=""; updDial(); } }; }
let puzzleSolved=false;
function solvePuzzle(){ if(puzzleSolved)return; puzzleSolved=true;
  AU.blip(920,.4,"sine",.12); 
  later(()=>{ AU.thud(); piece1.visible=true; keyR.visible=true; ixPiece.enabled=true; ixKey.enabled=true;
    dread=Math.min(1,dread+.4);
    say(null,"The line clicks — and something drops behind you. Two somethings, onto her floor.");
    setObjective("Take what fell: <b>Puzzle Piece #1</b> and the <b>Old Restock key</b>.");
  },1400); }
function checkObjective(){
  if(inv.has("piece1")&&inv.has("key_restock")&&!figureShown){
    GS.elevG=true;
    setObjective("Down to the alley. The <b>elevator</b> is running now — ground floor, then the back door.");
    figureShown=true; figure.visible=true; figure.position.set(1.2,0,1.1); figureT=0; AU.drone(); dread=Math.min(1,dread+.5);
    later(()=>say(null,"At the far end of the corridor: a shape. Long hair drifting, as if underwater. It does not have a face. It is already leaving."),1200);
  } else if(collected.has("n_8004")&&!door8007Open){
    setObjective("<b>8007</b> is the last door. The far end of the corridor.");
  }
}

/* slice complete */
let startTime=0;
function finishSlice(){ finishGame("TRANSIT — DEBUG END",
  `<em style="color:#a89a7c">Run ended from the debug menu.</em>`); }

/* ---------------- Player, input, collision ---------------- */
const player={x:2.35,z:5.55,yaw:-1.34,pitch:0,vy:0,seated:true,floorY:0};
camera.rotation.order="YXZ";
const keys={};
addEventListener("keydown",e=>{ keys[e.code]=true;
  if(e.code==="Tab"){ e.preventDefault(); if(uiOpen==="journal")closeJournal(); else if(!uiOpen)openJournal(); }
  if(e.code==="KeyE"&&uiOpen==="note")closeNote();
  if(e.code==="Escape"){ if(uiOpen==="note")closeNote(); else if(uiOpen==="dial")closeDial(); else if(uiOpen==="journal")closeJournal(); else if(uiOpen==="elev")closeElev(); else if(uiOpen==="pause")closePause(); else if(!uiOpen&&running)openPause(false); }
  if(e.code==="Backquote"||e.code==="F1"||e.code==="F2"||e.key==="`"||e.key==="~"||e.key==="§"){ e.preventDefault(); if(!uiOpen||uiOpen==="debug")toggleDebug(); }
  if(e.code==="Escape"&&uiOpen==="debug")toggleDebug();
  if(e.code==="KeyF"&&!uiOpen&&!player.seated)toggleTorch();
  if(uiOpen==="dial"){ const m=e.code.match(/^(?:Digit|Numpad)(\d)$/); if(m&&dialed.length<9){ dialed+=m[1]; AU.dial(); updDial(); } }
});
addEventListener("keyup",e=>keys[e.code]=false);
function releaseKeys(){ for(const k in keys)keys[k]=false; }
addEventListener("blur",releaseKeys);
document.addEventListener("visibilitychange",()=>{ if(document.hidden)releaseKeys(); });
let locked=false;
document.addEventListener("pointerlockchange",()=>{ locked=document.pointerLockElement===$("c"); });
let relockTimer=0;
function requestGameLock(){
  if(!running||uiOpen||locked||document.pointerLockElement)return;
  try{
    const result=$("c").requestPointerLock?.();
    result?.catch?.(()=>{});
  }catch(e){}
}
function relock(){
  cancelLater(relockTimer);
  if(!running||uiOpen)return;
  // Pointer-lock exit is asynchronous; requesting in the same task throws
  // in Chromium. Deferring also lets the canvas click path recover gracefully.
  relockTimer=later(requestGameLock,80);
}
$("c").addEventListener("click",requestGameLock);
addEventListener("mousemove",e=>{ if(!locked||uiOpen)return;
  player.yaw-=e.movementX*.0022*SETTINGS.sens; player.pitch-=e.movementY*.0022*SETTINGS.sens;
  player.pitch=Math.max(-1.45,Math.min(1.45,player.pitch)); });

function collide(nx,nz){ const r=CFG.radius;
  for(const c of colliders){ if(!c.on||c.zone!==curZone)continue;
    const cx=Math.max(c.minX,Math.min(nx,c.maxX)), cz=Math.max(c.minZ,Math.min(nz,c.maxZ));
    let dx=nx-cx,dz=nz-cz; let d2=dx*dx+dz*dz;
    if(d2===0){ const l=nx-c.minX, rr=c.maxX-nx, n=nz-c.minZ, f=c.maxZ-nz, m=Math.min(l,rr,n,f);     // inside the box: leave by the nearest face
      if(m===l)nx=c.minX-r; else if(m===rr)nx=c.maxX+r; else if(m===n)nz=c.minZ-r; else nz=c.maxZ+r; }
    else if(d2<r*r){ const d=Math.sqrt(d2); const push=(r-d)/d; nx+=dx*push; nz+=dz*push; } }
  return [nx,nz]; }

/* flashlight */
const torch=new THREE.SpotLight(CFG.torch.color,0,CFG.torch.dist,CFG.torch.angle,.45,CFG.torch.decay);
const torchTarget=new THREE.Object3D(); _sceneAdd(torch); _sceneAdd(torchTarget); torch.target=torchTarget;
let torchOn=false, battery=100;
// The torch is held at the hip, not at the eye, so the shadows it throws are visible beside
// the things that cast them. Hard-edged on purpose: it suits the 240-line picture.
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.BasicShadowMap;
torch.castShadow=true; torch.shadow.mapSize.set(512,512); torch.shadow.camera.near=.2; torch.shadow.camera.far=CFG.torch.dist;
torch.shadow.bias=-.004; torch.shadow.normalBias=.03; torch.shadow.autoUpdate=false;
function toggleTorch(){ if(battery<=0&&!torchOn){AU.rattle();say("THOMAS","Dead. Of course.");return;}
  torchOn=!torchOn; AU.burst(.03,2000,.15,4); }

/* ---------------- Game flow ---------------- */
let running=false, dread=0, standT=0;
let phase="wake"; // wake → ringing → answered → play
const ixStand={enabled:false};
setObjective("…");
function beginGame(){
  enterPlayMode();
  startRide();
}
/* beat 0 — the ride in. Thomas is the last passenger on the last train: seated, the tunnel
   going by, his eyes moving over an empty carriage. The train then really does pull into the
   station (it is driven along the platform), the doors open, and control begins in the doorway. */
const ride={active:false,t:0,scroll:0,skipAt:0,fx:null,wall:null,lamps:[],glow:null,stopped:false,done:false};
const RIDE_KEYS=[[0,0,0],[4,.15,-.02],[7.5,1.15,-.05],[11,1.25,.02],[14.5,-1.1,-.04],[17,-1.2,.02],[19.5,-.25,-.78],[22,-.2,-.72],[24.5,0,-.05],[40,0,0]];
const RIDE_BRAKE=21, RIDE_DIST=55, RIDE_SPEED=14, RIDE_T=2*RIDE_DIST/RIDE_SPEED;   // constant-deceleration stop
function buildRideFx(){ if(ride.fx)return; const g=ride.fx=new THREE.Group();
  { const st=document.createElement("style"); st.textContent=`
      .cineBar{position:fixed;left:0;right:0;height:0;background:#000;z-index:42;transition:height 1.2s ease;pointer-events:none} #cineTop{top:0} #cineBot{bottom:0}
      html.cine .cineBar{height:11vh}
      html.cine #inv,html.cine #battery,html.cine #objective,html.cine #journalHint,html.cine #prompt,html.cine #toast{opacity:0!important}
      html.cine #subtitle{bottom:13vh}
      #cineSkip{position:fixed;right:18px;bottom:3.4vh;z-index:43;font:10px "Courier New",monospace;letter-spacing:3px;color:#8a9488;opacity:0;transition:opacity .8s;pointer-events:auto;cursor:pointer}
      html.cine #cineSkip.on{opacity:.8}`; document.head.appendChild(st);
    for(const id of["cineTop","cineBot"]){ const d=document.createElement("div"); d.id=id; d.className="cineBar"; document.body.appendChild(d); }
    const sk=document.createElement("div"); sk.id="cineSkip"; sk.textContent="E · SKIP"; sk.onclick=()=>{ if(ride.active&&!ride.done)finishRide(); }; document.body.appendChild(sk); }
  // what he sees when he looks down: his coat, his hands' worth of paper bag
  { const lap=ride.lap=new THREE.Group(), coat=lam(0x23262a);
    for(const sx of[-.13,.13]){ put(lap,box(.17,.13,.5,coat),sx,0,-.2,0,0,0); put(lap,box(.15,.42,.14,coat),sx,-.2,-.47); }
    put(lap,box(.2,.2,.09,lam(0xb8b0a0)),.02,.15,-.2,-.25,.2,0); put(lap,box(.2,.03,.09,lam(0x9a9284)),.02,.26,-.22,-.25,.2,0);   // the pharmacy bag, gone soft
    put(lap,box(.56,.3,.16,coat),0,.12,.06,.2);                                                                                  // coat front
    lap.position.set(-4,1.12,.36); lap.visible=false; arrTrain.add(lap); }
  const wt=tex((c,s)=>{ c.fillStyle="#0c0e10"; c.fillRect(0,0,s,s); for(let x=0;x<s;x+=32){ c.fillStyle="#14171a"; c.fillRect(x,0,5,s); }
    c.fillStyle="#1c2024"; c.fillRect(0,s*.3,s,3); c.fillRect(0,s*.36,s,2); c.fillRect(0,s*.72,s,5); grime(c,s,18,.5); speck(c,s,90,"rgba(70,76,80,.5)"); },128);
  wt.repeat.set(10,1); ride.wall=new THREE.Mesh(new THREE.PlaneGeometry(64,3.6),new THREE.MeshBasicMaterial({map:wt,fog:false})); ride.wall.position.set(0,1.5,-2.0); g.add(ride.wall);
  for(let i=0;i<8;i++){ const l=box(1.1,.12,.04,new THREE.MeshBasicMaterial({color:0xffdca8,fog:false})); l.position.set(0,1.82,-1.96); g.add(l); ride.lamps.push(l); }
  ride.glow=new THREE.PointLight(0xffd0a0,0,6.5,1.5); g.add(ride.glow);
  g.visible=false; _sceneAdd(g); }
function startRide(){
  buildRideFx(); setZone("arrival");
  Object.assign(ride,{active:true,t:0,scroll:0,stopped:false,done:false,skipAt:performance.now()+1500});
  player.seated=true; canStand=false; player.yaw=0; player.pitch=0; torchOn=false; keys.KeyE=false;
  setArrDoor(0); setObjective("…"); ride.lap.visible=true; document.documentElement.classList.add("cine"); $("cineSkip").classList.remove("on");
  try{ AU.trainStart(); }catch(e){}
  $("fader").style.transition="opacity 2400ms"; later(()=>{ $("fader").style.opacity=0; },350);
  later(()=>say(null,"The last train of the night. Eleven stops, and he has been its only passenger for nine of them.",5600),1200);
  later(()=>say(null,"Empty seats, each one still holding the shape of someone who got off.",4600),7800);
  later(()=>say(null,"A year since Eileen. He still rides the line that runs under her street.",4800),13400);
  later(()=>say("THOMAS","A prescription. A set of keys. Nothing else in these pockets worth the name.",4400),18800);
  later(()=>{ try{ AU.trainStop(); AU.trainArrive(); AU.stationStart(); }catch(e){} say(null,"Haldane. End of the line.",3600); },RIDE_BRAKE*1000+1500);
  rideTick(0);
}
function rideTick(dt){ if(!ride.active)return; ride.t+=dt; const t=ride.t;
  if(!ride.done&&keys.KeyE&&performance.now()>ride.skipAt){ keys.KeyE=false; finishRide(); return; }
  // where the train is: cruising deep in the tunnel, then one constant-deceleration stop at the platform
  const u=Math.max(0,Math.min(1,(t-RIDE_BRAKE)/RIDE_T)), v=t<RIDE_BRAKE?RIDE_SPEED:RIDE_SPEED*(1-u);
  arrTrain.position.x=911-RIDE_DIST*(1-u)*(1-u); ride.scroll+=v*dt;
  // his seat, and a little of the ride in his spine
  const jolt=Math.sin(t*9.1)*.004+Math.sin(t*23)*.002*(v/RIDE_SPEED);
  seatPos={x:arrTrain.position.x-4,y:TRAIN_FLOOR+1.2+jolt*(v>0?1:0),z:7.3+.36}; player.x=seatPos.x; player.z=seatPos.z;
  // where he looks
  let k=0; while(k<RIDE_KEYS.length-2&&t>RIDE_KEYS[k+1][0])k++;
  const A=RIDE_KEYS[k],B=RIDE_KEYS[k+1], f=Math.max(0,Math.min(1,(t-A[0])/(B[0]-A[0]))), e=f*f*(3-2*f);
  player.yaw=A[1]+(B[1]-A[1])*e+Math.sin(t*.7)*.015; player.pitch=A[2]+(B[2]-A[2])*e;
  // the tunnel going by, until the station takes over
  const g=ride.fx; g.visible=seatPos.x<897; g.position.set(seatPos.x,0,7.3);
  ride.wall.material.map.offset.x=(ride.scroll/6.4)%1;
  ride.lamps.forEach((l,i)=>{ l.position.x=((i*8-ride.scroll)%64+64)%64-32; });
  const near=ride.lamps.reduce((a,l)=>Math.abs(l.position.x)<Math.abs(a.position.x)?l:a); ride.glow.position.set(near.position.x,2.0,-1.3);
  ride.glow.intensity=g.visible?1.5*Math.max(0,1-Math.abs(near.position.x)/5):0;
  // stopped: chime, doors, and he is on his feet in the doorway
  if(u>=1&&!ride.stopped){ ride.stopped=true; ride.t0=t; try{ AU.doorChime(); }catch(e){} }
  if(ride.stopped){ setArrDoor(Math.min(1,Math.max(0,(t-ride.t0-.7)/1.1))); if(t-ride.t0>2.4&&!ride.done){ ride.done=true; fadeTo(()=>finishRide(),500); } }
  $("cineSkip").classList.toggle("on",performance.now()>ride.skipAt&&!ride.stopped);
}
/* ---------------- Scripted camera (cutscenes) ----------------
   keys: [[t, x, eyeY, z, yaw, pitch], ...]. Uses the seated-camera path in tick, so the
   player has no control while it runs. step(t,dt) is an optional per-frame hook. */
const cine={active:false,t:0,keys:null,onEnd:null,step:null,bars:true};
function eyeNow(){ return [player.x,camera.position.y,player.z,player.yaw,player.pitch]; }
function nearAngle(a,ref){ while(a-ref>Math.PI)a-=Math.PI*2; while(a-ref<-Math.PI)a+=Math.PI*2; return a; }
function playCine(keys,onEnd,o={}){ buildRideFx();
  let ref=keys[0][4]; for(const k of keys){ k[4]=nearAngle(k[4],ref); ref=k[4]; }
  Object.assign(cine,{active:true,t:0,keys,onEnd,step:o.step||null}); player.seated=true; canStand=false; torchOn=false; releaseKeys();
  document.exitPointerLock?.(); if(o.bars!==false)document.documentElement.classList.add("cine"); $("cineSkip").classList.remove("on"); cineTick(0); }
function cineTick(dt){ if(!cine.active)return; cine.t+=dt; const K=cine.keys, t=cine.t; let i=0; while(i<K.length-2&&t>K[i+1][0])i++;
  const A=K[i],B=K[i+1], f=Math.max(0,Math.min(1,(t-A[0])/Math.max(.001,B[0]-A[0]))), e=f*f*(3-2*f), L=n=>A[n]+(B[n]-A[n])*e;
  seatPos={x:L(1),y:L(2),z:L(3)}; player.x=seatPos.x; player.z=seatPos.z; player.yaw=L(4); player.pitch=L(5);
  if(cine.step)cine.step(t,dt);
  if(t>=K[K.length-1][0]){ cine.active=false; cine.step=null; const cb=cine.onEnd; cine.onEnd=null; cb&&cb(); } }
function endCine(x,z,yaw){ document.documentElement.classList.remove("cine"); player.seated=false; canStand=true;
  if(x!==undefined){ player.x=x; player.z=z; player.yaw=yaw; } player.pitch=0; player.floorY=(ZONES[curZone].ground?ZONES[curZone].ground(player.x,player.z):0)||0; relock(); }

function finishRide(){
  ride.active=false; ride.done=true; clearGameTimers(); if(ride.fx)ride.fx.visible=false;
  ride.lap.visible=false; document.documentElement.classList.remove("cine");
  arrTrain.position.x=911; setArrDoor(1); $("subtitle").innerHTML=""; $("fader").style.opacity=0; travelLock=false;
  try{ AU.trainStop(); AU.stationStart(); }catch(e){}
  startArrival();
}
/* beat 1 — arrival: the last train pulls in, doors open, step onto the platform */
function startArrival(){
  setZone("arrival"); player.seated=false; canStand=true;
  player.x=911; player.z=6.5; player.floorY=TRAIN_FLOOR; player.yaw=0; player.pitch=0;   // on his feet in the open doorway, platform ahead
  try{ AU.stationStart(); }catch(e){}
  say(null,"The last train. It lets him out into a station the colour of an old bruise. Nobody else gets off.",6200);
  setObjective("Step off the train. <b>Find the way up to the street.</b>");
  // doors are already open on arrival; close them a beat after the player would step off
  later(()=>{ try{AU.doorChime();}catch(e){} },3600);
}
$("startBtn").onclick=beginGame;

let ringing=false;
function standUp(){ player.seated=false; setObjective("The telephone is ringing. <b>Answer it.</b>");
  later(()=>{ ringing=true; AU.ringStart();
    say(null,"The landline. Nobody rings that line. The doctor says nobody rings that line."); },900); }

/* answer phone (8001) */
interact(phone1,"Answer the telephone",()=>{
  if(!ringing){ say("THOMAS","Silent now. It said what it came to say."); return; }
  ringing=false; AU.ringStop(); phoneAnswered=true;
  const lines=[["EILEEN — ON THE LINE","Thomas."],["EILEEN","Don't ask where I am. You always ask, and it always hurts you."],
    ["EILEEN","Find the note. My old flat. Eight-oh-seven. You remember the number."],[null,"A click. A dial tone. A year of silence, resumed."]];
  let t=0; lines.forEach((l,i)=>{ later(()=>say(l[0],l[1],i===3?4200:3400), t); t+= i===3?3600:3600; });
  later(()=>{ setObjective("Leave <b>flat 8001</b>. Her old flat is <b>8007</b>."); },t);
});

/* ════════════════════════════════════════════════════════════════
   FULL GAME — beats 4→18, both endings (per NOIR-SCENE-FLOW v2)
   ════════════════════════════════════════════════════════════════ */

/* ---------- new audio ---------- */
AU.ding=function(){ this.blip(1180,.35,"sine",.15); this.blip(880,.5,"sine",.1); };
AU.sting=function(){ this.burst(.5,2400,.4,8); this.blip(66,1.6,"sawtooth",.3,-30); };
AU.genHum=function(on){ if(!this.ctx)return;
  if(on&&!this._gen){ const o=this.ctx.createOscillator(),g=this.ctx.createGain();
    o.type="sawtooth"; o.frequency.value=38; g.gain.value=.0001;
    g.gain.setTargetAtTime(.07,this.ctx.currentTime,.4);
    const lp=this.ctx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=180;
    o.connect(lp);lp.connect(g);g.connect(this.master); o.start(); this._gen={o,g}; }
  else if(!on&&this._gen){ this._gen.g.gain.setTargetAtTime(.0001,this.ctx.currentTime,.2);
    const G=this._gen; later(()=>G.o.stop(),800); this._gen=null; } };
AU.mnote=function(f){ if(!this.ctx)return; const t=this.ctx.currentTime;
  const o=this.ctx.createOscillator(),o2=this.ctx.createOscillator(),g=this.ctx.createGain();
  o.type="sine"; o.frequency.value=f; o2.type="sine"; o2.frequency.value=f*2.01;
  g.gain.setValueAtTime(.22,t); g.gain.exponentialRampToValueAtTime(.0001,t+1.6);
  o.connect(g);o2.connect(g);g.connect(this.master); o.start(t);o2.start(t);o.stop(t+1.7);o2.stop(t+1.7); };
AU.melody=function(){ const N=[659,523,587,392,523,659,784,659]; N.forEach((f,i)=>later(()=>this.mnote(f),i*520)); };
AU.discord=function(){ this.mnote(233); later(()=>this.mnote(247),60); };
AU.valve=function(){ this.burst(.2,500,.25,2); this.blip(140,.5,"sawtooth",.08,-40); };
AU.splash=function(){ this.burst(.6,700,.2,1); later(()=>this.burst(.5,500,.15,1),300); };
AU.sirenStart=function(){ if(this._sir)return; this._sir=setInterval(()=>{
  this.blip(660,.7,"sine",.02,120); later(()=>this.blip(780,.7,"sine",.018,-120),700); },1600); };
AU.sirenStop=function(){ clearInterval(this._sir); this._sir=null; };
AU.tenantsStart=function(){ if(this._ten)return; this._ten=setInterval(()=>{
  const r=Math.random();
  if(r<.4){ for(let i=0;i<4;i++)later(()=>this.burst(.12,300+Math.random()*300,.05,2),i*160); }
  else if(r<.7){ this.blip(760,.9,"sine",.03,-220); later(()=>this.blip(700,.7,"sine",.025,-180),1000); }
  },2600); };
AU.tenantsStop=function(){ clearInterval(this._ten); this._ten=null; };
AU.trainStart=function(){ if(!this.ctx||this._tr)return; const s=this.ctx.createBufferSource(); s.buffer=this.noiseBuf(3); s.loop=true;
  const lp=this.ctx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=140;
  const g=this.ctx.createGain(); g.gain.value=.0001; g.gain.setTargetAtTime(.14,this.ctx.currentTime,1.2);
  s.connect(lp);lp.connect(g);g.connect(this.master); s.start(); this._tr={s,g}; };
AU.trainStop=function(){ if(this._tr){ this._tr.g.gain.setTargetAtTime(.0001,this.ctx.currentTime,.5);
  const T=this._tr; later(()=>T.s.stop(),1500); this._tr=null; } };

/* ---------- opening / environment audio ---------- */
AU.stationStart=function(){ if(!this.ctx||this._stn)return;   // low subway hum + faint fluorescent buzz
  const s=this.ctx.createBufferSource(); s.buffer=this.noiseBuf(3); s.loop=true;
  const lp=this.ctx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=90;
  const g=this.ctx.createGain(); g.gain.value=.0001; g.gain.setTargetAtTime(.09,this.ctx.currentTime,1.5);
  s.connect(lp);lp.connect(g);g.connect(this.master); s.start();
  const buzz=this.ctx.createOscillator(); buzz.type="sawtooth"; buzz.frequency.value=120;
  const bg=this.ctx.createGain(); bg.gain.value=.006; const bhp=this.ctx.createBiquadFilter(); bhp.type="bandpass"; bhp.frequency.value=1600; bhp.Q.value=8;
  buzz.connect(bhp);bhp.connect(bg);bg.connect(this.master); buzz.start();
  this._stn={s,g,buzz,bg}; };
AU.stationStop=function(){ if(this._stn){ const T=this._stn; T.g.gain.setTargetAtTime(.0001,this.ctx.currentTime,.6); T.bg.gain.setTargetAtTime(.0001,this.ctx.currentTime,.6);
  later(()=>{try{T.s.stop();T.buzz.stop();}catch(e){}},1500); this._stn=null; } };
AU.trainArrive=function(){ if(!this.ctx)return;   // approaching train: rising rumble + brake squeal, then hiss of doors
  const s=this.ctx.createBufferSource(); s.buffer=this.noiseBuf(4);
  const lp=this.ctx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.setValueAtTime(60,this.ctx.currentTime); lp.frequency.linearRampToValueAtTime(260,this.ctx.currentTime+2.4);
  const g=this.ctx.createGain(); g.gain.setValueAtTime(.0001,this.ctx.currentTime); g.gain.linearRampToValueAtTime(.2,this.ctx.currentTime+2.2); g.gain.setTargetAtTime(.0001,this.ctx.currentTime+3.4,.7);
  s.connect(lp);lp.connect(g);g.connect(this.master); s.start(); s.stop(this.ctx.currentTime+5);
  // brake squeal
  const sq=this.ctx.createOscillator(); sq.type="sawtooth"; sq.frequency.setValueAtTime(1400,this.ctx.currentTime+2.0); sq.frequency.linearRampToValueAtTime(600,this.ctx.currentTime+3.4);
  const sqg=this.ctx.createGain(); sqg.gain.setValueAtTime(.0001,this.ctx.currentTime+2.0); sqg.gain.linearRampToValueAtTime(.03,this.ctx.currentTime+2.4); sqg.gain.setTargetAtTime(.0001,this.ctx.currentTime+3.3,.3);
  const sqf=this.ctx.createBiquadFilter(); sqf.type="bandpass"; sqf.frequency.value=1200; sqf.Q.value=6;
  sq.connect(sqf);sqf.connect(sqg);sqg.connect(this.master); sq.start(); sq.stop(this.ctx.currentTime+4);
  later(()=>this.doorChime&&this.doorChime(),3400); };
AU.doorChime=function(){ if(!this.ctx)return; [880,1174].forEach((f,i)=>{ const o=this.ctx.createOscillator(); o.type="sine"; o.frequency.value=f;
  const g=this.ctx.createGain(); g.gain.value=.0001; const t=this.ctx.currentTime+i*.18; g.gain.setTargetAtTime(.08,t,.02); g.gain.setTargetAtTime(.0001,t+.16,.12);
  o.connect(g);g.connect(this.master); o.start(t); o.stop(t+.7); }); };
AU.doorHiss=function(){ if(!this.ctx)return; const s=this.ctx.createBufferSource(); s.buffer=this.noiseBuf(1);
  const bp=this.ctx.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=2200; bp.Q.value=.7;
  const g=this.ctx.createGain(); g.gain.value=.0001; g.gain.setTargetAtTime(.05,this.ctx.currentTime,.03); g.gain.setTargetAtTime(.0001,this.ctx.currentTime+.4,.2);
  s.connect(bp);bp.connect(g);g.connect(this.master); s.start(); s.stop(this.ctx.currentTime+1); };
AU.trainDepart=function(){ if(!this.ctx)return;   // doors hiss shut, motor whine climbs, rumble recedes
  this.doorHiss();
  const o=this.ctx.createOscillator(); o.type="triangle"; o.frequency.setValueAtTime(70,this.ctx.currentTime+.4); o.frequency.linearRampToValueAtTime(240,this.ctx.currentTime+3.2);
  const g=this.ctx.createGain(); g.gain.setValueAtTime(.0001,this.ctx.currentTime+.4); g.gain.linearRampToValueAtTime(.05,this.ctx.currentTime+1.0); g.gain.setTargetAtTime(.0001,this.ctx.currentTime+3.0,.6);
  o.connect(g);g.connect(this.master); o.start(this.ctx.currentTime+.4); o.stop(this.ctx.currentTime+5);
  const s=this.ctx.createBufferSource(); s.buffer=this.noiseBuf(4); const lp=this.ctx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=200;
  const sg=this.ctx.createGain(); sg.gain.setValueAtTime(.16,this.ctx.currentTime+.5); sg.gain.setTargetAtTime(.0001,this.ctx.currentTime+2.2,.9);
  s.connect(lp);lp.connect(sg);sg.connect(this.master); s.start(this.ctx.currentTime+.5); s.stop(this.ctx.currentTime+6); };
AU.windStart=function(){ if(!this.ctx||this._wind)return;   // wet night wind for the street approach
  const s=this.ctx.createBufferSource(); s.buffer=this.noiseBuf(4); s.loop=true;
  const bp=this.ctx.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=500; bp.Q.value=.6;
  const g=this.ctx.createGain(); g.gain.value=.0001; g.gain.setTargetAtTime(.05,this.ctx.currentTime,2);
  s.connect(bp);bp.connect(g);g.connect(this.master); s.start();
  this._windLfo=setInterval(()=>{ if(this._wind)g.gain.setTargetAtTime(.03+Math.random()*.05,this.ctx.currentTime,1.4); },2600);
  this._wind={s,g}; };
AU.windStop=function(){ if(this._wind){ const T=this._wind; T.g.gain.setTargetAtTime(.0001,this.ctx.currentTime,1); clearInterval(this._windLfo);
  later(()=>{try{T.s.stop();}catch(e){}},1500); this._wind=null; } };
AU.stepStair=function(){ this.burst(.06,180,.12,1.4); later(()=>this.burst(.03,120,.08,1.2),40); };  // heavier footfall on concrete steps
/* ── ambient one-shots (ref: SH2 — distant metal, unseen drips, wind gusts, low thunder) ── */
AU.thunder=function(){ if(!this.ctx)return; const t=this.ctx.currentTime;
  const s=this.ctx.createBufferSource(); s.buffer=this.noiseBuf(3.4);
  const lp=this.ctx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.setValueAtTime(300,t); lp.frequency.exponentialRampToValueAtTime(55,t+3.0);
  const g=this.ctx.createGain(); g.gain.setValueAtTime(.0001,t); g.gain.exponentialRampToValueAtTime(.15,t+.3); g.gain.exponentialRampToValueAtTime(.0001,t+3.2);
  s.connect(lp);lp.connect(g);g.connect(this.master); s.start(t); s.stop(t+3.4); };
AU.clank=function(){ const f=480+Math.random()*320; this.burst(.09,f,.045,7); later(()=>this.burst(.14,f*.72,.028,6),130+Math.random()*90); };
AU.drip=function(){ const f=1800+Math.random()*1000; this.blip(f,.09,"sine",.05,-600); };
AU.pipeKnock=function(){ this.burst(.05,240,.09,2.5); later(()=>this.burst(.05,225,.06,2.5),110); later(()=>this.burst(.04,255,.045,2.5),265); };
AU.gust=function(){ if(!this.ctx)return; const t=this.ctx.currentTime; const s=this.ctx.createBufferSource(); s.buffer=this.noiseBuf(2.6);
  const bp=this.ctx.createBiquadFilter(); bp.type="bandpass"; bp.Q.value=.8;
  bp.frequency.setValueAtTime(380,t); bp.frequency.exponentialRampToValueAtTime(880,t+1.1); bp.frequency.exponentialRampToValueAtTime(300,t+2.4);
  const g=this.ctx.createGain(); g.gain.setValueAtTime(.0001,t); g.gain.exponentialRampToValueAtTime(.09,t+.9); g.gain.exponentialRampToValueAtTime(.0001,t+2.5);
  s.connect(bp);bp.connect(g);g.connect(this.master); s.start(t); s.stop(t+2.6); };
AU.flies=function(){ if(!this.ctx)return; const t=this.ctx.currentTime; const o=this.ctx.createOscillator(); o.type="sawtooth"; o.frequency.setValueAtTime(185,t);
  const lfo=this.ctx.createOscillator(); lfo.frequency.value=11; const lg=this.ctx.createGain(); lg.gain.value=42; lfo.connect(lg); lg.connect(o.frequency);
  const g=this.ctx.createGain(); g.gain.setValueAtTime(.0001,t); g.gain.linearRampToValueAtTime(.011,t+.3); g.gain.linearRampToValueAtTime(.0001,t+1.6);
  o.connect(g);g.connect(this.master); o.start(t); lfo.start(t); o.stop(t+1.7); lfo.stop(t+1.7); };
AU.citySiren=function(){ if(!this.ctx)return; const t=this.ctx.currentTime; const o=this.ctx.createOscillator(); o.type="triangle";
  const g=this.ctx.createGain(); g.gain.setValueAtTime(.0001,t); g.gain.linearRampToValueAtTime(.016,t+.8); g.gain.linearRampToValueAtTime(.0001,t+4.2);
  o.frequency.setValueAtTime(620,t); for(let i=0;i<4;i++){ o.frequency.linearRampToValueAtTime(870,t+.6+i); o.frequency.linearRampToValueAtTime(620,t+1.1+i); }
  o.connect(g);g.connect(this.master); o.start(t); o.stop(t+4.4); };
AU.elevRide=function(){ if(!this.ctx)return; const t=this.ctx.currentTime;
  const o=this.ctx.createOscillator(); o.type="sawtooth"; o.frequency.setValueAtTime(58,t);
  o.frequency.linearRampToValueAtTime(76,t+.5); o.frequency.linearRampToValueAtTime(52,t+1.3);
  const g=this.ctx.createGain(); g.gain.setValueAtTime(.0001,t); g.gain.linearRampToValueAtTime(.055,t+.2); g.gain.linearRampToValueAtTime(.0001,t+1.4);
  const s=this.ctx.createBufferSource(); s.buffer=this.noiseBuf(1.5);
  const lp2=this.ctx.createBiquadFilter(); lp2.type="lowpass"; lp2.frequency.value=190;
  const g2=this.ctx.createGain(); g2.gain.setValueAtTime(.045,t); g2.gain.linearRampToValueAtTime(.0001,t+1.4);
  o.connect(g);g.connect(this.master); s.connect(lp2);lp2.connect(g2);g2.connect(this.master);
  o.start(t); s.start(t); o.stop(t+1.5); s.stop(t+1.5); };
AU.tick=function(){ this.burst(.015,2100,.035,9); };
/* ── story-level one-shots: sounds that belong to someone ── */
AU.tvMurmur=function(){ if(!this.ctx)return; const t=this.ctx.currentTime;      // behind 8002's door
  const s=this.ctx.createBufferSource(); s.buffer=this.noiseBuf(2.2);
  const bp=this.ctx.createBiquadFilter(); bp.type="bandpass"; bp.Q.value=2.2;
  bp.frequency.setValueAtTime(340,t); bp.frequency.linearRampToValueAtTime(520,t+.7);
  bp.frequency.linearRampToValueAtTime(280,t+1.4); bp.frequency.linearRampToValueAtTime(430,t+2.0);
  const g=this.ctx.createGain(); g.gain.setValueAtTime(.0001,t); g.gain.linearRampToValueAtTime(.014,t+.4);
  g.gain.linearRampToValueAtTime(.0001,t+2.1);
  s.connect(bp);bp.connect(g);g.connect(this.master); s.start(t); s.stop(t+2.2);
  later(()=>this.blip(900+Math.random()*300,.3,"sine",.006,-200),600+Math.random()*600); };
AU.pianoFar=function(){ if(!this.ctx)return; const t0=this.ctx.currentTime;      // flat 2104 practising at midnight
  const scale=[523,587,659,698,784], run=2+Math.floor(Math.random()*3);
  for(let i=0;i<=run;i++){ const wrong=(i===run&&Math.random()<.5);
    const f=wrong?scale[Math.min(4,i)]*1.06:scale[Math.min(4,i)];
    const t=t0+i*.42+Math.random()*.05;
    const o=this.ctx.createOscillator(); o.type="triangle"; o.frequency.value=f/2;
    const g=this.ctx.createGain(); g.gain.setValueAtTime(.0001,t); g.gain.exponentialRampToValueAtTime(.02,t+.02);
    g.gain.exponentialRampToValueAtTime(.0001,t+1.1);
    o.connect(g);g.connect(this.master); o.start(t); o.stop(t+1.2);
    if(wrong)break; } };
AU.heartbeat=function(){ this.burst(.09,52,.16,1.1); later(()=>this.burst(.07,48,.12,1.1),320); };
AU.paGarble=function(){ if(!this.ctx)return; const t=this.ctx.currentTime;       // an announcement in no language
  const o=this.ctx.createOscillator(); o.type="square";
  const bp=this.ctx.createBiquadFilter(); bp.type="bandpass"; bp.frequency.value=820; bp.Q.value=5;
  const g=this.ctx.createGain(); g.gain.setValueAtTime(.0001,t);
  for(let i=0;i<5;i++){ g.gain.linearRampToValueAtTime(.009,t+.15+i*.32); g.gain.linearRampToValueAtTime(.002,t+.3+i*.32); }
  g.gain.linearRampToValueAtTime(.0001,t+1.9);
  o.frequency.setValueAtTime(160,t);
  for(let i=0;i<5;i++)o.frequency.linearRampToValueAtTime(120+Math.random()*120,t+.2+i*.32);
  o.connect(bp);bp.connect(g);g.connect(this.master); o.start(t); o.stop(t+2.0); };
AU.doorHeavy=function(){ if(!this.ctx)return; this.burst(.12,90,.2,2); const o=this.ctx.createOscillator(); o.type="sine"; o.frequency.value=70;
  const g=this.ctx.createGain(); g.gain.value=.0001; g.gain.setTargetAtTime(.09,this.ctx.currentTime,.01); g.gain.setTargetAtTime(.0001,this.ctx.currentTime+.2,.15);
  o.connect(g);g.connect(this.master); o.start(); o.stop(this.ctx.currentTime+.6); };

/* ---------- new notes (journal grows to 11) ---------- */
Object.assign(NOTES,{
  n_order1:{title:"PINNED BY THE GENERATOR · HER HAND",body:
`A page torn from her notebook, pinned where only a caretaker would look. Years of damp; her writing survives it.

<em>"The music box on the roof still works. You have to play it the way she showed me:</em> the meter first, then the wall. <em>The rest of the song is up there with the rain."</em>

Thomas reads it twice. She left instructions in places he was never meant to go — or exactly the places she knew he would end up.`},
  n_boxes:{title:"HIDDEN IN A BOX · GIVING UP",body:
`Month eleven. I stopped printing flyers.

Not because I stopped believing. Because the print shop man had started giving them to me for free, and his pity weighed more than the paper.

I know what everyone thinks. I know what the doctor thinks. Some nights I catch myself thinking it too, and then I open a box, any box, and I look for her in it — because the alternative is closing all the boxes forever.

Eleven months of opening boxes.

— T.R.`},
  n_order2:{title:"TAPED INSIDE THE TERRACE DOOR",body:
`Her hand again — older ink, from when this roof was theirs:

<em>"If the tank is empty the third chime sinks. Turn the pipes the way the rain would:</em> two drops, then one, then three. <em>Fill it and the chime floats up to you.

After the wall — the water. And the last note is where the song always ended: where we sat."</em>

The meter. The wall. The water. And the place where they sat.`},
  n_terrace:{title:"HIDDEN UNDER THE MUSIC BOX",body:
`Month twelve. Tonight I followed a voice up twenty-one floors because it sounded like her, and I am not sure anymore which side of my medication the voice lives on.

This is the last place we were happy. If I have been searching for anything this year, it was not an address. It was a night on this roof, counting strange cars, her shoulder against mine, the rain holding off just long enough.

I give up the search. I do not give up her.

— T.R.`},
  n_letter:{title:"IN THE SAFE · EILEEN'S LETTER",body:
`Thomas.

If you are reading this, you finally opened the safe, which means you finally stopped looking outward and looked in the one place I asked you not to. I knew you would. It's why I loved you.

I am not missing. I am ill — the quiet kind, the certain kind, the kind with a calendar. The doctors gave me a year, and I could not spend that year watching you watch me disappear. You have lost enough people in rooms. I would not become another room.

I went home. You know the town; you know the porch; you used to say the trains there sounded like the ones here if you closed your eyes.

You looked for me. I know you did. You were never going to find me, and you were never going to stop, and both of those things are you, and I love both of them.

If there is time left when you read this — come. Not to save me. Just to sit. Like the roof.

Every minute was chosen.

— E.`},
});
JOURNAL_ORDER.push("n_order1","n_boxes","n_order2","n_terrace","n_letter");

/* ---------- new textures ---------- */
TEX.asphalt=tex((g,s)=>{ g.fillStyle="#181a1e"; g.fillRect(0,0,s,s); speck(g,s,300,"rgba(60,64,72,.5)");
  speck(g,s,60,"rgba(110,120,140,.35)"); grime(g,s,14,.3,"10,12,20"); });
TEX.brickExt=tex((g,s)=>{ g.fillStyle="#3a2622"; g.fillRect(0,0,s,s);
  for(let y=0;y<s;y+=22){ for(let x=(y/22%2)*24-24;x<s;x+=48){ g.fillStyle=`rgb(${70+Math.random()*22|0},${42+Math.random()*14|0},${36+Math.random()*10|0})`;
    g.fillRect(x+2,y+2,44,18); } } grime(g,s,26,.4,"12,10,10"); });
TEX.mossBrick=tex((g,s)=>{ g.fillStyle="#2e2020"; g.fillRect(0,0,s,s);
  for(let y=0;y<s;y+=22){ for(let x=(y/22%2)*24-24;x<s;x+=48){ g.fillStyle=`rgb(${88+Math.random()*20|0},${40+Math.random()*12|0},${34+Math.random()*10|0})`;
    g.fillRect(x+2,y+2,44,18); } }
  for(let i=0;i<70;i++){ const x=Math.random()*s,y=Math.random()*s,r=6+Math.random()*22;
    const gr=g.createRadialGradient(x,y,1,x,y,r); gr.addColorStop(0,"rgba(58,86,40,.5)"); gr.addColorStop(1,"rgba(58,86,40,0)");
    g.fillStyle=gr; g.fillRect(x-r,y-r,r*2,r*2); } grime(g,s,20,.35,"8,12,8"); });
TEX.dreamWall=tex((g,s)=>{ g.fillStyle="#8e9092"; g.fillRect(0,0,s,s);
  for(let i=0;i<10;i++){ g.fillStyle=`rgba(255,255,255,${.05+Math.random()*.08})`;
    g.fillRect(Math.random()*s,0,2+Math.random()*3,s); } grime(g,s,10,.12,"60,60,66"); });
TEX.crate=tex((g,s)=>{ g.fillStyle="#6a4e2e"; g.fillRect(0,0,s,s);
  g.strokeStyle="#40301c"; g.lineWidth=8; g.strokeRect(4,4,s-8,s-8); g.beginPath();
  g.moveTo(4,4); g.lineTo(s-4,s-4); g.moveTo(s-4,4); g.lineTo(4,s-4); g.stroke();
  grime(g,s,12,.25,"40,28,14"); });
TEX.skyline=tex((g,s)=>{ g.fillStyle="#05070c"; g.fillRect(0,0,s,s); let x=0;
  while(x<s){ const w=14+Math.random()*26,h=s*(.25+Math.random()*.5);
    g.fillStyle="#0b0e16"; g.fillRect(x,s-h,w-2,h);
    for(let wy=s-h+6;wy<s-8;wy+=10)for(let wx=x+3;wx<x+w-6;wx+=7)
      if(Math.random()<.13){ g.fillStyle=Math.random()<.7?"rgba(210,180,110,.8)":"rgba(140,190,210,.7)"; g.fillRect(wx,wy,3,4);}
    x+=w; } });

/* ---------- rain ---------- */
const rainGeo=new THREE.BufferGeometry();
const RAIN_N=520, RAIN_LEN=.42;   // each drop is a short slanted streak, not a square sprite
{ const P=new Float32Array(RAIN_N*6); for(let i=0;i<RAIN_N;i++){ const x=(Math.random()-.5)*22,y=Math.random()*7,z=(Math.random()-.5)*22;
    P.set([x,y,z, x+.05,y+RAIN_LEN,z],i*6); }
  rainGeo.setAttribute("position",new THREE.BufferAttribute(P,3)); }
const rainPts=new THREE.LineSegments(rainGeo,new THREE.LineBasicMaterial({color:0x8fa2b8,transparent:true,opacity:.34}));
rainPts.frustumCulled=false; _sceneAdd(rainPts);

/* ---------- shared full-game state ---------- */
const GS={elevG:false,elev21:false,restockUnlocked:false,generatorOn:false,boxPhase:false,
  boxTries:0,boxFound:{key:false,piece:false,note:false},alley2:false,photoTaken:false,
  terraceUnlocked:false,pipeStep:0,tankFilled:false,nodeStep:0,piece3:false,
  ledgeOn:false,piece4:false,safeKey:false,safeOpen:false,metroOpen:false,
  chase:false,dream1Done:false,ending:null,pipeFails:0,nodeFails:0};
let seatPos={x:2.35,y:1.05,z:5.55}, canStand=true;
const PIPE_ORDER=[2,1,3], NODE_ORDER=[2,1,3,4];

/* ---------- new prop factories ---------- */
function mkStreetLamp(){ const g=group();
  put(g,rod(.1,.13,.5,8,M.metalDark),0,.25,0);                                              // cast base
  put(g,rod(.045,.07,4.0,6,M.metalDark),0,2.4,0);
  put(g,box(.76,.05,.05,M.metalDark),.34,4.36,0,0,0,.08); put(g,box(.4,.03,.03,M.metalDark),.2,4.16,0,0,0,.6);   // arm + stay
  put(g,box(.38,.09,.2,M.metalDark),.66,4.34,0);
  put(g,box(.3,.03,.14,new THREE.MeshBasicMaterial({color:0xf0b860})),.66,4.285,0);
  const L=new THREE.PointLight(0xd89448,1.25,9.5,1.4); L.position.set(.66,4.0,0); g.add(L); g.userData.light=L;
  // the cone of rain the lamp makes visible
  const cone=new THREE.Mesh(new THREE.ConeGeometry(1.25,4.0,14,1,true),new THREE.MeshBasicMaterial({color:0xd89448,transparent:true,opacity:.03,
    blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,fog:false})); put(g,cone,.66,2.28,0);
  return g; }
function mkDumpster(){ const g=group(); const gr=lam(0x2a4030), dk=lam(0x1c2a20);
  put(g,box(1.6,.8,.8,gr),0,.52,0);
  for(const a of[-.55,0,.55])put(g,box(.06,.8,.82,dk),a,.52,0);                             // pressed ribs
  put(g,box(1.64,.05,.84,dk),0,.94,0);
  put(g,box(.78,.05,.82,dk),-.41,.99,-.02,.1); put(g,box(.78,.05,.82,dk),.41,1.12,-.3,.9);  // one lid shut, one thrown back
  for(const a of[-.84,.84])put(g,box(.06,.1,.3,M.metalDark),a,.7,0);                        // lift pockets
  for(const[a,b]of[[-.65,-.3],[.65,-.3],[-.65,.3],[.65,.3]])put(g,rod(.07,.07,.05,8,M.rubber),a,.07,b,0,0,Math.PI/2);
  put(g,box(1.2,.16,.004,lam(0x4a3220)),.1,.3,.403);                                        // rust skirt
  put(g,box(.4,.3,.3,lam(0x121416)),.45,1.05,.05,0,.3,.1);                                  // a bag that didn't fit
  return g; }
function mkGenerator(){ const g=group();
  put(g,box(1.34,.08,.74,M.metalDark),0,.1,0); for(const a of[-.55,.55])put(g,box(.1,.06,.7,M.rubber),a,.03,0);   // skid
  put(g,box(.62,.62,.6,lam(0x3a4038)),-.3,.46,0);                                           // alternator housing
  for(let i=0;i<6;i++)put(g,box(.5,.02,.61,M.black),-.3,.24+i*.09,.004);                    // cooling slats
  put(g,box(.5,.5,.5,M.metalDark),.36,.4,0);                                                // engine block
  for(let i=0;i<5;i++)put(g,box(.42,.025,.56,M.metal),.36,.68+i*.045,0);                    // fins
  put(g,box(.56,.2,.4,lam(0x6a2a20)),.3,1.0,0); put(g,rod(.05,.05,.03,8,M.black),.4,1.11,0);   // fuel tank + cap
  put(g,rod(.035,.035,.5,6,M.metal),.62,.75,-.2); put(g,rod(.06,.06,.2,8,M.metalDark),.62,1.05,-.2);   // exhaust
  put(g,box(.3,.24,.04,M.metal),-.3,.92,.3,-.3); 
  put(g,rod(.045,.045,.03,10,lam(0x8a8478)),-.37,.93,.33,Math.PI/2-.3);                     // gauge
  put(g,box(.035,.035,.03,new THREE.MeshBasicMaterial({color:0xc03020})),-.21,.93,.325);    // pilot lamp: the one thing still on
  const pl=new THREE.PointLight(0xc03020,.7,3.2,1.5); pl.position.set(-.21,1.0,.6); g.add(pl); g.userData.pilot=pl;
  const lever=box(.05,.4,.05,lam(0x8a2a22)); lever.position.set(.5,1.1,.2); lever.rotation.z=.5; g.add(lever); g.userData.lever=lever;
  put(lever,new THREE.Mesh(new THREE.SphereGeometry(.045,6,6),M.black),0,.2,0);
  return g; }
function mkCrate24(){ const g=group(); const cm=new THREE.MeshLambertMaterial({map:TEX.crate}), bt=lam(0x3a2c1c);
  const b=new THREE.Mesh(new THREE.BoxGeometry(.62,.55,.62),cm); b.position.y=.275; g.add(b);
  for(const a of[-.29,.29])for(const c of[-.29,.29])put(b,box(.06,.56,.06,bt),a,0,c);       // corner battens
  for(const y of[-.2,.2]){ put(b,box(.64,.05,.02,bt),0,y,.315); put(b,box(.64,.05,.02,bt),0,y,-.315); put(b,box(.02,.05,.64,bt),.315,y,0); put(b,box(.02,.05,.64,bt),-.315,y,0); }
  const lid=new THREE.Mesh(new THREE.BoxGeometry(.64,.06,.64),cm); lid.position.y=.575; g.add(lid); g.userData.lid=lid;
  for(const a of[-.2,.2])put(lid,box(.07,.03,.66,bt),a,.04,0);
  return g; }
function iconTex(kind){ return tex((g,s)=>{ g.clearRect(0,0,s,s); g.strokeStyle="#d8c890"; g.lineWidth=9;
  if(kind==="crescent"){ g.beginPath(); g.arc(s/2,s/2,34,.6,5.7); g.stroke(); g.beginPath(); g.arc(s/2+16,s/2,30,.9,5.4); g.stroke(); }
  if(kind==="triangle"){ g.beginPath(); g.moveTo(s/2,26); g.lineTo(s-26,s-26); g.lineTo(26,s-26); g.closePath(); g.stroke(); }
  if(kind==="spiral"){ g.beginPath(); for(let a=0;a<14;a+=.2){ const r=3+a*4.4,x=s/2+Math.cos(a)*r,y=s/2+Math.sin(a)*r; a?g.lineTo(x,y):g.moveTo(x,y);} g.stroke(); } },128); }
function decal(txr,w,h){ return new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:txr,transparent:true,opacity:.85})); }
function mkMusicBox(){ const g=group(); const dk=lam(0x33261c);
  put(g,box(.46,.24,.32,dk),0,.13,0);
  for(const a of[-.22,.22])for(const c of[-.15,.15]){ put(g,box(.035,.26,.035,M.brass),a,.13,c); put(g,box(.05,.02,.05,M.brass),a,.005,c); }
  put(g,box(.4,.012,.26,lam(0x5a1c1c)),0,.252,0);                                           // red felt bed
  const lid=group(); put(lid,box(.46,.035,.32,lam(0x452f20)),0,0,-.16); put(lid,box(.36,.004,.22,wetMat(lam(0x5a6468),.9,60)),0,-.02,-.16);   // mirror inside the lid
  lid.position.set(0,.27,-.16); lid.rotation.x=-1.25; g.add(lid);
  const cy=rod(.045,.045,.3,10,new THREE.MeshLambertMaterial({color:0xb89a4e,emissive:0x302408})); put(g,cy,0,.3,-.02,0,0,Math.PI/2);
  for(let i=0;i<14;i++){ const a=i*1.7; put(g,box(.01,.01,.012,M.brass),-.13+i*.02,.3+Math.cos(a)*.047,-.02+Math.sin(a)*.047); }   // pins
  put(g,box(.3,.008,.07,M.chrome),0,.285,.07,.2);                                           // comb
  put(g,rod(.012,.012,.07,6,M.brass),.26,.16,0,0,0,Math.PI/2); put(g,box(.02,.1,.02,M.brass),.3,.2,0); put(g,rod(.02,.02,.04,6,lam(0x1a1410)),.3,.26,.0,0,0,Math.PI/2);
  const L=new THREE.PointLight(0xd8a860,.55,3,1.5); L.position.set(0,.55,.25); g.add(L);
  return g; }
function mkNode(){ const g=group();
  const d=rod(.09,.09,.03,12,new THREE.MeshLambertMaterial({color:0xb09a50,emissive:0x2a2210})); d.rotation.x=Math.PI/2; g.add(d);   // children[0]: the strike plate
  put(g,rod(.1,.1,.012,12,M.brass),0,0,-.02,Math.PI/2);
  put(g,box(.012,.2,.012,M.metalDark),0,.19,0); put(g,box(.08,.02,.06,M.metalDark),0,.3,-.02);   // hanger
  put(g,rod(.012,.012,.14,5,M.brass),.06,-.1,.03,0,0,-.3); put(g,new THREE.Mesh(new THREE.SphereGeometry(.024,6,6),M.brass),.08,-.17,.03);   // striker
  const L=new THREE.PointLight(0xd8b060,.9,3.4,1.5); L.position.z=.3; g.add(L); g.userData.light=L;
  put(g,box(.34,.5,.02,lam(0x2a2620)),0,.06,-.035);   // a dark mounting plate, so the brass reads against any wall
  return g; }
function mkValve(){ const g=group();
  put(g,rod(.05,.05,.7,8,M.metal),0,.35,0); put(g,rod(.08,.08,.04,8,M.metalDark),0,.02,0); put(g,rod(.075,.075,.05,8,M.metalDark),0,.6,0);
  put(g,rod(.02,.02,.14,6,M.metalDark),0,.69,0);
  const wheel=group(); const red=lam(0x8a2a22);
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(.12,.022,6,14),red));
  for(let i=0;i<3;i++)put(wheel,box(.23,.02,.02,red),0,0,0,0,0,i*Math.PI/3);
  wheel.add(rod(.03,.03,.04,6,M.metalDark)); wheel.children[wheel.children.length-1].rotation.x=Math.PI/2;
  wheel.position.y=.75; wheel.rotation.x=Math.PI/2; g.add(wheel); g.userData.wheel=wheel;
  const L=new THREE.PointLight(0xb04030,.3,1.8,1.5); L.position.set(0,.95,.2); g.add(L);
  return g; }
function mkSafe(){ const g=group();   // sized to sit INSIDE the wardrobe carcass, on its floor
  const shell=M.metalDark, D=.4;
  put(g,box(.6,.05,D,shell),0,.575,0); put(g,box(.6,.05,D,shell),0,.025,0);                 // top, bottom
  put(g,box(.05,.6,D,shell),-.275,.3,0); put(g,box(.05,.6,D,shell),.275,.3,0); put(g,box(.6,.6,.04,shell),0,.3,-D/2+.02);   // sides, back
  put(g,box(.5,.02,D-.08,lam(0x2a1c1c)),0,.3,0);                                              // felt shelf
  // what she kept: photographs, a dried flower, a ring box, and the letter
  put(g,box(.2,.03,.15,lam(0xc8c0a8)),-.1,.075,.02,0,.2,0); put(g,box(.19,.02,.14,lam(0xb0a890)),-.08,.1,.03,0,-.15,0);
  put(g,box(.07,.06,.07,lam(0x3a1620)),.14,.34,.02); put(g,rod(.008,.008,.2,4,lam(0x4a4428)),.02,.325,.06,0,0,1.4);
  put(g,new THREE.Mesh(new THREE.SphereGeometry(.025,6,5),lam(0x7a3a44)),-.08,.335,.06);
  const letter=box(.22,.012,.14,lam(0xe0d8c0)); put(g,letter,.02,.315,-.06,0,.1,0); g.userData.letter=letter;
  // door hung on its right edge so it swings out into the room
  const door=group(); door.position.set(.25,.3,D/2+.005); g.add(door); g.userData.door=door;
  put(door,box(.5,.5,.05,wetMat(lam(0x5c6062),.4,30)),-.25,0,0); put(door,box(.44,.44,.012,M.metalDark),-.25,0,.028);
  put(door,rod(.065,.065,.04,12,lam(0x2a2a2a)),-.33,0,.05,Math.PI/2); put(door,rod(.02,.02,.05,6,M.chrome),-.33,0,.06,Math.PI/2);
  for(let k=0;k<4;k++)put(door,box(.2,.02,.02,M.chrome),-.13,0,.05,0,0,k*Math.PI/4);       // four-spoke handle: a slot for four pieces
  for(const y of[-.17,.17])put(g,rod(.022,.022,.1,6,M.metal),.27,.3+y,D/2+.01);
  const L=new THREE.PointLight(0xd8b070,0,2.2,1.5); L.position.set(0,.35,.1); g.add(L); g.userData.glow=L;   // lit only once it is open
  return g; }
/* The carriages were modelled 1.86 m floor-to-ceiling with the floor 0.58 m above the platform, so a
   standing player's eye sat inside the door lintel. Stretch them to real height and sink them so the
   floor meets the platform; the bogies go down into the track pit, where they belong. */
const TRAIN_SY=1.22, TRAIN_Y=-.63, TRAIN_FLOOR=.58*TRAIN_SY+TRAIN_Y+.05;   // walkable floor level, world units
function fitTrain(g){ g.scale.y=TRAIN_SY; g.position.y=TRAIN_Y; }
/* ── rolling stock: shared detailing for both trains ──
   The carriages were plain extrusions. This adds what makes a box read as a train: a turned
   roof with equipment pods, bogies, gangway bellows, a cab end with a destination blind and
   lamps, rub rails, and an interior with seat backs, grab poles and straps.
   The platform side is -z; +x is the trailing end. o = {cars:[centre x], carLen, hz, roofY, doors:[x], seats:[x], seatZ, blind} */
function dressTrain(g,o){ const dk=lam(0x23292d), roofM=lam(0x3a4246), hz=o.hz, first=o.cars[0]-o.carLen/2, last=o.cars[o.cars.length-1]+o.carLen/2;
  for(const cx of o.cars){
    for(const sz of[-1,1])put(g,box(o.carLen,.12,.4,roofM),cx,o.roofY+.16,sz*(hz-.2),sz*.5);          // turned-down roof shoulders
    put(g,box(o.carLen-.3,.08,hz*1.25,roofM),cx,o.roofY+.24,0);
    for(const px of[-.26,.26]){ put(g,box(1.7,.16,.86,dk),cx+px*o.carLen,o.roofY+.34,0);                // equipment pods
      for(let i=0;i<5;i++)put(g,box(.04,.165,.8,M.black),cx+px*o.carLen-.6+i*.3,o.roofY+.34,0); }
    for(const bx of[-.32,.32]){ const x=cx+bx*o.carLen;                                                  // bogies
      put(g,box(1.9,.2,hz*1.5,dk),x,.02,0);
      for(const wx of[-.6,.6])for(const sz of[-1,1]){ put(g,rod(.3,.3,.14,12,M.rubber),x+wx,-.08,sz*(hz-.3),Math.PI/2);
        put(g,rod(.14,.14,.15,8,M.metal),x+wx,-.08,sz*(hz-.3),Math.PI/2); } }
    put(g,box(o.carLen*.36,.3,hz*1.2,dk),cx,.04,0);                                                      // underfloor equipment case
    put(g,box(o.carLen,.05,.04,dk),cx,2.1,-(hz+.03)); put(g,box(o.carLen,.07,.05,dk),cx,.98,-(hz+.035));   // cant rail, rub rail
  }
  for(let i=0;i<o.cars.length-1;i++)put(g,box(o.cars[i+1]-o.cars[i]-o.carLen+.12,1.95,hz*1.45,M.rubber),(o.cars[i]+o.cars[i+1])/2,1.3,0);   // gangway bellows
  // cab ends: leading (-x) shows white, trailing (+x) shows red
  for(const [x,dir,lamp] of[[first,-1,0xfff0d0],[last,1,0xb02018]]){
    put(g,box(.14,2.0,hz*2,lam(0x4a5358)),x+dir*.05,1.36,0);
    put(g,box(.03,.62,hz*2-.5,M.glassDark),x+dir*.125,1.72,0);
    put(g,box(.03,.9,.07,dk),x+dir*.13,1.6,0);                                                            // centre pillar
    const bl=new THREE.Mesh(new THREE.PlaneGeometry(hz*1.2,.2),new THREE.MeshBasicMaterial({map:tex((c,s)=>{ c.fillStyle="#0a0a08"; c.fillRect(0,0,s,s);
      c.fillStyle="#e8a838"; c.font="bold 38px Courier New"; c.textAlign="center"; c.fillText(o.blind,s/2,s/2+13); },256)}));
    bl.material.map.repeat.set(1,.3); bl.material.map.offset.set(0,.35); put(g,bl,x+dir*.126,2.2,0,0,dir*Math.PI/2);
    for(const sz of[-1,1])put(g,rod(.1,.1,.04,10,new THREE.MeshBasicMaterial({color:lamp})),x+dir*.13,.95,sz*(hz-.34),0,0,Math.PI/2);
    put(g,box(.3,.16,.3,dk),x+dir*.24,.42,0); put(g,box(.2,.5,hz*1.7,dk),x+dir*.1,.3,0);                  // coupler, buffer beam
  }
  // interior
  for(const dx of o.doors)for(const sx of[-.6,.6])put(g,rod(.018,.018,1.78,6,M.metal),dx+sx,1.5,-hz+.42);
  for(const sx of o.seats){ put(g,box(1.36,.44,.07,lam(0x3c444c)),sx,o.seatY+.3,o.seatZ+.22,-.12); put(g,box(.04,.3,.42,dk),sx-.68,o.seatY+.12,o.seatZ); put(g,box(.04,.3,.42,dk),sx+.68,o.seatY+.12,o.seatZ); }
  for(const cx of o.cars){ put(g,rod(.014,.014,o.carLen-.8,5,M.chrome),cx,2.16,-.1,0,0,Math.PI/2);
    for(let x=cx-o.carLen/2+.8;x<cx+o.carLen/2-.6;x+=.7)put(g,box(.03,.2,.015,lam(0x8a8478)),x,2.05,-.1,(x*7%1-.5)*.3); }   // straps, some still swinging
}

/* ════════ ZONE: STREET (beat 4 + Ending B exit) ════════ */
/* ════════ ZONE: ARRIVAL — the last train in (opening) ════════ */
let arrTrain=null, arrDoors=[];
function setArrDoor(k){ const d=arrDoors[1]; if(!d)return; d.userData.dl.position.x=-.27-k*.56; d.userData.dr.position.x=.27+k*.56; }
inZone("arrival",()=>{
  const ox=900;
  // platform floor (player side) + track pit
  floorPlane(ox+11,4.2,23,6,TEX.hallFloor,1.4);
  { const edge=box(23,.06,.18,new THREE.MeshLambertMaterial({color:0xb8a038})); edge.position.set(ox+11,.03,6.0); scene.add(edge); } // yellow platform edge line
  // ── platform furniture: a bench facing the rails, a vending machine still awake, the clock that stopped tonight ──
  { const bn=mkBench(); at(bn,ox+8,0,2.0,Math.PI); addCollider(ox+8,2.0,1.9,.6);
    interact(bn,"A platform bench",()=>say(null,"He sat here with her once, both of them laughing at nothing, waiting for a train they didn't mind missing."));
    const vm=mkVending(true); at(vm,ox+13.5,0,1.65,0); addCollider(ox+13.5,1.62,1.0,.7);
    interact(vm,"The vending machine",()=>{ AU.rattle(); say(null,"It hums. It glows. It takes exact change only, and he has none of anything exact tonight."); });
    const ck=mkWallClock(11,40,true); ck.position.set(ox+10.5,2.5,1.28); scene.add(ck);
    interact(ck,"The station clock",()=>say(null,"Eleven-forty. It has been eleven-forty since he stepped off the train. Maybe longer."));
    // peeling posters on the south wall
    const posterTex=(t2,c1,c2)=>tex((g,s)=>{ g.fillStyle=c1; g.fillRect(0,0,s,s);
      g.fillStyle=c2; g.font="bold 26px Courier New"; g.textAlign="center";
      t2.split("|").forEach((ln,i)=>g.fillText(ln,s/2,44+i*32)); grime(g,s,12,.45); },128);
    const p1=decal(posterTex("VISIT|THE COAST|—|IT MISSES YOU","#33424a","#c8b890"),1.0,1.3);
    p1.position.set(ox+5.5,1.8,1.28); p1.rotation.z=.02; scene.add(p1);
    const p2=decal(posterTex("HALDANE|WARD|COUNCIL|NOTICES","#4a4034","#d0c8ac"),.9,1.2);
    p2.position.set(ox+16.8,1.85,1.28); p2.rotation.z=-.03; scene.add(p2); }
  { const pit=new THREE.Mesh(new THREE.PlaneGeometry(23,1.6),new THREE.MeshBasicMaterial({color:0x030304})); pit.rotation.x=-Math.PI/2; pit.position.set(ox+11,-.25,6.9); scene.add(pit); }
  // station shell: back (south) wall tiled, ceiling, ends
  ceilPlane(ox+11,4.2,23,6,3.2);
  wall("x",ox-.4,ox+22.4,1.2,3.2,0,TEX.concrete,1.4,.16);      // south wall (behind platform)
  wall("z",1.2,7.2,ox-.4,3.2,0,TEX.concrete,1.0,.16);           // west end
  wall("z",1.2,7.2,ox+22.4,3.2,0,TEX.concrete,1.0,.16,[[2.3,4.5]]); // east end: WAY OUT opening
  // tiled dado on the back wall
  { const dado=box(23,1.0,.03,surf(TEX.wallpaper,23,1.0,2.0,0x35506a)); dado.position.set(ox+11,.5,1.28); scene.add(dado); }
  // ceiling fluorescents
  for(const x of[ox+3,ox+8,ox+13,ox+18]){ const f=mkFluorescent(); f.position.set(x,3.06,3.4); scene.add(f); }
  // MERIDIAN LINE platform sign
  { const sg=tex((g,s)=>{ g.fillStyle="#0c1a2c";g.fillRect(0,0,s,s); g.fillStyle="#7fb0e0";g.font="bold 30px Courier New";g.textAlign="center";
      g.fillText("MERIDIAN LINE",s/2,s/2-6); g.font="18px Courier New"; g.fillStyle="#9aa6b0"; g.fillText("HALDANE · WESTBOUND",s/2,s/2+26); },256);
    const sign=new THREE.Mesh(new THREE.PlaneGeometry(2.6,.65),new THREE.MeshBasicMaterial({map:sg})); sign.position.set(ox+8,2.3,1.3); scene.add(sign); }
  // A small enamel wayfinding plate sits flush on the lintel.  Keeping it on
  // the wall plane, rather than on a deep sign box, prevents the old floating
  // black slab silhouette when viewed from the platform.
  { const wg=tex((g,s)=>{ g.fillStyle="#173629"; g.fillRect(0,0,s,s); g.strokeStyle="#d9cd86"; g.lineWidth=8; g.strokeRect(10,10,s-20,s-20);
      g.fillStyle="#f1df83";g.font="bold 31px Courier New";g.textAlign="center"; g.fillText("WAY OUT",s/2,s*.44);
      g.beginPath(); g.moveTo(s*.50,s*.57); g.lineTo(s*.38,s*.79); g.lineTo(s*.47,s*.79); g.lineTo(s*.47,s*.91); g.lineTo(s*.53,s*.91); g.lineTo(s*.53,s*.79); g.lineTo(s*.62,s*.79); g.closePath(); g.fill(); },256);
    const ws=new THREE.Mesh(new THREE.PlaneGeometry(1.28,.36),new THREE.MeshBasicMaterial({map:wg,side:THREE.DoubleSide}));
    ws.position.set(ox+22.292,2.71,3.4); ws.rotation.y=-Math.PI/2; scene.add(ws);
    const gl=new THREE.PointLight(0xd8c060,.3,3.2,1.8); gl.position.set(ox+21.92,2.5,3.4); scene.add(gl); }
  // a couple of platform benches + a bin (lived-in)
  for(const bx of[ox+5,ox+15]){ const seat=box(1.4,.05,.4,M.woodDark); seat.position.set(bx,.5,1.7); scene.add(seat);
    for(const lx of[-.6,.6]){ const leg=box(.06,.5,.34,M.metalDark); leg.position.set(bx+lx,.25,1.7); scene.add(leg);} }

  // ── the train: a textured shell with visible carriage interior and three door bays ──
  arrTrain=group();
  const carM=surf(TEX.metroMetal,22,2.5,2.4,0xaeb6b4);
  // Open the boarding side so the carriage is a real readable interior,
  // rather than a solid box with an invisible teleport trigger.
  const car=new THREE.Group();
  const roof=box(22,.28,1.7,carM); roof.position.set(0,2.36,0); car.add(roof);
  const lower=box(22,.55,1.7,carM); lower.position.set(0,.48,0); car.add(lower);
  const rear=box(22,1.55,.12,carM); rear.position.set(0,1.45,.79); car.add(rear);
  const frontTop=box(22,.28,.12,carM); frontTop.position.set(0,2.08,-.82); car.add(frontTop);
  const frontBase=box(22,.32,.12,carM); frontBase.position.set(0,.82,-.82); car.add(frontBase);
  arrTrain.add(car);
  const skirt=box(22,.5,1.72,surf(TEX.metroMetal,22,.5,1.2,0x343c42)); skirt.position.set(0,.35,0); arrTrain.add(skirt);
  const stripe=box(22,.18,.06,new THREE.MeshLambertMaterial({color:0x2a4a7a})); stripe.position.set(0,1.05,-.87); arrTrain.add(stripe);
  // Glazing you can see through, with body pillars between the openings. The old flat dark
  // panels made the side read as one slab; now the lit, empty interior shows from the platform.
  const winM=new THREE.MeshBasicMaterial({color:0x7896a4,transparent:true,opacity:.1,depthWrite:false});
  const doorXs=[-7,0,7]; const openings=doorXs.map(dx=>[dx-.56,dx+.56]);
  for(let i=-9;i<=9;i++){
    const wx=i*1.05;
    if(doorXs.some(dx=>Math.abs(wx-dx)<1.05))continue;
    const w=box(.7,.6,.02,winM); w.position.set(wx,1.7,-.82); arrTrain.add(w); openings.push([wx-.35,wx+.35]);
    for(const [fy,fh] of[[2.02,.05],[1.38,.05]]){ const fr=box(.76,fh,.04,M.metalDark); fr.position.set(wx,fy,-.88); arrTrain.add(fr); }
    for(const fx of[-.365,.365]){ const fr=box(.035,.66,.04,M.metalDark); fr.position.set(wx+fx,1.7,-.88); arrTrain.add(fr); }
  }
  openings.sort((p,q)=>p[0]-q[0]); { let cur=-11;
    for(const [o0,o1] of openings.concat([[11,11]])){ if(o0-cur>.02){ const pil=box(o0-cur,.98,.12,carM); pil.position.set((cur+o0)/2,1.46,-.82); arrTrain.add(pil); } cur=Math.max(cur,o1); } }
  for(const [o0,o1] of openings)if(o1-o0<1){ const lower=box(o1-o0,.4,.12,carM); lower.position.set((o0+o1)/2,1.18,-.82); arrTrain.add(lower); }   // panel under each window
  const cabFloor=box(22,.08,1.45,surf(TEX.metroFloor,22,1.45,1.1)); cabFloor.position.set(0,.58,.02); arrTrain.add(cabFloor);
  const cabCeil=box(22,.08,1.42,surf(TEX.metroMetal,22,1.42,2.2,0x4b555a)); cabCeil.position.set(0,2.48,.02); arrTrain.add(cabCeil);
  const cabWall=box(21.7,1.65,.08,surf(TEX.metroMetal,21.7,1.65,2.0,0x4e585d)); cabWall.position.set(0,1.48,.72); arrTrain.add(cabWall);
  for(const x of[-8,-4,0,4,8]){ const seat=box(1.35,.12,.42,new THREE.MeshLambertMaterial({color:0x47525a})); seat.position.set(x,.85,.42); arrTrain.add(seat); }
  const cabLight=box(18,.02,.12,new THREE.MeshBasicMaterial({color:0xb8b49a})); cabLight.position.set(0,2.425,0); arrTrain.add(cabLight);
  const cabGlow=new THREE.PointLight(0xb7c9bd,.55,5,1.8); cabGlow.position.set(0,1.9,-.35); arrTrain.add(cabGlow);
  // far-side windows (black tunnel glass), advert cards and a line map, so the carriage reads from inside
  for(let i=-9;i<=9;i++){ const wx=i*1.05; const fw=box(.74,.62,.02,new THREE.MeshBasicMaterial({color:0x05080b})); fw.position.set(wx,1.7,.675); arrTrain.add(fw);
    const fr=box(.8,.04,.03,M.metalDark); fr.position.set(wx,1.38,.67); arrTrain.add(fr); }
  { const ads=tex((g,s)=>{ const cols=["#3a4a3c","#4a3a30","#30384a","#4a4430","#3c3040"]; for(let i=0;i<5;i++){ g.fillStyle=cols[i]; g.fillRect(i*s/5+2,0,s/5-4,s);
        g.fillStyle="rgba(210,200,170,.55)"; g.fillRect(i*s/5+8,s*.25,s/5-18,s*.12); g.fillRect(i*s/5+8,s*.5,s/5-30,s*.08); } grime(g,s,10,.3); },128);
    for(const [z,ry] of[[.67,Math.PI],[-.74,0]]){ const t=ads.clone(); t.needsUpdate=true; t.repeat.set(4,1);
      const strip=new THREE.Mesh(new THREE.PlaneGeometry(21,.24),new THREE.MeshLambertMaterial({map:t})); strip.position.set(0,2.2,z); strip.rotation.y=ry; arrTrain.add(strip); }
    const map=new THREE.Mesh(new THREE.PlaneGeometry(1.5,.34),new THREE.MeshBasicMaterial({map:tex((g,s)=>{ g.fillStyle="#d8d2c0"; g.fillRect(0,0,s,s); g.strokeStyle="#2a4a7a"; g.lineWidth=6;
      g.beginPath(); g.moveTo(14,s/2); g.lineTo(s-14,s/2); g.stroke(); for(let i=0;i<11;i++){ g.fillStyle=i===10?"#a02a22":"#2a4a7a"; g.beginPath(); g.arc(14+i*(s-28)/10,s/2,i===10?9:6,0,7); g.fill(); }
      g.fillStyle="#22201a"; g.font="bold 18px Courier New"; g.fillText("MERIDIAN LINE",14,s/2-22); g.fillText("HALDANE",s-104,s/2+34); },256)}));
    map.material.map.repeat.set(1,.5); map.material.map.offset.set(0,.25); map.position.set(-2,2.2,.66); map.rotation.y=Math.PI; arrTrain.add(map); }
  // three door bays. The middle one is the one he uses: shut for the ride, open at the platform.
  arrDoors=[];
  for(const dx of[-7,0,7]){ const dgroup=group();
    const dl=box(.54,1.72,.05,lam(0x3a444a)); dl.position.set(-.27,1.16,-.86);
    const dr=box(.54,1.72,.05,lam(0x3a444a)); dr.position.set(.27,1.16,-.86);
    dgroup.add(dl); dgroup.add(dr);
    const sill=box(1.1,.06,.2,M.metal); sill.position.set(0,.6,-.94); dgroup.add(sill);
    const head=box(1.16,.08,.1,M.metalDark); head.position.set(0,2.06,-.88); dgroup.add(head);
    dgroup.position.set(dx,0,0);
    dgroup.userData.dl=dl; dgroup.userData.dr=dr; arrTrain.add(dgroup); arrDoors.push(dgroup); }
  for(const d of arrDoors)for(const lf of[d.userData.dl,d.userData.dr]){ put(lf,box(.32,.6,.012,winM),0,.36,-.032);            // door glazing
    put(lf,box(.4,.03,.02,M.metalDark),0,.02,-.03); }
  setArrDoor(1);
  dressTrain(arrTrain,{cars:[0],carLen:22,hz:.85,roofY:2.36,doors:[-7,0,7],seats:[-8,-4,0,4,8],seatY:.85,seatZ:.42,blind:"TERMINATES"});
  arrTrain.position.set(ox+11,0,7.3); fitTrain(arrTrain); scene.add(arrTrain);
  // Train collision follows the stationary arrival train, leaving a real
  // doorway gap at the middle carriage entrance.
  addCollider(ox+5.7,7.3,9.5,1.7,"arrivalTrain");     // carriage side, either side of a 1.1 m doorway
  addCollider(ox+16.3,7.3,9.5,1.7,"arrivalTrain");
  addCollider(ox+11,7.75,1.2,.5,"arrivalTrain");       // far side of the vestibule
  const trainInside=box(1.0,1.8,.7,new THREE.MeshBasicMaterial({visible:false,side:THREE.DoubleSide}));
  trainInside.position.set(ox+11,1.35,6.65); scene.add(trainInside);
  let ixTrainLeave=null;
  const ixTrainIn=interact(trainInside,"Enter the carriage",()=>{ player.x=ox+11; player.z=6.35; player.floorY=.58; player.yaw=Math.PI; if(ixTrainLeave)ixTrainLeave.enabled=true; say(null,"The carriage is warmer than the platform. Empty seats face the dark glass, each one holding the shape of someone who left.",4200); },{range:2.2});
  const trainLeave=box(1.2,1.6,.25,new THREE.MeshBasicMaterial({visible:false,side:THREE.DoubleSide}));
  trainLeave.position.set(ox+11,.9,6.3); scene.add(trainLeave);
  ixTrainLeave=interact(trainLeave,"Step back onto the platform",()=>{ player.x=ox+11; player.z=5.9; player.floorY=0; player.yaw=0; ixTrainLeave.enabled=false; say(null,"The platform is colder. The train waits with its doors open.",2800); },{range:1.6});
  ixTrainLeave.enabled=false; ixTrainIn.enabled=false;   // superseded: he starts aboard and the threshold is real floor

  // Exit is a flat station doorway now; there is no staircase in this level.
  { const threshold=box(.34,.05,2.2,new THREE.MeshLambertMaterial({color:0x4a514c})); threshold.position.set(ox+21.95,.025,3.4); scene.add(threshold);
    const exitTrigger=box(1.4,2.2,1.5,new THREE.MeshBasicMaterial({visible:false,side:THREE.DoubleSide})); exitTrigger.position.set(ox+21.7,1.1,3.4); scene.add(exitTrigger);
    interact(exitTrigger,"Up to the street",()=>{
      if(travelLock)return;
      say(null,"Through the station exit and into the rain.",4200);
      AU.trainDepart(); AU.stationStop();
      later(()=>{ AU.windStart();
        travel("street",-96,26.5,0,()=>{
          say(null,"Eleven-forty. The last block home. Rain the exact temperature of being alone. The prescription bag has gone soft in his pocket.",6500);
          setObjective("Home. <b>Up the front steps of Haldane Court.</b>"); }); },1600);
    },{range:3.0}); }

  // ground rise only inside the stair channel, matching the visible steps
  // Keep the visible treads and player grounding on the same discrete profile.
  // The carriage floor is also a real walkable surface when the player enters it.
  ZONES.arrival.ground=(x,z)=>{
    if(z>=6.2&&z<=7.3&&x>=ox+10.4&&x<=ox+11.6)return TRAIN_FLOOR;   // only in the doorway he actually uses
    return 0;
  };
});

/* ════════ ZONE: STREET (beat 4) ════════ */
inZone("street",()=>{
  const ox=-100;
  wetMat(floorPlane(ox+8,14,19.4,32,TEX.asphalt,1.6).material,.3,22);   // rain-slick road
  { const sw=new THREE.Mesh(new THREE.PlaneGeometry(2.2,32),surf(TEX.concrete,2.2,32,1)); sw.rotation.x=-Math.PI/2; sw.position.set(ox+.9,.02,14); scene.add(sw);
    const sw2=sw.clone(); sw2.position.x=ox+15.1; scene.add(sw2); }
  wall("z",-1.6,29.6,ox-1.6,19,0,TEX.brickExt,.5,.2); wall("z",-1.6,29.6,ox+17.6,19,0,TEX.brickExt,.5,.2);
  wall("x",ox-1.6,ox+17.6,-1.6,19,0,TEX.brickExt,.5,.2);
  // Wet curb bands, drains, and shallow puddles give the narrow street a
  // continuous edge instead of leaving the asphalt floating between walls.
  for(const sx of[ox+.82,ox+15.18]){
    const curb=box(2.2,.12,.18,new THREE.MeshLambertMaterial({color:0x4b4d4a})); curb.position.set(sx,.06,14); scene.add(curb);
    for(const pz of[5.4,11.8,18.2,24.8]){
      const drain=box(1.3,.018,.22,new THREE.MeshBasicMaterial({color:0x151a1c})); drain.position.set(sx,.014,pz); scene.add(drain);
    }
  }
  for(const [px,pz,pw,pd] of[[ox+2.1,9.4,2.2,.55],[ox+6.3,18.6,1.7,.42],[ox+3.4,24.2,2.8,.5]]){
    const puddle=new THREE.Mesh(new THREE.PlaneGeometry(pw,pd),new THREE.MeshLambertMaterial({color:0x202b32,transparent:true,opacity:.68}));
    puddle.rotation.x=-Math.PI/2; puddle.rotation.z=(px+pz)%2*.18; puddle.position.set(px,.012,pz); scene.add(puddle);
  }
  // Small pools of warm light against the facade create readable noir
  // landmarks inside the dark street shell.
  for(const [lx,ly,lz] of[[ox+1.2,3.0,-1.35],[ox+7.8,3.6,-1.35]]){
    const wallLamp=new THREE.Mesh(new THREE.SphereGeometry(.06,7,5),new THREE.MeshBasicMaterial({color:0xd5ae72}));
    wallLamp.position.set(lx,ly,lz); scene.add(wallLamp);
    const wl=new THREE.PointLight(0xc89558,.3,5,1.8); wl.position.set(lx,ly,lz+.2); scene.add(wl);
  }
  // ── street furniture: a car nobody moved, a phone box, a hydrant, the litter of a wet year ──
  { const car=mkSedan(); at(car,ox+3.1,0,12,Math.PI/2+.03); addCollider(ox+3.1,12,2.0,4.4);
    interact(car,"A parked sedan",()=>say(null,"Rain has been washing this car for a long time. The tax disc expired in a different life."));
    const booth=mkPhoneBooth(); at(booth,ox+15.1,0,8.5,-Math.PI/2); addCollider(ox+15.1,8.5,1.1,1.1);
    interact(booth,"A public telephone",()=>{ AU.rattle();
      say("THOMAS","Dead line. Of course. The only phone that rings tonight is hers."); });
    const hyd=mkHydrant(); at(hyd,ox+.9,0,10,0); addCollider(ox+.9,10,.45,.45);
    // bus stop that no bus honours
    const bsp=box(.07,2.5,.07,M.metalDark); bsp.position.set(ox+15.6,1.25,17); scene.add(bsp);
    const bsn=decal(tex((g,s)=>{ g.fillStyle="#1c2430"; g.fillRect(0,0,s,s); g.fillStyle="#c8c4b0";
      g.font="bold 34px Courier New"; g.textAlign="center"; g.fillText("BUS 41",s/2,s/2-8);
      g.font="20px Courier New"; g.fillText("NIGHT SERVICE",s/2,s/2+22); g.fillText("SUSPENDED",s/2,s/2+44); grime(g,s,8,.3); },256),.55,.55);
    bsn.position.set(ox+15.6,2.2,17.04); scene.add(bsn); addCollider(ox+15.6,17,.3,.3);
    // wet newspaper + bags along the gutters
    for(const [nx,nz,nr] of[[ox+2.4,7.2,.4],[ox+6.1,15.6,2.2],[ox+3.1,20.5,1.1]]){
      const np=new THREE.Mesh(new THREE.PlaneGeometry(.4,.3),M.paper); np.rotation.x=-Math.PI/2; np.rotation.z=nr;
      np.position.set(nx,.018,nz); scene.add(np); }
    for(const [bx,bz] of[[ox+1.2,13.5],[ox+14.9,21.5]]){
      const bag=new THREE.Mesh(new THREE.SphereGeometry(.28,7,5),new THREE.MeshLambertMaterial({color:0x14161a}));
      bag.scale.y=.7; bag.position.set(bx,.19,bz); scene.add(bag); addCollider(bx,bz,.5,.5); } }
  // ── HALDANE COURT: restrained noir facade, readable entrance, wet street landmarks ──
  { const conc=new THREE.MeshLambertMaterial({map:TEX.concrete});
    // window grid on the building face (lit and dark flats)
    const litW=new THREE.MeshBasicMaterial({color:0x4a4230}), drkW=new THREE.MeshBasicMaterial({color:0x0c0e12});
    for(let r=0;r<12;r++)for(let c=0;c<12;c++){ const lit=(r*5+c)%7===3||(r===2&&c===4);
      const w=new THREE.Mesh(new THREE.PlaneGeometry(.8,1.1),lit?litW:drkW);
      w.position.set(ox+.8+c*1.6,3.4+r*1.15,-1.47); scene.add(w);
      const sill=box(.9,.06,.1,conc); sill.position.set(ox+.8+c*1.6,2.8+r*1.15,-1.5); scene.add(sill);
      if(lit&&r<2&&c<5){ const spill=new THREE.PointLight(0xb68d58,.08,3.5,2); spill.position.set(ox+.8+c*1.6,3.4+r*1.15,-.9); scene.add(spill); } }
    // The old entrance had a tall stack of narrow treads, thick side walls,
    // and a door that was visually disconnected from its landing.  Rebuild it
    // as a low two-step stoop: a common, readable street-level apartment entry.
    for(const px of[ox+2.48,ox+5.52]){ const pier=box(.28,3.05,.82,surf(TEX.brickExt,.28,3.05,.5,0xffffff)); pier.position.set(px,1.525,-1.02); scene.add(pier);
      addCollider(px,-1.02,.36,.95); }
    const porch=box(3.18,.44,1.15,conc); porch.position.set(ox+4,.22,.08); scene.add(porch);
    for(const [top,pz] of[[.28,.82],[.14,1.18]]){ const st=box(2.74,top,.36,conc); st.position.set(ox+4,top/2,pz); scene.add(st);
      const nose=box(2.72,.025,.045,new THREE.MeshLambertMaterial({color:0x777468})); nose.position.set(ox+4,top+.014,pz+.17); scene.add(nose); }
    // One short rail per side is enough to frame the stoop without creating a
    // second, colliding staircase silhouette.
    for(const sx of[ox+2.72,ox+5.28]){
      // [z, height of the surface the post stands on]: back of the landing, top of the steps, foot of the steps
      const P=[[-.2,.44],[.6,.44],[1.45,0]], H=.92, tops=P.map(([z,y])=>[z,y+H]);
      for(const [z,y] of P){ const post=rod(.028,.028,H,6,M.metalDark); post.position.set(sx,y+H/2,z); scene.add(post);
        const foot=box(.1,.02,.1,M.metalDark); foot.position.set(sx,y+.01,z); scene.add(foot); }
      for(const dy of[0,-.42])for(let i=0;i<2;i++){ const [z0,y0]=tops[i],[z1,y1]=tops[i+1], len=Math.hypot(z1-z0,y1-y0);
        const rail=box(dy?.03:.05,dy?.03:.05,len+.04,M.metalDark); rail.position.set(sx,(y0+y1)/2+dy,(z0+z1)/2); rail.rotation.x=Math.atan2(y0-y1,z1-z0); scene.add(rail); }
      addCollider(sx,.2,.12,.9); }
    { const canopy=box(3.1,.16,.78,M.woodDark); canopy.position.set(ox+4,2.86,-.72); scene.add(canopy);
      const canopyLip=box(3.16,.08,.06,new THREE.MeshLambertMaterial({color:0x4d3d2c})); canopyLip.position.set(ox+4,2.75,-.31); scene.add(canopyLip); }
    { const pl2=new THREE.PointLight(0xc8a870,.48,5,1.7); pl2.position.set(ox+4,2.2,.38); scene.add(pl2); }
    // Door, trim, landing and collision now share the same .44m threshold.
    { const back=box(3.18,.44,1.1,conc); back.position.set(ox+4,.22,-1.0); scene.add(back); }      // landing runs back to the wall
    const bd=mkDoor(plateTex("——")); bd.position.set(ox+3.55,.44,-1.46); scene.add(bd);
    doorTrim(ox+4,.44,-1.42);
    { const reveal=box(1.5,2.5,.06,lam(0x1a140e)); reveal.position.set(ox+4,1.69,-1.49); scene.add(reveal); }   // dark reveal behind the leaf
    addCollider(ox+4,-1.35,1.3,.3,"bldgDoor");
    // sign + entry lamp over the door
    const sign=new THREE.Mesh(new THREE.PlaneGeometry(1.7,.3),new THREE.MeshBasicMaterial({map:tex((g,s)=>{ g.fillStyle="#14100c";g.fillRect(0,0,s,s);
      g.fillStyle="#b89a5a"; g.font="bold 40px Courier New"; g.textAlign="center"; g.fillText("HALDANE COURT",s/2,s/2+13); },256)}));
    sign.position.set(ox+4,3.02,-.3); scene.add(sign); { const bk=box(1.8,.4,.05,M.woodDark); bk.position.set(ox+4,3.02,-.33); scene.add(bk); }
    { const lampG=new THREE.Mesh(new THREE.SphereGeometry(.09,8,8),new THREE.MeshBasicMaterial({color:0xd8b070})); lampG.position.set(ox+4,2.62,-.6); scene.add(lampG); { const st=box(.02,.16,.02,M.metalDark); st.position.set(ox+4,2.72,-.6); scene.add(st); }
      const pl=new THREE.PointLight(0xd8a860,.8,6,1.7); pl.position.set(ox+4,2.4,-.5); scene.add(pl); }
    interact(bd,"Home",()=>{
      if(GS.metroOpen){ say("THOMAS","No. Not back inside. The station."); return; }
      if(travelLock)return; enterBuilding(); },{range:3.0});
    // Exact discrete ground profile for the two visible stoop treads.
    ZONES.street.ground=(x,z)=>{
      if(Math.abs(x-(ox+4))<1.55){ if(z<=.65)return .44; if(z<1.0)return .28; if(z<1.36)return .14; }
      if(Math.abs(x-(ox+4))<.85){ if(z>=27.6&&z<=28.6)return .4; if(z>26.95&&z<27.6)return (z-26.95)/.65*.4; }
      return 0; };
  }
  // metro entrance (south end) — Ending B: a proper raised entrance, steps up, then a dark flight going down
  { const conc2=new THREE.MeshLambertMaterial({map:TEX.concrete});
    // two entry steps up to the landing (climbable — ground fn), then the landing slab
    for(let i2=0;i2<2;i2++){ const top=.2*(i2+1);
      const st=box(1.7,top,.34,conc2); st.position.set(ox+4,top/2,27.13+i2*.32); scene.add(st); }
    const land=box(1.7,.4,1.1,conc2); land.position.set(ox+4,.2,28.16); scene.add(land);
    // tiled side walls covering the descent
    for(const wx of[ox+3.1,ox+4.9]){ const sw2=box(.18,1.9,2.6,surf(TEX.concrete,2.6,1.9,1.1,0x7f858c));
      sw2.position.set(wx,.95,28.5); scene.add(sw2); addCollider(wx,28.5,.25,2.6); }
    // header over the mouth, carrying the SUBWAY sign
    const hdr=box(1.98,.5,.24,M.metalDark); hdr.position.set(ox+4,1.85,28.72); scene.add(hdr);
    const ms=new THREE.Mesh(new THREE.PlaneGeometry(1.7,.32),new THREE.MeshBasicMaterial({map:tex((g,s)=>{ g.fillStyle="#0a2416";g.fillRect(0,0,s,s);
      g.fillStyle="#5ac878"; g.font="bold 60px Courier New"; g.textAlign="center"; g.fillText("SUBWAY",s/2,s/2+18); },256)})); ms.position.set(ox+4,1.85,28.59); ms.rotation.y=Math.PI; scene.add(ms);
    // the descending flight, visible past the chain, swallowed by the dark
    for(let i2=0;i2<5;i2++){ const dst=box(1.6,.16,.34,conc2);
      dst.position.set(ox+4,.32-.28*i2,28.85+i2*.3); scene.add(dst); }
    { const pit=new THREE.Mesh(new THREE.PlaneGeometry(1.6,1.4),new THREE.MeshBasicMaterial({color:0x020303}));
      pit.position.set(ox+4,-.3,29.62); pit.rotation.x=-.5; scene.add(pit); }
    const gl=new THREE.PointLight(0x3aa860,.7,5,1.7); gl.position.set(ox+4,.5,29.1); scene.add(gl);
    // chain across the mouth
    for(const sx2 of[ox+3.25,ox+4.75]){ const stub=box(.07,.75,.07,M.metalDark); stub.position.set(sx2,.78,28.62); scene.add(stub); }
    for(let c2=0;c2<5;c2++){ const t2=c2/4; const link=box(.3,.035,.035,M.metal);
      link.position.set(ox+3.35+t2*1.3,1.05-Math.sin(t2*Math.PI)*.16,28.62); link.rotation.z=Math.cos(t2*Math.PI)*.25; scene.add(link); }
    addCollider(ox+4,28.68,1.7,.3,"metroRail");
    interact(ms,"The subway",()=>{
      if(!GS.metroOpen){ say("THOMAS","Not tonight. Tonight ends at home."); return; }
      travel("metro",803,3,-Math.PI/2,()=>{ AU.trainStart();
        say(null,"The platform is empty except for the rain that followed him down — and the shape at the far end of it.",5200);
        setObjective("She is waiting on the platform. <b>Go to her.</b>"); }); });
  }
  for(const z of[5,13,21])for(const x of[ox+1.4,ox+14.6]){ const L=mkStreetLamp(); at(L,x,0,z,x<ox+4?0:Math.PI); addCollider(x,z,.3,.3); }
});
function enterBuilding(){
  setObjective("…"); AU.doorHeavy(); AU.windStop();
  say(null,"The key. The stairs. The door. He gets exactly as far as the hallway light switch — and the floor comes up to meet him.",5200);
  later(()=>fadeTo(()=>{ setZone("dream1"); player.seated=false; canStand=false;
    seatPos={x:100,y:1.05,z:20}; player.x=100; player.z=20; player.yaw=0; player.pitch=0;
    dream1Sequence(); },1400),2400);
}

/* ════════ ZONE: DREAM 1 — "Transit" (beat 5) ════════ */
let archGlass=[], gleams=[], dreamBeing=null;
inZone("dream1",()=>{
  const ox=100;
  floorPlane(ox,12,3.2,24,TEX.dreamWall,1.2,0x9a9c9e);
  ceilPlane(ox,12,3.2,24,3.4);
  wall("z",0,24,ox-1.6,3.4,0,TEX.dreamWall,.9,.14); wall("z",0,24,ox+1.6,3.4,0,TEX.dreamWall,.9,.14);
  wall("x",ox-1.6,ox+1.6,24,3.4,0,TEX.dreamWall,.9,.14);
  for(const x of[ox-1.52,ox+1.52])for(let z=1;z<24;z+=2.4){
    const g=new THREE.Mesh(new THREE.PlaneGeometry(.09,2.9),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.5}));
    g.rotation.y=x<ox?Math.PI/2:-Math.PI/2; g.position.set(x,1.6,z); scene.add(g); gleams.push(g); }
  wall("x",ox-1.6,ox+1.6,.4,3.4,0,TEX.dreamWall,.9,.14);
  for(let i=-1;i<=1;i++){
    const ax=ox+i*1.02;
    // Frame each dream pane as an opening.  The prior solid backing made the
    // panes read as floating slabs rather than recessed cells in the corridor.
    const frameM=new THREE.MeshLambertMaterial({color:0x6a6c70});
    for(const dx of[-.39,.39]){ const jamb=box(.08,2.42,.1,frameM); jamb.position.set(ax+dx,1.25,.52); scene.add(jamb); }
    const lintel=box(.86,.1,.1,frameM); lintel.position.set(ax,2.43,.52); scene.add(lintel);
    const sill=box(.86,.08,.14,frameM); sill.position.set(ax,.08,.52); scene.add(sill);
    const gm=new THREE.MeshLambertMaterial({color:0x2a5a58,transparent:true,opacity:.75,emissive:0x0a2422});
    const glass=new THREE.Mesh(new THREE.PlaneGeometry(.7,2.3),gm); glass.position.set(ax,1.25,.59); scene.add(glass);
    archGlass.push(gm);
  }
  addCollider(ox,.5,3.4,.3,"archwall");
  const ch=mkChair(); at(ch,ox,0,20.2,Math.PI); addCollider(ox,20.4,.5,.4);
  const dl=new THREE.PointLight(0xf0f0f4,.5,14,1.4); dl.position.set(ox,3,12); scene.add(dl);
  dreamBeing=group();
  { const b=box(.5,.22,1.7,new THREE.MeshLambertMaterial({color:0xcac2b2})); b.position.y=.1; dreamBeing.add(b);
    const sheet=box(.56,.06,1.74,new THREE.MeshLambertMaterial({color:0xb8b0a0})); sheet.position.y=.24; dreamBeing.add(sheet); }
  dreamBeing.position.set(ox,1.0,4); dreamBeing.visible=false; scene.add(dreamBeing);
});
function dream1Sequence(){
  dread=0;
  seq(([
    [800,()=>say(null,"Two gray walls, facing each other. White light lives in their seams like something breathing.",5200)],
    [5400,()=>say(null,"Arches. Behind each pane of tinted glass: something kept. Something like a dream, pinned.",5200)],
    [5400,()=>{ figure.visible=true; figure.position.set(100,0,9); AU.drone();
      say(null,"A shape drifts down the corridor — long hair moving as if underwater. It stops at an arch. It looks in.",5600); }],
    [6000,()=>{ figure.visible=false; archGlass[1].opacity=.15; AU.creak(); say(null,"The arch opens.",2400); }],
    [2600,()=>{ dreamBeing.visible=true; AU.burst(.5,200,.2,1); dreamBeing.position.z=6;
      say(null,"A being floats out on thin matter, laid flat, as if on a stretcher. Then — it sits up.",5200); }],
    [5400,()=>{ dread=1; scene.fog.color.setHex(0x140c08); scene.background.setHex(0x140c08);
      for(const g of gleams){ g.material.color.setHex(0x2a1408); g.material.opacity=.8; } AU.sting();
      say(null,"Space folds. A tunnel of tar and brick — a throat that yells for escape — the tar reaching, reaching, for a figure on the far side.",6200); }],
    [6600,()=>{ scene.fog.color.setHex(ZONES.dream1.fog[0]); scene.background.setHex(ZONES.dream1.bg);
      for(const m of archGlass){ m.color.setHex(0x030304); m.opacity=1; m.emissive.setHex(0x000000); }
      say(null,"Back in the gray room. The arches stand open now — empty. Black voids where the dreams were kept.",5400); }],
    [5800,()=>{ figure.visible=true; figure.position.set(100,0,5.2); AU.drone();
      say(null,"The shadow bends over the being. In its hand: a needle.",4200); }],
    [4600,()=>{ dread=1; AU.sting(); AU.thud();
      say(null,"Top. Bottom. Under. Between the marrow. The floor learns a new color.",4600); }],
    [5000,()=>{ figure.visible=false; fadeTo(()=>wakeIn8001(),1600); }],
  ]).map(([d,f])=>[d*.68,f]));   // same beats, a third shorter
}
function wakeIn8001(){
  GS.dream1Done=true; dread=.3;
  setZone("floor8"); seatPos={x:2.35,y:1.05,z:5.55}; player.x=2.35; player.z=5.55; player.yaw=-1.34; player.pitch=0;
  player.seated=true; canStand=true;
  say(null,"A year since Eileen. He wakes where he fell asleep: in the chair, in his coat, with the lamp still on.",6500);
  setObjective("Wake up. <b>[E] Stand.</b>");
}

/* ════════ ZONE: GROUND LOBBY (beat 9) ════════ */
let frontDoorIx=null;
inZone("lobbyG",()=>{
  const ox=200;
  floorPlane(ox+5,3,10,6,TEX.hallFloor,1.2);
  ceilPlane(ox+5,3,10,6,4.7);
  wall("z",0,6,ox,4.7,0,TEX.concrete,.7,.16); wall("z",0,6,ox+10,4.7,0,TEX.concrete,.7,.16);
  wall("x",ox,ox+10,0,4.7,0,TEX.wallpaper,.7,.16,[[ox+4.4,ox+5.6]]);   // south wall w/ front door gap
  wall("x",ox,ox+10,6,4.7,0,TEX.wallpaper,.7,.16,[[ox+4.4,ox+5.6]]);   // north wall w/ back door gap
  // elevator (west)
  const ev=mkElevator(); at(ev,ox+.1,0,3,Math.PI/2); addCollider(ox+.2,3,.3,1.8,"elevG");
  interact(ev,"Elevator",()=>openElev("lobbyG"));
  // front door (south) — locked until Ending B metro phase
  const fd=mkDoor(plateTex("EXIT")); fd.position.set(ox+4.55,0,.08); scene.add(fd);
  doorTrim(ox+5,0,.1);
  const fdCol=addCollider(ox+5,.1,1.4,.35,"frontDoor");
  frontDoorIx=interact(fd,"Front doors — to the street",()=>{
    if(!GS.metroOpen){ AU.rattle(); say(null,"Chained for the night. The night porter quit in March; the chain didn't."); return; }
    travel("street",-96,3,Math.PI,()=>{ AU.windStart(); setObjective("The <b>subway</b>, at the end of the street. Go to her."); });
  });
  // back door (north) → alley
  const bd=mkDoor(plateTex("ALLEY")); bd.position.set(ox+4.55,0,5.92); scene.add(bd);
  doorTrim(ox+5,0,5.9);
  addCollider(ox+5,5.9,1.4,.35,"backDoor");
  interact(bd,"Back door — the alley",()=>{
    travel("alley",301.4,3,-Math.PI/2,()=>{
      if(GS.alley2){ say(null,"The rain has thinned. A crescent moon between the fire escapes. Sirens somewhere on the main road, going the other way.",5600); }
      else say(null,"The alley. Rain doing what rain does to garbage. The Old Restock Door waits at the far end.",4800);
      if(!GS.alley2)setObjective("Cross the alley. <b>Unlock the Old Restock Door.</b>"); });
  });
  // ══ dressing (ref: SH2 Wood Side lobby — reception window, notice board with the building map,
  //    a main staircase long since closed, small pools of warm light) ══
  const mb=mkMailboxes(); mb.position.set(ox+8,0,.12); scene.add(mb); addCollider(ox+8,.15,1.45,.25);
  { const ck=mkWallClock(11,40,true); ck.position.set(ox+8,2.45,.14); scene.add(ck);
    interact(ck,"The lobby clock",()=>say(null,"Eleven-forty here too. The whole building has agreed on the time and stopped there.")); }
  const plant=group(); { const pot=new THREE.Mesh(new THREE.CylinderGeometry(.16,.12,.26,8),M.woodDark); pot.position.y=.13; plant.add(pot);
    const stem=box(.03,.7,.03,new THREE.MeshLambertMaterial({color:0x3a3626})); stem.position.y=.6; stem.rotation.z=.3; plant.add(stem); }
  at(plant,ox+1.3,0,5.5); addCollider(ox+1.3,5.5,.4,.4);
  // reception window on the east wall — counter, dark glass, a bell nobody answers
  { const cnt=box(.55,.95,1.9,M.woodDark); cnt.position.set(ox+9.66,.475,3); scene.add(cnt); addCollider(ox+9.66,3,.6,2.0);
    const top=box(.62,.05,2.0,new THREE.MeshLambertMaterial({color:0x4a3a28})); top.position.set(ox+9.64,.97,3); scene.add(top);
    const glass=new THREE.Mesh(new THREE.PlaneGeometry(1.7,1.15),new THREE.MeshLambertMaterial({color:0x0c1210})); glass.position.set(ox+9.95,1.72,3); glass.rotation.y=-Math.PI/2; scene.add(glass);
    for(const gz of[2.1,3.9]){ const jf=box(.08,1.35,.1,M.woodDark); jf.position.set(ox+9.93,1.72,gz); scene.add(jf); }
    const hdw=box(.08,.12,1.9,M.woodDark); hdw.position.set(ox+9.93,2.36,3); scene.add(hdw);
    const rs=decal(tex((g,s)=>{ g.fillStyle="#2a241c"; g.fillRect(0,0,s,s); g.fillStyle="#b8a878"; g.font="bold 26px Courier New";
      g.textAlign="center"; g.fillText("RECEPTION",s/2,s/2+8); grime(g,s,6,.25); },256),1.3,.3);
    rs.position.set(ox+9.9,2.62,3); rs.rotation.y=-Math.PI/2; scene.add(rs);
    const bell=group(); { const dome=new THREE.Mesh(new THREE.SphereGeometry(.055,10,8,0,7,0,1.6),new THREE.MeshLambertMaterial({color:0x9a8148})); dome.position.y=.03; bell.add(dome);
      const base2=new THREE.Mesh(new THREE.CylinderGeometry(.07,.08,.02,10),M.metalDark); base2.position.y=.01; bell.add(base2); }
    bell.position.set(ox+9.6,1.0,2.5); scene.add(bell);
    interact(bell,"A brass service bell",()=>{ AU.key(); say("THOMAS","He doesn't ring it. A year ago there would have been someone to answer."); });
    const ledger=box(.34,.03,.26,M.paper); ledger.position.set(ox+9.62,1.0,3.5); ledger.rotation.y=.2; scene.add(ledger);
    interact(ledger,"The visitors' ledger",()=>say(null,"Open to last October. The pen has rolled into the gutter of the page and stayed there."));
    const gl=new THREE.PointLight(0xc8a060,.4,4.2,1.8); gl.position.set(ox+9.3,1.5,3); scene.add(gl); }
  // The former staircase was a loose run of treads crossing the lobby.  It is
  // now a deliberately sealed stairwell at the north wall: readable, grounded,
  // and clearly separate from the alley door beside it.
  { const frameM=new THREE.MeshLambertMaterial({color:0x39352e});
    const voidM=new THREE.MeshBasicMaterial({color:0x050608});
    const opening=box(2.15,2.18,.08,voidM); opening.position.set(ox+8.15,1.09,5.79); scene.add(opening);
    for(const px of[ox+7.05,ox+9.25]){ const jamb=box(.16,2.3,.13,frameM); jamb.position.set(px,1.15,5.7); scene.add(jamb); }
    const lintel=box(2.36,.16,.13,frameM); lintel.position.set(ox+8.15,2.22,5.7); scene.add(lintel);
    const ply=box(1.92,1.28,.07,new THREE.MeshLambertMaterial({color:0x5e4e3c})); ply.position.set(ox+8.15,.95,5.66); scene.add(ply);
    for(const py of[.52,.95,1.38]){ const brace=box(1.82,.06,.09,new THREE.MeshLambertMaterial({color:0x453a2d})); brace.position.set(ox+8.15,py,5.6); scene.add(brace); }
    const cs=new THREE.Mesh(new THREE.PlaneGeometry(1.2,.48),new THREE.MeshLambertMaterial({map:tex((g,s)=>{ g.fillStyle="#9a8f74"; g.fillRect(0,0,s,s); g.strokeStyle="#4a4234"; g.lineWidth=6; g.strokeRect(6,6,s-12,s-12);
      g.fillStyle="#6e241e"; g.font="bold 30px Courier New"; g.textAlign="center"; g.fillText("STAIRS CLOSED",s/2,s/2-8); g.fillStyle="#2e2a22"; g.font="bold 22px Courier New"; g.fillText("— USE LIFT —",s/2,s/2+26); grime(g,s,10,.4); },256)}));
    cs.position.set(ox+8.15,1.04,5.61); cs.rotation.y=Math.PI; scene.add(cs);
    addCollider(ox+8.15,5.48,2.4,.55);
    interact(ply,"The stairwell, boarded over",()=>say(null,"Closed for repairs in a year that never came. The lift is the only way this building goes up."));}
  // bulletin board with the building map, by the front doors
  { const bb=box(1.35,.95,.05,M.woodDark); bb.position.set(ox+2.2,1.55,.14); scene.add(bb);
    const cork=decal(tex((g,s)=>{ g.fillStyle="#7a6844"; g.fillRect(0,0,s,s);
      for(let i=0;i<340;i++){ g.fillStyle=Math.random()>.5?"#6d5c3a":"#84714c"; g.fillRect(Math.random()*s,Math.random()*s,2,2); }
      g.fillStyle="#d8d0b8"; g.fillRect(22,26,88,110); g.strokeStyle="#3a362c"; g.lineWidth=2;
      for(const [rx,ry2,rw,rh] of[[30,36,30,20],[66,36,36,20],[30,64,72,14],[30,86,20,40],[58,86,44,18],[58,112,44,14]])g.strokeRect(rx,ry2,rw,rh);
      g.fillStyle="#22201a"; g.font="bold 11px Courier New"; g.fillText("HALDANE COURT",26,22); g.font="9px Courier New"; g.fillText("FLOOR PLAN",34,132);
      g.fillStyle="#c8c0a0"; g.fillRect(128,30,80,52); g.fillStyle="#4a4436"; g.font="8px Courier New";
      g.fillText("BIN DAY IS",136,46); g.fillText("TUESDAY.",136,58); g.fillText("IT HAS BEEN",136,70); g.fillText("TUESDAY.",136,80);
      g.fillStyle="#b8ae90"; g.fillRect(128,94,80,44); g.fillStyle="#4a4436"; g.fillText("PIANO LESSONS",132,110); g.fillText("FLAT 2104",132,122);
      grime(g,s,6,.2); },256),1.22,.82);
    cork.position.set(ox+2.2,1.55,.175); scene.add(cork);
    interact(bb,"The notice board",()=>say(null,"A floor plan gone yellow. Twenty-one floors of other people's lives, and two flats that matter: 8001, and the roof."));}
  // building name over the doors, mat below them, radiator by the lift
  { const hs=decal(tex((g,s)=>{ g.fillStyle="#241f18"; g.fillRect(0,0,s,s); g.fillStyle="#a89468"; g.font="bold 30px Courier New";
      g.textAlign="center"; g.fillText("HALDANE COURT",s/2,s/2+10); grime(g,s,8,.3); },256),1.7,.32);
    hs.position.set(ox+5,2.62,.13); scene.add(hs);
    const mat=new THREE.Mesh(new THREE.PlaneGeometry(1.5,.8),new THREE.MeshLambertMaterial({color:0x181a16}));
    mat.rotation.x=-Math.PI/2; mat.position.set(ox+5,.012,.9); scene.add(mat);
    const rad=mkRadiator(); at(rad,ox+.4,0,1.2,Math.PI/2); addCollider(ox+.4,1.2,.3,.95); }
  const fl=mkFluorescent(); fl.position.set(ox+6.4,3.3,3); scene.add(fl);
  const fl2=mkFluorescent(); fl2.position.set(ox+2.6,3.3,3); scene.add(fl2); flickers.push(fl2);
});

/* ════════ ZONE: ALLEY (beats 10 & 14) ════════ */
let restockDoor=null, moonSpr=null;
/* shared ambient-FX state (steam pulse, neon flicker, beacon blink, fairy bulb) */
let fxSteams=[], neonSignMesh=null, neonLight=null, fxBeacons=[], fxFairyBulb=null;
inZone("alley",()=>{
  const ox=300;
  wetMat(floorPlane(ox+11,1,22,10,TEX.asphalt,1.4).material,.5,26);
  wall("x",ox,ox+22,-4,17,0,TEX.brickExt,.45,.2);
  wall("x",ox,ox+22,6,17,0,TEX.brickExt,.45,.2,[[ox+17.3,ox+18.5]]); // restock door gap
  wall("z",-4,6,ox+22,17,0,TEX.brickExt,.45,.2);
  wall("z",-4,6,ox,17,0,TEX.brickExt,.45,.2,[[2.3,3.7]]); // back-door gap
  // back door (west) → lobbyG — a steel service door under a caged lamp
  const steelTex=tex((g,s)=>{ g.fillStyle="#3d4348"; g.fillRect(0,0,s,s);
    g.fillStyle="#333940"; for(let i=0;i<5;i++)g.fillRect(0,10+i*24,s,3);
    g.fillStyle="#565e66"; g.fillRect(8,s-34,s-16,26); // kickplate
    g.fillStyle="#6a7078"; g.fillRect(s-30,58,14,4);   // handle
    grime(g,s,12,.35); },128);
  const bd=mkDoor(null); bd.children[0].material=new THREE.MeshLambertMaterial({map:steelTex});
  bd.position.set(ox+.08,0,3.45); bd.rotation.y=Math.PI/2; scene.add(bd);
  doorTrim(ox+.1,0,3.0,Math.PI/2,M.metalDark);
  addCollider(ox+.15,3.0,.35,1.5);
  { const stcl=decal(tex((g,s)=>{ g.clearRect(0,0,s,s); g.fillStyle="#98a0a8"; g.font="bold 21px Courier New"; g.textAlign="center";
      g.fillText("HALDANE COURT",s/2,s/2-8); g.fillText("SERVICE",s/2,s/2+18); },256),.72,.34);
    stcl.position.set(ox+.16,1.78,3.0); stcl.rotation.y=Math.PI/2; scene.add(stcl);
    const cage=box(.2,.14,.2,M.metalDark); cage.position.set(ox+.22,2.62,3.0); scene.add(cage);
    const cl=new THREE.PointLight(0xc8a060,.75,6,1.7); cl.position.set(ox+.5,2.5,3.0); scene.add(cl);
    const buzz=box(.1,.16,.05,M.metalDark); buzz.position.set(ox+.14,1.25,2.28); scene.add(buzz);
    interact(buzz,"The service buzzer",()=>{ AU.rattle(); say(null,"A dry click. Whatever it used to ring is long past ringing."); });
    const vent=box(.05,.32,.55,M.metal); vent.position.set(ox+.14,2.85,3.0); scene.add(vent);
    const sill=box(.06,.1,1.35,new THREE.MeshLambertMaterial({map:TEX.concrete})); sill.position.set(ox+.2,.05,3.0); scene.add(sill); }
  interact(bd,"Back into the building",()=>travel("lobbyG",205,5.2,Math.PI,()=>{}));
  // Old Restock Door (east end, north wall)
  restockDoor=mkDoor(tex((g,s)=>{ g.fillStyle="#4a3020"; g.fillRect(0,0,s,s);
    g.fillStyle="#c8b890"; g.font="bold 30px Courier New"; g.textAlign="center";
    g.fillText("OLD",s/2,s/2-14); g.fillText("RESTOCK",s/2,s/2+22); grime(g,s,10,.3); },128));
  restockDoor.position.set(ox+17.45,0,5.92); scene.add(restockDoor);
  doorTrim(ox+17.9,0,5.9,0,M.metalDark);
  { // gooseneck lamp over the door — the alley's one deliberate pool of light
    const arm=box(.06,.06,.7,M.metalDark); arm.position.set(ox+17.9,2.75,5.55); scene.add(arm);
    const shade=new THREE.Mesh(new THREE.CylinderGeometry(.16,.24,.16,10),M.metalDark); shade.position.set(ox+17.9,2.66,5.22); scene.add(shade);
    const gl=new THREE.PointLight(0xd8b070,.9,6.5,1.6); gl.position.set(ox+17.9,2.45,5.2); scene.add(gl);
    const sg=decal(tex((g,s)=>{ g.fillStyle="#2c2620"; g.fillRect(0,0,s,s); g.fillStyle="#a89468"; g.font="bold 17px Courier New"; g.textAlign="center";
      g.fillText("DELIVERIES:",s/2,s/2-8); g.fillText("RING FRONT DESK",s/2,s/2+14); grime(g,s,8,.35); },256),.66,.3);
    sg.position.set(ox+16.6,1.7,5.88); sg.rotation.y=Math.PI; scene.add(sg);
    for(let i=0;i<3;i++){ const cr=box(.46,.34,.4,new THREE.MeshLambertMaterial({color:i%2?0x4a5238:0x54402c}));
      cr.position.set(ox+19.2,.17+(i>1?.35:0),5.2-(i%2)*.3); cr.rotation.y=.2+i*.5; scene.add(cr); }
    addCollider(ox+19.2,5.1,.9,.9);
    const sill=box(1.3,.1,.08,new THREE.MeshLambertMaterial({map:TEX.concrete})); sill.position.set(ox+17.9,.05,5.85); scene.add(sill); }
  const rdCol=addCollider(ox+17.9,5.9,1.3,.35,"restockDoor");
  interact(restockDoor,"The Old Restock Door",()=>{
    if(GS.restockUnlocked){ travel("restock",405,6.6,Math.PI,()=>{}); return; }
    if(inv.has("key_restock")){ GS.restockUnlocked=true; AU.key(); AU.creak();
      say("THOMAS","Her key. His hands remember how a lock gives.");
      setObjective("Inside: the restock room. <b>Find the generator.</b>");
      later(()=>travel("restock",405,6.6,Math.PI,()=>{}),1200); }
    else { AU.rattle(); say(null,"Locked. Old brass. The kind of lock a small key with a worn head would fit."); }
  });
  // ══ dressing — damp, lived-in, seedy (ref: SH2 palette = colour from materials, small pools of light) ══
  // wet asphalt: puddles reflecting the sky (radial-gradient planes)
  const puddleTex=tex((g,s)=>{ g.clearRect(0,0,s,s); const r=g.createRadialGradient(s/2,s/2,4,s/2,s/2,s/2);
    r.addColorStop(0,"rgba(38,48,66,.85)"); r.addColorStop(.7,"rgba(24,30,44,.5)"); r.addColorStop(1,"rgba(0,0,0,0)");
    g.fillStyle=r; g.beginPath(); g.ellipse(s/2,s/2,s*.48,s*.3,0,0,7); g.fill(); },128);
  for(const [px,pz,pw,pr] of[[ox+5.5,2.4,1.8,.3],[ox+9.5,4.2,2.4,1.2],[ox+13.6,1.5,1.6,2.2],[ox+18.6,3.4,2.0,.7],[ox+2.6,4.6,1.4,1.9]]){
    const pd=new THREE.Mesh(new THREE.PlaneGeometry(pw,pw*.55),new THREE.MeshBasicMaterial({map:puddleTex,transparent:true,depthWrite:false}));
    pd.rotation.x=-Math.PI/2; pd.rotation.z=pr; pd.position.set(px,.015,pz); scene.add(pd); }
  // dumpster corner: dumpster + pallet + beer crates + cardboard + bags drifted around it
  const dmp=mkDumpster(); at(dmp,ox+7,0,5.2,0); addCollider(ox+7,5.2,1.8,1);
  { const pal=box(1.1,.1,.8,M.woodDark); pal.position.set(ox+8.5,.05,5.3); pal.rotation.y=.3; scene.add(pal);
    for(let i=0;i<2;i++){ const cr=box(.42,.3,.32,new THREE.MeshLambertMaterial({color:0x5a2a20})); cr.position.set(ox+8.4+i*.1,.15+i*.31,5.25); cr.rotation.y=.3+i*.4; scene.add(cr); }
    const cb=box(.5,.42,.45,new THREE.MeshLambertMaterial({color:0x6a5638})); cb.position.set(ox+5.9,.21,5.35); cb.rotation.y=-.4; scene.add(cb);
    const cb2=box(.4,.32,.4,new THREE.MeshLambertMaterial({color:0x75603c})); cb2.position.set(ox+6.0,.55,5.3); cb2.rotation.y=.2; scene.add(cb2); }
  for(const [x,z] of[[ox+4,-3.2],[ox+11,5.2],[ox+14,-3.1],[ox+19.5,-3.0],[ox+7.9,4.7]]){
    const bag=new THREE.Mesh(new THREE.SphereGeometry(.3,7,5),new THREE.MeshLambertMaterial({color:0x14161a}));
    bag.scale.y=.7; bag.position.set(x,.2,z); scene.add(bag); addCollider(x,z,.55,.55); }
  // ══ REAL fire escape (north wall, above the dumpster): platforms + angled stair runs + rails + drop ladder ══
  { const feM=M.metalDark;
    for(let lvl=0;lvl<3;lvl++){ const y=2.6+lvl*1.9;
      const plat=box(3.0,.07,.95,feM); plat.position.set(ox+5,y,5.45); scene.add(plat);
      // grated look: thin slats under platform
      for(let sl=0;sl<5;sl++){ const s2=box(3.0,.02,.05,M.metal); s2.position.set(ox+5,y-.05,5.05+sl*.2); scene.add(s2); }
      const rail=box(3.0,.06,.04,feM); rail.position.set(ox+5,y+.95,5.0); scene.add(rail);
      for(const rx of[-1.4,-.7,0,.7,1.4]){ const p2=box(.04,.95,.04,feM); p2.position.set(ox+5+rx,y+.48,5.0); scene.add(p2); }
      // diagonal stair run to the level above (alternating direction, treads climbing across the platform)
      if(lvl<2){ const dir=lvl%2?-1:1;
        const stringer=box(2.6,.07,.07,feM);
        stringer.position.set(ox+5,y+.95,5.45); stringer.rotation.z=dir*.63; scene.add(stringer);
        for(let st=0;st<6;st++){ const t2=st/5;
          const tread=box(.5,.035,.7,M.metal);
          tread.position.set(ox+5+dir*(t2*2.2-1.1), y+.2+t2*1.5, 5.45); scene.add(tread); } } }
    // counterweight drop ladder, ends out of reach (classic alley beat)
    for(const lz of[5.25,5.65]){ const r2=box(.05,2.0,.05,feM); r2.position.set(ox+3.7,1.7,lz); scene.add(r2); }
    for(let rung=0;rung<6;rung++){ const rg=box(.05,.05,.44,M.metal); rg.position.set(ox+3.7,1.0+rung*.32,5.45); scene.add(rg); } }
  // ══ overhead cables sagging across the alley ══
  for(const [cx,cy,sag] of[[ox+6.5,6.4,.5],[ox+12,5.8,.7],[ox+17,6.6,.4]]){
    for(let seg=0;seg<5;seg++){ const t2=seg/4, z1=t2*6;
      const dip=Math.sin(t2*Math.PI)*sag;
      const c2=box(.03,.03,1.6,new THREE.MeshLambertMaterial({color:0x0c0c0e}));
      c2.position.set(cx,cy+3-dip,z1*1.5-3.4); c2.scale.z=1.7; c2.rotation.x=Math.cos(t2*Math.PI)*sag*.5; scene.add(c2); } }
  // ══ wall furniture: downspouts, AC units, barred window with sickly light ══
  for(const [dx,dz] of[[ox+3.2,-3.65],[ox+15.8,5.72],[ox+20.8,-3.65]]){
    const ds=new THREE.Mesh(new THREE.CylinderGeometry(.07,.07,16.6,7),M.metalDark); ds.position.set(dx,8.3,dz); scene.add(ds);
    const shoe=new THREE.Mesh(new THREE.CylinderGeometry(.07,.09,.5,7),M.metalDark); shoe.position.set(dx,.25,dz+.12); shoe.rotation.x=.6; scene.add(shoe); }
  for(const [ax,az,ry] of[[ox+9.5,-3.7,0],[ox+13.5,5.72,Math.PI],[ox+18.5,-3.7,0]]){
    const ac=box(.8,.55,.42,M.metal); ac.position.set(ax,3.1,az+.2*(ry?-1:1)); scene.add(ac);
    const grill=box(.6,.35,.03,M.metalDark); grill.position.set(ax,3.1,az+(ry?-.42:.42)); scene.add(grill);
    const brk=box(.9,.05,.5,M.metalDark); brk.position.set(ax,2.8,az+.2*(ry?-1:1)); scene.add(brk); }
  { // barred window, south wall — weak sickly green spill (damp SH palette accent)
    const rec=new THREE.Mesh(new THREE.PlaneGeometry(1.1,.9),new THREE.MeshBasicMaterial({color:0x141c12}));
    rec.position.set(ox+10.5,1.9,-3.78); scene.add(rec);
    for(let b2=0;b2<4;b2++){ const bar=box(.04,.9,.04,M.metalDark); bar.position.set(ox+10.1+b2*.27,1.9,-3.74); scene.add(bar); }
    const sill=box(1.2,.07,.14,new THREE.MeshLambertMaterial({map:TEX.concrete})); sill.position.set(ox+10.5,1.42,-3.74); scene.add(sill);
    const wlt=new THREE.PointLight(0x7a9060,.35,4.5,2); wlt.position.set(ox+10.5,1.8,-3.3); scene.add(wlt); }
  // ══ steam grate mid-alley (pulsing translucent plumes) ══
  { const grate=new THREE.Mesh(new THREE.PlaneGeometry(1.0,.7),new THREE.MeshBasicMaterial({color:0x08090b}));
    grate.rotation.x=-Math.PI/2; grate.position.set(ox+13.5,.02,2.4); scene.add(grate);
    for(let gb=0;gb<5;gb++){ const gbar=box(.06,.012,.7,M.metalDark); gbar.position.set(ox+13.15+gb*.18,.03,2.4); scene.add(gbar); }
    const steamTex=tex((g,s)=>{ g.clearRect(0,0,s,s); const r=g.createRadialGradient(s/2,s*.75,6,s/2,s*.45,s*.55);
      r.addColorStop(0,"rgba(170,180,190,.5)"); r.addColorStop(1,"rgba(170,180,190,0)"); g.fillStyle=r; g.fillRect(0,0,s,s); },128);
    for(let sq=0;sq<3;sq++){ const st=new THREE.Mesh(new THREE.PlaneGeometry(.9,1.5),
        new THREE.MeshBasicMaterial({map:steamTex,transparent:true,depthWrite:false,opacity:.28}));
      st.position.set(ox+13.5,.8+sq*.55,2.4); st.rotation.y=sq*1.1; fxSteams.push(st); scene.add(st); } }
  // ══ graffiti + peeling posters ══
  { const graf=tex((g,s)=>{ g.clearRect(0,0,s,s); g.strokeStyle="rgba(150,60,50,.75)"; g.lineWidth=9; g.lineJoin="round";
      g.beginPath(); g.moveTo(14,86); g.quadraticCurveTo(34,18,58,72); g.quadraticCurveTo(76,110,96,40); g.stroke();
      g.strokeStyle="rgba(90,110,140,.55)"; g.lineWidth=5; g.beginPath(); g.moveTo(20,104); g.lineTo(108,96); g.stroke(); },128);
    const gd=new THREE.Mesh(new THREE.PlaneGeometry(2.4,1.5),new THREE.MeshBasicMaterial({map:graf,transparent:true,depthWrite:false}));
    gd.position.set(ox+9.7,1.5,5.78); gd.rotation.y=Math.PI; scene.add(gd); }
  const posterTex=(lines,bg)=>tex((g,s)=>{ g.fillStyle=bg; g.fillRect(6,4,s-12,s-8); g.fillStyle="rgba(0,0,0,.25)"; g.fillRect(6,s*.62,s-12,s*.3);
    g.fillStyle="#c8beac"; g.font="bold 17px Courier New"; g.textAlign="center"; lines.forEach((l2,i2)=>g.fillText(l2,s/2,26+i2*20)); grime(g,s,8,.35); },128);
  [[ox+6.2,1.7,["ROOM","TO","LET"], "#4a4438",0],[ox+16.4,1.9,["MISSING","HAVE YOU","SEEN"], "#54483a",.08],[ox+16.9,1.6,["",""],"#3a3a40",-.1]].forEach(([px2,py2,ls,bg,rz])=>{
    const po=new THREE.Mesh(new THREE.PlaneGeometry(.62,.82),new THREE.MeshBasicMaterial({map:posterTex(ls,bg),transparent:true}));
    po.position.set(px2,py2,-3.78); po.rotation.z=rz; scene.add(po); });
  // ══ chain-link fence partition near the dead end — the neon world beyond, out of reach ══
  { const fenceTex=tex((g,s)=>{ g.clearRect(0,0,s,s); g.strokeStyle="rgba(120,126,134,.8)"; g.lineWidth=2;
      for(let i2=-8;i2<16;i2++){ g.beginPath(); g.moveTo(i2*16,0); g.lineTo(i2*16+s,s); g.stroke();
        g.beginPath(); g.moveTo(i2*16+s,0); g.lineTo(i2*16,s); g.stroke(); } },128);
    fenceTex.wrapS=fenceTex.wrapT=THREE.RepeatWrapping; fenceTex.repeat.set(18,6);
    fenceTex.magFilter=THREE.LinearFilter; fenceTex.minFilter=THREE.LinearMipmapLinearFilter; fenceTex.generateMipmaps=true;
    const fence=new THREE.Mesh(new THREE.PlaneGeometry(10,3.2),new THREE.MeshBasicMaterial({map:fenceTex,transparent:true,side:THREE.DoubleSide,depthWrite:false}));
    fence.position.set(ox+20.3,1.6,1); fence.rotation.y=Math.PI/2; scene.add(fence);
    for(const fz of[-3.7,-1.2,1.2,3.4,5.6]){ const fp=new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,3.3,7),M.metalDark); fp.position.set(ox+20.3,1.65,fz); scene.add(fp); }
    const topRail=box(.05,.05,9.6,M.metalDark); topRail.position.set(ox+20.3,3.25,1); scene.add(topRail);
    addCollider(ox+20.3,1,.25,9.8);
    interact(fence,"Chain-link — padlocked",()=>say(null,"A padlock gone orange with rust. Whatever is open past the fence, it isn't open to him."));
    // trash drifted against the fence
    for(const [tx2,tz2] of[[ox+20.0,1.4],[ox+20.05,4.3],[ox+19.9,2.5]]){ const tb=new THREE.Mesh(new THREE.SphereGeometry(.22,6,5),new THREE.MeshLambertMaterial({color:0x191b1e}));
      tb.scale.y=.6; tb.position.set(tx2,.14,tz2); scene.add(tb); } }
  // ══ dead neon beyond the fence — "OPEN", only half alive, buzzing red-pink ══
  { neonSignMesh=new THREE.Mesh(new THREE.PlaneGeometry(1.7,.55),new THREE.MeshBasicMaterial({transparent:true,map:tex((g,s)=>{
      g.clearRect(0,0,s,s); g.font="bold 52px Courier New"; g.textAlign="center";
      g.shadowColor="rgba(220,70,90,.9)"; g.shadowBlur=16; g.fillStyle="#e86a80"; g.fillText("OP",s/2-30,s/2+18);
      g.shadowBlur=0; g.fillStyle="rgba(90,40,48,.7)"; g.fillText("EN",s/2+34,s/2+18); },128)}));
    neonSignMesh.scale.set(1.35,1.35,1); neonSignMesh.position.set(ox+21.8,4.35,3); neonSignMesh.rotation.y=-Math.PI/2; scene.add(neonSignMesh);
    neonLight=new THREE.PointLight(0xd85a70,.55,8,1.7); neonLight.position.set(ox+21.3,4.1,3); scene.add(neonLight); }
  // ══ lighting: sodium bracket over the back door + existing caged bulb at restock ══
  { const brk2=box(.14,.1,.5,M.metalDark); brk2.position.set(ox+.28,3.3,3.5); scene.add(brk2);
    const head=box(.3,.14,.3,M.metalDark); head.position.set(ox+.55,3.24,3.5); scene.add(head);
    const sod=new THREE.PointLight(0xc87830,.75,6,1.7); sod.position.set(ox+.6,3.0,3.5); scene.add(sod); }
  // one caged bulb over the restock door
  const cl=new THREE.PointLight(0xc89050,.8,5,1.7); cl.position.set(ox+17.9,2.4,5.5); scene.add(cl);
  const fix=box(.16,.12,.16,M.metalDark); fix.position.set(ox+17.9,2.5,5.7); scene.add(fix);
  // crescent moon (state 2)
  moonSpr=new THREE.Mesh(new THREE.PlaneGeometry(1.6,1.6),new THREE.MeshBasicMaterial({transparent:true,opacity:.9,map:tex((g,s)=>{
    g.clearRect(0,0,s,s); g.fillStyle="#e8e4d0"; g.beginPath(); g.arc(s/2,s/2,58,0,7); g.fill();
    g.globalCompositeOperation="destination-out"; g.beginPath(); g.arc(s/2+30,s/2-10,54,0,7); g.fill(); },128)}));
  moonSpr.position.set(ox+11,7.4,3); moonSpr.visible=false; scene.add(moonSpr);
});

/* ════════ ZONE: RESTOCK ROOM (beats 11 & 13 — generator, then 24 boxes) ════════ */
let genProp=null, mossSet=null, genSet=null, crates=[], genLight=null;
const BOX_ICONS=["crescent","triangle","spiral"];
inZone("restock",()=>{
  const ox=400;
  floorPlane(ox+5,4,10,8,TEX.concrete,1.1,0x8a8078);
  ceilPlane(ox+5,4,10,8,4.3);
  wall("x",ox,ox+10,0,4.3,0,TEX.concrete,.8,.16);
  wall("x",ox,ox+10,8,4.3,0,TEX.concrete,.8,.16,[[ox+4.3,ox+5.7]]); // door gap (north, to alley)
  wall("z",0,8,ox,4.3,0,TEX.concrete,.8,.16); wall("z",0,8,ox+10,4.3,0,TEX.concrete,.8,.16);
  const dr=mkDoor(plateTex("——")); dr.position.set(ox+4.45,0,7.9); scene.add(dr);
  doorTrim(ox+4.9,0,7.9);
  addCollider(ox+5,7.9,1.5,.35);
  interact(dr,"Back to the alley",()=>{
    if(GS.boxPhase&&!(GS.boxFound.key&&GS.boxFound.piece)){ say("THOMAS","Not yet. Whatever she left me is in these boxes."); return; }
    travel("alley",317.9,4.9,Math.PI,()=>{ if(GS.alley2){ AU.sirenStart();
      say(null,"The rain has thinned to a hiss. A crescent moon. Sirens on the main road, far off, no business of his.",5400);
      setObjective("Back through the lobby. <b>Elevator — the 21st floor.</b>"); } });
  });
  /* ---- state 1: generator dressing ---- */
  genSet=new THREE.Group(); scene.add(genSet);
  genProp=mkGenerator(); genProp.position.set(ox+8.6,0,4); genProp.rotation.y=-Math.PI/2; genSet.add(genProp);
  addCollider(ox+8.6,4,.8,1.4);
  // shelving skeletons
  for(const z of[1.2,6.8]){ for(let i=0;i<3;i++){ const sh=box(2.6,.05,.5,M.woodDark); sh.position.set(ox+2.4,.5+i*.7,z); genSet.add(sh); }
    const p1=box(.06,2,.06,M.metalDark); p1.position.set(ox+1.2,1,z); genSet.add(p1);
    const p2=p1.clone(); p2.position.x=ox+3.6; genSet.add(p2); addCollider(ox+2.4,z,2.8,.6); }
  // n_order1 note pinned by generator
  const no1=new THREE.Mesh(new THREE.PlaneGeometry(.2,.26),new THREE.MeshLambertMaterial({map:TEX.noteSmall}));
  no1.position.set(ox+9.9,1.5,4); no1.rotation.y=-Math.PI/2; scene.add(no1);
  interact(no1,"A page, pinned by the generator",()=>{ AU.paper(); collectNote("n_order1"); openNote("n_order1"); });
  genLight=new THREE.PointLight(0xc8a070,0,7,1.6); genLight.position.set(ox+5,2.5,4); scene.add(genLight);
  const bulb=box(.1,.14,.1,M.metalDark); bulb.position.set(ox+5,2.7,4); scene.add(bulb);
  interact(genProp,"The generator",()=>{
    if(GS.generatorOn)return;
    GS.generatorOn=true; AU.valve(); AU.genHum(true); genProp.userData.lever.rotation.z=-.5;
    genLight.intensity=1.2; say(null,"It catches. It coughs. It runs. The bulb overhead remembers its job—",3400);
    // let the room come alive before it is taken away: the bulb steadies, then starts to fail
    later(()=>say(null,"For a moment the room is only a room. Shelves. Dust. A page pinned to the wall.",4200),3800);
    later(()=>{ flickers.push({userData:{light:genLight,tube:{material:{color:{setHex(){}}}}}}); dread=.6; },7600);
    later(()=>{ flickers.pop(); AU.genHum(false); AU.sting(); dread=1;
      fadeTo(()=>startChase(),1400); },10200);
  });
  /* ---- state 2: mossy brick + 24 boxes (hidden until after chase) ---- */
  mossSet=new THREE.Group(); mossSet.visible=false; scene.add(mossSet);
  const skin=(x1,x2,z,face)=>{ const p=new THREE.Mesh(new THREE.PlaneGeometry(x2-x1,4.3),surf(TEX.mossBrick,x2-x1,4.3,.7));
    p.position.set((x1+x2)/2,2.15,z); p.rotation.y=face; mossSet.add(p); };
  skin(ox,ox+10,.1,0); skin(ox,ox+10,7.9,Math.PI);
  { const p=new THREE.Mesh(new THREE.PlaneGeometry(8,4.3),surf(TEX.mossBrick,8,4.3,.7)); p.rotation.y=Math.PI/2; p.position.set(ox+.1,2.15,4); mossSet.add(p);
    const p2=p.clone(); p2.rotation.y=-Math.PI/2; p2.position.x=ox+9.9; mossSet.add(p2); }
  // wall icons (3 glyphs scratched into the moss)
  const iconAt=[[ox+2.2,1.6,.12,0],[ox+9.88,1.7,2.2,-Math.PI/2],[ox+6.4,1.5,7.88,Math.PI]];
  BOX_ICONS.forEach((k,i)=>{ const d=decal(iconTex(k),.5,.5); d.position.set(iconAt[i][0],iconAt[i][1],iconAt[i][2]); d.rotation.y=iconAt[i][3]; mossSet.add(d); });
  // 24 crates, 3 marked
  const spots=[]; for(let r=0;r<4;r++)for(let c=0;c<6;c++)spots.push([ox+1.4+c*1.45,1.6+r*1.55]);
  const marked=[3,10,20]; // crate indices carrying icons (fixed per session)
  const rewards={3:"key",10:"piece",20:"note"};
  spots.forEach(([x,z],i)=>{
    const cr=mkCrate24(); cr.position.set(x+(Math.random()-.5)*.2,0,z+(Math.random()-.5)*.2); cr.rotation.y=(Math.random()-.5)*.5; mossSet.add(cr);
    addCollider(x,z,.7,.7);
    const mi=marked.indexOf(i);
    if(mi>=0){ const d=decal(iconTex(BOX_ICONS[mi]),.24,.24); d.position.set(0,.3,.33); cr.add(d); cr.userData.reward=rewards[i]; }
    cr.userData.opened=false; crates.push(cr);
    interact(cr,"Open the box",()=>openCrate(cr));
  });
  const ml=new THREE.PointLight(0xa8b090,0,8,1.6); ml.position.set(ox+5,2.5,4); mossSet.add(ml); mossSet.userData.light=ml;
});
function openCrate(cr){
  if(!GS.boxPhase||cr.userData.opened)return;
  cr.userData.opened=true; cr.userData.lid.position.y=.2; cr.userData.lid.position.z=-.5; cr.userData.lid.rotation.x=-1.2; AU.creak();
  if(cr.userData.reward){
    if(cr.userData.reward==="key"&&!GS.boxFound.key){ GS.boxFound.key=true; give("key_terrace","🗝","TERRACE"); say("THOMAS","A key, wrapped in newspaper from last spring. TERRACE, on the fob. Her lettering."); }
    if(cr.userData.reward==="piece"&&!GS.boxFound.piece){ GS.boxFound.piece=true; give("piece2","🧩","PIECE #2"); AU.thud(); say(null,"Another piece of the shape. It is starting to look like a key."); }
    if(cr.userData.reward==="note"&&!GS.boxFound.note){ GS.boxFound.note=true; AU.paper(); collectNote("n_boxes"); openNote("n_boxes"); }
    if(GS.boxFound.key&&GS.boxFound.piece){ setObjective("The alley. The lobby. The elevator. <b>The 21st floor.</b>"); GS.alley2=true; GS.elev21=true;
      if(moonSpr)moonSpr.visible=true; }
    return;
  }
  GS.boxTries++;
  const lines=["Dust. Mouse droppings. Nothing of hers.","Jars of nails, sorted by a dead man.","Newspaper. 1998 was worried about different things.","Empty. Even the emptiness is dusty.","A tangle of Christmas lights, all dead."];
  say(null,lines[(Math.random()*lines.length)|0]);
  if(GS.boxTries>=6){
    GS.boxTries=0; dread=1; AU.sting();
    crates.forEach(c=>{ if(!c.userData.reward||!( (c.userData.reward==="key"&&GS.boxFound.key)||(c.userData.reward==="piece"&&GS.boxFound.piece)||(c.userData.reward==="note"&&GS.boxFound.note) )){
      c.userData.opened=false; c.userData.lid.position.set(0,.575,0); c.userData.lid.rotation.x=0; } });
    say(null,"The bulb gutters — and every lid is shut again, as if his hands had done nothing all night. The marks on the walls. LOOK at the marks.",6200);
  } else if(GS.boxTries===4){ say(null,"His hands are shaking. The icons on the walls — match them. Stop guessing.",4200); }
}
function startChase(){
  setZone("dream2"); GS.chase=true; dread=.7;
  player.x=502; player.z=44; player.yaw=0; player.pitch=0; player.seated=false;
  figure.visible=true; figure.position.set(502,0,33);
  AU.drone();
  say(null,"A hallway that was never on any floor plan. At the end of it: her shape, already walking away.",5000);
  setObjective("<b>Follow her.</b>");
}

/* ════════ ZONE: DREAM 2 — the chase (beat 12) ════════ */
let voidDoor=null;
inZone("dream2",()=>{
  const ox=502;
  floorPlane(ox,23,3.2,46,TEX.planksOld,1.0,0x6a6058);
  ceilPlane(ox,23,3.2,46,2.6);
  wall("z",0,46,ox-1.6,2.6,0,TEX.wallpaperOld,.75,.14); wall("z",0,46,ox+1.6,2.6,0,TEX.wallpaperOld,.75,.14);
  wall("x",ox-1.6,ox+1.6,46,2.6,0,TEX.wallpaperOld,.75,.14);
  wall("x",ox-1.6,ox+1.6,.4,2.6,0,TEX.wallpaperOld,.75,.14);
  for(let z=4;z<44;z+=6){ const sc=mkSconce(Math.random()<.4); sc.position.set(ox-1.52,1.7,z); scene.add(sc); }
  // A real framed void, not two coincident planes that fight for the same
  // pixels.  The dark opening remains readable from the full corridor.
  voidDoor=new THREE.Mesh(new THREE.PlaneGeometry(1.1,2.2),new THREE.MeshBasicMaterial({color:0x000000}));
  voidDoor.position.set(ox,1.1,.62); scene.add(voidDoor);
  const rimM=new THREE.MeshLambertMaterial({color:0x28303c});
  for(const rx of[-.62,.62]){ const jamb=box(.12,2.36,.08,rimM); jamb.position.set(ox+rx,1.18,.59); scene.add(jamb); }
  const top=box(1.36,.12,.08,rimM); top.position.set(ox,2.3,.59); scene.add(top);
  const sill=box(1.36,.08,.14,rimM); sill.position.set(ox,.04,.59); scene.add(sill);
});
function endChase(){
  GS.chase=false; figure.visible=false; AU.sting();
  fadeTo(()=>{
    setZone("restock"); player.x=405; player.z=4; player.yaw=Math.PI; player.pitch=0;
    genSet.visible=false; mossSet.visible=true; mossSet.userData.light.intensity=1.2; genLight.intensity=0;
    GS.boxPhase=true; dread=.5;
    say(null,"He wakes on the restock-room floor. The walls have changed their minds: old brick, moss in the mortar, and boxes. Twenty-four boxes that were not here before.",6600);
    setObjective("Search the boxes. The <b>marks on the walls</b> know which ones. <em>(He'll only stomach opening 6.)</em>");
  },1200);
}

/* ════════ ZONE: 21st FLOOR (beats 14–15) ════════ */
let terrPhotoMesh=null;
inZone("floor21",()=>{
  const ox=600;
  { const bike=mkBicycle(); at(bike,ox+7.5,0,.55,-.12); bike.rotation.z=.16; bike.position.y=.09; addCollider(ox+7.5,.55,1.4,.6);
    interact(bike,"A bicycle in the corridor",()=>say(null,"Chained to nothing. Wet tyre tracks long dried. Somebody rode home tonight and is already asleep.")); }
  floorPlane(ox+9,1.1,18,2.2,TEX.hallFloor,1.2);
  ceilPlane(ox+9,1.1,18,2.2,3.0);
  { const run=new THREE.Mesh(new THREE.PlaneGeometry(14,1.0),surf(TEX.runner,14,1,1.4)); run.rotation.x=-Math.PI/2; run.position.set(ox+8.6,.02,1.1); scene.add(run); }
  wall("x",ox,ox+18,0,3,0,TEX.concrete,.7,.16);
  wall("x",ox,ox+18,2.2,3,0,TEX.concrete,.7,.16,[[ox+14.9,ox+16.1]]); // stair-landing gap
  wall("z",0,2.2,ox,3,0,TEX.concrete,.7,.16); wall("z",0,2.2,ox+18,3,0,TEX.concrete,.7,.16);
  // doors 2102-2106 (fake) on south wall
  const nums=[2102,2103,2104,2105,2106];
  nums.forEach((n,i)=>{ const d=mkDoor(plateTex(""+n)); d.position.set(ox+3+i*2.6,0,.08); scene.add(d);
    doorTrim(ox+3.45+i*2.6,0,.1);
    if(i===1||i===3){ const dm=new THREE.Mesh(new THREE.PlaneGeometry(.75,.42),new THREE.MeshLambertMaterial({color:i===1?0x2a2620:0x30281e}));
      dm.rotation.x=-Math.PI/2; dm.position.set(ox+3.45+i*2.6,.012,.55); scene.add(dm); }
    if(i===2){ for(let b2=0;b2<2;b2++){ const mb2=new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,.2,8),
      new THREE.MeshLambertMaterial({color:0xc8c4b8})); mb2.position.set(ox+3.75+i*2.6+b2*.12,.1,.42); scene.add(mb2); } }
    addCollider(ox+3.45+i*2.6,.12,1.0,.3);
    interact(d,"Door "+n,()=>{ AU.rattle();
      const l=["Behind it: a television arguing with itself.","Behind it: two voices, taking turns being the loud one.","Behind it: a baby, refusing the whole idea of night.","Locked. A chain slides on the other side.","Locked. Someone turns their TV up."];
      say(null,l[i]); }); });
  // elevator west
  const ev=mkElevator(); at(ev,ox+.1,0,1.1,Math.PI/2); addCollider(ox+.2,1.1,.3,1.8);
  interact(ev,"Elevator",()=>openElev("floor21"));
  // fluorescents
  for(const x of[ox+4,ox+9,ox+14]){ const f=mkFluorescent(); f.position.set(x,2.94,1.1); scene.add(f); if(x===ox+14)flickers.push(f); }
  /* stair landing (NE room): a REAL half-flight up to a raised landing with the terrace door */
  floorPlane(ox+16,4.1,4,3.8,TEX.concrete,1.1);
  ceilPlane(ox+16,4.1,4,3.8,3.0);
  wall("z",2.2,6,ox+14,3,0,TEX.concrete,.7,.16); wall("z",2.2,6,ox+18,3,0,TEX.concrete,.7,.16);
  wall("x",ox+14,ox+18,6,3,0,TEX.concrete,.7,.16,[[ox+15.4,ox+16.6]]); // terrace door gap
  { const conc=new THREE.MeshLambertMaterial({map:TEX.concrete});
    // landing slab (top y=.6) carrying the door
    const land=box(3.6,.6,1.5,conc); land.position.set(ox+16,.3,5.25); scene.add(land);
    // four full-width steps rising to it
    for(let i=0;i<4;i++){ const top=.15*(i+1);
      const st=box(3.6,top,.32,conc); st.position.set(ox+16,top/2,3.56+i*.3); scene.add(st); }
    // painted step nosings so each tread reads in the dark
    for(let i=0;i<4;i++){ const nose=box(3.6,.015,.05,new THREE.MeshLambertMaterial({color:0x8a8f7a}));
      nose.position.set(ox+16,.15*(i+1)+.01,3.42+i*.3); scene.add(nose); }
    // handrails on both side walls, sloped with the flight
    for(const rx of[ox+14.12,ox+17.88]){ const hr=box(.05,.05,1.6,M.metalDark);
      hr.position.set(rx,1.25,4.1); hr.rotation.x=-.42; scene.add(hr);
      for(const hz of[3.5,4.7]){ const br=box(.04,.12,.04,M.metalDark); br.position.set(rx,1.05+(hz-3.5)*.42,hz); scene.add(br); } }
    // caged bulb over the landing so the flight and door read
    const bfix=box(.16,.12,.16,M.metalDark); bfix.position.set(ox+16,2.6,5.3); scene.add(bfix);
    const bl=new THREE.PointLight(0xc89050,1.15,7.5,1.5); bl.position.set(ox+16,2.4,4.9); scene.add(bl); }
  // Movement uses the same four discrete levels as the visible treads.
  ZONES.floor21.ground=(x,z)=>{ if(x<ox+14.2||x>ox+17.8||z<2.3)return 0;
    if(z>=4.5)return .6; if(z>=4.2)return .45; if(z>=3.9)return .3; if(z>=3.6)return .15; return 0; };
  // terrace door + the photograph — seated ON the landing
  const td=mkDoor(plateTex("ROOF")); td.position.set(ox+15.55,.6,5.9); scene.add(td);
  { const conc2=new THREE.MeshLambertMaterial({map:TEX.concrete});
    const j1=box(.16,2.4,.22,conc2); j1.position.set(ox+15.48,1.8,5.95); scene.add(j1);
    const j2=box(.16,2.4,.22,conc2); j2.position.set(ox+16.52,1.8,5.95); scene.add(j2);
    const hdr=box(1.2,.36,.22,conc2); hdr.position.set(ox+16,2.83,5.95); scene.add(hdr); }
  const tdCol=addCollider(ox+16,5.9,1.4,.4,"terrDoor");
  terrPhotoMesh=mkFrame(TEX.photo,.3,.38); terrPhotoMesh.position.set(ox+16,2.0,5.83); terrPhotoMesh.rotation.y=Math.PI; terrPhotoMesh.rotation.z=-.05; scene.add(terrPhotoMesh);
  const photo=terrPhotoMesh;
  const ixPhoto=interact(photo,"A photograph, fixed to the door",()=>{
    if(GS.photoTaken){ photo.visible=false; ixPhoto.enabled=false; return; }
    GS.photoTaken=true; photo.visible=false; ixPhoto.enabled=false; AU.paper();
    give("photo","🖼","THE PHOTO");
    say(null,"The two of them, on this roof. Her face exact. His face — a smear of light, as if the camera had already started forgetting him.",6200);
  });
  interact(td,"The terrace door",()=>{
    if(!GS.photoTaken){ say("THOMAS","There's something on the door. Take it first. It's them."); return; }
    if(GS.terraceUnlocked||inv.has("key_terrace")){
      if(!GS.terraceUnlocked){ GS.terraceUnlocked=true; AU.key(); }
      travel("terrace",701.6,7,-Math.PI/2,()=>{ AU.tenantsStop(); AU.windStart();
        if(inv.has("piece3")&&!GS.ledgeOn){ afterPiece3(); return; }
        say(null,"The roof. Rain in his collar within three steps. The city below is a rumor of light through cloud.",5400);
        setObjective("The <b>music box</b>, in the middle of the roof. Start there."); });
    } else { AU.rattle(); say(null,"Locked. TERRACE — the key from the boxes."); }
  });
});
/* ════════ ZONE: TERRACE (beats 16–17) ════════ */
let nodes=[], tankWater=null, valves=[], ledgeSpot=null, piece3Mesh=null, note3Mesh=null, musicBox=null;
inZone("terrace",()=>{
  const ox=700;
  floorPlane(ox+10,7,20,14,TEX.concrete,1.3,0x6a6a70);
  const parMat=(len)=>{ const t2=TEX.brickExt.clone(); t2.needsUpdate=true; t2.wrapS=t2.wrapT=THREE.RepeatWrapping;
    t2.repeat.set(len*.55,.75); return new THREE.MeshLambertMaterial({map:t2}); };
  const par=(x1,x2,z)=>{ const p=box(x2-x1,1.1,.3,parMat(x2-x1)); p.position.set((x1+x2)/2,.55,z); scene.add(p); };
  const parz=(z1,z2,x)=>{ const p=box(.3,1.1,z2-z1,parMat(z2-z1)); p.position.set(x,.55,(z1+z2)/2); scene.add(p); };
  par(ox,ox+20,.15); par(ox,ox+20,13.85); parz(0,14,ox+.15); parz(0,14,ox+19.85);
  addCollider(ox+10,.15,20,.4); addCollider(ox+10,13.85,20,.4); addCollider(ox+.15,7,.4,14); addCollider(ox+19.85,7,.4,14);
  // ══ THE CITY — real 3D skyline past the parapet (window textures ignore fog so the city reads through the rain) ══
  { // three facade textures: dark buildings, ~15% windows lit amber/cool
    const facade=(seed)=>{ const t2=tex((g,s)=>{ g.fillStyle="#07080c"; g.fillRect(0,0,s,s);
        let rnd=seed; const R=()=>{ rnd=(rnd*16807)%2147483647; return rnd/2147483647; };
        for(let r2=0;r2<10;r2++)for(let c2=0;c2<8;c2++){ const v=R();
          if(v<.11){ g.fillStyle=v<.03?"#98a4b4":"#c8a25a"; g.globalAlpha=.55+R()*.45; }
          else { g.fillStyle="#101318"; g.globalAlpha=1; }
          g.fillRect(6+c2*15,6+r2*12,9,7); }
        g.globalAlpha=1; },128);
      t2.wrapS=t2.wrapT=THREE.RepeatWrapping; return t2; };
    const fTex=[facade(12345),facade(67890),facade(24680)];
    const darkTop=new THREE.MeshBasicMaterial({color:0x05060a,fog:false});
    let rnd=13579; const R=()=>{ rnd=(rnd*16807)%2147483647; return rnd/2147483647; };
    const cx=ox+10, cz2=7;
    const rings=[[14,20,.5,3.5,9],[23,33,2,7.5,10],[38,58,5,12,9]];
    rings.forEach(([r1,r2,hMin,hMax,count],ring)=>{
      for(let i2=0;i2<count;i2++){ const a=(i2/count)*Math.PI*2 + R()*.5 + ring*.35;
        const rad=r1+R()*(r2-r1);
        const bw=3.5+R()*5.5, bd=3.5+R()*4.5, top=hMin+R()*(hMax-hMin), bh=top+26;
        const t3=fTex[(R()*3)|0].clone(); t3.needsUpdate=true; t3.repeat.set(Math.max(1,bw/3),Math.max(1,bh/4.5));
        const fm=new THREE.MeshBasicMaterial({map:t3,fog:false});
        const bld=new THREE.Mesh(new THREE.BoxGeometry(bw,bh,bd),[fm,fm,darkTop,darkTop,fm,fm]);
        bld.position.set(cx+Math.cos(a)*rad, top-bh/2, cz2+Math.sin(a)*rad);
        bld.rotation.y=R()*.4-.2; scene.add(bld); } });
    // one landmark tower with a blinking red aviation beacon
    { const t3=fTex[0].clone(); t3.needsUpdate=true; t3.repeat.set(2,8);
      const fm=new THREE.MeshBasicMaterial({map:t3,fog:false});
      const tower=new THREE.Mesh(new THREE.BoxGeometry(6,44,6),[fm,fm,darkTop,darkTop,fm,fm]);
      tower.position.set(cx+34,14-22,cz2-30); scene.add(tower);
      const bcn=new THREE.Mesh(new THREE.SphereGeometry(.5,8,8),new THREE.MeshBasicMaterial({color:0xd83030,fog:false}));
      bcn.position.set(cx+34,14.6,cz2-30); fxBeacons.push(bcn); scene.add(bcn); }
    // horizon: the city's glow, an even amber-grey band all around (fog-immune, behind the buildings)
    { const glowTex=tex((g,s)=>{ const grd=g.createLinearGradient(0,s,0,0);
        grd.addColorStop(0,"rgba(56,38,24,.9)"); grd.addColorStop(.45,"rgba(30,24,22,.45)"); grd.addColorStop(1,"rgba(0,0,0,0)");
        g.fillStyle=grd; g.fillRect(0,0,s,s); },128);
      const glow=new THREE.Mesh(new THREE.CylinderGeometry(78,78,16,24,1,true),
        new THREE.MeshBasicMaterial({map:glowTex,transparent:true,side:THREE.BackSide,fog:false,depthWrite:false}));
      glow.position.set(cx,3,cz2); scene.add(glow); } }
  const td=mkDoor(plateTex("ROOF")); td.position.set(ox+.2,0,7.55); td.rotation.y=Math.PI/2; scene.add(td);
  doorTrim(ox+.2,0,7.55,Math.PI/2,new THREE.MeshLambertMaterial({map:TEX.concrete}));
  addCollider(ox+.3,7,.4,1.4);
  interact(td,"Back inside",()=>{
    // Ending B: he has decided. Skip the corridor and the lift he has already walked.
    if(GS.ending==="B"&&!GS.piece4){ travel("floor8",1.4,1.1,-Math.PI/2,()=>{ AU.windStop();
      say(null,"He does not remember the stairs, or the lift. Only the eighth floor arriving, and his own door at the end of it.",5600); }); return; }
    travel("floor21",616,4.6,Math.PI,()=>{ AU.windStop(); AU.tenantsStart(); }); });
  const no2=new THREE.Mesh(new THREE.PlaneGeometry(.2,.26),new THREE.MeshLambertMaterial({map:TEX.noteSmall}));
  no2.position.set(ox+.46,1.4,8.62); no2.rotation.y=Math.PI/2; scene.add(no2);
  interact(no2,"A note, taped inside the door",()=>{ AU.paper(); collectNote("n_order2"); openNote("n_order2"); });
  wall("z",6,8.2,ox+1.1,2.4,0,TEX.brickExt,.6,.14); wall("x",ox+.15,ox+1.1,6,2.4,0,TEX.brickExt,.6,.14); wall("x",ox+.15,ox+1.1,8.2,2.4,0,TEX.brickExt,.6,.14);
  { const roof=box(1.2,.12,2.4,M.metalDark); roof.position.set(ox+.6,2.42,7.1); scene.add(roof); }
  const meter=group(); { const b=box(.4,.5,.16,M.metalDark); b.position.y=1.4; meter.add(b);
    const glass=new THREE.Mesh(new THREE.PlaneGeometry(.2,.2),new THREE.MeshBasicMaterial({color:0x1a2a1a})); glass.position.set(0,1.45,.09); meter.add(glass); }
  at(meter,ox+.7,0,5.6,0); addCollider(ox+.7,5.6,.5,.3);
  { const conduit=box(.06,1.15,.06,M.metalDark); conduit.position.set(ox+.7,.575,5.7); scene.add(conduit);
    const jb=box(.14,.12,.08,M.metalDark); jb.position.set(ox+.7,.35,5.72); scene.add(jb); }
  interact(meter,"The electric meter",()=>say(null,"The dial creeps. Something in this building is still hungry. Below the meter — a glint."));
  const tank=group(); { const body=new THREE.Mesh(new THREE.CylinderGeometry(1.1,1.1,1.8,12,1,true),new THREE.MeshLambertMaterial({map:TEX.metal,side:THREE.DoubleSide})); body.position.y=2.1; tank.add(body);
    for(const [lx,lz] of[[-.8,-.8],[.8,-.8],[-.8,.8],[.8,.8]]){ const leg=box(.1,1.2,.1,M.metalDark); leg.position.set(lx,.6,lz); tank.add(leg);} }
  at(tank,ox+16.5,0,2.5,0); addCollider(ox+16.5,2.5,2.4,2.4);
  { // Tank access: three full-width treads and one low service deck.
    const galv=new THREE.MeshLambertMaterial({map:TEX.metal});
    for(const [sx,top] of[[ox+13.35,.22],[ox+13.78,.44],[ox+14.21,.66]]){
      const tread=box(.44,top,1.2,galv); tread.position.set(sx,top/2,2.5); scene.add(tread); }
    const plat=box(1.0,.8,1.25,galv); plat.position.set(ox+14.94,.4,2.5); scene.add(plat);
    for(const rz of[1.88,3.12]){ const rail=box(1.08,.05,.05,M.metalDark); rail.position.set(ox+14.94,1.28,rz); scene.add(rail);
      for(const px2 of[ox+14.5,ox+15.38]){ const post=box(.05,.68,.05,M.metalDark); post.position.set(px2,.96,rz); scene.add(post); } }
    addCollider(ox+14.94,1.82,1.15,.16); addCollider(ox+14.94,3.18,1.15,.16);
    ZONES.terrace.ground=(x,z)=>{ if(z<1.88||z>3.12||x<ox+13.12||x>ox+15.44)return 0;
      if(x>=ox+14.5)return .8; if(x>=ox+14.0)return .66; if(x>=ox+13.57)return .44; return .22; }; }
  tankWater=new THREE.Mesh(new THREE.CylinderGeometry(1.02,1.02,.06,12),new THREE.MeshLambertMaterial({color:0x1a2c34}));
  tankWater.position.set(ox+16.5,1.35,2.5); scene.add(tankWater);
  const dotTex=n=>tex((g,s)=>{ g.clearRect(0,0,s,s); g.fillStyle="#d8c890"; for(let i=0;i<n;i++){ g.beginPath(); g.arc(s/2+(i-(n-1)/2)*34,s/2,13,0,7); g.fill(); } },128);
  [[ox+8,1],[ox+10.5,2],[ox+13,3]].forEach(([x,n])=>{
    const v=mkValve(); at(v,x,0,1.0,0); addCollider(x,1.0,.4,.4);
    const d=decal(dotTex(n),.3,.3); d.position.set(x,1.15,1.15); scene.add(d); // dots face the roof, where the player stands
    v.userData.idx=n; valves.push(v);
    interact(v,`Valve — ${"•".repeat(n)}`,()=>turnValve(v));
    const pipe=box(2.5,.06,.06,M.metal); pipe.position.set(x+1.25,.72,.9); scene.add(pipe);
  });
  /* ── roof plant: the working clutter of a real flat roof ── */
  { const galv2=new THREE.MeshLambertMaterial({map:TEX.metal,color:0x9aa0a4});
    // pipe-run supports so the valve manifold line doesn't hover
    for(const px2 of[ox+9,ox+11,ox+13,ox+14.9]){ const sup=box(.08,.7,.08,M.metalDark); sup.position.set(px2,.35,.9); scene.add(sup); }
    // two AC condensers on a steel frame, SE quarter
    const acFrame=box(2.3,.22,.9,M.metalDark); acFrame.position.set(ox+15.9,.2,10.5); scene.add(acFrame);
    for(const [ax,ph] of[[ox+15.3,0],[ox+16.5,.4]]){
      const unit=box(.95,.72,.72,galv2); unit.position.set(ax,.68,10.5); scene.add(unit);
      const fins=decal(tex((g,s)=>{ g.fillStyle="#3a4044"; g.fillRect(0,0,s,s);
        g.fillStyle="#262c30"; for(let i=0;i<12;i++)g.fillRect(8,8+i*20,s-16,8);
        g.beginPath(); g.arc(s/2,s/2,s*.3,0,7); g.strokeStyle="#565e64"; g.lineWidth=5; g.stroke(); },128),.8,.6);
      fins.position.set(ax,.7,10.13+ph*0); fins.rotation.y=Math.PI; scene.add(fins); }
    addCollider(ox+15.9,10.5,2.5,1.1);
    interact(acFrame,"The condenser units",()=>say(null,"One fan turns, slow as a second hand. Twenty-one floors of other people's warm rooms, exhaled here."));
    // refrigeration line from condensers dropping over the parapet edge, per the drawings
    const rl=box(.05,.05,3.1,M.metalDark); rl.position.set(ox+16.9,.42,12.1); scene.add(rl);
    for(const sz3 of[11.1,12.9]){ const sup2=box(.07,.42,.07,M.metalDark); sup2.position.set(ox+16.9,.21,sz3); scene.add(sup2); }
    const rld=box(.05,1.0,.05,M.metalDark); rld.position.set(ox+16.9,.9,13.62); scene.add(rld);
    // mushroom vents
    for(const [vx,vz] of[[ox+4.5,9.5],[ox+12,11.5],[ox+7,3.8]]){
      const stem=new THREE.Mesh(new THREE.CylinderGeometry(.12,.12,.5,8),galv2); stem.position.set(vx,.25,vz); scene.add(stem);
      const cap=new THREE.Mesh(new THREE.ConeGeometry(.26,.18,8),M.metalDark); cap.position.set(vx,.56,vz); scene.add(cap);
      addCollider(vx,vz,.35,.35); }
    // bent TV aerial on the stair-shed roof
    { const mast=box(.04,1.6,.04,M.metalDark); mast.position.set(ox+.6,3.1,7.1); mast.rotation.z=.06; scene.add(mast);
      interact(mast,"A bent television aerial",()=>say(null,"Every aerial on this roof leans toward a broadcast that ended years ago. Nobody has climbed up to correct them."),{range:4.5});
      for(let i=0;i<3;i++){ const bar=box(.7-i*.18,.03,.03,M.metalDark); bar.position.set(ox+.6+.05*i,3.5+i*.22,7.1); bar.rotation.y=.3; bar.rotation.z=.05*i; scene.add(bar); } }
    // felt seams + standing water + a gravel patch
    for(const sx2 of[ox+3,ox+6,ox+9,ox+12,ox+15]){ const seam=new THREE.Mesh(new THREE.PlaneGeometry(.09,13.4),
      new THREE.MeshLambertMaterial({color:0x191b1d})); seam.rotation.x=-Math.PI/2; seam.position.set(sx2,.012,7); scene.add(seam); }
    for(const [px3,pz3,pr] of[[ox+5,10.8,.8],[ox+13.5,6.2,.55]]){
      const pd=new THREE.Mesh(new THREE.CircleGeometry(pr,12),new THREE.MeshBasicMaterial({color:0x121a20}));
      pd.rotation.x=-Math.PI/2; pd.position.set(px3,.015,pz3); scene.add(pd); }
    { const gravel=new THREE.Mesh(new THREE.PlaneGeometry(2.6,2.0),new THREE.MeshLambertMaterial({map:tex((g,s)=>{
        g.fillStyle="#2e2c28"; g.fillRect(0,0,s,s);
        for(let i=0;i<500;i++){ g.fillStyle=["#3a3832","#26241f","#44423a"][i%3]; g.fillRect(Math.random()*s,Math.random()*s,3,2); } },128)}));
      gravel.rotation.x=-Math.PI/2; gravel.position.set(ox+3.2,.014,11.9); scene.add(gravel); } }
  const crate=mkCrate24(); crate.position.set(ox+10,0,7); crate.userData.lid.visible=false;
  crate.traverse(o=>{ if(o.isMesh)o.material=new THREE.MeshLambertMaterial({map:o.material.map,color:0x9a8d7a}); });
  scene.add(crate); addCollider(ox+10,7,.7,.7);
  musicBox=mkMusicBox(); musicBox.position.set(ox+10,.6,7); scene.add(musicBox);
  interact(musicBox,"The music box",()=>{
    if(GS.piece3){ say(null,"It has played what it kept. The cylinder rests."); return; }
    say(null,"Four brass chimes, scattered over the roof, each wired back to this box. Follow the cables. It wants them struck in her order — and one of them is under water that is not there yet.",6400);
    if(!GS.tankFilled)setObjective("Follow the <b>cables</b> from the music box to four chimes. One is in the <b>dry tank</b>: the three <b>valves</b> fill it.");
  });
  piece3Mesh=mkPiece(); piece3Mesh.position.set(ox+10.35,.66,7); piece3Mesh.visible=false; scene.add(piece3Mesh);
  const ix3=interact(piece3Mesh,"Take Puzzle Piece #3",()=>{ piece3Mesh.visible=false; ix3.enabled=false; GS.piece3=true; give("piece3","🧩","PIECE #3"); afterPiece3(); }); ix3.enabled=false; piece3Mesh.userData.ix3=ix3;
  note3Mesh=new THREE.Mesh(new THREE.PlaneGeometry(.2,.26),new THREE.MeshLambertMaterial({map:TEX.noteSmall}));
  note3Mesh.rotation.x=-Math.PI/2; note3Mesh.rotation.z=.5; note3Mesh.position.set(ox+9.5,.02,7.55); note3Mesh.visible=false; scene.add(note3Mesh);
  const ixn3=interact(note3Mesh,"A note, hidden under the box",()=>{ AU.paper(); collectNote("n_terrace"); openNote("n_terrace"); }); ixn3.enabled=false; note3Mesh.userData.ixn3=ixn3;
  /* four chimes — order: meter(2) → wall(1) → tank(3) → parapet(4) */
  const mkN=(x,y,z,ry,idx,label)=>{ const n=mkNode(); n.position.set(x,y,z); n.rotation.y=ry; scene.add(n);
    n.userData.idx=idx; nodes.push(n); interact(n,label,()=>strikeNode(n)); return n; };
  mkN(ox+6,1.05,.32,0,1,"A brass chime, set into the wall");
  mkN(ox+.7,.35,5.78,0,2,"A brass chime, under the meter");
  const n3=mkN(ox+16.5,1.42,2.5,0,3,"A chime, deep in the tank"); n3.userData.float=true;
  mkN(ox+17.5,1.02,13.62,Math.PI,4,"A chime, where the parapet turns");
  ledgeSpot=group();
  { const cush=box(1.3,.14,.5,new THREE.MeshLambertMaterial({color:0x4a3a30})); cush.position.y=1.27; ledgeSpot.add(cush);
    const glow=new THREE.PointLight(0xc8a070,.6,3,1.8); glow.position.set(0,1.5,0); ledgeSpot.add(glow); }
  ledgeSpot.position.set(ox+16,0,13.7); ledgeSpot.visible=false; scene.add(ledgeSpot);
  const ixL=interact(ledgeSpot,"The ledge — their spot",()=>ledgeChoice()); ixL.enabled=false; ledgeSpot.userData.ix=ixL;
  // ══ roof furniture — a working roof, and their corner of it ══
  // parapet coping stones
  { const copM=new THREE.MeshLambertMaterial({map:TEX.concrete});
    const c1=box(20.1,.09,.4,copM); c1.position.set(ox+10,1.14,.15); scene.add(c1);
    const c2=box(20.1,.09,.4,copM); c2.position.set(ox+10,1.14,13.85); scene.add(c2);
    const c3=box(.4,.09,14.1,copM); c3.position.set(ox+.15,1.14,7); scene.add(c3);
    const c4=box(.4,.09,14.1,copM); c4.position.set(ox+19.85,1.14,7); scene.add(c4); }
  // tar seams across the roof membrane
  for(const [sx2,sz2,sw2,sr2] of[[ox+6,7,13.6,Math.PI/2],[ox+14,7,13.6,Math.PI/2],[ox+10,4.5,19.4,0],[ox+10,10,19.4,0]]){
    const seam=new THREE.Mesh(new THREE.PlaneGeometry(sw2,.16),new THREE.MeshBasicMaterial({color:0x0a0b0d,transparent:true,opacity:.55,depthWrite:false}));
    seam.rotation.x=-Math.PI/2; seam.rotation.z=sr2; seam.position.set(sx2,.018,sz2); scene.add(seam); }
  // rain puddles
  { const pt2=tex((g,s)=>{ g.clearRect(0,0,s,s); const r=g.createRadialGradient(s/2,s/2,4,s/2,s/2,s/2);
      r.addColorStop(0,"rgba(40,50,68,.8)"); r.addColorStop(.7,"rgba(22,28,40,.45)"); r.addColorStop(1,"rgba(0,0,0,0)");
      g.fillStyle=r; g.beginPath(); g.ellipse(s/2,s/2,s*.48,s*.32,0,0,7); g.fill(); },128);
    for(const [px2,pz2,pw2,pr2] of[[ox+7.5,3.5,2.6,.4],[ox+13,9.5,2.0,1.7],[ox+4,8.8,1.7,2.6]]){
      const pd=new THREE.Mesh(new THREE.PlaneGeometry(pw2,pw2*.55),new THREE.MeshBasicMaterial({map:pt2,transparent:true,depthWrite:false}));
      pd.rotation.x=-Math.PI/2; pd.rotation.z=pr2; pd.position.set(px2,.015,pz2); scene.add(pd); } }
  // HVAC unit + ducting toward the bulkhead
  { const hv=box(2.2,1.25,1.5,M.metal); hv.position.set(ox+5,.62,11.2); scene.add(hv); addCollider(ox+5,11.2,2.3,1.6);
    const fanT=tex((g,s)=>{ g.fillStyle="#14161a"; g.fillRect(0,0,s,s); g.strokeStyle="#3a4048"; g.lineWidth=4;
      g.beginPath(); g.arc(s/2,s/2,44,0,7); g.stroke(); for(let i2=0;i2<5;i2++){ g.save(); g.translate(s/2,s/2); g.rotate(i2*1.256);
        g.fillStyle="#22262c"; g.fillRect(-5,-40,10,34); g.restore(); } },128);
    for(const fx2 of[-.55,.55]){ const fan=new THREE.Mesh(new THREE.PlaneGeometry(.85,.85),new THREE.MeshBasicMaterial({map:fanT}));
      fan.rotation.x=-Math.PI/2; fan.position.set(ox+5+fx2,1.26,11.2); scene.add(fan); }
    const duct=box(2.6,.4,.4,M.metalDark); duct.position.set(ox+3.2,1.0,9.8); duct.rotation.y=.7; scene.add(duct); }
  // capped vent pipes
  for(const [vx2,vz2,vh2] of[[ox+8.5,9.8,.9],[ox+13,4.5,.6],[ox+3,3.5,1.2]]){
    const vp=new THREE.Mesh(new THREE.CylinderGeometry(.12,.12,vh2,8),M.metalDark); vp.position.set(vx2,vh2/2,vz2); scene.add(vp);
    const cap=new THREE.Mesh(new THREE.CylinderGeometry(.2,.2,.08,8),M.metal); cap.position.set(vx2,vh2+.05,vz2); scene.add(cap);
    addCollider(vx2,vz2,.35,.35); }
  // antenna mast, guy wires, our own small red bulb
  { const mast=new THREE.Mesh(new THREE.CylinderGeometry(.05,.07,4.2,7),M.metalDark); mast.position.set(ox+2.2,2.1,12.3); scene.add(mast);
    addCollider(ox+2.2,12.3,.3,.3);
    for(const [gx2,gz2] of[[1.2,.7],[-1.0,.9],[.2,-1.3]]){ const wire=box(.015,.015,4.4,new THREE.MeshLambertMaterial({color:0x111114}));
      wire.position.set(ox+2.2+gx2/2,2.0,12.3+gz2/2); wire.lookAt(ox+2.2+gx2,0,12.3+gz2); wire.rotateX(Math.PI/2); scene.add(wire); }
    const cross=box(.7,.03,.03,M.metal); cross.position.set(ox+2.2,3.9,12.3); scene.add(cross);
    const bulb=new THREE.Mesh(new THREE.SphereGeometry(.05,7,7),new THREE.MeshBasicMaterial({color:0xd83030}));
    bulb.position.set(ox+2.2,4.25,12.3); fxBeacons.push(bulb); scene.add(bulb); }
  // clothesline — hers, never taken in
  { for(const px2 of[ox+11.4,ox+14.6]){ const pole=new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,1.9,7),M.metalDark);
      pole.position.set(px2,.95,11.4); scene.add(pole); addCollider(px2,11.4,.25,.25);
      const tbar=box(.7,.04,.04,M.metalDark); tbar.position.set(px2,1.85,11.4); scene.add(tbar); }
    const line=box(3.2,.015,.015,new THREE.MeshLambertMaterial({color:0x2a2a2c})); line.position.set(ox+13,1.83,11.4); scene.add(line);
    const clothM=[0x39404a,0x4a4038,0x333a36];
    [[ox+12.1,.5,.62],[ox+13.2,.42,.5],[ox+14.1,.55,.7]].forEach(([cx2,cw2,ch2],i2)=>{
      const cl2=new THREE.Mesh(new THREE.PlaneGeometry(cw2,ch2),new THREE.MeshLambertMaterial({color:clothM[i2],side:THREE.DoubleSide}));
      cl2.position.set(cx2,1.82-ch2/2,11.4); cl2.rotation.y=.06*(i2-1); scene.add(cl2); }); }
  // a dead string of fairy lights along the south parapet by their spot — one bulb still tries
  { const cord=box(2.4,.02,.02,new THREE.MeshLambertMaterial({color:0x16130f})); cord.position.set(ox+13.9,1.19,13.6); scene.add(cord);
    for(let i2=0;i2<6;i2++){ const dead=new THREE.Mesh(new THREE.SphereGeometry(.035,6,6),
        new THREE.MeshBasicMaterial({color:0x241c14})); dead.position.set(ox+12.9+i2*.44,1.13,13.6); scene.add(dead);
      if(i2===4)fxFairyBulb=dead; } }
  // warm caged bulb over the roof door bulkhead
  { const fix2=box(.16,.12,.16,M.metalDark); fix2.position.set(ox+1.2,2.3,7.1); scene.add(fix2);
    const bl2=new THREE.PointLight(0xc89050,.55,4.5,1.8); bl2.position.set(ox+1.25,2.1,7.1); scene.add(bl2); }
  const wl=new THREE.PointLight(0x6a7488,.45,22,1.2); wl.position.set(ox+10,4,7); scene.add(wl);
});
/* ambient FX ticker: steam drift · neon buzz · beacon blink · fairy flicker (cheap, 9 fps) */
setInterval(()=>{ try{
  const t2=performance.now()/1000;
  if(curZone==="alley"){
    fxSteams.forEach((s,i)=>{ s.material.opacity=.14+.15*Math.abs(Math.sin(t2*.8+i*2.1));
      s.rotation.y+=.012; s.position.y+=.006; if(s.position.y>2.7)s.position.y=.8; });
    if(neonLight){ const on=Math.random()>.13;
      neonLight.intensity=on?.42+Math.random()*.16:.07;
      neonSignMesh.material.opacity=on?1:.4; } }
  else if(curZone==="terrace"){
    const blink=Math.floor(t2/1.1)%2===0;
    fxBeacons.forEach(b=>{ b.visible=blink; });
    if(fxFairyBulb)fxFairyBulb.material.color.setHex(Math.random()>.25?0xd8a05a:0x241c14); }
}catch(e){} },110);

/* ── per-zone ambient scheduler: rare diegetic one-shots so the world keeps breathing ── */
const AMBIENT={
  street:[[()=>AU.thunder(),.045],[()=>AU.clank(),.03],[()=>AU.citySiren(),.012]],
  alley:[[()=>AU.thunder(),.04],[()=>AU.drip(),.16],[()=>AU.clank(),.05],[()=>AU.flies(),.06]],
  terrace:[[()=>AU.thunder(),.05],[()=>AU.gust(),.09],[()=>AU.citySiren(),.014],[()=>AU.clank(),.03]],
  arrival:[[()=>AU.drip(),.10],[()=>AU.clank(),.04],[()=>AU.paGarble(),.02]],
  metro:[[()=>AU.drip(),.12],[()=>AU.clank(),.035],[()=>AU.paGarble(),.025]],
  restock:[[()=>AU.drip(),.14],[()=>AU.pipeKnock(),.05],[()=>AU.flies(),.04]],
  floor8:[[()=>AU.pipeKnock(),.045],[()=>AU.drip(),.05],[()=>AU.tvMurmur(),.05]],
  floor21:[[()=>AU.pipeKnock(),.05],[()=>AU.pianoFar(),.035]],
  lobbyG:[[()=>AU.tick(),.9],[()=>AU.pipeKnock(),.03]],
  dream1:[[()=>AU.heartbeat(),.28],[()=>AU.gust(),.05]],
  dream2:[[()=>AU.heartbeat(),.34],[()=>AU.clank(),.03]],
};
setInterval(()=>{ try{ if(!running||!AU.ctx||uiOpen)return;
  const L=AMBIENT[curZone]; if(!L)return;
  for(const [fn,p] of L)if(Math.random()<p)fn(); }catch(e){} },1400);

function turnValve(v){
  if(GS.tankFilled){ say(null,"The tank is full. The pipes have said their piece."); return; }
  AU.valve(); v.userData.wheel.rotation.z+=1.3;
  const want=PIPE_ORDER[GS.pipeStep];
  if(v.userData.idx===want){ GS.pipeStep++;
    if(GS.pipeStep>=3){ GS.tankFilled=true; AU.splash();
      say(null,"Somewhere under the roof, water changes its mind. The tank drinks. Something small knocks against the inside as it rises.",5600);
      setObjective("The chime is afloat. Now the song — <b>four chimes, in her order.</b> Her two pages have it between them."); }
    else say(null,GS.pipeStep===1?"A shudder in the pipe. It holds.":"Water moves, somewhere below. One pipe left.");
  } else { GS.pipeStep=0; AU.burst(.3,220,.2,1);
    // the note taped inside the terrace door carries the order; only spell it out after repeated failures
    const f=GS.pipeFails=(GS.pipeFails||0)+1;
    if(f>=4)say(null,"It drains back. He says it aloud, the way she wrote it: <em>two drops, then one, then three.</em>",5600);
    else if(f>=2)say(null,collected.has("n_order2")
      ?"It drains back again. She wrote the order down — <em>the way the rain would.</em> Her note. <b>TAB.</b>"
      :"It drains back again. Someone who loved this roof would have written the order down. <em>The inside of the door he came through.</em>",5600);
    else say(null,"A gurgle, then nothing — it drains back. Wrong order. The dots on the wall are counting something."); }
}
function strikeNode(n){
  if(GS.piece3)return;
  if(n.userData.float&&!GS.tankFilled){ say(null,"It lies at the bottom of the dry tank, out of reach. The pipes. Fill it."); return; }
  const want=NODE_ORDER[GS.nodeStep];
  AU.mnote([523,392,659,784][n.userData.idx-1]);
  if(n.userData.idx===want){ GS.nodeStep++; n.children[0].material.emissive.setHex(0xd8a838); n.userData.light.intensity=2.2; n.userData.light.color.setHex(0xffd070);
    if(GS.nodeStep<4)setObjective(`Her song: <b>${"●".repeat(GS.nodeStep)}${"○".repeat(4-GS.nodeStep)}</b> &nbsp;Four chimes, in her order.`);
    if(GS.nodeStep>=4)solveMusicBox();
    else say(null,["","The chime hangs in the rain. The box's cylinder turns a notch.","Two. The song is finding its feet.","Three. One left — <em>where the song always ended.</em>"][GS.nodeStep]);
  } else { GS.nodeStep=0; AU.discord(); dread=Math.min(1,dread+.15);
    nodes.forEach(m=>{ m.children[0].material.emissive.setHex(0x2a2210); m.userData.light.intensity=.9; m.userData.light.color.setHex(0xd8b060); });
    setObjective(`Her song: <b>○○○○</b> &nbsp;Four chimes, in her order. <em>(Her two pages have it.)</em>`);
    const f=GS.nodeFails=(GS.nodeFails||0)+1, h1=collected.has("n_order1"), h2=collected.has("n_order2");
    if(f>=4)say(null,"A sour note. He stops, and recites it like a prayer: <em>the meter first, then the wall. Then the water. Then where they sat.</em>",6200);
    else if(f>=2)say(null,h1&&h2?"A sour note. The order is in her hand, split across two pages. <b>TAB</b> — read them together."
      :h2?"A sour note. Her page on the door only has the end of the song. The beginning is on a page he never read — <em>downstairs, by the generator.</em>"
      :h1?"A sour note. Her page from the generator only has the beginning. The rest is up here — <em>the inside of the terrace door.</em>"
      :"A sour note. She left the order written down, in two places. He has read neither.",6200);
    else say(null,"A sour note. The cylinder resets, patient as she was."); }
}
function solveMusicBox(){
  AU.melody(); dread=0;
  say(null,"The box plays. Eight notes, thin and bright, a lullaby pushing back the rain — the song she hummed with her shoulder against his.",6600);
  later(()=>{ piece3Mesh.visible=true; piece3Mesh.userData.ix3.enabled=true;
    note3Mesh.visible=true; note3Mesh.userData.ixn3.enabled=true; AU.thud();
    setObjective("Something dropped from the music box. <b>Take it.</b>"); },5200);
}
let ledgeLamp=null;
function lightLedge(){ if(ledgeLamp){ ledgeLamp.l.intensity=1.5; ledgeLamp.m.material.color.setHex(0xf6c878); ledgeLamp.beam.visible=true; } }
const LEDGE={x:716,z:13.7};
function afterPiece3(){
  GS.ledgeOn=true; ledgeSpot.visible=true; ledgeSpot.userData.ix.enabled=true; lightLedge();
  AU.drone(); dread=Math.min(1,dread+.3);
  say(null,"And there — where the parapet turns — the ledge. Their ledge. Cleared of rain, as if someone kept it swept. As if it had been waiting all year.",6600);
  setObjective("The <b>ledge</b> — their safe place. The lantern is lit. Go to it.");
  // turn his head to it: nobody should have to hunt for the place the whole night was about
  if(curZone==="terrace"&&running){ const e=eyeNow(), yaw=Math.atan2(-(LEDGE.x-e[0]),-(LEDGE.z-e[2])), d=Math.hypot(LEDGE.x-e[0],LEDGE.z-e[2]), pt=Math.atan2(1.3-e[1],d);
    const mx=e[0]+(LEDGE.x-e[0])*Math.max(0,1-5/d), mz=e[2]+(LEDGE.z-.9-e[2])*Math.max(0,1-5/d);
    playCine([[0,...e],[1.8,e[0],e[1],e[2],yaw,pt],[5.2,mx,1.6,mz,yaw,pt],[6.6,mx,1.6,mz,yaw,pt]],()=>endCine(mx,mz,nearAngle(yaw,0))); }
}
/* ════════ THE BRANCH (beat 17) ════════ */
function ledgeChoice(){
  uiOpen="choice"; document.exitPointerLock?.();
  $("choiceText").innerHTML="This is where they sat. Counting strange cars. Naming clouds. Her shoulder against his, the city politely far away.<br><br>The ledge is wet and patient. The phone-voice has gone quiet for the first time all night.";
  $("choiceA").textContent="SIT ON THE LEDGE";
  $("choiceB").textContent="STEP BACK — THERE IS ONE THING LEFT UNDONE";
  $("choiceOverlay").classList.add("show");
  $("choiceA").onclick=()=>{ $("choiceOverlay").classList.remove("show"); uiOpen=null; ledgeSecond(); };
  $("choiceB").onclick=()=>{ $("choiceOverlay").classList.remove("show"); uiOpen=null; relock(); startEndingB(); };
}
function ledgeSecond(){
  // he climbs up and sits: the camera goes where he goes, feet over the edge, the city under them
  const e=eyeNow();
  playCine([[0,...e],[2.2,LEDGE.x,2.05,LEDGE.z-.75,Math.PI,-.1],[4.4,LEDGE.x,2.3,LEDGE.z+.15,Math.PI,-.25],[6.2,LEDGE.x,1.95,LEDGE.z+.45,Math.PI,-.3],[8.4,LEDGE.x,1.95,LEDGE.z+.45,Math.PI+.25,-.12]],()=>{
    uiOpen="choice";
    $("choiceText").innerHTML="He sits. The stone is cold through his coat. Below, the street breathes light through the rain.<br><br>He can stay in the sitting. Or he can stand back up and go find the last thing she left him.";
    $("choiceA").textContent="LET GO";
    $("choiceB").textContent="STAND UP · GO BACK DOWN";
    $("choiceOverlay").classList.add("show");
    $("choiceA").onclick=()=>{ $("choiceOverlay").classList.remove("show"); uiOpen=null; endingA(); };
    $("choiceB").onclick=()=>{ $("choiceOverlay").classList.remove("show"); uiOpen=null;
      playCine([[0,...eyeNow()],[2.6,LEDGE.x,2.2,LEDGE.z-.3,Math.PI,0],[4.6,LEDGE.x,1.6,LEDGE.z-1.6,0,0]],()=>{ endCine(LEDGE.x,LEDGE.z-1.6,0); startEndingB(); }); };
  });
  say(null,"He climbs up the way he used to. One hand on the wet stone. Then both.",4200);
}
function endingA(){
  GS.ending="A"; document.exitPointerLock?.();
  // no fall is shown. He looks at the city one more time, then at the street, and the picture goes
  const e=eyeNow(), f=$("fader");
  later(()=>say(null,"The city is very quiet from here. It always was. That was the point of coming up.",5200),600);
  later(()=>say(null,"Counting strange cars. He gets to four.",4200),6600);
  later(()=>{ f.style.transition="opacity 4500ms"; f.style.opacity=1; AU.sirenStart(); },9000);
  playCine([[0,...e],[4.5,e[0],e[1],e[2],Math.PI-.3,-.05],[8.5,e[0],e[1],e[2],Math.PI,-.55],[13.6,e[0],e[1]-.1,e[2]+.12,Math.PI,-1.0]],()=>{
    running=false; document.documentElement.classList.remove("cine");
    finishGame("THE DROP",
      `Rain on the street. Lights that turn, and turn, and say nothing.<br>
      The ledge is empty now. The search is over because the searcher stopped.<br><br>
      <em style="color:#a89a7c">Somewhere above, a phone rings in an empty flat, and rings, and rings.</em><br><br>
      <span style="color:#54606c">ENDING A of 2 — there was another way down.</span>`);
  },{step:(t)=>{ dread=Math.min(1,.2+t*.06); }});
}
function startEndingB(){
  GS.ending="B";
  say("THOMAS","Not like this. There's a frame with nothing in it, eight floors down. I know now what goes in it.");
  setObjective("Down to <b>8001</b>. The <b>face-down frame</b> by the bookshelf — and the photograph.");
}
/* ════════ ENDING-B PROPS IN 8001 (frame + safe) ════════ */
let frameDown=null, safeProp=null;
inZone("floor8",()=>{
  frameDown=mkFrame(TEX.noteSmall,.3,.38);
  { const backing=box(.31,.39,.006,new THREE.MeshLambertMaterial({color:0x2a2018})); backing.position.z=-.02;
    const brace=box(.06,.34,.008,new THREE.MeshLambertMaterial({color:0x38281a})); brace.position.set(0,0,-.024); brace.rotation.z=.5;
    frameDown.add(backing); frameDown.add(brace); }
  frameDown.rotation.x=Math.PI/2; frameDown.rotation.z=.4;   // face DOWN → dark backing shows up
  frameDown.position.set(4.15,.04,4.6); scene.add(frameDown);
  interact(frameDown,"A frame, face-down on the floor",()=>{
    if(GS.piece4)return;
    if(GS.ending==="B"&&inv.has("photo")){
      GS.piece4=true; AU.paper(); AU.thud();
      frameDown.rotation.x=0; frameDown.rotation.z=.03; frameDown.position.set(4.4,1.5,7.06);
      say(null,"He stands the frame up and gives the photograph back its wall. The two of them, on the roof. Complete — and something falls from behind the backing board.",6600);
      give("piece4","🧩","PIECE #4");
      later(()=>{ if(inv.has("piece1")&&inv.has("piece2")&&inv.has("piece3")&&inv.has("piece4"))assembleKey(); },2500);
    } else say(null,"He stopped being able to look at it. Face-down for a year — an empty frame under the dust.");
  });
  safeProp=mkSafe(); safeProp.position.set(3.75,.085,8.76); safeProp.rotation.y=Math.PI; scene.add(safeProp);
  interact(safeProp,"Eileen's safe — inside the wardrobe",()=>{
    if(GS.safeOpen)return;
    if(GS.safeKey&&inv.has("key_safe")){
      GS.safeOpen=true; AU.key(); AU.creak(); safeProp.userData.open=true;
      say(null,"The four-part key turns like it was oiled yesterday. Inside: photographs. A dried flower. A ring box. And a letter with his name on it — her exact hand.",6800);
      later(()=>{ collectNote("n_letter"); openNote("n_letter");
        setObjective("The <b>metro</b>. The lift, then the end of the street. <b>Go to her.</b>");
        GS.metroOpen=true;
        later(()=>say("THOMAS","If there is time left — come. Then there is no time to lose.",4800),1200);
      },7200);
    } else if(GS.safeKey){ say(null,"The key. It's in his hand. It has been the whole year, in pieces."); }
    else { AU.rattle(); say(null,"Locked. A strange slot — not for one key but for something assembled. <em>A four-part key.</em>"); }
  });
});
function assembleKey(){
  ["piece1","piece2","piece3","piece4"].forEach(p=>inv.delete(p));
  give("key_safe","🗝","SAFE KEY");
  GS.safeKey=true; AU.key();
  say(null,"On the table, his hands do the only certain work they've done all year: four pieces, one shape. A key. HER safe. The wardrobe. The bedroom.",6600);
  setObjective("Open <b>Eileen's safe</b> — in the wardrobe, in the bedroom of 8001.");
}
/* ════════ ZONE: METRO (Ending B finale) ════════ */
let trainGrp=null, figureBoarded=false, boardDoor=null, trainInteriorDoor=null;
inZone("metro",()=>{
  const ox=800;
  // Subway-only readability lift; shared post-processing remains unchanged.
  const metroFill=new THREE.HemisphereLight(0x73818c,0x15181d,.42); scene.add(metroFill);
  const metroPlatform=new THREE.PointLight(0x71828a,.32,12,2); metroPlatform.position.set(ox+14,2.2,3.2); scene.add(metroPlatform);
  const metroExit=new THREE.PointLight(0xc8b070,.7,6,1.7); metroExit.position.set(ox+20.8,2.2,3.4); scene.add(metroExit);
  floorPlane(ox+14,3,28,6,TEX.tile,.9,0x9a9890);
  ceilPlane(ox+14,5,28,10,3.2);
  wall("x",ox,ox+28,0,3.2,0,TEX.tile,.8,.16);
  wall("z",0,10,ox,3.2,0,TEX.tile,.8,.16,[[2.2,4.2]]); wall("z",0,10,ox+28,3.2,0,TEX.tile,.8,.16);
  // ── the same furniture as the station he arrived in — seven minutes later, one shade deader ──
  { const bn=mkBench(); at(bn,ox+10,0,1.0,Math.PI); addCollider(ox+10,1.0,1.9,.6);
    interact(bn,"A platform bench",()=>say(null,"Someone's umbrella leans against it, closed and patient. Its owner is not coming back for it."));
    const um=box(.06,.85,.06,new THREE.MeshLambertMaterial({color:0x1c2028})); um.position.set(ox+10.7,.42,1.15); um.rotation.z=.18; scene.add(um);
    const vm=mkVending(false); at(vm,ox+17,0,.65,0); addCollider(ox+17,.62,1.0,.7);
    interact(vm,"The vending machine",()=>say(null,"Dark. Its brothers uptown still hum. Down here even the machines have given up."));
    const ck=mkWallClock(11,47,true); ck.position.set(ox+14,2.55,.2); scene.add(ck);
    interact(ck,"The station clock",()=>say(null,"Eleven-forty-seven. Seven minutes have passed all night. He doesn't ask which seven."));
    const posterTex2=(t2,c1,c2)=>tex((g,s)=>{ g.fillStyle=c1; g.fillRect(0,0,s,s);
      g.fillStyle=c2; g.font="bold 24px Courier New"; g.textAlign="center";
      t2.split("|").forEach((ln,i)=>g.fillText(ln,s/2,42+i*30)); grime(g,s,16,.55); },128);
    const p1=decal(posterTex2("LAST TRAIN|23:59|MIND THE|CLOSING DOORS","#2a3038","#b8b09a"),1.0,1.25);
    p1.position.set(ox+6.5,1.8,.2); p1.rotation.z=-.02; scene.add(p1);
    const p2=decal(posterTex2("LOST|PROPERTY|—|ASK BELOW","#3a3028","#c0b89c"),.85,1.1);
    p2.position.set(ox+21.5,1.85,.2); p2.rotation.z=.03; scene.add(p2); }
  // the stairs he came down by — rising back toward the street, out of reach now
  { const conc2=new THREE.MeshLambertMaterial({map:TEX.concrete});
    const stepTop=new THREE.MeshLambertMaterial({map:TEX.concrete,color:0x777b75});
    // Closed west exit: treads descend toward the platform in one consistent
    // direction instead of alternating height and position.
    const exitSteps=7;
    for(let i2=0;i2<exitSteps;i2++){ const top=.18*(exitSteps-i2);
      const sx=ox+.2+i2*.25;
      const st=box(.25,top,1.9,conc2); st.position.set(sx,top/2,3.2); scene.add(st);
      const tread=box(.22,.018,1.82,stepTop); tread.position.set(sx,top+.01,3.2); scene.add(tread);
    }
    const back=new THREE.Mesh(new THREE.PlaneGeometry(2.0,2.4),new THREE.MeshBasicMaterial({color:0x020304}));
    back.position.set(ox-1.7,1.6,3.2); back.rotation.y=Math.PI/2; scene.add(back);
    const ex=new THREE.Mesh(new THREE.PlaneGeometry(.9,.28),new THREE.MeshBasicMaterial({map:tex((g,s)=>{ g.fillStyle="#0a2416";g.fillRect(0,0,s,s);
      g.fillStyle="#4ab868"; g.font="bold 64px Courier New"; g.textAlign="center"; g.fillText("EXIT",s/2,s/2+20); },128)}));
    ex.position.set(ox-.1,2.5,3.2); ex.rotation.y=Math.PI/2; scene.add(ex);
    const gl2=new THREE.PointLight(0x3aa860,.4,4,1.8); gl2.position.set(ox-.3,2.0,3.2); scene.add(gl2);
    addCollider(ox+.28,3.2,.35,2.0); }
  { const edge=box(28,.1,.2,new THREE.MeshBasicMaterial({color:0xb8a030})); edge.position.set(ox+14,.05,6); scene.add(edge);
    const pit=new THREE.Mesh(new THREE.PlaneGeometry(28,4),new THREE.MeshLambertMaterial({color:0x0a0a0c})); pit.rotation.x=-Math.PI/2; pit.position.set(ox+14,-.8,8); scene.add(pit);
    addCollider(ox+14,6.15,28,.3,"platformEdge"); }
  for(let x=ox+3;x<ox+27;x+=5){ const p=box(.5,3.2,.5,new THREE.MeshLambertMaterial({map:TEX.tile})); p.position.set(x,1.6,3.4); scene.add(p); addCollider(x,3.4,.7,.7); }
  const sg=new THREE.Mesh(new THREE.PlaneGeometry(3,.4),new THREE.MeshBasicMaterial({map:tex((g,s)=>{ g.fillStyle="#101014"; g.fillRect(0,0,s,s);
    g.fillStyle="#c8c8c0"; g.font="bold 36px Courier New"; g.textAlign="center"; g.fillText("HOMEBOUND — LOCAL",s/2,s/2+12); },256)})); sg.position.set(ox+14,2.5,5.8); scene.add(sg);
  for(const x of[ox+6,ox+14,ox+22]){ const f=mkMetroFluorescent(); f.position.set(x,3.08,3); scene.add(f); }
  trainGrp=new THREE.Group(); scene.add(trainGrp);
  const carMat=surf(TEX.metroMetal,8.6,2.6,2.0,0x535c63);
  for(let c=0;c<3;c++){ const cx=c*9-9;
    const car=new THREE.Group();
    const roof=box(8.6,.26,2.2,carMat); roof.position.set(cx,2.44,0); car.add(roof);
    const lower=box(8.6,.52,2.2,carMat); lower.position.set(cx,.34,0); car.add(lower);
    const rear=box(8.6,1.65,.12,carMat); rear.position.set(cx,1.38,.99); car.add(rear);
    const frontTop=box(8.6,.3,.12,carMat); frontTop.position.set(cx,2.1,-1.02); car.add(frontTop);
    const frontBase=box(8.6,.34,.12,carMat); frontBase.position.set(cx,.82,-1.02); car.add(frontBase);
    trainGrp.add(car);
    for(let w=0;w<5;w++){ const wx=cx-3.2+w*1.6;
      if(c===1&&Math.abs(wx)<1.05)continue;
      const win=new THREE.Mesh(new THREE.PlaneGeometry(1.1,.7),new THREE.MeshLambertMaterial({color:0x35464d,emissive:0x10181c})); win.position.set(wx,1.7,-1.12); win.rotation.y=Math.PI; trainGrp.add(win);
      const sill=box(1.12,.035,.035,M.metalDark); sill.position.set(wx,1.3,-1.14); trainGrp.add(sill);
    }
    const floor=box(8.2,.08,1.8,surf(TEX.metroFloor,8.2,1.8,1.0)); floor.position.set(cx,.58,0); trainGrp.add(floor);
    const ceiling=box(8.2,.08,1.8,surf(TEX.metroMetal,8.2,1.8,1.6,0x40494e)); ceiling.position.set(cx,2.42,0); trainGrp.add(ceiling);
    const innerWall=box(8.1,1.65,.08,surf(TEX.metroMetal,8.1,1.65,1.8,0x4a555a)); innerWall.position.set(cx,1.48,.78); trainGrp.add(innerWall);
    for(const sx of[-2.7,0,2.7]){ const seat=box(1.7,.12,.42,new THREE.MeshLambertMaterial({color:0x4b3f4d})); seat.position.set(cx+sx,.86,.38); trainGrp.add(seat); }
    const strip=box(6.6,.035,.12,new THREE.MeshBasicMaterial({color:0xb4bba2})); strip.position.set(cx,2.36,-.25); trainGrp.add(strip);
    const interiorLight=new THREE.PointLight(0xb7c9bd,.24,4.5,1.8); interiorLight.position.set(cx,1.85,-.15); trainGrp.add(interiorLight);
  }
  // Visible middle-car boarding bay aligned with the gameplay trigger.
  for(const xDoor of[-.58,.58]){ const jamb=box(.12,1.65,.1,M.metalDark); jamb.position.set(xDoor,1.35,-1.02); trainGrp.add(jamb); }
  const doorHeader=box(1.3,.14,.1,M.metalDark); doorHeader.position.set(0,2.2,-1.02); trainGrp.add(doorHeader);
  for(let c=0;c<3;c++)put(trainGrp,box(8.6,.16,.05,lam(0x7a3a2a)),c*9-9,1.08,-1.09);     // oxblood waistband: not the line he came in on
  dressTrain(trainGrp,{cars:[-9,0,9],carLen:8.6,hz:1.1,roofY:2.44,doors:[0],seats:[-11.7,-9,-6.3,-2.7,0,2.7,6.3,9,11.7],seatY:.86,seatZ:.38,blind:"HER TOWN"});
  trainGrp.position.set(ox+42,0,8); fitTrain(trainGrp); trainGrp.userData.arriving=false;
  addCollider(ox+9,8,8,2.0,"metroTrain");
  addCollider(ox+19,8,8,2.0,"metroTrain");
  boardDoor=new THREE.Mesh(new THREE.PlaneGeometry(1.2,2.2),new THREE.MeshBasicMaterial({color:0x181a20}));
  boardDoor.position.set(ox+14,1.2,6.85); boardDoor.rotation.y=Math.PI; boardDoor.visible=false; scene.add(boardDoor);
  const ixB=interact(boardDoor,"Board the train",()=>{
    player.x=ox+14; player.z=7.05; player.floorY=TRAIN_FLOOR; player.yaw=Math.PI;
    boardDoor.visible=false; ixB.enabled=false; trainInteriorDoor.visible=true; trainInteriorDoor.userData.ix.enabled=true;
    say(null,"Inside, the train is warm and almost ordinary. The seats are damp with rain, and every window shows the same tunnel.",4800);
  }); ixB.enabled=false; boardDoor.userData.ix=ixB;
  trainInteriorDoor=box(1.0,1.5,.35,new THREE.MeshBasicMaterial({visible:false,side:THREE.DoubleSide}));
  trainInteriorDoor.position.set(ox+14,1.05,7.65); trainInteriorDoor.visible=false; scene.add(trainInteriorDoor);
  const ixInside=interact(trainInteriorDoor,"Take a seat",()=>endingB()); ixInside.enabled=false; trainInteriorDoor.userData.ix=ixInside;
  // The final carriage has its own floor height. Without this, the player is
  // teleported inside and immediately sinks back to platform level.
  ZONES.metro.ground=(x,z)=>{
    if(x>=ox+13.0&&x<=ox+15.0&&z>=6.9&&z<=7.85)return TRAIN_FLOOR;
    return 0;
  };
});
function metroLogic(dt){
  if(curZone!=="metro")return;
  if(!figure.visible&&!figureBoarded){ figure.visible=true; figure.position.set(822,0,5.2); figureT=-999; }
  if(!figureBoarded&&figure.visible){
    const d=Math.hypot(player.x-figure.position.x,player.z-figure.position.z);
    if(d<8&&!trainGrp.userData.arriving){ trainGrp.userData.arriving=true; AU.trainStart();
      say(null,"Wind first — the tunnel exhales. Then light on the rails. The train she has been waiting for, all year.",5200); }
    if(trainGrp.userData.arriving&&trainGrp.position.x>800+14){ trainGrp.position.x-=dt*10;
      if(trainGrp.position.x<=800+14)trainGrp.position.x=800+14; }
    if(trainGrp.userData.arriving&&trainGrp.position.x<=800+14.5&&d<6){
      figureBoarded=true; AU.trainStop(); AU.drone();
      say(null,"The doors open. She does not look back — she has never once looked back — she steps aboard, and the long hair settles, like water going still.",6400);
      later(()=>{ figure.visible=false; setObjective("<b>Board the train.</b>");
        boardDoor.visible=true; boardDoor.userData.ix.enabled=true; },3800);
    }
  }
}
function endingB(){
  // he sits; the doors close; the platform slides away; the tunnel; and then light that is not a lamp
  document.exitPointerLock?.(); buildRideFx(); GS.ending="B";
  const seat=()=>[trainGrp.position.x+2.7,TRAIN_FLOOR+1.2,trainGrp.position.z+.3], e=eyeNow(), s0=seat(), f=$("fader"); let scroll=0, white=false;
  try{ AU.doorChime(); }catch(e2){}
  later(()=>{ try{ AU.trainStart(); }catch(e2){} say(null,"The doors close on the platform, and on the year.",4600); },2600);
  later(()=>say(null,"She is at the far end of the carriage. She does not turn round. She does not need to.",5600),8200);
  later(()=>say(null,"Not to save her. Just to sit. Like the roof.",5200),15000);
  playCine([[0,...e],[2.4,s0[0],s0[1],s0[2],0,-.05],[6,s0[0],s0[1],s0[2],-.5,0],[10,s0[0],s0[1],s0[2],1.3,-.02],[15,s0[0],s0[1],s0[2],1.15,0],[19,s0[0],s0[1],s0[2],0,.02],[24,s0[0],s0[1],s0[2],0,.05]],()=>{
    running=false; dread=0; try{ AU.trainStop(); }catch(e2){} if(ride.fx)ride.fx.visible=false; figure.visible=false; document.documentElement.classList.remove("cine");
    finishGame("TRANSIT",
      `A few frames the eye refuses to hold — the car, the tunnel, the wrong angles of the dream —<br>
      and then: Thomas, seated. A window full of morning. Rails saying her hometown's name over and over.<br><br>
      <em style="color:#a89a7c">Not to save her. Just to sit. Like the roof.</em><br><br>
      <span style="color:#54606c">ENDING B of 2 — every minute was chosen.</span>`);
  },{step:(t,dt)=>{
    if(t>3.4){ const v=Math.min(13,(t-3.4)*1.7); trainGrp.position.x-=v*dt; scroll+=v*dt; }              // pulling out
    if(t>2.4){ const p=seat(); cine.keys.forEach(k=>{ if(k[0]>=2.4){ k[1]=p[0]; k[3]=p[2]; } }); }
    figure.visible=t>7; figure.position.set(trainGrp.position.x-3.3,TRAIN_FLOOR,trainGrp.position.z-.1);
    const g=ride.fx, sx=seat()[0]; g.visible=sx<798; g.position.set(sx,0,trainGrp.position.z); ride.wall.material.map.offset.x=(scroll/6.4)%1;
    ride.lamps.forEach((l,i)=>{ l.position.x=((i*8+scroll)%64+64)%64-32; });
    const near=ride.lamps.reduce((a,l)=>Math.abs(l.position.x)<Math.abs(a.position.x)?l:a); ride.glow.position.set(near.position.x,2.0,-1.3); ride.glow.intensity=g.visible?1.5*Math.max(0,1-Math.abs(near.position.x)/5):0;
    if(t>19.5&&!white){ white=true; f.style.background="#efe4c8"; f.style.transition="opacity 4200ms"; f.style.opacity=1; }   // a window full of morning
  }});
}
/* ════════ ELEVATOR SYSTEM ════════ */
const ELEV_DEST={ G:["lobbyG",201.4,3,-Math.PI/2], 8:["floor8",1.4,1.1,-Math.PI/2], 21:["floor21",601.4,1.1,-Math.PI/2] };
function openElev(from){
  uiOpen="elev"; document.exitPointerLock?.();
  const B=$("elevBtns"); B.innerHTML="";
  const cur={lobbyG:"G",floor8:"8",floor21:"21"}[from];
  [["21","21 — THE TOP",GS.elev21],["8","8 — THE FLATS",true],["G","G — GROUND",GS.elevG]].forEach(([id,lbl,ok])=>{
    const b=document.createElement("button");
    b.textContent=lbl+(id===cur?"  ·  (here)":ok?"":"  ·  dead button");
    b.style.cssText="display:block;width:230px;margin:6px auto;background:#141a20;border:1px solid "+(ok?"#3a4450":"#242a30")+";color:"+(ok?"#e8b060":"#54606c")+";padding:9px;cursor:pointer;font:12px 'Courier New';letter-spacing:2px";
    b.onclick=()=>{ if(id===cur){ closeElev(); return; }
      if(!ok){ AU.rattle(); say(null,id==="G"?"The button is dead. The car itself seems undecided about the ground floor.":"Dead. Whatever wakes this button hasn't happened yet."); return; }
      closeElev(); AU.ding(); AU.elevRide();
      const [zn,x,z,yaw]=ELEV_DEST[id];
      travel(zn,x,z,yaw,()=>{
        if(zn==="floor21"){ AU.tenantsStart(); say(null,"The 21st floor is loud with other people's lives: a couple mid-argument, a baby refusing the whole idea of night.",5600);
          if(GS.metroOpen)setObjective("Down again. The <b>metro</b> at the end of the street.");
          else if(GS.safeKey)setObjective("Open <b>Eileen's safe</b> — in the wardrobe, in the bedroom of 8001.");
          else if(GS.ledgeOn||inv.has("piece3"))setObjective("The <b>ledge</b> — on the roof. Their safe place.");
          else setObjective("The stairs at the end of the corridor. <b>Up, to the terrace door.</b>"); }
        else AU.tenantsStop();
        if(zn==="lobbyG"&&!GS.alley2&&!GS.metroOpen)setObjective("Ground floor. <b>The back door — into the alley.</b>");
        if(zn==="lobbyG"&&GS.metroOpen)setObjective("The <b>front doors</b>. The street. The subway.");
      }); };
    B.appendChild(b); });
  $("elevOverlay").classList.add("show");
}
function closeElev(){ $("elevOverlay").classList.remove("show"); if(uiOpen==="elev"){uiOpen=null; relock();} }
$("elevClose").onclick=closeElev;
/* ════════ per-frame full-game logic ════════ */
function fullGameTick(dt,t){
  rainPts.visible=!!ZONES[curZone].rain;
  if(rainPts.visible){ const P=rainGeo.attributes.position;
    for(let i=0;i<P.count;i+=2){ let y=P.getY(i)-dt*11;
      if(y<0){ y=6.5; const x=player.x+(Math.random()-.5)*20, z=player.z+(Math.random()-.5)*20;
        P.setX(i,x); P.setZ(i,z); P.setX(i+1,x+.05); P.setZ(i+1,z); }
      P.setY(i,y); P.setY(i+1,y+RAIN_LEN); }
    P.needsUpdate=true; }
  if(GS.chase&&curZone==="dream2"){
    // She walks at her own pace and never lets him close: the nearer he gets, the faster she goes.
    // He is wading (see the dream2 speed scale in tick), so she is always the quicker of the two.
    const gap=Math.max(0,player.z-figure.position.z), her=gap>15?0:gap<9?3.6:2.5;   // his wading pace is ~1.55 m/s
    figure.position.z=Math.max(2.2,figure.position.z-her*dt); figure.rotation.set(0,Math.PI,0);
    if(figure.position.z<=2.25&&gap<7)figure.visible=false;   // at the door she waits for him, then is simply not there
    figure.position.x=502+Math.sin(t*1.7)*.4;
    if(player.z<4.6)endChase();
  }
  if(GS.tankFilled&&tankWater&&tankWater.position.y<2.75){ tankWater.position.y+=dt*.25;
    { const fl3=nodes.find(m=>m.userData.float); if(fl3){ fl3.position.y=tankWater.position.y+.12;
      if(fl3.userData.ix)fl3.userData.ix.prompt="A chime, riding the water"; } }
    const n3=nodes.find(n=>n.userData.float); if(n3)n3.position.y=Math.min(2.9,tankWater.position.y+.12); }
  metroLogic(dt);
  if(safeProp&&safeProp.userData.open){ const d=safeProp.userData.door; d.rotation.y+=(1.9-d.rotation.y)*Math.min(1,dt*2.2); safeProp.userData.glow.intensity=.7*(d.rotation.y/1.9); }
  for(const f of fxPulse)f.light.intensity=f.base+Math.sin(t*f.speed+f.phase)*f.amp;
  nightlifeTick(dt,t);
  if(curZone==="dream1")for(let i=0;i<gleams.length;i++)gleams[i].material.opacity=.3+.3*Math.abs(Math.sin(t*2+i));
}
/* ════════ credits ════════ */
function finishGame(title,body){
  later(()=>{ $("fader").style.background="#000"; },1600);
  AU.sirenStop&&AU.sirenStop(); AU.tenantsStop&&AU.tenantsStop();
  $("endTitle").textContent=title;
  $("endBody").innerHTML=body;
  $("endStats").textContent=`NOTES ${collected.size}/${JOURNAL_ORDER.length} · TIME ${Math.round((performance.now()-startTime)/1000)}s`;
  const e=$("endScreen"); e.style.display="flex"; requestAnimationFrame(()=>e.style.opacity=1); running=false;
}
/* ════════════════════════════════════════════════════════════════
   ART PASS — per-level light, atmosphere and dressing
   One block per zone, in story order. Everything here is additive: no
   collider, trigger or puzzle position above is moved.
   ════════════════════════════════════════════════════════════════ */
function pl(color,intensity,dist,x,y,z){ const L=new THREE.PointLight(color,intensity,dist,1.5); L.position.set(x,y,z); scene.add(L); return L; }
function glowPlane(w,h,color,x,y,z,ry=0){ const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color})); m.position.set(x,y,z); m.rotation.y=ry; scene.add(m); return m; }
/* the biggest flat plane in a zone is its ground: give it a wet sheen */
function wetGround(zone,amount,shine){ let best=null,area=0;
  zoneGroups[zone].traverse(o=>{ if(o.isMesh&&o.geometry.type==="PlaneGeometry"&&o.rotation.x<-1.5){ const p=o.geometry.parameters, a=p.width*p.height; if(a>area){ area=a; best=o; } } });
  if(best)wetMat(best.material,amount,shine); return best; }
function fixturesOf(zone){ const out=[]; zoneGroups[zone].traverse(o=>{ if(o.userData.tube&&o.userData.light)out.push(o); }); return out; }
const fxPulse=[];   // {light, base, amp, speed, phase}: slow breathing lights, driven in fullGameTick

/* ════════ SKY AND NIGHTLIFE (shared by every outdoor level) ════════
   A cloud deck lit from below by the city, a veiled moon, a far ring of towers with aviation
   beacons, an aircraft crossing, sheet lightning with thunder a beat behind it, and a low
   traffic bed with the odd distant horn. */
const skyDomes=[], fxPlanes=[], fxCars=[], fxWalkers=[], fxTraffic=[];
const stormLight=new THREE.DirectionalLight(0xc4d2ff,0); stormLight.position.set(.4,1,.2); _sceneAdd(stormLight);
const storm={t:14,flash:0};
function mkSky(cx,cz,o={}){
  const c=document.createElement("canvas"); c.width=1024; c.height=512; const g=c.getContext("2d");
  const gr=g.createLinearGradient(0,0,0,512); gr.addColorStop(0,"#04050a"); gr.addColorStop(.3,"#0a0c18"); gr.addColorStop(.43,"#1e1a24");
  gr.addColorStop(.47,"#3a2a2a"); gr.addColorStop(.498,"#6a4428"); gr.addColorStop(.52,"#241812"); gr.addColorStop(1,"#040405"); g.fillStyle=gr; g.fillRect(0,0,1024,512);
  for(let i=0;i<260;i++){ const x=Math.random()*1024, y=30+Math.random()*215, r=26+Math.random()*90, a=.03+.09*(y/245);   // clouds, warmer and brighter toward the horizon
    for(const dx of[0,-1024,1024]){ const rg=g.createRadialGradient(x+dx,y,0,x+dx,y,r); rg.addColorStop(0,`rgba(${52+y*.3|0},${48+y*.15|0},${62+y*.04|0},${a})`); rg.addColorStop(1,"rgba(0,0,0,0)");
      g.fillStyle=rg; g.fillRect(x+dx-r,y-r,r*2,r*2); } }
  for(let i=0;i<70;i++){ const x=Math.random()*1024, y=20+Math.random()*200, r=30+Math.random()*70;                         // breaks in the deck
    const rg=g.createRadialGradient(x,y,0,x,y,r); rg.addColorStop(0,"rgba(3,4,9,.5)"); rg.addColorStop(1,"rgba(3,4,9,0)"); g.fillStyle=rg; g.fillRect(x-r,y-r,r*2,r*2); }
  { const mx=o.moonX??640, my=o.moonY??118; let rg=g.createRadialGradient(mx,my,0,mx,my,80); rg.addColorStop(0,"rgba(190,202,226,.42)"); rg.addColorStop(1,"rgba(190,202,226,0)");
    g.fillStyle=rg; g.fillRect(mx-80,my-80,160,160); g.fillStyle="rgba(226,230,238,.85)"; g.beginPath(); g.arc(mx,my,11,0,7); g.fill();
    g.fillStyle="rgba(20,20,30,.5)"; g.fillRect(mx-40,my+2,80,7); g.fillRect(mx-26,my-9,46,4); }                                // cloud bars across the moon
  const dome=new THREE.Mesh(new THREE.SphereGeometry(280,32,16),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c),side:THREE.BackSide,fog:false,depthWrite:false,color:0xcfcfcf}));
  dome.position.set(cx,0,cz); dome.renderOrder=-10; scene.add(dome); skyDomes.push(dome);
  // far towers, as a ring
  const sc=document.createElement("canvas"); sc.width=1024; sc.height=256; const s=sc.getContext("2d"); let x=0; const tops=[];
  while(x<1024){ const w=12+Math.random()*30, h=256*(.2+Math.random()*Math.random()*.75); s.fillStyle=Math.random()<.5?"#07080d":"#0a0c12"; s.fillRect(x,256-h,w-1,h);
    for(let wy=256-h+5;wy<250;wy+=7)for(let wx=x+2;wx<x+w-4;wx+=5)if(Math.random()<.17){ s.fillStyle=Math.random()<.72?"#e6bc6a":"#9ec6dc"; s.globalAlpha=.5+Math.random()*.5; s.fillRect(wx,wy,2,3); }
    s.globalAlpha=1; if(h>150)tops.push([x+w/2,256-h]); x+=w; }
  const st=new THREE.CanvasTexture(sc); st.magFilter=THREE.NearestFilter; st.wrapS=THREE.RepeatWrapping; st.repeat.set(3,1);
  const R=o.ringR??190, H=o.ringH??90, ring=new THREE.Mesh(new THREE.CylinderGeometry(R,R,H,48,1,true),new THREE.MeshBasicMaterial({map:st,side:THREE.BackSide,transparent:true,alphaTest:.5,fog:false,depthWrite:false}));
  ring.position.set(cx,(o.ringY??0)+H/2,cz); ring.renderOrder=-9; scene.add(ring);
  for(let k=0;k<Math.min(9,tops.length*3);k++){ const [tx,ty]=tops[k%tops.length], u=(tx/1024+(k/tops.length|0))/3, a=u*Math.PI*2;   // aviation beacons on the tallest
    const b=new THREE.Mesh(new THREE.SphereGeometry(1.5,6,5),new THREE.MeshBasicMaterial({color:0xe03028,fog:false}));
    b.position.set(cx+Math.sin(a)*(R-2),(o.ringY??0)+H*(1-ty/256)+1.5,cz+Math.cos(a)*(R-2)); fxBeacons.push(b); scene.add(b); }
  const pl2=new THREE.Mesh(new THREE.SphereGeometry(.9,5,4),new THREE.MeshBasicMaterial({color:0xffffff,fog:false})); scene.add(pl2);     // an aircraft, going somewhere else
  fxPlanes.push({m:pl2,cx,cz,a:Math.random()*6,y:(o.ringY??0)+H+40});
  return dome; }
AU.cityStart=function(){ if(!this.ctx||this._city)return;
  const s=this.ctx.createBufferSource(); s.buffer=this.noiseBuf(4); s.loop=true;
  const lp=this.ctx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=170;
  const g=this.ctx.createGain(); g.gain.value=.0001; g.gain.setTargetAtTime(.075,this.ctx.currentTime,2.5); s.connect(lp); lp.connect(g); g.connect(this.master); s.start();
  const horn=()=>{ if(!this._city||!this.ctx)return; const t=this.ctx.currentTime, f=[392,349,415][(Math.random()*3)|0], hg=this.ctx.createGain(), hf=this.ctx.createBiquadFilter();
    hf.type="lowpass"; hf.frequency.value=700; hg.gain.setValueAtTime(.0001,t); hg.gain.linearRampToValueAtTime(.011,t+.05); hg.gain.setTargetAtTime(.0001,t+.35+Math.random()*.5,.12);
    for(const m of[1,1.26]){ const o=this.ctx.createOscillator(); o.type="square"; o.frequency.value=f*m; o.connect(hf); o.start(t); o.stop(t+1.6); } hf.connect(hg); hg.connect(this.master); };
  const pass=()=>{ if(!this._city||!this.ctx)return; const t=this.ctx.currentTime, n=this.ctx.createBufferSource(), bp=this.ctx.createBiquadFilter(), pg=this.ctx.createGain();   // a car on wet road, somewhere near
    n.buffer=this.noiseBuf(3); bp.type="bandpass"; bp.frequency.setValueAtTime(500,t); bp.frequency.linearRampToValueAtTime(1500,t+1.2); bp.frequency.linearRampToValueAtTime(420,t+2.6);
    pg.gain.setValueAtTime(.0001,t); pg.gain.linearRampToValueAtTime(.03,t+1.2); pg.gain.linearRampToValueAtTime(.0001,t+2.7); n.connect(bp); bp.connect(pg); pg.connect(this.master); n.start(t); n.stop(t+2.9); };
  this._cityT=setInterval(()=>{ const r=Math.random(); if(r<.22)horn(); else if(r<.62)pass(); },3600); this._city={s,g}; };
AU.cityStop=function(){ if(this._city){ const T=this._city; T.g.gain.setTargetAtTime(.0001,this.ctx.currentTime,1); clearInterval(this._cityT); later(()=>{ try{T.s.stop();}catch(e){} },2500); this._city=null; } };
function nightlifeTick(dt,t){
  const out=!!ZONES[curZone].rain&&running;
  try{ if(out&&!AU._city)AU.cityStart(); else if(!out&&AU._city)AU.cityStop(); }catch(e){}
  if(out){ storm.t-=dt; if(storm.t<=0){ storm.t=16+Math.random()*38; storm.flash=1; later(()=>{ try{AU.thunder();}catch(e){} },500+Math.random()*1900); } }
  storm.flash=Math.max(0,storm.flash-dt*2.6); const f=out&&storm.flash>0?storm.flash*(.55+.45*Math.sin(t*70)):0;
  stormLight.intensity=f*1.5; for(const d of skyDomes)d.material.color.setScalar(.81+f*1.6);
  for(const p of fxPlanes){ p.a+=dt*.018; p.m.position.set(p.cx+Math.sin(p.a)*210,p.y,p.cz+Math.cos(p.a)*210); p.m.visible=Math.sin(t*5.2)>-.3; }
  for(const c of fxCars){ c.m.position.x+=c.v*dt; if(c.v>0&&c.m.position.x>c.x1)c.m.position.x=c.x0-Math.random()*30; if(c.v<0&&c.m.position.x<c.x0)c.m.position.x=c.x1+Math.random()*30; }
  for(const w of fxWalkers){ w.m.position.x+=w.v*dt; if(w.v>0&&w.m.position.x>w.x1)w.m.position.x=w.x0; if(w.v<0&&w.m.position.x<w.x0)w.m.position.x=w.x1; w.m.position.y=Math.abs(Math.sin(t*6+w.ph))*.03; }
  for(const s of fxTraffic){ const ph=((t+s.off)%14); const k=ph<6?0:ph<7.5?1:2; s.lamps.forEach((l,i)=>l.material.color.setHex(i===k?s.on[i]:0x141414)); }
}
/* a car that drives: a sedan with lamps that are actually on */
function mkTrafficCar(col){ const g=mkSedan(); g.traverse(o=>{ if(o.isMesh&&o.material.isMeshPhongMaterial&&o.material.color.getHex()===0x2c3438)o.material=wetMat(lam(col),.5,34); });
  for(const z of[-.62,.62]){ put(g,box(.04,.14,.28,new THREE.MeshBasicMaterial({color:0xfff2d0})),2.13,.68,z); put(g,box(.04,.1,.3,new THREE.MeshBasicMaterial({color:0xe02418})),-2.13,.7,z); }
  const beam=new THREE.Mesh(new THREE.PlaneGeometry(7,2.2),new THREE.MeshBasicMaterial({color:0xfff0c8,transparent:true,opacity:.07,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide}));
  beam.rotation.x=-Math.PI/2; beam.position.set(5.6,.03,0); g.add(beam); return g; }
/* someone under an umbrella, with somewhere to be */
function mkWalker(){ const g=group(), d=lam(0x14161a);
  put(g,rod(.16,.2,.95,6,d),0,1.0,0); put(g,rod(.12,.14,.75,6,lam(0x101114)),0,.38,0); put(g,new THREE.Mesh(new THREE.SphereGeometry(.11,6,5),d),0,1.6,0);
  put(g,rod(.012,.012,.9,4,M.black),.14,1.75,0); const um=new THREE.Mesh(new THREE.ConeGeometry(.55,.26,8,1,true),lam([0x1a1c22,0x2a1a1c,0x1a2420][(Math.random()*3)|0],{side:THREE.DoubleSide})); put(g,um,.14,2.2,0);
  return g; }
/* a ground-floor shopfront, built facing +z */
function shopfront(x,z,ry,w,name,col,lit,o={}){ const g=group(); g.position.set(x,0,z); g.rotation.y=ry;
  put(g,box(w,.45,.14,lam(0x1c1e22)),0,.225,.07); put(g,box(w+.2,.6,.26,lam(o.fascia??0x16181c)),0,2.9,.13);
  const wt=tex((c,s)=>{ c.fillStyle=lit?"#"+new THREE.Color(col).multiplyScalar(.55).getHexString():"#06080a"; c.fillRect(0,0,s,s);
    if(lit){ c.fillStyle="rgba(0,0,0,.45)"; for(let i=0;i<7;i++)c.fillRect(8+i*18+Math.random()*6,s*(.35+Math.random()*.25),10+Math.random()*8,s);       // stock, stools, people
      c.fillStyle="rgba(255,240,210,.25)"; c.fillRect(0,0,s,s*.18); } else { c.fillStyle="rgba(60,70,80,.25)"; c.fillRect(s*.1,s*.1,s*.3,s*.6); } grime(c,s,6,.25); },128);
  const dw=.95, gw=w-dw-.5; put(g,new THREE.Mesh(new THREE.PlaneGeometry(gw,2.0),new THREE.MeshBasicMaterial({map:wt})),-(dw+.1)/2,1.5,.075);
  for(const mx of[-(w/2-.1),(w/2-.1),w/2-dw-.3])put(g,box(.1,2.2,.16,lam(0x101214)),mx,1.5,.08);
  put(g,box(dw-.1,2.05,.06,lam(0x16181c)),w/2-dw/2-.15,1.03,.06); put(g,new THREE.Mesh(new THREE.PlaneGeometry(dw-.3,1.2),new THREE.MeshBasicMaterial({color:lit?new THREE.Color(col).multiplyScalar(.4):0x06080a})),w/2-dw/2-.15,1.3,.095);
  const sg=new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w-.4,name.length*.34),.42),new THREE.MeshBasicMaterial({transparent:true,map:tex((c,s)=>{ c.clearRect(0,0,s,s); c.font="bold "+Math.min(54,Math.floor(s*1.5/name.length))+"px Courier New"; c.textAlign="center"; c.textBaseline="middle";
    const cs="#"+new THREE.Color(o.sign??col).getHexString(); if(lit||o.neon){ c.shadowColor=cs; c.shadowBlur=14; } c.fillStyle=lit||o.neon?cs:"rgba(120,126,130,.6)"; c.fillText(name,s/2,s/2); },256)}));
  sg.material.map.repeat.set(1,.3); sg.material.map.offset.set(0,.35); put(g,sg,0,2.9,.27);
  if(o.awning){ put(g,box(w,.05,1.1,lam(o.awning)),0,2.45,.6,.32); }
  if(lit&&(o.power??.95)>0){ const L=new THREE.PointLight(col,o.power??.95,8,1.5); L.position.set(0,1.7,1.6); g.add(L); }
  scene.add(g); return g; }

/* ── 1 · ARRIVAL: a lit, empty station; the only warmth is the way out ── */
inZone("arrival",()=>{ const ox=900;
  wetGround("arrival",.22,18);
  pl(0xe8a858,1.25,8,ox+21.7,2.2,3.4);                                  // WAY OUT: sodium spill from the stairs
  for(const x of[-7.5,-2.5,2.5,7.5]){ const L=new THREE.PointLight(0xc4d6d0,.95,6,1.5); L.position.set(x,2.15,-.1); arrTrain.add(L); }   // the carriage is still lit, and empty
  const fx=fixturesOf("arrival"); if(fx[1])flickers.push(fx[1]);        // one tube is dying
  for(let x=ox+1.2;x<ox+22;x+=3.4){ const b=box(.3,.26,4.8,lam(0x6a6e6a)); b.position.set(x,3.07,3.6); scene.add(b); }   // downstand beams
  { const cop=box(23,.07,.34,lam(0x8a8c86)); cop.position.set(ox+11,.036,5.86); scene.add(cop); }                     // platform coping
  for(const x of[ox-.3,ox+22.3]){ const ring=box(.3,3.2,2.2,lam(0x1a1c1e)); ring.position.set(x,1.6,7.2); scene.add(ring);   // tunnel portals
    const arch=box(.34,.5,2.4,surf(TEX.concrete,2.4,.5,1)); arch.position.set(x,2.95,7.2); scene.add(arch); }
  // tactile paving, a bin, an abandoned umbrella: someone was here, earlier
  for(let x=ox+.5;x<ox+22;x+=1){ const t=box(.8,.012,.3,lam(0x6a6230)); t.position.set(x,.008,5.6); scene.add(t); }
  { const bin=rod(.22,.18,.7,10,M.metalDark); bin.position.set(ox+16.6,.35,1.6); scene.add(bin); addCollider(ox+16.6,1.6,.5,.5);
    const liner=rod(.2,.2,.04,10,M.black); liner.position.set(ox+16.6,.71,1.6); scene.add(liner); }
  { const um=group(); put(um,rod(.012,.012,.9,5,M.black),0,.45,0); put(um,rod(.06,.012,.62,8,lam(0x1a2030)),0,.52,0); put(um,box(.03,.08,.1,lam(0x5a4028)),0,.92,.04);
    um.position.set(ox+7.1,.02,1.7); um.rotation.set(0,.4,1.35); scene.add(um); }
  for(const x of[ox+5.5,ox+15.5]){ const col=box(.5,3.2,.5,surf(TEX.concrete,.5,3.2,1)); col.position.set(x,1.6,5.1); scene.add(col); addCollider(x,5.1,.55,.55);
    const band=box(.52,.4,.52,lam(0x35506a)); band.position.set(x,1.3,5.1); scene.add(band); }
});

/* ── 2 · STREET: a real city street at 11:40 on a wet night — shops, traffic, and nobody he knows ── */
inZone("street",()=>{ const ox=-100, W0=ox-1.49, W1=ox+17.49;
  mkSky(ox+8,14,{ringY:6,ringH:110,moonX:760});
  // upper storeys: nine floors of other people's windows, either side
  const dark=new THREE.MeshBasicMaterial({color:0x0b0d12}), warm=new THREE.MeshBasicMaterial({color:0x9a7a40}), tv=new THREE.MeshBasicMaterial({color:0x44607c}), sillM=lam(0x4a4a46);
  let k=0;
  for(const [wx,ry,nx] of[[W0,Math.PI/2,1],[W1,-Math.PI/2,-1]])for(let r=0;r<8;r++)for(let z=2.2;z<28.5;z+=2.9){ k++;
    const lit=k%7===4?warm:k%11===6?tv:dark;
    const w=new THREE.Mesh(new THREE.PlaneGeometry(1.1,1.35),lit); w.position.set(wx,4.6+r*1.85,z); w.rotation.y=ry; scene.add(w);
    if(r<4){ const sill=box(.12,.07,1.25,sillM); sill.position.set(wx+nx*.03,3.9+r*1.85,z); scene.add(sill);
      const mull=box(.03,1.35,.05,sillM); mull.position.set(wx+nx*.01,4.6+r*1.85,z); scene.add(mull); } }
  for(const [wx,nx] of[[W0,1],[W1,-1]]){ const band=box(.14,.3,31,lam(0x3a3632)); band.position.set(wx+nx*.02,3.55,14); scene.add(band); }   // string course over the shops
  // ground floor: the street's businesses, most of them shut, three of them not
  shopfront(W0, 6.0, Math.PI/2,4.6,"PHARMACY",0x58c890,false,{neon:true,sign:0x58c890});
  shopfront(W0,12.6, Math.PI/2,5.2,"THE ANCHOR",0xd89040,true,{awning:0x3a1c1c,power:1.1});
  shopfront(W0,19.4, Math.PI/2,4.4,"TAILOR",0xb0a080,false);
  shopfront(W0,25.0, Math.PI/2,4.2,"NEWS · TOBACCO",0xb0c0d0,true,{power:.8});
  shopfront(W1, 4.6,-Math.PI/2,4.4,"PAWN",0xc8b050,false,{neon:true,sign:0xc85040});
  shopfront(W1,10.6,-Math.PI/2,5.6,"ALL NIGHT DINER",0xe0b070,true,{awning:0x1c2c3a,power:1.2});
  shopfront(W1,17.2,-Math.PI/2,4.2,"LAUNDRETTE",0x7896a0,false);
  shopfront(W1,23.4,-Math.PI/2,5.0,"HOTEL MERIDIAN",0xd05868,false,{neon:true,sign:0xd05868});
  pl(0xd05868,.7,7,W1-1.2,3.2,23.4); pl(0x58c890,.55,6,W0+1.2,3.2,6.0);                       // the two neons that still work
  { const sg=new THREE.Mesh(new THREE.PlaneGeometry(.7,4.2),new THREE.MeshBasicMaterial({transparent:true,map:tex((c,s)=>{ c.clearRect(0,0,s,s); c.font="bold 40px Courier New"; c.textAlign="center";
      c.shadowColor="#d05868"; c.shadowBlur=12; "HOTEL".split("").forEach((ch,i)=>{ c.fillStyle=i===3?"rgba(90,40,48,.7)":"#f08090"; c.fillText(ch,s/2,38+i*44); }); },256)}));
    sg.position.set(W1-.5,7.4,23.4); scene.add(sg); const sg2=sg.clone(); sg2.rotation.y=Math.PI; scene.add(sg2);
    const arm=box(.5,.06,.06,M.metalDark); arm.position.set(W1-.25,9.4,23.4); scene.add(arm); }
  // the road itself: centre line, a crossing, parked cars, a van, bins, a hydrant's worth of clutter
  for(let z=1;z<26;z+=3){ const d=box(.14,.012,1.5,lam(0x8a8468)); d.position.set(ox+8,.012,z); scene.add(d); }
  for(let i=0;i<7;i++){ const zb=box(1.5,.012,.5,lam(0x9a968a)); zb.position.set(ox+3.2+i*1.75,.012,23.2); scene.add(zb); }
  for(const [x,z,ry,col] of[[ox+13.0,6.2,-Math.PI/2+.02,0x3a2c2a],[ox+13.0,13.4,-Math.PI/2-.03,0x26303a],[ox+3.0,19.0,Math.PI/2,0x303a30]]){
    const car=mkSedan(); car.traverse(o=>{ if(o.isMesh&&o.material.isMeshPhongMaterial&&o.material.color.getHex()===0x2c3438)o.material=wetMat(lam(col),.5,34); });
    at(car,x,0,z,ry); addCollider(x,z,2.0,4.4); }
  { const van=group(), vm=wetMat(lam(0x5a5c58),.4,30); put(van,box(4.6,1.5,1.9,vm),0,1.2,0); put(van,box(1.3,.9,1.86,vm),2.2,.9,0); put(van,box(.05,.6,1.6,M.glassDark),2.86,1.25,0,0,0,.3);
    for(const [wx,wz] of[[-1.5,-.92],[1.6,-.92],[-1.5,.92],[1.6,.92]])put(van,rod(.34,.34,.22,12,M.rubber),wx,.34,wz,Math.PI/2);
    put(van,box(2.4,.5,.02,lam(0x3a3c3a)),-.6,1.3,.96); at(van,ox+13.1,0,20.2,-Math.PI/2); addCollider(ox+13.1,20.2,2.1,5.0); }
  for(const [x,z] of[[ox+1.0,8.6],[ox+15.2,14.6],[ox+1.0,22.2]]){ const bin=rod(.26,.22,.85,10,lam(0x2a3430)); bin.position.set(x,.43,z); scene.add(bin); addCollider(x,z,.55,.55); }
  for(const z of[7.5,15.5,23]){ for(let i=0;i<6;i++){ const t=i/5; const c=box(3.6,.025,.025,M.black); c.position.set(ox-.2+t*16.4,12.5-Math.sin(t*Math.PI)*1.1,z); c.rotation.z=-Math.cos(t*Math.PI)*.2; scene.add(c); } }
  for(const [dx,dz] of[[W0+.09,9.6],[W1-.09,2.4],[W1-.09,20.2],[W0+.09,22.6]]){ const d=rod(.07,.07,19,7,M.metalDark); d.position.set(dx,9.5,dz); scene.add(d); }
  for(const [wx,nx,z] of[[W0,1,15.8],[W1,-1,8.0]]){ for(let lv=0;lv<4;lv++){ const y=5.6+lv*3.7;                                      // fire escapes
      const plat=box(.95,.06,2.6,M.metalDark); plat.position.set(wx+nx*.5,y,z); scene.add(plat);
      const rail=box(.04,.9,2.6,M.metalDark); rail.position.set(wx+nx*.96,y+.45,z); rail.material=M.metalDark; scene.add(rail);
      if(lv<3){ const st=box(.5,.05,3.9,M.metalDark); st.position.set(wx+nx*.5,y+1.85,z); st.rotation.x=(lv%2?1:-1)*1.22; scene.add(st); } } }
  // the island the subway comes up on, and a traffic signal for a street nobody is crossing
  { const isl=box(4.4,.1,4.6,surf(TEX.concrete,4.4,4.6,1.2)); isl.position.set(ox+4,.05,27.6); scene.add(isl); }
  const signal=(x,z,ry,off)=>{ const g=group(); put(g,rod(.07,.09,4.2,6,M.metalDark),0,2.1,0); put(g,box(.34,.95,.3,lam(0x101214)),0,3.7,.2);
    const lamps=[0xe03020,0xe0a020,0x30c060].map((c,i)=>put(g,rod(.1,.1,.04,10,new THREE.MeshBasicMaterial({color:0x141414})),0,4.0-i*.3,.36,Math.PI/2));
    g.position.set(x,0,z); g.rotation.y=ry; scene.add(g); addCollider(x,z,.3,.3); fxTraffic.push({lamps,on:[0xff4030,0xffb030,0x40e080],off}); };
  signal(ox+.6,28.9,Math.PI,0); signal(ox+15.4,28.9,Math.PI,7);
  // ── THE AVENUE: what the end of the street opens onto ──
  { const road=new THREE.Mesh(new THREE.PlaneGeometry(150,10.4),wetMat(surf(TEX.asphalt,150,10.4,1.6),.45,26)); road.rotation.x=-Math.PI/2; road.position.set(ox+8,.0,34.9); scene.add(road);
    for(let x=ox-60;x<ox+78;x+=4){ const d=box(1.8,.012,.14,lam(0x8a8468)); d.position.set(x,.012,34.9); scene.add(d); }
    const farWalk=box(150,.14,3.2,surf(TEX.concrete,150,3.2,1.2)); farWalk.position.set(ox+8,.07,41.7); scene.add(farWalk);
    for(const [x0,x1] of[[ox-70,ox-1.6],[ox+17.6,ox+86]]){ const nb=box(x1-x0,19,.4,surf(TEX.brickExt,x1-x0,19,.5)); nb.position.set((x0+x1)/2,9.5,29.4); scene.add(nb);      // the corner blocks, seen from behind
      const nw=box(x1-x0,.14,.9,surf(TEX.concrete,x1-x0,.9,1.2)); nw.position.set((x0+x1)/2,.07,29.95); scene.add(nw); }
    // far side: a row of buildings with lit ground floors
    const fac=(seed)=>tex((c,sz)=>{ c.fillStyle="#12100e"; c.fillRect(0,0,sz,sz); let q=seed; const R=()=>{ q=(q*16807)%2147483647; return q/2147483647; };
      for(let rr=0;rr<8;rr++)for(let cc=0;cc<6;cc++){ const v=R(); c.fillStyle=v<.2?(v<.06?"#7a9ab4":"#c89a52"):"#07080b"; c.fillRect(6+cc*21,5+rr*15.5,13,10); } },128);
    const names=[["BAR",0xd06050],["CINEMA",0xe0c060],["NOODLES",0xe08040],["LIQUOR",0x60c0d0],["24H",0x70d090],["ARCADE",0xc060c0],["CAFE",0xe0b070],["TAXI",0xe0d050],["BOOKS",0x90a0b0]];
    let x=ox-52, n=0; while(x<ox+70){ const w=8+((n*37)%7), h=13+((n*53)%11); const t=fac(1000+n*77); t.repeat.set(Math.max(1,w/7),Math.max(1,(h-3.4)/7));
      const up=new THREE.Mesh(new THREE.BoxGeometry(w-.3,h-3.4,6),[lam(0x16130f),lam(0x16130f),lam(0x0a0a0a),lam(0x0a0a0a),lam(0x16130f),new THREE.MeshBasicMaterial({map:t})]);
      up.position.set(x+w/2,3.4+(h-3.4)/2,46.4); scene.add(up);
      const [nm,col]=names[n%names.length]; shopfront(x+w/2,43.4,Math.PI,w-.6,nm,col,n%4!==3,{neon:true,power:0});
      const glow=glowPlane(w-.6,.5,col,x+w/2,.02,42.4,0); glow.rotation.x=-Math.PI/2; glow.material.transparent=true; glow.material.opacity=.1; glow.material.blending=THREE.AdditiveBlending; glow.material.depthWrite=false;
      x+=w; n++; }
    for(const [lx,col] of[[ox-14,0xd06050],[ox+4,0xe0c060],[ox+22,0x70d090],[ox+38,0xc060c0]])pl(col,1.0,16,lx,2.4,40.6);                     // the whole row, as four washes of colour
    for(let x2=ox-44;x2<ox+64;x2+=13){ const L=mkStreetLamp(); L.traverse(o=>{ if(o.isPointLight){ o.intensity=0; o.visible=false; } }); at(L,x2,0,40.4,-Math.PI/2); }
    // traffic, both ways, and a few people who are not him
    for(const [z,v,col,x0] of[[32.4,9.5,0x2a2e36,ox-40],[32.4,8.2,0x3a2622,ox+12],[37.2,-10.5,0x2c342c,ox+30],[37.2,-8.8,0x40403a,ox-20],[32.6,11,0xc8b040,ox+50]]){
      const car=mkTrafficCar(col); car.position.set(x0,0,z); car.rotation.y=v>0?0:Math.PI; scene.add(car); fxCars.push({m:car,v,x0:ox-70,x1:ox+86}); }
    for(const [x0,v,ph] of[[ox-20,1.1,0],[ox+10,-.9,2],[ox+34,1.25,4],[ox-4,-1.05,1]]){ const w=mkWalker(); w.position.set(x0,.14,41.2+ph*.25); scene.add(w); fxWalkers.push({m:w,v,x0:ox-50,x1:ox+68,ph}); }
    const hl=pl(0xfff0d0,0,14,ox+8,1.2,33); fxPulse.push({light:hl,base:.5,amp:.5,speed:.9,phase:0});                                           // headlights sweeping the mouth of the street
  }
  pl(0x48c070,.9,7,ox+4,1.6,28.2);                                      // SUBWAY sign washes its own steps
  pl(0xe0b070,.45,6,ox+4,2.4,.9);                                       // the stoop: home, the warmest thing on the street
  for(const x of[ox+6.4,ox+10.4,ox+14.4]){ const wl=glowPlane(.9,1.2,0x8a6c38,x,6.2+((x*3)%3)*1.9,-1.47); }
});

/* ── 3 · DREAM 1: overexposed, clinical, wrong ── */
inZone("dream1",()=>{ const ox=100;
  ZONES.dream1.fog=[0x8e9094,5,34]; ZONES.dream1.bg=0x8e9094;
  wetGround("dream1",.4,50);
  for(const z of[3.5,9,14.5,20])pl(0xf4f6ff,1.15,9,ox,3.1,z);
  for(const g of gleams)g.material.opacity=.85;
  for(let i=-1;i<=1;i++){ const L=pl(0x3ad0c0,.9,5,ox+i*1.02,1.3,1.2); fxPulse.push({light:L,base:.9,amp:.45,speed:1.3,phase:i*1.7}); }
  for(const m of archGlass){ m.emissive.setHex(0x1a6a62); m.opacity=.8; }
  addCollider(ox,10.4,3.4,.3,"dreamHold");   // he can walk the gallery, but not into what happens at the end of it
  // ceiling ribs marching to the vanishing point
  for(let z=1.5;z<24;z+=1.5){ const rib=box(3.2,.14,.1,lam(0xb4b6ba)); rib.position.set(ox,3.33,z); scene.add(rib); }
});

/* ── 4 · 8TH FLOOR: his flat warm and lived-in; hers cold and stopped ── */
inZone("floor8",()=>{
  pl(0x86aac8,.8,5.5,10.4,1.5,7.7);                                     // 8007: the fridge is the only thing still running
  pl(0x5a708e,.7,7,14.2,2.0,6.6);                                       // street-glow through a window that is not there
  pl(0xd09858,.5,4,2.6,1.2,7.6);                                        // 8001 bedroom: light under the wardrobe door
  { const mat=box(.7,.02,.45,lam(0x3a3028)); mat.position.set(16.95,.012,1.72); scene.add(mat); }   // 8007's doormat, a year unmoved
});

/* institutional corridor: two-tone wall with a dado rail on the blank side, and downstand beams */
function corridorTrim(zone,x0,x1,z,ceil,paint){
  // leave the wall alone wherever a door stands in it
  const gaps=[]; zoneGroups[zone].traverse(o=>{ if(o.userData.isDoor&&Math.abs(o.position.z-z)<.4&&Math.abs(o.rotation.y)<.2)gaps.push([o.position.x-.2,o.position.x+1.1]); });
  gaps.sort((p,q)=>p[0]-q[0]); const segs=[]; let cur=x0;
  for(const [g0,g1] of gaps){ if(g0>cur)segs.push([cur,Math.min(g0,x1)]); cur=Math.max(cur,g1); } if(cur<x1)segs.push([cur,x1]);
  for(const [s0,s1] of segs){ const len=s1-s0, mx=(s0+s1)/2; if(len<.15)continue;
    const lower=box(len,1.0,.02,lam(paint)); lower.position.set(mx,.5,z+.095); scene.add(lower);
    const rail=box(len,.07,.05,M.woodDark); rail.position.set(mx,1.03,z+.11); scene.add(rail);
    const skirt=box(len,.14,.04,M.woodDark); skirt.position.set(mx,.07,z+.105); scene.add(skirt); }
  for(let x=x0+1.6;x<x1-.6;x+=2.9){ const b=box(.22,.16,2.04,lam(0x8a8c84)); b.position.set(x,ceil-.08,z+1.1); scene.add(b); } }
inZone("floor8",()=>corridorTrim("floor8",.3,17.9,0,HH,0x4a5a54));
inZone("floor21",()=>corridorTrim("floor21",600.3,617.9,0,3.0,0x5a5248));

/* ── 5 · LOBBY: a double-height hall that was grand once — columns, a gallery of dead windows, a waiting area ── */
inZone("lobbyG",()=>{ const ox=200, C=4.7;
  const fx=fixturesOf("lobbyG"); fx.forEach((f,i)=>{ f.userData.light.intensity=1.0; f.userData.light.distance=11;
    for(const a of[-.5,.5]){ const rd=box(.02,C-3.36,.02,M.black); rd.position.set(f.position.x+a,3.35+(C-3.36)/2,f.position.z); scene.add(rd); } });   // tubes hang on rods now the ceiling is up there
  pl(0xe0a860,.95,5,ox+8.8,1.5,3);                                      // behind the reception glass
  pl(0x58c080,.5,3.5,ox+5,2.45,.6); glowPlane(.5,.16,0x3aa868,ox+5,2.5,.2);                 // EXIT, green, over doors that are chained
  wetGround("lobbyG",.3,30);
  // structure: four columns, a coffered ceiling, corner piers, a cornice
  for(const z of[1.5,4.5]){ const b=box(10,.24,.3,lam(0x76786e)); b.position.set(ox+5,C-.12,z); scene.add(b); }
  for(const x of[ox+2.5,ox+5,ox+7.5]){ const b=box(.3,.24,6,lam(0x76786e)); b.position.set(x,C-.12,3); scene.add(b); }
  for(const [x,z] of[[ox+.14,.14],[ox+9.86,.14],[ox+.14,5.86],[ox+9.86,5.86]]){ const c=box(.3,C,.3,surf(TEX.concrete,.3,C,.8)); c.position.set(x,C/2,z); scene.add(c); }
  for(const [x,z] of[[ox+3,1.5],[ox+7,1.5],[ox+3,4.5],[ox+7,4.5]]){ const col=rod(.2,.22,C-.5,10,surf(TEX.concrete,1.3,C,.9,0xb0aa9a)); col.position.set(x,(C-.5)/2+.25,z); scene.add(col); addCollider(x,z,.5,.5);
    const base=box(.56,.25,.56,lam(0x5a584e)); base.position.set(x,.125,z); scene.add(base); const cap=box(.6,.25,.6,lam(0x6a685e)); cap.position.set(x,C-.37,z); scene.add(cap); }
  for(const z of[.1,5.9]){ const cn=box(10,.14,.14,lam(0x5a584e)); cn.position.set(ox+5,3.05,z<1?z+.03:z-.03); scene.add(cn); }
  // gallery level: tall windows onto the street side, rain and sodium behind the glass
  for(const x of[ox+1.5,ox+3.2,ox+6.8,ox+8.5]){ const w=glowPlane(.9,1.2,0x3a4658,x,3.85,.11); const m1=box(.05,1.2,.05,M.woodDark); m1.position.set(x,3.85,.12); scene.add(m1);
    const m2=box(.9,.05,.05,M.woodDark); m2.position.set(x,3.85,.12); scene.add(m2); const fr=box(1.06,1.36,.02,M.woodDark); fr.position.set(x,3.85,.085); scene.add(fr); }
  pl(0x6a7c9a,.6,8,ox+5,3.8,1.2);
  // a dead chandelier, a runner, somewhere to wait, somewhere to leave things
  { const ch=group(); put(ch,box(.02,.9,.02,M.black),0,-.45,0); const rg=new THREE.Mesh(new THREE.TorusGeometry(.55,.03,5,14),M.brass); put(ch,rg,0,-.95,0,Math.PI/2);
    for(let i=0;i<7;i++){ const a=i/7*6.283; put(ch,rod(.03,.045,.14,6,lam(0x3a362c)),Math.cos(a)*.55,-.87,Math.sin(a)*.55); put(ch,box(.012,.4,.012,M.brass),Math.cos(a)*.28,-.72,Math.sin(a)*.28,0,0,0); }
    ch.position.set(ox+5,C,3); scene.add(ch); }
  { const rug=new THREE.Mesh(new THREE.PlaneGeometry(1.6,5.4),surf(TEX.runner,1.6,5.4,1.2)); rug.rotation.x=-Math.PI/2; rug.position.set(ox+5,.012,3); scene.add(rug); }
  { const bn=mkBench(); at(bn,ox+2.7,0,5.5,Math.PI); addCollider(ox+2.7,5.5,1.9,.6);
    const tb=mkTable(.8,.45,.45,M.woodDark); at(tb,ox+2.0,0,4.75); addCollider(ox+2.0,4.75,.8,.45);
    for(let i=0;i<4;i++){ const mg=box(.22,.012,.3,M.paper); mg.position.set(ox+1.85+i*.1,.485+i*.012,4.75); mg.rotation.y=i*.4; scene.add(mg); }
    interact(tb,"Magazines, a year out of date",()=>say(null,"Somebody still squares the stack every morning. Nobody has read one since last autumn.")); }
  { const tr=group(); put(tr,box(.9,.04,.5,M.brass),0,.2,0); for(const [a,b] of[[-.42,-.22],[.42,-.22],[-.42,.22],[.42,.22]]){ put(tr,rod(.015,.015,1.5,5,M.brass),a,.95,b); put(tr,rod(.05,.05,.04,8,M.rubber),a,.05,b,Math.PI/2); }
    put(tr,rod(.015,.015,.86,5,M.brass),0,1.7,-.22,0,0,Math.PI/2); put(tr,rod(.015,.015,.86,5,M.brass),0,1.7,.22,0,0,Math.PI/2);
    put(tr,box(.6,.4,.36,lam(0x4a3a2a)),-.05,.42,0); put(tr,box(.4,.26,.3,lam(0x2a3440)),.1,.75,0,0,.3,0); at(tr,ox+8.7,0,4.6,.5); addCollider(ox+8.7,4.6,1.0,.7); }   // a luggage trolley nobody collected
  { const mat=box(1.6,.015,.9,lam(0x1c1a16)); mat.position.set(ox+5,.014,1.0); scene.add(mat); }
  for(const [x,z] of[[ox+9.4,.6],[ox+9.4,5.4]]){ const pot=rod(.2,.15,.36,8,lam(0x4a3428)); pot.position.set(x,.18,z); scene.add(pot);
    for(let i=0;i<6;i++){ const lf=box(.05,.5+Math.random()*.3,.02,lam(0x2a3420)); lf.position.set(x+(Math.random()-.5)*.14,.6,z+(Math.random()-.5)*.14); lf.rotation.set((Math.random()-.5)*.7,Math.random()*3,(Math.random()-.5)*.7); scene.add(lf); } }   // dead ferns
});

/* ── 6 · ALLEY: a service lane between two tall backs of buildings, open to the weather ── */
inZone("alley",()=>{ const ox=300, S=-3.9, N=5.9;
  mkSky(ox+11,1,{ringY:8,ringH:110,moonX:300});
  const moon=new THREE.DirectionalLight(0x6a7a98,.34); moon.position.set(ox+8,14,-6); moon.target.position.set(ox+11,0,1); scene.add(moon); scene.add(moon.target);
  // the backs of two buildings: seven storeys of kitchen and bathroom windows, a few of them awake
  const dark=new THREE.MeshBasicMaterial({color:0x0a0c10}), warm=new THREE.MeshBasicMaterial({color:0x94743c}), cold=new THREE.MeshBasicMaterial({color:0x4a6680}), sillM=lam(0x44423e);
  let k=0; for(const [z,ry,nz] of[[S,0,1],[N,Math.PI,-1]])for(let r=0;r<7;r++)for(let x=ox+1.6;x<ox+21;x+=2.45){ k++; if(nz<0&&r===0&&x>ox+16&&x<ox+19.5)continue;
    const m=k%6===2?warm:k%10===7?cold:dark, small=k%3===0;
    const w=new THREE.Mesh(new THREE.PlaneGeometry(small?.6:.95,small?.7:1.2),m); w.position.set(x,4.4+r*1.8,z+nz*.012); w.rotation.y=ry; scene.add(w);
    if(r<3){ const sill=box(small?.7:1.05,.06,.12,sillM); sill.position.set(x,3.75+r*1.8+(small?.25:0),z+nz*.04); scene.add(sill); } }
  pl(0xb08848,.55,7,ox+6.5,4.6,S+1); pl(0x6088a8,.5,7,ox+15.5,6.2,N-1);                      // two of those windows reach the ground
  // south side: the back door of a kitchen that is still working, its extractor, its bins
  { const d=mkDoor(null); d.children[0].material=lam(0x38403c); d.position.set(ox+13.2,0,S+.02); scene.add(d); doorTrim(ox+13.65,0,S,0,M.metalDark);
    interact(d,"A kitchen door, propped shut",()=>say(null,"Heat through the steel. Somebody is frying onions for people who are not him. The door has no handle on this side."));
    const lampB=box(.3,.16,.14,M.metalDark); lampB.position.set(ox+13.65,2.55,S+.1); scene.add(lampB); glowPlane(.22,.1,0xf0c070,ox+13.65,2.5,S+.18); pl(0xe0a050,1.15,8,ox+13.65,2.3,S+.9);
    const fan=box(1.1,.9,.5,M.metal); fan.position.set(ox+15.4,2.7,S+.26); scene.add(fan); const gr=box(.9,.7,.04,M.black); gr.position.set(ox+15.4,2.7,S+.53); scene.add(gr);
    const duct=box(.5,9,.5,M.metal); duct.position.set(ox+15.4,7.6,S+.26); scene.add(duct);
    const stT=tex((g,s)=>{ g.clearRect(0,0,s,s); const rr=g.createRadialGradient(s/2,s*.7,6,s/2,s*.45,s*.55); rr.addColorStop(0,"rgba(190,190,180,.5)"); rr.addColorStop(1,"rgba(190,190,180,0)"); g.fillStyle=rr; g.fillRect(0,0,s,s); },128);
    for(let q=0;q<3;q++){ const st=new THREE.Mesh(new THREE.PlaneGeometry(1.1,1.6),new THREE.MeshBasicMaterial({map:stT,transparent:true,depthWrite:false,opacity:.3})); st.position.set(ox+15.4,3.4+q*.6,S+.9); st.rotation.y=q; fxSteams.push(st); scene.add(st); }
    for(let i=0;i<3;i++){ const bin=mkDumpster(); bin.scale.set(.55,.9,.7); at(bin,ox+9.6+i*1.05,0,S+.5,0); } addCollider(ox+10.65,S+.5,3.3,.8);
    for(let i=0;i<5;i++){ const cr=box(.6,.3,.42,lam(i%2?0x3a5a44:0x6a3a2a)); cr.position.set(ox+16.9+(i%2)*.1,.15+((i/2)|0)*.3,S+.5+(i%2)*.44); scene.add(cr); } addCollider(ox+17,S+.7,.8,1.1);
    { const cage=box(.3,.16,.14,M.metalDark); cage.position.set(ox+5,3.1,S+.1); scene.add(cage); glowPlane(.22,.1,0xe0b060,ox+5,3.06,S+.18); pl(0xd09848,.9,7.5,ox+5,2.8,S+.9); } }
  // a second fire escape, a delivery bike, pallets, a skip of builder's rubble
  for(let lv=0;lv<4;lv++){ const y=3.2+lv*3.3; const plat=box(3.2,.07,1.0,M.metalDark); plat.position.set(ox+3.2,y,S+.55); scene.add(plat);
    const rail=box(3.2,.06,.04,M.metalDark); rail.position.set(ox+3.2,y+.95,S+1.03); scene.add(rail);
    for(const rx of[-1.5,-.5,.5,1.5]){ const p2=box(.04,.95,.04,M.metalDark); p2.position.set(ox+3.2+rx,y+.48,S+1.03); scene.add(p2); }
    if(lv<3){ const st=box(2.9,.06,.6,M.metal); st.position.set(ox+3.2,y+1.65,S+.55); st.rotation.z=(lv%2?-1:1)*.86; scene.add(st); } }
  { const bike=mkBicycle(); at(bike,ox+7.2,0,S+.45,.1); const boxB=box(.5,.4,.4,lam(0x7a2a22)); boxB.position.set(ox+6.75,.95,S+.45); scene.add(boxB); addCollider(ox+7.2,S+.45,1.7,.5); }
  { const skip=group(); const sk=lam(0x3a3c34); put(skip,box(3.0,.9,1.6,sk),0,.6,0); put(skip,box(3.4,.1,1.7,lam(0x2c2e28)),0,1.08,0); put(skip,box(2.8,.3,1.4,lam(0x4a4640)),0,1.05,0,0,0,.05);
    for(let i=0;i<5;i++)put(skip,box(.5+Math.random()*.6,.12,.12,M.woodDark),-.9+i*.45,1.3,(Math.random()-.5)*.8,0,Math.random()*3,.3); at(skip,ox+12.4,0,4.9,0); addCollider(ox+12.4,4.9,3.5,1.8); }
  for(const [x,z,rr] of[[ox+2.4,-2.6,.3],[ox+18.6,2.2,1.2]]){ const pal=box(1.2,.14,1.0,M.woodDark); pal.position.set(x,.07,z); pal.rotation.y=rr; scene.add(pal);
    const pal2=box(1.2,.14,1.0,M.woodDark); pal2.position.set(x+.05,.21,z+.04); pal2.rotation.y=rr+.2; scene.add(pal2); }
  // the lane itself: a centre drain, cobble setts either side of it, standing water that shows the neon
  { const ch=box(21,.012,.4,lam(0x14161a)); ch.position.set(ox+11,.012,1); scene.add(ch);
    for(let x=ox+1;x<ox+21;x+=2.6){ const gt=box(.5,.014,.4,M.black); gt.position.set(x,.016,1); scene.add(gt); }
    for(const [x,z,w,d] of[[ox+8,0,3.4,1.6],[ox+16,2.4,2.8,1.2],[ox+4.6,2.2,2.2,1.0]]){ const pd=new THREE.Mesh(new THREE.PlaneGeometry(w,d),wetMat(lam(0x10141a,{transparent:true,opacity:.75}),1,90)); pd.rotation.x=-Math.PI/2; pd.position.set(x,.014,z); scene.add(pd); } }
  for(let i=0;i<4;i++){ const y=6+i*2.6, x=ox+6+i*3.6; const line=box(.02,.02,9.8,M.black); line.position.set(x,y,1); scene.add(line);                // washing left out in the rain
    for(let j=0;j<4;j++){ const cl=box(.5,.6+((i+j)%3)*.2,.02,lam([0x5a5a54,0x4a3a3a,0x3a444a][(i+j)%3])); cl.position.set(x,y-.35,-2.2+j*1.9); cl.rotation.y=Math.PI/2; scene.add(cl); } }
  pl(0xd85a70,.75,8,ox+19.5,2.2,1.5);                                   // the neon reaches the wet ground
});

/* ── 7 · RESTOCK ROOM: a caretaker's store, dead; then the same room, grown over ── */
inZone("restock",()=>{ const ox=400;
  pl(0x4a6484,1.3,10,ox+5,3.4,1.0); pl(0x4a6484,.7,9,ox+5,3.4,6.5);                                       // grey leak from a ventilation slot
  glowPlane(1.6,.3,0x2c3a4c,ox+5,3.7,.1);
  for(const z of[1.2,6.8])for(let i=0;i<3;i++)for(let k=0;k<5;k++){ if((i*5+k+z|0)%3===0)continue;   // what a caretaker keeps
    const t=(i*7+k*3)%4, x=ox+1.4+k*.5;
    const it=t===0?rod(.07,.07,.2,8,lam(0x5a6a5a)):t===1?box(.22,.16,.3,M.cardboard):t===2?rod(.09,.09,.26,8,lam(0x6a2a20)):box(.3,.1,.22,lam(0x3a4650));
    it.position.set(x,.53+i*.7+(t===0?.1:t===1?.08:t===2?.13:.05),z+(k%2?.06:-.05)); genSet.add(it); }
  { const drum=rod(.3,.3,.9,12,lam(0x2c3c50)); drum.position.set(ox+8.9,.45,1.2); genSet.add(drum); addCollider(ox+8.9,1.2,.65,.65);
    for(const y of[.25,.65]){ const hoop=rod(.31,.31,.03,12,M.metalDark); hoop.position.set(ox+8.9,y,1.2); genSet.add(hoop); } }
  { const fuse=box(.08,.6,.45,M.metalDark); fuse.position.set(ox+9.86,1.5,5.2); genSet.add(fuse);
    const cable=box(.03,1.5,.03,M.black); cable.position.set(ox+9.88,.75,4.6); genSet.add(cable); }
  { const cord=box(.012,1.5,.012,M.black); cord.position.set(ox+5,3.52,4); scene.add(cord); }
  // headroom, and the things a building accumulates in it: high racking, a ladder, a hoist beam, ducting
  for(const z of[.5,7.5])for(const x of[ox+7.2]){ for(let i=0;i<4;i++){ const sh=box(2.4,.05,.6,M.woodDark); sh.position.set(x,.6+i*.95,z); genSet.add(sh);
      for(let q=0;q<3;q++){ if((i+q)%4===0)continue; const b=box(.55,.4+((i*q)%3)*.12,.45,(i+q)%2?M.cardboard:lam(0x4a4034)); b.position.set(x-.8+q*.8,.63+i*.95+b.geometry.parameters.height/2,z); b.rotation.y=(q-1)*.15; genSet.add(b); } }
    for(const px of[-1.18,1.18]){ const up=box(.06,3.7,.06,M.metalDark); up.position.set(x+px,1.85,z); genSet.add(up); } addCollider(x,z,2.6,.7); }
  { const beam=box(10,.24,.2,M.metalDark); beam.position.set(ox+5,4.0,4); scene.add(beam); const hook=box(.04,.7,.04,M.metal); hook.position.set(ox+3,3.55,4); scene.add(hook);
    const blk=box(.2,.24,.14,M.metalDark); blk.position.set(ox+3,3.85,4); scene.add(blk); const hk=new THREE.Mesh(new THREE.TorusGeometry(.07,.02,5,8,4.2),M.metal); hk.position.set(ox+3,3.14,4); scene.add(hk); }
  { const duct=box(.6,.5,8,M.metal); duct.position.set(ox+.5,3.8,4); scene.add(duct); for(let z=.8;z<8;z+=1.6){ const st=box(.64,.54,.05,M.metalDark); st.position.set(ox+.5,3.8,z); scene.add(st); } }
  { const lad=group(); for(const a of[-.22,.22])put(lad,box(.05,3.2,.05,M.woodPale),a,1.6,0); for(let i=0;i<9;i++)put(lad,box(.44,.035,.05,M.woodPale),0,.3+i*.33,0); lad.position.set(ox+5.9,0,.22); lad.rotation.x=.14; genSet.add(lad); }
  for(const [x,z] of[[ox+2.6,4],[ox+3.4,3.3]]){ const pal=box(1.1,.14,.9,M.woodDark); pal.position.set(x,.07,z); pal.rotation.y=x; genSet.add(pal);
    const sk=box(.8,.2,.5,lam(0x6a6458)); sk.position.set(x,.24,z); sk.rotation.y=x+.25; genSet.add(sk); }
  // grown-over state: roots, standing water, a green that was not here before
  { const g=pl(0x5a8a50,0,7,ox+2,1.2,6.5); mossSet.add(g); g.intensity=.7; mossSet.userData.fill=g;
    for(let i=0;i<9;i++){ const r=box(.04,1.2+Math.random()*1.2,.04,lam(0x2a3220)); r.position.set(ox+.6+Math.random()*8.8,4.3-(r.geometry.parameters.height/2),.3+Math.random()*7.4); r.scale.y=1.5; r.position.y=4.3-r.geometry.parameters.height*.75; r.rotation.z=(Math.random()-.5)*.25; mossSet.add(r); }
    const pool=new THREE.Mesh(new THREE.PlaneGeometry(3.2,2.2),wetMat(lam(0x141c18,{transparent:true,opacity:.8}),1,80)); pool.rotation.x=-Math.PI/2; pool.position.set(ox+5.2,.012,6.9); mossSet.add(pool); }
});

/* ── 8 · THE CHASE: every door is the same door ── */
inZone("dream2",()=>{ const ox=502;
  wetGround("dream2",.5,40);
  const far=pl(0x7a94b8,1.5,16,ox,1.5,1.4); fxPulse.push({light:far,base:1.5,amp:.5,speed:.9,phase:0});   // she is always walking into the light
  for(let z=6.5;z<44;z+=6){ const d=mkDoor(plateTex("8007")); d.position.set(ox+1.5,0,z+.45); d.rotation.y=-Math.PI/2; scene.add(d);
    const fr=box(.1,2.2,1.1,M.woodDark); fr.position.set(ox+1.55,1.1,z); scene.add(fr);
    const leak=glowPlane(.86,.03,0xc89850,ox+1.44,.03,z,-Math.PI/2); leak.material.transparent=true; leak.material.opacity=.7; }
  for(let z=3;z<46;z+=3){ const b=box(3.2,.12,.12,M.woodDark); b.position.set(ox,2.54,z); scene.add(b); }
  for(let z=7;z<44;z+=12)pl(0xc89858,.5,5,ox+1.2,.4,z);
});

/* ── 9 · 21ST FLOOR: other people's lives, under their doors ── */
inZone("floor21",()=>{ const ox=600;
  for(const x of[ox+3.4,ox+8.2,ox+12.6]){ const lk=glowPlane(.84,.03,0xd0a058,x,.025,2.2+.001,Math.PI); lk.material.side=THREE.DoubleSide;
    lk.rotation.x=-Math.PI/2; lk.position.set(x,.012,2.05); pl(0xd0a058,.35,2.6,x,.3,1.8); }
  pl(0x6a86b0,.5,6,ox+16.6,2.6,4.8);                                    // night coming down the stairwell from the roof
});

/* ── 10 · TERRACE: twenty-one floors up, the whole city laid out and none of it his ── */
inZone("terrace",()=>{ const ox=700;
  mkSky(ox+10,7,{ringY:-58,ringH:100,ringR:200,moonX:420,moonY:96});
  const moon=new THREE.DirectionalLight(0x7088b4,.55); moon.position.set(ox+2,12,-4); moon.target.position.set(ox+10,0,7); scene.add(moon); scene.add(moon.target);
  wetGround("terrace",.55,34);
  pl(0xc88848,.5,9,ox+10,1.2,13.2);                                     // the city's glow coming over the parapet
  // the streets, far below: a grid of sodium and moving headlights you only see by going to the edge
  { const c=document.createElement("canvas"); c.width=c.height=512; const g=c.getContext("2d"); g.fillStyle="#05060a"; g.fillRect(0,0,512,512);
    for(let i=0;i<9;i++){ const p=20+i*58+((i*13)%9); g.fillStyle="rgba(120,84,40,.5)"; g.fillRect(p,0,7,512); g.fillRect(0,p,512,7);
      for(let q=0;q<512;q+=13){ g.fillStyle=(q+i)%3?"#f0b050":"#ffe0a0"; g.fillRect(p+2,q,2,2); g.fillRect(q,p+2,2,2); }
      for(let q=0;q<10;q++){ g.fillStyle=q%2?"#ff5040":"#fff6e0"; g.fillRect(p+(q%2?1:5),(q*53+i*31)%512,2,3); g.fillRect((q*47+i*17)%512,p+(q%2?1:5),3,2); } }
    for(let i=0;i<500;i++){ g.fillStyle=["#e8b860","#9cc4dc","#e06a50","#70d090"][i%4]; g.globalAlpha=.25+Math.random()*.6; g.fillRect(Math.random()*512,Math.random()*512,2,2); } g.globalAlpha=1;
    const t=new THREE.CanvasTexture(c); t.magFilter=THREE.NearestFilter; t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(2,2);
    const city=new THREE.Mesh(new THREE.PlaneGeometry(520,520),new THREE.MeshBasicMaterial({map:t,fog:false})); city.rotation.x=-Math.PI/2; city.position.set(ox+10,-62,7); scene.add(city); }
  // near neighbours: lower roofs with their own tanks, plant and lit top floors, close enough to read
  { const fac=tex((g,s)=>{ g.fillStyle="#0c0c0e"; g.fillRect(0,0,s,s); for(let r=0;r<9;r++)for(let c=0;c<7;c++){ const v=(r*31+c*17)%11; g.fillStyle=v<2?"#d0a458":v===5?"#8ab0cc":"#06070a"; g.fillRect(5+c*18,5+r*13.6,11,8); } },128);
    for(const [x,z,w,d,top] of[[ox-16,2,14,12,-5],[ox+10,-16,16,10,-9],[ox+37,9,12,16,-3],[ox+12,31,20,11,-12],[ox-13,24,10,10,-16],[ox+36,-10,10,9,4]]){
      const t=fac.clone(); t.needsUpdate=true; t.repeat.set(w/8,6); const side=new THREE.MeshBasicMaterial({map:t,fog:false}), roof=lam(0x1a1c20);
      const b=new THREE.Mesh(new THREE.BoxGeometry(w,60,d),[side,side,roof,roof,side,side]); b.position.set(x,top-30,z); scene.add(b);
      const tk=rod(1.3,1.3,2.2,10,lam(0x2a2e34)); tk.position.set(x+w*.2,top+2.3,z-d*.15); scene.add(tk); for(const [a,c2] of[[-1,-1],[1,-1],[-1,1],[1,1]]){ const lg=box(.12,1.3,.12,M.metalDark); lg.position.set(x+w*.2+a*.9,top+.65,z-d*.15+c2*.9); scene.add(lg); }
      const hut=box(3,2.4,2.6,lam(0x26282c)); hut.position.set(x-w*.2,top+1.2,z+d*.1); scene.add(hut); glowPlane(.7,1.1,0xd0a050,x-w*.2,top+1.0,z+d*.1+1.31);
      const bc=new THREE.Mesh(new THREE.SphereGeometry(.22,6,5),new THREE.MeshBasicMaterial({color:0xe03028,fog:false})); bc.position.set(x+w*.2,top+3.6,z-d*.15); fxBeacons.push(bc); scene.add(bc); } }
  // a hoarding on the next roof, its neon half gone, colouring the rain
  { const g=group(); for(const a of[-3,0,3]){ put(g,box(.14,6,.14,M.metalDark),a,3,0); put(g,box(.1,4.6,.1,M.metalDark),a,2.2,-1.2,.5); }
    put(g,box(7.4,3,.16,lam(0x101216)),0,5,0);
    const sg=new THREE.Mesh(new THREE.PlaneGeometry(7,2.6),new THREE.MeshBasicMaterial({fog:false,map:tex((c,s)=>{ c.fillStyle="#0a0c10"; c.fillRect(0,0,s,s); c.font="bold 64px Courier New"; c.textAlign="center";
      c.shadowColor="#40c8d8"; c.shadowBlur=18; c.fillStyle="#70e0f0"; c.fillText("MERI",s*.33,s*.55); c.shadowBlur=0; c.fillStyle="rgba(40,90,100,.7)"; c.fillText("DIAN",s*.73,s*.55);
      c.shadowColor="#e06080"; c.shadowBlur=12; c.fillStyle="#f08098"; c.font="bold 26px Courier New"; c.fillText("NEVER  CLOSES",s/2,s*.8); },256)}));
    sg.material.map.repeat.set(1,.5); sg.material.map.offset.set(0,.12); put(g,sg,0,5,.1); g.position.set(ox-10,-5,5); g.rotation.y=Math.PI/2+.25; scene.add(g);
    const nl=pl(0x48c8d8,.9,16,ox+.5,2.6,5); fxPulse.push({light:nl,base:.75,amp:.2,speed:7,phase:0}); }
  // on this roof: coping, skylights with flats still awake under them, vents breathing, standing water
  for(const [x0,x1,z] of[[ox,ox+20,.15],[ox,ox+20,13.85]]){ const cp=box(x1-x0,.08,.42,lam(0x6a6a62)); cp.position.set((x0+x1)/2,1.14,z); scene.add(cp); }
  for(const [z0,z1,x] of[[0,14,ox+.15],[0,14,ox+19.85]]){ const cp=box(.42,.08,z1-z0,lam(0x6a6a62)); cp.position.set(x,1.14,(z0+z1)/2); scene.add(cp); }
  for(const [x,z,on] of[[ox+5.2,11.2,true],[ox+7.6,11.2,false],[ox+13.6,4.6,true]]){ const cb=box(1.5,.4,1.1,lam(0x3a3c3e)); cb.position.set(x,.2,z); scene.add(cb); addCollider(x,z,1.5,1.1);
    const gl=new THREE.Mesh(new THREE.PlaneGeometry(1.3,.9),new THREE.MeshBasicMaterial({color:on?0xb89048:0x0c0e12})); gl.rotation.x=-Math.PI/2+.12; gl.position.set(x,.46,z); scene.add(gl);
    for(const a of[-.33,.33]){ const m=box(.03,.03,.94,M.metalDark); m.position.set(x+a,.47,z); m.rotation.x=.12; scene.add(m); } if(on)pl(0xd0a050,.6,4.5,x,1.0,z); }
  { const stT=tex((g,s)=>{ g.clearRect(0,0,s,s); const rr=g.createRadialGradient(s/2,s*.7,6,s/2,s*.45,s*.55); rr.addColorStop(0,"rgba(180,186,196,.5)"); rr.addColorStop(1,"rgba(180,186,196,0)"); g.fillStyle=rr; g.fillRect(0,0,s,s); },128);
    for(const [x,z] of[[ox+18.2,10.4],[ox+3.2,2.2]]){ const v=rod(.22,.26,1.3,8,M.metal); v.position.set(x,.65,z); scene.add(v); const cap=rod(.34,.3,.14,8,M.metalDark); cap.position.set(x,1.4,z); scene.add(cap); addCollider(x,z,.6,.6);
      for(let q=0;q<3;q++){ const st=new THREE.Mesh(new THREE.PlaneGeometry(1.2,1.8),new THREE.MeshBasicMaterial({map:stT,transparent:true,depthWrite:false,opacity:.3})); st.position.set(x,2.2+q*.7,z); st.rotation.y=q*1.1; fxSteams.push(st); scene.add(st); } } }
  for(const [x,z,w,d] of[[ox+6,5,3.2,1.6],[ox+12.4,9.8,2.6,1.4],[ox+16.4,6.2,2.2,1.8]]){ const pd=new THREE.Mesh(new THREE.PlaneGeometry(w,d),wetMat(lam(0x0e1218,{transparent:true,opacity:.8}),1,90)); pd.rotation.x=-Math.PI/2; pd.position.set(x,.012,z); scene.add(pd); }
  // where they sat: the bench, two folding chairs, a crate for a table, the lights she strung, a lantern
  { const bn=mkBench(); at(bn,ox+10,0,9.2,0); addCollider(ox+10,9.2,1.9,.6);
    interact(bn,"A bench, facing the city",()=>say(null,"Two dents in the slats, side by side. Rain has not filled them in."));
    for(const [x,ry] of[[ox+8.2,.5],[ox+11.9,-.4]]){ const ch=mkChair(); at(ch,x,0,10.4,Math.PI+ry); addCollider(x,10.4,.5,.5); }
    const cr=mkCrate24(); cr.scale.set(.8,.7,.8); at(cr,ox+10,0,10.6,.3); addCollider(ox+10,10.6,.55,.55);
    const lan=group(); put(lan,box(.14,.2,.14,M.metalDark),0,.1,0); put(lan,box(.1,.14,.1,new THREE.MeshBasicMaterial({color:0xf0c070})),0,.1,0); put(lan,box(.18,.03,.18,M.metalDark),0,.215,0); lan.position.set(ox+10,.43,10.6); scene.add(lan);
    pl(0xf0b860,.75,5,ox+10,.9,10.4);
    for(const [bx,bz] of[[ox+9.7,10.3],[ox+10.3,10.8]]){ const bt=rod(.035,.04,.22,6,lam(0x2a4030)); bt.position.set(bx,.5,bz); scene.add(bt); } }
  for(const z of[8,11.6])for(let i=0;i<12;i++){ const t=i/11, x=ox+4+t*12, y=2.5-Math.sin(t*Math.PI)*.5, on=(i+(z>9?1:0))%3!==1;
    const b=new THREE.Mesh(new THREE.SphereGeometry(.045,6,5),new THREE.MeshBasicMaterial({color:on?0xf0c070:0x2a2620})); b.position.set(x,y,z); scene.add(b);
    if(i<11){ const w=box(1.12,.012,.012,M.black); w.position.set(x+.545,y-(Math.sin((t+1/22)*Math.PI)-Math.sin(t*Math.PI))*.25,z); scene.add(w); }
    if(on&&i%6===0&&z<9)pl(0xe0a858,.5,4.5,x,y-.2,z); }
  for(const z of[8,11.6])for(const x of[ox+4,ox+16]){ const p=rod(.035,.045,2.6,6,M.metalDark); p.position.set(x,1.3,z); scene.add(p); addCollider(x,z,.2,.2); }
  // ── THE LEDGE: always there, in the corner where the parapet turns; it only wakes when the song has played ──
  { const lx=LEDGE.x, stone=surf(TEX.concrete,1.8,1,.8,0x9a968c);
    const slab=box(1.9,.14,1.25,stone); slab.position.set(lx,1.21,14.15); scene.add(slab);                       // a wide flat stone, proud of the wall on both sides
    for(const sx of[-1.05,1.05]){ const pier=box(.3,1.6,.5,surf(TEX.brickExt,.5,1.6,.5)); pier.position.set(lx+sx,.8,13.85); scene.add(pier); const cap=box(.4,.08,.6,lam(0x6a6a62)); cap.position.set(lx+sx,1.64,13.85); scene.add(cap); }
    for(const [y,z,d] of[[.2,13.15,.5],[.55,13.42,.36]]){ const st=box(1.2,y<.3?.4:.3,d,stone); st.position.set(lx,y,z); scene.add(st); }   // two worn steps up
    const blanket=box(1.2,.05,.7,lam(0x5a2a2a)); blanket.position.set(lx-.1,1.305,14.0); blanket.rotation.y=.08; scene.add(blanket);
    for(const sx of[-.45,.3]){ const cup=rod(.04,.035,.09,8,lam(0xb8b0a0)); cup.position.set(lx+sx,1.36,14.3); scene.add(cup); }
    const lan=group(); put(lan,box(.16,.04,.16,M.metalDark),0,.02,0); const flame=put(lan,box(.11,.18,.11,new THREE.MeshBasicMaterial({color:0x2a2620})),0,.13,0); put(lan,box(.18,.03,.18,M.metalDark),0,.235,0);
    put(lan,new THREE.Mesh(new THREE.TorusGeometry(.07,.008,4,8,Math.PI),M.metalDark),0,.25,0); lan.position.set(lx+.75,1.28,13.95); scene.add(lan);
    const l=pl(0xf0b860,0,7,lx+.5,1.9,13.5);
    const beam=new THREE.Mesh(new THREE.ConeGeometry(1.6,5,12,1,true),new THREE.MeshBasicMaterial({color:0xf0b860,transparent:true,opacity:.05,blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,fog:false}));
    beam.position.set(lx,3.2,13.9); beam.visible=false; scene.add(beam); ledgeLamp={l,m:flame,beam}; }
  // cables from the music box to each chime, so the roof explains its own puzzle
  { const cm=lam(0x7a6630), run=(x0,z0,x1,z1)=>{ const a=box(Math.abs(x1-x0)+.05,.025,.05,cm); a.position.set((x0+x1)/2,.014,z0); scene.add(a); const b2=box(.05,.025,Math.abs(z1-z0)+.05,cm); b2.position.set(x1,.014,(z0+z1)/2); scene.add(b2); };
    run(ox+10,6.6,ox+6,.4); run(ox+10,7.0,ox+.9,5.78); run(ox+10.3,6.8,ox+15.6,3.3); run(ox+10.3,7.2,ox+17.5,13.5);
    const riser=(x,z,h)=>{ const r=box(.05,h,.05,cm); r.position.set(x,h/2,z); scene.add(r); }; riser(ox+6,.36,1.0); riser(ox+17.5,13.52,1.0); riser(ox+15.6,3.3,1.4);
    const jb=box(.3,.08,.3,M.metalDark); jb.position.set(ox+10.15,.04,6.9); scene.add(jb); }
  // the three valves share a manifold that runs to the tank, so it is clear what they feed
  { const mf=box(6.4,.1,.1,M.metal); mf.position.set(ox+11.2,.2,.75); scene.add(mf); const up=box(.1,.1,1.6,M.metal); up.position.set(ox+14.4,.2,1.5); scene.add(up);
    const rise=box(.1,1.3,.1,M.metal); rise.position.set(ox+15.7,.65,2.3); scene.add(rise); const inl=box(1.3,.1,.1,M.metal); inl.position.set(ox+15.05,.2,2.3); scene.add(inl);
    const plq=decal(tex((g,s)=>{ g.fillStyle="#2a2620"; g.fillRect(0,0,s,s); g.fillStyle="#c8b878"; g.font="bold 30px Courier New"; g.textAlign="center"; g.fillText("TANK FILL",s/2,s/2-4); g.font="18px Courier New"; g.fillText("OPEN IN ORDER",s/2,s/2+24); },256),.8,.4);
    plq.material.map.repeat.set(1,.5); plq.material.map.offset.set(0,.25); plq.position.set(ox+10.5,1.75,.31); scene.add(plq); }
  // a mast with a working beacon, guyed down; and a dish pointed at nothing
  { const mx=ox+18.4, mz=1.4; const m=rod(.05,.08,7,6,M.metalDark); m.position.set(mx,3.5,mz); scene.add(m); addCollider(mx,mz,.3,.3);
    for(let i=0;i<4;i++){ const cr=box(1.1-i*.2,.04,.04,M.metalDark); cr.position.set(mx,3.6+i*.8,mz); cr.rotation.y=i*.8; scene.add(cr); }
    const bc=new THREE.Mesh(new THREE.SphereGeometry(.12,6,5),new THREE.MeshBasicMaterial({color:0xe03028})); bc.position.set(mx,7.1,mz); fxBeacons.push(bc); scene.add(bc);
    const dish=new THREE.Mesh(new THREE.SphereGeometry(.5,10,6,0,6.3,0,1.0),lam(0x8a8c88,{side:THREE.DoubleSide})); dish.position.set(ox+2.6,1.9,12.8); dish.rotation.set(1.1,0,.6); scene.add(dish);
    const arm=rod(.03,.03,1.4,5,M.metalDark); arm.position.set(ox+2.6,1.2,12.8); scene.add(arm); }
});

/* ── 11 · METRO: the train brings its own light ── */
inZone("metro",()=>{ const ox=800;
  wetGround("metro",.3,24);
  // a real track bed: ballast, sleepers, two running rails and a third rail under a guard board
  { const bal=box(28,.1,3.6,lam(0x1c1c1e)); bal.position.set(ox+14,-.76,8); scene.add(bal);
    for(let x=ox+.4;x<ox+28;x+=.7){ const sl=box(.24,.08,2.6,lam(0x2a221a)); sl.position.set(x,-.68,8); scene.add(sl); }
    for(const z of[7.28,8.72]){ const r=box(28,.12,.07,M.chrome); r.position.set(ox+14,-.6,z); scene.add(r); }
    const third=box(28,.08,.08,M.metalDark); third.position.set(ox+14,-.52,9.5); scene.add(third);
    const guard=box(28,.03,.22,lam(0x4a3a20)); guard.position.set(ox+14,-.44,9.5); scene.add(guard);
    const face=box(28,.84,.08,surf(TEX.concrete,28,.84,1,0x6a6a66)); face.position.set(ox+14,-.4,6.12); scene.add(face);      // platform face
    const cop=box(28,.07,.34,lam(0x8a8c86)); cop.position.set(ox+14,.036,5.84); scene.add(cop); }
  for(let x=ox+2;x<ox+28;x+=3.6){ const b=box(.3,.26,6,lam(0x6a6e6a)); b.position.set(x,3.07,3); scene.add(b); }
  for(const cx of[-9,0,9]){ const L=new THREE.PointLight(0xe0c890,.85,6,1.5); L.position.set(cx,1.9,-.2); trainGrp.add(L); }
  { const hl=new THREE.SpotLight(0xf0e8c8,2.2,26,.5,.6,1.3); hl.position.set(-13.4,1.3,0); hl.target.position.set(-24,1.0,-.6); trainGrp.add(hl); trainGrp.add(hl.target);
  }
  pl(0x3a5a78,.6,10,ox+27,1.6,8);                                       // the tunnel mouth breathes cold
});

/* The hand-placed lights in the zone builds were tuned by eye against vertex
   lighting, where most of their output never reached a surface. Under per-pixel
   lighting they need more reach and a softer falloff to make the pools they
   were always meant to. The prop factories above are already tuned (decay<=1.5). */
scene.traverse(o=>{ if(o.isPointLight&&o.decay>1.55){ o.intensity*=1.7; o.distance*=1.35; o.decay=1.5; } });

/* floor 8 is the one level where rooms share walls: the corridor and the two flats */
LIGHT_ROOMS.floor8=[[-.1,18.1,-.1,2.2],[-.1,9.0,2.2,9.3],[9.0,18.1,2.2,9.3]];
for(const zn in LIGHT_ROOMS){ zoneGroups[zn].updateMatrixWorld(true); const v=new THREE.Vector3();
  zoneGroups[zn].traverse(o=>{ if(!o.isPointLight)return; o.getWorldPosition(v);
    o.userData.room=LIGHT_ROOMS[zn].find(r=>v.x>=r[0]&&v.x<=r[1]&&v.z>=r[2]&&v.z<=r[3])||null; }); }

/* everything lit can receive the torch's shadow; everything lit and solid can cast one */
scene.traverse(o=>{ if(o.isMesh&&o.material&&o.material.isMeshPhongMaterial){ o.receiveShadow=true; if(!o.material.transparent)o.castShadow=true; } });

/* after all builds: runtime scene.add goes to scene root */
ZONE=null;

/* ---------------- DEBUG MENU ---------------- */
const DEBUG_ENABLED=new URLSearchParams(location.search).has("debug");
if(!DEBUG_ENABLED)$("dbgToggle").style.display="none";
const DBG={open:false,noclip:false,speed:1,infBatt:false,freezeDread:false,fullbright:false,raw:false,showCol:false,hud:false};
const dbgAmb=new THREE.AmbientLight(0xffffff,0); scene.add(dbgAmb);
let colGroup=null;
function dbgBtn(id,fn){ $(id).onclick=fn; }
function dbgFlag(id,key,lbl,after){ dbgBtn(id,()=>{ DBG[key]=!DBG[key];
  $(id).textContent=lbl+": "+(DBG[key]?"ON":"OFF"); $(id).classList.toggle("on",DBG[key]); after&&after(); }); }
function toggleDebug(){ DBG.open=!DBG.open; $("dbgPanel").classList.toggle("show",DBG.open);
  if(DBG.open){ uiOpen="debug"; document.exitPointerLock?.(); }
  else if(uiOpen==="debug"){ uiOpen=null; relock(); } }
function dbgEnsureRunning(){ if(!running&&$("title").style.display!=="none"){ beginGame(); } if(ride.active)finishRide(); }
function dbgSkipIntro(){
  dbgEnsureRunning();
  GS.dream1Done=true; setZone("floor8");
  player.seated=false; canStand=true; player.x=2.35; player.z=5.55; player.yaw=-1.34; player.pitch=0;
  ringing=false; try{AU.ringStop();}catch(e){}
  phoneAnswered=true; door8001Open=true; c8001.on=false;
  setObjective("Leave <b>flat 8001</b>. Her old flat is <b>8007</b>.");
  toast("DEBUG: intro skipped");
}
dbgFlag("dbNoclip","noclip","Noclip");
dbgFlag("dbInfBatt","infBatt","∞ Battery");
dbgFlag("dbFreeze","freezeDread","Freeze dread");
dbgFlag("dbHud","hud","HUD",()=>{ $("dbgHud").style.display=DBG.hud?"block":"none"; });
dbgFlag("dbBright","fullbright","Fullbright",()=>{ dbgAmb.intensity=DBG.fullbright?1.6:0; });
dbgBtn("dbRaw",()=>{ DBG.raw=!DBG.raw; $("dbRaw").textContent="PS2 FX: "+(DBG.raw?"OFF":"ON"); $("dbRaw").classList.toggle("on",DBG.raw); });
dbgFlag("dbCol","showCol","Colliders",()=>{
  if(DBG.showCol){ colGroup=new THREE.Group();
    for(const c of colliders){ const w=c.maxX-c.minX,d=c.maxZ-c.minZ;
      const m=new THREE.Mesh(new THREE.BoxGeometry(w,1.6,d),new THREE.MeshBasicMaterial({color:c.on?0xff4040:0x606060,wireframe:true}));
      m.position.set((c.minX+c.maxX)/2,.8,(c.minZ+c.maxZ)/2); m.userData.col=c; colGroup.add(m); }
    scene.add(colGroup); }
  else if(colGroup){ scene.remove(colGroup); colGroup=null; } });
$("dbSpd").oninput=e=>{ DBG.speed=+e.target.value; $("dbSpdV").textContent=DBG.speed.toFixed(1); };
$("dbDread").oninput=e=>{ dread=+e.target.value; $("dbDreadV").textContent=dread.toFixed(2); };
dbgBtn("dbBatt",()=>{ battery=100; toast("DEBUG: battery 100%"); });
$("dbgToggle").onclick=()=>{ if(!uiOpen||uiOpen==="debug")toggleDebug(); };
dbgBtn("dbOpen7",()=>{ dbgEnsureRunning(); door8007Open=true; c8007.on=false; toast("DEBUG: 8007 opened"); });
dbgBtn("dbSolve",()=>{ dbgEnsureRunning(); solvePuzzle(); toast("DEBUG: puzzle 1 solved"); });
dbgBtn("dbGen",()=>{ dbgEnsureRunning();
  if(!inv.has("key_restock"))give("key_restock","🗝","RESTOCK");
  GS.restockUnlocked=true; GS.generatorOn=true; try{AU.sting();}catch(e){}
  fadeTo(()=>startChase(),400); toast("DEBUG: chase"); });
dbgBtn("dbBoxes",()=>{ dbgEnsureRunning();
  if(!GS.boxPhase){ genSet.visible=false; mossSet.visible=true; mossSet.userData.light.intensity=1.2; GS.boxPhase=true; }
  GS.boxFound={key:true,piece:true,note:true};
  if(!inv.has("key_terrace"))give("key_terrace","🗝","TERRACE");
  if(!inv.has("piece2"))give("piece2","🧩","PIECE #2");
  collectNote("n_boxes"); GS.alley2=true; GS.elev21=true; GS.elevG=true; if(moonSpr)moonSpr.visible=true;
  toast("DEBUG: box room solved"); });
dbgBtn("dbMusic",()=>{ dbgEnsureRunning(); GS.tankFilled=true; GS.nodeStep=4;
  collectNote("n_order1"); collectNote("n_order2"); solveMusicBox(); toast("DEBUG: music box solved"); });
dbgBtn("dbLedge",()=>{ dbgEnsureRunning();
  if(!inv.has("piece3"))give("piece3","🧩","PIECE #3"); afterPiece3(); toast("DEBUG: ledge shown"); });
dbgBtn("dbEndB",()=>{ dbgEnsureRunning(); GS.ending="B"; GS.photoTaken=true;
  ["photo|🖼|THE PHOTO","piece1|🧩|PIECE #1","piece2|🧩|PIECE #2","piece3|🧩|PIECE #3"].forEach(s=>{
    const [id,ic,lbl]=s.split("|"); if(!inv.has(id))give(id,ic,lbl); });
  GS.elevG=true; GS.elev21=true;
  toast("DEBUG: Ending-B setup — place the photo in the 8001 frame"); });
dbgBtn("dbFigure",()=>{ dbgEnsureRunning(); figureShown=true; figure.visible=true;
  figure.position.set(player.x+Math.sin(player.yaw)*-6,0,player.z+Math.cos(player.yaw)*-6);
  figureT=0; try{AU.drone();}catch(e){} toast("DEBUG: Figure spawned"); });
dbgBtn("dbFinish",()=>{ dbgEnsureRunning(); finishSlice(); });
dbgBtn("dbNotes",()=>{ JOURNAL_ORDER.forEach(collectNote); toast("DEBUG: all notes"); });
dbgBtn("dbItems",()=>{ dbgEnsureRunning();
  piece1.visible=false; keyR.visible=false; ixPiece.enabled=false; ixKey.enabled=false;
  if(!inv.has("piece1"))give("piece1","🧩","PIECE #1");
  if(!inv.has("key_restock"))give("key_restock","🗝","RESTOCK");
  checkObjective(); });
document.querySelectorAll("#dbgPanel [data-tpz]").forEach(b=>{ b.onclick=()=>{
  dbgEnsureRunning(); const p=b.dataset.tpz.split(","); const zn=p[0];
  player.seated=false; canStand=true; setZone(zn);
  player.x=+p[1]; player.z=+p[2]; player.yaw=+p[3]; player.pitch=0;
  toast("DEBUG: teleported → "+b.textContent); }; });
let fpsAcc=0,fpsN=0,fpsShow=0;
function dbgHudTick(dt){ if(!DBG.hud)return;
  fpsAcc+=dt; fpsN++; if(fpsAcc>=.5){ fpsShow=Math.round(fpsN/fpsAcc); fpsAcc=0; fpsN=0; }
  $("dbgHud").textContent=
`FPS   ${fpsShow}
POS   ${player.x.toFixed(2)}, ${player.z.toFixed(2)}
YAW   ${player.yaw.toFixed(2)}  PITCH ${player.pitch.toFixed(2)}
DREAD ${dread.toFixed(2)}   BATT ${battery.toFixed(0)}%
FLAGS ${DBG.noclip?"noclip ":""}${DBG.infBatt?"∞batt ":""}${DBG.fullbright?"bright ":""}${DBG.raw?"rawFX ":""}phase:${player.seated?"seated":phoneAnswered?"post-phone":"pre-phone"}
DOORS 8001:${door8001Open?"open":"shut"} 8007:${door8007Open?"open":"shut"}  PUZZLE:${puzzleSolved?"solved":"—"}`;
}

/* ---------------- Touch controls ----------------
   Built on the first touch: a stick bottom-left, drag anywhere on the picture to look,
   and three buttons. Overlays (notes, dial, lift, pause) already have tappable controls. */
const touch={x:0,y:0,mag:0,on:false,ui:null};
function initTouch(){ if(touch.on)return; touch.on=true; document.documentElement.classList.add("touch");
  const st=document.createElement("style"); st.textContent=`
    html.touch,html.touch body{touch-action:none;overscroll-behavior:none;-webkit-user-select:none;user-select:none}
    #tUI{position:fixed;inset:0;z-index:60;pointer-events:none;font:11px "Courier New",monospace;letter-spacing:2px;color:#b8c4b0}
    #tPad{position:absolute;left:22px;bottom:26px;width:132px;height:132px;border-radius:50%;border:1px solid rgba(184,196,176,.35);background:rgba(10,14,18,.35);pointer-events:auto}
    #tNub{position:absolute;left:41px;top:41px;width:50px;height:50px;border-radius:50%;background:rgba(184,196,176,.4)}
    .tBtn{position:absolute;min-width:74px;height:54px;line-height:54px;text-align:center;border:1px solid rgba(184,196,176,.4);background:rgba(10,14,18,.5);pointer-events:auto}
    #tUse{right:22px;bottom:92px;color:#e8b060;border-color:rgba(232,176,96,.55)} #tLight{right:22px;bottom:26px} #tJrnl{right:22px;top:14px;height:40px;line-height:40px}
    html.touch #menuToggle{bottom:auto;top:14px;right:110px;padding:13px 12px;font-size:11px} html.touch #journalHint{display:none} html.touch #battery{bottom:172px}`;
  document.head.appendChild(st);
  const mk=(id,cls,txt)=>{ const d=document.createElement("div"); d.id=id; if(cls)d.className=cls; if(txt)d.textContent=txt; return d; };
  const ui=touch.ui=mk("tUI"), pad=mk("tPad"), nub=mk("tNub"), use=mk("tUse","tBtn","USE"), light=mk("tLight","tBtn","LIGHT"), jr=mk("tJrnl","tBtn","JOURNAL");
  pad.appendChild(nub); ui.append(pad,use,light,jr); document.body.appendChild(ui);
  let padId=null; const setStick=e=>{ const r=pad.getBoundingClientRect(); let dx=(e.clientX-r.left-r.width/2)/52, dy=(e.clientY-r.top-r.height/2)/52;
    const m=Math.hypot(dx,dy); if(m>1){ dx/=m; dy/=m; } touch.x=dx; touch.y=dy; touch.mag=Math.min(1,m); nub.style.transform=`translate(${dx*41}px,${dy*41}px)`; };
  const endStick=e=>{ if(e.pointerId!==padId)return; padId=null; touch.x=touch.y=touch.mag=0; nub.style.transform=""; };
  pad.addEventListener("pointerdown",e=>{ padId=e.pointerId; try{ pad.setPointerCapture(e.pointerId); }catch(_){} setStick(e); e.preventDefault(); });
  pad.addEventListener("pointermove",e=>{ if(e.pointerId===padId)setStick(e); });
  pad.addEventListener("pointerup",endStick); pad.addEventListener("pointercancel",endStick);
  // drag on the picture to look
  let lookId=null,lx=0,ly=0; const cv=$("c");
  cv.addEventListener("pointerdown",e=>{ if(e.pointerType!=="touch")return; lookId=e.pointerId; lx=e.clientX; ly=e.clientY; });
  addEventListener("pointermove",e=>{ if(e.pointerId!==lookId||uiOpen||!running)return;
    player.yaw-=(e.clientX-lx)*.0052*SETTINGS.sens; player.pitch=Math.max(-1.45,Math.min(1.45,player.pitch-(e.clientY-ly)*.0052*SETTINGS.sens)); lx=e.clientX; ly=e.clientY; });
  const endLook=e=>{ if(e.pointerId===lookId)lookId=null; }; addEventListener("pointerup",endLook); addEventListener("pointercancel",endLook);
  use.addEventListener("pointerdown",e=>{ e.preventDefault(); if(uiOpen==="note")closeNote(); else keys.KeyE=true; });
  use.addEventListener("pointerup",()=>{ keys.KeyE=false; });
  light.addEventListener("pointerdown",e=>{ e.preventDefault(); if(!uiOpen&&!player.seated)toggleTorch(); });
  jr.addEventListener("pointerdown",e=>{ e.preventDefault(); if(uiOpen==="journal")closeJournal(); else if(!uiOpen&&running)openJournal(); });
  const k=document.querySelector("#title .keys"); if(k)k.innerHTML="LEFT STICK MOVE · DRAG TO LOOK · USE · LIGHT · JOURNAL<br>SOUND ON · LANDSCAPE IS BEST";
}
addEventListener("touchstart",initTouch,{once:true,passive:true});
function touchTick(){ if(!touch.on)return; const play=running&&!uiOpen;
  touch.ui.children[0].style.display=touch.ui.children[1].style.display=touch.ui.children[2].style.display=play?"block":"none";
  touch.ui.children[3].style.display=running&&(!uiOpen||uiOpen==="journal")?"block":"none";
  touch.ui.children[3].textContent=uiOpen==="journal"?"CLOSE":"JOURNAL";
  if(!play){ touch.x=touch.y=touch.mag=0; } }
{ const k=document.querySelector("#title .keys"); if(k)k.innerHTML="WASD MOVE · SHIFT RUN · MOUSE LOOK · E INTERACT · F FLASHLIGHT · TAB JOURNAL · ESC PAUSE<br>SOUND ON · TOUCH SCREENS SUPPORTED"; }

/* ---------------- Settings (in the pause menu) ---------------- */
{ const row=document.createElement("div"); row.id="settingsRow";
  row.style.cssText="display:flex;flex-wrap:wrap;gap:8px 22px;justify-content:center;padding:10px 12px;border-top:1px solid #363c34;font:10px 'Courier New',monospace;letter-spacing:2px;color:#b8c4b0";
  const slider=(label,key,min,max,step,apply)=>{ const l=document.createElement("label"); l.style.cssText="display:flex;align-items:center;gap:8px";
    const i=document.createElement("input"); i.type="range"; i.min=min; i.max=max; i.step=step; i.value=SETTINGS[key]; i.id="set_"+key; i.style.cssText="width:120px;accent-color:#c8a070";
    i.oninput=()=>{ SETTINGS[key]=+i.value; apply&&apply(); saveSettings(); };
    l.append(label,i); row.appendChild(l); };
  slider("BRIGHTNESS","brightness",.6,1.8,.05,()=>{ postMat.uniforms.gain.value=SETTINGS.brightness; });
  slider("LOOK SPEED","sens",.3,2.5,.05);
  slider("VOLUME","volume",0,1,.02,()=>{ if(AU.master)AU.master.gain.value=SETTINGS.volume; });
  const foot=document.querySelector("#pauseBox .pauseFoot"); foot.parentNode.insertBefore(row,foot); }

/* ---------------- Main loop ---------------- */
const clock=new THREE.Clock();
let stepAcc=0, bobT=0;
function tick(){
  requestAnimationFrame(tick);
  const rawDt=Math.min(.05,clock.getDelta()); const t=clock.elapsedTime;
  const dt=(uiOpen==="pause"&&running)?0:rawDt;   // pause menu freezes the simulation
  rideTick(dt); cineTick(dt);

  /* door open animation */
  if(door8001Open&&d8001.rotation.y> -1.9)d8001.rotation.y-=dt*2.2;
  if(door8007Open&&d8007.rotation.y> -1.9)d8007.rotation.y-=dt*2.2;

  /* wake sequence: seated */
  if(player.seated){
    player.x=seatPos.x; player.z=seatPos.z;
    camera.position.set(seatPos.x,seatPos.y+Math.sin(t*1.4)*.008,seatPos.z);
    if(keys.KeyE&&running&&canStand){ keys.KeyE=false; standUp(); }
  } else if(running&&(!uiOpen||uiOpen==="debug")){
    const run=(keys.ShiftLeft||keys.ShiftRight||touch.mag>.94)&&curZone!=="dream2";   // no sprinting in the chase
    let sp=(run?CFG.run:CFG.walk)*dt*DBG.speed*(curZone==="dream1"?.45:curZone==="dream2"?.62:1);   // dreams are waded through
    let mx=0,mz=0;
    if(keys.KeyW){mx-=Math.sin(player.yaw);mz-=Math.cos(player.yaw);}
    if(keys.KeyS){mx+=Math.sin(player.yaw);mz+=Math.cos(player.yaw);}
    if(keys.KeyA){mx-=Math.cos(player.yaw);mz+=Math.sin(player.yaw);}
    if(keys.KeyD){mx+=Math.cos(player.yaw);mz-=Math.sin(player.yaw);}
    const len=Math.hypot(mx,mz);
    if(touch.mag>.14&&len===0){ const f=-touch.y, r=touch.x;                 // analogue stick: forward/strafe in view space
      mx=-f*Math.sin(player.yaw)+r*Math.cos(player.yaw); mz=-f*Math.cos(player.yaw)-r*Math.sin(player.yaw); sp*=Math.min(1,touch.mag*1.1); }
    const len2=Math.hypot(mx,mz);
    if(len2>0){ mx/=len2;mz/=len2;
      let nx=player.x+mx*sp, nz=player.z+mz*sp;
      if(!DBG.noclip){ [nx,nz]=collide(nx,nz); [nx,nz]=collide(nx,nz);
        // clamp to current zone bounds
        const B=ZONES[curZone].bounds;
        nx=Math.max(B[0],Math.min(B[1],nx)); nz=Math.max(B[2],Math.min(B[3],nz));
      } else { const B=ZONES[curZone].bounds; nx=Math.max(B[0]-3,Math.min(B[1]+3,nx)); nz=Math.max(B[2]-3,Math.min(B[3]+3,nz)); }
      const moved=Math.hypot(nx-player.x,nz-player.z);
      player.x=nx; player.z=nz;
      stepAcc+=moved; bobT+=moved*3.2;
      if(stepAcc>(run?.72:.62)){ stepAcc=0;
        const g=ZONES[curZone].ground; const onStair=g&&Math.abs((g(player.x,player.z)||0)-player.floorY)>.02;
        onStair?AU.stepStair():AU.step(run); }
    }
    const gy=(ZONES[curZone].ground?ZONES[curZone].ground(player.x,player.z):0)||0;
    player.floorY += (gy-player.floorY)*Math.min(1,dt*14);
    camera.position.set(player.x,player.floorY+CFG.eye+Math.sin(bobT)*.028,player.z);
  }
  camera.rotation.y=player.yaw; camera.rotation.x=player.pitch;

  /* torch follows camera */
  torch.position.set(camera.position.x+Math.cos(player.yaw)*.24,camera.position.y-.2,camera.position.z-Math.sin(player.yaw)*.24);
  torch.shadow.needsUpdate=torch.intensity>.01;
  swingTick(rawDt);
  const dir=new THREE.Vector3(0,0,-1).applyEuler(camera.rotation);
  torchTarget.position.copy(camera.position).add(dir.multiplyScalar(6));
  if(torchOn){ if(DBG.infBatt)battery=100; battery=Math.max(0,battery-CFG.torch.drain*dt);
    let it=CFG.torch.intensity;
    if(battery<18)it*= .6+.4*Math.random(); // dying flicker
    if(battery<=0){torchOn=false;say("THOMAS","There it goes.");}
    torch.intensity=it;
  } else { torch.intensity=Math.max(0,torch.intensity-dt*8);
    battery=Math.min(100,battery+CFG.torch.recharge*dt); }  // recharges while off
  $("battFill").style.width=battery+"%";
  $("battFill").style.background = torchOn ? (battery<18?"#c86a4a":"var(--hud)") : "#6a8a6a";

  /* corridor flicker fluorescent */
  for(const f of flickers){ const on=Math.random()>.12? (Math.sin(t*23)+Math.sin(t*7.7)>-.8):false;
    f.userData.light.intensity=on?1.35:.08; f.userData.tube.material.color.setHex(on?0xcfe0cc:0x2a2e28); }
  /* living lamp subtle breathing */
  if(lamp1.userData.light)lamp1.userData.light.intensity=1.55+Math.sin(t*2.1)*.07;

  /* Figure behavior: glimpsed, then flees/vanishes (waking floors only) */
  if(figure.visible){ figure.lookAt(player.x,figure.position.y,player.z);
    figure.position.y=(cine.active&&curZone==="metro"?TRAIN_FLOOR:0)+Math.sin(t*2)*.02;
    if(curZone==="floor8"&&!GS.chase){ figureT+=dt;
      const dist=Math.hypot(player.x-figure.position.x,player.z-figure.position.z);
      if(figureT>7||dist<5){ figure.visible=false; AU.burst(.3,120,.3,1); dread=Math.min(1,dread+.3);
        say(null,"Gone. The corridor keeps the shape of her for a second, the way a bell keeps a note."); } } }

  /* dread decay & tie into post + fog */
  if(!DBG.freezeDread)dread=Math.max(0,dread-dt*.05);
  if(DBG.open){ $("dbDread").value=dread; $("dbDreadV").textContent=dread.toFixed(2); }
  dbgHudTick(dt); touchTick();
  fullGameTick(dt,t);
  postMat.uniforms.dread.value=dread;
  postMat.uniforms.time.value=t;
  scene.fog.far=baseFogFar-dread*4; // tighten fog as dread rises (per lighting revision)

  /* interaction raycast */
  let hit=null;
  if(running&&!uiOpen&&!player.seated||player.seated){
    ray.setFromCamera({x:0,y:0},camera); ray.far=3.6;
    // Invisible meshes are used deliberately as interaction proxies for doors,
    // stairs, and train thresholds. Raycasting must still see those proxies;
    // their enabled state and zone already control when they are active.
    const objs=[]; interactables.forEach(e=>{ if(e.enabled&&e.zone===curZone)objs.push(e.mesh); });
    const hits=ray.intersectObjects(objs,true);
    if(hits.length){ let o=hits[0].object; while(o&&!o.userData.ix)o=o.parent;
      if(o&&o.userData.ix.enabled&&hits[0].distance<=(o.userData.ix.range||CFG.interactRange))hit=o.userData.ix; }
  }
  if(hit&&!player.seated){ $("prompt").style.opacity=1; $("promptText").textContent=hit.prompt;
    if(keys.KeyE){ keys.KeyE=false; usedMesh=hit.mesh; hit.fn(); } }
  else if(!ride.active)$("prompt").style.opacity= player.seated&&running&&canStand?1:0;
  if(player.seated&&running&&canStand)$("promptText").textContent="Stand";

  syncLightRooms();
  /* render: scene → RT → post (or raw if debug) */
  if(DBG.raw){ renderer.setRenderTarget(null); renderer.render(scene,camera); }
  else { renderer.setRenderTarget(rt); renderer.render(scene,camera);
    renderer.setRenderTarget(null); renderer.render(postScene,postCam); }
}
/* ============================================================
   SAVE / LOAD — IndexedDB, 3 manual slots + 1 autosave slot
   ============================================================ */
const SAVE_DB="noirTransitSaves", SAVE_STORE="saves", SAVE_VER=1;
function idbOpen(){ return new Promise((res,rej)=>{
  const rq=indexedDB.open(SAVE_DB,SAVE_VER);
  rq.onupgradeneeded=()=>{ if(!rq.result.objectStoreNames.contains(SAVE_STORE))rq.result.createObjectStore(SAVE_STORE,{keyPath:"slot"}); };
  rq.onsuccess=()=>res(rq.result); rq.onerror=()=>rej(rq.error); }); }
async function idbPut(rec){ try{ const db=await idbOpen(); return await new Promise((res,rej)=>{
  const tx=db.transaction(SAVE_STORE,"readwrite"); tx.objectStore(SAVE_STORE).put(rec);
  tx.oncomplete=()=>res(true); tx.onerror=()=>rej(tx.error); }); }catch(e){ console.warn("save failed",e); return false; } }
async function idbGet(slot){ try{ const db=await idbOpen(); return await new Promise((res,rej)=>{
  const tx=db.transaction(SAVE_STORE,"readonly"); const rq=tx.objectStore(SAVE_STORE).get(slot);
  rq.onsuccess=()=>res(rq.result||null); rq.onerror=()=>rej(rq.error); }); }catch(e){ return null; } }
async function idbGetAll(){ try{ const db=await idbOpen(); return await new Promise((res,rej)=>{
  const tx=db.transaction(SAVE_STORE,"readonly"); const rq=tx.objectStore(SAVE_STORE).getAll();
  rq.onsuccess=()=>res(rq.result||[]); rq.onerror=()=>rej(rq.error); }); }catch(e){ return []; } }
async function idbDelete(slot){ try{ const db=await idbOpen(); return await new Promise((res,rej)=>{
  const tx=db.transaction(SAVE_STORE,"readwrite"); tx.objectStore(SAVE_STORE).delete(slot);
  tx.oncomplete=()=>res(true); tx.onerror=()=>rej(tx.error); }); }catch(e){ return false; } }

const ZONE_LABEL={arrival:"The Last Train",street:"Haldane Court — Street",dream1:"A Dream",floor8:"8th Floor",
  lobbyG:"Ground Floor Lobby",alley:"The Back Alley",restock:"The Restock Room",dream2:"A Dream",
  floor21:"21st Floor",terrace:"The Terrace",metro:"The Platform"};

function thumbnail(){ try{
    const src=$("c"); const t=document.createElement("canvas"); t.width=160; t.height=120;
    const sw=Math.min(src.width,src.height*4/3), sh=sw*3/4;   // centre 4:3 crop
    t.getContext("2d").drawImage(src,(src.width-sw)/2,(src.height-sh)/2,sw,sh,0,0,160,120); return t.toDataURL("image/jpeg",.55);
  }catch(e){ return null; } }

/* gather everything needed to resume — zone, transform, progress flags, inventory, journal */
function captureState(){
  return { t:Date.now(), elapsed:performance.now()-startTime,
    zoneLabel:ZONE_LABEL[curZone]||curZone, objective:$("objText")?$("objText").innerHTML:"",
    thumb:thumbnail(),
    GS:JSON.parse(JSON.stringify(GS)), inv:[...inv], invMeta:JSON.parse(JSON.stringify(invMeta)), collected:[...collected],
    player:{x:player.x,z:player.z,yaw:player.yaw,floorY:player.floorY}, canStand,
    curZone, torchOn, battery, dread,
    door8001Open, door8007Open, phoneAnswered, puzzleSolved, figureShown,
    dialed, note8004Given:!!note8004Given, figureBoarded:!!figureBoarded };
}

/* rebuild the running-game variables from a saved record, then re-derive every visual */
function applyState(s){
  // drop every scripted beat still pending from the session being replaced
  clearGameTimers(); travelLock=false;
  $("title").style.opacity=0; $("title").style.display="none";
  $("fader").style.opacity=0; $("subtitle").innerHTML="";
  setZone(s.curZone);
  player.x=s.player.x; player.z=s.player.z; player.yaw=s.player.yaw; player.pitch=0;
  player.floorY=s.player.floorY||0; player.seated=false; canStand=(s.canStand!==false);
  Object.assign(GS,s.GS);
  inv.clear(); (s.inv||[]).forEach(id=>inv.add(id)); Object.assign(invMeta,s.invMeta||{}); renderInv();
  collected.clear(); (s.collected||[]).forEach(id=>collected.add(id)); renderJournal();
  torchOn=!!s.torchOn; battery=(s.battery??100); dread=s.dread||0;
  door8001Open=!!s.door8001Open; door8007Open=!!s.door8007Open; phoneAnswered=!!s.phoneAnswered;
  ringing=false; try{AU.ringStop();}catch(e){}
  puzzleSolved=!!s.puzzleSolved; figureShown=!!s.figureShown; dialed=s.dialed||"";
  note8004Given=!!s.note8004Given; figureBoarded=!!s.figureBoarded;
  startTime=performance.now()-(s.elapsed||0);
  syncPropsToState();
  setObjective(s.objective||"");
  syncProgressToState();
  syncAudioToZone();
  toast("Loaded — "+(s.zoneLabel||s.curZone));
}

/* one-time trigger effects (door creaks, item drops, box-room swap...) are idempotent by flag,
   so a loaded game just re-derives current visual truth from GS + inventory instead of replaying them */
function syncPropsToState(){
  c8001.on=!door8001Open; c8007.on=!door8007Open;
  if(puzzleSolved){ const has1=inv.has("piece1"), hasK=inv.has("key_restock");
    piece1.visible=!has1; ixPiece.enabled=!has1; keyR.visible=!hasK; ixKey.enabled=!hasK; }
  if(GS.boxPhase){ genSet.visible=false; mossSet.visible=true; mossSet.userData.light.intensity=1.2; if(genLight)genLight.intensity=0;
    crates.forEach(cr=>{ if(cr.userData.reward){
      const found=(cr.userData.reward==="key"&&GS.boxFound.key)||(cr.userData.reward==="piece"&&GS.boxFound.piece)||(cr.userData.reward==="note"&&GS.boxFound.note);
      if(found){ cr.userData.opened=true; cr.userData.lid.position.set(0,.2,-.5); cr.userData.lid.rotation.x=-1.2; } } }); }
  if(GS.generatorOn&&genProp) genProp.userData.lever.rotation.z=-.5;
  if(GS.tankFilled&&tankWater){ tankWater.position.y=2.75;
    const fl3=nodes.find(m=>m.userData.float); if(fl3){ fl3.position.y=2.87; if(fl3.userData.ix)fl3.userData.ix.prompt="A chime, riding the water"; } }
  nodes.forEach(n=>{ const solved=NODE_ORDER.slice(0,GS.nodeStep);
    const on=solved.includes(n.userData.idx); n.children[0].material.emissive.setHex(on?0xd8a838:0x2a2210); n.userData.light.intensity=on?2.2:.9; });
  if((GS.nodeStep>=4||inv.has("piece3"))&&piece3Mesh){ const has3=inv.has("piece3");
    piece3Mesh.visible=!has3; piece3Mesh.userData.ix3.enabled=!has3; if(note3Mesh)note3Mesh.visible=true; }
  if((GS.ledgeOn||inv.has("piece3"))&&ledgeSpot){ GS.ledgeOn=true; ledgeSpot.visible=true; ledgeSpot.userData.ix.enabled=true; }
  if(GS.photoTaken&&terrPhotoMesh)terrPhotoMesh.visible=false;
  if(moonSpr) moonSpr.visible=!!GS.alley2;
  if(GS.safeOpen&&safeProp){ safeProp.userData.open=true; }
  if(GS.ledgeOn)lightLedge();
}

/* A save can land in the gap between a flag flipping and the scripted beat that
   follows it (the phone starting to ring, the chase starting, the key being
   assembled...). Those beats are timers and are not saved, so finish or rewind
   each one here — otherwise the save resumes into a soft-lock. */
function syncProgressToState(){
  figure.visible=false;
  // woke in 8001 but never answered: the phone has to be ringing again
  if(GS.dream1Done&&!phoneAnswered){ ringing=true; if(curZone==="floor8")try{AU.ringStart();}catch(e){} }
  // generator thrown but the chase never began: put the lever back
  if(GS.generatorOn&&!GS.boxPhase&&!GS.chase){ GS.generatorOn=false;
    if(genProp)genProp.userData.lever.rotation.z=0; if(genLight)genLight.intensity=0; }
  // both box rewards found but the way on was never opened
  if(GS.boxFound.key&&GS.boxFound.piece){ GS.alley2=true; GS.elev21=true; if(moonSpr)moonSpr.visible=true; }
  if(inv.has("piece1")&&inv.has("key_restock"))GS.elevG=true;
  // music box solved: its note has to be readable as well as visible
  if(note3Mesh&&note3Mesh.userData.ixn3)note3Mesh.userData.ixn3.enabled=note3Mesh.visible;
  // all four pieces in hand but never assembled
  if(!GS.safeKey&&["piece1","piece2","piece3","piece4"].every(p=>inv.has(p)))assembleKey();
  // safe opened but the letter beat never ran
  if(GS.safeOpen&&!GS.metroOpen){ GS.metroOpen=true; collectNote("n_letter");
    setObjective("The <b>metro</b>. Down, out the front doors, to the end of the street. <b>Go to her.</b>"); }
  // she boarded but the doors were never offered
  if(boardDoor){ boardDoor.visible=!!figureBoarded; boardDoor.userData.ix.enabled=!!figureBoarded; }
  if(figureBoarded&&trainGrp){ trainGrp.userData.arriving=true; trainGrp.position.x=800+14; setObjective("<b>Board the train.</b>"); }
}
/* ambient beds are started by travel callbacks, so a load has to restart the right one */
function syncAudioToZone(){ try{
  AU.sirenStop(); AU.tenantsStop(); AU.trainStop(); AU.stationStop(); AU.windStop();
  if(curZone==="arrival"||curZone==="metro")AU.stationStart();
  if(curZone==="street"||curZone==="terrace")AU.windStart();
  if(curZone==="floor21")AU.tenantsStart();
  if(curZone==="alley"&&GS.alley2)AU.sirenStart();
}catch(e){} }

/* shared bring-up: fade the title out, unlock the fader, start the clock, lock the pointer */
function enterPlayMode(){
  AU.init(); $("title").style.opacity=0; later(()=>$("title").style.display="none",1400);
  running=true; startTime=performance.now();
  later(()=>{ $("fader").style.opacity=0; },300);
  requestGameLock();
}

/* dreams, the chase and choice screens are scripted beats that can't be resumed mid-way */
function canSaveNow(){ return running&&!ride.active&&!cine.active&&!GS.chase&&curZone!=="dream1"&&curZone!=="dream2"; }
async function doSave(slot){
  if(!canSaveNow()){ toast("Not here. He can't hold on to anything in a dream."); return; }
  const s=captureState(); s.slot=slot;
  const ok=await idbPut(s);
  toast(ok?("Saved — slot "+slot):"Save failed — this browser may be blocking local storage");
  if(ok)renderPauseSlots();
}
const RESUME_KEY="noirResumeSlot";
async function doLoad(slot){
  const s=await idbGet(slot);
  if(!s){ toast("Nothing saved there."); return; }
  // Loading over a game in progress: restart the page and resume into the slot,
  // so no opened crate, moved prop or half-run sequence leaks into the loaded game.
  if(running){ try{ sessionStorage.setItem(RESUME_KEY,String(slot)); location.reload(); return; }catch(e){} }
  const wasTitle=$("title").style.display!=="none";
  closePause();
  if(wasTitle) enterPlayMode();
  applyState(s);
  relock();
}
async function doDelete(slot){ await idbDelete(slot); renderPauseSlots(); }

/* fired at every zone transition — skipped during scripted/dream sequences so a resume never
   lands mid-cutscene */
function autosaveCheckpoint(){
  if(!running||ride.active||cine.active||GS.chase||curZone==="dream1"||curZone==="dream2"||uiOpen)return;
  const s=captureState(); s.slot="auto"; idbPut(s);
}

function fmtElapsed(ms){ const m=Math.floor(ms/60000), sec=Math.floor((ms%60000)/1000); return m+":"+(sec<10?"0":"")+sec; }
function fmtDate(t){ const d=new Date(t); return d.toLocaleDateString(undefined,{month:"short",day:"numeric"})+" "+d.toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"}); }

function slotCardHTML(rec,slot,isAuto){
  const label=isAuto?"AUTOSAVE":("SLOT "+slot);
  if(!rec) return `<div class="saveSlot empty">${isAuto?"NO AUTOSAVE YET":"EMPTY — "+label}${isAuto?"":`<div class="saveBtns" style="margin-top:10px"><button data-act="save" data-slot="${slot}">SAVE HERE</button></div>`}</div>`;
  return `<div class="saveSlot">
    <img class="saveThumb" src="${rec.thumb||""}">
    <div class="saveMeta"><b>${label} · ${rec.zoneLabel||rec.curZone}</b><br>${fmtDate(rec.t)} · ${fmtElapsed(rec.elapsed||0)} played</div>
    <div class="saveBtns">
      <button data-act="load" data-slot="${slot}">LOAD</button>
      ${isAuto?"":`<button data-act="save" data-slot="${slot}">OVERWRITE</button>`}
      <button data-act="del" data-slot="${slot}" class="danger">DELETE</button>
    </div></div>`;
}
async function renderPauseSlots(){
  const all=await idbGetAll(); const bySlot={}; all.forEach(r=>bySlot[r.slot]=r);
  $("slotsGrid").innerHTML=slotCardHTML(bySlot["auto"],"auto",true)+[1,2,3].map(n=>slotCardHTML(bySlot[n],n,false)).join("");
  document.querySelectorAll("#pauseOverlay [data-act]").forEach(b=>{
    b.onclick=()=>{ const slot=b.dataset.slot==="auto"?"auto":+b.dataset.slot;
      if(b.dataset.act==="save")doSave(slot);
      else if(b.dataset.act==="load")doLoad(slot);
      else if(b.dataset.act==="del")doDelete(slot); }; });
}
let pauseFromTitle=false;
function openPause(fromTitle){
  pauseFromTitle=fromTitle;
  uiOpen="pause"; document.exitPointerLock?.();
  pauseGameTimers(); if(!fromTitle)try{ AU.ctx&&AU.ctx.suspend(); }catch(e){}
  $("pauseTitle").textContent=fromTitle?"LOAD GAME":"PAUSED";
  $("pauseResume").style.display=fromTitle?"none":"block";
  $("pauseBack").textContent=fromTitle?"CANCEL":"BACK TO TITLE";
  $("pauseBack").dataset.arm="";
  renderPauseSlots();
  $("pauseOverlay").classList.add("show");
}
function closePause(){ $("pauseOverlay").classList.remove("show"); if(uiOpen==="pause")uiOpen=null;
  resumeGameTimers(); try{ AU.ctx&&AU.ctx.resume(); }catch(e){} }
$("pauseResume").onclick=()=>{ closePause(); relock(); };
$("pauseBack").onclick=()=>{
  if(pauseFromTitle){ closePause(); uiOpen=null; return; }
  if($("pauseBack").dataset.arm){ location.reload(); return; }
  $("pauseBack").dataset.arm="1"; $("pauseBack").textContent="CONFIRM — QUIT?";
  uiTimeout(()=>{ $("pauseBack").dataset.arm=""; $("pauseBack").textContent="BACK TO TITLE"; },3000); };
$("menuToggle").onclick=()=>{ if(!uiOpen&&running)openPause(false); };
$("continueBtn").onclick=()=>openPause(true);
let resumePending=false;
idbGetAll().then(all=>{ if(all.length&&!resumePending)$("continueBtn").classList.remove("hide"); });

/* ── landing front page: PLAY reveals the title screen ── */
{ const dismiss=()=>{ $("landing").classList.add("gone"); };
  $("ldPlay1").onclick=dismiss; $("ldPlay2").onclick=dismiss;
  { const n=document.createElement("div"); n.id="ldHow"; n.textContent="Keyboard and mouse, or touch. Brightness, look speed and volume are in the pause menu.";
    n.style.cssText="margin-top:14px;font:11px 'Courier New',monospace;letter-spacing:1.5px;opacity:.6"; const a=$("ldPlay1").parentNode; a.parentNode.insertBefore(n,a.nextSibling); }
  $("ldMore").onclick=()=>$("ldFile").scrollIntoView({behavior:"smooth"});
  $("ldContinue").onclick=()=>{ dismiss(); openPause(true); };
  idbGetAll().then(all=>{ if(all.length)$("ldContinue").style.display="inline-block"; });
  // arriving from an in-game LOAD: skip the landing page, one click resumes the slot
  let pending=null; try{ pending=sessionStorage.getItem(RESUME_KEY); sessionStorage.removeItem(RESUME_KEY); }catch(e){}
  if(pending){ resumePending=true; const slot=pending==="auto"?"auto":+pending; dismiss();
    $("startBtn").textContent="RESUME"; $("continueBtn").classList.add("hide");
    $("startBtn").onclick=()=>doLoad(slot); } }


tick();
