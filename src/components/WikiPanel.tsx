import { useEffect, useState, useCallback } from "react";
import { Dropdown } from "./Dropdown";
import {
  wiki,
  type WikiPageSummary,
  type WikiPageFull,
  type WikiLintReport,
  type NotebookSummary,
  API_BASE,
} from "../api";

interface Props { onClose: () => void }

/**
 * LLM Wiki 條目瀏覽面板（multi-notebook）
 * 頂部 notebook 切換器 + 新建/重命名/刪除 notebook
 * 左：篩選列表；右：詳情；下方體檢報告；header 按鈕：匯出、體檢
 */
export default function WikiPanel({ onClose }: Props) {
  const [notebooks, setNotebooks] = useState<NotebookSummary[]>([]);
  const [currentNB, setCurrentNB] = useState<string>("default");
  const [pages, setPages] = useState<WikiPageSummary[]>([]);
  const [filter, setFilter] = useState("");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [detail, setDetail] = useState<WikiPageFull | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string>("");
  const [lintReport, setLintReport] = useState<WikiLintReport | null>(null);
  const [linting, setLinting] = useState(false);
  // WKWebView 不支援原生 prompt/confirm，改用自製 modal（web 也通用）
  const [modal, setModal] = useState<null | { title: string; isPrompt: boolean; value: string; resolve: (v: string | null) => void }>(null);
  const askPrompt = (title: string, def = "") => new Promise<string | null>((resolve) => setModal({ title, isPrompt: true, value: def, resolve }));
  const askConfirm = (title: string) => new Promise<boolean>((resolve) => setModal({ title, isPrompt: false, value: "", resolve: (v) => resolve(v !== null) }));


  // ─── 載入 notebooks 列表
  const reloadNotebooks = useCallback(async () => {
    try {
      const res = await wiki.notebooks.list();
      setNotebooks(res.data.notebooks);
      // 若當前選中的 notebook 已被刪 → 退回 default
      if (!res.data.notebooks.find((n) => n.name === currentNB)) {
        setCurrentNB("default");
      }
    } catch (e) { setError("讀取 notebook 列表失敗：" + String(e)); }
  }, [currentNB]);

  useEffect(() => { reloadNotebooks(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 載入當前 notebook 的頁面列表
  useEffect(() => {
    setLoadingList(true); setSelectedSlug(null); setDetail(null); setLintReport(null);
    wiki.list(currentNB)
      .then((res) => setPages(res.data.pages))
      .catch((e) => setError(String(e)))
      .finally(() => setLoadingList(false));
  }, [currentNB]);

  // ─── 載入單頁詳情
  useEffect(() => {
    if (!selectedSlug) { setDetail(null); return; }
    setLoadingDetail(true);
    wiki.get(selectedSlug, currentNB)
      .then((res) => setDetail(res.data))
      .catch((e) => setError(String(e)))
      .finally(() => setLoadingDetail(false));
  }, [selectedSlug, currentNB]);

  const filtered = pages.filter((p) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return p.title.toLowerCase().includes(q) || p.summary.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q);
  });

  const onDeletePage = async (slug: string) => {
    if (!(await askConfirm(`確定刪除條目「${slug}」?(連同向量索引)`))) return;
    try {
      await wiki.remove(slug, currentNB);
      setPages((ps) => ps.filter((p) => p.slug !== slug));
      if (selectedSlug === slug) setSelectedSlug(null);
      await reloadNotebooks();
    } catch (e) { setError("刪除失敗：" + String(e)); }
  };

  const runLint = async () => {
    setLinting(true); setError("");
    try { const res = await wiki.lint(currentNB); setLintReport(res.data.report); }
    catch (e) { setError("體檢失敗：" + String(e)); }
    finally { setLinting(false); }
  };

  const onCreateNotebook = async () => {
    const name = await askPrompt("新 notebook 名稱：");
    if (!name) return;
    try {
      await wiki.notebooks.create(name.trim());
      await reloadNotebooks();
      setCurrentNB(name.trim());
    } catch (e) { setError("建立失敗：" + String(e)); }
  };
  const onRenameNotebook = async () => {
    if (currentNB === "default") { setError("default notebook 不可重命名"); return; }
    const newName = await askPrompt(`把「${currentNB}」重新命名為：`, currentNB);
    if (!newName || newName === currentNB) return;
    try {
      await wiki.notebooks.rename(currentNB, newName.trim());
      await reloadNotebooks();
      setCurrentNB(newName.trim());
    } catch (e) { setError("重命名失敗：" + String(e)); }
  };
  const onDeleteNotebook = async () => {
    if (currentNB === "default") { setError("default notebook 不可刪除"); return; }
    if (!(await askConfirm(`刪除 notebook「${currentNB}」及其所有條目?(不可逆)`))) return;
    try {
      await wiki.notebooks.remove(currentNB);
      setCurrentNB("default");
      await reloadNotebooks();
    } catch (e) { setError("刪除失敗：" + String(e)); }
  };

  const onExport = async () => {
    try {
      const token = localStorage.getItem("token") || "";
      const url = `${API_BASE}/files/wiki/export${currentNB !== "default" ? `?notebook=${encodeURIComponent(currentNB)}` : ""}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const dl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = dl;
      a.download = `xchat-wiki-${currentNB}-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(dl);
    } catch (e) { setError("匯出失敗：" + String(e)); }
  };

  const currentNBMeta = notebooks.find((n) => n.name === currentNB);

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "var(--bg2, #1a1a1a)", color: "var(--text, #eee)",
          borderRadius: 12, width: "min(1100px, 92vw)", height: "82vh",
          display: "flex", flexDirection: "column", overflow: "hidden",
          border: "1px solid var(--border, #333)", boxShadow: "0 12px 48px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", borderBottom: "1px solid var(--border, #333)", gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 16, fontWeight: 600, flexShrink: 0 }}>知識庫</span>
            {/* notebook 切換（WKWebView 安全的自製下拉）*/}
            <Dropdown
              value={currentNB}
              onChange={(v) => setCurrentNB(v)}
              title="切換 notebook"
              style={{ maxWidth: 280 }}
              options={notebooks.map((nb) => ({ id: nb.name, label: `${nb.name}（${nb.page_count}）` }))}
            />
            <button onClick={onCreateNotebook} title="新建 notebook"
              style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6,
                background: "transparent", color: "var(--accent, #4f8cff)",
                border: "1px solid var(--accent, #4f8cff)", cursor: "pointer" }}
            >+ 新建</button>
            <button onClick={onRenameNotebook} disabled={currentNB === "default"} title="重命名"
              style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6,
                background: "transparent", color: "var(--text2, #ccc)",
                border: "1px solid var(--border, #555)",
                cursor: currentNB === "default" ? "not-allowed" : "pointer",
                opacity: currentNB === "default" ? 0.4 : 1 }}
            >重命名</button>
            <button onClick={onDeleteNotebook} disabled={currentNB === "default"} title="刪除 notebook"
              style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6,
                background: "transparent", color: "var(--red, #e8192c)",
                border: "1px solid var(--red, #e8192c)",
                cursor: currentNB === "default" ? "not-allowed" : "pointer",
                opacity: currentNB === "default" ? 0.4 : 1 }}
            >刪除 notebook</button>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            <button onClick={onExport} disabled={pages.length === 0}
              style={{ fontSize: 12, padding: "6px 12px", borderRadius: 6,
                background: "transparent", color: "var(--text2, #ccc)",
                border: "1px solid var(--border, #555)", cursor: "pointer" }}
              title="匯出此 notebook 為 Markdown zip"
            >匯出 Markdown</button>
            <button onClick={runLint} disabled={linting || pages.length === 0}
              style={{ fontSize: 12, padding: "6px 12px", borderRadius: 6,
                background: "transparent", color: "var(--accent, #4f8cff)",
                border: "1px solid var(--accent, #4f8cff)",
                cursor: linting ? "wait" : "pointer", opacity: linting ? 0.6 : 1 }}
              title="LLM 體檢此 notebook"
            >{linting ? "體檢中…" : "LLM 體檢"}</button>
            <button onClick={onClose} title="關閉"
              style={{ background: "transparent", border: "none", color: "var(--text2, #ccc)",
                fontSize: 22, cursor: "pointer", padding: "0 6px" }}
            >×</button>
          </div>
        </div>

        {currentNBMeta?.description && (
          <div style={{ padding: "6px 18px", fontSize: 12, color: "var(--text3, #888)",
            borderBottom: "1px solid var(--border, #333)" }}>
            {currentNBMeta.description}
          </div>
        )}
        {error && (
          <div style={{ background: "#5a1a1a", color: "#fdd", padding: "8px 14px", fontSize: 13 }}>
            {error}
          </div>
        )}

        {lintReport && (
          <div style={{
            background: "var(--bg3, #2a2a2a)", borderBottom: "1px solid var(--border, #333)",
            padding: "12px 18px", fontSize: 13, maxHeight: "30vh", overflowY: "auto",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <strong style={{ fontSize: 13 }}>體檢報告（{currentNB}）</strong>
              <button onClick={() => setLintReport(null)}
                style={{ background: "transparent", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 12 }}
              >關閉報告</button>
            </div>
            <div style={{ marginBottom: 10, color: "var(--text2, #ddd)" }}>{lintReport.summary || "(無摘要)"}</div>
            {lintReport.contradictions.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ color: "var(--red, #ff6b6b)", fontWeight: 600, marginBottom: 4 }}>矛盾（{lintReport.contradictions.length}）</div>
                {lintReport.contradictions.map((c, i) => (
                  <div key={i} style={{ marginLeft: 12, marginBottom: 4 }}>
                    <code style={{ fontSize: 11 }}>{c.slugs.join(" ↔ ")}</code>：{c.issue}
                  </div>
                ))}
              </div>
            )}
            {lintReport.orphans.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ color: "#e0a000", fontWeight: 600, marginBottom: 4 }}>孤兒條目（{lintReport.orphans.length}）</div>
                <div style={{ marginLeft: 12 }}>
                  {lintReport.orphans.map((s) => (
                    <code key={s} onClick={() => setSelectedSlug(s)}
                      style={{ marginRight: 8, fontSize: 11, cursor: "pointer", textDecoration: "underline" }}
                    >{s}</code>
                  ))}
                </div>
              </div>
            )}
            {lintReport.missing_links.length > 0 && (
              <div style={{ marginBottom: 4 }}>
                <div style={{ color: "var(--accent, #4f8cff)", fontWeight: 600, marginBottom: 4 }}>建議補上的連結（{lintReport.missing_links.length}）</div>
                {lintReport.missing_links.map((m, i) => (
                  <div key={i} style={{ marginLeft: 12, marginBottom: 4 }}>
                    <code style={{ fontSize: 11 }}>{m.from} → {m.should_relate_to}</code>：{m.reason}
                  </div>
                ))}
              </div>
            )}
            {lintReport.contradictions.length + lintReport.orphans.length + lintReport.missing_links.length === 0 && (
              <div style={{ color: "var(--text3)" }}>沒發現問題</div>
            )}
          </div>
        )}

        {/* Body：列表(左) + 詳情(右) */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <div style={{ width: "38%", minWidth: 280, borderRight: "1px solid var(--border, #333)", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: 10 }}>
              <input
                placeholder="篩選條目（標題/摘要/slug）"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                style={{
                  width: "100%", padding: "8px 10px", borderRadius: 8,
                  background: "var(--bg3, #2a2a2a)", color: "var(--text)",
                  border: "1px solid var(--border, #333)", fontSize: 13,
                }}
              />
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0 6px 10px" }}>
              {loadingList && <div style={{ padding: 16, color: "var(--text3)" }}>載入中…</div>}
              {!loadingList && filtered.length === 0 && (
                <div style={{ padding: 16, color: "var(--text3)", fontSize: 13 }}>
                  {pages.length === 0
                    ? `notebook「${currentNB}」尚無條目。叫 xChat「整理進 wiki」或上傳檔案自動建。`
                    : "無符合的條目"}
                </div>
              )}
              {filtered.map((p) => (
                <button key={p.slug} onClick={() => setSelectedSlug(p.slug)}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    background: selectedSlug === p.slug ? "var(--bg3, #2a2a2a)" : "transparent",
                    border: "none", color: "var(--text)", padding: "10px 12px",
                    borderRadius: 8, cursor: "pointer", marginBottom: 2,
                  }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{p.title}</div>
                  <div style={{ fontSize: 12, color: "var(--text3, #888)", lineHeight: 1.5,
                    overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                    {p.summary || "(無摘要)"}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text3, #666)", marginTop: 4 }}>
                    {p.key_facts_count} 事實 · {p.sources_count} 來源 · {p.slug}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            {!selectedSlug && (
              <div style={{ color: "var(--text3)", padding: 40, textAlign: "center" }}>
                ← 從左側選一個條目來看詳情
              </div>
            )}
            {selectedSlug && loadingDetail && <div style={{ color: "var(--text3)" }}>載入詳情中…</div>}
            {selectedSlug && detail && (
              <>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 6 }}>
                  <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{detail.title}</h2>
                  <code style={{ fontSize: 12, color: "var(--text3, #888)" }}>{detail.slug}</code>
                </div>
                {detail.updated_at && (
                  <div style={{ fontSize: 11, color: "var(--text3, #777)", marginBottom: 14 }}>
                    更新於 {new Date(detail.updated_at).toLocaleString()}
                  </div>
                )}
                <section style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 12, color: "var(--text3, #888)", marginBottom: 6 }}>摘要</div>
                  <div style={{ fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{detail.summary || "(無)"}</div>
                </section>
                {detail.key_facts.length > 0 && (
                  <section style={{ marginBottom: 18 }}>
                    <div style={{ fontSize: 12, color: "var(--text3, #888)", marginBottom: 6 }}>重點事實（{detail.key_facts.length}）</div>
                    <ul style={{ margin: 0, paddingLeft: 22 }}>
                      {detail.key_facts.map((f, i) => (
                        <li key={i} style={{ fontSize: 14, lineHeight: 1.7, marginBottom: 2 }}>{f}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {detail.sources.length > 0 && (
                  <section style={{ marginBottom: 18 }}>
                    <div style={{ fontSize: 12, color: "var(--text3, #888)", marginBottom: 6 }}>來源檔案</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {detail.sources.map((s, i) => (
                        <span key={i} title={s.file_id}
                          style={{ fontSize: 12, padding: "4px 10px", borderRadius: 12,
                            background: "var(--bg3, #2a2a2a)", border: "1px solid var(--border, #333)" }}>
                          {s.file_name}
                        </span>
                      ))}
                    </div>
                  </section>
                )}
                {detail.related.length > 0 && (
                  <section style={{ marginBottom: 18 }}>
                    <div style={{ fontSize: 12, color: "var(--text3, #888)", marginBottom: 6 }}>相關條目</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {detail.related.map((r) => (
                        <button key={r} onClick={() => setSelectedSlug(r)}
                          style={{ fontSize: 12, padding: "4px 10px", borderRadius: 12,
                            background: "transparent", color: "var(--accent, #4f8cff)",
                            border: "1px solid var(--accent, #4f8cff)", cursor: "pointer" }}
                        >→ {r}</button>
                      ))}
                    </div>
                  </section>
                )}
                <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--border, #333)" }}>
                  <button onClick={() => onDeletePage(detail.slug)}
                    style={{ fontSize: 12, padding: "6px 12px", borderRadius: 6,
                      background: "transparent", color: "var(--red, #e8192c)",
                      border: "1px solid var(--red, #e8192c)", cursor: "pointer" }}
                  >刪除此條目</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      {modal && (
        <div onClick={() => { modal.resolve(null); setModal(null); }} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg2,#1c1c22)", border: "1px solid var(--border,#333)", borderRadius: 8, padding: 20, minWidth: 320, maxWidth: 440, boxShadow: "0 8px 28px rgba(0,0,0,.4)" }}>
            <div style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 12, color: "var(--text,#eee)", whiteSpace: "pre-wrap" }}>{modal.title}</div>
            {modal.isPrompt && (
              <input autoFocus value={modal.value} onChange={(e) => setModal({ ...modal, value: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { modal.resolve(modal.value); setModal(null); } else if (e.key === "Escape") { modal.resolve(null); setModal(null); } }} style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border,#333)", background: "var(--bg,#111)", color: "var(--text,#eee)", fontSize: 14, marginBottom: 14, outline: "none", boxSizing: "border-box" }} />
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => { modal.resolve(null); setModal(null); }} style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid var(--border,#333)", background: "transparent", color: "var(--text2,#aaa)", cursor: "pointer", fontSize: 13 }}>取消</button>
              <button onClick={() => { modal.resolve(modal.isPrompt ? modal.value : ""); setModal(null); }} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: "var(--accent,#e0121f)", color: "#fff", cursor: "pointer", fontSize: 13 }}>確定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
