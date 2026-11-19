/* eslint-disable lingui/no-unlocalized-strings -- CSS, media queries, and SVG primitives. */
// Native SVG rim maps. The cache stores pixels; resize only moves the SVG tiles.
const NS = 'http://www.w3.org/2000/svg';
const tiles = new Map();
let serial = 0;
const svgNode = (tag, attributes = {}) => {
  const node = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
};

export function supportsRimLens() {
  return (
    /(?:Chrome|Chromium)\//.test(navigator.userAgent) &&
    !/(?:Firefox|FxiOS|CriOS)\//.test(navigator.userAgent) &&
    CSS.supports('backdrop-filter', 'url(#umi-glass-probe)')
  );
}

function mapTiles(radius, rim, depth, power) {
  const key = [radius, rim, depth, power].map((n) => n.toFixed(3)).join(':');
  if (tiles.has(key)) return tiles.get(key);
  const pending = (async () => {
    const extent = Math.ceil(Math.max(radius, rim));
    const parts = [];
    for (const name of ['tl', 'tr', 'bl', 'br', 'top', 'bottom', 'left', 'right']) {
      const corner = name.length === 2;
      const horizontal = name === 'top' || name === 'bottom';
      const width = corner || !horizontal ? extent : 1;
      const height = corner || horizontal ? extent : 1;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas map unavailable');
      const pixels = ctx.createImageData(width, height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const flipX = name === 'tr' || name === 'br' || name === 'right';
          const flipY = name === 'bl' || name === 'br' || name === 'bottom';
          const px = (flipX ? width - x - 1 : x) + 0.5;
          const py = (flipY ? height - y - 1 : y) + 0.5;
          let distance,
            nx = 0,
            ny = 0;
          if (corner && px < radius && py < radius) {
            const dx = radius - px;
            const dy = radius - py;
            const length = Math.hypot(dx, dy) || 1;
            distance = radius - length;
            nx = dx / length;
            ny = dy / length;
          } else if (horizontal || (corner && py < px)) {
            distance = py;
            ny = 1;
          } else {
            distance = px;
            nx = 1;
          }
          const bend = distance >= 0 && distance < rim ? (1 - distance / rim) ** power : 0;
          const i = (y * width + x) * 4;
          pixels.data[i] = Math.round(128 + 127 * nx * bend * (flipX ? -1 : 1));
          pixels.data[i + 1] = Math.round(128 + 127 * ny * bend * (flipY ? -1 : 1));
          pixels.data[i + 2] = 128;
          pixels.data[i + 3] = 255;
        }
      }
      ctx.putImageData(pixels, 0, 0);
      const href = canvas.toDataURL();
      const image = new Image();
      image.src = href;
      await image.decode();
      parts.push({ name, href });
    }
    return { extent, parts };
  })();
  tiles.set(key, pending);
  // A blocked Canvas must remain a retryable CSS-only fallback.
  pending.catch(() => tiles.delete(key));
  return pending;
}

