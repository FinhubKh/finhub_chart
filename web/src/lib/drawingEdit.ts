import type { Drawing, Point } from "./drawings";
import { positionWidthLogical } from "./drawings";

export type Handle =
  | "a"
  | "b"
  | "body"
  | "entry"
  | "stop"
  | "take"
  | "width"
  | "price"
  | "logical"
  | "at";

export type Hit = {
  index: number;
  id: string;
  handle: Handle;
};

type XY = { x: number; y: number };

function distPx(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(ax - bx, ay - by);
}

function nearLine(
  x: number,
  y: number,
  pa: XY,
  pb: XY,
  tol: number
): boolean {
  const ab = distPx(pa.x, pa.y, pb.x, pb.y) || 1;
  const t = Math.max(
    0,
    Math.min(1, ((x - pa.x) * (pb.x - pa.x) + (y - pa.y) * (pb.y - pa.y)) / (ab * ab))
  );
  const px = pa.x + t * (pb.x - pa.x);
  const py = pa.y + t * (pb.y - pa.y);
  return distPx(x, y, px, py) < tol;
}

function shiftPoint(p: Point, dLogical: number, dPrice: number): Point {
  return { logical: p.logical + dLogical, price: p.price + dPrice };
}

/** Hit-test topmost drawing. Handles beat body. */
export function hitTestDrawing(
  drawings: Drawing[],
  x: number,
  y: number,
  toXY: (p: Point) => XY | null,
  priceToY: (price: number) => number | null,
  _chartWidth: number
): Hit | null {
  const HANDLE = 10;
  const LINE = 8;

  for (let i = drawings.length - 1; i >= 0; i--) {
    const d = drawings[i];

    if (d.type === "long" || d.type === "short") {
      const entry = toXY(d.entry);
      const stopY = priceToY(d.stop);
      const takeY = priceToY(d.take);
      if (!entry || stopY == null || takeY == null) continue;
      const end = toXY({
        logical: d.entry.logical + positionWidthLogical(d),
        price: d.entry.price,
      });
      const x0 = Math.min(entry.x, end?.x ?? entry.x + 80);
      const x1 = Math.max(entry.x, end?.x ?? entry.x + 80);
      const top = Math.min(entry.y, stopY, takeY);
      const bot = Math.max(entry.y, stopY, takeY);

      // Right-edge width handle (priority over body)
      if (
        Math.abs(x - x1) < HANDLE + 2 &&
        y >= top - HANDLE &&
        y <= bot + HANDLE
      ) {
        return { index: i, id: d.id, handle: "width" };
      }
      if (x >= x0 - 4 && x <= x1 + 40) {
        if (Math.abs(y - entry.y) < HANDLE) {
          return { index: i, id: d.id, handle: "entry" };
        }
        if (Math.abs(y - stopY) < HANDLE) {
          return { index: i, id: d.id, handle: "stop" };
        }
        if (Math.abs(y - takeY) < HANDLE) {
          return { index: i, id: d.id, handle: "take" };
        }
        if (x >= x0 && x <= x1 && y >= top && y <= bot) {
          return { index: i, id: d.id, handle: "body" };
        }
      }
      continue;
    }

    if (d.type === "hline" || d.type === "hray") {
      const y0 = priceToY(d.price);
      if (y0 == null || Math.abs(y0 - y) >= LINE) continue;
      return { index: i, id: d.id, handle: "price" };
    }

    if (d.type === "vline" || d.type === "cross_line") {
      const xy = toXY({
        logical: d.logical,
        price: d.price ?? 0,
      });
      if (!xy) continue;
      if (Math.abs(xy.x - x) < LINE) {
        return { index: i, id: d.id, handle: "logical" };
      }
      if (d.type === "cross_line" && d.price != null) {
        const y0 = priceToY(d.price);
        if (y0 != null && Math.abs(y0 - y) < LINE) {
          return { index: i, id: d.id, handle: "price" };
        }
      }
      continue;
    }

    if (d.type === "text" || d.type === "callout" || d.type === "price_label") {
      const p = toXY(d.at);
      if (p && distPx(x, y, p.x, p.y) < 22) {
        return { index: i, id: d.id, handle: "at" };
      }
      continue;
    }

    if (d.type === "path" || d.type === "brush") {
      if (d.points.length < 2) continue;
      for (let k = 1; k < d.points.length; k++) {
        const pa = toXY(d.points[k - 1]);
        const pb = toXY(d.points[k]);
        if (pa && pb && nearLine(x, y, pa, pb, LINE)) {
          return { index: i, id: d.id, handle: "body" };
        }
      }
      continue;
    }

    if ("a" in d && "b" in d) {
      const pa = toXY(d.a);
      const pb = toXY(d.b);
      if (!pa || !pb) continue;
      if (distPx(x, y, pa.x, pa.y) < HANDLE) {
        return { index: i, id: d.id, handle: "a" };
      }
      if (distPx(x, y, pb.x, pb.y) < HANDLE) {
        return { index: i, id: d.id, handle: "b" };
      }
      if (d.type === "rect" || d.type === "ellipse" || d.type === "triangle") {
        const left = Math.min(pa.x, pb.x);
        const right = Math.max(pa.x, pb.x);
        const top = Math.min(pa.y, pb.y);
        const bot = Math.max(pa.y, pb.y);
        const onEdge =
          (x >= left - LINE &&
            x <= right + LINE &&
            (Math.abs(y - top) < LINE || Math.abs(y - bot) < LINE)) ||
          (y >= top - LINE &&
            y <= bot + LINE &&
            (Math.abs(x - left) < LINE || Math.abs(x - right) < LINE));
        const inside = x >= left && x <= right && y >= top && y <= bot;
        if (onEdge || inside) {
          return { index: i, id: d.id, handle: "body" };
        }
      } else if (nearLine(x, y, pa, pb, LINE)) {
        return { index: i, id: d.id, handle: "body" };
      }
    }
  }

  return null;
}

