import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';

/**
 * One pointing system for mouse, touch, VR controllers and hand tracking (pinch = select).
 *
 * Any object with `userData.interactive = { hover(hit), unhover(), click(hit), press?(hit), release?(),
 * isActive?(hit), cursor? }` that is registered with add() can be pointed at. hover() is called every
 * frame while pointed at; press/release bracket a held button or trigger (for dragging).
 */
export class Pointer {
  constructor(world) {
    this.world = world;
    this.targets = [];
    this.raycaster = new THREE.Raycaster();
    this.mouse = { ndc: new THREE.Vector2(), inside: false, hovered: null, hit: null };
    this.sources = [];
    this.#setupMouse();
    this.#setupXR();
    world.onUpdate(() => this.update());
  }

  add(object) {
    this.targets.push(object);
  }

  #setupMouse() {
    const el = this.world.renderer.domElement;
    let down = null;
    let dragFrom = null;
    const setNdc = (e) => {
      const r = el.getBoundingClientRect();
      this.mouse.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.mouse.inside = true;
    };
    el.addEventListener('pointermove', (e) => {
      setNdc(e);
      if (dragFrom) {
        this.world.look(e.clientX - dragFrom.x, e.clientY - dragFrom.y);
        dragFrom = { x: e.clientX, y: e.clientY };
      }
    });
    el.addEventListener('pointerleave', () => {
      this.mouse.inside = false;
    });
    el.addEventListener('pointerdown', (e) => {
      setNdc(e);
      if (e.button === 1 || e.button === 2) {
        dragFrom = { x: e.clientX, y: e.clientY };
        el.setPointerCapture(e.pointerId);
      } else if (e.button === 0) {
        down = { x: e.clientX, y: e.clientY };
        el.setPointerCapture(e.pointerId); // keep slider drags alive past the canvas edge
        this.raycaster.setFromCamera(this.mouse.ndc, this.world.camera);
        this.#setHover(this.mouse, this.#cast());
        this.#press(this.mouse);
      }
    });
    el.addEventListener('pointerup', (e) => {
      if (e.button === 1 || e.button === 2) {
        dragFrom = null;
        return;
      }
      if (e.button === 0) this.#release(this.mouse);
      if (e.button === 0 && down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8) {
        setNdc(e);
        this.raycaster.setFromCamera(this.mouse.ndc, this.world.camera);
        this.#setHover(this.mouse, this.#cast());
        this.#click(this.mouse);
      }
      down = null;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault(); // also stops trackpad pinch from zooming the page
        setNdc(e);
        this.world.zoomBy(e.deltaY, this.mouse.ndc);
      },
      { passive: false },
    );
  }

  #setupXR() {
    const { renderer } = this.world;
    const controllerModels = new XRControllerModelFactory();
    const handModels = new XRHandModelFactory();
    for (let i = 0; i < 2; i++) {
      const controller = renderer.xr.getController(i);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
        new THREE.LineBasicMaterial({ color: 0xffe7a3, transparent: true, opacity: 0.85 }),
      );
      line.scale.z = 3;
      line.visible = false;
      controller.add(line);

      const source = { controller, line, hovered: null, hit: null, connected: false };
      controller.addEventListener('connected', (e) => {
        source.connected = true;
        line.visible = e.data.targetRayMode === 'tracked-pointer';
      });
      controller.addEventListener('disconnected', () => {
        source.connected = false;
        line.visible = false;
        this.#setHover(source, null);
      });
      controller.addEventListener('selectstart', () => this.#press(source));
      controller.addEventListener('selectend', () => this.#release(source));
      controller.addEventListener('select', () => this.#click(source));
      this.world.rig.add(controller);

      const grip = renderer.xr.getControllerGrip(i);
      grip.add(controllerModels.createControllerModel(grip));
      this.world.rig.add(grip);

      const hand = renderer.xr.getHand(i);
      hand.add(handModels.createHandModel(hand, 'mesh'));
      this.world.rig.add(hand);

      this.sources.push(source);
    }
  }

  /** The first visible thing the ray hits decides: interactive → target, otherwise it blocks. */
  #cast() {
    const hits = this.raycaster.intersectObjects(this.targets, true);
    for (const hit of hits) {
      let o = hit.object;
      let target = null;
      let visible = true;
      while (o) {
        if (!o.visible) {
          visible = false;
          break;
        }
        if (!target && o.userData.interactive) target = o;
        o = o.parent;
      }
      if (!visible) continue;
      return target ? { target, hit } : null;
    }
    return null;
  }

  #setHover(source, result) {
    const target = result?.target ?? null;
    if (source.hovered && source.hovered !== target) source.hovered.userData.interactive?.unhover?.();
    source.hovered = target;
    source.hit = result?.hit ?? null;
    target?.userData.interactive?.hover?.(source.hit);
  }

  /** Button/trigger down — used for dragging sliders. */
  #press(source) {
    source.pressed = source.hovered;
    source.hovered?.userData.interactive?.press?.(source.hit);
  }

  #release(source) {
    source.pressed?.userData.interactive?.release?.();
    source.pressed = null;
  }

  #click(source) {
    source.hovered?.userData.interactive?.click?.(source.hit);
  }

  update() {
    if (this.world.isXR) {
      this.#setHover(this.mouse, null);
      for (const s of this.sources) {
        if (!s.connected) continue;
        const m = s.controller.matrixWorld;
        this.raycaster.ray.origin.setFromMatrixPosition(m);
        this.raycaster.ray.direction.set(0, 0, -1).transformDirection(m);
        const result = this.#cast();
        this.#setHover(s, result);
        s.line.scale.z = result ? result.hit.distance : 3;
      }
      return;
    }
    if (this.mouse.inside) {
      this.raycaster.setFromCamera(this.mouse.ndc, this.world.camera);
      this.#setHover(this.mouse, this.#cast());
    } else {
      this.#setHover(this.mouse, null);
    }
    const interactive = this.mouse.hovered?.userData.interactive;
    const active = interactive && (interactive.isActive?.(this.mouse.hit) ?? true);
    this.world.renderer.domElement.style.cursor = active ? (interactive.cursor ?? 'pointer') : '';
  }
}
