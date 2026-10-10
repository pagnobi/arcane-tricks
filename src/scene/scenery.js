import * as THREE from 'three';
import { TABLE_CENTER } from './layout.js';

// The room around the table. Each player picks their own in Options (prefs.scene); it's purely
// visual, so other players never need to know. Everything is built from code, no image files.
//
// A scene is { group, background, fog: [colour, near, far], hemi: [sky, ground, intensity], update? }.
// World shows one at a time and hides it in passthrough.

export const SCENES = [
  { id: 'tower', label: 'Tower', name: 'Wizard’s tower' },
  { id: 'forest', label: 'Forest', name: 'Moonlit forest' },
  { id: 'sky', label: 'Sky', name: 'Sky observatory' },
];
export const SCENE_IDS = SCENES.map((s) => s.id);

const { x: cx, z: cz } = TABLE_CENTER;

/** Repeatable "random" numbers, so a scene looks the same every time it's built. */
function seeded(seed) {
  let a = seed;
  return () => {
    a = (a * 16807) % 2147483647;
    return (a - 1) / 2147483646;
  };
}

/** A dome of stars. They ignore fog so they stay visible behind it. */
function stars(count, rand, { minUp = 0.1, size = 0.12 } = {}) {
  const positions = [];
  for (let i = 0; i < count; i++) {
    const theta = rand() * Math.PI * 2;
    const phi = Math.acos(rand() * (1 - minUp) + minUp);
    const r = 30 + rand() * 10;
    positions.push(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xfff4d8, size, fog: false }));
}

function disc(radius, color, y = 0) {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), new THREE.MeshStandardMaterial({ color, roughness: 1 }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(cx, y, cz);
  return mesh;
}

/** The original: a dark stone hall with pillars, under the stars. */
function tower() {
  const group = new THREE.Group();
  group.add(disc(16, 0x16131f), disc(2.0, 0x4a1f33, 0.003)); // floor and rug
  const stone = new THREE.MeshStandardMaterial({ color: 0x2b2838, roughness: 0.9 });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 5, 16), stone);
    pillar.position.set(cx + Math.sin(a) * 6, 2.5, cz + Math.cos(a) * 6);
    group.add(pillar);
  }
  group.add(stars(900, seeded(1)));
  return { group, background: 0x0b0d1a, fog: [0x0b0d1a, 7, 22], hemi: [0xaab4ff, 0x2a1d12, 1.1] };
}

/** A clearing among tall pines at night: mossy ground, glowing mushrooms and drifting fireflies. */
function forest() {
  const group = new THREE.Group();
  const rand = seeded(7);
  group.add(disc(20, 0x14261a), disc(2.6, 0x23402a, 0.002));

  const bark = new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 1 });
  const needles = [0x143322, 0x1a3f29, 0x0f2a1c].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 1 }));
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + rand() * 0.2;
    const r = 4.6 + rand() * 4.5;
    const h = 5 + rand() * 3;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.26, h, 10), bark);
    trunk.position.y = h / 2;
    tree.add(trunk);
    for (let k = 0; k < 3; k++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.5 - k * 0.38, 2.2, 12), needles[k]);
      cone.position.y = h * 0.45 + k * 1.15;
      tree.add(cone);
    }
    tree.position.set(cx + Math.sin(a) * r, 0, cz + Math.cos(a) * r);
    tree.rotation.y = rand() * Math.PI;
    group.add(tree);
  }

  // Glowing mushrooms around the edge of the clearing.
  const stem = new THREE.MeshStandardMaterial({ color: 0xd9d2bf, roughness: 1 });
  const cap = new THREE.MeshBasicMaterial({ color: 0x7fd6ff, toneMapped: false });
  for (let i = 0; i < 10; i++) {
    const a = rand() * Math.PI * 2;
    const r = 2.4 + rand() * 1.2;
    const s = 0.6 + rand() * 0.8;
    const mushroom = new THREE.Group();
    const m1 = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.12, 8), stem);
    m1.position.y = 0.06;
    const m2 = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), cap);
    m2.position.y = 0.11;
    mushroom.add(m1, m2);
    mushroom.scale.setScalar(s);
    mushroom.position.set(cx + Math.sin(a) * r, 0, cz + Math.cos(a) * r);
    group.add(mushroom);
  }

  // Fireflies: each drifts on its own slow loop.
  const count = 70;
  const base = [];
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2;
    const r = 1.6 + rand() * 5;
    base.push({ x: cx + Math.sin(a) * r, y: 0.4 + rand() * 2.4, z: cz + Math.cos(a) * r, phase: rand() * 10, speed: 0.3 + rand() * 0.5 });
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  const fireflies = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: 0xd8ff7a, size: 0.05, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  group.add(fireflies, stars(350, rand, { minUp: 0.5 }));
  const update = (dt, t) => {
    const pos = geometry.attributes.position;
    base.forEach((f, i) => {
      const u = t * f.speed + f.phase;
      pos.setXYZ(i, f.x + Math.sin(u) * 0.35, f.y + Math.sin(u * 1.7) * 0.2, f.z + Math.cos(u * 0.8) * 0.35);
    });
    pos.needsUpdate = true;
    fireflies.material.opacity = 0.7 + Math.sin(t * 2.3) * 0.2;
  };
  return { group, background: 0x07120d, fog: [0x07120d, 5, 19], hemi: [0x9fc9ff, 0x16240f, 1.0], update };
}

