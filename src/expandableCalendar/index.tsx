import first from "lodash/first";
import isFunction from "lodash/isFunction";
import isNumber from "lodash/isNumber";
import throttle from "lodash/throttle";

import XDate from "xdate";

import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  GestureResponderEvent,
  Image,
  ImageSourcePropType,
  PanResponder,
  PanResponderGestureState,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import Calendar from "../calendar";
import CalendarList, { CalendarListProps } from "../calendar-list";
import { DayDragPoint, DayLayoutRect } from "../calendar/day/basic";
import WeekDaysNames from "../commons/WeekDaysNames";
import { page } from "../dateutils";
import { parseDate, toMarkingFormat, xdateToData } from "../interface";
// @ts-expect-error
import { CALENDAR_KNOB } from "../testIDs";
import { DateData, Direction } from "../types";
import Context from "./Context";
import DragGhostOverlay, {
  DragGhostOverlayHandle,
  GHOST_HALF_SIZE,
  getGhostMarking,
} from "./DragGhostOverlay";
import DragHoverOverlay, {
  DragHoverOverlayHandle,
  HOVER_SIZE,
} from "./DragHoverOverlay";
import styleConstructor, {
  HEADER_HEIGHT,
  KNOB_CONTAINER_HEIGHT,
} from "./style";
import Week from "./week";
import WeekCalendar from "./WeekCalendar";

import constants from "../commons/constants";
const commons = require("./commons");
const updateSources = commons.UpdateSources;
enum Positions {
  CLOSED = "closed",
  OPEN = "open",
}
const SPEED = 20;
const BOUNCINESS = 6;
const CLOSED_HEIGHT = 120; // header + 1 week
const WEEK_HEIGHT = 46;
const DAY_NAMES_PADDING = 24;
const PAN_GESTURE_THRESHOLD = 30;
const LEFT_ARROW = require("../calendar/img/previous.png");
const RIGHT_ARROW = require("../calendar/img/next.png");
const knobHitSlop = { left: 10, right: 10, top: 10, bottom: 10 };

export type DayDragEndData = {
  /** The day the drag started from */
  from: DateData;
  /** The day the drag was dropped on */
  to: DateData;
};

export interface ExpandableCalendarProps extends CalendarListProps {
  /** the initial position of the calendar ('open' or 'closed') */
  initialPosition?: Positions;
  /** callback that fires when the calendar is opened or closed */
  onCalendarToggled?: (isOpen: boolean) => void;
  /** an option to disable the pan gesture and disable the opening and closing of the calendar (initialPosition will persist)*/
  disablePan?: boolean;
  /** whether to hide the knob  */
  hideKnob?: boolean;
  /** source for the left arrow image */
  leftArrowImageSource?: ImageSourcePropType;
  /** source for the right arrow image */
  rightArrowImageSource?: ImageSourcePropType;
  /** whether to have shadow/elevation for the calendar */
  allowShadow?: boolean;
  /** whether to disable the week scroll in closed position */
  disableWeekScroll?: boolean;
  /** a threshold for opening the calendar with the pan gesture */
  openThreshold?: number;
  /** a threshold for closing the calendar with the pan gesture */
  closeThreshold?: number;
  /** Whether to close the calendar on day press. Default = true */
  closeOnDayPress?: boolean;
  /**
   * Enable long-press-then-drag of a day onto another day, in both the open (month)
   * and closed (week) positions. Only supported for the default day rendering -
   * not for `markingType='period'` or a custom `dayComponent`. Default = false
   */
  enableDayDrag?: boolean;
  /** Fires once the long-press is recognized and the drag begins, with the dragged day */
  onDayDragStart?: (date: DateData) => void;
  /**
   * Fires when a day is dropped on a different day. Callback-only: the component does
   * not change `markedDates` or selection - update your own state from here.
   */
  onDayDragEnd?: (data: DayDragEndData) => void;
}

const headerStyleOverride = {
  stylesheet: {
    calendar: {
      header: {
        week: {
          marginTop: 7,
          marginBottom: -4, // reduce space between dayNames and first line of dates
          flexDirection: "row",
          justifyContent: "space-around",
        },
      },
    },
  },
};

/**
 * @description: Expandable calendar component
 * @note: Should be wrapped with 'CalendarProvider'
 * @extends: CalendarList
 * @extendslink: docs/CalendarList
 * @example: https://github.com/wix/react-native-calendars/blob/master/example/src/screens/expandableCalendar.js
 */

