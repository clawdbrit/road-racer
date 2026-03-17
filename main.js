// ════════════════════════════════════════════════════════════════════
//  main.js — Scene setup + game loop
// ════════════════════════════════════════════════════════════════════

// ── Car physics constants ──
const CAR_MAX_SPEED  = 68;
const CAR_ACCEL      = 90;
const CAR_DECEL      = 65;
const CAR_DRAG       = 3.5;
const CAR_TURN_RATE  = 2.2;  // rad/s

const GRIP_LOW        = 0.60;
const GRIP_HIGH       = 0.98;
const DRIFT_THRESHOLD = 0.8;

const DRIFT_BODY_ANGLE_MAX = 0.22;

const HOP_HEIGHT    = 2.2;
const HOP_DURATION  = 0.42;

const CAM_HEIGHT_DEFAULT = 18;
const CAM_DIST_DEFAULT   = 14;

const GOAL_DIST = 3.0;
const ROAD_WIDTH = 8;

// ── Route definition using RoadSystem SVG paths ──
//  SVG coordinate system:
//    0,0 = start (I-15 off-ramp area)
//    +X  = east
//    -Y  = north (SVG Y-down → Three.js negate → world Z-north)
//
//  L-shape: east along E State St, then north on N 1200 E to Fluid HQ
//
//  Segment lengths chosen to roughly match original lat/lon scale:
//    Horizontal (east):  130 units ≈ original E State stretch
//    Vertical (north):    60 units ≈ original N 1200 E stretch
//
//  In world space after SVG→3D conversion:
//    start   = (0, 0, 0)
//    corner  = (130, 0, 0)
//    goal    = (130, 0, 60)   (SVG y=-60 → worldZ = +60)

// Figma SVG path traced from Google Maps satellite view of Lehi, UT
// Original SVG viewport: 1152x721. Scale factor: ~0.113 to fit ~130x82 world units
// SVG path: M0.39 0.31 C212.89 271.31 250.89 577.81 284.89 650.31 C318.89 722.81 420.39 720.31 474.39 720.31 C528.39 720.31 682.39 713.31 682.39 713.31 C805.23 707.98 1054.29 696.11 1067.89 691.31 C1084.89 685.31 1159.89 578.81 1149.89 534.81 C1141.89 499.61 1073.89 446.14 1040.89 423.81 L1101.39 304.81 L1038.39 278.31
// The RoadSystem scales this down via the 'scale' option (1/9 ≈ 0.111)
const ROAD_DEFS = [
  {
    d: 'M0.392578 0.308594C212.893 271.309 250.893 577.809 284.893 650.309C318.893 722.809 420.393 720.309 474.393 720.309C528.393 720.309 682.393 713.309 682.393 713.309C805.226 707.975 1054.29 696.109 1067.89 691.309C1084.89 685.309 1159.89 578.809 1149.89 534.809C1141.89 499.609 1073.89 446.142 1040.89 423.809L1101.39 304.809L1038.39 278.309',
    width: ROAD_WIDTH,
    elevation: 0,
    color: 0x2c2c2c,
    scale: 0.111,   // 1152px → ~128 world units
    flipY: true,    // SVG Y-down → world Z
  },
  // I-15 Freeway overpass — diagonal NW to SE, elevated over the player's start area
  {
    d: 'M -20,-60 L 30,80',
    width: 14,
    elevation: 8,
    color: 0x3a3a3a,
    scale: 1,
    flipY: true,
  },
];

// Start = SVG origin (0,0) scaled → world (0, 0.3, 0)
// Goal  = end of path SVG (1038, 278) * 0.111 → approx world (115, 0, -31)
//         (negative Z because SVG Y is flipped — path goes UP on screen = -Z in SVG space... but flipY makes it +Z)
//         Actual end: x=1038*0.111≈115, z=278*0.111≈31
const START_POS  = new THREE.Vector3(0,   0.3, 0);
const GOAL_POS   = new THREE.Vector3(115, 0,   31);

// For minimap (must be populated before drawMinimap is called)
const routePoints = [
  new THREE.Vector3(0,   0, 0),
  new THREE.Vector3(130, 0, 0),
  new THREE.Vector3(130, 0, 60),
];

// ── Globals ──
var renderer, scene, camera, clock;
var carGroup;
var carPos   = new THREE.Vector3(0, 0.3, 0);
var carAngle = 0;
var velX = 0, velZ = 0;

var camHeight = CAM_HEIGHT_DEFAULT;
var camDist   = CAM_DIST_DEFAULT;
var keys = {};
var miniCtx, miniCanvas;

var goalReached  = false;
var goalBannerUp = false;

var smokeParticles = [];

