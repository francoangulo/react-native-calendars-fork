import React, {Fragment, useCallback, useEffect, useRef} from 'react';
import {GestureResponderEvent, Text, TouchableOpacity, View, ViewProps} from 'react-native';

import {xdateToData} from '../../../interface';
import {Theme, DayState, MarkingTypes, DateData} from '../../../types';
import styleConstructor from './style';
import Marking, {MarkingProps} from '../marking';

export type DayDragPoint = {
  pageX: number;
  pageY: number;
};

export type DayLayoutRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const LONG_PRESS_DELAY = 100;
const MOVE_THRESHOLD = 10;

export interface BasicDayProps extends ViewProps {
  state?: DayState;
  /** The marking object */
  marking?: MarkingProps;
  /** Date marking style [simple/period/multi-dot/multi-period]. Default = 'simple' */
  markingType?: MarkingTypes;
  /** Theme object */
  theme?: Theme;
  /** onPress callback */
  onPress?: (date?: DateData) => void;
  /** onLongPress callback */
  onLongPress?: (date?: DateData) => void;
  /** The date to return from press callbacks */
  date?: string;

  /** Disable all touch events for disabled days. can be override with disableTouchEvent in markedDates*/
  disableAllTouchEventsForDisabledDays?: boolean;
  /** Disable all touch events for inactive days. can be override with disableTouchEvent in markedDates*/
  disableAllTouchEventsForInactiveDays?: boolean;

  /** Test ID */
  testID?: string;
  /** Accessibility label */
  accessibilityLabel?: string;
  /** Enable long-press then drag between days */
  enableDayDrag?: boolean;
  /** Date string currently under the drag finger (for hover highlight) */
  dragHoverDate?: string;
  /** Called when a long-press drag starts on this day */
  onDragStart?: (date: DateData, point: DayDragPoint) => void;
  /** Called while dragging after long-press */
  onDragMove?: (point: DayDragPoint) => void;
  /** Called when the drag gesture ends or is cancelled */
  onDragEnd?: () => void;
  /** Reports this day's window layout for drop hit-testing */
  onDayLayout?: (instanceId: string, date: string, layout: DayLayoutRect) => void;
  /** Registers the day native view so the parent can re-measure on drag start */
  onDayViewRef?: (instanceId: string, date: string, ref: View | null) => void;
}