const ExpandableCalendar = (props: ExpandableCalendarProps) => {
  const { date, setDate, numberOfDays, timelineLeftInset } =
    useContext(Context);
  const {
    /** ExpandableCalendar props */
    initialPosition = Positions.CLOSED,
    onCalendarToggled,
    disablePan,
    hideKnob = numberOfDays && numberOfDays > 1,
    leftArrowImageSource = LEFT_ARROW,
    rightArrowImageSource = RIGHT_ARROW,
    allowShadow = true,
    disableWeekScroll,
    openThreshold = PAN_GESTURE_THRESHOLD,
    closeThreshold = PAN_GESTURE_THRESHOLD,
    closeOnDayPress = true,
    enableDayDrag = false,
    onDayDragStart,
    onDayDragEnd,

    /** CalendarList props */
    horizontal = true,
    calendarStyle,
    theme,
    style: propsStyle,
    firstDay = 0,
    onDayPress,
    hideArrows,
    onPressArrowLeft,
    onPressArrowRight,
    renderArrow,
    testID,
    markedDates,
    markingType,
    ...others
  } = props;

  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragFrom, setDragFrom] = useState<DateData | undefined>();
  /** False while day layouts are being remeasured after open/close (or first mount). */
  const [isDragLayoutReady, setIsDragLayoutReady] = useState(!enableDayDrag);

  const containerRef = useRef<View>(null);
  const ghostRef = useRef<DragGhostOverlayHandle>(null);
  const hoverRef = useRef<DragHoverOverlayHandle>(null);
  const dayLayoutsRef = useRef<
    Record<
      string,
      DayLayoutRect & { layer: "month" | "week"; dateString: string }
    >
  >({});
  const dayViewRefsRef = useRef<
    Record<string, { ref: View; dateString: string; layer: "month" | "week" }>
  >({});
  const dragFromRef = useRef<DateData | undefined>();
  const dragHoverRef = useRef<string | undefined>();
  const lastDragPointRef = useRef<DayDragPoint | undefined>();
  const isDraggingRef = useRef(false);
  const isDragLayoutReadyRef = useRef(!enableDayDrag);
  const containerWindowOffset = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const isOpenRef = useRef(false);

  /** Date */

  const getYear = (date: string) => {
    const d = new XDate(date);
    return d.getFullYear();
  };
  const getMonth = (date: string) => {
    const d = new XDate(date);
    return d.getMonth() + 1; // getMonth() returns month's index' (0-11)
  };
  const visibleMonth = useRef(getMonth(date));
  const visibleYear = useRef(getYear(date));

  const isLaterDate = (date1?: DateData, date2?: string) => {
    if (date1 && date2) {
      if (date1.year > getYear(date2)) {
        return true;
      }
      if (date1.year === getYear(date2)) {
        if (date1.month > getMonth(date2)) {
          return true;
        }
      }
    }
    return false;
  };

  /** Number of weeks */

  const getNumberOfWeeksInMonth = (month: string) => {
    const days = page(new XDate(month), firstDay);
    return days.length / 7;
  };
  const numberOfWeeks = useRef(getNumberOfWeeksInMonth(date));

  /** Position */

  const [position, setPosition] = useState(initialPosition);
  const isOpen = position === Positions.OPEN;
  isOpenRef.current = isOpen;

  const getOpenHeight = () => {
    if (!horizontal) {
      return Math.max(constants.screenHeight, constants.screenWidth);
    }
    return (
      CLOSED_HEIGHT +
      WEEK_HEIGHT * (numberOfWeeks.current - 1) +
      (hideKnob ? 12 : KNOB_CONTAINER_HEIGHT) +
      (constants.isAndroid ? 3 : 0)
    );
  };
  const openHeight = useRef(getOpenHeight());
  const closedHeight = useRef(
    CLOSED_HEIGHT +
      (hideKnob || Number(numberOfDays) > 1 ? 0 : KNOB_CONTAINER_HEIGHT)
  );

  const startHeight = isOpen ? openHeight.current : closedHeight.current;
  const _height = useRef(startHeight);

  const deltaY = useRef(new Animated.Value(startHeight));
  const headerDeltaY = useRef(new Animated.Value(isOpen ? -HEADER_HEIGHT : 0));

  /** Components' refs */

  const wrapper = useRef<any>();
  const calendarList = useRef<any>();
  const header = useRef<any>();
  const weekCalendarWrapper = useRef<any>();

  /** Styles */

  const style = useRef(styleConstructor(theme));
  const themeObject = Object.assign(headerStyleOverride, theme);

  const _wrapperStyles = useRef({ style: { height: startHeight } });
  const _headerStyles = { style: { top: isOpen ? -HEADER_HEIGHT : 0 } };
  const _weekCalendarStyles = { style: { opacity: isOpen ? 0 : 1 } };

  const shouldHideArrows = !horizontal ? true : hideArrows || false;

  const updateNativeStyles = () => {
    wrapper?.current?.setNativeProps(_wrapperStyles.current);

    if (!horizontal) {
      header?.current?.setNativeProps(_headerStyles);
    } else {
      weekCalendarWrapper?.current?.setNativeProps(_weekCalendarStyles);
    }
  };

  const weekDaysStyle = useMemo(() => {
    const leftPaddings = calendarStyle?.paddingLeft;
    const rightPaddings = calendarStyle?.paddingRight;

    return [
      style.current.weekDayNames,
      {
        paddingLeft: isNumber(leftPaddings)
          ? leftPaddings + 6
          : DAY_NAMES_PADDING,
        paddingRight: isNumber(rightPaddings)
          ? rightPaddings + 6
          : DAY_NAMES_PADDING,
      },
    ];
  }, [calendarStyle]);

  const headerStyle = useMemo(() => {
    return [
      style.current.header,
      { height: HEADER_HEIGHT + 10, top: headerDeltaY.current },
    ];
  }, [headerDeltaY.current]);

  const weekCalendarStyle = useMemo(() => {
    return [
      style.current.weekContainer,
      isOpen ? style.current.hidden : style.current.visible,
    ];
  }, [isOpen]);

  const containerStyle = useMemo(() => {
    return [allowShadow && style.current.containerShadow, propsStyle];
  }, [allowShadow, propsStyle]);

  const wrapperStyle = useMemo(() => {
    return { height: deltaY.current };
  }, [deltaY.current]);

  /** Effects */

  useEffect(() => {
    if (AccessibilityInfo) {
      if (AccessibilityInfo.isScreenReaderEnabled) {
        AccessibilityInfo.isScreenReaderEnabled().then(
          handleScreenReaderStatus
        );
      } else if (AccessibilityInfo.fetch) {
        // Support for older RN versions
        AccessibilityInfo.fetch().then(handleScreenReaderStatus);
      }
    }
  }, []);

  useEffect(() => {
    // date was changed from AgendaList, arrows or scroll
    scrollToDate(date);
  }, [date]);

  const handleScreenReaderStatus = (screenReaderEnabled: any) => {
    setScreenReaderEnabled(screenReaderEnabled);
  };

  /** Scroll */

  const scrollToDate = (date: string) => {
    if (!horizontal) {
      calendarList?.current?.scrollToDay(date, 0, true);
    } else if (
      getYear(date) !== visibleYear.current ||
      getMonth(date) !== visibleMonth.current
    ) {
      // don't scroll if the month is already visible
      calendarList?.current?.scrollToMonth(date);
    }
  };

  const scrollPage = useCallback(
    (next: boolean) => {
      if (horizontal) {
        const d = parseDate(date);

        if (isOpen) {
          d.setDate(1);
          d.addMonths(next ? 1 : -1);
        } else {
          let dayOfTheWeek = d.getDay();

          if (dayOfTheWeek < firstDay && firstDay > 0) {
            dayOfTheWeek = 7 + dayOfTheWeek;
          }

          if (numberOfDays) {
            const daysToAdd = numberOfDays <= 1 ? 7 : numberOfDays;
            d.addDays(next ? daysToAdd : -daysToAdd);
          } else {
            const firstDayOfWeek = (next ? 7 : -7) - dayOfTheWeek + firstDay;
            d.addDays(firstDayOfWeek);
          }
        }

        setDate?.(toMarkingFormat(d), updateSources.PAGE_SCROLL);
      }
    },
    [horizontal, isOpen, firstDay, numberOfDays, setDate, date]
  );

  /** Pan Gesture */

  const handleMoveShouldSetPanResponder = (
    _: GestureResponderEvent,
    gestureState: PanResponderGestureState
  ) => {
    if (disablePan || isDraggingRef.current) {
      return false;
    }
    if (!horizontal && isOpen) {
      // disable pan detection when vertical calendar is open to allow calendar scroll
      return false;
    }
    if (!isOpen && gestureState.dy < 0) {
      // disable pan detection to limit to closed height
      return false;
    }
    return gestureState.dy > 5 || gestureState.dy < -5;
  };

  const handlePanResponderMove = (
    _: GestureResponderEvent,
    gestureState: PanResponderGestureState
  ) => {
    // limit min height to closed height
    _wrapperStyles.current.style.height = Math.max(
      closedHeight.current,
      _height.current + gestureState.dy
    );

    if (!horizontal) {
      // vertical CalenderList header
      _headerStyles.style.top = Math.min(
        Math.max(-gestureState.dy, -HEADER_HEIGHT),
        0
      );
    } else {
      // horizontal Week view
      if (!isOpen) {
        _weekCalendarStyles.style.opacity = Math.min(
          1,
          Math.max(1 - gestureState.dy / 100, 0)
        );
      }
    }

    updateNativeStyles();
  };

  const handlePanResponderEnd = () => {
    _height.current = Number(_wrapperStyles.current.style.height);
    bounceToPosition();
  };

  const numberOfDaysCondition = useMemo(() => {
    return !numberOfDays || (numberOfDays && numberOfDays <= 1);
  }, [numberOfDays]);

  const panResponder = useMemo(
    () =>
      numberOfDaysCondition
        ? PanResponder.create({
            onMoveShouldSetPanResponder: handleMoveShouldSetPanResponder,
            onPanResponderMove: handlePanResponderMove,
            onPanResponderRelease: handlePanResponderEnd,
            onPanResponderTerminate: handlePanResponderEnd,
          })
        : PanResponder.create({}),
    [numberOfDays, disablePan, horizontal, isOpen]
  );

  /** Day drag & drop */

  const refreshContainerOffset = useCallback((onDone?: () => void) => {
    // Measure the animated wrapper (actual calendar height), not the outer shell
    const node = wrapper.current || containerRef.current;
    node?.measureInWindow(
      (x: number, y: number, width: number, height: number) => {
        containerWindowOffset.current = { x, y, width, height };
        onDone?.();
      }
    );
  }, []);

  const hitTestDay = useCallback(
    (
      pageX: number,
      pageY: number
    ): (DayLayoutRect & { dateString: string }) | undefined => {
      const layer = isOpenRef.current ? "month" : "week";
      const layouts = dayLayoutsRef.current;
      const {
        x: cx,
        y: cy,
        width: cw,
        height: ch,
      } = containerWindowOffset.current;
      let best: (DayLayoutRect & { dateString: string }) | undefined;
      // Prefer the smallest overlapping target among cells currently in the visible calendar
      let bestArea = Number.POSITIVE_INFINITY;

      for (const key of Object.keys(layouts)) {
        const layout = layouts[key];
        if (layout.layer !== layer || layout.width <= 0 || layout.height <= 0) {
          continue;
        }
        // Ignore off-screen duplicates from adjacent CalendarList month pages
        if (cw > 0 && ch > 0) {
          const intersectsContainer =
            layout.x + layout.width > cx &&
            layout.x < cx + cw &&
            layout.y + layout.height > cy &&
            layout.y < cy + ch;
          if (!intersectsContainer) {
            continue;
          }
        }
        if (
          pageX >= layout.x &&
          pageX <= layout.x + layout.width &&
          pageY >= layout.y &&
          pageY <= layout.y + layout.height
        ) {
          const area = layout.width * layout.height;
          if (area < bestArea) {
            bestArea = area;
            best = {
              x: layout.x,
              y: layout.y,
              width: layout.width,
              height: layout.height,
              dateString: layout.dateString,
            };
          }
        }
      }
      return best;
    },
    []
  );

  const updateGhostPosition = useCallback((pageX: number, pageY: number) => {
    const { x, y } = containerWindowOffset.current;
    ghostRef.current?.setPosition(
      pageX - x - GHOST_HALF_SIZE,
      pageY - y - GHOST_HALF_SIZE
    );
  }, []);

  const updateHoverHighlight = useCallback(
    (hit?: DayLayoutRect & { dateString: string }) => {
      if (!hit) {
        hoverRef.current?.clear();
        return;
      }
      const { x, y } = containerWindowOffset.current;
      // Draw a circle centered on the day cell (cell rect is full column width -> would be a pill)
      const size = HOVER_SIZE;
      const centerX = hit.x + hit.width / 2 - x;
      const centerY = hit.y + hit.height / 2 - y;
      hoverRef.current?.setHover(centerX - size / 2, centerY - size / 2, size, size);
    },
    []
  );

  const onMonthDayLayout = useCallback(
    (instanceId: string, dateString: string, layout: DayLayoutRect) => {
      const key = `month:${instanceId}`;
      if (layout.width <= 0 || layout.height <= 0) {
        delete dayLayoutsRef.current[key];
        return;
      }
      dayLayoutsRef.current[key] = { ...layout, layer: "month", dateString };
    },
    []
  );

  const onWeekDayLayout = useCallback(
    (instanceId: string, dateString: string, layout: DayLayoutRect) => {
      const key = `week:${instanceId}`;
      if (layout.width <= 0 || layout.height <= 0) {
        delete dayLayoutsRef.current[key];
        return;
      }
      dayLayoutsRef.current[key] = { ...layout, layer: "week", dateString };
    },
    []
  );

  const onMonthDayViewRef = useCallback(
    (instanceId: string, dateString: string, ref: View | null) => {
      const key = `month:${instanceId}`;
      if (ref) {
        dayViewRefsRef.current[key] = { ref, dateString, layer: "month" };
      } else {
        delete dayViewRefsRef.current[key];
      }
    },
    []
  );

  const onWeekDayViewRef = useCallback(
    (instanceId: string, dateString: string, ref: View | null) => {
      const key = `week:${instanceId}`;
      if (ref) {
        dayViewRefsRef.current[key] = { ref, dateString, layer: "week" };
      } else {
        delete dayViewRefsRef.current[key];
      }
    },
    []
  );

  const remeasureLayer = useCallback(
    (layer: "month" | "week", onDone: () => void) => {
      const entries = Object.entries(dayViewRefsRef.current).filter(
        ([, value]) => value.layer === layer && value.ref
      );
      if (entries.length === 0) {
        onDone();
        return;
      }

      const {
        x: cx,
        y: cy,
        width: cw,
        height: ch,
      } = containerWindowOffset.current;
      let pending = entries.length;
      entries.forEach(([key, value]) => {
        value.ref.measureInWindow((x, y, width, height) => {
          const intersectsContainer =
            cw <= 0 ||
            ch <= 0 ||
            (x + width > cx && x < cx + cw && y + height > cy && y < cy + ch);

          if (width > 0 && height > 0 && intersectsContainer) {
            dayLayoutsRef.current[key] = {
              x,
              y,
              width,
              height,
              layer,
              dateString: value.dateString,
            };
          } else {
            // Keep off-screen adjacent-month duplicates out of hit-testing
            delete dayLayoutsRef.current[key];
          }
          pending -= 1;
          if (pending <= 0) {
            onDone();
          }
        });
      });
    },
    []
  );

  const handleDayDragStart = useCallback(
    (from: DateData, point: DayDragPoint) => {
      if (!isDragLayoutReadyRef.current) {
        return;
      }
      isDraggingRef.current = true;
      dragFromRef.current = from;
      dragHoverRef.current = from.dateString;
      lastDragPointRef.current = point;
      setIsDragging(true);
      setDragFrom(from);
      onDayDragStart?.(from);

      const layer = isOpenRef.current ? "month" : "week";
      // Wait a frame so setIsDragging re-render settles, then re-measure visible days
      requestAnimationFrame(() => {
        refreshContainerOffset(() => {
          remeasureLayer(layer, () => {
            updateGhostPosition(point.pageX, point.pageY);
            ghostRef.current?.setVisible(true);
            const hit = hitTestDay(point.pageX, point.pageY);
            if (hit) {
              dragHoverRef.current = hit.dateString;
            }
            updateHoverHighlight(hit);
          });
        });
      });
    },
    [
      refreshContainerOffset,
      remeasureLayer,
      updateGhostPosition,
      hitTestDay,
      updateHoverHighlight,
      onDayDragStart,
    ]
  );

  const handleDayDragMove = useCallback(
    (point: DayDragPoint) => {
      if (!isDraggingRef.current) {
        return;
      }
      lastDragPointRef.current = point;
      updateGhostPosition(point.pageX, point.pageY);
      const hit = hitTestDay(point.pageX, point.pageY);
      const hover = hit?.dateString;
      if (hover !== dragHoverRef.current) {
        dragHoverRef.current = hover;
        updateHoverHighlight(hit);
      }
    },
    [updateGhostPosition, hitTestDay, updateHoverHighlight]
  );

  const handleDayDragEnd = useCallback(() => {
    const from = dragFromRef.current;
    if (!from) {
      return;
    }

    // Final hit-test at last pointer position (layouts may have been refreshed mid-drag)
    const lastPoint = lastDragPointRef.current;
    if (lastPoint) {
      const hit = hitTestDay(lastPoint.pageX, lastPoint.pageY);
      if (hit) {
        dragHoverRef.current = hit.dateString;
      }
    }
    const toDateString = dragHoverRef.current;

    isDraggingRef.current = false;
    dragFromRef.current = undefined;
    dragHoverRef.current = undefined;
    lastDragPointRef.current = undefined;
    ghostRef.current?.setVisible(false);
    hoverRef.current?.clear();
    setIsDragging(false);
    setDragFrom(undefined);

    if (toDateString && toDateString !== from.dateString) {
      onDayDragEnd?.({ from, to: xdateToData(toDateString) });
    }
  }, [onDayDragEnd, hitTestDay]);

  // Only the interactive layer may start/participate in drags. The inactive layer
  // stays mounted underneath/over and would otherwise steal touches.
  // Keep layout registration always; omit drag handlers until remeasure completes.
  const weekDragProps = useMemo(() => {
    if (!enableDayDrag || isOpen) {
      return {};
    }
    return {
      enableDayDrag: true,
      onDragStart: isDragLayoutReady ? handleDayDragStart : undefined,
      onDragMove: isDragLayoutReady ? handleDayDragMove : undefined,
      onDragEnd: isDragLayoutReady ? handleDayDragEnd : undefined,
      onDayLayout: onWeekDayLayout,
      onDayViewRef: onWeekDayViewRef,
    };
  }, [
    enableDayDrag,
    isOpen,
    isDragLayoutReady,
    handleDayDragStart,
    handleDayDragMove,
    handleDayDragEnd,
    onWeekDayLayout,
    onWeekDayViewRef,
  ]);

  const monthDragProps = useMemo(() => {
    if (!enableDayDrag || !isOpen) {
      return {};
    }
    return {
      enableDayDrag: true,
      onDragStart: isDragLayoutReady ? handleDayDragStart : undefined,
      onDragMove: isDragLayoutReady ? handleDayDragMove : undefined,
      onDragEnd: isDragLayoutReady ? handleDayDragEnd : undefined,
      onDayLayout: onMonthDayLayout,
      onDayViewRef: onMonthDayViewRef,
    };
  }, [
    enableDayDrag,
    isOpen,
    isDragLayoutReady,
    handleDayDragStart,
    handleDayDragMove,
    handleDayDragEnd,
    onMonthDayLayout,
    onMonthDayViewRef,
  ]);

  // After open/close settles, refresh day window layouts for the active layer.
  // Drag handlers stay disabled until this finishes.
  useEffect(() => {
    if (!enableDayDrag) {
      isDragLayoutReadyRef.current = true;
      setIsDragLayoutReady(true);
      return;
    }

    isDragLayoutReadyRef.current = false;
    setIsDragLayoutReady(false);

    const layer = isOpen ? "month" : "week";
    // Drop inactive-layer geometry so it cannot win hit-tests
    Object.keys(dayLayoutsRef.current).forEach((key) => {
      if (!key.startsWith(`${layer}:`)) {
        delete dayLayoutsRef.current[key];
      }
    });
    Object.keys(dayViewRefsRef.current).forEach((key) => {
      if (dayViewRefsRef.current[key]?.layer !== layer) {
        delete dayViewRefsRef.current[key];
      }
    });

    let cancelled = false;
    const timer = setTimeout(() => {
      refreshContainerOffset(() => {
        if (cancelled) {
          return;
        }
        remeasureLayer(layer, () => {
          if (cancelled) {
            return;
          }
          isDragLayoutReadyRef.current = true;
          setIsDragLayoutReady(true);
        });
      });
    }, 50);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, enableDayDrag, refreshContainerOffset, remeasureLayer]);

  /** Animated */

  const bounceToPosition = (toValue = 0) => {
    if (!disablePan) {
      const threshold = isOpen
        ? openHeight.current - closeThreshold
        : closedHeight.current + openThreshold;
      let _isOpen = _height.current >= threshold;
      const newValue = _isOpen ? openHeight.current : closedHeight.current;

      deltaY.current.setValue(_height.current); // set the start position for the animated value
      _height.current = toValue || newValue;
      _isOpen = _height.current >= threshold; // re-check after _height.current was set

      Animated.spring(deltaY.current, {
        toValue: _height.current,
        speed: SPEED,
        bounciness: BOUNCINESS,
        useNativeDriver: false,
      }).start();

      onCalendarToggled?.(_isOpen);

      setPosition(() =>
        _height.current === closedHeight.current
          ? Positions.CLOSED
          : Positions.OPEN
      );
      closeHeader(_isOpen);
      resetWeekCalendarOpacity(_isOpen);
    }
  };

  const resetWeekCalendarOpacity = (isOpen: boolean) => {
    _weekCalendarStyles.style.opacity = isOpen ? 0 : 1;
    updateNativeStyles();
  };

  const closeHeader = (isOpen: boolean) => {
    headerDeltaY.current.setValue(Number(_headerStyles.style.top)); // set the start position for the animated value

    if (!horizontal && !isOpen) {
      Animated.spring(headerDeltaY.current, {
        toValue: 0,
        speed: SPEED / 10,
        bounciness: 1,
        useNativeDriver: false,
      }).start();
    }
  };

  const closeCalendar = useCallback(() => {
    setTimeout(() => {
      // to allows setDate to be completed
      if (isOpen) {
        bounceToPosition(closedHeight.current);
      }
    }, 0);
  }, [isOpen]);

  /** Events */

  const _onPressArrowLeft = useCallback(
    (method: () => void, month?: XDate) => {
      onPressArrowLeft?.(method, month);
      scrollPage(false);
    },
    [onPressArrowLeft, scrollPage]
  );

  const _onPressArrowRight = useCallback(
    (method: () => void, month?: XDate) => {
      onPressArrowRight?.(method, month);
      scrollPage(true);
    },
    [onPressArrowRight, scrollPage]
  );

  const _onDayPress = useCallback(
    (value: DateData) => {
      if (numberOfDaysCondition) {
        setDate?.(value.dateString, updateSources.DAY_PRESS);
      }
      if (closeOnDayPress) {
        closeCalendar();
      }
      onDayPress?.(value);
    },
    [onDayPress, closeOnDayPress, closeCalendar, numberOfDaysCondition]
  );

  const onVisibleMonthsChange = useCallback(
    throttle(
      (value: DateData[]) => {
        const newDate = first(value);
        if (newDate) {
          const month = newDate.month;
          if (month && visibleMonth.current !== month) {
            visibleMonth.current = month;

            const year = newDate.year;
            if (year) {
              visibleYear.current = year;
            }

            // for horizontal scroll
            if (visibleMonth.current !== getMonth(date)) {
              const next = isLaterDate(newDate, date);
              scrollPage(next);
            }

            // updating openHeight
            setTimeout(() => {
              // to wait for setDate() call in horizontal scroll (scrollPage())
              const _numberOfWeeks = getNumberOfWeeksInMonth(
                newDate.dateString
              );
              if (_numberOfWeeks !== numberOfWeeks.current) {
                numberOfWeeks.current = _numberOfWeeks;
                openHeight.current = getOpenHeight();
                if (isOpen) {
                  bounceToPosition(openHeight.current);
                }
              }
            }, 0);
          }
        }
      },
      100,
      { trailing: true, leading: false }
    ),
    [date, scrollPage]
  );

  /** Renders */

  const _renderArrow = useCallback(
    (direction: Direction) => {
      if (isFunction(renderArrow)) {
        return renderArrow(direction);
      }

      return (
        <Image
          source={
            direction === "right" ? rightArrowImageSource : leftArrowImageSource
          }
          style={style.current.arrowImage}
          testID={`${testID}-${direction}-arrow`}
        />
      );
    },
    [renderArrow, rightArrowImageSource, leftArrowImageSource, testID]
  );

  const renderWeekDaysNames = () => {
    return (
      <View style={weekDaysStyle}>
        <WeekDaysNames firstDay={firstDay} style={style.current.dayHeader} />
      </View>
    );
  };

  const renderAnimatedHeader = () => {
    const monthYear = new XDate(date).toString("MMMM yyyy");

    return (
      <Animated.View ref={header} style={headerStyle} pointerEvents={"none"}>
        <Text allowFontScaling={false} style={style.current.headerTitle}>
          {monthYear}
        </Text>
        {renderWeekDaysNames()}
      </Animated.View>
    );
  };

  const renderKnob = () => {
    return (
      <View
        style={style.current.knobContainer}
        testID={`${testID}-knob`}
        pointerEvents={"box-none"}
      >
        <TouchableOpacity
          style={style.current.knob}
          testID={CALENDAR_KNOB}
          onPress={closeCalendar}
          hitSlop={knobHitSlop}
          activeOpacity={isOpen ? undefined : 1}
        />
      </View>
    );
  };

  const renderWeekCalendar = () => {
    const WeekComponent = disableWeekScroll ? Week : WeekCalendar;

    return (
      <Animated.View
        ref={weekCalendarWrapper}
        style={weekCalendarStyle}
        pointerEvents={isOpen ? "none" : "auto"}
      >
        <WeekComponent
          testID="week_calendar"
          firstDay={firstDay}
          {...others}
          {...weekDragProps}
          allowShadow={disableWeekScroll ? undefined : false}
          current={date}
          theme={themeObject}
          style={calendarStyle}
          hideDayNames={true}
          onDayPress={_onDayPress}
          markedDates={markedDates}
          markingType={markingType}
          scrollEnabled={!isDragging}
          accessibilityElementsHidden // iOS
          importantForAccessibility={"no-hide-descendants"} // Android
        />
      </Animated.View>
    );
  };

  const numberOfDaysHeaderStyle = useMemo(() => {
    if (numberOfDays && numberOfDays > 1) {
      return { paddingHorizontal: 0 };
    }
  }, [numberOfDays]);

  const renderCalendarList = () => {
    return (
      <View pointerEvents={isOpen ? "auto" : "none"} collapsable={false}>
        <CalendarList
          testID="calendar"
          horizontal={horizontal}
          firstDay={firstDay}
          calendarStyle={calendarStyle}
          {...others}
          {...monthDragProps}
          current={date}
          theme={themeObject}
          ref={calendarList}
          onDayPress={isOpen ? _onDayPress : undefined}
          onVisibleMonthsChange={onVisibleMonthsChange}
          pagingEnabled
          scrollEnabled={isOpen && !isDragging}
          hideArrows={shouldHideArrows}
          onPressArrowLeft={_onPressArrowLeft}
          onPressArrowRight={_onPressArrowRight}
          hideExtraDays={!horizontal && isOpen}
          renderArrow={_renderArrow}
          staticHeader
          numberOfDays={numberOfDays}
          headerStyle={numberOfDaysHeaderStyle}
          timelineLeftInset={timelineLeftInset}
          markedDates={markedDates}
          markingType={markingType}
        />
      </View>
    );
  };

  return (
    <View
      testID={testID}
      style={containerStyle}
      ref={containerRef}
      onLayout={() => refreshContainerOffset()}
    >
      {screenReaderEnabled ? (
        <Calendar
          testID="calendar"
          {...others}
          theme={themeObject}
          onDayPress={_onDayPress}
          hideExtraDays
          renderArrow={_renderArrow}
        />
      ) : (
        <Animated.View
          ref={wrapper}
          style={wrapperStyle}
          {...panResponder.panHandlers}
        >
          {renderCalendarList()}
          {renderWeekCalendar()}
          {!hideKnob && renderKnob()}
          {!horizontal && renderAnimatedHeader()}
          {enableDayDrag && (
            <>
              <DragHoverOverlay ref={hoverRef} theme={theme} />
              <DragGhostOverlay
                ref={ghostRef}
                dayNumber={dragFrom?.day}
                theme={theme}
                marking={
                  dragFrom
                    ? getGhostMarking(markedDates, dragFrom.dateString)
                    : undefined
                }
                markingType={markingType}
              />
            </>
          )}
        </Animated.View>
      )}
    </View>
  );
};

export default ExpandableCalendar;

ExpandableCalendar.displayName = "ExpandableCalendar";
ExpandableCalendar.defaultProps = {
  horizontal: true,
  initialPosition: Positions.CLOSED,
  firstDay: 0,
  leftArrowImageSource: LEFT_ARROW,
  rightArrowImageSource: RIGHT_ARROW,
  allowShadow: true,
  openThreshold: PAN_GESTURE_THRESHOLD,
  closeThreshold: PAN_GESTURE_THRESHOLD,
  closeOnDayPress: true,
};
ExpandableCalendar.positions = Positions;
