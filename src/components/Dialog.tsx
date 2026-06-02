import { useEffect, useState } from "react";

/**
 * WKWebView 安全的 alert/confirm 取代品。
 * Tauri WebView 封鎖原生 window.alert/confirm → 改用 React modal。
 * 用法：await uiConfirm("...") / uiAlert("...")
 * 需在 App 根掛一次 <DialogHost />。
 */
type DialogReq = {
  id: number;
  kind: "alert" | "confirm";
  message: string;
  resolve: (ok: boolean) => void;
};

let _push: ((r: DialogReq) => void) | null = null;
let _seq = 0;

export function uiAlert(message: string): Promise<void> {
  return new Promise((res) => {
    if (!_push) { res(); return; }
    _push({ id: ++_seq, kind: "alert", message, resolve: () => res() });
  });
}

export function uiConfirm(message: string): Promise<boolean> {
  return new Promise((res) => {
    if (!_push) { res(false); return; }
    _push({ id: ++_seq, kind: "confirm", message, resolve: res });
  });
}

export function DialogHost() {
  const [queue, setQueue] = useState<DialogReq[]>([]);
  useEffect(() => {
    _push = (r) => setQueue((q) => [...q, r]);
    return () => { _push = null; };
  }, []);

  const cur = queue[0];
  if (!cur) return null;

  const done = (ok: boolean) => {
    cur.resolve(ok);
    setQueue((q) => q.slice(1));
  };

  return (
    <div
      onClick={() => done(false)}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000 }}
    >
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--bg2,#1c1c22)", border: "1px solid var(--border,#333)", borderRadius: 8, padding: 20, minWidth: 300, maxWidth: 460, boxShadow: "0 8px 28px rgba(0,0,0,.4)" }}>
        <div style={{ fontSize: 14, lineHeight: 1.7, marginBottom: 16, color: "var(--text,#eee)", whiteSpace: "pre-wrap" }}>{cur.message}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          {cur.kind === "confirm" && (
            <button onClick={() => done(false)}
              style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid var(--border,#333)", background: "transparent", color: "var(--text2,#aaa)", cursor: "pointer", fontSize: 13 }}>取消</button>
          )}
          <button autoFocus onClick={() => done(true)}
            style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "var(--accent,#e0121f)", color: "#fff", cursor: "pointer", fontSize: 13 }}>確定</button>
        </div>
      </div>
    </div>
  );
}
