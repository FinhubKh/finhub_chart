export type ChartSettings = {
  upColor: string;
  downColor: string;
  bgDark: string;
  bgLight: string;
  showGrid: boolean;
};

export const DEFAULT_SETTINGS: ChartSettings = {
  upColor: "#089981",
  downColor: "#f23645",
  bgDark: "#131722",
  bgLight: "#ffffff",
  showGrid: true,
};

const STORAGE_KEY = "finhubkh-settings";

export function loadSettings(): ChartSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: ChartSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}