var isAirborne   = false;
var hopTimer     = 0;
var hopRequested = false;

const _camTarget = new THREE.Vector3();

var goalPos  = GOAL_POS;
var startPos = new THREE.Vector3(0, 0, 0);

var skidMarks = [];
const SKID_MAX       = 500;
const SKID_THRESHOLD = 0.6;

// ── Traffic light globals ──
var trafficBlock   = true;   // true = car cannot accelerate
var trafficPhase   = 'red';  // 'red' | 'yellow' | 'green'
var trafficTimer   = 0;
var tlRedSphere, tlYellowSphere, tlGreenSphere;
const TL_RED_DURATION    = 3.0;  // seconds on red before countdown ends
const TL_YELLOW_DURATION = 1.0;

// ── Smoke material ──
const smokeMat = new THREE.MeshBasicMaterial({
  color: 0xcccccc, transparent: true, opacity: 0.55,
  depthWrite: false, side: THREE.DoubleSide,
});

function spawnSmoke(x, z) {
  const geo  = new THREE.CircleGeometry(0.18 + Math.random() * 0.12, 7);
  const mat  = smokeMat.clone();
  mat.opacity = 0.45 + Math.random() * 0.2;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x + (Math.random() - 0.5) * 0.4, 0.05, z + (Math.random() - 0.5) * 0.4);
  scene.add(mesh);
  smokeParticles.push({ mesh, life: 0, maxLife: 0.55 + Math.random() * 0.25 });
}

function updateSmoke(dt) {
  for (let i = smokeParticles.length - 1; i >= 0; i--) {
    const p = smokeParticles[i];
    p.life += dt;
    const t = p.life / p.maxLife;
    const scale = 1 + t * 3.5;
    p.mesh.scale.set(scale, scale, scale);
    p.mesh.material.opacity = (1 - t) * 0.45;
    if (p.life >= p.maxLife) {
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      smokeParticles.splice(i, 1);
    }
  }
}

// ── Skid marks ──
const skidMat = new THREE.MeshBasicMaterial({
  color: 0x111111, transparent: true, opacity: 0.82,
  depthWrite: false, side: THREE.DoubleSide,
});

function stampSkidMark(wx, wz, angle) {
  const geo  = new THREE.PlaneGeometry(0.4, 0.7);
  const mat  = skidMat.clone();
  mat.opacity = 0.6 + Math.random() * 0.15;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = -angle;
  mesh.position.set(wx, 0.018, wz);
  scene.add(mesh);
  skidMarks.push({ mesh, age: 0 });
  if (skidMarks.length > SKID_MAX) {
    const old = skidMarks.shift();
    scene.remove(old.mesh);
    old.mesh.geometry.dispose();
    old.mesh.material.dispose();
  }
}

