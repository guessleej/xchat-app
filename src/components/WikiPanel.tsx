import { useEffect, useState } from "react";
import { wiki, type WikiPageSummary, type WikiPageFull, type WikiLintReport, API_BASE } from "../api";

interface Props { onClose: () => void }

/**
 * LLM Wiki 條目瀏覽面板（MVP：view-only）
 * 左側列表 / 右側詳情；可在來源檔名 chip、相關條目 slug chip 之間切換。
 */
export default function WikiPanel({ onClose }: Props) {
  const [pages, setPages] = useState<WikiPageSummary[]>([]);
  const [filter, setFilter] = useState("");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [detail, setDetail] = useState<WikiPageFull | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string>("");
  const [lintReport, setLintReport] = useState<WikiLintReport | null>(null);
  const [linting, setLinting] = useState(false);

  const runLint = async () => {
    setLinting(true); setError("");
    try {
      const res = await wiki.lint();
      setLintReport(res.data.report);
    } catch (e) {
      setError("體檢失敗：" + String(e));
    } finally {
      setLinting(false);
    }
  };

  // 載入列表
  useEffect(() => {
    setLoadingList(true);
    wiki.list()
      .then((res) => setPages(res.data.pages))
      .catch((e) => setError(String(e)))
      .finally(() => setLoadingList(false));
  }, []);

  // 載入單頁詳情
  useEffect(() => {
    if (!selectedSlug) { setDetail(null); return; }
    setLoadingDetail(true);
    wiki.get(selectedSlug)
      .then((res) => setDetail(res.data))
      .catch((e) => setError(String(e)))
      .finally(() => setLoadingDetail(false));
  }, [selectedSlug]);

  const filtered = pages.filter((p) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return p.title.toLowerCase().includes(q) || p.summary.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q);
  });

  const onDelete = async (slug: string) => {
    if (!confirm(`確定刪除條目「${slug}」?(連同向量索引)`)) return;
    try {
      await wiki.remove(slug);
      setPages((ps) => ps.filter((p) => p.slug !== slug));
      if (selectedSlug === slug) setSelectedSlug(null);
    } catch (e) {
      alert("刪除失敗：" + String(e));
    }
  };

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
          padding: "14px 18px", borderBottom: "1px solid var(--border, #333)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>📚 知識庫（LLM Wiki）</span>
            <span style={{ fontSize: 12, color: "var(--text3, #888)" }}>共 {pages.length} 條目</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={async () => {
                try {
                  const token = localStorage.getItem("token") || "";
                  const res = await fetch(`${API_BASE}/files/wiki/export`, { headers: { Authorization: `Bearer ${token}` } });
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `xchat-wiki-${new Date().toISOString().slice(0,10)}.zip`;
                  document.body.appendChild(a); a.click(); a.remove();
                  URL.revokeObjectURL(url);
                } catch (e) { setError("匯出失敗：" + String(e)); }
              }}
              disabled={pages.length === 0}
              style={{
                fontSize: 12, padding: "6px 12px", borderRadius: 6,
                background: "transparent", color: "var(--text2, #ccc)",
                border: "1px solid var(--border, #555)", cursor: "pointer",
              }}
              title="匯出整個知識庫為 Markdown zip（Obsidian 友善）"
            >⬇️ 匯出 Markdown</button>
            <button
              onClick={runLint}
              disabled={linting || pages.length === 0}
              style={{
                fontSize: 12, padding: "6px 12px", borderRadius: 6,
                background: "transparent", color: "var(--accent, #4f8cff)",
                border: "1px solid var(--accent, #4f8cff)",
                cursor: linting ? "wait" : "pointer", opacity: linting ? 0.6 : 1,
              }}
              title="LLM 體檢：找矛盾、孤兒、缺失連結"
            >{linting ? "體檢中…" : "🩺 LLM 體檢"}</button>
            <button
              onClick={onClose}
              style={{ background: "transparent", border: "none", color: "var(--text2, #ccc)", fontSize: 22, cursor: "pointer", padding: "0 6px" }}
              title="關閉"
            >×</button>
          </div>
        </div>

        {lintReport && (
          <div style={{
            background: "var(--bg3, #2a2a2a)", borderBottom: "1px solid var(--border, #333)",
            padding: "12px 18px", fontSize: 13, maxHeight: "30vh", overflowY: "auto",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <strong style={{ fontSize: 13 }}>🩺 體檢報告</strong>
              <button onClick={() => setLintReport(null)}
                style={{ background: "transparent", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 12 }}
              >關閉報告</button>
            </div>
            <div style={{ marginBottom: 10, color: "var(--text2, #ddd)" }}>{lintReport.summary || "(無摘要)"}</div>
            {lintReport.contradictions.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ color: "var(--red, #ff6b6b)", fontWeight: 600, marginBottom: 4 }}>⚠️ 矛盾（{lintReport.contradictions.length}）</div>
                {lintReport.contradictions.map((c, i) => (
                  <div key={i} style={{ marginLeft: 12, marginBottom: 4 }}>
                    <code style={{ fontSize: 11 }}>{c.slugs.join(" ↔ ")}</code>：{c.issue}
                  </div>
                ))}
              </div>
            )}
            {lintReport.orphans.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ color: "#e0a000", fontWeight: 600, marginBottom: 4 }}>🪨 孤兒條目（{lintReport.orphans.length}）</div>
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
                <div style={{ color: "var(--accent, #4f8cff)", fontWeight: 600, marginBottom: 4 }}>🔗 建議補上的連結（{lintReport.missing_links.length}）</div>
                {lintReport.missing_links.map((m, i) => (
                  <div key={i} style={{ marginLeft: 12, marginBottom: 4 }}>
                    <code style={{ fontSize: 11 }}>{m.from} → {m.should_relate_to}</code>：{m.reason}
                  </div>
                ))}
              </div>
            )}
            {lintReport.contradictions.length + lintReport.orphans.length + lintReport.missing_links.length === 0 && (
              <div style={{ color: "var(--text3)" }}>✅ 沒發現問題</div>
            )}
          </div>
        )}

        {error && (
          <div style={{ background: "#5a1a1a", color: "#fdd", padding: "8px 14px", fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Body：列表(左) + 詳情(右) */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* 左：列表 */}
          <div style={{
            width: "38%", minWidth: 280, borderRight: "1px solid var(--border, #333)",
            display: "flex", flexDirection: "column",
          }}>
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
                  {pages.length === 0 ? "知識庫尚無條目。叫 xChat「ingest 這份檔案」就會自動建。" : "無符合的條目"}
                </div>
              )}
              {filtered.map((p) => (
                <button
                  key={p.slug}
                  onClick={() => setSelectedSlug(p.slug)}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    background: selectedSlug === p.slug ? "var(--bg3, #2a2a2a)" : "transparent",
                    border: "none", color: "var(--text)", padding: "10px 12px",
                    borderRadius: 8, cursor: "pointer", marginBottom: 2,
                  }}
                >
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

          {/* 右：詳情 */}
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
                  <div style={{ fontSize: 14, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                    {detail.summary || "(無)"}
                  </div>
                </section>

                {detail.key_facts.length > 0 && (
                  <section style={{ marginBottom: 18 }}>
                    <div style={{ fontSize: 12, color: "var(--text3, #888)", marginBottom: 6 }}>
                      重點事實（{detail.key_facts.length}）
                    </div>
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
                          style={{
                            fontSize: 12, padding: "4px 10px", borderRadius: 12,
                            background: "var(--bg3, #2a2a2a)", border: "1px solid var(--border, #333)",
                          }}>
                          📄 {s.file_name}
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
                        <button key={r}
                          onClick={() => setSelectedSlug(r)}
                          style={{
                            fontSize: 12, padding: "4px 10px", borderRadius: 12,
                            background: "transparent", color: "var(--accent, #4f8cff)",
                            border: "1px solid var(--accent, #4f8cff)", cursor: "pointer",
                          }}>
                          → {r}
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--border, #333)" }}>
                  <button
                    onClick={() => onDelete(detail.slug)}
                    style={{
                      fontSize: 12, padding: "6px 12px", borderRadius: 6,
                      background: "transparent", color: "var(--red, #e8192c)",
                      border: "1px solid var(--red, #e8192c)", cursor: "pointer",
                    }}>
                    刪除此條目
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
