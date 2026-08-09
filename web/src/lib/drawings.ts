/** Free chart point — fractional logical index (not snapped to bar center). */
export type Point = { logical: number; price: number };

export type ToolId =
  | "cursor"
  | "crosshair"
  | "dot"
  | "arrow"
  | "trend"
  | "ray"
  | "extended"
  | "info_line"
  | "hline"
  | "hray"
  | "vline"
  | "cross_line"
  | "rect"
  | "ellipse"
  | "triangle"
  | "path"
  | "brush"
  | "arrow_mark"
  | "fib"
  | "fib_ext"
  | "long"
  | "short"
  | "text"
  | "callout"
  | "price_label"
  | "measure"
  | "price_range"
  | "date_range"
  | "eraser";

export type Drawing =
  | {
      id: string;
      type:
        | "trend"
        | "ray"
        | "extended"
        | "info_line"
        | "measure"
        | "price_range"
        | "date_range"
        | "arrow_mark";
      a: Point;
      b: Point;
      color: string;
    }
  | {
      id: string;
      type: "hline" | "hray";
      price: number;
      logical?: number;
      color: string;
      label?: string;
    }
  | {
      id: string;
      type: "vline" | "cross_line";
      logical: number;
      price?: number;
      color: string;
    }
  | {
      id: string;
      type: "rect" | "ellipse" | "triangle" | "fib" | "fib_ext";
      a: Point;
      b: Point;
      color: string;
    }
  | {
      id: string;
      type: "path" | "brush";
      points: Point[];
      color: string;
    }
  | {
      id: string;
      type: "long" | "short";
      entry: Point;
      stop: number;
      take: number;
    }
  | {
      id: string;
      type: "text" | "callout" | "price_label";
      at: Point;
      text: string;
      color: string;
    };

export type FlyoutTool = {
  id: ToolId;
  tip: string;
};

export type ToolbarSlot =
  | {
      kind: "flyout";
      id: string;
      tip: string;
      tools: FlyoutTool[];
      defaultTool: ToolId;
    }
  | {
      kind: "single";
      id: ToolId;
      tip: string;
    }
  | { kind: "sep" }
  | {
      kind: "action";
      id: "stay" | "lock" | "hide" | "undo" | "remove";
      tip: string;
    };

/** TradingView-style left toolbar slots */
export const TOOLBAR_SLOTS: ToolbarSlot[] = [
  {
    kind: "flyout",
    id: "cursors",
    tip: "Cursors",
    defaultTool: "cursor",
    tools: [
      { id: "cursor", tip: "Cursor" },
      { id: "crosshair", tip: "Cross" },
      { id: "dot", tip: "Dot" },
      { id: "arrow", tip: "Arrow" },
    ],
  },
  {
    kind: "flyout",
    id: "trend",
    tip: "Trend Line Tools",
    defaultTool: "trend",
    tools: [
      { id: "trend", tip: "Trend Line" },
      { id: "ray", tip: "Ray" },
      { id: "info_line", tip: "Info Line" },
      { id: "extended", tip: "Extended Line" },
      { id: "hline", tip: "Horizontal Line" },
      { id: "hray", tip: "Horizontal Ray" },
      { id: "vline", tip: "Vertical Line" },
      { id: "cross_line", tip: "Cross Line" },
    ],
  },
  {
    kind: "flyout",
    id: "fib",
    tip: "Gann and Fibonacci Tools",
    defaultTool: "fib",
    tools: [
      { id: "fib", tip: "Fib Retracement" },
      { id: "fib_ext", tip: "Fib Extension" },
    ],
  },
  {
    kind: "flyout",
    id: "shapes",
    tip: "Geometric Shapes",
    defaultTool: "rect",
    tools: [
      { id: "rect", tip: "Rectangle" },
      { id: "ellipse", tip: "Ellipse" },
      { id: "triangle", tip: "Triangle" },
      { id: "path", tip: "Path" },
      { id: "brush", tip: "Brush" },
      { id: "arrow_mark", tip: "Arrow" },
    ],
  },
  {
    kind: "flyout",
    id: "annotation",
    tip: "Annotation Tools",
    defaultTool: "text",
    tools: [
      { id: "text", tip: "Text" },
      { id: "callout", tip: "Callout" },
      { id: "price_label", tip: "Price Label" },
    ],
  },
  {
    kind: "flyout",
    id: "prediction",
    tip: "Prediction and Measurement Tools",
    defaultTool: "long",
    tools: [
      { id: "long", tip: "Long Position" },
      { id: "short", tip: "Short Position" },
      { id: "price_range", tip: "Price Range" },
      { id: "date_range", tip: "Date Range" },
      { id: "measure", tip: "Measure" },
    ],
  },
  { kind: "sep" },
  { kind: "single", id: "eraser", tip: "Eraser" },
  { kind: "sep" },
  { kind: "action", id: "stay", tip: "Stay in Drawing Mode" },
  { kind: "action", id: "lock", tip: "Lock All Drawings" },
  { kind: "action", id: "hide", tip: "Hide All Drawings" },
  { kind: "sep" },
  { kind: "action", id: "undo", tip: "Undo" },
  { kind: "action", id: "remove", tip: "Remove Selected (or all if none)" },
];

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
export const FIB_EXT_LEVELS = [0, 0.618, 1, 1.618, 2.618];

export const NAV_TOOLS: ToolId[] = ["cursor", "crosshair", "dot", "arrow"];

export function isNavTool(tool: ToolId) {
  return NAV_TOOLS.includes(tool);
}

export function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