// ── Ground ──
function buildGround() {
  const geo  = new THREE.PlaneGeometry(800, 800, 1, 1);
  const mat  = new THREE.MeshLambertMaterial({ color: 0x6aaa6a });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

// ── Scenery — low-poly buildings ──
const BUILDING_COLORS = [
  0xc8955a, 0xd4735a, 0x8a9fb5, 0xa8b878,
  0xe8b870, 0xb88080, 0x7ab0a0, 0xd09060,
];

function buildScenery() {
  const roadHalfW       = ROAD_WIDTH * 0.5 + 1.0;
  const buildingSetback = 2.0;

  for (let seg = 0; seg < routePoints.length - 1; seg++) {
    const ptA    = routePoints[seg];
    const ptB    = routePoints[seg + 1];
    const segLen = ptA.distanceTo(ptB);
    const dx     = ptB.x - ptA.x, dz = ptB.z - ptA.z;
    const dLen   = Math.sqrt(dx * dx + dz * dz) || 1;
    const dirX   = dx / dLen, dirZ = dz / dLen;
    const perpX  = -dirZ, perpZ = dirX;

    const spacing = 8.0;
    const count   = Math.floor(segLen / spacing);

    for (let i = 0; i < count; i++) {
      const t  = (i + 0.5) / count;
      const cx = ptA.x + dirX * segLen * t;
      const cz = ptA.z + dirZ * segLen * t;

      for (const side of [-1, 1]) {
        const seed = seg * 100 + i * 7 + (side > 0 ? 3 : 0);
        const rng  = (n) => Math.abs(Math.sin(seed * 13.37 + n * 7.91)) % 1;
        const w    = 2.5 + rng(1) * 2.5;
        const h    = 2.0 + rng(2) * 5.0;
        const d    = 2.5 + rng(3) * 2.5;
        const offset = roadHalfW + buildingSetback + d * 0.5 + rng(4) * 2.0;
        const bx   = cx + perpX * side * offset;
        const bz   = cz + perpZ * side * offset;

        const colorIdx = Math.floor(rng(5) * BUILDING_COLORS.length);
        const color    = BUILDING_COLORS[colorIdx];

        const geo  = new THREE.BoxGeometry(w, h, d);
        const mat  = new THREE.MeshLambertMaterial({ color });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(bx, h * 0.5, bz);
        mesh.castShadow = mesh.receiveShadow = true;
        scene.add(mesh);

        const roofColor = new THREE.Color(color).multiplyScalar(0.7);
        const roofGeo   = new THREE.BoxGeometry(w + 0.1, 0.15, d + 0.1);
        const roofMat   = new THREE.MeshLambertMaterial({ color: roofColor });
        const roofMesh  = new THREE.Mesh(roofGeo, roofMat);
        roofMesh.position.set(bx, h + 0.075, bz);
        scene.add(roofMesh);
      }
    }
  }
}

// ── Corner intersection pad ──
function buildCornerPad(corner) {
  const padSize = ROAD_WIDTH + 1.0 * 2;
  const padGeo  = new THREE.PlaneGeometry(padSize, padSize);
  const padMat  = new THREE.MeshLambertMaterial({ color: 0xd4c5b0 });
  const padMesh = new THREE.Mesh(padGeo, padMat);
  padMesh.rotation.x = -Math.PI / 2;
  padMesh.position.set(corner.x, 0.012, corner.z);
  padMesh.receiveShadow = true;
  scene.add(padMesh);
}

// ── Goal marker ──
var goalRing, goalGlow;
function buildGoalMarker(pos) {
  const glowGeo = new THREE.CircleGeometry(3.8, 32);
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xff9500, transparent: true, opacity: 0.25, side: THREE.DoubleSide,
  });
  goalGlow = new THREE.Mesh(glowGeo, glowMat);
  goalGlow.rotation.x = -Math.PI / 2;
  goalGlow.position.set(pos.x, 0.035, pos.z);
  scene.add(goalGlow);

  const ringGeo = new THREE.TorusGeometry(3.2, 0.28, 8, 40);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd700 });
  goalRing = new THREE.Mesh(ringGeo, ringMat);
  goalRing.rotation.x = -Math.PI / 2;
  goalRing.position.set(pos.x, 0.06, pos.z);
  scene.add(goalRing);

  const labelCanvas   = document.createElement('canvas');
  labelCanvas.width   = 256;
  labelCanvas.height  = 64;
  const lctx = labelCanvas.getContext('2d');
  lctx.fillStyle = 'rgba(0,0,0,0)';
  lctx.fillRect(0, 0, 256, 64);
  lctx.font      = 'bold 28px Courier New';
  lctx.fillStyle = '#ffd700';
  lctx.textAlign = 'center';
  lctx.fillText('FLUID HQ', 128, 40);
  const labelTex = new THREE.CanvasTexture(labelCanvas);
  const labelGeo = new THREE.PlaneGeometry(6, 1.5);
  const labelMat = new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, side: THREE.DoubleSide });
  const labelMesh = new THREE.Mesh(labelGeo, labelMat);
  labelMesh.rotation.x = -Math.PI / 2;
  labelMesh.position.set(pos.x, 0.08, pos.z - 4.5);
  scene.add(labelMesh);
}

// ── Minimap ──
function initMinimap() {
  miniCanvas        = document.getElementById('mc');
  miniCanvas.width  = 150;
  miniCanvas.height = 150;
  miniCtx = miniCanvas.getContext('2d');
}

