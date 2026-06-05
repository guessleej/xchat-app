import { useEffect, useState, useCallback } from "react";
import { scheduler, type ScheduledTask, type ScheduledRun } from "../api";
import { uiAlert, uiConfirm } from "./Dialog";

interface Props { onClose: () => void }

type SchedMode = "daily" | "hourly" | "weekly" | "everyN" | "cron";
const WD = ["日", "一", "二", "三", "四", "五", "六"];

function buildCron(mode: SchedMode, hhmm: string, weekday: number, everyN: number, raw: string): string {
  const [h, m] = (hhmm || "08:00").split(":").map((x) => parseInt(x, 10) || 0);
  switch (mode) {
    case "daily":  return `${m} ${h} * * *`;
    case "hourly": return `0 * * * *`;
    case "weekly": return `${m} ${h} * * ${weekday}`;
    case "everyN": return `*/${Math.max(1, everyN)} * * * *`;
    case "cron":   return raw.trim();
  }
}

function cronHuman(expr: string): string {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) return expr;
  const [mi, h, , , wd] = p;
  if (mi.startsWith("*/")) return `每 ${mi.slice(2)} 分`;
  if (h === "*") return `每小時 第${mi}分`;
  const t = `${h.padStart(2, "0")}:${mi.padStart(2, "0")}`;
  if (wd !== "*") return `每週${WD[parseInt(wd, 10)] ?? wd} ${t}`;
  return `每天 ${t}`;
}

