// ════════════════════════════════════════════════════════════════════
//  road-system.js — RoadSystem class
//  Converts SVG path strings into 3D road ribbon geometry.
//
//  Coordinate mapping:
//    SVG  X  →  Three.js  X  (east)
//    SVG  Y  →  Three.js  Z  (negated — SVG Y-down → world Z-north)
//    elevation → Three.js Y
// ════════════════════════════════════════════════════════════════════

// ── Lightweight SVG path parser (no external dependency needed) ──
// Returns array of command objects: { code, relative, x, y, x1, y1, x2, y2, ... }
function parseSVGPath(d) {
  const commands = [];
  // Tokenise: split on command letters, preserve letter as part of token
  const re = /([MmLlCcQqZzHhVvSsTtAa])\s*([-\d\s.,e+Ee]+)?/g;
  let match;
  while ((match = re.exec(d)) !== null) {
    const code = match[1];
    const args = (match[2] || '').trim().split(/[\s,]+/).filter(s => s !== '').map(Number);
    const relative = code === code.toLowerCase() && code.toLowerCase() !== 'z';
    const upper = code.toUpperCase();

    if (upper === 'Z') {
      commands.push({ code: 'Z', relative: false });
      continue;
    }

    // How many coords per command
    const stride = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 }[upper] || 2;

    for (let i = 0; i + stride - 1 < args.length; i += stride) {
      const cmd = { code: upper, relative };
      if (upper === 'M' || upper === 'L' || upper === 'T') {
        cmd.x = args[i]; cmd.y = args[i + 1];
      } else if (upper === 'H') {
        cmd.x = args[i];
      } else if (upper === 'V') {
        cmd.y = args[i];
      } else if (upper === 'C') {
        cmd.x1 = args[i];     cmd.y1 = args[i + 1];
        cmd.x2 = args[i + 2]; cmd.y2 = args[i + 3];
        cmd.x  = args[i + 4]; cmd.y  = args[i + 5];
      } else if (upper === 'S') {
        cmd.x2 = args[i];     cmd.y2 = args[i + 1];
        cmd.x  = args[i + 2]; cmd.y  = args[i + 3];
      } else if (upper === 'Q') {
        cmd.x1 = args[i];     cmd.y1 = args[i + 1];
        cmd.x  = args[i + 2]; cmd.y  = args[i + 3];
      } else if (upper === 'A') {
        cmd.rx = args[i]; cmd.ry = args[i + 1];
        cmd.xr = args[i + 2]; cmd.laf = args[i + 3]; cmd.sf = args[i + 4];
        cmd.x  = args[i + 5]; cmd.y  = args[i + 6];
      }
      // After the first M, repeated coords are treated as L
      if (upper === 'M' && i > 0) cmd.code = 'L';
      commands.push(cmd);
    }
  }
  return commands;
}

// ── Make all commands absolute given a cursor state ──
function makeAbsolute(commands) {
  let cx = 0, cy = 0, subpathX = 0, subpathY = 0;
  const abs = [];
  for (const cmd of commands) {
    const c = Object.assign({}, cmd);
    if (c.code === 'Z') {
      cx = subpathX; cy = subpathY;
      abs.push(c);
      continue;
    }
    if (c.relative) {
      if ('x'  in c) c.x  += cx;
      if ('y'  in c) c.y  += cy;
      if ('x1' in c) c.x1 += cx;
      if ('y1' in c) c.y1 += cy;
      if ('x2' in c) c.x2 += cx;
      if ('y2' in c) c.y2 += cy;
    }
    // H/V — synthesize missing axis from cursor
    if (c.code === 'H') { c.y = cy; }
    if (c.code === 'V') { c.x = cx; }
    // After H/V normalise to L
    if (c.code === 'H' || c.code === 'V') c.code = 'L';

    c.relative = false;
    if (c.code === 'M') { subpathX = c.x; subpathY = c.y; }
    if ('x' in c) cx = c.x;
    if ('y' in c) cy = c.y;
    abs.push(c);
  }
  return abs;
}

