import { useEffect, useState, useCallback } from "react";
import { files, type KBFile, type FileChunk } from "../api";
import { uiConfirm, uiAlert } from "./Dialog";

interface Props { onClose: () => void }

function fmtSize(n?: number): string {
  if (!n && n !== 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 知識庫「已上傳檔案」管理面板
 * 列出此知識庫已上傳的檔案，支援單選 / 多選 / 全選刪除。
 * 刪除會連動清除該檔的向量與原檔（wiki 條目另於條目列表管理）。
 */
export default function KBFilesPanel({ onClose }: Props) {
  const [items, setItems] = useState<KBFile[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // 切片檢視
  const [chunkView, setChunkView] = useState<null | { file: KBFile; chunks: FileChunk[]; loading: boolean }>(null);

  const reload = useCallback(async () => {
    setLoading(true); setError(""); setSel(new Set());
    try {
      const res = await files.list();
      setItems(res.data.items || []);
    } catch (e) { setError("讀取檔案清單失敗：" + String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const toggle = (id: string) => setSel((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const allChecked = items.length > 0 && sel.size === items.length;
  const toggleAll = () => setSel(allChecked ? new Set() : new Set(items.map((f) => f.file_id)));

  const doDelete = async (ids: string[]) => {
    if (ids.length === 0) return;
    const names = ids.length === 1
      ? `「${items.find((f) => f.file_id === ids[0])?.file_name || ids[0]}」`
      : `選取的 ${ids.length} 個檔案`;
    if (!(await uiConfirm(`確定刪除${names}？\n（會一併清除其檢索索引，無法復原）`))) return;
    setBusy(true); setError("");
    try {
      const res = await files.batchDelete(ids);
      await reload();
      await uiAlert(res.message || `已刪除 ${res.data.count} 個檔案`);
    } catch (e) { setError("刪除失敗：" + String(e)); }
    finally { setBusy(false); }
  };

  const openChunks = async (f: KBFile) => {
    setChunkView({ file: f, chunks: [], loading: true });
    try {
      const res = await files.chunks(f.file_id);
      setChunkView({ file: f, chunks: res.data.chunks || [], loading: false });
    } catch (e) {
      setChunkView(null);
      await uiAlert("讀取切片失敗：" + String(e));
    }
  };

  const btn = (bg: string, color = "#fff"): React.CSSProperties => ({
    fontSize: 12, padding: "6px 12px", borderRadius: 6,
    background: bg, color, border: bg === "transparent" ? "1px solid var(--border, #555)" : "none",
    cursor: "pointer",
  });

  return (
   <>
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 1001, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "var(--bg2, #1a1a1a)", color: "var(--text, #eee)",
        borderRadius: 12, width: "min(880px, 92vw)", height: "78vh",
        display: "flex", flexDirection: "column", overflow: "hidden",
        border: "1px solid var(--border, #333)", boxShadow: "0 12px 48px rgba(0,0,0,0.5)",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", borderBottom: "1px solid var(--border, #333)", gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>已上傳檔案</span>
            <span style={{ fontSize: 11, color: "var(--text3, #888)" }}>勾選可單選 / 多選刪除（連同檢索索引）</span>
          </div>
          <button onClick={onClose} title="關閉" style={{
            background: "transparent", border: "none", color: "var(--text2, #ccc)",
            fontSize: 22, cursor: "pointer", padding: "0 6px",
          }}>×</button>
        </div>

        {/* 工具列 */}
        <div style={{ padding: "10px 18px", borderBottom: "1px solid var(--border, #333)", display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={toggleAll} disabled={items.length === 0} style={btn("transparent", "var(--text2, #ccc)")}>
            {allChecked ? "取消全選" : "全選"}
          </button>
          <button onClick={() => doDelete([...sel])} disabled={sel.size === 0 || busy} style={btn("var(--red, #e8192c)")}>
            {busy ? "刪除中…" : `刪除選取（${sel.size}）`}
          </button>
          <button onClick={reload} disabled={loading || busy} style={btn("transparent", "var(--accent, #4f8cff)")}>重新整理</button>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: "var(--text3, #888)" }}>共 {items.length} 個檔</span>
        </div>

        {error && (
          <div style={{ background: "#5a1a1a", color: "#fdd", padding: "8px 14px", fontSize: 13 }}>{error}</div>
        )}

        {/* 清單 */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 18px" }}>
          {loading ? (
            <div style={{ color: "var(--text3, #888)", padding: 20 }}>載入中…</div>
          ) : items.length === 0 ? (
            <div style={{ color: "var(--text3, #888)", padding: 20 }}>此知識庫尚無上傳的檔案。</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--text3, #888)", borderBottom: "1px solid var(--border, #333)" }}>
                  <th style={{ padding: "8px 6px", width: 32 }}>
                    <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                  </th>
                  <th style={{ padding: "8px 6px" }}>檔名</th>
                  <th style={{ padding: "8px 6px", width: 80 }}>大小</th>
                  <th style={{ padding: "8px 6px", width: 60 }}>頁數</th>
                  <th style={{ padding: "8px 6px", width: 150 }}>上傳時間</th>
                  <th style={{ padding: "8px 6px", width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((f) => (
                  <tr key={f.file_id} style={{ borderBottom: "1px solid var(--border, #2a2a2a)", background: sel.has(f.file_id) ? "var(--bg3, #2a2a2a)" : "transparent" }}>
                    <td style={{ padding: "8px 6px" }}>
                      <input type="checkbox" checked={sel.has(f.file_id)} onChange={() => toggle(f.file_id)} />
                    </td>
                    <td style={{ padding: "8px 6px", fontWeight: 500, wordBreak: "break-all" }}>{f.file_name}</td>
                    <td style={{ padding: "8px 6px", color: "var(--text2, #ccc)" }}>{fmtSize(f.size_bytes)}</td>
                    <td style={{ padding: "8px 6px", color: "var(--text2, #ccc)" }}>{f.page_count ?? "—"}</td>
                    <td style={{ padding: "8px 6px", color: "var(--text3, #888)", fontSize: 12 }}>
                      {f.uploaded_at ? new Date(f.uploaded_at).toLocaleString() : "—"}
                    </td>
                    <td style={{ padding: "8px 6px", textAlign: "right", whiteSpace: "nowrap" }}>
                      <button onClick={() => openChunks(f)} disabled={busy}
                        style={{ ...btn("transparent", "var(--accent, #4f8cff)"), padding: "4px 8px" }}>切片</button>
                      <button onClick={() => doDelete([f.file_id])} disabled={busy}
                        style={{ ...btn("transparent", "var(--red, #e8192c)"), padding: "4px 8px", marginLeft: 6 }}>刪除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>

    {/* 切片檢視 */}
    {chunkView && (
      <div onClick={() => setChunkView(null)} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
        zIndex: 1002, display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div onClick={(e) => e.stopPropagation()} style={{
          background: "var(--bg2, #1a1a1a)", color: "var(--text, #eee)",
          borderRadius: 12, width: "min(820px, 90vw)", height: "80vh",
          display: "flex", flexDirection: "column", overflow: "hidden",
          border: "1px solid var(--border, #333)", boxShadow: "0 12px 48px rgba(0,0,0,0.5)",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--border, #333)", gap: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, wordBreak: "break-all" }}>切片內容：{chunkView.file.file_name}</div>
              <div style={{ fontSize: 11, color: "var(--text3, #888)" }}>
                {chunkView.loading ? "載入中…" : `共 ${chunkView.chunks.length} 段（這就是 AI 實際檢索的內容；圖片＝視覺描述）`}
              </div>
            </div>
            <button onClick={() => setChunkView(null)} style={{ background: "transparent", border: "none", color: "var(--text2, #ccc)", fontSize: 22, cursor: "pointer", padding: "0 6px" }}>×</button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
            {chunkView.loading ? (
              <div style={{ color: "var(--text3, #888)", padding: 16 }}>載入中…</div>
            ) : chunkView.chunks.length === 0 ? (
              <div style={{ color: "var(--text3, #888)", padding: 16, lineHeight: 1.8 }}>
                這個檔案沒有任何切片。<br />（可能是圖片視覺描述失敗、或抽取不到文字。重新上傳可再試一次。）
              </div>
            ) : (
              chunkView.chunks.map((c) => (
                <div key={c.chunk_idx} style={{ marginBottom: 12, border: "1px solid var(--border, #2a2a2a)", borderRadius: 8, overflow: "hidden" }}>
                  <div style={{ fontSize: 11, color: "var(--text3, #888)", padding: "4px 10px", background: "var(--bg3, #2a2a2a)" }}>
                    片段 #{c.chunk_idx}（{c.content.length} 字）
                  </div>
                  <div style={{ padding: "8px 10px", fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {c.content}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    )}
   </>
  );
}