function drawMinimap() {
  const W = 150, H = 150;
  miniCtx.fillStyle = '#1a2a1a';
  miniCtx.fillRect(0, 0, W, H);

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of routePoints) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z; if (p.z > maxZ) maxZ = p.z;
  }
  const pad = 16;
  const rX  = maxX - minX || 1;
  const rZ  = maxZ - minZ || 1;

  function toMM(x, z) {
    return {
      px: pad + ((x - minX) / rX) * (W - 2 * pad),
      py: pad + ((z - minZ) / rZ) * (H - 2 * pad),
    };
  }

  miniCtx.strokeStyle = '#888';
  miniCtx.lineWidth   = 4;
  miniCtx.lineCap     = 'round';
  miniCtx.lineJoin    = 'round';
  miniCtx.beginPath();
  const first = toMM(routePoints[0].x, routePoints[0].z);
  miniCtx.moveTo(first.px, first.py);
  for (let i = 1; i < routePoints.length; i++) {
    const { px, py } = toMM(routePoints[i].x, routePoints[i].z);
    miniCtx.lineTo(px, py);
  }
  miniCtx.stroke();

  const g = toMM(goalPos.x, goalPos.z);
  miniCtx.fillStyle = '#ffd700';
  miniCtx.beginPath();
  miniCtx.arc(g.px, g.py, 5, 0, Math.PI * 2);
  miniCtx.fill();

  const s = toMM(startPos.x, startPos.z);
  miniCtx.fillStyle = '#27ae60';
  miniCtx.beginPath();
  miniCtx.arc(s.px, s.py, 4, 0, Math.PI * 2);
  miniCtx.fill();

  const { px: cx, py: cz } = toMM(carPos.x, carPos.z);
  miniCtx.fillStyle = '#e63946';
  miniCtx.beginPath();
  miniCtx.arc(cx, cz, 4, 0, Math.PI * 2);
  miniCtx.fill();

  miniCtx.strokeStyle = 'rgba(230,57,70,0.6)';
  miniCtx.lineWidth = 1;
  const coneLen = 11;
  for (const da of [-0.35, 0.35]) {
    const a = carAngle + da;
    miniCtx.beginPath();
    miniCtx.moveTo(cx, cz);
    miniCtx.lineTo(cx + Math.sin(a) * coneLen, cz + Math.cos(a) * coneLen);
    miniCtx.stroke();
  }
}

// ── Touch controls ──
function initTouchControls() {
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (!isTouch) return;
  document.getElementById('touch-controls').style.display = 'block';

  const btnMap = [
    { id: 'dpad-left',  key: 'arrowleft'  },
    { id: 'dpad-right', key: 'arrowright' },
    { id: 'btn-gas',    key: 'arrowup'    },
    { id: 'btn-brake',  key: 'arrowdown'  },
    { id: 'btn-hop',    key: 'x'          },
  ];
  const pointerKeyMap = new Map();

  function pressKey(key)   { if (key) keys[key] = true;  }
  function releaseKey(key) { if (key) keys[key] = false; }

  for (const { id, key } of btnMap) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('touchstart', e => {
      e.preventDefault();
      for (const touch of e.changedTouches) { pointerKeyMap.set(touch.identifier, key); pressKey(key); }
      el.classList.add('active');
    }, { passive: false });
    el.addEventListener('touchend', e => {
      e.preventDefault();
      for (const touch of e.changedTouches) { releaseKey(pointerKeyMap.get(touch.identifier)); pointerKeyMap.delete(touch.identifier); }
      if (e.targetTouches.length === 0) el.classList.remove('active');
    }, { passive: false });
    el.addEventListener('touchcancel', e => {
      e.preventDefault();
      for (const touch of e.changedTouches) { releaseKey(pointerKeyMap.get(touch.identifier)); pointerKeyMap.delete(touch.identifier); }
      el.classList.remove('active');
    }, { passive: false });
  }

  window.addEventListener('touchend', e => {
    for (const touch of e.changedTouches) {
      if (pointerKeyMap.has(touch.identifier)) { releaseKey(pointerKeyMap.get(touch.identifier)); pointerKeyMap.delete(touch.identifier); }
    }
    for (const { id, key } of btnMap) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.classList.toggle('active', [...pointerKeyMap.values()].includes(key));
    }
  }, { passive: true });
}

