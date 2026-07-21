'use client';

import { useEffect } from 'react';

declare global {
  interface Window {
    __umiShader?: UmiShader;
  }
}

const VERT = `
  attribute vec2 a;
  void main(){ gl_Position = vec4(a, 0.0, 1.0); }
`;

const COMMON_WEBGL1 = `
  precision highp float;
  uniform vec2 uRes;
  uniform float uTime;
  uniform vec2 uMouse;
  uniform float uMouseActive;

  const vec3 NAVY_DEEP = vec3(0.020, 0.039, 0.106);
  const vec3 NAVY      = vec3(0.067, 0.118, 0.267);
  const vec3 NAVY_LIFT = vec3(0.133, 0.224, 0.474);
  const vec3 SKY       = vec3(0.463, 0.573, 0.796);
  const vec3 SKY_SOFT  = vec3(0.75, 0.85, 0.96);
  const vec3 ACCENT    = vec3(0.784, 0.663, 0.369);

  float hash(vec2 p){ p = fract(p*vec2(234.34, 435.345)); p += dot(p, p+34.23); return fract(p.x*p.y); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    float a = hash(i), b = hash(i+vec2(1,0)), c = hash(i+vec2(0,1)), d = hash(i+vec2(1,1));
    vec2 u = f*f*(3.0-2.0*f);
    return mix(a,b,u.x) + (c-a)*u.y*(1.0-u.x) + (d-b)*u.x*u.y;
  }
  float fbm(vec2 p){
    float v=0.0, a=0.5;
    for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.02+vec2(1.3,5.7); a*=0.5; }
    return v;
  }

  float bayer8(vec2 c) {
    float x = mod(c.x, 8.0);
    float y = mod(c.y, 8.0);
    float b2 = mod(2.0*y + 3.0*x, 4.0);
    float b4 = mod(4.0*(mod(y*0.5, 2.0)*2.0 + mod(x*0.5, 2.0)) + b2, 16.0);
    float b8 = mod(16.0*(mod(y*0.25, 2.0)*2.0 + mod(x*0.25, 2.0)) + b4, 64.0);
    return b8 / 64.0;
  }

  vec2 toAspect(vec2 fragCoord) {
    return (fragCoord - 0.5*uRes.xy) / min(uRes.x, uRes.y);
  }
  float grainf(vec2 fc, float t) {
    return (hash(fc + t) - 0.5);
  }
`;

