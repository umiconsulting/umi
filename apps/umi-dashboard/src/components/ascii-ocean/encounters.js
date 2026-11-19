import { clamp } from './math';
import { goldfishClearance, goldfishHalfWidth, goldfishWaveEnvelope } from './goldfish';

const HORIZON = 3.8;
const SAMPLES = [0, 4, 8, 12, 16, 19];
const BODY_RADII = Array.from(
  { length: 17 },
  (_, k) => goldfishHalfWidth(k / 19) + goldfishWaveEnvelope(k / 19) + 1 / 38,
);

/** Predict body encounters. Pass to the right and yield before the bodies meet. */
export function encounterSteering(shark, sharks, dt) {
  const fx = Math.cos(shark.heading);
  const fy = Math.sin(shark.heading);
  let risk = 0;

  for (const other of sharks) {
    if (other === shark) continue;
    const ox = Math.cos(other.heading);
    const oy = Math.sin(other.heading);
    const alignment = fx * ox + fy * oy;
    const ahead = (other.nodes[8] - shark.nodes[8]) * fx + (other.nodes[9] - shark.nodes[9]) * fy;
    // A leader keeps its course. The following fish gives it room.
    if (alignment > 0.65 && ahead < 0) continue;
    const vx = shark.speed * fx - other.speed * ox;
    const vy = shark.speed * fy - other.speed * oy;
    const speed2 = vx * vx + vy * vy;

    for (const a of SAMPLES) {
      const ar = goldfishClearance(a / 19, shark.length);
      for (const b of SAMPLES) {
        const dx = shark.nodes[a * 2] - other.nodes[b * 2];
        const dy = shark.nodes[a * 2 + 1] - other.nodes[b * 2 + 1];
        const clearance = ar + goldfishClearance(b / 19, other.length);
        const time = speed2 > 1 ? -(dx * vx + dy * vy) / speed2 : 0;
        if (time < 0 || time > HORIZON) continue;
        // Crossing fish use a stable priority. Head-on fish both pass to their right.
        if (alignment >= -0.45 && alignment <= 0.65 && shark.id < other.id && time > 0.6) continue;
        const distance = Math.hypot(dx + vx * time, dy + vy * time);
        if (distance >= clearance) continue;
        const penetration = clamp((clearance - distance) / Math.max(16, clearance * 0.5), 0, 1);
        risk = Math.max(risk, (0.35 + 0.65 * (1 - time / HORIZON)) * penetration);
      }
    }
  }

  const previous = shark.encounterRisk || 0;
  shark.encounterRisk =
    previous + (risk - previous) * Math.min(1, dt * (risk > previous ? 4 : 1.6));
  const urgency = shark.encounterRisk;
  return {
    x: -fy * urgency * 4,
    y: fx * urgency * 4,
    urgency,
    speedScale: 1 - urgency * 0.6,
  };
}

/** Keep solid bodies apart with bounded translations. Preserve each spine and heading. */
export function separateBodies(sharks, dt) {
  const fish = sharks.filter((shark) => shark.kind === 'goldfish');
  const budgets = fish.map((shark) => Math.max(0.45, shark.speed * dt * 0.75));
  for (let pass = 0; pass < 3; pass++) {
    for (let a = 0; a < fish.length; a++) {
      for (let b = a + 1; b < fish.length; b++) {
        if (budgets[a] + budgets[b] < 0.001) continue;
        const first = fish[a];
        const second = fish[b];
        const centerX = first.nodes[16] - second.nodes[16];
        const centerY = first.nodes[17] - second.nodes[17];
        const reach = (first.length + second.length) * 0.6 + 12;
        if (centerX * centerX + centerY * centerY > reach * reach) continue;
        let penetration = 0;
        let nx = 0;
        let ny = 0;
        for (let i = 0; i < BODY_RADII.length; i++) {
          for (let j = 0; j < BODY_RADII.length; j++) {
            const dx = first.nodes[i * 2] - second.nodes[j * 2];
            const dy = first.nodes[i * 2 + 1] - second.nodes[j * 2 + 1];
            const distance = Math.hypot(dx, dy);
            const overlap =
              BODY_RADII[i] * first.length + BODY_RADII[j] * second.length + 12 - distance;
            if (overlap <= penetration) continue;
            penetration = overlap;
            nx = distance > 0.001 ? dx / distance : -Math.sin(first.heading);
            ny = distance > 0.001 ? dy / distance : Math.cos(first.heading);
          }
        }
        if (penetration <= 0) continue;
        const correction = Math.min(penetration * 0.7, budgets[a] + budgets[b]);
        const firstShare = second.length ** 2 / (first.length ** 2 + second.length ** 2);
        let moveA = Math.min(budgets[a], correction * firstShare);
        const moveB = Math.min(budgets[b], correction - moveA);
        moveA = Math.min(budgets[a], correction - moveB);
        for (let k = 0; k < first.nodes.length; k += 2) {
          first.nodes[k] += nx * moveA;
          first.nodes[k + 1] += ny * moveA;
          second.nodes[k] -= nx * moveB;
          second.nodes[k + 1] -= ny * moveB;
        }
        budgets[a] -= moveA;
        budgets[b] -= moveB;
      }
    }
  }
}