// ── Underpass ceiling panel — "driving under the I-15 overpass" feel ──
function buildUnderpassPanel() {
  const geo = new THREE.BoxGeometry(14, 0.4, 6);
  const mat = new THREE.MeshLambertMaterial({ color: 0x2a2a2a, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(5, 7.5, 5);
  mesh.receiveShadow = true;
  mesh.castShadow    = true;
  scene.add(mesh);
}

// ── Traffic light ──
function buildTrafficLight() {
  const tl = new THREE.Group();

  // Pole
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 3, 6);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.set(0, 1.5, 0);
  tl.add(pole);

  // Black body box
  const bodyGeo = new THREE.BoxGeometry(0.4, 2.0, 0.4);
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.set(0, 2.0 + 1.0, 0); // center at y=3 (1.0 offset above pole top)
  tl.add(body);

  // Helper: create a light sphere
  function makeSphere(color, y) {
    const geo = new THREE.SphereGeometry(0.14, 10, 8);
    const mat = new THREE.MeshStandardMaterial({
      color: color,
      emissive: LIGHT_DIM_COLOR,
      emissiveIntensity: 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, y, 0.22); // slightly in front of body face
    tl.add(mesh);
    return mesh;
  }

  tlRedSphere    = makeSphere(0xff2200, 3.2);
  tlYellowSphere = makeSphere(0xffbb00, 2.7);
  tlGreenSphere  = makeSphere(0x00cc44, 2.2);

  // Start with RED active
  tlRedSphere.material.emissive.set(0xff2200);
  tlRedSphere.material.emissiveIntensity = 1.0;

  tl.position.set(8, 0, 12);
  scene.add(tl);
}

// Update traffic light logic (call each frame with dt)
function updateTrafficLight(dt) {
  if (trafficPhase === 'green') return; // already done

  trafficTimer += dt;

  const countdownEl = document.getElementById('traffic-countdown');

  if (trafficPhase === 'red') {
    // Show countdown: "GO IN 3...", "GO IN 2...", "GO IN 1..."
    const remaining = Math.max(0, TL_RED_DURATION - trafficTimer);
    const secs = Math.ceil(remaining);
    if (remaining > 0) {
      countdownEl.style.display = 'block';
      countdownEl.style.color = '#ff4444';
      countdownEl.style.borderColor = 'rgba(255,60,60,0.6)';
      countdownEl.style.textShadow = '0 0 30px rgba(255,60,60,0.9), 0 4px 20px rgba(0,0,0,0.9)';
      countdownEl.textContent = secs > 1 ? `GO IN ${secs - 1}...` : 'GET READY!';
    } else {
      // Transition to yellow
      trafficPhase = 'yellow';
      trafficTimer = 0;
      // Dim red
      tlRedSphere.material.emissive.set(0x111111);
      tlRedSphere.material.emissiveIntensity = 0;
      // Light yellow
      tlYellowSphere.material.emissive.set(0xffbb00);
      tlYellowSphere.material.emissiveIntensity = 1.0;

      countdownEl.style.color = '#ffcc00';
      countdownEl.style.borderColor = 'rgba(255,200,0,0.7)';
      countdownEl.style.textShadow = '0 0 30px rgba(255,200,0,0.9), 0 4px 20px rgba(0,0,0,0.9)';
      countdownEl.textContent = 'GET SET!';
    }
  } else if (trafficPhase === 'yellow') {
    if (trafficTimer >= TL_YELLOW_DURATION) {
      // Transition to green — release the car!
      trafficPhase = 'green';
      trafficBlock = false;

      // Dim yellow
      tlYellowSphere.material.emissive.set(0x111111);
      tlYellowSphere.material.emissiveIntensity = 0;
      // Light green
      tlGreenSphere.material.emissive.set(0x00cc44);
      tlGreenSphere.material.emissiveIntensity = 1.0;

      // Show GO! then fade
      countdownEl.style.color = '#00ff66';
      countdownEl.style.borderColor = 'rgba(0,255,100,0.7)';
      countdownEl.style.textShadow = '0 0 30px rgba(0,255,100,0.9), 0 4px 20px rgba(0,0,0,0.9)';
      countdownEl.textContent = 'GO!';

      // Hide after 1.2 seconds
      setTimeout(() => { countdownEl.style.display = 'none'; }, 1200);
    }
  }
}

// ── Low-poly trees ──
function buildTrees(roadSamplePoints) {
  const trunkMat  = new THREE.MeshLambertMaterial({ color: 0x6B4226 });
  const canopyMat = new THREE.MeshLambertMaterial({ color: 0x3d8b37 });
  const trunkGeo  = new THREE.CylinderGeometry(0.15, 0.2, 1.2, 5);
  const canopyGeo = new THREE.ConeGeometry(1.8, 3.0, 6);

  const ROAD_CLEAR = 12;   // skip if within this many units of road centerline
  const TREE_COUNT = 60;

  // Grid-based scatter across x=-30..150, z=-20..100
  const xMin = -30, xMax = 150;
  const zMin = -20, zMax = 100;
  const gridCols = 12, gridRows = 8;  // 96 grid cells → we'll pick ~60 valid ones
  const cellW = (xMax - xMin) / gridCols;
  const cellH = (zMax - zMin) / gridRows;

  let placed = 0;
  // deterministic-ish seeded RNG via trig
  let seed = 42;
  function rng() {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 0xffffffff;
  }

  for (let row = 0; row < gridRows && placed < TREE_COUNT; row++) {
    for (let col = 0; col < gridCols && placed < TREE_COUNT; col++) {
      // random offset within cell
      const cx = xMin + col * cellW + rng() * cellW;
      const cz = zMin + row * cellH + rng() * cellH;

      // Check distance to all road sample points
      let tooClose = false;
      for (const rp of roadSamplePoints) {
        const dx = cx - rp.x, dz = cz - rp.z;
        if (dx * dx + dz * dz < ROAD_CLEAR * ROAD_CLEAR) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      // Build tree group
      const tree = new THREE.Group();

      const trunk = new THREE.Mesh(trunkGeo, trunkMat.clone());
      trunk.position.set(0, 0.6, 0); // center of 1.2-tall trunk
      tree.add(trunk);

      const canopy = new THREE.Mesh(canopyGeo, canopyMat.clone());
      canopy.position.set(0, 2.4, 0);
      tree.add(canopy);

      const scale = 0.7 + rng() * 0.6; // 0.7 – 1.3
      tree.scale.setScalar(scale);
      tree.rotation.y = rng() * Math.PI * 2;
      tree.position.set(cx, 0, cz);
      tree.castShadow = true;
      scene.add(tree);
      placed++;
    }
  }
}

// ════════════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════════════
function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0xaed6f1);
  document.body.insertBefore(renderer.domElement, document.body.firstChild);

  scene  = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xaed6f1, 0.0008);
  camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.3, 1200);
  clock  = new THREE.Clock();

  // Lighting
  scene.add(new THREE.AmbientLight(0xfff5e0, 0.7));
  const sun = new THREE.DirectionalLight(0xfff8e1, 0.8);
  sun.position.set(10, 20, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 800;
  sun.shadow.camera.left = -300; sun.shadow.camera.right = 300;
  sun.shadow.camera.top  = 300;  sun.shadow.camera.bottom = -300;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xc8e8ff, 0x6aaa6a, 0.45));

  buildGround();

  // ── Build roads via RoadSystem ──
  const rs = new RoadSystem(scene);
  for (const def of ROAD_DEFS) {
    rs.addRoad(def);
  }
  rs.build();

  // Corner pad at bend
  // No corner pad needed — route geometry handles intersections via RoadSystem

  // ── Gather road sample points for tree placement avoidance ──
  // Sample the main road path (ROAD_DEFS[0]) at regular intervals using routePoints
  // and also add a dense sample along the road centerline for better clearance.
  const roadSamples = [];
  // Dense sample along routePoints segments
  for (let seg = 0; seg < routePoints.length - 1; seg++) {
    const ptA = routePoints[seg], ptB = routePoints[seg + 1];
    const dist = ptA.distanceTo(ptB);
    const steps = Math.max(2, Math.floor(dist / 4));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      roadSamples.push(new THREE.Vector3(
        ptA.x + (ptB.x - ptA.x) * t,
        0,
        ptA.z + (ptB.z - ptA.z) * t
      ));
    }
  }
  // Also add a rough sample of the I-15 overpass line (world coords after scale+flipY)
  // M -20,-60 L 30,80 with scale=1, flipY=true → (-20, z=60) to (30, z=-80)... wait:
  // SVG Y=-60 → flipY=true → world Z = -60 (north), SVG Y=80 → world Z = 80
  // Actually with flipY=true in the existing code: worldZ = p.y * scale (not negated)
  // Let's just add a few samples along that diagonal
  for (let t = 0; t <= 1; t += 0.05) {
    roadSamples.push(new THREE.Vector3(
      -20 + t * 50, 0, -60 + t * 140
    ));
  }

  buildUnderpassPanel();
  buildTrafficLight();
  buildScenery();
  buildTrees(roadSamples);
  buildGoalMarker(GOAL_POS);

  // ── Car ──
  carGroup = buildCar();
  scene.add(carGroup);

  carPos.copy(START_POS);
  // Three.js rotation.y: sin(angle)=fwdX, cos(angle)=fwdZ
  // Route starts going east (+X), so sin(angle)=1 → angle = PI/2
  carAngle = Math.PI / 2;

  velX = 0; velZ = 0;
  carGroup.position.copy(carPos);
  carGroup.rotation.y = carAngle;

  camera.position.set(
    START_POS.x - Math.sin(carAngle) * CAM_DIST_DEFAULT,
    CAM_HEIGHT_DEFAULT,
    START_POS.z - Math.cos(carAngle) * CAM_DIST_DEFAULT
  );
  camera.lookAt(carPos.x, 0.5, carPos.z);

  initMinimap();
  drawMinimap();

  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright','r','+','-','=','_','x'].includes(k)) {
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

  initTouchControls();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Show initial countdown overlay
  const countdownEl = document.getElementById('traffic-countdown');
  countdownEl.style.display = 'block';
  countdownEl.style.color = '#ff4444';
  countdownEl.style.borderColor = 'rgba(255,60,60,0.6)';
  countdownEl.textContent = 'GO IN 3...';

  animate();
}