export function createRimLens(surface, tokens) {
  const id = `umi-login-rim-${++serial}`;
  const svg = svgNode('svg', { 'aria-hidden': 'true', focusable: 'false', width: 0, height: 0 });
  svg.style.cssText = 'position:absolute;pointer-events:none';
  const defs = svgNode('defs');
  const filter = svgNode('filter', {
    id,
    filterUnits: 'userSpaceOnUse',
    primitiveUnits: 'userSpaceOnUse',
    'color-interpolation-filters': 'sRGB',
  });
  filter.append(svgNode('feFlood', { 'flood-color': 'rgb(128 128 128)', result: 'neutral' }));
  const images = [];
  for (const name of ['tl', 'tr', 'bl', 'br', 'top', 'bottom', 'left', 'right']) {
    const image = svgNode('feImage', { result: name, preserveAspectRatio: 'none' });
    filter.append(image);
    images.push(image);
  }
  const merge = svgNode('feMerge', { result: 'rim' });
  for (const name of ['neutral', 'tl', 'tr', 'bl', 'br', 'top', 'bottom', 'left', 'right'])
    merge.append(svgNode('feMergeNode', { in: name }));
  filter.append(merge);
  const displacements = [];
  for (const [index, channel] of ['red', 'green', 'blue'].entries()) {
    const displacement = svgNode('feDisplacementMap', {
      in: 'SourceGraphic',
      in2: 'rim',
      xChannelSelector: 'R',
      yChannelSelector: 'G',
      result: `${channel}-bend`,
    });
    displacements.push(displacement);
    const matrix = Array(20).fill(0);
    matrix[index * 5 + index] = 1;
    matrix[18] = 1;
    filter.append(
      displacement,
      svgNode('feColorMatrix', {
        in: `${channel}-bend`,
        type: 'matrix',
        values: matrix.join(' '),
        result: channel,
      }),
    );
  }
  filter.append(
    svgNode('feBlend', { in: 'red', in2: 'green', mode: 'screen', result: 'rg' }),
    svgNode('feBlend', { in: 'rg', in2: 'blue', mode: 'screen' }),
  );
  defs.append(filter);
  svg.append(defs);
  document.body.append(svg);
  let disposed = false;
  let revision = 0;
  let geometry = '';
  return {
    async update() {
      const bounds = surface.getBoundingClientRect();
      const style = getComputedStyle(surface);
      const width = bounds.width,
        height = bounds.height;
      const radius = Math.min(parseFloat(style.borderTopLeftRadius) || 0, width / 2, height / 2);
      const rim = Math.max(
        tokens.rimMin,
        Math.min(tokens.rimMax, Math.min(width, height) / tokens.rimRatio),
      );
      const next = [width, height, radius, rim].join(':');
      if (geometry === next) return;
      geometry = next;
      const version = ++revision;
      const map = await mapTiles(radius, rim, tokens.rimDepth, tokens.rimPower);
      if (disposed || version !== revision) return;
      const e = map.extent;
      const boxes = [
        [0, 0, e, e],
        [width - e, 0, e, e],
        [0, height - e, e, e],
        [width - e, height - e, e, e],
        [e, 0, Math.max(0, width - 2 * e), e],
        [e, height - e, Math.max(0, width - 2 * e), e],
        [0, e, e, Math.max(0, height - 2 * e)],
        [width - e, e, e, Math.max(0, height - 2 * e)],
      ];
      for (let i = 0; i < images.length; i++) {
        const image = images[i];
        image.setAttribute('href', map.parts[i].href);
        for (const [k, attribute] of ['x', 'y', 'width', 'height'].entries())
          image.setAttribute(attribute, boxes[i][k]);
      }
      const padding = Math.ceil(tokens.rimDepth * rim * 1.15);
      filter.setAttribute('x', -padding);
      filter.setAttribute('y', -padding);
      filter.setAttribute('width', width + padding * 2);
      filter.setAttribute('height', height + padding * 2);
      // Wide rims use less color separation to keep corners clear.
      const split = rim > 28 ? tokens.split / 2 : tokens.split;
      for (const [i, factor] of [1 + split, 1, 1 - split].entries())
        displacements[i].setAttribute('scale', 2 * tokens.rimDepth * rim * factor);
      // Decode the actual feImage nodes before enabling the URL on the surface.
      await Promise.all(
        images.map(
          (image) =>
            new Promise((resolve) => {
              // The decoded cache is ready; two paints also let SVG consume its data URI.
              image.addEventListener('load', resolve, { once: true });
              requestAnimationFrame(() => requestAnimationFrame(resolve));
            }),
        ),
      );
      if (disposed || version !== revision) return;
      surface.style.setProperty('--login-glass-lens', `url("#${id}")`);
      surface.dataset.glassLens = 'ready';
    },
    destroy() {
      disposed = true;
      surface.style.removeProperty('--login-glass-lens');
      delete surface.dataset.glassLens;
      svg.remove();
    },
  };
}