// ── Convert absolute SVG commands to array of THREE.Vector2 sample points ──
// Uses THREE.js curve classes for smooth interpolation.
// SVG coord → world: x stays, y is negated (→ used as Z later)
function svgCommandsToPoints(commands, numSamples) {
  const allPoints = [];
  let curX = 0, curY = 0;
  let firstX = 0, firstY = 0; // for Z closepath

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];

    if (cmd.code === 'M') {
      // MoveTo — just update cursor (no geometry)
      curX = cmd.x; curY = cmd.y;
      firstX = curX; firstY = curY;
      // Always add the move-to point
      allPoints.push(new THREE.Vector2(curX, curY));
      continue;
    }

    if (cmd.code === 'L') {
      // Sample linearly between curX,curY → cmd.x,cmd.y
      const x0 = curX, y0 = curY;
      const x1 = cmd.x, y1 = cmd.y;
      const dist = Math.hypot(x1 - x0, y1 - y0);
      const steps = Math.max(2, Math.ceil(dist * numSamples / 400));
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        allPoints.push(new THREE.Vector2(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t));
      }
      curX = cmd.x; curY = cmd.y;
      continue;
    }

    if (cmd.code === 'C') {
      // Cubic bezier — sample using THREE.CubicBezierCurve
      const curve = new THREE.CubicBezierCurve(
        new THREE.Vector2(curX, curY),
        new THREE.Vector2(cmd.x1, cmd.y1),
        new THREE.Vector2(cmd.x2, cmd.y2),
        new THREE.Vector2(cmd.x, cmd.y)
      );
      const pts = curve.getPoints(Math.max(8, Math.ceil(numSamples / 4)));
      for (const p of pts.slice(1)) allPoints.push(p); // skip first (already at cursor)
      curX = cmd.x; curY = cmd.y;
      continue;
    }

    if (cmd.code === 'Q') {
      const curve = new THREE.QuadraticBezierCurve(
        new THREE.Vector2(curX, curY),
        new THREE.Vector2(cmd.x1, cmd.y1),
        new THREE.Vector2(cmd.x, cmd.y)
      );
      const pts = curve.getPoints(Math.max(8, Math.ceil(numSamples / 4)));
      for (const p of pts.slice(1)) allPoints.push(p);
      curX = cmd.x; curY = cmd.y;
      continue;
    }

    if (cmd.code === 'S') {
      // Smooth cubic — reflect previous control point
      let cx1, cy1;
      const prev = commands[i - 1];
      if (prev && (prev.code === 'C' || prev.code === 'S')) {
        cx1 = 2 * curX - prev.x2;
        cy1 = 2 * curY - prev.y2;
      } else {
        cx1 = curX; cy1 = curY;
      }
      const curve = new THREE.CubicBezierCurve(
        new THREE.Vector2(curX, curY),
        new THREE.Vector2(cx1, cy1),
        new THREE.Vector2(cmd.x2, cmd.y2),
        new THREE.Vector2(cmd.x, cmd.y)
      );
      const pts = curve.getPoints(Math.max(8, Math.ceil(numSamples / 4)));
      for (const p of pts.slice(1)) allPoints.push(p);
      curX = cmd.x; curY = cmd.y;
      continue;
    }

    if (cmd.code === 'Z') {
      // Close path — line back to first point
      const x0 = curX, y0 = curY;
      const x1 = firstX, y1 = firstY;
      const dist = Math.hypot(x1 - x0, y1 - y0);
      if (dist > 0.01) {
        const steps = Math.max(2, Math.ceil(dist));
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          allPoints.push(new THREE.Vector2(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t));
        }
      }
      curX = firstX; curY = firstY;
      continue;
    }

    // A (arc) — approximate with line for simplicity
    if (cmd.code === 'A') {
      allPoints.push(new THREE.Vector2(cmd.x, cmd.y));
      curX = cmd.x; curY = cmd.y;
    }
  }

  return allPoints;
}

// ════════════════════════════════════════════════════════════════════
//  RoadSystem — main class
// ════════════════════════════════════════════════════════════════════
class RoadSystem {
  constructor(scene) {
    this._scene = scene;
    this._roads = [];   // Array of road spec objects
    this._meshes = [];  // Built THREE.Mesh objects (for disposal)
  }

  /**
   * Queue a road for building.
   * @param {Object} opts
   * @param {string} opts.d         SVG path `d` attribute string
   * @param {number} [opts.width=8]    World-unit road width
   * @param {number} [opts.elevation=0] Y offset (0=ground, positive=overpass)
   * @param {number} [opts.color=0x2c2c2c] Asphalt color
   */
  addRoad(opts) {
    this._roads.push({
      d:         opts.d,
      width:     opts.width     !== undefined ? opts.width     : 8,
      elevation: opts.elevation !== undefined ? opts.elevation : 0,
      color:     opts.color     !== undefined ? opts.color     : 0x2c2c2c,
    });
  }

