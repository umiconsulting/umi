'use client';

import { useEffect, useState } from 'react';

const VERTEX = `
  attribute vec2 position;
  void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const FRAGMENT = `
  precision highp float;
  uniform vec2 resolution;
  uniform float time;

  const vec3 NAVY_DEEP = vec3(0.020, 0.039, 0.106);
  const vec3 NAVY = vec3(0.067, 0.118, 0.267);
  const vec3 SKY = vec3(0.463, 0.573, 0.796);

  float hash(vec2 point) {
    point = fract(point * vec2(234.34, 435.345));
    point += dot(point, point + 34.23);
    return fract(point.x * point.y);
  }

  float noise(vec2 point) {
    vec2 cell = floor(point), fraction = fract(point);
    float a = hash(cell), b = hash(cell + vec2(1.0, 0.0));
    float c = hash(cell + vec2(0.0, 1.0)), d = hash(cell + vec2(1.0, 1.0));
    vec2 smoothFraction = fraction * fraction * (3.0 - 2.0 * fraction);
    return mix(a, b, smoothFraction.x) + (c - a) * smoothFraction.y * (1.0 - smoothFraction.x) + (d - b) * smoothFraction.x * smoothFraction.y;
  }

  float fbm(vec2 point) {
    float value = 0.0, amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
      value += amplitude * noise(point);
      point = point * 2.02 + vec2(1.3, 5.7);
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec2 point = (gl_FragCoord.xy - 0.5 * resolution) / min(resolution.x, resolution.y);
    float drift = time * 0.06;
    vec3 color = mix(NAVY_DEEP, NAVY, smoothstep(-0.8, 0.8, point.y));
    float wave = fbm(point * 1.2 + vec2(drift, -drift * 0.4));
    color += SKY * 0.10 * wave;
    float band = sin((point.y + fbm(point * 1.6) * 0.12) * 14.0 - time * 0.35);
    color += SKY * smoothstep(0.85, 1.0, band) * 0.06;
    float broadBand = sin((point.y + fbm(point * 0.8 + 4.0) * 0.18) * 6.0 - time * 0.2);
    color += SKY * smoothstep(0.92, 1.0, broadBand) * 0.04;
    color *= 0.78 + 0.22 * (1.0 - smoothstep(0.4, 1.3, length(point)));
    color += (hash(gl_FragCoord.xy + drift) - 0.5) * 0.012;
    gl_FragColor = vec4(color, 1.0);
  }
`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('WebGL shader unavailable');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const reason = gl.getShaderInfoLog(shader) || 'WebGL shader failed';
    gl.deleteShader(shader);
    throw new Error(reason);
  }
  return shader;
}

function ShaderCanvas() {
  useEffect(() => {
    const canvas = document.getElementById('umi-shader-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { antialias: false, powerPreference: 'low-power' });
    if (!gl) return;

    let vertex: WebGLShader | undefined;
    let fragment: WebGLShader | undefined;
    let program: WebGLProgram | undefined;
    let buffer: WebGLBuffer | undefined;
    try {
      vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
      fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
      program = gl.createProgram() || undefined;
      buffer = gl.createBuffer() || undefined;
      if (!program || !buffer) throw new Error('WebGL program unavailable');
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('WebGL link failed');
    } catch {
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      return;
    }

    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    const resolution = gl.getUniformLocation(program, 'resolution');
    const time = gl.getUniformLocation(program, 'time');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    let frame = 0;
    let active = false;
    let inView = false;
    const started = performance.now();
    const resize = () => {
      const bounds = canvas.parentElement?.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
      const width = Math.max(1, Math.floor((bounds?.width || innerWidth) * dpr));
      const height = Math.max(1, Math.floor((bounds?.height || innerHeight) * dpr));
      if (canvas.width === width && canvas.height === height) return;
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    };
    const draw = () => {
      resize();
      gl.uniform2f(resolution, canvas.width, canvas.height);
      gl.uniform1f(time, (performance.now() - started) / 1000);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (active) frame = requestAnimationFrame(draw);
    };
    const update = () => {
      const shouldRun = inView && !document.hidden;
      if (shouldRun === active) return;
      active = shouldRun;
      if (active) frame = requestAnimationFrame(draw);
      else cancelAnimationFrame(frame);
    };
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry?.isIntersecting ?? false;
      update();
    });
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas.parentElement || canvas);
    observer.observe(canvas);
    document.addEventListener('visibilitychange', update);
    resize();

    return () => {
      active = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', update);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, []);

  return <canvas id="umi-shader-canvas" />;
}

export default function ShaderBackground() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 801px)');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setEnabled(desktop.matches && !motion.matches);
    update();
    desktop.addEventListener('change', update);
    motion.addEventListener('change', update);
    return () => {
      desktop.removeEventListener('change', update);
      motion.removeEventListener('change', update);
    };
  }, []);

  return (
    <div className="hero-shader" aria-hidden="true">
      {enabled && <ShaderCanvas />}
    </div>
  );
}