/** A round stone platform high above a sea of clouds, under a huge moon and turning brass rings. */
function sky() {
  const group = new THREE.Group();
  const rand = seeded(11);

  // The platform: a stone disc with a brass inlay, and a rocky base tapering into the clouds.
  const stone = new THREE.MeshStandardMaterial({ color: 0x5f5c72, roughness: 0.85 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a54c, roughness: 0.4, metalness: 0.6 });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.3, 64), stone);
  top.position.set(cx, -0.15, cz);
  const base = new THREE.Mesh(new THREE.ConeGeometry(2.5, 3, 32), new THREE.MeshStandardMaterial({ color: 0x3d3a4d, roughness: 1 }));
  base.rotation.x = Math.PI;
  base.position.set(cx, -1.8, cz);
  const inlay = new THREE.Mesh(new THREE.TorusGeometry(2.25, 0.025, 8, 96), brass);
  inlay.rotation.x = Math.PI / 2;
  inlay.position.set(cx, 0.005, cz);
  group.add(top, base, inlay);

  // Clouds below, slowly turning.
  const clouds = new THREE.Group();
  const puff = new THREE.MeshStandardMaterial({ color: 0xdfe4ff, roughness: 1, transparent: true, opacity: 0.92 });
  const ball = new THREE.SphereGeometry(1, 16, 10);
  for (let i = 0; i < 46; i++) {
    const a = rand() * Math.PI * 2;
    const r = 5 + rand() * 14;
    const cloud = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const p = new THREE.Mesh(ball, puff);
      const s = 0.9 + rand() * 1.4;
      p.scale.set(s * 1.6, s * 0.45, s);
      p.position.set((k - 1) * s * 1.3, rand() * 0.3, rand() * 0.6);
      cloud.add(p);
    }
    cloud.position.set(Math.sin(a) * r, -1.6 - rand() * 2.2, Math.cos(a) * r);
    cloud.rotation.y = rand() * Math.PI;
    clouds.add(cloud);
  }
  clouds.position.set(cx, 0, cz);

  // The moon, with a soft halo.
  const moon = new THREE.Mesh(new THREE.SphereGeometry(3.2, 32, 24), new THREE.MeshBasicMaterial({ color: 0xf4efd9, fog: false }));
  moon.position.set(-9, 11, -32);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(4.6, 32, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0.12, fog: false, depthWrite: false }),
  );
  halo.position.copy(moon.position);

  // An armillary: brass rings turning slowly high above the table.
  const rings = new THREE.Group();
  for (let k = 0; k < 3; k++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1 + k * 0.25, 0.018, 8, 96), brass);
    ring.rotation.set(Math.PI / 2 + k * 0.5, k * 0.7, 0);
    rings.add(ring);
  }
  rings.position.set(cx, 4.2, cz);

  group.add(clouds, moon, halo, rings, stars(1300, rand, { minUp: -0.2, size: 0.1 }));
  const update = (dt, t) => {
    clouds.rotation.y = t * 0.006;
    rings.rotation.y = t * 0.08;
    rings.children.forEach((ring, k) => (ring.rotation.z = t * (0.05 + k * 0.03)));
  };
  return { group, background: 0x111739, fog: [0x1a2150, 12, 48], hemi: [0xb8c4ff, 0x2a2440, 1.25], update };
}

const BUILDERS = { tower, forest, sky };

export function buildScene(id) {
  return (BUILDERS[id] ?? tower)();
}