// ════════════════════════════════════════════════════════════════════
//  GAME LOOP
// ════════════════════════════════════════════════════════════════════
var driftBodyAngle = 0;
var driftLeanAngle = 0;
var carTilt        = 0;
var wheelSpinAngle = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  // Update traffic light countdown
  updateTrafficLight(dt);

  const gas    = keys['w'] || keys['arrowup'];
  const brake  = keys['s'] || keys['arrowdown'];
  const left   = keys['a'] || keys['arrowleft'];
  const right  = keys['d'] || keys['arrowright'];
  const hopKey = keys['x'];

  // Reset
  if (keys['r']) {
    carPos.copy(START_POS);
    carAngle       = Math.PI / 2;
    velX           = 0; velZ = 0;
    isAirborne     = false; hopTimer = 0;
    driftBodyAngle = 0; driftLeanAngle = 0;
    carTilt        = 0; wheelSpinAngle = 0;
    goalReached    = false; goalBannerUp = false;
    document.getElementById('goal-banner').style.display = 'none';

    // Reset traffic light
    trafficBlock = true;
    trafficPhase = 'red';
    trafficTimer = 0;
    if (tlRedSphere) {
      tlRedSphere.material.emissive.set(0xff2200);
      tlRedSphere.material.emissiveIntensity = 1.0;
      tlYellowSphere.material.emissive.set(0x111111);
      tlYellowSphere.material.emissiveIntensity = 0;
      tlGreenSphere.material.emissive.set(0x111111);
      tlGreenSphere.material.emissiveIntensity = 0;
    }
    const countdownEl = document.getElementById('traffic-countdown');
    countdownEl.style.display = 'block';
    countdownEl.style.color = '#ff4444';
    countdownEl.style.borderColor = 'rgba(255,60,60,0.6)';
    countdownEl.textContent = 'GO IN 3...';

    keys['r'] = false;
  }

  // Camera zoom
  if (keys['+'] || keys['=']) { camHeight = Math.max(12, camHeight - 40 * dt); camDist = Math.max(8, camDist - 28 * dt); }
  if (keys['-'] || keys['_']) { camHeight = Math.min(200, camHeight + 40 * dt); camDist = Math.min(140, camDist + 28 * dt); }

  // Hop
  if (hopKey && !hopRequested && !isAirborne) { isAirborne = true; hopTimer = 0; hopRequested = true; }
  if (!hopKey) hopRequested = false;

  let carY = 0.3;
  if (isAirborne) {
    hopTimer += dt;
    if (hopTimer >= HOP_DURATION) { isAirborne = false; hopTimer = 0; carY = 0.3; }
    else { const t = hopTimer / HOP_DURATION; carY = 0.3 + Math.sin(t * Math.PI) * HOP_HEIGHT; }
  }

  const speed = Math.sqrt(velX * velX + velZ * velZ);
  const fwdX = Math.sin(carAngle), fwdZ = Math.cos(carAngle);
  const latX = -fwdZ,             latZ  =  fwdX;
  const fwdDot = velX * fwdX + velZ * fwdZ;
  const latDot = velX * latX + velZ * latZ;
  const movingForward = fwdDot >= 0;

  const airGripFactor = isAirborne ? 0.3 : 1.0;
  const steerFactor   = Math.min(1.0, speed / 15 + 0.25) * airGripFactor;
  const steerDir      = movingForward ? 1 : -1;
  if (left)  carAngle += CAR_TURN_RATE * steerFactor * steerDir * dt;
  if (right) carAngle -= CAR_TURN_RATE * steerFactor * steerDir * dt;

  let newFwdSpeed = fwdDot;
  if (trafficBlock) {
    // Car is held at the start line — clamp to zero, allow steering but no forward motion
    newFwdSpeed = 0;
    velX = 0; velZ = 0;
  } else {
    if (gas)   newFwdSpeed = Math.min(newFwdSpeed + CAR_ACCEL * dt, CAR_MAX_SPEED);
    if (brake) newFwdSpeed = Math.max(newFwdSpeed - CAR_DECEL * dt, -CAR_MAX_SPEED * 0.35);
    if (!gas && !brake) {
      newFwdSpeed -= newFwdSpeed * CAR_DRAG * dt;
      if (Math.abs(newFwdSpeed) < 0.02) newFwdSpeed = 0;
    }
  }

  const speedRatio = Math.min(1.0, speed / CAR_MAX_SPEED);
  const gripPerSec = GRIP_LOW + (GRIP_HIGH - GRIP_LOW) * (1.0 - speedRatio);
  const gripFrame  = Math.pow(gripPerSec, dt * 60);
  const newLatSpeed = latDot * gripFrame;

  const nfwdX = Math.sin(carAngle), nfwdZ = Math.cos(carAngle);
  const nlatX = -nfwdZ,            nlatZ  =  nfwdX;
  velX = newFwdSpeed * nfwdX + newLatSpeed * nlatX;
  velZ = newFwdSpeed * nfwdZ + newLatSpeed * nlatZ;

  const absLat     = Math.abs(newLatSpeed);
  const isDrifting = absLat > DRIFT_THRESHOLD && speed > 3 && !isAirborne;

  if (isDrifting && absLat > 1.0 && Math.random() < 0.65) {
    const rearX = carPos.x - nfwdX * 0.8, rearZ = carPos.z - nfwdZ * 0.8;
    spawnSmoke(rearX + nlatX * 0.55, rearZ + nlatZ * 0.55);
    spawnSmoke(rearX - nlatX * 0.55, rearZ - nlatZ * 0.55);
  }

  if (isDrifting && absLat > SKID_THRESHOLD && !isAirborne) {
    const rearX = carPos.x - nfwdX * 0.65, rearZ = carPos.z - nfwdZ * 0.65;
    stampSkidMark(rearX + nlatX * 0.55, rearZ + nlatZ * 0.55, carAngle);
    stampSkidMark(rearX - nlatX * 0.55, rearZ - nlatZ * 0.55, carAngle);
  }

  carPos.x += velX * dt;
  carPos.z += velZ * dt;
  carPos.y  = carY;

  const targetBodyAngle = isDrifting
    ? Math.sign(newLatSpeed) * Math.min(Math.abs(newLatSpeed) / 6.0, 1.0) * DRIFT_BODY_ANGLE_MAX
    : 0;
  driftBodyAngle += (targetBodyAngle - driftBodyAngle) * Math.min(1, 8 * dt);

  let targetTilt = 0;
  if (left)  targetTilt += isDrifting ? 0.28 : 0.15;
  if (right) targetTilt -= isDrifting ? 0.28 : 0.15;
  targetTilt += -Math.sign(newLatSpeed) * Math.min(Math.abs(newLatSpeed) / 6.0, 1.0) * 0.18;
  carTilt += (targetTilt - carTilt) * Math.min(1, 0.12 * 60 * dt);
  driftLeanAngle = carTilt;

  wheelSpinAngle += newFwdSpeed * dt * (1 / 0.45);
  if (carWheelMeshes.length > 0) {
    for (const pivot of carWheelMeshes) pivot.rotation.x = wheelSpinAngle;
  }

  carGroup.position.set(carPos.x, carY, carPos.z);
  carGroup.rotation.y = carAngle;

  const bodyGroup = carGroup.children[0];
  if (bodyGroup) { bodyGroup.rotation.y = driftBodyAngle; bodyGroup.rotation.z = driftLeanAngle; }

  updateSmoke(dt);

  for (let i = skidMarks.length - 1; i >= 0; i--) {
    const sm = skidMarks[i];
    sm.age = (sm.age || 0) + dt;
    const fadedOpacity = Math.max(0, 0.6 * (1 - sm.age / 8.0));
    sm.mesh.material.opacity = fadedOpacity;
    if (fadedOpacity <= 0) {
      scene.remove(sm.mesh);
      sm.mesh.geometry.dispose();
      sm.mesh.material.dispose();
      skidMarks.splice(i, 1);
    }
  }

  if (!goalReached) {
    const dx = carPos.x - goalPos.x, dz = carPos.z - goalPos.z;
    if (Math.sqrt(dx * dx + dz * dz) < GOAL_DIST) {
      goalReached = true; goalBannerUp = true;
      document.getElementById('goal-banner').style.display = 'block';
    }
  }

  if (goalRing) {
    const pulse = 0.92 + 0.08 * Math.sin(performance.now() * 0.003);
    goalRing.scale.set(pulse, pulse, pulse);
    goalGlow.material.opacity = 0.18 + 0.10 * Math.sin(performance.now() * 0.003);
  }

  const isoOffsetX = Math.sin(carAngle) * camDist;
  const isoOffsetZ = Math.cos(carAngle) * camDist;
  _camTarget.set(carPos.x - isoOffsetX, camHeight, carPos.z - isoOffsetZ);
  camera.position.lerp(_camTarget, Math.min(1, 7 * dt));
  camera.lookAt(carPos.x, 0.5, carPos.z);

  const totalSpeed = Math.sqrt(velX * velX + velZ * velZ);
  const kmh = Math.abs(Math.round(totalSpeed * 4 * 3.6));
  document.getElementById('spd').textContent = kmh;
  document.getElementById('drift-ind').style.display = isDrifting ? 'block' : 'none';
  document.getElementById('air-ind').style.display   = isAirborne  ? 'block' : 'none';

  drawMinimap();
  renderer.render(scene, camera);
}

// Boot
window.addEventListener('DOMContentLoaded', init);
