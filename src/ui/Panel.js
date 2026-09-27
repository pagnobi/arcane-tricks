import * as THREE from 'three';
import { drawButton, drawSlider, drawToggle } from './draw.js';

/**
 * A flat in-world UI surface drawn with Canvas 2D. Works identically for mouse and
 * VR laser pointers: the Pointer hands us the ray hit's UV, which we map to canvas pixels.
 *
 * `draw(ctx, panel)` repaints everything and registers controls via panel.button()/toggle()/slider().
 */
export class Panel {
  /** Optional global hook fired on every button press (used for the click sound). */
  static onButtonClick = null;

  constructor({ width, height, ppm = 1000, draw = () => {} }) {
    this.ppm = ppm;
    this.draw = draw;
    this.buttons = [];
    this.hoverId = null;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.material = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.02, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.dragging = null; // slider currently held down
    this.mesh.userData.interactive = {
      hover: (hit) => {
        if (this.dragging) this.#applySlider(this.dragging, hit);
        this.#hover(hit);
      },
      unhover: () => {
        this.dragging = null;
        this.#hover(null);
      },
      press: (hit) => {
        const b = this.#pick(hit);
        if (b?.slider) {
          this.dragging = b;
          this.#applySlider(b, hit);
        }
      },
      release: () => {
        this.dragging = null;
      },
      click: (hit) => {
        const button = this.#pick(hit);
        if (!button || button.slider) return;
        Panel.onButtonClick?.();
        button.onClick?.();
      },
      isActive: (hit) => !!this.#pick(hit),
    };
    this.setSize(width, height);
  }

  get pxWidth() {
    return this.canvas.width;
  }

  get pxHeight() {
    return this.canvas.height;
  }

  setSize(width, height, ppm = this.ppm) {
    if (this.width === width && this.height === height && this.ppm === ppm) return;
    this.ppm = ppm;
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * this.ppm);
    this.canvas.height = Math.round(height * this.ppm);
    // Texture storage is immutable once uploaded, so a new size needs a new texture.
    this.texture?.dispose();
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.material.map = this.texture;
    this.material.needsUpdate = true;
    this.mesh.scale.set(width, height, 1);
  }

  render() {
    this.ctx.clearRect(0, 0, this.pxWidth, this.pxHeight);
    this.buttons = [];
    this.draw(this.ctx, this);
    this.texture.needsUpdate = true;
  }

  button(id, rect, label, opts = {}) {
    const hover = this.hoverId === id && !opts.disabled;
    this.buttons.push({ id, ...rect, disabled: !!opts.disabled, onClick: opts.onClick });
    drawButton(this.ctx, { ...rect, label, hover, disabled: opts.disabled, primary: opts.primary, selected: opts.selected, size: opts.size });
    opts.render?.(this.ctx, rect, { hover });
  }

  toggle(id, rect, label, checked, onClick) {
    this.buttons.push({ id, ...rect, disabled: false, onClick });
    drawToggle(this.ctx, { ...rect, label, checked, hover: this.hoverId === id });
  }

  /** A 0–1 slider: press (click / trigger) and drag along it. `onChange` gets the new value. */
  slider(id, rect, value, onChange) {
    const pad = 18; // generous vertical hit area, handy with a wobbly VR laser
    this.buttons.push({ id, x: rect.x, y: rect.y - pad, w: rect.w, h: rect.h + pad * 2, slider: true, onChange });
    drawSlider(this.ctx, { ...rect, value, hover: this.hoverId === id || this.dragging?.id === id });
  }

  #applySlider(b, hit) {
    if (!hit?.uv) return;
    const x = hit.uv.x * this.pxWidth;
    b.onChange(Math.round(THREE.MathUtils.clamp((x - b.x) / b.w, 0, 1) * 100) / 100);
  }

  #pick(hit) {
    if (!hit?.uv) return null;
    const x = hit.uv.x * this.pxWidth;
    const y = (1 - hit.uv.y) * this.pxHeight;
    return this.buttons.find((b) => !b.disabled && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) ?? null;
  }

  #hover(hit) {
    const id = this.#pick(hit)?.id ?? null;
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.render();
    }
  }
}