/** Apply a drag from the original snapshot using pointer start → current chart points. */
export function applyEdit(
  original: Drawing,
  handle: Handle,
  startPtr: Point,
  curPtr: Point
): Drawing {
  const dLogical = curPtr.logical - startPtr.logical;
  const dPrice = curPtr.price - startPtr.price;

  if (original.type === "long" || original.type === "short") {
    const isLong = original.type === "long";
    if (handle === "entry") {
      let price = curPtr.price;
      if (isLong) {
        price = Math.min(price, original.take - 0.01);
        price = Math.max(price, original.stop + 0.01);
      } else {
        price = Math.max(price, original.take + 0.01);
        price = Math.min(price, original.stop - 0.01);
      }
      return {
        ...original,
        entry: { logical: original.entry.logical + dLogical, price },
      };
    }
    if (handle === "stop") {
      let stop = curPtr.price;
      if (isLong) stop = Math.min(stop, original.entry.price - 0.01);
      else stop = Math.max(stop, original.entry.price + 0.01);
      return { ...original, stop };
    }
    if (handle === "take") {
      let take = curPtr.price;
      if (isLong) take = Math.max(take, original.entry.price + 0.01);
      else take = Math.min(take, original.entry.price - 0.01);
      return { ...original, take };
    }
    if (handle === "width") {
      // Drag right edge — width in bars from entry (min 2)
      const widthLogical = Math.max(2, curPtr.logical - original.entry.logical);
      return { ...original, widthLogical };
    }
    // body — move time + all prices together
    return {
      ...original,
      entry: shiftPoint(original.entry, dLogical, dPrice),
      stop: original.stop + dPrice,
      take: original.take + dPrice,
      widthLogical: positionWidthLogical(original),
    };
  }

  if (original.type === "hline" || original.type === "hray") {
    if (handle === "price" || handle === "body") {
      return {
        ...original,
        price: original.price + dPrice,
        label: (original.price + dPrice).toFixed(2),
        logical:
          original.type === "hray" && original.logical != null
            ? original.logical + dLogical
            : original.logical,
      };
    }
  }

  if (original.type === "vline") {
    return { ...original, logical: original.logical + dLogical };
  }

  if (original.type === "cross_line") {
    if (handle === "logical") {
      return { ...original, logical: original.logical + dLogical };
    }
    if (handle === "price") {
      return {
        ...original,
        price: (original.price ?? startPtr.price) + dPrice,
      };
    }
    return {
      ...original,
      logical: original.logical + dLogical,
      price: (original.price ?? startPtr.price) + dPrice,
    };
  }

  if (
    original.type === "text" ||
    original.type === "callout" ||
    original.type === "price_label"
  ) {
    return {
      ...original,
      at: handle === "at" || handle === "body" ? curPtr : shiftPoint(original.at, dLogical, dPrice),
      text:
        original.type === "price_label"
          ? curPtr.price.toFixed(2)
          : original.text,
    };
  }

  if (original.type === "path" || original.type === "brush") {
    return {
      ...original,
      points: original.points.map((p) => shiftPoint(p, dLogical, dPrice)),
    };
  }

  if ("a" in original && "b" in original) {
    if (handle === "a") return { ...original, a: curPtr };
    if (handle === "b") return { ...original, b: curPtr };
    return {
      ...original,
      a: shiftPoint(original.a, dLogical, dPrice),
      b: shiftPoint(original.b, dLogical, dPrice),
    };
  }

  return original;
}

export function cursorForHandle(handle: Handle): string {
  if (handle === "stop" || handle === "take" || handle === "entry" || handle === "price") {
    return "ns-resize";
  }
  if (handle === "logical" || handle === "width") return "ew-resize";
  if (handle === "a" || handle === "b") return "grab";
  return "move";
}