const BasicDay = (props: BasicDayProps) => {
  const {
    theme,
    date,
    onPress,
    onLongPress,
    markingType,
    marking,
    state,
    disableAllTouchEventsForDisabledDays,
    disableAllTouchEventsForInactiveDays,
    accessibilityLabel,
    children,
    testID,
    enableDayDrag,
    dragHoverDate,
    onDragStart,
    onDragMove,
    onDragEnd,
    onDayLayout,
    onDayViewRef
  } = props;
  const style = useRef(styleConstructor(theme));
  const containerRef = useRef<any>(null);
  const instanceIdRef = useRef(`day_${Math.random().toString(36).slice(2, 11)}`);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingRef = useRef(false);
  const touchStartRef = useRef<DayDragPoint | null>(null);
  const didMoveBeyondThreshold = useRef(false);
  /**
   * Delta between `measureInWindow` space and touch (`pageX/pageY`) space.
   * On Android these disagree by the status-bar height; drag overlays and
   * hit-testing work in `measureInWindow` space, so touch points are corrected
   * into it before being reported. Measured once per touch, 0/0 on iOS.
   */
  const pointCorrectionRef = useRef({x: 0, y: 0});
  /** Day cell origin in `measureInWindow` space, captured on touch start. */
  const cellWindowOriginRef = useRef<{x: number; y: number} | null>(null);
  /** True once `pointCorrectionRef` has been set from a reliable move event. */
  const correctionLockedRef = useRef(false);

  const _marking = marking || {};
  const isSelected = _marking.selected || state === 'selected';
  const isDisabled = typeof _marking.disabled !== 'undefined' ? _marking.disabled : state === 'disabled';
  const isInactive = _marking?.inactive;
  const isToday = state === 'today';
  const isMultiDot = markingType === Marking.markings.MULTI_DOT;
  const isMultiPeriod = markingType === Marking.markings.MULTI_PERIOD;
  const isCustom = markingType === Marking.markings.CUSTOM;
  const isDragHover = !!date && dragHoverDate === date;
  const dateData = date ? xdateToData(date) : undefined;

  const shouldDisableTouchEvent = () => {
    const {disableTouchEvent} = _marking;
    let disableTouch = false;

    if (typeof disableTouchEvent === 'boolean') {
      disableTouch = disableTouchEvent;
    } else if (typeof disableAllTouchEventsForDisabledDays === 'boolean' && isDisabled) {
      disableTouch = disableAllTouchEventsForDisabledDays;
    } else if (typeof disableAllTouchEventsForInactiveDays === 'boolean' && isInactive) {
      disableTouch = disableAllTouchEventsForInactiveDays;
    }
    return disableTouch;
  };

  const disabled = shouldDisableTouchEvent();

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearLongPressTimer();
  }, [clearLongPressTimer]);

  const reportLayout = useCallback(() => {
    if (!date || !onDayLayout) {
      return;
    }
    containerRef.current?.measureInWindow((x: number, y: number, width: number, height: number) => {
      onDayLayout(instanceIdRef.current, date, {x, y, width, height});
    });
  }, [date, onDayLayout]);

  const setContainerRef = useCallback(
    (node: any) => {
      containerRef.current = node;
      if (date && onDayViewRef) {
        onDayViewRef(instanceIdRef.current, date, node);
      }
    },
    [date, onDayViewRef]
  );

  useEffect(() => {
    return () => {
      if (date && onDayViewRef) {
        onDayViewRef(instanceIdRef.current, date, null);
      }
    };
  }, [date, onDayViewRef]);

  useEffect(() => {
    if (!date || !onDayLayout) {
      return;
    }
    const instanceId = instanceIdRef.current;
    return () => {
      onDayLayout(instanceId, date, {x: 0, y: 0, width: 0, height: 0});
    };
  }, [date, onDayLayout]);

  const getContainerStyle = () => {
    const {customStyles, selectedColor} = _marking;
    const styles = [style.current.base];

    if (isSelected) {
      styles.push(style.current.selected);
      if (selectedColor) {
        styles.push({backgroundColor: selectedColor});
      }
    } else if (isToday) {
      styles.push(style.current.today);
    }

    if (isDragHover) {
      styles.push(style.current.dragHover);
    }

    //Custom marking type
    if (isCustom && customStyles && customStyles.container) {
      if (customStyles.container.borderRadius === undefined) {
        customStyles.container.borderRadius = 16;
      }
      styles.push(customStyles.container);
    }

    return styles;
  };

  const getTextStyle = () => {
    const {customStyles, selectedTextColor} = _marking;
    const styles = [style.current.text];

    if (isSelected) {
      styles.push(style.current.selectedText);
      if (selectedTextColor) {
        styles.push({color: selectedTextColor});
      }
    } else if (isDisabled) {
      styles.push(style.current.disabledText);
    } else if (isToday) {
      styles.push(style.current.todayText);
    } else if (isInactive) {
      styles.push(style.current.inactiveText);
    }

    //Custom marking type
    if (isCustom && customStyles && customStyles.text) {
      styles.push(customStyles.text);
    }

    return styles;
  };

  const _onPress = useCallback(() => {
    onPress?.(dateData);
  }, [onPress, dateData]);

  const _onLongPress = useCallback(() => {
    onLongPress?.(dateData);
  }, [onLongPress, dateData]);

  const finishDrag = useCallback(() => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      onDragEnd?.();
    }
  }, [onDragEnd]);

  const toWindowPoint = useCallback((pageX: number, pageY: number): DayDragPoint => {
    return {
      pageX: pageX + pointCorrectionRef.current.x,
      pageY: pageY + pointCorrectionRef.current.y
    };
  }, []);

  const startDrag = useCallback(
    (point: DayDragPoint) => {
      if (!dateData || disabled || !onDragStart) {
        return;
      }
      isDraggingRef.current = true;
      onLongPress?.(dateData);
      onDragStart(dateData, point);
    },
    [dateData, disabled, onLongPress, onDragStart]
  );

  const onTouchStart = useCallback(
    (evt: GestureResponderEvent) => {
      if (!enableDayDrag || disabled) {
        return;
      }
      const {pageX, pageY, locationX, locationY} = evt.nativeEvent;
      touchStartRef.current = {pageX, pageY};
      didMoveBeyondThreshold.current = false;
      isDraggingRef.current = false;
      pointCorrectionRef.current = {x: 0, y: 0};
      cellWindowOriginRef.current = null;
      correctionLockedRef.current = false;
      // Resolve the touch/measureInWindow coordinate mismatch (e.g. status bar + header on Android).
      // `locationX/Y` on this first event is not always localized to the target yet, so seed the
      // correction here but re-derive it from the first move event (see onTouchMove).
      containerRef.current?.measureInWindow((wx: number, wy: number) => {
        cellWindowOriginRef.current = {x: wx, y: wy};
        if (
          !correctionLockedRef.current &&
          typeof locationX === 'number' &&
          typeof locationY === 'number'
        ) {
          pointCorrectionRef.current = {
            x: wx - (pageX - locationX),
            y: wy - (pageY - locationY)
          };
        }
      });
      clearLongPressTimer();
      longPressTimer.current = setTimeout(() => {
        if (!didMoveBeyondThreshold.current) {
          startDrag(toWindowPoint(pageX, pageY));
        }
      }, LONG_PRESS_DELAY);
    },
    [enableDayDrag, disabled, clearLongPressTimer, startDrag, toWindowPoint]
  );

  const onTouchMove = useCallback(
    (evt: GestureResponderEvent) => {
      if (!enableDayDrag || disabled) {
        return;
      }
      const {pageX, pageY, locationX, locationY} = evt.nativeEvent;
      // Move events reliably localize `locationX/Y` to the target: derive the definitive
      // page -> measureInWindow correction from the first one.
      if (
        !correctionLockedRef.current &&
        cellWindowOriginRef.current &&
        typeof locationX === 'number' &&
        typeof locationY === 'number'
      ) {
        pointCorrectionRef.current = {
          x: cellWindowOriginRef.current.x - (pageX - locationX),
          y: cellWindowOriginRef.current.y - (pageY - locationY)
        };
        correctionLockedRef.current = true;
      }
      if (isDraggingRef.current) {
        onDragMove?.(toWindowPoint(pageX, pageY));
        return;
      }
      const start = touchStartRef.current;
      if (
        start &&
        (Math.abs(pageX - start.pageX) > MOVE_THRESHOLD || Math.abs(pageY - start.pageY) > MOVE_THRESHOLD)
      ) {
        didMoveBeyondThreshold.current = true;
        clearLongPressTimer();
      }
    },
    [enableDayDrag, disabled, onDragMove, clearLongPressTimer, toWindowPoint]
  );

  const onTouchEnd = useCallback(() => {
    if (!enableDayDrag || disabled) {
      return;
    }
    clearLongPressTimer();
    if (isDraggingRef.current) {
      finishDrag();
      return;
    }
    if (!didMoveBeyondThreshold.current) {
      _onPress();
    }
  }, [enableDayDrag, disabled, clearLongPressTimer, finishDrag, _onPress]);

  const onTouchCancel = useCallback(() => {
    if (!enableDayDrag || disabled) {
      return;
    }
    clearLongPressTimer();
    finishDrag();
  }, [enableDayDrag, disabled, clearLongPressTimer, finishDrag]);

  const renderMarking = () => {
    const {marked, dotColor, dots, periods} = _marking;

    return (
      <Marking
        type={markingType}
        theme={theme}
        marked={isMultiDot ? true : marked}
        selected={isSelected}
        disabled={isDisabled}
        inactive={isInactive}
        today={isToday}
        dotColor={dotColor}
        dots={dots}
        periods={periods}
      />
    );
  };

  const renderText = () => {
    return (
      <Text allowFontScaling={false} style={getTextStyle()}>
        {String(children)}
      </Text>
    );
  };

  const renderContent = () => {
    return (
      <Fragment>
        {renderText()}
        {renderMarking()}
      </Fragment>
    );
  };

  const renderContainer = () => {
    const {activeOpacity} = _marking;
    const content = isMultiPeriod ? renderText() : renderContent();

    if (enableDayDrag && !disabled) {
      return (
        <View
          ref={setContainerRef}
          testID={testID}
          style={style.current.dragHitArea}
          onLayout={reportLayout}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchCancel}
          accessible
          accessibilityRole={isDisabled ? undefined : 'button'}
          accessibilityLabel={accessibilityLabel}
        >
          <View style={getContainerStyle()}>{content}</View>
        </View>
      );
    }

    return (
      <TouchableOpacity
        ref={setContainerRef}
        testID={testID}
        style={getContainerStyle()}
        disabled={disabled}
        activeOpacity={activeOpacity}
        onPress={!disabled ? _onPress : undefined}
        onLongPress={!disabled ? _onLongPress : undefined}
        onLayout={onDayLayout ? reportLayout : undefined}
        accessible
        accessibilityRole={isDisabled ? undefined : 'button'}
        accessibilityLabel={accessibilityLabel}
      >
        {content}
      </TouchableOpacity>
    );
  };

  const renderPeriodsContainer = () => {
    return (
      <View style={style.current.container}>
        {renderContainer()}
        {renderMarking()}
      </View>
    );
  };

  return isMultiPeriod ? renderPeriodsContainer() : renderContainer();
};

export default BasicDay;
BasicDay.displayName = 'BasicDay';
