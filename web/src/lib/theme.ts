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

/** Lightweight Charts layout colors for the active scheme. */
export function chartThemeOptions(scheme: ColorScheme) {
  if (scheme === "light") {
    return {
      layout: {
        background: { color: "#ffffff" },
        textColor: "#131722",
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
      rightPriceScale: { borderColor: "#e0e3eb" },
      timeScale: { borderColor: "#e0e3eb" },
    };
  }

  return {
    layout: {
      background: { color: "#131722" },
      textColor: "#d1d4dc",
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
    rightPriceScale: { borderColor: "#2a2e39" },
    timeScale: { borderColor: "#2a2e39" },
  };
}
