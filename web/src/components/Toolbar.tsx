import { useEffect, useMemo, useRef, useState } from "react";
import "../styles/components/toolbar.css";
import {
  TOOLBAR_SLOTS,
  type ToolId,
  type ToolbarSlot,
} from "../lib/drawings";
import ToolIcon from "./ToolIcons";

type Props = {
  tool: ToolId;
  color: string;
  stayInDraw: boolean;
  locked: boolean;
  hidden: boolean;
  onTool: (t: ToolId) => void;
  onColor: (c: string) => void;
  onStay: () => void;
  onLock: () => void;
  onHide: () => void;
  onClear: () => void;
  onUndo: () => void;
  hasSelection: boolean;
};

function slotContains(slot: ToolbarSlot, tool: ToolId) {
  if (slot.kind === "single") return slot.id === tool;
  if (slot.kind === "flyout") return slot.tools.some((t) => t.id === tool);
  return false;
}

export default function Toolbar({
  tool,
  color,
  stayInDraw,
  locked,
  hidden,
  onTool,
  onColor,
  onStay,
  onLock,
  onHide,
  onClear,
  onUndo,
  hasSelection,
}: Props) {
  const [openFlyout, setOpenFlyout] = useState<string | null>(null);
  const [lastByGroup, setLastByGroup] = useState<Record<string, ToolId>>({});
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenFlyout(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const activeFlyoutTool = useMemo(() => {
    for (const slot of TOOLBAR_SLOTS) {
      if (slot.kind === "flyout" && slotContains(slot, tool)) return tool;
    }
    return null;
  }, [tool]);

  const iconForSlot = (slot: Extract<ToolbarSlot, { kind: "flyout" }>) => {
    if (activeFlyoutTool && slot.tools.some((t) => t.id === activeFlyoutTool)) {
      return activeFlyoutTool;
    }
    return lastByGroup[slot.id] || slot.defaultTool;
  };

  return (
    <aside className="tv-toolbar" ref={rootRef}>
      {TOOLBAR_SLOTS.map((slot, idx) => {
        if (slot.kind === "sep") {
          return <div className="tv-sep" key={`sep-${idx}`} />;
        }

        if (slot.kind === "action") {
          const pressed =
            (slot.id === "stay" && stayInDraw) ||
            (slot.id === "lock" && locked) ||
            (slot.id === "hide" && hidden);
          const handler = () => {
            if (slot.id === "stay") onStay();
            if (slot.id === "lock") onLock();
            if (slot.id === "hide") onHide();
            if (slot.id === "undo") onUndo();
            if (slot.id === "remove") onClear();
          };
          const tip =
            slot.id === "remove"
              ? hasSelection
                ? "Remove Selected Drawing"
                : "Remove All Drawings"
              : slot.tip;
          return (
            <button
              key={slot.id}
              type="button"
              className={`tv-btn ${pressed ? "active" : ""} ${
                slot.id === "remove" ? "danger" : ""
              }`}
              title={tip}
              onClick={handler}
            >
              <ToolIcon id={slot.id} size={24} />
            </button>
          );
        }

        if (slot.kind === "single") {
          return (
            <button
              key={slot.id}
              type="button"
              className={`tv-btn ${tool === slot.id ? "active" : ""}`}
              title={slot.tip}
              onClick={() => onTool(slot.id)}
            >
              <ToolIcon id={slot.id} size={24} />
            </button>
          );
        }

        // flyout
        const currentIcon = iconForSlot(slot);
        const isActive = slotContains(slot, tool);
        const isOpen = openFlyout === slot.id;

        return (
          <div className="tv-flyout-wrap" key={slot.id}>
            <button
              type="button"
              className={`tv-btn has-menu ${isActive ? "active" : ""}`}
              title={`${slot.tip} — click to open tools`}
              onClick={() => {
                // Open menu so the user can pick the real tool (hline, fib, long, …)
                // instead of silently staying on trend line.
                setOpenFlyout(isOpen ? null : slot.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setOpenFlyout(isOpen ? null : slot.id);
              }}
            >
              <ToolIcon id={currentIcon} size={24} />
              <span
                className="tv-caret"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenFlyout(isOpen ? null : slot.id);
                }}
              >
                <ToolIcon id="chevron" size={12} />
              </span>
            </button>

            {isOpen && (
              <div className="tv-flyout">
                <div className="tv-flyout-title">{slot.tip}</div>
                {slot.tools.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`tv-flyout-item ${tool === t.id ? "active" : ""}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onTool(t.id);
                      setLastByGroup((m) => ({ ...m, [slot.id]: t.id }));
                      setOpenFlyout(null);
                    }}
                  >
                    <ToolIcon id={t.id} size={22} />
                    <span>{t.tip}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div className="tv-sep" />
      <label className="tv-color" title="Drawing color">
        <input
          type="color"
          value={color}
          onChange={(e) => onColor(e.target.value)}
        />
      </label>
    </aside>
  );
}