export default function SchedulePanel({ onClose }: Props) {
  const [items, setItems] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [runsView, setRunsView] = useState<null | { task: ScheduledTask; runs: ScheduledRun[]; loading: boolean }>(null);

  // 表單
  const [name, setName] = useState("");
  const [mode, setMode] = useState<SchedMode>("daily");
  const [hhmm, setHhmm] = useState("08:00");
  const [weekday, setWeekday] = useState(1);
  const [everyN, setEveryN] = useState(30);
  const [rawCron, setRawCron] = useState("0 8 * * *");
  const [action, setAction] = useState<"prompt" | "script" | "office">("prompt");
  const [prompt, setPrompt] = useState("");
  const [useKnowledge, setUseKnowledge] = useState(false);
  const [lang, setLang] = useState<"python" | "bash">("python");
  const [code, setCode] = useState("");
  const [officeType, setOfficeType] = useState<"ppt" | "document" | "table">("document");
  const [notify, setNotify] = useState(true);
  const [postConv, setPostConv] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true); setError("");
    try { const r = await scheduler.list(); setItems(r.data.items || []); }
    catch (e) { setError("讀取任務失敗：" + String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const resetForm = () => {
    setName(""); setMode("daily"); setHhmm("08:00"); setWeekday(1); setEveryN(30);
    setRawCron("0 8 * * *"); setAction("prompt"); setPrompt(""); setUseKnowledge(false);
    setLang("python"); setCode("");
  };

  const submit = async () => {
    if (!name.trim()) { await uiAlert("請輸入任務名稱"); return; }
    const cron_expr = buildCron(mode, hhmm, weekday, everyN, rawCron);
    const payload = action === "prompt"
      ? { prompt, use_knowledge: useKnowledge }
      : action === "office"
      ? { tool_type: officeType, prompt }
      : { language: lang, code };
    if ((action === "prompt" || action === "office") && !prompt.trim()) { await uiAlert("請輸入內容"); return; }
    if (action === "script" && !code.trim()) { await uiAlert("請輸入腳本內容"); return; }
    setBusy(true); setError("");
    try {
      await scheduler.create({ name: name.trim(), cron_expr, action_type: action, payload, enabled: true, notify, post_to_conv: postConv });
      resetForm(); setShowForm(false); await reload();
    } catch (e) { setError("建立失敗：" + String(e)); }
    finally { setBusy(false); }
  };

  const toggle = async (t: ScheduledTask) => {
    try { await scheduler.update(t.task_id, { enabled: !t.enabled }); await reload(); }
    catch (e) { setError("切換失敗：" + String(e)); }
  };
  const runNow = async (t: ScheduledTask) => {
    setBusy(true); setError("");
    try { const r = await scheduler.runNow(t.task_id); await uiAlert(`執行完成（${r.data.status}）：\n\n${(r.data.output || "").slice(0, 1500)}`); await reload(); }
    catch (e) { setError("執行失敗：" + String(e)); }
    finally { setBusy(false); }
  };
  const del = async (t: ScheduledTask) => {
    if (!(await uiConfirm(`刪除任務「${t.name}」？`))) return;
    try { await scheduler.remove(t.task_id); setItems((xs) => xs.filter((x) => x.task_id !== t.task_id)); }
    catch (e) { setError("刪除失敗：" + String(e)); }
  };
  const openRuns = async (t: ScheduledTask) => {
    setRunsView({ task: t, runs: [], loading: true });
    try { const r = await scheduler.runs(t.task_id); setRunsView({ task: t, runs: r.data.items || [], loading: false }); }
    catch { setRunsView({ task: t, runs: [], loading: false }); }
  };

  const seg = (active: boolean): React.CSSProperties => ({
    fontSize: 12, padding: "5px 10px", borderRadius: 6, cursor: "pointer",
    background: active ? "var(--accent, #4f8cff)" : "transparent",
    color: active ? "#fff" : "var(--text2, #ccc)",
    border: `1px solid ${active ? "var(--accent, #4f8cff)" : "var(--border, #555)"}`,
  });
  const inp: React.CSSProperties = { padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border,#444)", background: "var(--bg,#111)", color: "var(--text,#eee)", fontSize: 13, boxSizing: "border-box" };

  return (
   <>
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1001, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg2,#1a1a1a)", color: "var(--text,#eee)", borderRadius: 12, width: "min(960px,94vw)", height: "84vh", display: "flex", flexDirection: "column", overflow: "hidden", border: "1px solid var(--border,#333)", boxShadow: "0 12px 48px rgba(0,0,0,.5)" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--border,#333)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>排程任務（Work）</span>
            <span style={{ fontSize: 11, color: "var(--text3,#888)" }}>7×24 定時自動執行（台灣時間）</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowForm((s) => !s)} style={{ ...seg(showForm), background: "var(--accent,#e0121f)", color: "#fff", border: "none" }}>{showForm ? "收起" : "＋ 新任務"}</button>
            <button onClick={reload} style={seg(false)}>重新整理</button>
            <button onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--text2,#ccc)", fontSize: 22, cursor: "pointer" }}>×</button>
          </div>
        </div>

        {/* 新增表單 */}
        {showForm && (
          <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border,#333)", display: "flex", flexDirection: "column", gap: 10, maxHeight: "46vh", overflowY: "auto" }}>
            <input style={inp} placeholder="任務名稱（例：每早整理知識庫重點）" value={name} onChange={(e) => setName(e.target.value)} />
            <div>
              <div style={{ fontSize: 12, color: "var(--text3,#888)", marginBottom: 4 }}>排程</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {([["daily","每天"],["hourly","每小時"],["weekly","每週"],["everyN","每N分"],["cron","自訂cron"]] as [SchedMode,string][]).map(([k, l]) => (
                  <button key={k} onClick={() => setMode(k)} style={seg(mode === k)}>{l}</button>
                ))}
                {(mode === "daily" || mode === "weekly") && <input style={{ ...inp, width: 90 }} value={hhmm} onChange={(e) => setHhmm(e.target.value)} placeholder="08:00" />}
                {mode === "weekly" && (
                  <div style={{ display: "flex", gap: 4 }}>{WD.map((d, i) => <button key={i} onClick={() => setWeekday(i)} style={seg(weekday === i)}>{d}</button>)}</div>
                )}
                {mode === "everyN" && <input style={{ ...inp, width: 70 }} type="number" value={everyN} onChange={(e) => setEveryN(parseInt(e.target.value) || 1)} />}
                {mode === "cron" && <input style={{ ...inp, width: 180 }} value={rawCron} onChange={(e) => setRawCron(e.target.value)} placeholder="0 8 * * *" />}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "var(--text3,#888)", marginBottom: 4 }}>動作</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setAction("prompt")} style={seg(action === "prompt")}>LLM 提問</button>
                <button onClick={() => setAction("office")} style={seg(action === "office")}>產 Office 檔</button>
                <button onClick={() => setAction("script")} style={seg(action === "script")}>腳本</button>
              </div>
            </div>
            {action === "office" ? (
              <>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => setOfficeType("ppt")} style={seg(officeType === "ppt")}>簡報 PPT</button>
                  <button onClick={() => setOfficeType("document")} style={seg(officeType === "document")}>Word</button>
                  <button onClick={() => setOfficeType("table")} style={seg(officeType === "table")}>Excel</button>
                </div>
                <textarea style={{ ...inp, minHeight: 70, resize: "vertical" }} placeholder="要定時產生什麼（例：每週一產出上週進度週報）" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
              </>
            ) : action === "prompt" ? (
              <>
                <textarea style={{ ...inp, minHeight: 70, resize: "vertical" }} placeholder="要 AI 定時做什麼（例：整理今天知識庫新增的重點，條列三點）" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
                <label style={{ fontSize: 12, color: "var(--text2,#ccc)", display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" checked={useKnowledge} onChange={(e) => setUseKnowledge(e.target.checked)} /> 帶入知識庫檢索結果
                </label>
              </>
            ) : (
              <>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => setLang("python")} style={seg(lang === "python")}>Python</button>
                  <button onClick={() => setLang("bash")} style={seg(lang === "bash")}>Bash</button>
                  <span style={{ fontSize: 11, color: "#e0a000", alignSelf: "center" }}>⚠️ 在伺服器執行，請只放可信腳本</span>
                </div>
                <textarea style={{ ...inp, minHeight: 90, fontFamily: "monospace", resize: "vertical" }} placeholder={lang === "python" ? "print('hello')" : "echo hello"} value={code} onChange={(e) => setCode(e.target.value)} />
              </>
            )}
            <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text2,#ccc)" }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> 完成後推播通知
              </label>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={postConv} onChange={(e) => setPostConv(e.target.checked)} /> 結果發到「排程結果」對話
              </label>
            </div>
            <div><button onClick={submit} disabled={busy} style={{ ...seg(true), background: "var(--accent,#e0121f)", border: "none", padding: "7px 16px" }}>{busy ? "建立中…" : "建立任務"}</button></div>
          </div>
        )}

        {error && <div style={{ background: "#5a1a1a", color: "#fdd", padding: "8px 14px", fontSize: 13 }}>{error}</div>}

        {/* 任務列表 */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 18px" }}>
          {loading ? <div style={{ color: "var(--text3,#888)", padding: 20 }}>載入中…</div>
           : items.length === 0 ? <div style={{ color: "var(--text3,#888)", padding: 20 }}>尚無排程任務。按「＋ 新任務」建立。</div>
           : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ textAlign: "left", color: "var(--text3,#888)", borderBottom: "1px solid var(--border,#333)" }}>
                <th style={{ padding: "8px 6px" }}>名稱</th><th style={{ padding: "8px 6px", width: 130 }}>排程</th>
                <th style={{ padding: "8px 6px", width: 70 }}>動作</th><th style={{ padding: "8px 6px", width: 60 }}>啟用</th>
                <th style={{ padding: "8px 6px", width: 150 }}>下次/上次</th><th style={{ padding: "8px 6px", width: 170 }}></th>
              </tr></thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.task_id} style={{ borderBottom: "1px solid var(--border,#2a2a2a)" }}>
                    <td style={{ padding: "8px 6px", fontWeight: 500 }}>{t.name}</td>
                    <td style={{ padding: "8px 6px", color: "var(--text2,#ccc)" }}>{cronHuman(t.cron_expr)}</td>
                    <td style={{ padding: "8px 6px" }}>{t.action_type === "prompt" ? "LLM" : t.action_type === "office" ? "Office" : "腳本"}</td>
                    <td style={{ padding: "8px 6px" }}><input type="checkbox" checked={t.enabled} onChange={() => toggle(t)} /></td>
                    <td style={{ padding: "8px 6px", fontSize: 11, color: "var(--text3,#888)" }}>
                      {t.next_run ? new Date(t.next_run).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "—"}
                    </td>
                    <td style={{ padding: "8px 6px", textAlign: "right", whiteSpace: "nowrap" }}>
                      <button onClick={() => runNow(t)} disabled={busy} style={{ ...seg(false), padding: "3px 7px" }}>立即跑</button>
                      <button onClick={() => openRuns(t)} style={{ ...seg(false), padding: "3px 7px", marginLeft: 4 }}>紀錄</button>
                      <button onClick={() => del(t)} style={{ ...seg(false), padding: "3px 7px", marginLeft: 4, color: "var(--red,#e8192c)", borderColor: "var(--red,#e8192c)" }}>刪</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>

    {/* 執行紀錄 */}
    {runsView && (
      <div onClick={() => setRunsView(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 1002, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg2,#1a1a1a)", color: "var(--text,#eee)", borderRadius: 12, width: "min(800px,90vw)", height: "78vh", display: "flex", flexDirection: "column", overflow: "hidden", border: "1px solid var(--border,#333)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid var(--border,#333)" }}>
            <span style={{ fontWeight: 600 }}>執行紀錄：{runsView.task.name}</span>
            <button onClick={() => setRunsView(null)} style={{ background: "transparent", border: "none", color: "var(--text2,#ccc)", fontSize: 22, cursor: "pointer" }}>×</button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
            {runsView.loading ? <div style={{ color: "var(--text3,#888)" }}>載入中…</div>
             : runsView.runs.length === 0 ? <div style={{ color: "var(--text3,#888)" }}>尚無執行紀錄（任務還沒到觸發時間，或用「立即跑」測試）。</div>
             : runsView.runs.map((r) => (
                <div key={r.run_id} style={{ marginBottom: 12, border: "1px solid var(--border,#2a2a2a)", borderRadius: 8, overflow: "hidden" }}>
                  <div style={{ fontSize: 11, padding: "4px 10px", background: "var(--bg3,#2a2a2a)", color: r.status === "success" ? "#7bd88f" : "#ff6b6b" }}>
                    {r.started_at ? new Date(r.started_at).toLocaleString("zh-TW", { hour12: false }) : ""} · {r.status}
                  </div>
                  <div style={{ padding: "8px 10px", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{r.output}</div>
                </div>
              ))}
          </div>
        </div>
      </div>
    )}
   </>
  );
}
