import * as THREE from 'three';
import { DESKTOP_EYE, DESKTOP_LOOK, TABLE_CENTER, TABLE_RADIUS, fitHeightOffset, nameplatePosition } from './layout.js';

/**
 * What must always fit on a desktop screen: every other player's nameplate (at its largest size),
 * the far edge of the table and your own hand of cards. `n` = players at the table, or null for
 * any table size (menus).
 */
function desktopContentPoints(n) {
  const points = [];
  for (const players of n ? [n] : [3, 4, 5, 6]) {
    for (let seat = 1; seat < players; seat++) {
      const p = nameplatePosition(seat, players);
      for (const dx of [-0.26, 0.26]) for (const dy of [-0.12, 0.13]) points.push(p.clone().add(new THREE.Vector3(dx, dy, 0)));
    }
  }
  for (const x of [-0.34, 0.34]) for (const y of [0.8, 0.95]) points.push(new THREE.Vector3(x, y, -0.12)); // your hand
  points.push(TABLE_CENTER.clone().add(new THREE.Vector3(0, 0, -TABLE_RADIUS))); // far edge of the table
  return points;
}

const XR_FEATURES = ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'];

/** Renderer, camera rig, environment and the frame loop. */
export class World {
  constructor(container) {
    const renderer = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    container.appendChild(renderer.domElement);

    this.scene = new THREE.Scene();
    this.background = new THREE.Color(0x0b0d1a);
    this.fog = new THREE.Fog(0x0b0d1a, 7, 22);
    this.scene.background = this.background;
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(66, window.innerWidth / window.innerHeight, 0.03, 60);
    // The rig is the player's origin; in VR the headset and controllers move within it.
    this.rig = new THREE.Group();
    this.rig.add(this.camera);
    this.scene.add(this.rig);

    const dir = DESKTOP_LOOK.clone().sub(DESKTOP_EYE);
    this.baseYaw = Math.atan2(-dir.x, -dir.z);
    this.#frameContent(); // sets basePitch
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.zoom = 1;
    this.applyDesktopView();

    this.updaters = [];
    this.timer = new THREE.Timer();
    this.timer.connect(document);
    this.elapsed = 0;
    // Passthrough (mixed reality on Quest): your real room replaces the tower. `headsetView` is the
    // player's choice; `passthrough` is what's showing right now (only ever true inside a headset).
    this.room = new THREE.Group(); // tower-only scenery, hidden in passthrough
    this.woodTable = new THREE.Group();
    this.glassTable = new THREE.Group();
    this.headsetView = 'vr';
    this.passthrough = false;
    this.arSupported = false;
    this.vrSupported = false;
    this.onPassthroughChange = [];
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
      document.body.classList.remove('passthrough-preview');
      // 'alpha-blend' (or 'additive') means the headset shows the real world behind our pixels.
      this.#setPassthrough(renderer.xr.getEnvironmentBlendMode() !== 'opaque');
      this.camera.position.set(0, 0, 0); // drop the desktop pose so it can't be mistaken for head height
      if (this.posture === 'standing') this.pendingFit = true;
    });
    renderer.xr.addEventListener('sessionend', () => {
      this.#showDesktopView();
      this.#updateXrButton();
      this.rig.position.y = 0;
      this.applyDesktopView();
    });
    this.fitCamera();
    window.addEventListener('resize', () => {
      this.fitCamera();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    this.xrButton = document.createElement('button');
    this.xrButton.id = 'VRButton';
    this.xrButton.hidden = true; // only shown once we know a headset can be used
    this.xrButton.addEventListener('click', () => (this.isXR ? renderer.xr.getSession()?.end() : this.enterXR()));
    document.body.appendChild(this.xrButton);
    this.xrReady = this.#checkXrSupport();

    renderer.setAnimationLoop((timestamp) => this.frame(timestamp));
    this.enterVrIfInstalledApp();
  }

  async #checkXrSupport() {
    const supported = async (mode) => {
      try {
        return (await navigator.xr?.isSessionSupported(mode)) === true;
      } catch {
        return false;
      }
    };
    [this.vrSupported, this.arSupported] = await Promise.all([supported('immersive-vr'), supported('immersive-ar')]);
    this.#updateXrButton();
  }

  #updateXrButton() {
    const b = this.xrButton;
    const wantsPassthrough = this.headsetView === 'passthrough' && this.arSupported;
    // No headset available (most PCs and phones): no button at all.
    b.hidden = !this.vrSupported && !this.arSupported;
    if (this.isXR) b.textContent = 'EXIT VR';
    else b.textContent = wantsPassthrough ? 'ENTER PASSTHROUGH' : 'ENTER VR';
  }

  /** Start a headset session in the chosen view. Must run from a user gesture (click, tap, trigger). */
  async enterXR() {
    await this.xrReady;
    const mode = this.headsetView === 'passthrough' && this.arSupported ? 'immersive-ar' : 'immersive-vr';
    if (mode === 'immersive-vr' && !this.vrSupported) return;
    const session = await navigator.xr.requestSession(mode, { optionalFeatures: XR_FEATURES });
    await this.renderer.xr.setSession(session);
    this.#updateXrButton();
  }

  /**
   * Choose the headset view ('vr' | 'passthrough'). Inside a headset this switches straight away by
   * starting a new session of the other kind, which works when called from a trigger press on a button.
   * If the headset refuses, the choice still applies next time you enter.
   */
  async setHeadsetView(view) {
    if (view === this.headsetView) return;
    this.headsetView = view;
    this.#updateXrButton();
    const session = this.renderer.xr.getSession();
    if (!session) {
      this.#showDesktopView();
      return;
    }
    if (this.passthrough === (view === 'passthrough')) return;
    if (view === 'passthrough' && !this.arSupported) return;
    try {
      await session.end();
      await this.enterXR();
    } catch (err) {
      console.warn('Could not switch the headset view; it applies next time you enter.', err);
    }
  }

  /** Show the tower (false) or let the real room show through (true). */
  #setPassthrough(on) {
    if (on === this.passthrough) return;
    this.passthrough = on;
    this.room.visible = !on;
    this.woodTable.visible = !on;
    this.glassTable.visible = on;
    // A transparent clear colour is what lets the headset's cameras show through.
    this.scene.background = on ? null : this.background;
    this.scene.fog = on ? null : this.fog;
    this.renderer.setClearColor(0x000000, on ? 0 : 1);
    for (const fn of this.onPassthroughChange) fn(on);
  }

  /**
   * Outside a headset there's no camera to show through, so "My room" previews the look instead:
   * glass table, see-through cards and ghost heads over a plain stand-in backdrop (body.passthrough-preview).
   */
  #showDesktopView() {
    const preview = this.headsetView === 'passthrough';
    document.body.classList.toggle('passthrough-preview', preview);
    this.#setPassthrough(preview);
  }

  /**
   * When the game runs as the installed Quest app (a packaged PWA), launch straight into VR like
   * any other headset game. Tapping the app icon counts as the user gesture WebXR needs.
   * getDigitalGoodsService only exists inside a packaged app, so browsers keep the 2D page.
   */
  async enterVrIfInstalledApp() {
    if (window.getDigitalGoodsService === undefined || !navigator.xr?.isSessionSupported) return;
    try {
      await this.enterXR(); // in the player's chosen view: tower or passthrough
    } catch (err) {
      console.warn('Could not start VR automatically; the Enter VR button still works.', err);
    }
  }

  get isXR() {
    return this.renderer.xr.isPresenting;
  }

  /**
   * Aim the desktop camera at the middle of everything that must be visible (nameplates above,
   * your hand below), and note how far out that content reaches, as tangents in camera space.
   */
  #frameContent(n = null) {
    const points = desktopContentPoints(n);
    const yawOnly = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.baseYaw, 0)).invert();
    let top = -Infinity;
    let bottom = Infinity;
    for (const p of points) {
      const v = p.clone().sub(DESKTOP_EYE).applyQuaternion(yawOnly);
      const elevation = Math.atan2(v.y, -v.z);
      top = Math.max(top, elevation);
      bottom = Math.min(bottom, elevation);
    }
    this.basePitch = (top + bottom) / 2;
    const view = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.basePitch, this.baseYaw, 0, 'YXZ')).invert();
    this.contentTanX = 0;
    this.contentTanY = 0;
    for (const p of points) {
      const v = p.clone().sub(DESKTOP_EYE).applyQuaternion(view);
      this.contentTanX = Math.max(this.contentTanX, Math.abs(v.x) / -v.z);
      this.contentTanY = Math.max(this.contentTanY, Math.abs(v.y) / -v.z);
    }
  }

  /** Frame the desktop view for a table of `n` players (null: any size, e.g. in menus). */
  setPlayerCount(n) {
    if (n === this.framedFor) return;
    this.framedFor = n;
    this.#frameContent(n);
    this.fitCamera();
    if (!this.isXR) this.applyDesktopView();
  }

  /** Desktop: the narrowest view that still shows all the nameplates, the table and your hand. */
  fitCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    const margin = 1.08;
    const tanY = Math.max(this.contentTanY, this.contentTanX / aspect) * margin;
    // Very tall, narrow windows (phones held upright) would need a fisheye view; cap it there.
    const vfov = Math.min(2 * Math.atan(tanY), THREE.MathUtils.degToRad(100));
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
    const room = this.room;
    const woodTable = this.woodTable;
    s.add(room, woodTable, this.glassTable);
    this.glassTable.visible = false;
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
    room.add(floor);

    const rug = new THREE.Mesh(new THREE.CircleGeometry(2.0, 64), new THREE.MeshStandardMaterial({ color: 0x4a1f33, roughness: 1 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(x, 0.003, z);
    room.add(rug);

    const wood = new THREE.MeshStandardMaterial({ color: 0x5b3a22, roughness: 0.6 });
    const felt = new THREE.Mesh(
      new THREE.CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS, 0.03, 64),
      new THREE.MeshStandardMaterial({ color: 0x1d5a3c, roughness: 0.95 }),
    );
    felt.position.set(x, top - 0.015, z);
    woodTable.add(felt);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(TABLE_RADIUS + 0.02, 0.035, 16, 96), wood);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(x, top - 0.01, z);
    woodTable.add(rim);
    const apron = new THREE.Mesh(new THREE.CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS * 0.95, 0.1, 64), wood);
    apron.position.set(x, top - 0.08, z);
    woodTable.add(apron);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, top - 0.1, 24), wood);
    leg.position.set(x, (top - 0.1) / 2, z);
    woodTable.add(leg);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.05, 32), wood);
    foot.position.set(x, 0.025, z);
    woodTable.add(foot);

    // Passthrough table: a faint glass disc with a glowing gold rim, so the cards seem to float
    // over your real room (or your real table) without hiding it.
    const glass = new THREE.Mesh(
      new THREE.CircleGeometry(TABLE_RADIUS, 96),
      new THREE.MeshBasicMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }),
    );
    glass.rotation.x = -Math.PI / 2;
    glass.position.set(x, top - 0.012, z);
    const glowRim = new THREE.Mesh(
      new THREE.TorusGeometry(TABLE_RADIUS, 0.006, 8, 128),
      new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.85, toneMapped: false }),
    );
    glowRim.rotation.x = Math.PI / 2;
    glowRim.position.set(x, top - 0.01, z);
    const innerRing = new THREE.Mesh(
      new THREE.RingGeometry(TABLE_RADIUS * 0.42, TABLE_RADIUS * 0.425, 96),
      new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.35, toneMapped: false, depthWrite: false }),
    );
    innerRing.rotation.x = -Math.PI / 2;
    innerRing.position.set(x, top - 0.011, z);
    this.glassTable.add(glass, glowRim, innerRing);

    // Stone pillars in the gloom
    const stone = new THREE.MeshStandardMaterial({ color: 0x2b2838, roughness: 0.9 });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 5, 16), stone);
      pillar.position.set(x + Math.sin(a) * 6, 2.5, z + Math.cos(a) * 6);
      room.add(pillar);
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
    room.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xfff4d8, size: 0.12, fog: false })));

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
