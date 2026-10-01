import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { DESKTOP_EYE, DESKTOP_LOOK, TABLE_CENTER, TABLE_RADIUS, fitHeightOffset } from './layout.js';

/** Renderer, camera rig, environment and the frame loop. */
export class World {
  constructor(container) {
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    container.appendChild(renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0d1a);
    this.scene.fog = new THREE.Fog(0x0b0d1a, 7, 22);

    this.camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.03, 60);
    // The rig is the player's origin; in VR the headset and controllers move within it.
    this.rig = new THREE.Group();
    this.rig.add(this.camera);
    this.scene.add(this.rig);

    const dir = DESKTOP_LOOK.clone().sub(DESKTOP_EYE);
    this.baseYaw = Math.atan2(-dir.x, -dir.z);
    this.basePitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.zoom = 1;
    this.applyDesktopView();

    this.updaters = [];
    this.timer = new THREE.Timer();
    this.timer.connect(document);
    this.elapsed = 0;
    this.buildEnvironment();

    // VR posture. Seated = real floor (sit in a chair). Standing = the world shifts so your eyes
    // are at seated height, measured when you enter VR. Either can be re-fitted from Options.
    this.posture = 'seated';
    this.heightOffset = 0;
    this.pendingFit = false;
    this.onHeightFitted = null;
    this.xrFrames = 0;
    renderer.xr.addEventListener('sessionstart', () => {
      this.xrFrames = 0;
      this.camera.position.set(0, 0, 0); // drop the desktop pose so it can't be mistaken for head height
      if (this.posture === 'standing') this.pendingFit = true;
    });
    renderer.xr.addEventListener('sessionend', () => {
      this.rig.position.y = 0;
      this.applyDesktopView();
    });
    this.fitCamera();
    window.addEventListener('resize', () => {
      this.fitCamera();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    const vrButton = VRButton.createButton(renderer, {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'],
    });
    document.body.appendChild(vrButton);

    renderer.setAnimationLoop((timestamp) => this.frame(timestamp));
    this.enterVrIfInstalledApp();
  }

  /**
   * When the game runs as the installed Quest app (a packaged PWA), launch straight into VR like
   * any other headset game. Tapping the app icon counts as the user gesture WebXR needs.
   * getDigitalGoodsService only exists inside a packaged app, so browsers keep the 2D page.
   */
  async enterVrIfInstalledApp() {
    if (window.getDigitalGoodsService === undefined || !navigator.xr?.isSessionSupported) return;
    try {
      if (!(await navigator.xr.isSessionSupported('immersive-vr'))) return;
      const session = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'],
      });
      await this.renderer.xr.setSession(session);
    } catch (err) {
      console.warn('Could not start VR automatically; the Enter VR button still works.', err);
    }
  }

  get isXR() {
    return this.renderer.xr.isPresenting;
  }

  /** Keep a wide horizontal view on desktop so every seat stays visible in narrow windows. */
  fitCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    const hfov = THREE.MathUtils.degToRad(95);
    const vfov = THREE.MathUtils.clamp(2 * Math.atan(Math.tan(hfov / 2) / aspect), THREE.MathUtils.degToRad(60), THREE.MathUtils.degToRad(80));
    this.camera.aspect = aspect;
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(vfov / 2) / this.zoom));
    this.camera.updateProjectionMatrix();
  }

  /** Desktop scroll-wheel zoom (1×–3×), keeping the point under the cursor in place. */
  zoomBy(deltaY, ndc) {
    if (this.isXR) return;
    const before = this.#anglesAt(ndc);
    this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(-deltaY * 0.0015), 1, 3);
    this.fitCamera();
    const after = this.#anglesAt(ndc);
    this.#setLook(this.lookYaw - (before.x - after.x), this.lookPitch + (before.y - after.y));
  }

  /** Horizontal/vertical angle from the view centre to a screen point. */
  #anglesAt(ndc) {
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    return { x: Math.atan(ndc.x * tan * this.camera.aspect), y: Math.atan(ndc.y * tan) };
  }

  #setLook(yaw, pitch) {
    this.lookYaw = THREE.MathUtils.clamp(yaw, -1.4, 1.4);
    this.lookPitch = THREE.MathUtils.clamp(pitch, -0.5, 0.8);
    if (!this.isXR) this.applyDesktopView();
  }

  onUpdate(fn) {
    this.updaters.push(fn);
  }

  /** Desktop only: right-drag to look around the room. */
  look(dx, dy) {
    const speed = 0.004 / this.zoom;
    this.#setLook(this.lookYaw - dx * speed, this.lookPitch - dy * speed);
  }

  applyDesktopView() {
    this.camera.position.copy(DESKTOP_EYE);
    this.camera.rotation.set(this.basePitch + this.lookPitch, this.baseYaw + this.lookYaw, 0, 'YXZ');
  }

  setPosture(posture) {
    this.posture = posture;
    if (posture === 'standing') this.pendingFit = true;
    else this.heightOffset = 0;
  }

  /** Measure the headset on the next VR frame and fit the table to it. */
  fitHeight() {
    this.pendingFit = true;
  }

  #updateHeight() {
    if (!this.isXR) {
      this.rig.position.y = 0;
      return;
    }
    this.xrFrames += 1;
    // Skip the first frames: until XR has rendered, the camera still holds the desktop pose.
    if (this.pendingFit && this.xrFrames > 5) {
      // In VR the camera's local position is the headset pose relative to the floor.
      const offset = fitHeightOffset(this.camera.position.y);
      if (offset !== null) {
        this.heightOffset = offset;
        this.pendingFit = false;
        this.onHeightFitted?.(offset);
      }
    }
    this.rig.position.y = this.heightOffset;
  }

  frame(timestamp) {
    this.timer.update(timestamp);
    this.#updateHeight();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.elapsed += dt;
    for (const fn of this.updaters) fn(dt, this.elapsed);
    this.renderer.render(this.scene, this.camera);
  }

  buildEnvironment() {
    const s = this.scene;
    const { x, y: top, z } = TABLE_CENTER;

    s.add(new THREE.HemisphereLight(0xaab4ff, 0x2a1d12, 1.1));
    const lamp = new THREE.PointLight(0xffd29a, 7, 0, 1.6);
    lamp.position.set(x, 2.3, z);
    s.add(lamp);
    const key = new THREE.DirectionalLight(0xffffff, 0.6);
    key.position.set(1, 3, 2);
    s.add(key);

    const floor = new THREE.Mesh(new THREE.CircleGeometry(16, 64), new THREE.MeshStandardMaterial({ color: 0x16131f, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    s.add(floor);

    const rug = new THREE.Mesh(new THREE.CircleGeometry(2.0, 64), new THREE.MeshStandardMaterial({ color: 0x4a1f33, roughness: 1 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(x, 0.003, z);
    s.add(rug);

    const wood = new THREE.MeshStandardMaterial({ color: 0x5b3a22, roughness: 0.6 });
    const felt = new THREE.Mesh(
      new THREE.CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS, 0.03, 64),
      new THREE.MeshStandardMaterial({ color: 0x1d5a3c, roughness: 0.95 }),
    );
    felt.position.set(x, top - 0.015, z);
    s.add(felt);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(TABLE_RADIUS + 0.02, 0.035, 16, 96), wood);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(x, top - 0.01, z);
    s.add(rim);
    const apron = new THREE.Mesh(new THREE.CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS * 0.95, 0.1, 64), wood);
    apron.position.set(x, top - 0.08, z);
    s.add(apron);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, top - 0.1, 24), wood);
    leg.position.set(x, (top - 0.1) / 2, z);
    s.add(leg);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.05, 32), wood);
    foot.position.set(x, 0.025, z);
    s.add(foot);

    // Stone pillars in the gloom
    const stone = new THREE.MeshStandardMaterial({ color: 0x2b2838, roughness: 0.9 });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 5, 16), stone);
      pillar.position.set(x + Math.sin(a) * 6, 2.5, z + Math.cos(a) * 6);
      s.add(pillar);
    }

    // Starfield
    const starPositions = [];
    for (let i = 0; i < 900; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.9 + 0.1);
      const r = 30 + Math.random() * 10;
      starPositions.push(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    s.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xfff4d8, size: 0.12, fog: false })));

    // Floating candles
    const wax = new THREE.MeshStandardMaterial({ color: 0xefe4c8, roughness: 0.7 });
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffb347, toneMapped: false });
    const candles = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3;
      const candle = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 12), wax);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.04, 8), flameMat);
      flame.position.y = 0.1;
      candle.add(body, flame);
      candle.position.set(x + Math.sin(a) * 2.4, 1.7 + (i % 3) * 0.25, z + Math.cos(a) * 2.4);
      candle.userData.phase = i * 1.3;
      candle.userData.baseY = candle.position.y;
      candles.push(candle);
      s.add(candle);
    }
    this.onUpdate((dt, t) => {
      for (const c of candles) c.position.y = c.userData.baseY + Math.sin(t * 0.8 + c.userData.phase) * 0.05;
    });
  }
}
