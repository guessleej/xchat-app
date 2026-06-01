import { useEffect, useRef, useState } from "react";

export interface DropdownOption { id: string; label: string }

/**
 * WKWebView 安全的下拉選單。
 * Tauri 的 WebView 對原生 <select> 彈出層處理不穩（會卡死），
 * 改用純 DOM 的按鈕 + 絕對定位選項清單取代。
 */
export function Dropdown({
  value, options, onChange, title, className, style, menuMaxHeight = 260,
}: {
  value: string;
  options: DropdownOption[];
  onChange: (id: string) => void;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
  menuMaxHeight?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, [open]);

  const cur = options.find((o) => o.id === value);

  return (
    <div ref={ref} className={className} style={{ position: "relative", display: "inline-block", ...style }} title={title}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 6, width: "100%",
          background: "var(--bg3,#2a2a2a)", color: "var(--text,#eee)",
          border: "1px solid var(--border,#444)", borderRadius: "var(--radius,6px)",
          padding: "5px 9px", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{cur?.label ?? value}</span>
        <span style={{ marginLeft: "auto", fontSize: 9, opacity: 0.7 }}>▾</span>
      </button>
      {open && (
        <div
          style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, minWidth: "100%",
            background: "var(--bg2,#1c1c22)", border: "1px solid var(--border,#444)",
            borderRadius: "var(--radius,6px)", boxShadow: "0 8px 28px rgba(0,0,0,.4)",
            zIndex: 1000, maxHeight: menuMaxHeight, overflowY: "auto", padding: 4,
          }}
        >
          {options.map((o) => (
            <div
              key={o.id}
              onClick={() => { onChange(o.id); setOpen(false); }}
              style={{
                padding: "7px 10px", fontSize: 13, borderRadius: 4, cursor: "pointer",
                whiteSpace: "nowrap", color: o.id === value ? "var(--accent,#e0121f)" : "var(--text,#eee)",
                fontWeight: o.id === value ? 600 : 400,
                background: o.id === value ? "var(--accent-bg,rgba(224,18,31,.08))" : "transparent",
              }}
              onMouseEnter={(e) => { if (o.id !== value) (e.currentTarget as HTMLDivElement).style.background = "var(--bg3,#2a2a2a)"; }}
              onMouseLeave={(e) => { if (o.id !== value) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
