import { G, Line, Polygon, Rect, Svg, Text as SvgText } from 'react-native-svg';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import {
  planBounds,
  pointOnWall,
  polygonCentroid,
  type FloorPlan,
} from '@/lib/blueprint-schema';

interface BlueprintSvgProps {
  plan: FloorPlan;
  style?: ViewStyle;
}

/** Wall stroke width in meters (viewBox units). */
const WALL_WIDTH_M = 0.08;
/** Empty margin around the plan, in meters. */
const PADDING_M = 0.6;
/** Minimum plan size so very small plans still render legibly. */
const MIN_SIZE_M = 4;
/** Walls shorter than this (meters) get no dimension label (too cramped). */
const MIN_LABELLED_WALL_M = 0.5;

/**
 * Renders a floor plan as an SVG in meter coordinates: rooms as translucent filled
 * polygons with labels, walls as thick lines with dimension labels, openings as markers
 * on their wall. Element opacity scales with model confidence so uncertain geometry
 * reads as fainter. Geometry helpers are shared with the file exporters.
 */
export function BlueprintSvg({ plan, style }: BlueprintSvgProps) {
  const theme = useTheme();
  const bounds = planBounds(plan);

  if (bounds === null) {
    return (
      <View style={[styles.empty, style]}>
        <ThemedText variant="small" themeColor="textSecondary">
          No geometry detected in the plan.
        </ThemedText>
      </View>
    );
  }

  const width = Math.max(bounds.maxX - bounds.minX, MIN_SIZE_M) + PADDING_M * 2;
  const height =
    Math.max(bounds.maxY - bounds.minY, MIN_SIZE_M) + PADDING_M * 2;
  const offsetX = -bounds.minX + PADDING_M;
  const offsetY = -bounds.minY + PADDING_M;

  const wallsById = new Map(plan.walls.map((wall) => [wall.id, wall]));

  return (
    <View style={[styles.container, style]}>
      <Svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <G transform={`translate(${offsetX}, ${offsetY})`}>
          {plan.rooms.map((room) => (
            <Polygon
              key={room.id}
              points={room.polygon.map(([x, y]) => `${x},${y}`).join(' ')}
              fill={theme.primary}
              opacity={0.1 + 0.2 * room.confidence}
            />
          ))}
          {plan.walls.map((wall) => (
            <Line
              key={wall.id}
              x1={wall.from[0]}
              y1={wall.from[1]}
              x2={wall.to[0]}
              y2={wall.to[1]}
              stroke={theme.text}
              strokeWidth={WALL_WIDTH_M}
              strokeLinecap="round"
              opacity={0.45 + 0.55 * wall.confidence}
            />
          ))}
          {plan.openings.map((opening) => {
            const wall = wallsById.get(opening.wallId);
            if (wall === undefined) return null;
            const t = opening.positionT ?? 0.5;
            const [x, y] = pointOnWall(wall.from, wall.to, t);
            const angle =
              (Math.atan2(
                wall.to[1] - wall.from[1],
                wall.to[0] - wall.from[0],
              ) *
                180) /
              Math.PI;
            const markerWidth =
              opening.widthM ?? (opening.type === 'door' ? 0.9 : 1.2);
            return (
              <Rect
                key={opening.id}
                x={x - markerWidth / 2}
                y={y - WALL_WIDTH_M * 1.4}
                width={markerWidth}
                height={WALL_WIDTH_M * 2.8}
                rx={0.05}
                fill={opening.type === 'door' ? theme.primary : 'none'}
                stroke={opening.type === 'window' ? theme.text : undefined}
                strokeWidth={
                  opening.type === 'window' ? WALL_WIDTH_M * 0.35 : undefined
                }
                opacity={0.45 + 0.55 * opening.confidence}
                transform={`rotate(${angle}, ${x}, ${y})`}
              />
            );
          })}
          {plan.walls.map((wall) => {
            if (
              wall.lengthM === undefined ||
              wall.lengthM < MIN_LABELLED_WALL_M
            ) {
              return null;
            }
            const mx = (wall.from[0] + wall.to[0]) / 2;
            const my = (wall.from[1] + wall.to[1]) / 2 - 0.15;
            return (
              <SvgText
                key={`${wall.id}-dim`}
                x={mx}
                y={my}
                fontSize={0.28}
                fill={theme.textSecondary}
                textAnchor="middle"
              >
                {`${wall.lengthM.toFixed(1)} m`}
              </SvgText>
            );
          })}
          {plan.rooms.map((room) => {
            const [cx, cy] = polygonCentroid(room.polygon);
            return (
              <SvgText
                key={`${room.id}-label`}
                x={cx}
                y={cy}
                fontSize={0.45}
                fill={theme.textSecondary}
                textAnchor="middle"
              >
                {room.label}
              </SvgText>
            );
          })}
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: '100%',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
