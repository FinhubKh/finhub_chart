import type { ToolId } from "../lib/drawings";

type Props = { id: string; size?: number };

/** TradingView-style outline icons for the left toolbar */
export default function ToolIcon({ id, size = 18 }: Props) {
  const s = size;
  const common = {
    width: s,
    height: s,
    viewBox: "0 0 28 28",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (id as ToolId | "magnet" | "stay" | "lock" | "hide" | "undo" | "remove" | "chevron") {
    case "cursor":
      return (
        <svg {...common}>
          <path d="M7 4l10 8.2-4.2.6 2.4 6.2-2.2.9-2.5-6.3L7 17.5V4z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "crosshair":
      return (
        <svg {...common}>
          <path d="M14 4v20M4 14h20" />
          <circle cx="14" cy="14" r="2.2" />
        </svg>
      );
    case "dot":
      return (
        <svg {...common}>
          <circle cx="14" cy="14" r="3.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "arrow":
      return (
        <svg {...common}>
          <path d="M8 20L20 8M12 8h8v8" />
        </svg>
      );
    case "trend":
      return (
        <svg {...common}>
          <path d="M5 20L23 8" />
          <circle cx="5" cy="20" r="1.6" fill="currentColor" />
          <circle cx="23" cy="8" r="1.6" fill="currentColor" />
        </svg>
      );
    case "ray":
      return (
        <svg {...common}>
          <path d="M5 19L16 10" />
          <path d="M16 10L24 5" strokeDasharray="2 2" />
          <circle cx="5" cy="19" r="1.6" fill="currentColor" />
        </svg>
      );
    case "extended":
      return (
        <svg {...common}>
          <path d="M3 21L25 7" />
        </svg>
      );
    case "info_line":
      return (
        <svg {...common}>
          <path d="M5 19L23 9" />
          <path d="M16 7h6v5" />
        </svg>
      );
    case "hline":
      return (
        <svg {...common}>
          <path d="M4 14h20" />
        </svg>
      );
    case "hray":
      return (
        <svg {...common}>
          <path d="M8 14h16" />
          <circle cx="8" cy="14" r="1.6" fill="currentColor" />
        </svg>
      );
    case "vline":
      return (
        <svg {...common}>
          <path d="M14 4v20" />
        </svg>
      );
    case "cross_line":
      return (
        <svg {...common}>
          <path d="M14 4v20M4 14h20" />
        </svg>
      );
    case "fib":
      return (
        <svg {...common}>
          <path d="M5 7h18M5 12h18M5 16h18M5 21h18" />
          <path d="M5 7v14" />
        </svg>
      );
    case "fib_ext":
      return (
        <svg {...common}>
          <path d="M5 20L14 8l9 6" />
          <path d="M5 20h18" strokeDasharray="2 2" />
        </svg>
      );
    case "rect":
      return (
        <svg {...common}>
          <rect x="6" y="7" width="16" height="14" rx="1" />
        </svg>
      );
    case "ellipse":
      return (
        <svg {...common}>
          <ellipse cx="14" cy="14" rx="9" ry="7" />
        </svg>
      );
    case "triangle":
      return (
        <svg {...common}>
          <path d="M14 6L23 21H5L14 6z" />
        </svg>
      );
    case "path":
      return (
        <svg {...common}>
          <path d="M5 20l5-8 5 4 7-10" />
          <circle cx="5" cy="20" r="1.4" fill="currentColor" />
          <circle cx="10" cy="12" r="1.4" fill="currentColor" />
          <circle cx="15" cy="16" r="1.4" fill="currentColor" />
        </svg>
      );
    case "brush":
      return (
        <svg {...common}>
          <path d="M7 21c2-1 3-3 3-5 4 1 8-2 10-7l-5-3c-2 4-5 7-8 8z" />
        </svg>
      );
    case "arrow_mark":
      return (
        <svg {...common}>
          <path d="M6 18L20 8" />
          <path d="M13 8h7v7" />
        </svg>
      );
    case "text":
      return (
        <svg {...common}>
          <path d="M7 8h14M14 8v13" />
        </svg>
      );
    case "callout":
      return (
        <svg {...common}>
          <rect x="5" y="5" width="18" height="12" rx="2" />
          <path d="M10 17l-3 5 5-4" />
        </svg>
      );
    case "price_label":
      return (
        <svg {...common}>
          <path d="M5 10h12l4 4-4 4H5V10z" />
        </svg>
      );
    case "long":
      return (
        <svg {...common}>
          <path d="M8 18V8m0 0l-3 3M8 8l3 3" />
          <path d="M14 8h8M14 14h8M14 20h8" />
        </svg>
      );
    case "short":
      return (
        <svg {...common}>
          <path d="M8 10v10m0 0l-3-3M8 20l3-3" />
          <path d="M14 8h8M14 14h8M14 20h8" />
        </svg>
      );
    case "measure":
      return (
        <svg {...common}>
          <path d="M6 18L18 6" />
          <path d="M8 20h4M16 4h4" />
        </svg>
      );
    case "price_range":
      return (
        <svg {...common}>
          <path d="M8 6v16M20 6v16" />
          <path d="M8 10h12M8 18h12" />
        </svg>
      );
    case "date_range":
      return (
        <svg {...common}>
          <path d="M6 8h16M6 20h16M9 4v4M19 4v4" />
          <rect x="6" y="8" width="16" height="12" rx="1" />
        </svg>
      );
    case "eraser":
      return (
        <svg {...common}>
          <path d="M5 16l8-8 6 6-8 8H5v-6z" />
          <path d="M10 21h12" />
        </svg>
      );
    case "magnet":
      return (
        <svg {...common}>
          <path d="M8 6v8a6 6 0 0012 0V6" />
          <path d="M8 6H5v4h3M20 6h3v4h-3" />
        </svg>
      );
    case "stay":
      return (
        <svg {...common}>
          <path d="M8 8h8v8" />
          <path d="M8 16l12-12" />
          <circle cx="8" cy="16" r="1.5" fill="currentColor" />
        </svg>
      );
    case "lock":
      return (
        <svg {...common}>
          <rect x="7" y="12" width="14" height="10" rx="1.5" />
          <path d="M10 12V9a4 4 0 018 0v3" />
        </svg>
      );
    case "hide":
      return (
        <svg {...common}>
          <path d="M4 14s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" />
          <circle cx="14" cy="14" r="2.5" />
          <path d="M5 23L23 5" />
        </svg>
      );
    case "undo":
      return (
        <svg {...common}>
          <path d="M8 12H5l4-5 4 5h-3a6 6 0 11-1.5 8" />
        </svg>
      );
    case "remove":
      return (
        <svg {...common}>
          <path d="M6 9h16M11 9V6h6v3M10 12v9M14 12v9M18 12v9M8 9l1 14h10l1-14" />
        </svg>
      );
    case "chevron":
      return (
        <svg width={10} height={10} viewBox="0 0 10 10" fill="currentColor">
          <path d="M3 2l4 3-4 3" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="14" cy="14" r="5" />
        </svg>
      );
  }
}
