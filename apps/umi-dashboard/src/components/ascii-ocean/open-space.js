/** Soft steering leaves the source motion free to cross behind the content. */
export function contentSteering(shark, regions) {
  const margin = Math.min(110, shark.length * 0.3);
  const lookAhead = shark.length * 0.5;
  let x = 0;
  let y = 0;

  for (const distance of [0, lookAhead]) {
    const px = shark.nodes[0] + Math.cos(shark.heading) * distance;
    const py = shark.nodes[1] + Math.sin(shark.heading) * distance;
    for (const rect of regions) {
      let dx = px - Math.max(rect.left, Math.min(rect.right, px));
      let dy = py - Math.max(rect.top, Math.min(rect.bottom, py));
      let gap = Math.hypot(dx, dy);
      if (gap >= margin) continue;
      if (gap === 0) {
        const sides = [
          [px - rect.left, -1, 0],
          [rect.right - px, 1, 0],
          [py - rect.top, 0, -1],
          [rect.bottom - py, 0, 1],
        ];
        const nearest = sides.reduce((a, b) => (a[0] < b[0] ? a : b));
        dx = nearest[1];
        dy = nearest[2];
        gap = 1;
      }
      const weight = (1 - gap / margin) * (distance ? 6 : 3);
      x += (dx / gap) * weight;
      y += (dy / gap) * weight;
    }
  }
  return { x, y };
}

export function overContent(x, y, regions) {
  return regions.some(
    (rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
  );
}
