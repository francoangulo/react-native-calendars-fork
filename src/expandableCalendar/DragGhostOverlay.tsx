import React, { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import styleConstructor from "../calendar/day/basic/style";
import Marking, { MarkingProps } from "../calendar/day/marking";
import { DateData, MarkingTypes, Theme } from "../types";

const GHOST_SIZE = 40;

export type DragGhostOverlayHandle = {
  setPosition: (left: number, top: number) => void;
  setVisible: (visible: boolean) => void;
};

export interface DragGhostOverlayProps {
  dayNumber?: number | string;
  theme?: Theme;
  marking?: MarkingProps;
  markingType?: MarkingTypes;
}

/**
 * Floating preview shown while dragging a day between dates.
 * Position/visibility use Animated.Value so drag moves do not re-render the calendar tree.
 */
const DragGhostOverlay = forwardRef<
  DragGhostOverlayHandle,
  DragGhostOverlayProps
>((props, ref) => {
  const { dayNumber, theme, marking, markingType } = props;
  const style = useMemo(() => styleConstructor(theme), [theme]);
  const left = useRef(new Animated.Value(-9999)).current;
  const top = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useImperativeHandle(
    ref,
    () => ({
      setPosition: (nextLeft: number, nextTop: number) => {
        left.setValue(nextLeft);
        top.setValue(nextTop);
      },
      setVisible: (visible: boolean) => {
        opacity.setValue(visible ? 0.9 : 0);
        if (!visible) {
          left.setValue(-9999);
        }
      },
    }),
    [left, top, opacity]
  );

  const _marking = marking || {};
  const isMultiDot = markingType === Marking.markings.MULTI_DOT;

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.ghost, { left, top, opacity }]}
    >
      {dayNumber !== undefined && (
        <View style={[style.base, style.selected, styles.ghostInner]}>
          <Text
            allowFontScaling={false}
            style={[style.text, style.selectedText]}
          >
            {String(dayNumber)}
          </Text>
          <Marking
            type={markingType}
            theme={theme}
            marked={isMultiDot ? true : _marking.marked}
            selected
            disabled={false}
            inactive={false}
            today={false}
            dotColor={_marking.dotColor}
            dots={_marking.dots}
            periods={_marking.periods}
          />
        </View>
      )}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  ghost: {
    position: "absolute",
    width: GHOST_SIZE,
    height: GHOST_SIZE,
    zIndex: 100,
    elevation: 8,
    transform: [{ scale: 1.15 }],
  },
  ghostInner: {
    width: GHOST_SIZE,
    height: GHOST_SIZE,
    borderRadius: GHOST_SIZE / 2,
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    opacity: 0.5,
  },
});

export const GHOST_HALF_SIZE = GHOST_SIZE / 2;

export default DragGhostOverlay;

export function getGhostDayNumber(from: DateData): number {
  return from.day;
}

export function getGhostMarking(
  markedDates: { [key: string]: MarkingProps } | undefined,
  dateString: string
): MarkingProps | undefined {
  return markedDates?.[dateString];
}
