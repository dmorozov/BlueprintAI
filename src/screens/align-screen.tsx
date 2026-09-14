import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import {
  PanGestureHandler,
  State,
  type PanGestureHandlerGestureEvent,
} from 'react-native-gesture-handler';
import { G, Svg } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  MIN_PLAN_SIZE_M,
  PLAN_PADDING_M,
  PlanElements,
} from '@/components/blueprint-svg';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { mergeSameFramePlans } from '@/lib/ar-capture';
import {
  planBounds,
  type FloorPlan,
  type PlanBounds,
} from '@/lib/blueprint-schema';
import {
  applyPlacement,
  combineBounds,
  identityPlacement,
  mergePlacedPlans,
  planCentroid,
  type RoomPlacement,
} from '@/lib/plan-transform';
import {
  getArSession,
  getPlan,
  getPlacement,
  getRoomLabel,
  listRooms,
  setPlacement as saveRoomPlacement,
} from '@/lib/session-store';

/** Gap (meters) between the base plan's edge and an unaligned room's starting position. */
const INITIAL_OFFSET_M = 1.5;

type Setup =
  | { kind: 'error'; message: string }
  | {
      kind: 'ready';
      /** The whole same-frame group the movable room belongs to (merged if >1). */
      movablePlan: FloorPlan;
      /** Room ids in that group — the placement is saved for all of them. */
      groupIds: string[];
      /** Group label shown in the UI. */
      groupLabel: string;
      /** Everything else already in the combined frame (anchor + aligned rooms). */
      basePlan: FloorPlan | null;
    };

/** Merges one AR session's room plans into a single plan (identity when alone). */
function mergeGroupPlans(ids: string[]): FloorPlan {
  const plans = ids.map((id) => getPlan(id)!);
  return plans.length > 1 ? mergeSameFramePlans(plans) : plans[0]!;
}

/**
 * Manual align editor (no-external-API plan, Phase 1 fallback). Rooms measured in
 * different AR sessions live in unrelated tracking frames; this screen lets the user
 * drag and rotate one room's whole session group into place relative to the rest of
 * the blueprint. The result is a pure geometric placement (centroid + rotation)
 * stored per room — no AI, no network.
 */
