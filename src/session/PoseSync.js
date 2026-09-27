import * as THREE from 'three';
import { SEATED_EYE_HEIGHT } from '../scene/layout.js';

const XR_HZ = 12;
const DESKTOP_HZ = 4;

const round = (v) => Math.round(v * 1000) / 1000;

/**
 * Samples where your head and hands are (in your own seat-0 frame) and hands it to `send`.
 * In VR that's the headset and controllers/hands; on desktop it's a head at the seat that turns
 * wherever you look. Also doubles as a keep-alive for the connection.
 */
export class PoseSync {
  constructor(world) {
    this.world = world;
    this.timer = null;
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.grips = [0, 1].map((i) => world.renderer.xr.getControllerGrip(i));
  }

  sample() {
    const { camera, isXR } = this.world;
    camera.getWorldQuaternion(this.quat);
    const q = [this.quat.x, this.quat.y, this.quat.z, this.quat.w].map(round);
    if (!isXR) return { h: [0, SEATED_EYE_HEIGHT, 0, ...q], l: null, r: null };
    camera.getWorldPosition(this.pos);
    const hands = this.grips.map((grip) => {
      if (!grip.visible) return null; // not tracked right now
      grip.getWorldPosition(this.pos);
      return [round(this.pos.x), round(this.pos.y), round(this.pos.z)];
    });
    camera.getWorldPosition(this.pos);
    return { h: [round(this.pos.x), round(this.pos.y), round(this.pos.z), ...q], l: hands[0], r: hands[1] };
  }

  start(send) {
    this.stop();
    let last = 0;
    this.timer = setInterval(() => {
      const hz = this.world.isXR ? XR_HZ : DESKTOP_HZ;
      const now = performance.now();
      if (now - last < 1000 / hz - 5) return;
      last = now;
      send(this.sample());
    }, 1000 / XR_HZ);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }
}
