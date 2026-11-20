import { useEffect, useRef } from 'react';
import { OceanEngine } from './ascii-ocean/engine.js';
import { attachLoginGlass } from '@/lib/login-glass/material.js';

export default function LoginGoldfish() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS media query.
    const narrow = window.matchMedia('(max-width: 840px), (max-height: 500px)');
    const layout = canvas.closest('.login-wrap');
    // eslint-disable-next-line lingui/no-unlocalized-strings -- CSS selectors.
    const content = [...layout.querySelectorAll('.login-brandmark, .login-hero, .login-form')];
    let engine;
    const updateSpace = () => {
      if (!engine) return;
      const scene = canvas.getBoundingClientRect();
      engine.world.contentRegions = content.flatMap((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width && rect.height
          ? [
              {
                left: rect.left - scene.left,
                top: rect.top - scene.top,
                right: rect.right - scene.left,
                bottom: rect.bottom - scene.top,
              },
            ]
          : [];
      });
    };
    const observer = new ResizeObserver(updateSpace);
    observer.observe(layout);
    content.forEach((element) => observer.observe(element));
    const start = () => {
      engine?.destroy();
      const sizes = narrow.matches ? [1] : [0.95, 0.7, 0.52];
      try {
        engine = new OceanEngine(
          canvas,
          sizes.map((size) => ({ kind: 'goldfish', size })),
        );
        if (narrow.matches) {
          // Start in the open space above the task. The simulation then steers freely.
          const scene = canvas.getBoundingClientRect();
          const form = layout.querySelector('.login-form').getBoundingClientRect();
          const headY = Math.max(70, Math.min(140, (form.top - scene.top) * 0.6));
          for (const fish of engine.world.sharks) {
            const offset = headY - fish.nodes[1];
            for (let index = 1; index < fish.nodes.length; index += 2) fish.nodes[index] += offset;
          }
          engine.drawStill();
        }
        updateSpace();
        canvas.hidden = false;
        canvas.dataset.ready = 'true';
      } catch {
        // El formulario permanece disponible si el navegador bloquea Canvas.
        engine = undefined;
        canvas.hidden = true;
        canvas.dataset.ready = 'unavailable';
      }
    };
    start();
    const disposeGlass = attachLoginGlass(layout);
    narrow.addEventListener('change', start);
    return () => {
      narrow.removeEventListener('change', start);
      observer.disconnect();
      disposeGlass();
      engine?.destroy();
    };
  }, []);

  return (
    <div className="login-goldfish" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
