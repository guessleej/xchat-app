import { useEffect, useState, useCallback } from "react";
import { local, type LocalDoc } from "../api";
import { uiAlert, uiConfirm } from "./Dialog";
import { pickFolder, scanFolder, toFile, sha256Hex, readBytes, openLocalPath, isTauri, defaultDataDir } from "../lib/local-kb";

interface Props { onClose: () => void }

const FOLDER_KEY = "xchat:localkb:folder";

/**
 * 本機優先知識庫面板（僅 app）
 * 使用者選一個本機資料夾 → 掃描支援檔 → 與後端比對雜湊 → 只把有變更/新檔
 * 的內容送後端做 OCR+embedding（原始檔永遠留本機，不上傳保存）。
 * 查詢時 AI 命中會回傳本機路徑，可直接開啟原檔。
 */
export default function LocalKBPanel({ onClose }: Props) {
  const [folder, setFolder] = useState<string>(() => localStorage.getItem(FOLDER_KEY) || "");
  const [docs, setDocs] = useState<LocalDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string }>({ done: 0, total: 0, current: "" });
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await local.list();
      setDocs(res.data.items || []);
    } catch (e) { setError("讀取已索引清單失敗：" + String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // 首次無指定資料夾 → 預設為各 OS 文件夾下的 xchatdata（自動建立）
  useEffect(() => {
    if (folder || !isTauri()) return;
    defaultDataDir()
      .then((dir) => { setFolder(dir); localStorage.setItem(FOLDER_KEY, dir); })
      .catch((e) => setError("建立預設資料夾失敗：" + String(e)));
  }, [folder]);

  const onPick = async () => {
    try {
      const dir = await pickFolder();
      if (!dir) return;
      setFolder(dir);
      localStorage.setItem(FOLDER_KEY, dir);
    } catch (e) { setError("選取資料夾失敗：" + String(e)); }
  };

  // 同步：掃描資料夾 → 取後端雜湊 → 只索引新檔/變更檔
  const onSync = async () => {
    if (!folder) { await uiAlert("請先選擇一個本機資料夾。"); return; }
    setSyncing(true); setError(""); setProgress({ done: 0, total: 0, current: "掃描中…" });
    try {
      const [files, hashRes] = await Promise.all([scanFolder(folder), local.hashes()]);
      const known = hashRes.data.hashes || {};
      if (files.length === 0) {
        await uiAlert("此資料夾沒有支援的檔案（PDF/Word/Excel/圖片/文字等）。");
        return;
      }
      // 先算雜湊挑出需要處理的檔
      const pending: { path: string; name: string; mime: string; hash: string }[] = [];
      for (const f of files) {
        try {
          const bytes = await readBytes(f.path);
          const hash = await sha256Hex(bytes);
          if (known[f.path] !== hash) pending.push({ ...f, hash });
        } catch (e) {
          console.warn("讀取/雜湊失敗，略過", f.path, e);
        }
      }
      if (pending.length === 0) {
        await uiAlert(`已是最新（共掃描 ${files.length} 個檔，無變更）。`);
        return;
      }
      setProgress({ done: 0, total: pending.length, current: "" });
      let ok = 0;
      for (let i = 0; i < pending.length; i++) {
        const p = pending[i];
        setProgress({ done: i, total: pending.length, current: p.name });
        try {
          const file = await toFile(p);
          await local.ingest(file, p.path, p.hash);
          ok++;
        } catch (e) {
          console.error("索引失敗", p.path, e);
          setError(`「${p.name}」索引失敗：${String(e)}`);
        }
      }
      setProgress({ done: pending.length, total: pending.length, current: "" });
      await reload();
      await uiAlert(`同步完成：新增/更新 ${ok}/${pending.length} 個檔的索引。`);
    } catch (e) {
      setError("同步失敗：" + String(e));
    } finally {
      setSyncing(false);
    }
  };

  const onOpen = async (path: string) => {
    try { await openLocalPath(path); }
    catch (e) { await uiAlert("無法開啟檔案：" + String(e)); }
  };

  const onRemove = async (d: LocalDoc) => {
    if (!(await uiConfirm(`移除「${d.file_name}」的索引？\n（不會刪除你電腦上的原始檔案）`))) return;
    try {
      await local.remove(d.local_path);
      setDocs((ds) => ds.filter((x) => x.local_path !== d.local_path));
    } catch (e) { setError("移除失敗：" + String(e)); }
  };

  const btn = (bg: string, color = "#fff"): React.CSSProperties => ({
    fontSize: 12, padding: "6px 12px", borderRadius: 6,
    background: bg, color, border: bg === "transparent" ? "1px solid var(--border, #555)" : "none",
    cursor: "pointer",
  });

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      zIndex: 1001, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: "var(--bg2, #1a1a1a)", color: "var(--text, #eee)",
        borderRadius: 12, width: "min(900px, 92vw)", height: "78vh",
        display: "flex", flexDirection: "column", overflow: "hidden",
        border: "1px solid var(--border, #333)", boxShadow: "0 12px 48px rgba(0,0,0,0.5)",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", borderBottom: "1px solid var(--border, #333)", gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>本機資料夾知識庫</span>
            <span style={{ fontSize: 11, color: "var(--text3, #888)" }}>檔案留在你電腦，只索引內容供 AI 查詢</span>
          </div>
          <button onClick={onClose} title="關閉" style={{
            background: "transparent", border: "none", color: "var(--text2, #ccc)",
            fontSize: 22, cursor: "pointer", padding: "0 6px",
          }}>×</button>
        </div>

        {/* 工具列 */}
        <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border, #333)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={onPick} disabled={syncing} style={btn("transparent", "var(--accent, #4f8cff)")}>
            {folder ? "更換資料夾" : "選擇資料夾"}
          </button>
          <button onClick={onSync} disabled={syncing || !folder} style={btn("var(--accent, #e0121f)")}>
            {syncing ? "同步中…" : "同步索引"}
          </button>
          <span style={{ fontSize: 12, color: "var(--text3, #888)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {folder || "尚未選擇資料夾"}
          </span>
        </div>

        {syncing && (
          <div style={{ padding: "8px 18px", fontSize: 12, color: "var(--text2, #ccc)", borderBottom: "1px solid var(--border, #333)" }}>
            {progress.total > 0
              ? `處理中 ${progress.done}/${progress.total}${progress.current ? `：${progress.current}` : ""}`
              : progress.current}
          </div>
        )}
        {error && (
          <div style={{ background: "#5a1a1a", color: "#fdd", padding: "8px 14px", fontSize: 13 }}>{error}</div>
        )}

        {/* 已索引清單 */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 18px" }}>
          {loading ? (
            <div style={{ color: "var(--text3, #888)", padding: 20 }}>載入中…</div>
          ) : docs.length === 0 ? (
            <div style={{ color: "var(--text3, #888)", padding: 20, lineHeight: 1.8 }}>
              尚未索引任何本機檔案。<br />選一個資料夾後按「同步索引」，內容會經由 AI 做 OCR/嵌入並建立可查詢的索引；原始檔案不會離開你的電腦。
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--text3, #888)", borderBottom: "1px solid var(--border, #333)" }}>
                  <th style={{ padding: "8px 6px" }}>檔名</th>
                  <th style={{ padding: "8px 6px", width: 70 }}>片段</th>
                  <th style={{ padding: "8px 6px", width: 150 }}>索引時間</th>
                  <th style={{ padding: "8px 6px", width: 120 }}></th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.local_path} style={{ borderBottom: "1px solid var(--border, #2a2a2a)" }}>
                    <td style={{ padding: "8px 6px" }}>
                      <div style={{ fontWeight: 500 }}>{d.file_name}</div>
                      <div style={{ fontSize: 11, color: "var(--text3, #777)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 380 }}>{d.local_path}</div>
                    </td>
                    <td style={{ padding: "8px 6px", color: "var(--text2, #ccc)" }}>{d.chunks}</td>
                    <td style={{ padding: "8px 6px", color: "var(--text3, #888)", fontSize: 12 }}>
                      {d.indexed_at ? new Date(d.indexed_at).toLocaleString() : "—"}
                    </td>
                    <td style={{ padding: "8px 6px", textAlign: "right", whiteSpace: "nowrap" }}>
                      <button onClick={() => onOpen(d.local_path)} style={{ ...btn("transparent", "var(--accent, #4f8cff)"), padding: "4px 8px" }}>開啟</button>
                      <button onClick={() => onRemove(d)} style={{ ...btn("transparent", "var(--red, #e8192c)"), padding: "4px 8px", marginLeft: 6 }}>移除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {!isTauri() && (
          <div style={{ padding: "8px 18px", fontSize: 12, color: "#e0a000", borderTop: "1px solid var(--border, #333)" }}>
            本機資料夾功能僅在 xChat 桌面 app 中可用。
          </div>
        )}
      </div>
    </div>
  );
}