  /**
   * Build all queued roads and add geometry to the scene.
   */
  build() {
    for (const road of this._roads) {
      this._buildRoad(road);
    }
  }

  /**
   * Remove all road meshes from the scene.
   */
  dispose() {
    for (const mesh of this._meshes) {
      this._scene.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
    }
    this._meshes = [];
  }

  // ── Internal: build a single road ──
  _buildRoad(road) {
    const { d, width, elevation, color } = road;
    const scale = road.scale || 1;
    const flipY = road.flipY !== false; // default true (SVG Y-down → world Z)
    const halfW = width * 0.5;

    // 1. Parse SVG path
    const rawCmds = parseSVGPath(d);
    const absCmds = makeAbsolute(rawCmds);

    // 2. Sample points (SVG 2D coords)
    const pts2d = svgCommandsToPoints(absCmds, 200);
    if (pts2d.length < 2) {
      console.warn('RoadSystem: path produced fewer than 2 points, skipping.');
      return;
    }

    // 3. Convert SVG coords → 3D world coords
    //    Apply scale first, then axis mapping:
    //    SVG X * scale → world X
    //    SVG Y * scale → world Z (negated so SVG-down = world +Z / south)
    //    elevation → world Y
    const pts3d = pts2d.map(p => new THREE.Vector3(
      p.x * scale,
      elevation,
      flipY ? p.y * scale : -p.y * scale  // flipY=true: SVG Y → world +Z (south on screen = forward)
    ));

    // 4. Build ribbon geometry
    this._buildRibbon(pts3d, halfW, elevation, color);

    // 5. If elevated, add support pillars
    if (elevation > 0.5) {
      this._buildPillars(pts3d, elevation);
    }
  }