export function AlignScreen() {
  const theme = useTheme();
  const router = useRouter();
  // Edge-to-edge (Android API 35+): the Save/Cancel row must clear the nav bar.
  const insets = useSafeAreaInsets();
  const { room } = useLocalSearchParams<{ room?: string }>();
  const roomId = typeof room === 'string' ? room : '';

  // --- setup: movable group + the rest of the combined frame ------------------
  const setup: Setup = useMemo(() => {
    if (roomId === '') return { kind: 'error', message: 'No room selected.' };
    if (getPlan(roomId) === null) {
      return { kind: 'error', message: 'This room has no plan to align.' };
    }
    const movableSession = getArSession(roomId);
    if (movableSession === null) {
      return {
        kind: 'error',
        message: 'Only AR-measured rooms can be aligned.',
      };
    }

    // The movable room moves together with its whole same-frame group.
    const sessions = listRooms();
    const groupIds = sessions
      .filter((s) => s.hasPlan && s.arSessionId === movableSession)
      .map((s) => s.id);
    const movablePlan = mergeGroupPlans(groupIds);
    const groupLabel = groupIds.map((id) => getRoomLabel(id) ?? id).join(' + ');

    // The rest of the blueprint: other AR-measured rooms, grouped by session.
    const bySession = new Map<string, string[]>();
    for (const s of sessions) {
      if (s.hasPlan === false || s.arSessionId === null) continue;
      if (s.arSessionId === movableSession) continue;
      const ids = bySession.get(s.arSessionId) ?? [];
      ids.push(s.id);
      bySession.set(s.arSessionId, ids);
    }

    // Anchor: the largest other group stays where it was (identity placement).
    let anchorIds: string[] = [];
    for (const ids of bySession.values()) {
      if (ids.length > anchorIds.length) anchorIds = ids;
    }

    const parts: { plan: FloorPlan; placement: RoomPlacement }[] = [];
    if (anchorIds.length > 0) {
      const anchorPlan = mergeGroupPlans(anchorIds);
      parts.push({
        plan: anchorPlan,
        placement: identityPlacement(anchorPlan),
      });
    }
    for (const [, ids] of bySession) {
      if (ids === anchorIds) continue;
      // A group joins the canvas only once any of its rooms has been aligned.
      const stored = ids.map((id) => getPlacement(id)).find((p) => p !== null);
      if (stored === undefined) continue;
      parts.push({ plan: mergeGroupPlans(ids), placement: stored });
    }

    return {
      kind: 'ready',
      movablePlan,
      groupIds,
      groupLabel,
      basePlan: parts.length > 0 ? mergePlacedPlans(parts) : null,
    };
  }, [roomId]);

  // --- placement state ---------------------------------------------------------
  // An unaligned room starts just to the right of the base plan's bounding box so
  // both are visible at once and never overlap before the first drag.
  const defaultPlacement = useMemo<RoomPlacement>(() => {
    if (setup.kind !== 'ready' || setup.basePlan === null) {
      return { x: 0, y: 0, rotationRad: 0 };
    }
    const bounds = planBounds(setup.basePlan);
    const centroid = planCentroid(setup.basePlan);
    if (bounds === null || centroid === null) {
      return { x: 0, y: 0, rotationRad: 0 };
    }
    return {
      x: bounds.maxX + INITIAL_OFFSET_M,
      y: centroid[1],
      rotationRad: 0,
    };
  }, [setup]);

  const [placement, setPlacement] = useState<RoomPlacement>(() => {
    const stored = roomId !== '' ? getPlacement(roomId) : null;
    return stored ?? defaultPlacement;
  });

  // --- canvas geometry ----------------------------------------------------------
  const movableTransformed = useMemo(
    () =>
      setup.kind === 'ready'
        ? applyPlacement(setup.movablePlan, placement)
        : null,
    [setup, placement],
  );

  const liveBounds = useMemo<PlanBounds | null>(() => {
    if (setup.kind !== 'ready') return null;
    return combineBounds(
      setup.basePlan !== null ? planBounds(setup.basePlan) : null,
      movableTransformed !== null ? planBounds(movableTransformed) : null,
    );
  }, [setup, movableTransformed]);

  // While dragging, the viewBox is frozen so the canvas does not rescale under the
  // finger (the room moves within a stable coordinate window).
  const [frozenBounds, setFrozenBounds] = useState<PlanBounds | null>(null);
  const bounds = frozenBounds ?? liveBounds;

  const [size, setSize] = useState({ width: 0, height: 0 });
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) =>
      current.width === width && current.height === height
        ? current
        : { width, height },
    );
  }, []);

  const viewWidth =
    bounds !== null
      ? Math.max(bounds.maxX - bounds.minX, MIN_PLAN_SIZE_M) +
        PLAN_PADDING_M * 2
      : 0;
  const viewHeight =
    bounds !== null
      ? Math.max(bounds.maxY - bounds.minY, MIN_PLAN_SIZE_M) +
        PLAN_PADDING_M * 2
      : 0;
  // Pixels per meter for the current viewBox ("meet" fit).
  const pixelsPerMeter =
    size.width > 0 && size.height > 0 && viewWidth > 0 && viewHeight > 0
      ? Math.min(size.width / viewWidth, size.height / viewHeight)
      : 0;

  // --- pan gesture (translate the movable room) ---------------------------------
  const lastDelta = useRef({ x: 0, y: 0 });

  const handlePanStateChange = useCallback(
    (event: { nativeEvent: { state: number } }) => {
      if (event.nativeEvent.state === State.BEGAN) {
        lastDelta.current = { x: 0, y: 0 };
        setFrozenBounds(liveBounds);
      } else if (
        event.nativeEvent.state === State.END ||
        event.nativeEvent.state === State.CANCELLED
      ) {
        setFrozenBounds(null);
      }
    },
    [liveBounds],
  );

  const handlePan = useCallback(
    (event: PanGestureHandlerGestureEvent) => {
      if (pixelsPerMeter === 0) return;
      const dx = event.nativeEvent.translationX - lastDelta.current.x;
      const dy = event.nativeEvent.translationY - lastDelta.current.y;
      lastDelta.current = {
        x: event.nativeEvent.translationX,
        y: event.nativeEvent.translationY,
      };
      if (dx === 0 && dy === 0) return;
      setPlacement((current) => ({
        ...current,
        x: current.x + dx / pixelsPerMeter,
        y: current.y + dy / pixelsPerMeter,
      }));
    },
    [pixelsPerMeter],
  );

  // --- rotation controls ---------------------------------------------------------
  const rotateBy = useCallback((degrees: number) => {
    setPlacement((current) => ({
      ...current,
      rotationRad: current.rotationRad + (degrees * Math.PI) / 180,
    }));
  }, []);

  const handleReset = useCallback(() => {
    setPlacement(defaultPlacement);
  }, [defaultPlacement]);

  // --- save / cancel ---------------------------------------------------------------
  const handleSave = useCallback(() => {
    if (setup.kind !== 'ready') return;
    // Save for every room in the group so session-group merging stays consistent.
    for (const id of setup.groupIds) {
      saveRoomPlacement(id, placement);
    }
    router.back();
  }, [router, setup, placement]);

  const handleCancel = useCallback(() => {
    router.back();
  }, [router]);

  // --- render ---------------------------------------------------------------------
  if (setup.kind === 'error') {
    return (
      <ThemedView style={styles.center}>
        <ThemedText variant="small">{setup.message}</ThemedText>
        <Pressable
          accessibilityRole="button"
          onPress={handleCancel}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: theme.primary },
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.buttonLabel}>Go back</Text>
        </Pressable>
      </ThemedView>
    );
  }

  const displayDegrees = Math.round(
    ((((placement.rotationRad * 180) / Math.PI) % 360) + 360) % 360,
  );

  return (
    <ThemedView
      style={[
        styles.container,
        { paddingBottom: Spacing.three + insets.bottom },
      ]}
    >
      <ThemedText variant="small" themeColor="textSecondary">
        Aligning {setup.groupLabel} — drag to move, buttons to rotate.
      </ThemedText>

      <View
        onLayout={handleLayout}
        style={[styles.canvas, { backgroundColor: theme.backgroundElement }]}
      >
        {bounds !== null && (
          <Svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${viewWidth} ${viewHeight}`}
            preserveAspectRatio="xMidYMid meet"
          >
            <G
              transform={`translate(${-bounds.minX + PLAN_PADDING_M}, ${
                -bounds.minY + PLAN_PADDING_M
              })`}
            >
              {setup.basePlan !== null && (
                <PlanElements plan={setup.basePlan} />
              )}
              {movableTransformed !== null && (
                <PlanElements plan={movableTransformed} highlight />
              )}
            </G>
          </Svg>
        )}

        {/* Transparent pan layer over the canvas. */}
        <PanGestureHandler
          onGestureEvent={handlePan}
          onHandlerStateChange={handlePanStateChange}
        >
          <View style={StyleSheet.absoluteFill} />
        </PanGestureHandler>
      </View>

      <View style={styles.controls}>
        <View style={styles.row}>
          {[-90, -15].map((deg) => (
            <Pressable
              key={deg}
              accessibilityRole="button"
              onPress={() => rotateBy(deg)}
              style={({ pressed }) => [
                styles.chip,
                { backgroundColor: theme.backgroundElement },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.chipLabel, { color: theme.text }]}>
                {deg}°
              </Text>
            </Pressable>
          ))}
          <ThemedText variant="smallBold" style={styles.angleLabel}>
            {displayDegrees}°
          </ThemedText>
          {[15, 90].map((deg) => (
            <Pressable
              key={deg}
              accessibilityRole="button"
              onPress={() => rotateBy(deg)}
              style={({ pressed }) => [
                styles.chip,
                { backgroundColor: theme.backgroundElement },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.chipLabel, { color: theme.text }]}>
                +{deg}°
              </Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            onPress={handleReset}
            style={({ pressed }) => [
              styles.chip,
              { backgroundColor: theme.backgroundElement },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.chipLabel, { color: theme.text }]}>Reset</Text>
          </Pressable>
        </View>
        <View style={styles.row}>
          <Pressable
            accessibilityRole="button"
            onPress={handleSave}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: theme.primary },
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.buttonLabel}>Save alignment</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={handleCancel}
            style={({ pressed }) => [
              styles.secondaryButton,
              { backgroundColor: theme.backgroundElement },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.buttonLabel, { color: theme.text }]}>
              Cancel
            </Text>
          </Pressable>
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: Spacing.two,
    padding: Spacing.three,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  canvas: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  controls: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    alignItems: 'center',
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: 600,
  },
  angleLabel: {
    minWidth: 48,
    textAlign: 'center',
  },
  primaryButton: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  secondaryButton: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  buttonLabel: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 700,
  },
  pressed: {
    opacity: 0.8,
  },
});
