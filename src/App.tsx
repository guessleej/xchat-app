import React, { useState, useRef, useEffect, useCallback } from "react";
import { Virtuoso, VirtuosoHandle } from "react-virtuoso";
import {
  streamChat, streamResearch, streamAgent, streamComputer, streamDynamicAgent,
  tools, files, auth, type SSECallback,
} from "./api";
import { useChatStore } from "./store/chatStore";
import { useUIStore } from "./store/uiStore";
import { db } from "./store/db";
import { MarkdownRenderer } from "./components/MarkdownRenderer";
import XChatLogo from "./xchat-logo.svg";
import "./app.css";

// ─── Window.xchatAPI type ──────────────────────────────────────────────────────
declare global {
  interface Window {
    xchatAPI?: {
      platform?: string;
      openExternal?: (url: string) => void;
      getTheme?: () => Promise<string>;
      onThemeChanged?: (cb: (t: string) => void) => () => void;
      setTitle?: (t: string) => void;
      onNewConversation?: (cb: () => void) => () => void;
      onFocusSearch?: (cb: () => void) => () => void;
      onOpenModelPicker?: (cb: () => void) => () => void;
      touchbarSetModel?: (m: string) => void;
      taskbarProgress?: (v: number) => void;
      toastNotify?: (title: string, body: string) => void;
      onUpdateAvailable?: (cb: (v: string) => void) => () => void;
      onUpdateProgress?: (cb: (p: number) => void) => () => void;
      onUpdateReady?: (cb: () => void) => () => void;
      downloadUpdate?: () => void;
      installUpdate?: () => void;
    };
  }
}

// ─── 工具定義 ─────────────────────────────────────────────────────────────────
const TOOLS = [
  { id: "chat",     icon: "",  label: "新建對話",   shortcut: "⌘K" },
  { id: "doc",      icon: "",  label: "文件",        shortcut: "" },
  { id: "agent",    icon: "",  label: "Agents",      shortcut: "" },
  { id: "code",     icon: "",  label: "程式",        shortcut: "" },
  { id: "computer", icon: "",  label: "桌面控制",    shortcut: "" },
  { id: "file",     icon: "",  label: "檔案上傳",    shortcut: "" },
] as const;
type ToolId = (typeof TOOLS)[number]["id"] | "ppt" | "website" | "document" | "research" | "table";

// ─── 登入 / 註冊頁 ─────────────────────────────────────────────────────────────
const INPUT_S: React.CSSProperties = {
  width: "100%", padding: "12px 14px", marginBottom: 12, borderRadius: 8,
  border: "1px solid #2d3748", background: "#0f172a", color: "#e2e8f0",
  fontSize: 14, outline: "none", boxSizing: "border-box",
};

function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [mode, setMode]   = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [pass, setPass]   = useState("");
  const [uname, setUname] = useState("");
  const [err, setErr]     = useState("");
  const [busy, setBusy]   = useState(false);

  const submit = async () => {
    if (!email || !pass) { setErr("請填寫必填欄位"); return; }
    setBusy(true); setErr("");
    try {
      if (mode === "login") {
        const { access_token } = await auth.login(email, pass);
        localStorage.setItem("token", access_token);
      } else {
        if (!uname) { setErr("請填寫使用者名稱"); setBusy(false); return; }
        await auth.register(email, pass, uname);
        const { access_token } = await auth.login(email, pass);
        localStorage.setItem("token", access_token);
      }
      onLogin();
    } catch (e: unknown) {
      setErr((e as Error).message || "操作失敗，請重試");
    }
    setBusy(false);
  };

  return (
    <div style={{ display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#1a1a2e" }}>
      <div style={{ background:"#16213e",borderRadius:16,padding:"40px 48px",width:380,boxShadow:"0 20px 60px rgba(0,0,0,.5)" }}>
        <div style={{ textAlign:"center",marginBottom:24 }}>
          <img src={XChatLogo} alt="xChat" style={{ width:72,height:72,marginBottom:10 }} />
          <div style={{ color:"#e2e8f0",fontSize:22,fontWeight:700,letterSpacing:1 }}>xChat</div>
          <div style={{ color:"#64748b",fontSize:13,marginTop:4 }}>智慧協作平台</div>
        </div>
        <div style={{ display:"flex",gap:8,marginBottom:24 }}>
          {(["login","register"] as const).map(m => (
            <button key={m} onClick={() => { setMode(m); setErr(""); }}
              style={{ flex:1,padding:"10px",borderRadius:8,border:"none",cursor:"pointer",
                background:mode===m?"#4f46e5":"#1e2a47",color:mode===m?"#fff":"#94a3b8",
                fontWeight:600,fontSize:14 }}>
              {m==="login"?"登入":"註冊"}
            </button>
          ))}
        </div>
        {mode==="register" && <input placeholder="使用者名稱" value={uname} onChange={e=>setUname(e.target.value)} style={INPUT_S}/>}
        <input placeholder="電子郵件" type="email" value={email} onChange={e=>setEmail(e.target.value)} style={INPUT_S}/>
        <input placeholder="密碼（8位以上）" type="password" value={pass}
          onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} style={INPUT_S}/>
        {err && <p style={{ color:"#f87171",fontSize:13,marginBottom:12 }}>{err}</p>}
        <button onClick={submit} disabled={busy}
          style={{ width:"100%",padding:"12px",borderRadius:8,border:"none",cursor:"pointer",
            background:busy?"#374151":"#4f46e5",color:"#fff",fontWeight:700,fontSize:16 }}>
          {busy?"處理中...":mode==="login"?"登入":"建立帳號"}
        </button>
      </div>
    </div>
  );
}

// ─── 更新提示列 ────────────────────────────────────────────────────────────────
function UpdateBanner() {
  const { updateInfo, setUpdateInfo } = useUIStore();
  if (!updateInfo) return null;
  return (
    <div className="update-banner">
      {updateInfo.ready ? (
        <><span>xChat {updateInfo.version} 已下載完成</span>
          <button onClick={() => window.xchatAPI?.installUpdate?.()}>立即重啟安裝</button>
          <button className="dismiss" onClick={() => setUpdateInfo(null)}>稍後</button></>
      ) : updateInfo.progress > 0 ? (
        <><span>正在下載更新… {updateInfo.progress}%</span>
          <progress value={updateInfo.progress} max={100} /></>
      ) : (
        <><span>xChat {updateInfo.version} 可用</span>
          <button onClick={() => window.xchatAPI?.downloadUpdate?.()}>下載更新</button>
          <button className="dismiss" onClick={() => setUpdateInfo(null)}>略過</button></>
      )}
    </div>
  );
}

