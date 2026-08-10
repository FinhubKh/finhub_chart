export type ColorScheme = "dark" | "light";

const STORAGE_KEY = "finhubkh-theme";

export function loadTheme(): ColorScheme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* ignore */
  }
  return "dark";
}

export function saveTheme(scheme: ColorScheme) {
  try {
    localStorage.setItem(STORAGE_KEY, scheme);
  } catch {
    /* ignore */
  }
}

export function applyDocumentTheme(scheme: ColorScheme) {
  document.documentElement.setAttribute("data-theme", scheme);
}

/** True for phone-width or coarse touch UIs. */
export function isCompactChartUi() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(max-width: 768px)").matches ||
    window.matchMedia("(hover: none) and (pointer: coarse)").matches
  );
}

/** Lightweight Charts layout colors for the active scheme. */
export function chartThemeOptions(scheme: ColorScheme, compact = false) {
  const fontSize = compact ? 10 : 12;
  const priceMinWidth = compact ? 52 : 64;

  if (scheme === "light") {
    return {
      layout: {
        background: { color: "#ffffff" },
        textColor: "#131722",
        fontSize,
      },
      grid: {
        vertLines: { color: "#e0e3eb" },
        horzLines: { color: "#e0e3eb" },
      },
      crosshair: {
        mode: 0 as const,
        vertLine: { color: "#9598a1", labelBackgroundColor: "#2962ff" },
        horzLine: { color: "#9598a1", labelBackgroundColor: "#2962ff" },
      },
      rightPriceScale: {
        borderColor: "#e0e3eb",
        minimumWidth: priceMinWidth,
        entireTextOnly: true,
      },
      timeScale: {
        borderColor: "#e0e3eb",
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        axisDoubleClickReset: true,
        mouseWheel: true,
        pinch: true,
      },
    };
  }

  return {
    layout: {
      background: { color: "#131722" },
      textColor: "#d1d4dc",
      fontSize,
    },
    grid: {
      vertLines: { color: "#1e222d" },
      horzLines: { color: "#1e222d" },
    },
    crosshair: {
      mode: 0 as const,
      vertLine: { color: "#758696", labelBackgroundColor: "#2962ff" },
      horzLine: { color: "#758696", labelBackgroundColor: "#2962ff" },
    },
    rightPriceScale: {
      borderColor: "#2a2e39",
      minimumWidth: priceMinWidth,
      entireTextOnly: true,
    },
    timeScale: {
      borderColor: "#2a2e39",
      timeVisible: true,
      secondsVisible: false,
    },
    handleScroll: {
      mouseWheel: true,
      pressedMouseMove: true,
      horzTouchDrag: true,
      vertTouchDrag: true,
    },
    handleScale: {
      axisPressedMouseMove: true,
      axisDoubleClickReset: true,
      mouseWheel: true,
      pinch: true,
    },
  };
}
