import React, {forwardRef, useImperativeHandle, useRef} from 'react';
import {StyleSheet, Animated} from 'react-native';
import {Theme} from '../types';
import * as defaultStyle from '../style';

export const HOVER_SIZE = 44;

export type DragHoverOverlayHandle = {
  setHover: (left: number, top: number, width: number, height: number) => void;
  clear: () => void;
};

export interface DragHoverOverlayProps {
  theme?: Theme;
}

/**
 * Drop-target ring driven by Animated.Value — no React re-renders while dragging.
 */
const DragHoverOverlay = forwardRef<DragHoverOverlayHandle, DragHoverOverlayProps>((props, ref) => {
  const {theme} = props;
  const borderColor = (theme as any)?.selectedDayBackgroundColor || defaultStyle.selectedDayBackgroundColor;
  const left = useRef(new Animated.Value(-9999)).current;
  const top = useRef(new Animated.Value(0)).current;
  const width = useRef(new Animated.Value(HOVER_SIZE)).current;
  const height = useRef(new Animated.Value(HOVER_SIZE)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useImperativeHandle(
    ref,
    () => ({
      setHover: (nextLeft: number, nextTop: number, nextWidth: number, nextHeight: number) => {
        left.setValue(nextLeft);
        top.setValue(nextTop);
        width.setValue(nextWidth);
        height.setValue(nextHeight);
        opacity.setValue(1);
      },
      clear: () => {
        opacity.setValue(0);
        left.setValue(-9999);
      }
    }),
    [left, top, width, height, opacity]
  );

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.hover, {borderColor, left, top, width, height, opacity}]}
    />
  );
});

const styles = StyleSheet.create({
  hover: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: HOVER_SIZE / 2,
    zIndex: 99,
    elevation: 7
  }
});

export default DragHoverOverlay;
