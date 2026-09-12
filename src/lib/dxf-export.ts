import {
  pointOnWall,
  type FloorPlan,
  type Point,
} from '@/lib/blueprint-schema';

/**
 * Serializes a floor plan to a minimal ASCII DXF (R12-compatible) document string.
 * Walls and openings are LINE entities, room outlines are closed LWPOLYLINE entities.
 * Coordinates are meters (DXF R12 carries no unit header — note this when importing).
 * Dependency-free on purpose: a hand-rolled writer keeps the export in Expo Go without
 * native modules (see docs/research/blueprint-from-photos.md, §3.6).
 */

const fmt = (value: number) => value.toFixed(3);

function lineEntity(from: Point, to: Point, layer: string): string[] {
  return [
    '0',
    'LINE',
    '8',
    layer,
    '10',
    fmt(from[0]),
    '20',
    fmt(from[1]),
    '30',
    '0.0',
    '11',
    fmt(to[0]),
    '21',
    fmt(to[1]),
    '31',
    '0.0',
  ];
}

function polylineEntity(points: Point[], layer: string): string[] {
  const out = [
    '0',
    'LWPOLYLINE',
    '8',
    layer,
    '90',
    String(points.length),
    '70',
    '1', // closed
  ];
  for (const point of points) {
    out.push('10', fmt(point[0]), '20', fmt(point[1]));
  }
  return out;
}

export function planToDxfString(plan: FloorPlan): string {
  const lines = ['0', 'SECTION', '2', 'ENTITIES'];

  for (const room of plan.rooms) {
    lines.push(...polylineEntity(room.polygon, 'ROOMS'));
  }

  for (const wall of plan.walls) {
    lines.push(...lineEntity(wall.from, wall.to, 'WALLS'));
  }

  // Openings: a short segment across the wall at the opening's position.
  const wallsById = new Map(plan.walls.map((wall) => [wall.id, wall]));
  for (const opening of plan.openings) {
    const wall = wallsById.get(opening.wallId);
    if (wall === undefined) continue;
    const t = opening.positionT ?? 0.5;
    const [cx, cy] = pointOnWall(wall.from, wall.to, t);
    const dx = wall.to[0] - wall.from[0];
    const dy = wall.to[1] - wall.from[1];
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const half = (opening.widthM ?? 0.8) / 2;
    lines.push(
      ...lineEntity(
        [cx - nx * half, cy - ny * half],
        [cx + nx * half, cy + ny * half],
        'OPENINGS',
      ),
    );
  }

  lines.push('0', 'ENDSEC', '0', 'EOF');
  return `${lines.join('\n')}\n`;
}