// MERIDIAN — soft stratum bands
const FRAG_MERIDIAN =
  COMMON_WEBGL1 +
  `
  void main(){
    vec2 p = toAspect(gl_FragCoord.xy);
    float t = uTime * 0.06;
    vec3 col = mix(NAVY_DEEP, NAVY, smoothstep(-0.8, 0.8, p.y));
    float wave = fbm(p*1.2 + vec2(t, -t*0.4));
    col += mix(vec3(0.0), SKY, 0.10) * wave;
    float bands = sin((p.y + fbm(p*1.6)*0.12) * 14.0 - uTime*0.35);
    bands = smoothstep(0.85, 1.0, bands);
    col += SKY * bands * 0.06;
    float bands2 = sin((p.y + fbm(p*0.8 + 4.0)*0.18) * 6.0 - uTime*0.2);
    bands2 = smoothstep(0.92, 1.0, bands2);
    col += SKY * bands2 * 0.04;
    col *= 0.78 + 0.22*(1.0 - smoothstep(0.4, 1.3, length(p)));
    col += grainf(gl_FragCoord.xy, t) * 0.012;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const FRAG_AURORA =
  COMMON_WEBGL1 +
  `
  vec3 gradient(float t) {
    t = clamp(t, 0.0, 1.0);
    vec3 c0 = NAVY_DEEP;
    vec3 c1 = NAVY * 0.9;
    vec3 c2 = NAVY_LIFT * 0.7;
    vec3 c3 = mix(NAVY_LIFT, SKY, 0.3);
    if (t < 0.33) return mix(c0, c1, t/0.33);
    if (t < 0.66) return mix(c1, c2, (t-0.33)/0.33);
    return mix(c2, c3, (t-0.66)/0.34);
  }

  void main(){
    vec2 p = toAspect(gl_FragCoord.xy);
    float t = uTime * 0.04;
    float ang = 0.4 + sin(t*0.5)*0.15;
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 disp = vec2(
      fbm(p*1.4 + vec2(t, 0.0)),
      fbm(p*1.4 + vec2(0.0, t) + 13.7)
    ) - 0.5;
    float u1 = dot(p, dir) * 0.6 + 0.5 + disp.x * 0.6;
    vec3 c1 = gradient(u1);
    vec2 dir2 = vec2(-dir.y, dir.x);
    float u2 = dot(p, dir2) * 0.5 + 0.5 + disp.y * 0.7 + fbm(p*0.7 - t)*0.3;
    vec3 c2 = gradient(u2);
    vec3 col = mix(c1, c2, 0.55);
    vec2 lp = vec2(sin(t*1.1)*0.4, cos(t*0.7)*0.25);
    float lightD = length(p - lp);
    col += SKY * exp(-lightD*1.8) * 0.18;
    col += SKY * fbm(p*8.0 + t*2.0) * 0.04;
    col *= 0.82 + 0.18*(1.0 - smoothstep(0.3, 1.3, length(p)));
    col += grainf(gl_FragCoord.xy, t) * 0.018;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const FRAG_DITHER =
  COMMON_WEBGL1 +
  `
  void main(){
    vec2 p = toAspect(gl_FragCoord.xy);
    float t = uTime * 0.05;
    vec2 center = vec2(sin(t*0.7)*0.3, cos(t*0.5)*0.2);
    float radial = length(p - center);
    float linear = (p.y + 0.7) * 0.5;
    float field = 1.0 - smoothstep(0.0, 1.3, radial);
    field = mix(field, 1.0 - linear, 0.45);
    field += fbm(p*1.6 + vec2(t, -t*0.6)) * 0.25;
    field = clamp(field, 0.0, 1.0);
    vec2 dpx = floor(gl_FragCoord.xy / 2.0);
    float threshold = bayer8(dpx);
    float levels = 4.0;
    float quantized = floor(field * levels + threshold) / levels;
    vec3 col;
    if (quantized < 0.25) col = NAVY_DEEP;
    else if (quantized < 0.5) col = NAVY;
    else if (quantized < 0.75) col = NAVY_LIFT * 0.85;
    else col = mix(NAVY_LIFT, SKY, 0.4);
    float accent = step(0.95, field) * step(0.95, threshold);
    col = mix(col, ACCENT, accent * 0.4);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const FRAG_MESH =
  COMMON_WEBGL1 +
  `
  vec2 hash2(vec2 p){ return vec2(hash(p), hash(p+17.3)); }
  vec2 voronoi(vec2 x){
    vec2 n = floor(x), f = fract(x);
    float d1 = 8.0, d2 = 8.0;
    for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash2(n+g);
      o = 0.5 + 0.5*sin(uTime*0.18 + 6.2831*o);
      vec2 r = g + o - f;
      float d = dot(r,r);
      if(d<d1){ d2=d1; d1=d; } else if(d<d2){ d2=d; }
    }
    return vec2(sqrt(d1), sqrt(d2));
  }
  void main(){
    vec2 p = toAspect(gl_FragCoord.xy);
    float t = uTime * 0.04;
    vec3 col = mix(NAVY_DEEP, NAVY, smoothstep(-0.8, 0.8, p.y));
    col += SKY * fbm(p*1.0 + t*0.5) * 0.04;
    vec2 v = voronoi(p*2.6);
    float edgeDist = v.y - v.x;
    float cellMid = smoothstep(0.0, 0.4, v.x);
    col += NAVY_LIFT * cellMid * 0.12;
    float edge = smoothstep(0.06, 0.0, edgeDist);
    col += SKY * edge * 0.30;
    float edgeHot = smoothstep(0.012, 0.0, edgeDist);
    col += SKY_SOFT * edgeHot * 0.25;
    col *= 0.78 + 0.22*(1.0 - smoothstep(0.4, 1.3, length(p)));
    col += grainf(gl_FragCoord.xy, t) * 0.012;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const FRAG_STRATA =
  COMMON_WEBGL1 +
  `
  void main(){
    vec2 p = toAspect(gl_FragCoord.xy);
    float t = uTime * 0.04;
    float h = fbm(p*1.3 + vec2(t, t*0.5));
    h += fbm(p*3.0 + vec2(-t*0.8, t*0.6)) * 0.3;
    vec3 col = mix(NAVY_DEEP, NAVY, smoothstep(0.3, 0.8, h));
    col = mix(col, NAVY_LIFT * 0.7, smoothstep(0.7, 1.1, h));
    float numLines = 14.0;
    float scaled = h * numLines;
    float lineDist = abs(fract(scaled) - 0.5);
    float lineWidth = 0.06;
    float line = smoothstep(lineWidth, 0.0, lineDist);
    col += SKY * line * 0.22;
    float majorScaled = h * (numLines * 0.2);
    float majorDist = abs(fract(majorScaled) - 0.5);
    float majorWidth = 0.08;
    float majorLine = smoothstep(majorWidth, 0.0, majorDist);
    col += ACCENT * majorLine * 0.12;
    col *= 0.8 + 0.2*(1.0 - smoothstep(0.4, 1.3, length(p)));
    col += grainf(gl_FragCoord.xy, t) * 0.014;
    gl_FragColor = vec4(col, 1.0);
  }
`;

type PresetKey = 'meridian' | 'aurora' | 'dither' | 'mesh' | 'strata';

const PRESETS: Record<PresetKey, string> = {
  meridian: FRAG_MERIDIAN,
  aurora: FRAG_AURORA,
  dither: FRAG_DITHER,
  mesh: FRAG_MESH,
  strata: FRAG_STRATA,
};

interface ProgramInfo {
  prog: WebGLProgram;
  buf: WebGLBuffer;
  loc: number;
  uRes: WebGLUniformLocation | null;
  uTime: WebGLUniformLocation | null;
  uMouse: WebGLUniformLocation | null;
  uMouseActive: WebGLUniformLocation | null;
}

class UmiShader {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext | WebGL2RenderingContext;
  isWebGL2: boolean;
  mouse: [number, number] = [0, 0];
  targetMouse: [number, number] = [0, 0];
  mouseActive = 0;
  targetMouseActive = 0;
  currentPreset: PresetKey = 'meridian';
  programs: Partial<Record<PresetKey, ProgramInfo>> = {};
  t0 = performance.now();
  rafId = 0;
  resizeHandler: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    let gl: WebGLRenderingContext | WebGL2RenderingContext | null = canvas.getContext('webgl2', {
      antialias: false,
      premultipliedAlpha: false,
    });
    this.isWebGL2 = !!gl;
    if (!gl) {
      gl = canvas.getContext('webgl', {
        antialias: false,
        premultipliedAlpha: false,
      }) as WebGLRenderingContext | null;
      if (gl) gl.getExtension('OES_standard_derivatives');
    }
    if (!gl) throw new Error('WebGL not supported');
    this.gl = gl;
    this.buildProgram('meridian');
    this.resize();
    this.resizeHandler = () => this.resize();
    window.addEventListener('resize', this.resizeHandler);
    this.loop = this.loop.bind(this);
    this.rafId = requestAnimationFrame(this.loop);
  }

  buildProgram(name: PresetKey): ProgramInfo {
    const existing = this.programs[name];
    if (existing) return existing;
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, VERT);
    gl.compileShader(vs);
    let frag = PRESETS[name];
    if (!this.isWebGL2) {
      frag = '#extension GL_OES_standard_derivatives : enable\n' + frag;
    }
    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, frag);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.error('frag error', name, gl.getShaderInfoLog(fs));
    }
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a');
    const info: ProgramInfo = {
      prog,
      buf,
      loc,
      uRes: gl.getUniformLocation(prog, 'uRes'),
      uTime: gl.getUniformLocation(prog, 'uTime'),
      uMouse: gl.getUniformLocation(prog, 'uMouse'),
      uMouseActive: gl.getUniformLocation(prog, 'uMouseActive'),
    };
    this.programs[name] = info;
    return info;
  }

  setPreset(name: PresetKey) {
    if (!PRESETS[name]) return;
    this.currentPreset = name;
    this.buildProgram(name);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    this.gl.viewport(0, 0, w, h);
  }

  loop() {
    const gl = this.gl;
    const t = (performance.now() - this.t0) / 1000;
    this.mouse[0] += (this.targetMouse[0] - this.mouse[0]) * 0.08;
    this.mouse[1] += (this.targetMouse[1] - this.mouse[1]) * 0.08;
    this.mouseActive += (this.targetMouseActive - this.mouseActive) * 0.05;
    const info = this.programs[this.currentPreset]!;
    gl.useProgram(info.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, info.buf);
    gl.enableVertexAttribArray(info.loc);
    gl.vertexAttribPointer(info.loc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(info.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(info.uTime, t);
    gl.uniform2f(info.uMouse, this.mouse[0], this.mouse[1]);
    gl.uniform1f(info.uMouseActive, this.mouseActive);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.rafId = requestAnimationFrame(this.loop);
  }

  destroy() {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.resizeHandler);
  }
}

export default function ShaderBackground() {
  useEffect(() => {
    const canvas = document.getElementById('umi-shader-canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    let shader: UmiShader;
    try {
      shader = new UmiShader(canvas);
      window.__umiShader = shader;
    } catch (e) {
      console.warn('Shader init failed', e);
      return;
    }
    return () => {
      shader.destroy();
    };
  }, []);

  return (
    <>
      <canvas id="umi-shader-canvas" />
      <div id="umi-shader-overlay" />
    </>
  );
}
