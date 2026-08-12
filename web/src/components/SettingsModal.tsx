import { useEffect, useRef } from "react";
import type { ChartSettings } from "../lib/settings";
import { DEFAULT_SETTINGS } from "../lib/settings";

type Props = {
  open: boolean;
  onClose: () => void;
  settings: ChartSettings;
  onChange: (s: ChartSettings) => void;
};

export default function SettingsModal({ open, onClose, settings, onChange }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleChange = (key: keyof ChartSettings, val: any) => {
    onChange({ ...settings, [key]: val });
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  return (
    <div
      ref={overlayRef}
      onMouseDown={handleOverlayClick}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "color-mix(in srgb, var(--bg) 60%, transparent)",
        backdropFilter: "blur(2px)",
        display: "grid",
        placeItems: "center",
        padding: "1rem"
      }}
    >
      <div
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: "10px",
          width: "min(320px, 100%)",
          boxShadow: "0 16px 40px rgba(0,0,0,0.4)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden"
        }}
      >
        <div style={{
          padding: "1rem",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        }}>
          <h3 style={{ margin: 0, fontSize: "1rem", color: "var(--text)" }}>Chart Settings</h3>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--muted)",
              cursor: "pointer",
              fontSize: "1.2rem",
              lineHeight: 1
            }}
          >
            &times;
          </button>
        </div>

        <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label style={{ fontSize: "0.85rem", color: "var(--text)" }}>Up Candle</label>
            <input
              type="color"
              value={settings.upColor}
              onChange={(e) => handleChange("upColor", e.target.value)}
              style={{ cursor: "pointer" }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label style={{ fontSize: "0.85rem", color: "var(--text)" }}>Down Candle</label>
            <input
              type="color"
              value={settings.downColor}
              onChange={(e) => handleChange("downColor", e.target.value)}
              style={{ cursor: "pointer" }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label style={{ fontSize: "0.85rem", color: "var(--text)" }}>Background (Dark)</label>
            <input
              type="color"
              value={settings.bgDark}
              onChange={(e) => handleChange("bgDark", e.target.value)}
              style={{ cursor: "pointer" }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label style={{ fontSize: "0.85rem", color: "var(--text)" }}>Background (Light)</label>
            <input
              type="color"
              value={settings.bgLight}
              onChange={(e) => handleChange("bgLight", e.target.value)}
              style={{ cursor: "pointer" }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label style={{ fontSize: "0.85rem", color: "var(--text)", cursor: "pointer" }} htmlFor="showGridToggle">Show Grid</label>
            <input
              id="showGridToggle"
              type="checkbox"
              checked={settings.showGrid !== false}
              onChange={(e) => handleChange("showGrid", e.target.checked)}
              style={{ cursor: "pointer", width: "1.2rem", height: "1.2rem" }}
            />
          </div>
        </div>

        <div style={{ padding: "1rem", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={() => onChange(DEFAULT_SETTINGS)}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text)",
              padding: "0.4rem 0.8rem",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.8rem"
            }}
          >
            Reset Defaults
          </button>
        </div>
      </div>
    </div>
  );
}
