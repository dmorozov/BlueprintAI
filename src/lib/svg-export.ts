import {
  planBounds,
  pointOnWall,
  polygonCentroid,
  type FloorPlan,
} from '@/lib/blueprint-schema';

/**
 * Serializes a floor plan to a standalone SVG document string (for sharing/export).
 * Mirrors the on-screen renderer: rooms as translucent polygons with labels, walls as
 * thick lines, door/window markers, and wall dimension labels. Fixed neutral colors —
 * this is a file artifact, not a themed UI component.
 */

const WALL_WIDTH_M = 0.08;
const PADDING_M = 0.6;
const MIN_SIZE_M = 4;

const COLORS = {
  wall: '#1a1a1a',
  roomFill: '#208AEF',
  roomFillOpacity: '0.25',
  label: '#60646C',
} as const;

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const fmt = (value: number) => String(Math.round(value * 100) / 100);

export function planToSvgString(plan: FloorPlan): string {
  const bounds = planBounds(plan);
  if (bounds === null) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 8"></svg>\n';
  }

  const width = Math.max(bounds.maxX - bounds.minX, MIN_SIZE_M) + PADDING_M * 2;
  const height =
    Math.max(bounds.maxY - bounds.minY, MIN_SIZE_M) + PADDING_M * 2;
  const ox = -bounds.minX + PADDING_M;
  const oy = -bounds.minY + PADDING_M;

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(width)} ${fmt(height)}" width="${Math.round(width * 100)}" height="${Math.round(height * 100)}">`,
  );
  out.push(`  <g transform="translate(${fmt(ox)}, ${fmt(oy)})">`);

  for (const room of plan.rooms) {
    const points = room.polygon
      .map(([x, y]) => `${fmt(x)},${fmt(y)}`)
      .join(' ');
    out.push(
      `    <polygon points="${points}" fill="${COLORS.roomFill}" fill-opacity="${COLORS.roomFillOpacity}"/>`,
    );
  }

  for (const wall of plan.walls) {
    out.push(
      `    <line x1="${fmt(wall.from[0])}" y1="${fmt(wall.from[1])}" x2="${fmt(wall.to[0])}" y2="${fmt(wall.to[1])}" stroke="${COLORS.wall}" stroke-width="${WALL_WIDTH_M}" stroke-linecap="round" opacity="${fmt(0.45 + 0.55 * wall.confidence)}"/>`,
    );
  }

  const wallsById = new Map(plan.walls.map((wall) => [wall.id, wall]));
  for (const opening of plan.openings) {
    const wall = wallsById.get(opening.wallId);
    if (wall === undefined) continue;
    const t = opening.positionT ?? 0.5;
    const [x, y] = pointOnWall(wall.from, wall.to, t);
    const angle =
      (Math.atan2(wall.to[1] - wall.from[1], wall.to[0] - wall.from[0]) * 180) /
      Math.PI;
    const markerWidth = opening.widthM ?? (opening.type === 'door' ? 0.9 : 1.2);
    const fill = opening.type === 'door' ? COLORS.wall : 'none';
    const stroke =
      opening.type === 'window'
        ? ` stroke="${COLORS.wall}" stroke-width="${WALL_WIDTH_M * 0.35}"`
        : '';
    out.push(
      `    <rect x="${fmt(x - markerWidth / 2)}" y="${fmt(y - WALL_WIDTH_M * 1.4)}" width="${fmt(markerWidth)}" height="${fmt(WALL_WIDTH_M * 2.8)}" rx="0.05" fill="${fill}"${stroke} transform="rotate(${fmt(angle)}, ${fmt(x)}, ${fmt(y)})"/>`,
    );
  }

  for (const room of plan.rooms) {
    const [cx, cy] = polygonCentroid(room.polygon);
    out.push(
      `    <text x="${fmt(cx)}" y="${fmt(cy)}" font-size="0.45" fill="${COLORS.label}" text-anchor="middle">${esc(room.label)}</text>`,
    );
  }

  for (const wall of plan.walls) {
    if (wall.lengthM === undefined || wall.lengthM < 0.5) continue;
    const mx = (wall.from[0] + wall.to[0]) / 2;
    const my = (wall.from[1] + wall.to[1]) / 2 - 0.15;
    out.push(
      `    <text x="${fmt(mx)}" y="${fmt(my)}" font-size="0.28" fill="${COLORS.label}" text-anchor="middle">${wall.lengthM.toFixed(1)} m</text>`,
    );
  }

  out.push('  </g>');
  out.push('</svg>');
  return `${out.join('\n')}\n`;
}
