// ════════════════════════════════════════════════════════════════════
//  car.js — Car mesh builder
//  Exports: buildCar() → THREE.Group
//           carWheelMeshes → Array of wheel pivot groups [FL,FR,RL,RR]
// ════════════════════════════════════════════════════════════════════

// Wheel mesh references for spin animation (populated by buildCar)
var carWheelMeshes = [];

function buildCar() {
  carWheelMeshes = [];

  const group = new THREE.Group();

  // ── Inner tilt group — body + cab tilt during turns/drift ──
  const bodyGroup = new THREE.Group();
  group.add(bodyGroup);

  const carRed    = new THREE.MeshLambertMaterial({ color: 0xe63946 });
  const carRedDk  = new THREE.MeshLambertMaterial({ color: 0xc0392b });
  const glassBlue = new THREE.MeshLambertMaterial({ color: 0x74b9ff, transparent: true, opacity: 0.8 });
  const bumperMat = new THREE.MeshLambertMaterial({ color: 0xcc2233 });
  const wheelMat  = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const hubMat    = new THREE.MeshLambertMaterial({ color: 0xaaaaaa });
  const hlMat     = new THREE.MeshBasicMaterial({ color: 0xfffde7 });
  const tlMat     = new THREE.MeshBasicMaterial({ color: 0xff3333 });

  // Main body — wide chunky box
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 3.8), carRed);
  body.position.set(0, 0.5, 0);
  body.castShadow = true;
  bodyGroup.add(body);

  // Cab (roof section) — narrower, taller, slightly back from center
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 2.0), carRed);
  cab.position.set(0, 1.1, -0.2);
  cab.castShadow = true;
  bodyGroup.add(cab);

  // Windshield — front face of cab
  const windFront = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.6, 0.06), glassBlue);
  windFront.position.set(0, 1.1, 0.81);
  bodyGroup.add(windFront);

  // Rear window
  const windRear = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.55, 0.06), glassBlue);
  windRear.position.set(0, 1.1, -1.21);
  bodyGroup.add(windRear);

  // Front bumper
  const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.3, 0.18), bumperMat);
  frontBumper.position.set(0, 0.32, 1.99);
  bodyGroup.add(frontBumper);

  // Rear bumper
  const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.3, 0.18), bumperMat);
  rearBumper.position.set(0, 0.32, -1.99);
  bodyGroup.add(rearBumper);

  // Headlights
  for (const hx of [-0.75, 0.75]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.2, 0.08), hlMat);
    hl.position.set(hx, 0.52, 1.96);
    bodyGroup.add(hl);
  }
  // Tail lights
  for (const hx of [-0.75, 0.75]) {
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.2, 0.08), tlMat);
    tl.position.set(hx, 0.52, -1.96);
    bodyGroup.add(tl);
  }

  // ── Wheels ──
  const wheelPositions = [
    [-1.25, 0.45,  1.2],  // FL
    [ 1.25, 0.45,  1.2],  // FR
    [-1.25, 0.45, -1.2],  // RL
    [ 1.25, 0.45, -1.2],  // RR
  ];
  const wheelGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.3, 12);
  const hubGeo   = new THREE.CylinderGeometry(0.18, 0.18, 0.32, 8);

  for (const [wx, wy, wz] of wheelPositions) {
    const wheelPivot = new THREE.Group();
    wheelPivot.position.set(wx, wy, wz);
    group.add(wheelPivot);

    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.castShadow = true;
    wheelPivot.add(w);

    const hub = new THREE.Mesh(hubGeo, hubMat);
    hub.rotation.z = Math.PI / 2;
    wheelPivot.add(hub);

    carWheelMeshes.push(wheelPivot);
  }

  // ── Soft shadow ellipse ──
  const shadowGeo = new THREE.PlaneGeometry(3.2, 5.0, 1, 1);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.35,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.set(0, -0.44, 0);
  group.add(shadowMesh);

  return group;
}
