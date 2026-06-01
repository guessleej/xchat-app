import { useEffect, useState } from "react";
import { models, type ModelInfo } from "../api";

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * AI 引擎（唯讀）— 模型由云碩伺服器集中管理。
 * 前端不再自管端點/金鑰；只顯示伺服器回傳的品牌化引擎清單。
 */
export function ProviderSettings({ open, onClose }: Props) {
  const [list, setList] = useState<ModelInfo[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true); setErr("");
    models().then(setList).catch((e) => setErr(String(e))).finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  return (
    <div className="provider-settings-overlay" onClick={onClose}>
      <div className="provider-settings-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="provider-settings-header">
          <div className="provider-settings-title">AI 引擎</div>
          <button className="provider-settings-close" onClick={onClose}>✕</button>
        </div>

        <div className="provider-settings-hint">
          模型由云碩伺服器集中管理，運行於自有地端 AI 基礎設施；資料不外傳，無需設定端點或金鑰。
        </div>

        <div className="provider-settings-list">
          {loading && <div style={{ padding: 14, color: "var(--text2,#999)", fontSize: 13 }}>讀取中…</div>}
          {err && <div style={{ padding: 14, color: "var(--red,#e8192c)", fontSize: 13 }}>讀取失敗：{err}</div>}
          {!loading && !err && list.map((m) => (
            <div key={m.id} className="provider-card provider-card--active" style={{ padding: 14 }}>
              <div className="provider-card-name">
                {m.label}{m.default ? "　·　預設" : ""}
              </div>
              {m.description && <div className="provider-card-desc">{m.description}</div>}
              <div className="provider-card-sub">地端引擎 · 由伺服器管理</div>
            </div>
          ))}
          {!loading && !err && list.length === 0 && (
            <div style={{ padding: 14, color: "var(--text2,#999)", fontSize: 13 }}>目前無可用引擎</div>
          )}
        </div>
      </div>
    </div>
  );
}