// ─── 主應用 ───────────────────────────────────────────────────────────────────
export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(() => !!localStorage.getItem("token"));
  const [activeTool, setActiveTool] = useState<ToolId>("chat");
  const [input, setInput]           = useState("");
  const [thinkingMode, setThinkingMode] = useState(false);
  const [imageAttachments, setImageAttachments] = useState<string[]>([]);
  const [docGroupOpen, setDocGroupOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(() => localStorage.getItem("xchat-history-open") !== "0");
  // 動態 Agents 卡片狀態
  type DynAgent = { id: string; name: string; specialty: string; task: string; tokens: number; status: "spawned"|"running"|"done"|"error"; tool?: string; };
  const [dynPlan, setDynPlan] = useState<{title:string;summary:string;dimensions?:number}|null>(null);
  const [dynAgents, setDynAgents] = useState<DynAgent[]>([]);
  const [dynSynthesize, setDynSynthesize] = useState<{phase:"idle"|"thinking"|"writing"; tokens:number}>({phase:"idle",tokens:0});
  type AgentRole = "planner" | "researcher" | "writer" | "reviewer" | "executor";
  const [selectedAgents, setSelectedAgents] = useState<AgentRole[]>(
    () => {
      try {
        const saved = JSON.parse(localStorage.getItem("xchat-agent-roles") || "null");
        if (Array.isArray(saved) && saved.length > 0) return saved;
      } catch {}
      return ["planner", "researcher", "writer"];
    }
  );
  const toggleAgent = (r: AgentRole) => {
    setSelectedAgents((prev) => {
      const next = prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r];
      try { localStorage.setItem("xchat-agent-roles", JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [historySearch, setHistorySearch] = useState("");

  const {
    convId, conversations, messages, loading, taskStatus,
    newConversation, loadConversation, loadHistory, deleteConversation,
    addUserMessage, addAssistantMessage, appendContent, appendReasoning,
    addToolCall, attachToolResult, finishMessage, setLoading, setTaskStatus, persistConversation,
    saveAssistantToDb, persistConversationFor,
  } = useChatStore();

  const { theme, preview, isDragging, showScrollBtn, toggleTheme, setPreview, setIsDragging, setShowScrollBtn, updateInfo, setUpdateInfo, lastResult, setLastResult, activeTask, setActiveTask, webAccess, setWebAccess, heartbeat, bumpHeartbeat } = useUIStore();

  const abortRef      = useRef<AbortController | null>(null);
  const pollStopRef   = useRef<(() => void) | null>(null);
  const pendingUserMsgRef = useRef<{ convId: string; messageId: string } | null>(null);
  const virtuosoRef   = useRef<VirtuosoHandle>(null);
  const fileInputRef  = useRef<HTMLInputElement>(null);
  const textareaRef   = useRef<HTMLTextAreaElement>(null);

  // ── 初始化 ─────────────────────────────────────────────────────────────────
  // 監聽 API 層的強制登出事件（token 過期且 refresh 失敗）
  useEffect(() => {
    const handler = () => { auth.logout(); setIsLoggedIn(false); };
    window.addEventListener("xchat:logout", handler);
    return () => window.removeEventListener("xchat:logout", handler);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);

    // Electron native: 同步 OS 主題
    window.xchatAPI?.getTheme?.().then((t) => {
      if (!localStorage.getItem("xchat-theme")) {
        document.documentElement.setAttribute("data-theme", t);
      }
    });
    const offTheme = window.xchatAPI?.onThemeChanged?.((t) => {
      if (!localStorage.getItem("xchat-theme")) {
        document.documentElement.setAttribute("data-theme", t);
      }
    });

    // Electron native: Touch Bar / Dock / Tray 的新對話事件
    const offNew = window.xchatAPI?.onNewConversation?.(() => handleNewConversation());
    const offSearch = window.xchatAPI?.onFocusSearch?.(() => {
      document.querySelector<HTMLInputElement>(".sidebar__search-input")?.focus();
    });

    // 自動更新事件
    const offUA = window.xchatAPI?.onUpdateAvailable?.((version) =>
      setUpdateInfo({ version, ready: false, progress: 0 })
    );
    const offUP = window.xchatAPI?.onUpdateProgress?.((progress) => {
      const cur = useUIStore.getState().updateInfo;
      setUpdateInfo(cur ? { ...cur, progress } : null);
    });
    const offUR = window.xchatAPI?.onUpdateReady?.(() => {
      const cur = useUIStore.getState().updateInfo;
      setUpdateInfo(cur ? { ...cur, ready: true } : null);
    });

    return () => { offTheme?.(); offNew?.(); offSearch?.(); offUA?.(); offUP?.(); offUR?.(); };
  }, []);

  useEffect(() => {
    if (isLoggedIn) loadHistory();
  }, [isLoggedIn]);

  // Textarea 自動高度（對齊網頁版）
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [input]);

  // send 後重置高度
  const resetTextareaHeight = () => {
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  // 全域快捷鍵 ⌘K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "x") { e.preventDefault(); handleNewConversation(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // 虛擬滾動自動捲到底
  useEffect(() => {
    if (!showScrollBtn && messages.length > 0)
      virtuosoRef.current?.scrollToIndex({ index: messages.length - 1, behavior: "smooth" });
  }, [messages.length]);

  // 更新視窗標題（Electron 專屬）
  useEffect(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) window.xchatAPI?.setTitle?.(`xChat — ${lastUser.content.slice(0, 40)}`);
  }, [messages.length]);

  // 只清 UI 狀態；任務在背景繼續執行，結果寫進原本對話
  const detachUI = () => {
    setLoading(false);
    setTaskStatus("");
    window.xchatAPI?.taskbarProgress?.(0);
  };

  const handleNewConversation = () => {
    detachUI();
    newConversation();
    setPreview(null);
    setLastResult(null);
    setImageAttachments([]);
    setActiveTool("chat");
  };

  const startToolSession = (toolId: ToolId) => {
    detachUI();
    setActiveTool(toolId);
    newConversation();
    setPreview(null);
    setLastResult(null);
    setImageAttachments([]);
  };

  // ── 檔案上傳 ────────────────────────────────────────────────────────────────
  const uploadFile = async (file: File) => {
    setLoading(true);
    addUserMessage(`上傳檔案：${file.name}`);
    try {
      const { data } = await files.upload(file);
      const aiId = addAssistantMessage();
      appendContent(aiId, `已解析 **${data.file_name}**\n\n**內容預覽：**\n\`\`\`\n${data.extracted_text}\n\`\`\``);
      await finishMessage(aiId);
    } catch (ex: unknown) {
      const aiId = addAssistantMessage();
      appendContent(aiId, `上傳失敗：${(ex as Error).message}`);
      await finishMessage(aiId);
    }
    setLoading(false);
  };

  // ── 拖放 ─────────────────────────────────────────────────────────────────────
  const handleDragOver  = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
  };
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (ev) => setImageAttachments((p) => [...p, ev.target?.result as string]);
      reader.readAsDataURL(file);
    } else {
      await uploadFile(file);
    }
  };

  // ── 剪貼板貼圖 ───────────────────────────────────────────────────────────────
  const handlePaste = (e: React.ClipboardEvent) => {
    for (const item of e.clipboardData.items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = (ev) => setImageAttachments((p) => [...p, ev.target?.result as string]);
        reader.readAsDataURL(file);
        e.preventDefault();
      }
    }
  };

  // ── 發送（50ms batching + SSE）──────────────────────────────────────────────
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text && imageAttachments.length === 0) return;
    if (activeTool === "agent" && selectedAgents.length === 0) {
      alert("請至少選擇一個 Agent 角色。");
      return;
    }
    // 全域：一次只能執行一個任務
    if (useUIStore.getState().activeTask) {
      const at = useUIStore.getState().activeTask!;
      const ok = confirm(`另一個任務正在執行中（${at.label}）。\n\n按「確定」強制停止它並開始新任務，按「取消」放棄這次送出。`);
      if (!ok) return;
      abortRef.current?.abort();
      if (pollStopRef.current) { pollStopRef.current(); pollStopRef.current = null; }
      setActiveTask(null);
      setTaskStatus("");
    }
    if (loading) return;

    setInput("");
    resetTextareaHeight();
    setLoading(true);
    const imgs = [...imageAttachments];
    setImageAttachments([]);

    const userMsgId = addUserMessage(text, imgs.length > 0 ? imgs : undefined);
    pendingUserMsgRef.current = { convId, messageId: userMsgId };
    const aiId = addAssistantMessage();
    abortRef.current = new AbortController();

    // 立刻把對話固定到側邊欄、placeholder 寫到 DB（讓任何切換都不會弄丟）
    const taskOwnerConvId = convId;
    const taskTitle = text.slice(0, 30) || activeTool.toUpperCase();
    const toolLabels: Record<string, string> = {
      chat: "對話", ppt: "PPT 簡報", website: "網站", document: "文檔",
      table: "表格", code: "程式碼", research: "深度研究", agent: "Agents",
      computer: "電腦控制",
    };
    await persistConversationFor(taskOwnerConvId, taskTitle, activeTool);
    await saveAssistantToDb({
      messageId: aiId, convId: taskOwnerConvId,
      content: "", streaming: true,
    });
    setActiveTask({ convId: taskOwnerConvId, label: toolLabels[activeTool] || activeTool, aiId });

    // 內容緩衝（在背景時也能持續累積，task 完成時整段寫回 DB）
    let contentBuf = "";
    const bufAppend = (chunk: string) => {
      contentBuf += chunk;
      bumpHeartbeat();
      if (useChatStore.getState().convId === taskOwnerConvId) {
        appendContent(aiId, chunk);
      }
    };

    // Windows: 顯示 TaskBar 進度
    window.xchatAPI?.taskbarProgress?.(-1);

    const done = async () => {
      await saveAssistantToDb({
        messageId: aiId, convId: taskOwnerConvId,
        content: contentBuf, streaming: false,
      });
      if (useChatStore.getState().convId === taskOwnerConvId) {
        finishMessage(aiId);
        setLoading(false);
      } else {
        setLoading(false);
      }
      setActiveTask(null);
      pendingUserMsgRef.current = null;
      window.xchatAPI?.taskbarProgress?.(0);
    };

    // CUA 電腦控制
    if (activeTool === "computer") {
      setTaskStatus("連線虛擬桌面...");
      const apiBase = (import.meta.env.VITE_API_URL ?? "http://<backend-host>:8280/api/v1") as string;
      const host = new URL(apiBase).hostname;
      const vncUrl = `http://${host}:6180/vnc.html?autoconnect=true&reconnect=true&resize=scale&path=websockify`;
      setPreview({ html: `<iframe src="${vncUrl}" width="100%" height="100%" style="border:none;background:#000" allow="fullscreen" title="CUA Virtual Desktop"></iframe>` });
      streamComputer(text, (ev) => {
        const e = ev as Record<string, string | Record<string, string>>;
        if (e.type === "start") setTaskStatus(`電腦控制啟動 [${e.session_id}]`);
        else if (e.type === "action") {
          const act = e.action as Record<string, string>;
          const desc = act?.description || act?.action || "執行操作";
          setTaskStatus(desc);
          bufAppend(`\n**步驟 ${e.step}**：${desc}`);
        } else if (e.type === "warning") bufAppend(`\n> 警告：${e.message}`);
        else if (e.type === "error") {
          bufAppend(`\n> 錯誤：${e.message}`);
          done();
          setTaskStatus("發生錯誤");
        } else if (e.type === "done") {
          bufAppend(`\n\n**完成**：${e.result}`);
          done();
          setTaskStatus(`完成（共 ${e.steps} 步）`);
        } else if (e.type === "cancelled") {
          done();
          setTaskStatus("已中止");
        }
      }, abortRef.current.signal);
      return;
    }

    // 深度研究
    if (activeTool === "research") {
      setTaskStatus("啟動深度研究...");
      streamResearch(text, "standard", (ev) => {
        const e = ev as Record<string, string>;
        if (e.type === "searching") setTaskStatus(`搜尋：${e.query}（第 ${e.round} 輪）`);
        else if (e.type === "round_summary") bufAppend(`\n\n**第${e.round}輪摘要**\n${e.summary}`);
        else if (e.type === "report_chunk") bufAppend(e.content);
        else if (e.type === "done") { done(); setTaskStatus("研究完成"); }
      }, abortRef.current.signal);
      return;
    }

    // Agent（動態多 agent 集群，Kimi K2 風格）
    if (activeTool === "agent") {
      setTaskStatus("啟動 Agents...");
      setDynPlan(null);
      setDynAgents([]);
      streamDynamicAgent(text, (ev) => {
        const e = ev as Record<string, unknown>;
        const t = e.type as string;
        if (t === "orchestrator_start") setTaskStatus("規劃中...");
        else if (t === "orchestrator_done") {
          const plan = e.plan as { title: string; summary: string; dimensions?: number; agents: DynAgent[] };
          setDynPlan({ title: plan.title, summary: plan.summary, dimensions: plan.dimensions });
          setTaskStatus(`派出 ${plan.agents.length} 個專家`);
        }
        else if (t === "agent_spawn") {
          setDynAgents(prev => [...prev, {
            id: e.id as string, name: e.name as string,
            specialty: e.specialty as string, task: e.task as string,
            tokens: 0, status: "spawned",
          }]);
        }
        else if (t === "agent_progress") {
          bumpHeartbeat();
          setDynAgents(prev => prev.map(a => a.id === e.id ? { ...a, status: "running", tokens: e.tokens as number } : a));
        }
        else if (t === "agent_tool") {
          setDynAgents(prev => prev.map(a => a.id === e.id ? { ...a, tool: e.tool as string } : a));
        }
        else if (t === "agent_done") {
          setDynAgents(prev => prev.map(a => a.id === e.id ? { ...a, status: "done", tool: undefined } : a));
        }
        else if (t === "agent_error") {
          setDynAgents(prev => prev.map(a => a.id === e.id ? { ...a, status: "error" } : a));
        }
        else if (t === "synthesize_start") {
          setTaskStatus("整合最終報告...");
          setDynSynthesize({phase:"thinking", tokens:0});
          bufAppend(`\n\n---\n\n## 最終整合報告\n\n`);
        }
        else if (t === "synthesize_thinking") {
          bumpHeartbeat();
          setDynSynthesize({phase:"thinking", tokens: e.tokens as number});
        }
        else if (t === "synthesize_chunk") {
          setDynSynthesize(prev => prev.phase === "writing" ? prev : {phase:"writing", tokens:prev.tokens});
          bufAppend(e.content as string);
        }
        else if (t === "synthesize_done") {
          setDynSynthesize({phase:"idle", tokens:0});
        }
        else if (t === "done") {
          done();
          setTaskStatus("集群任務完成");
        }
        else if (t === "error") {
          const msg = String(e.message || "");
          if (msg.includes("401")) {
            bufAppend(`\n\n登入逾期，請重新登入後再試。`);
            localStorage.removeItem("token");
            localStorage.removeItem("refresh_token");
            setTimeout(() => window.dispatchEvent(new Event("xchat:logout")), 500);
          } else {
            bufAppend(`\n\n錯誤：${msg}`);
          }
          done();
        }
      }, abortRef.current.signal, webAccess);
      return;
    }

    // 工具生成（PPT / website / document / table / code）
    if (["ppt","website","document","table","code"].includes(activeTool)) {
      setTaskStatus(`生成 ${activeTool.toUpperCase()} 中...`);
      bufAppend(`正在生成 ${activeTool.toUpperCase()}，請稍候...`);
      try {
        const { data } = await tools.generate(activeTool as "ppt", text);
        const stop = tools.pollTask(data.task_id, async (result) => {
          const onOwnerConv = useChatStore.getState().convId === taskOwnerConvId;
          if (result.status === "completed") {
            stop();
            pollStopRef.current = null;
            const r = result.result as Record<string, string>;
            const dlUrl = activeTool === "ppt" ? `/api/v1/tools/download/${data.task_id}` : undefined;
            const safePrompt = text.replace(/[\\/:*?"<>|]/g, "_").trim().slice(0, 60) || "簡報";
            const dlName = activeTool === "ppt" ? `${safePrompt}.pptx` : undefined;
            const finalContent = `正在生成 ${activeTool.toUpperCase()}，請稍候...\n${activeTool.toUpperCase()} 已生成完成。`;
            const body = !dlUrl ? (r?.markdown || r?.csv || r?.code || r?.preview_html || "") : "";
            const wrappedBody = body ? (activeTool === "code" ? `\n\n\`\`\`\n${body}\n\`\`\``
              : activeTool === "table" ? `\n\n\`\`\`csv\n${body}\n\`\`\`` : `\n\n${body}`) : "";
            // 把完整 AI 訊息（含結果）寫入原始對話的 DB
            await saveAssistantToDb({
              messageId: aiId, convId: taskOwnerConvId,
              content: finalContent + wrappedBody,
              taskId: data.task_id,
              toolType: activeTool as "ppt",
              downloadName: dlName,
              previewHtml: r?.preview_html,
              streaming: false,
            });
            setActiveTask(null);
            // 只有當下仍在這個對話才更新預覽/下載 UI
            if (onOwnerConv && dlUrl) {
              const prev: { html?: string; text?: string; downloadUrl: string; downloadName?: string } = {
                downloadUrl: dlUrl, downloadName: dlName,
              };
              if (r?.preview_html) prev.html = r.preview_html;
              else if (r?.markdown) prev.text = r.markdown;
              else if (r?.csv) prev.text = r.csv;
              else if (r?.code) prev.text = r.code;
              setPreview(prev);
              const toolLabels: Record<string, string> = {
                ppt: "PPT 簡報", website: "網站", document: "文檔", table: "表格", code: "程式碼",
              };
              if (toolLabels[activeTool]) {
                setLastResult({
                  tool: activeTool as "ppt" | "website" | "document" | "table" | "code",
                  label: toolLabels[activeTool],
                  html: prev.html, text: prev.text,
                  downloadUrl: prev.downloadUrl, downloadName: prev.downloadName,
                });
              }
              setTaskStatus("生成完成");
              window.xchatAPI?.taskbarProgress?.(0);
            }
            pendingUserMsgRef.current = null;
          } else if (result.status === "failed") {
            stop();
            pollStopRef.current = null;
            await saveAssistantToDb({
              messageId: aiId, convId: taskOwnerConvId,
              content: `正在生成 ${activeTool.toUpperCase()}，請稍候...\n生成失敗：${result.error}`,
              streaming: false,
            });
            setActiveTask(null);
            if (onOwnerConv) {
              setTaskStatus("");
              setLoading(false);
              window.xchatAPI?.taskbarProgress?.(0);
            } else {
              setLoading(false);
            }
            pendingUserMsgRef.current = null;
          }
        });
        pollStopRef.current = stop;
      } catch (e: unknown) {
        appendContent(aiId, `錯誤：${(e as Error).message}`);
        await finishMessage(aiId);
        window.xchatAPI?.taskbarProgress?.(0);
      }
      setLoading(false);
      return;
    }

    // 主對話（深度思考 + 50ms batch SSE）
    const payload = thinkingMode
      ? `請在 <think>...</think> 標籤內先進行推理，再給出答案。\n\n${text}`
      : text;

    let buf = ""; let rafId: ReturnType<typeof setTimeout> | null = null;
    const flush = () => { if (buf) { bufAppend(buf); buf = ""; } rafId = null; };
    const scheduleFlush = () => { if (rafId === null) rafId = setTimeout(flush, 50); };

    let inThink = false; let thinkBuf = "";

    const onEvent: SSECallback = (ev) => {
      const e = ev as Record<string, string>;
      if (e.type === "text") {
        const chunk = e.content ?? "";
        if (!inThink && chunk.includes("<think>")) {
          inThink = true;
          const [before, after] = chunk.split("<think>");
          if (before) { buf += before; scheduleFlush(); }
          thinkBuf = after ?? "";
        } else if (inThink) {
          if (chunk.includes("</think>")) {
            inThink = false;
            const [reasoning, after] = chunk.split("</think>");
            thinkBuf += reasoning;
            appendReasoning(aiId, thinkBuf);
            thinkBuf = "";
            if (after) { buf += after; scheduleFlush(); }
          } else {
            thinkBuf += chunk;
            appendReasoning(aiId, chunk);
          }
        } else {
          buf += chunk; scheduleFlush();
        }
      } else if (e.type === "tool_start") {
        addToolCall(aiId, e.tool);
        setTaskStatus(`${getToolLabel(e.tool)}中...`);
      } else if (e.type === "tool_end") {
        setTaskStatus("整理結果中...");
      } else if (e.type === "error") {
        flush();
        const msg = e.message || "";
        if (msg.includes("401")) {
          bufAppend(`登入逾期，請重新登入後再試。`);
          localStorage.removeItem("token");
          localStorage.removeItem("refresh_token");
          setTimeout(() => window.dispatchEvent(new Event("xchat:logout")), 500);
        } else {
          bufAppend(`錯誤：${msg}`);
        }
        done();
      } else if (e.type === "done") {
        flush();
        done();
        window.xchatAPI?.toastNotify?.("xChat", "回覆已完成");
      }
    };

    streamChat(convId, payload, webAccess ? ["web_search"] : [], onEvent, abortRef.current.signal);
  }, [input, loading, activeTool, convId, thinkingMode, imageAttachments, selectedAgents, webAccess]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey
        && !(e.nativeEvent as KeyboardEvent).isComposing
        && (e.nativeEvent as KeyboardEvent).keyCode !== 229) {
      e.preventDefault(); send();
    }
  };

  const copyMessage = (content: string) => {
    navigator.clipboard?.writeText(content.replace(/<think>[\s\S]*?<\/think>/g, "").trim());
  };

  // ── 訊息條目（useCallback 穩定引用，供 Virtuoso 使用）──────────────────────
  const MessageItem = useCallback((_index: number, msg: typeof messages[0]) => (
    <div key={msg.id} className={`msg msg--${msg.role}`}>
      {msg.role === "assistant" && (
        <div className="msg__avatar msg__avatar--ai">
          <img src={XChatLogo} alt="xChat" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        </div>
      )}
      <div className="msg__bubble">
        {msg.images && msg.images.length > 0 && (
          <div className="msg__images">
            {msg.images.map((src, i) => <img key={i} src={src} alt="" className="msg__image" loading="lazy" />)}
          </div>
        )}
        {msg.toolCalls && msg.toolCalls.length > 0 && (
          <div className="msg__tool-list">
            {msg.toolCalls.map((t, i) => (
              <span key={i} className={`msg__tool msg__tool--${t.replace(/_/g,'-')}`}>
                <span className="msg__tool-dot" />
                <span className="msg__tool-name">{getToolLabel(t)}</span>
              </span>
            ))}
          </div>
        )}
        <div className="msg__text">
          {msg.role === "assistant"
            ? <MarkdownRenderer text={msg.content} streaming={msg.streaming} reasoning={msg.reasoning} />
            : <span>{msg.content}</span>
          }
        </div>
        {msg.role === "assistant" && !msg.streaming && msg.content && (
          <div className="msg__actions">
            <button className="msg__action-btn" title="複製"
              onClick={() => copyMessage(msg.content)}>複製</button>
          </div>
        )}
      </div>
      {msg.role === "user" && <div className="msg__avatar msg__avatar--user">U</div>}
    </div>
  ), []);

  if (!isLoggedIn) return <LoginPage onLogin={() => setIsLoggedIn(true)} />;

  return (
    <div className="app" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {/* macOS: drag region（最頂層，跨全寬） */}
      <div className="titlebar-drag-region" />

      <UpdateBanner />

      {isDragging && (
        <div className="drag-overlay">
          <div className="drag-overlay__inner">
            <div className="drag-overlay__icon">↓</div>
            <div>拖放檔案上傳</div>
          </div>
        </div>
      )}

      {/* ── 主體（側欄 + 主內容 + 預覽）────────────────────────────────────── */}
      <div className="app-body">

        {/* 折疊按鈕（絕對定位在 app-body 內） */}
        <button
          className="sidebar-toggle"
          style={{ left: sidebarOpen ? "calc(var(--sidebar-w) - 30px)" : "8px" }}
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? "收合側欄" : "展開側欄"}
        >
          {sidebarOpen ? "◀" : "▶"}
        </button>

        {/* ── 側邊欄 ─────────────────────────────────────────────────────── */}
        <aside className={`sidebar ${sidebarOpen ? "" : "sidebar--collapsed"}`}>
          <img src={XChatLogo} alt="xChat" className="sidebar__logo" />

          <button className="sidebar__new" onClick={handleNewConversation}>
            <span className="sidebar__new-icon"></span>
            <span>新建對話</span>
            <kbd>⌘X</kbd>
          </button>

          {/* 工具列 */}
          <nav className="sidebar__nav">
            {TOOLS.slice(1).map((t) => (
              <button key={t.id}
                className={`sidebar__item ${(activeTool === t.id || (t.id === "doc" && ["ppt","website","document","research","table"].includes(activeTool as string))) ? "active" : ""}`}
                onClick={() => {
                  // 「文件」這個外層項目點下去 → 預設用 document 子類型
                  startToolSession((t.id === "doc" ? "document" : t.id) as ToolId);
                }}>
                <span>{t.label}</span>
              </button>
            ))}
          </nav>

          {/* 把空間推到底（功能跟歷史紀錄分隔線下移）*/}
          <div style={{ flex: historyOpen ? 0 : 1, minHeight: 8 }} />
          <div className="sidebar__divider" />

          {/* 歷史對話標題（可折疊）*/}
          <button
            onClick={() => {
              const v = !historyOpen;
              setHistoryOpen(v);
              localStorage.setItem("xchat-history-open", v ? "1" : "0");
            }}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "transparent", border: "none", color: "var(--text2)",
              padding: "8px 12px", cursor: "pointer", fontSize: 12,
              textAlign: "left", width: "100%",
            }}>
            <span>{historyOpen ? "▾" : "▸"}</span>
            <span>歷史對話</span>
            <span style={{ marginLeft: "auto", color: "var(--text3)" }}>{conversations.length}</span>
          </button>

          {historyOpen && <div className="sidebar__history">
            {conversations
              .filter((h) => !historySearch || h.title.toLowerCase().includes(historySearch.toLowerCase()))
              .map((h) => (
                <div key={h.id} className="sidebar__history-item-wrap">
                  <button className={`sidebar__history-item ${convId === h.id ? "active" : ""}`}
                    onClick={async () => {
                      detachUI();
                      await loadConversation(h.id);
                      // 還原該對話原本的工具類型
                      const savedTool = h.model;
                      if (savedTool && ["chat","ppt","website","document","research","table","agent","code","computer","file"].includes(savedTool)) {
                        setActiveTool(savedTool as ToolId);
                      }
                      setPreview(null);
                      const msgs = useChatStore.getState().messages;
                      // 有未完成的工具任務 → 顯示「生成中」狀態
                      const streamingMsg = [...msgs].reverse().find((m) => m.streaming && m.toolType);
                      if (streamingMsg) {
                        setTaskStatus(`生成 ${streamingMsg.toolType!.toUpperCase()} 中...`);
                      }
                      const last = [...msgs].reverse().find((m) => m.taskId && m.toolType);
                      if (last && last.toolType === "ppt" && !last.streaming) {
                        const labels: Record<string, string> = {
                          ppt: "PPT 簡報", website: "網站", document: "文檔", table: "表格", code: "程式碼",
                        };
                        setLastResult({
                          tool: last.toolType,
                          label: labels[last.toolType],
                          html: last.previewHtml,
                          downloadUrl: `/api/v1/tools/download/${last.taskId}`,
                          downloadName: last.downloadName,
                        });
                      } else {
                        setLastResult(null);
                      }
                    }}>
                    {activeTask?.convId === h.id && (
                      <span key={heartbeat} className="pulse-dot" title="任務執行中" />
                    )}
                    {h.title}
                  </button>
                  <button className="sidebar__history-del"
                    onClick={(e) => { e.stopPropagation(); deleteConversation(h.id); }}
                    title="刪除">✕</button>
                </div>
              ))}
          </div>}

          {/* 搜尋（折疊時隱藏）*/}
          {historyOpen && <input
            className="sidebar__search"
            placeholder="搜尋對話..."
            value={historySearch}
            onChange={(e) => setHistorySearch(e.target.value)}
          />}

          {/* 使用者選單 */}
          <div className="sidebar__user-wrap" style={{ position: "relative" }}>
            {userMenuOpen && (
              <div className="sidebar__user-menu">
                <div className="sidebar__user-menu-item"
                  onClick={() => { toggleTheme(); setUserMenuOpen(false); }}>
                  {theme === "dark" ? "切換淺色模式" : "切換深色模式"}
                </div>
                <div className="sidebar__user-menu-divider" />
                <div className="sidebar__user-menu-item" onClick={() => setUserMenuOpen(false)}>設置</div>
                <div className="sidebar__user-menu-item"
                  onClick={() => {
                    setUserMenuOpen(false);
                    alert("xChat\n\n由云碩科技 xCloudinfo 製作優化");
                  }}>關於 xChat</div>
                <div className="sidebar__user-menu-divider" />
                <div className="sidebar__user-menu-item sidebar__user-menu-item--danger"
                  onClick={() => { auth.logout(); setIsLoggedIn(false); setUserMenuOpen(false); }}>
                  登出
                </div>
              </div>
            )}
            <div className="sidebar__user" onClick={() => setUserMenuOpen((v) => !v)}>
              <div className="sidebar__avatar">U</div>
              <span>使用者</span>
              <span style={{ marginLeft: "auto", fontSize: 10, opacity: 0.5 }}>▲</span>
            </div>
          </div>
        </aside>

        {/* ── 主內容 ──────────────────────────────────────────────────────── */}
        <main className="main">
          {activeTask && activeTask.convId !== convId && (
            <div style={{
              padding: "8px 16px", background: "var(--accent-bg, #2a2a3e)",
              borderBottom: "1px solid var(--border, #333)",
              fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center"
            }}>
              <span>{activeTask.label} 正在背景執行中…</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="msg__action-btn" onClick={async () => {
                  detachUI();
                  await loadConversation(activeTask.convId);
                  setPreview(null);
                  setLastResult(null);
                }}>切回該對話</button>
                <button className="msg__action-btn" onClick={() => {
                  try { abortRef.current?.abort(); } catch {}
                  try { if (pollStopRef.current) { pollStopRef.current(); pollStopRef.current = null; } } catch {}
                  abortRef.current = null;
                  setActiveTask(null);
                  setLoading(false);
                  setTaskStatus("");
                  pendingUserMsgRef.current = null;
                  window.xchatAPI?.taskbarProgress?.(0);
                }}>停止任務</button>
              </div>
            </div>
          )}
          {messages.length === 0 ? (
            <div className="welcome">
              <h1 className="welcome__title">xChat</h1>
              <p className="welcome__sub">{getWelcomeText(activeTool)}</p>
              <div className="welcome__suggestions">
                {getSuggestions(activeTool).map((s, i) => (
                  <button key={i} className="welcome__chip" onClick={() => setInput(s)}>{s}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages-wrap" onScroll={(e) => {
              const el = e.currentTarget;
              setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 150);
            }}>
              <Virtuoso
                ref={virtuosoRef}
                style={{ flex: 1, height: "100%" }}
                data={messages}
                itemContent={MessageItem}
                followOutput="smooth"
                increaseViewportBy={300}
              />
            </div>
          )}

          {showScrollBtn && (
            <button className="scroll-bottom" onClick={() => {
              setShowScrollBtn(false);
              virtuosoRef.current?.scrollToIndex({ index: messages.length - 1, behavior: "smooth" });
            }}>↓</button>
          )}

          {taskStatus && <div className="task-status">{taskStatus}</div>}

          {imageAttachments.length > 0 && (
            <div className="attachments-bar">
              {imageAttachments.map((src, i) => (
                <div key={i} className="attachments-bar__item">
                  <img src={src} alt="" className="attachments-bar__img" />
                  <button className="attachments-bar__remove"
                    onClick={() => setImageAttachments((p) => p.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
            </div>
          )}

          {/* 文件子類型選擇 */}
          {(["doc","ppt","website","document","research","table"] as string[]).includes(activeTool as string) && !loading && (
            <div className="task-status" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
              <span style={{ color: "var(--text2)" }}>類型：</span>
              {[
                { id: "document", label: "文件" },
                { id: "ppt", label: "簡報" },
                { id: "website", label: "網站" },
                { id: "table", label: "表格" },
                { id: "research", label: "深度研究" },
              ].map((s) => (
                <button key={s.id}
                  onClick={() => setActiveTool(s.id as ToolId)}
                  style={{
                    background: activeTool === s.id ? "var(--accent-bg)" : "transparent",
                    color: activeTool === s.id ? "var(--accent)" : "var(--text2)",
                    border: `1px solid ${activeTool === s.id ? "var(--accent)" : "var(--border)"}`,
                    borderRadius: 14, padding: "3px 12px", fontSize: 12,
                    cursor: "pointer", fontWeight: activeTool === s.id ? 600 : 400,
                  }}>{s.label}</button>
              ))}
            </div>
          )}

          {/* 動態 Agents 卡片區 */}
          {activeTool === "agent" && dynAgents.length > 0 && (
            <div className="dyn-agents">
              {dynPlan && (
                <div className="dyn-plan-header">
                  <div className="dyn-plan-title">{dynPlan.title}</div>
                  <div className="dyn-plan-summary">{dynPlan.summary}{dynPlan.dimensions ? `（${dynPlan.dimensions} 個維度）` : ""}</div>
                </div>
              )}
              {dynSynthesize.phase !== "idle" && (
                <div className="dyn-synthesize-bar">
                  <span className="dyn-thinking-dots"><span /><span /><span /></span>
                  <span>{dynSynthesize.phase === "thinking" ? `Synthesizer 思考中… (reasoning ${dynSynthesize.tokens} tokens)` : "Synthesizer 撰寫整合報告中…"}</span>
                </div>
              )}
              <div className="dyn-agent-list">
                {dynAgents.map(a => (
                  <div key={a.id} className={`dyn-agent-card dyn-${a.status}`}>
                    <div className="dyn-agent-head">
                      <div className="dyn-agent-avatar">{a.name.slice(0,1)}</div>
                      <div className="dyn-agent-info">
                        <div className="dyn-agent-name">{a.name}</div>
                        <div className="dyn-agent-specialty">{a.specialty}</div>
                      </div>
                      <div className="dyn-agent-id">{a.id}</div>
                    </div>
                    <div className="dyn-agent-task">{a.task}</div>
                    <div className="dyn-agent-footer">
                      <div className="dyn-progress-dots">
                        {Array.from({length: 10}).map((_, i) => (
                          <span key={i} className={`dot ${a.status === "done" ? "filled" : (a.tokens >= (i+1)*50 ? "filled" : (a.tokens >= i*50 && a.status === "running" ? "active" : ""))}`} />
                        ))}
                      </div>
                      <span className="dyn-agent-status">
                        {a.status === "spawned" ? "等待中"
                          : a.status === "running" ? (a.tool ? `${a.tool}…` : `${a.tokens} tokens`)
                          : a.status === "done" ? "完成"
                          : "錯誤"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {lastResult && !loading && (
            <div className="task-status" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span>最近生成的 {lastResult.label}：</span>
              {(lastResult.html || lastResult.text) && (
                <button className="msg__action-btn"
                  onClick={() => setPreview({
                    html: lastResult.html, text: lastResult.text,
                    downloadUrl: lastResult.downloadUrl, downloadName: lastResult.downloadName
                  })}>
                  重新預覽
                </button>
              )}
              {lastResult.downloadUrl && (
                <a className="msg__action-btn"
                  href={`${import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1"}${lastResult.downloadUrl.replace("/api/v1", "")}${lastResult.downloadName ? `?name=${encodeURIComponent(lastResult.downloadName)}` : ""}`}
                  download={lastResult.downloadName || "download"}
                  style={{ textDecoration: "none" }}>
                  下載
                </a>
              )}
            </div>
          )}

          <div className="input-area">
            <div className="input-box">
              <textarea ref={textareaRef} className="input-box__text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown} onPaste={handlePaste}
                placeholder={getPlaceholder(activeTool)} rows={1} disabled={loading} />
              <div className="input-box__actions">
                {activeTool === "chat" && (
                  <button className={`input-box__btn input-box__btn--think ${thinkingMode ? "active" : ""}`}
                    onClick={() => setThinkingMode((v) => !v)} title="深度思考模式">深思</button>
                )}
                <button
                  className={`input-box__btn input-box__btn--think ${webAccess ? "active" : ""}`}
                  onClick={() => setWebAccess(!webAccess)}
                  title={webAccess ? "已啟用網路查詢，點擊關閉" : "未啟用網路，點擊開啟"}
                >上網</button>
                <button className="input-box__btn input-box__btn--attach"
                  onClick={() => fileInputRef.current?.click()}>附件</button>
                <input ref={fileInputRef} type="file" hidden
                  accept=".pdf,.docx,.txt,.md,.csv,.xlsx,.jpg,.png"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); }} />
                {loading
                  ? <button className="input-box__btn input-box__btn--stop"
                      onClick={() => {
                        try { abortRef.current?.abort(); } catch {}
                        try { if (pollStopRef.current) { pollStopRef.current(); pollStopRef.current = null; } } catch {}
                        abortRef.current = null;
                        setActiveTask(null);
                        setLoading(false);
                        setTaskStatus("已停止");
                        pendingUserMsgRef.current = null;
                        window.xchatAPI?.taskbarProgress?.(0);
                      }}>■ 停止</button>
                  : <button className="input-box__btn input-box__btn--send"
                      onClick={send} disabled={!input.trim() && imageAttachments.length === 0}>↑</button>
                }
              </div>
            </div>
            <div className="input-footer">
              <p className="input-hint">Enter 發送 · Shift+Enter 換行 · 可拖放或貼上圖片</p>
            </div>
          </div>
        </main>

        {/* ── 右側預覽面板 ────────────────────────────────────────────────── */}
        {preview && (
          <aside className="preview">
            <div className="preview__header">
              <span>預覽</span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {preview.downloadUrl && (
                  <a
                    href={`${import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1"}${preview.downloadUrl.replace("/api/v1", "")}${preview.downloadName ? `?name=${encodeURIComponent(preview.downloadName)}` : ""}`}
                    download={preview.downloadName || "presentation.pptx"}
                    style={{
                      background: "#4CAF50", color: "#fff", padding: "4px 12px",
                      borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: "none"
                    }}
                  >下載 PPTX</a>
                )}
                <button className="preview__close" onClick={() => setPreview(null)}>✕</button>
              </div>
            </div>
            <div className="preview__content">
              {preview.html
                ? <iframe srcDoc={preview.html} className="preview__iframe" title="preview" sandbox="allow-scripts" />
                : <pre className="preview__code">{preview.text}</pre>
              }
            </div>
          </aside>
        )}
      </div>{/* end .app-body */}
    </div>
  );
}

// ─── 輔助 ─────────────────────────────────────────────────────────────────────
function getWelcomeText(tool: ToolId): string {
  const map: Record<string, string> = {
    chat:"有什麼可以為您服務？",ppt:"描述您想要的簡報主題和內容",
    website:"描述您想要建立的網站",document:"描述文件的主題和要求",
    research:"輸入您想深入研究的主題",table:"描述您需要的表格類型",
    agent:"描述您的複雜任務目標",code:"描述您需要的程式功能",
    computer:"輸入要在虛擬桌面上完成的任務",file:"上傳文件以進行分析",
  };
  return map[tool] ?? "有什麼可以為您服務？";
}

function getSuggestions(tool: ToolId): string[] {
  const map: Record<string, string[]> = {
    chat:["解釋量子糾纏","撰寫一封英文求職信","用 Python 寫排序算法"],
    ppt:["雲端發展趨勢簡報（10張）","產品發布會簡報","季度業績回顧報告"],
    website:["科技公司官網","個人作品集網站","餐廳介紹頁面"],
    document:["撰寫專案提案書","市場分析報告","技術規格文件"],
    research:["雲端運算最新進展","台灣半導體產業分析","Web3 現狀與未來"],
    table:["月度銷售數據表","專案時程表","員工績效評估表"],
    agent:["研究並撰寫關於資料治理的文章","分析競品並生成報告","規劃 MVP 產品"],
    code:["用 React 做 Todo App","寫爬蟲抓取網頁數據","實作 JWT 認證系統"],
    computer:["打開瀏覽器搜尋台灣天氣","截圖並描述畫面內容","開啟記事本寫一段文字"],
    file:["上傳 PDF 並提問","分析 Excel 數據","解讀合約文件"],
  };
  return map[tool] ?? [];
}

function getPlaceholder(tool: ToolId): string {
  const map: Record<string, string> = {
    chat:"輸入訊息...",ppt:"描述你想要的簡報內容...",
    website:"描述網站的目的與風格...",document:"描述文件的主題和要求...",
    research:"輸入你想深入研究的問題...",table:"描述你需要的表格類型...",
    agent:"描述你的複雜任務目標...",code:"描述你需要的程式功能...",
    computer:"描述要在虛擬桌面上執行的任務...",file:"上傳檔案後，可在此提問...",
  };
  return map[tool] ?? "輸入訊息...";
}

function getToolLabel(t: string): string {
  const map: Record<string, string> = {
    web_search: "網路搜尋",
    fetch_url: "讀取網頁",
    read_file: "讀取檔案",
    execute_code: "執行程式",
    taiwan_company_lookup: "公司登記查詢",
    taiwan_tender_lookup: "政府標案查詢",
    seo_audit: "SEO 稽核",
  };
  return map[t] ?? t;
}
