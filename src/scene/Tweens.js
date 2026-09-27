import * as THREE from 'three';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Minimal promise-based tweening of position / rotation / scale. One tween per object. */
export class Tweens {
  constructor() {
    this.active = new Map();
    // Background tabs get no animation frames. The game waits on animations, so if the host
    // switches tabs everyone would stall — instead, finish animations instantly while hidden.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.finishAll();
      });
    }
  }

  get #hidden() {
    return typeof document !== 'undefined' && document.hidden;
  }

  /** Jump every running tween to its end. */
  finishAll() {
    for (const [obj, tw] of [...this.active]) {
      this.active.delete(obj);
      tw.onStart?.();
      if (tw.toP) obj.position.copy(tw.toP);
      if (tw.toQ) obj.quaternion.copy(tw.toQ);
      if (tw.toS) obj.scale.copy(tw.toS);
      tw.resolve();
    }
  }

  /** `onStart` fires when the motion actually begins (after any delay) — handy for sounds. */
  to(obj, { position, quaternion, scale }, duration = 0.45, delay = 0, arc = 0, onStart = null) {
    this.cancel(obj);
    return new Promise((resolve) => {
      this.active.set(obj, {
        t: -delay,
        onStart,
        duration: Math.max(duration, 0.001),
        resolve,
        arc,
        fromP: obj.position.clone(),
        fromQ: obj.quaternion.clone(),
        fromS: obj.scale.clone(),
        toP: position?.clone() ?? null,
        toQ: quaternion?.clone() ?? null,
        toS: scale == null ? null : typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : scale.clone(),
      });
      if (this.#hidden) this.finishAll();
    });
  }

  /** Stop an object's tween where it is; its promise resolves immediately. */
  cancel(obj) {
    const tw = this.active.get(obj);
    if (!tw) return;
    this.active.delete(obj);
    tw.resolve();
  }

  update(dt) {
    for (const [obj, tw] of this.active) {
      tw.t += dt;
      if (tw.t < 0) continue;
      if (tw.onStart) {
        tw.onStart();
        tw.onStart = null;
      }
      const k = Math.min(1, tw.t / tw.duration);
      const e = ease(k);
      if (tw.toP) {
        obj.position.lerpVectors(tw.fromP, tw.toP, e);
        if (tw.arc) obj.position.y += Math.sin(Math.PI * k) * tw.arc;
      }
      if (tw.toQ) obj.quaternion.slerpQuaternions(tw.fromQ, tw.toQ, e);
      if (tw.toS) obj.scale.lerpVectors(tw.fromS, tw.toS, e);
      if (k >= 1) {
        this.active.delete(obj);
        tw.resolve();
      }
    }
  }
}