  // ── Build the road ribbon + curbs ──
  _buildRibbon(pts3d, halfW, elevation, color) {
    const n = pts3d.length;
    const Y = elevation;

    // Precompute per-point tangent and perpendicular in XZ plane
    const perps = [];
    for (let i = 0; i < n; i++) {
      let dx, dz;
      if (i === 0) {
        dx = pts3d[1].x - pts3d[0].x;
        dz = pts3d[1].z - pts3d[0].z;
      } else if (i === n - 1) {
        dx = pts3d[n - 1].x - pts3d[n - 2].x;
        dz = pts3d[n - 1].z - pts3d[n - 2].z;
      } else {
        dx = pts3d[i + 1].x - pts3d[i - 1].x;
        dz = pts3d[i + 1].z - pts3d[i - 1].z;
      }
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      // Perpendicular: rotate tangent 90° in XZ plane → (-dz, dx) normalised
      perps.push({ px: -dz / len, pz: dx / len });
    }

    // ── Asphalt ribbon ──
    const roadPositions = new Float32Array(n * 2 * 3);
    const roadIndices   = [];
    for (let i = 0; i < n; i++) {
      const { px, pz } = perps[i];
      const p = pts3d[i];
      // Left edge  (index = i*2)
      roadPositions[i * 6 + 0] = p.x - px * halfW;
      roadPositions[i * 6 + 1] = Y + 0.01;
      roadPositions[i * 6 + 2] = p.z - pz * halfW;
      // Right edge (index = i*2+1)
      roadPositions[i * 6 + 3] = p.x + px * halfW;
      roadPositions[i * 6 + 4] = Y + 0.01;
      roadPositions[i * 6 + 5] = p.z + pz * halfW;
    }
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      roadIndices.push(a, b, c,  b, d, c);
    }
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.BufferAttribute(roadPositions, 3));
    roadGeo.setIndex(roadIndices);
    roadGeo.computeVertexNormals();
    const roadMat  = new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.receiveShadow = true;
    this._scene.add(roadMesh);
    this._meshes.push(roadMesh);

    // ── Centre dashed stripe ──
    // Single solid stripe for simplicity (dashes require more geometry)
    const stripeHalf = 0.5;
    const stripePositions = new Float32Array(n * 2 * 3);
    for (let i = 0; i < n; i++) {
      const { px, pz } = perps[i];
      const p = pts3d[i];
      stripePositions[i * 6 + 0] = p.x - px * stripeHalf;
      stripePositions[i * 6 + 1] = Y + 0.025;
      stripePositions[i * 6 + 2] = p.z - pz * stripeHalf;
      stripePositions[i * 6 + 3] = p.x + px * stripeHalf;
      stripePositions[i * 6 + 4] = Y + 0.025;
      stripePositions[i * 6 + 5] = p.z + pz * stripeHalf;
    }
    const stripeIndices = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      stripeIndices.push(a, b, c,  b, d, c);
    }
    const stripeGeo = new THREE.BufferGeometry();
    stripeGeo.setAttribute('position', new THREE.BufferAttribute(stripePositions, 3));
    stripeGeo.setIndex(stripeIndices);
    stripeGeo.computeVertexNormals();
    const stripeMat  = new THREE.MeshBasicMaterial({ color: 0xFFD700, side: THREE.DoubleSide });
    const stripeMesh = new THREE.Mesh(stripeGeo, stripeMat);
    this._scene.add(stripeMesh);
    this._meshes.push(stripeMesh);

    // ── Curb strips — both sides ──
    const CURB_W = 0.5;
    const CURB_H = 0.15;
    const CURB_COLOR = 0x888888;
    for (const side of [-1, 1]) {
      const curbPositions = new Float32Array(n * 4 * 3); // 4 verts per point (inner-bot, outer-bot, inner-top, outer-top)
      const curbIndices   = [];
      for (let i = 0; i < n; i++) {
        const { px, pz } = perps[i];
        const p = pts3d[i];
        const innerDist = halfW * side;
        const outerDist = (halfW + CURB_W) * side;
        const base = i * 12;
        // inner-bottom
        curbPositions[base + 0]  = p.x + px * innerDist;
        curbPositions[base + 1]  = Y;
        curbPositions[base + 2]  = p.z + pz * innerDist;
        // outer-bottom
        curbPositions[base + 3]  = p.x + px * outerDist;
        curbPositions[base + 4]  = Y;
        curbPositions[base + 5]  = p.z + pz * outerDist;
        // inner-top
        curbPositions[base + 6]  = p.x + px * innerDist;
        curbPositions[base + 7]  = Y + CURB_H;
        curbPositions[base + 8]  = p.z + pz * innerDist;
        // outer-top
        curbPositions[base + 9]  = p.x + px * outerDist;
        curbPositions[base + 10] = Y + CURB_H;
        curbPositions[base + 11] = p.z + pz * outerDist;
      }
      // Top face only (simplified — no side walls, just the top ribbon)
      for (let i = 0; i < n - 1; i++) {
        const base = i * 4;
        const a = base + 2, b = base + 3, c = base + 6, d = base + 7; // top verts
        if (side === 1) {
          curbIndices.push(a, b, c,  b, d, c);
        } else {
          curbIndices.push(c, b, a,  c, d, b);
        }
      }
      const curbGeo = new THREE.BufferGeometry();
      curbGeo.setAttribute('position', new THREE.BufferAttribute(curbPositions, 3));
      curbGeo.setIndex(curbIndices);
      curbGeo.computeVertexNormals();
      const curbMat  = new THREE.MeshLambertMaterial({ color: CURB_COLOR, side: THREE.DoubleSide });
      const curbMesh = new THREE.Mesh(curbGeo, curbMat);
      curbMesh.receiveShadow = true;
      this._scene.add(curbMesh);
      this._meshes.push(curbMesh);
    }
  }

  // ── Build cylindrical support pillars every ~20 world units ──
  _buildPillars(pts3d, elevation) {
    const pillarGeo = new THREE.CylinderGeometry(0.6, 0.8, elevation, 8);
    const pillarMat = new THREE.MeshLambertMaterial({ color: 0x999999 });
    const pillarY   = elevation * 0.5;

    let distAccum = 0;
    let lastPillarDist = 0;

    for (let i = 1; i < pts3d.length; i++) {
      const dx = pts3d[i].x - pts3d[i - 1].x;
      const dz = pts3d[i].z - pts3d[i - 1].z;
      distAccum += Math.sqrt(dx * dx + dz * dz);

      if (distAccum - lastPillarDist >= 20) {
        const p = pts3d[i];
        const mesh = new THREE.Mesh(pillarGeo, pillarMat);
        mesh.position.set(p.x, pillarY, p.z);
        mesh.castShadow    = true;
        mesh.receiveShadow = true;
        this._scene.add(mesh);
        this._meshes.push(mesh);
        lastPillarDist = distAccum;
      }
    }
  }
}
