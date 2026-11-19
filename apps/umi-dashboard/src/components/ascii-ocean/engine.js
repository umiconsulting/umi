// Based on stackedlol/ascii-sharks, commit a0074c16 (MIT). See LICENSE.
import { AsciiRenderer } from './renderer';
import { World } from './world';
const STEP = 1 / 60;
const MAX_STEPS = 4;
/**
 * Wires World + AsciiRenderer to a canvas: fixed-timestep loop, resize,
 * pointer input, pausing off-screen, and prefers-reduced-motion.
 */
export class OceanEngine {
  canvas;
  world;
  renderer;
  raf = 0;
  last = 0;
  acc = 0;
  visible = true;
  reducedMotion;
  resizeObserver;
  intersectionObserver;
  disposed = false;
  constructor(canvas, sharks) {
    this.canvas = canvas;
    // Keep the upstream school density within the login scene.
    const population = Math.min(
      340,
      Math.max(18, Math.round((canvas.clientWidth * canvas.clientHeight) / 4400)),
    );
    this.world = new World(sharks, population);
    this.renderer = new AsciiRenderer(canvas);
    this.renderer.setFontFamily(getComputedStyle(canvas).fontFamily);
    // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS media query.
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.schedule();
    });
    this.intersectionObserver.observe(canvas);
    this.reducedMotion.addEventListener('change', this.onMotionPreference);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', this.onPointerLeave);
    window.addEventListener('blur', this.onPointerLeave);
    this.resize();
    // Canvas text can't trigger a webfont load; once the mono face is in, redraw.
    document.fonts
      ?.load(`600 16px ${getComputedStyle(canvas).fontFamily}`)
      .then(() => {
        if (!this.disposed && this.reducedMotion.matches) this.drawStill();
      })
      .catch(() => {
        /* A system monospace face remains available if the webfont fails. */
      });
    this.schedule();
  }
  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    this.reducedMotion.removeEventListener('change', this.onMotionPreference);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('pointermove', this.onPointerMove);
    document.documentElement.removeEventListener('pointerleave', this.onPointerLeave);
    window.removeEventListener('blur', this.onPointerLeave);
  }
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const previousWidth = this.world.width;
    const previousHeight = this.world.height;
    if (previousWidth && previousHeight) {
      const sx = rect.width / previousWidth;
      const sy = rect.height / previousHeight;
      const scale = Math.min(rect.width, rect.height) / Math.min(previousWidth, previousHeight);
      for (const sh of this.world.sharks) {
        sh.length *= scale;
        sh.orbitRadius *= scale;
        for (let k = 0; k < sh.nodes.length; k += 2) {
          sh.nodes[k] *= sx;
          sh.nodes[k + 1] *= sy;
        }
      }
      for (const fish of this.world.fish) {
        fish.x *= sx;
        fish.y *= sy;
      }
    }
    this.renderer.resize(rect.width, rect.height, dpr);
    this.world.resize(rect.width, rect.height, this.renderer.cellWidth, this.renderer.cellHeight);
    if (!previousWidth) {
      // Set the entry composition. The source simulation controls the motion.
      const mobile = rect.width <= 500;
      const poses = mobile
        ? [
            [0.68, 0.4, -0.35],
            [0.4, 0.78, 2.8],
          ]
        : [
            [0.43, 0.3, -0.5],
            [0.18, 0.38, -1.1],
            [0.86, 0.88, -2.8],
          ];
      const ordered = [...this.world.sharks].sort((a, b) => b.length - a.length);
      ordered.forEach((sh, index) => {
        const [x, y, heading] = poses[index % poses.length];
        sh.heading = heading;
        const segment = sh.length / (sh.nodes.length / 2 - 1);
        for (let k = 0; k < sh.nodes.length / 2; k++) {
          sh.nodes[k * 2] = rect.width * x - Math.cos(heading) * segment * k;
          sh.nodes[k * 2 + 1] = rect.height * y - Math.sin(heading) * segment * k;
        }
      });
    }
    if (this.reducedMotion.matches) this.drawStill();
  }
  schedule() {
    cancelAnimationFrame(this.raf);
    if (this.disposed || !this.visible || document.hidden || this.reducedMotion.matches) {
      this.canvas.dataset.motion = 'paused';
      return;
    }
    this.canvas.dataset.motion = 'running';
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }
  frame = (now) => {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < MAX_STEPS) {
      this.renderer.capturePrevious(this.world.sharks);
      this.world.step(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS) this.acc = 0;
    this.renderer.render(this.world, dt, this.acc / STEP);
    this.raf = requestAnimationFrame(this.frame);
  };
  /** Reduced motion: retain the entry composition or freeze the current simulation. */
  drawStill() {
    this.renderer.render(this.world, STEP);
  }
  onVisibilityChange = () => this.schedule();
  onMotionPreference = () => {
    if (this.reducedMotion.matches) {
      cancelAnimationFrame(this.raf);
      this.canvas.dataset.motion = 'paused';
      this.drawStill();
    } else {
      this.schedule();
    }
  };
  toLocal(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
    return { x, y, inside };
  }
  onPointerMove = (e) => {
    const { x, y, inside } = this.toLocal(e);
    const p = this.world.pointer;
    p.x = x;
    p.y = y;
    p.active = inside && e.pointerType !== 'touch';
  };
  onPointerLeave = () => {
    this.world.pointer.active = false;
  };
}
