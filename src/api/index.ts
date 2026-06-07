/**
 * API 客戶端 — 統一管理所有後端呼叫
 */

const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8080/api/v1";

// ─── Token 管理（含自動 refresh）──────────────────────────────────────────

function token() { return localStorage.getItem("token") ?? ""; }
function refreshToken() { return localStorage.getItem("refresh_token") ?? ""; }

let _refreshing: Promise<string> | null = null;

async function doRefresh(): Promise<string> {
  const rt = refreshToken();
  if (!rt) throw new Error("No refresh token");
  const res = await fetch(`${BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: rt }),
  });
  if (!res.ok) throw new Error("Refresh failed");
  const data = await res.json();
  const newToken = data.access_token ?? data.data?.access_token ?? "";
  const newRefresh = data.refresh_token ?? data.data?.refresh_token ?? rt;
  localStorage.setItem("token", newToken);
  localStorage.setItem("refresh_token", newRefresh);
  return newToken;
}

async function getValidToken(): Promise<string> {
  const t = token();
  if (!t) return "";
  try {
    const payload = JSON.parse(atob(t.split(".")[1]));
    if (payload.exp && payload.exp - Date.now() / 1000 < 60) {
      if (!_refreshing) _refreshing = doRefresh().finally(() => { _refreshing = null; });
      try { return await _refreshing; } catch { /* refresh 失敗，交給 401 處理 */ }
    }
  } catch {}
  return t;
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const tok = await getValidToken();
  const headers = new Headers(init.headers);
  if (tok) headers.set("Authorization", `Bearer ${tok}`);
  if (!headers.has("Content-Type") && !(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (res.status === 401) {
    // token 已失效，嘗試 refresh 一次
    try {
      const newTok = await doRefresh();
      const headers2 = new Headers(init.headers);
      headers2.set("Authorization", `Bearer ${newTok}`);
      if (!headers2.has("Content-Type") && !(init.body instanceof FormData))
        headers2.set("Content-Type", "application/json");
      const res2 = await fetch(`${BASE}${path}`, { ...init, headers: headers2 });
      if (res2.ok) return res2.json();
    } catch {}
    localStorage.removeItem("token");
    localStorage.removeItem("refresh_token");
    // Tauri/Electron（file:// 或 tauri://）不能用 href 跳轉到 /login（打包版無此路由）
    // → 改發事件讓 React 切回登入畫面；只有真正的 web 才用 location.href
    if (window.location.protocol === "file:" || "__TAURI_INTERNALS__" in window) {
      window.dispatchEvent(new CustomEvent("xchat:logout"));
    } else {
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    let detail = "";
    try { const j = JSON.parse(txt); detail = j.detail ?? j.message ?? ""; } catch {}
    throw new Error(`HTTP ${res.status}${detail ? "：" + detail : (txt ? "：" + txt.slice(0, 120) : "")}`);
  }
  // 成功：空 body（如 204 或某些代理回應）不應丟錯
  const okTxt = await res.text();
  return (okTxt ? JSON.parse(okTxt) : ({} as T));
}

// ─── Auth ─────────────────────────────────────────────────────────────────

// ─── 模型（伺服器集中管理；前端只顯示品牌化名稱，不碰端點/金鑰）──────────────
export interface ModelInfo { id: string; label: string; description?: string; default?: boolean }
export const models = () => req<{ data: ModelInfo[] }>("/chat/models").then((r) => r.data);

// ─── 下載檔案 ───────────────────────────────────────────────────────────────
// WKWebView 不支援 <a download>/blob 下載 → Tauri 改用原生存檔(寫下載資料夾)；web 用 a.click。
// 一律帶上 token（未授權端點忽略即可）。
export async function downloadFile(url: string, filename: string): Promise<void> {
  const tok = await getValidToken();
  const res = await fetch(url, tok ? { headers: { Authorization: `Bearer ${tok}` } } : {});
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  if (isTauri) {
    const buf = await res.arrayBuffer();
    const ok = await (window as { xchatAPI?: { saveBlob?: (n: string, d: ArrayBuffer) => Promise<boolean> } }).xchatAPI?.saveBlob?.(filename, buf);
    if (!ok) throw new Error("存檔已取消或失敗");
    (window as { xchatAPI?: { toastNotify?: (t: string, b: string) => void } }).xchatAPI?.toastNotify?.("下載完成", `${filename} 已存到「下載」資料夾`);
  } else {
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(href);
  }
}

export const auth = {
  login: async (email: string, password: string) => {
    const res = await req<{ access_token: string; refresh_token?: string }>("/auth/login", {
      method: "POST", body: JSON.stringify({ email, password })
    });
    if (res.refresh_token) localStorage.setItem("refresh_token", res.refresh_token);
    return res;
  },
  register: (email: string, password: string, username: string) =>
    req("/auth/register", {
      method: "POST", body: JSON.stringify({ email, password, username })
    }),
  me: async () => {
    const r = await req<{ success: boolean; data: { id: string; email: string; username: string; plan: string; avatar_url?: string } }>("/auth/me");
    return r.data;
  },
  updateProfile: async (patch: { username?: string; avatar_url?: string }) => {
    const r = await req<{ success: boolean; data: { id: string; email: string; username: string; avatar_url?: string } }>("/auth/me", {
      method: "PATCH", body: JSON.stringify(patch),
    });
    return r.data;
  },
  logout: () => {
    localStorage.removeItem("token");
    localStorage.removeItem("refresh_token");
  },
  // 嘗試用 refresh_token 續期；成功回 true（新 access token 已寫入 localStorage），失敗回 false
  tryRefresh: async (): Promise<boolean> => {
    try { await doRefresh(); return true; } catch { return false; }
  },
};

// ─── Chat（含 SSE 串流）──────────────────────────────────────────────────

export type SSECallback = (event: Record<string, unknown>) => void;

export function streamChat(
  convId: string,
  userMessage: string,
  toolsEnabled: string[],
  onEvent: SSECallback,
  signal?: AbortSignal
): void {
  getValidToken().then(async tok => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tok}`,
    };
    // 模型由伺服器集中管理：不再從客戶端送端點/金鑰/模型（避免金鑰外洩、確保用對引擎）

    fetch(`${BASE}/chat/conversations/${convId}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        conversation_id: convId,
        messages: [{ role: "user", content: userMessage }],
        stream: true,
        tools_enabled: toolsEnabled,
      }),
      signal,
    }).then(async (res) => {
      if (!res.ok || !res.body) {
        onEvent({ type: "error", message: `HTTP ${res.status}` });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") { onEvent({ type: "done" }); return; }
          try { onEvent(JSON.parse(data)); } catch {}
        }
      }
    }).catch((e) => {
      if (e.name !== "AbortError") onEvent({ type: "error", message: e.message });
    });
  });
}

export const chat = {
  list: () => req<{ data: Array<{ conversation_id: string; title: string; updated_at: string }> }>("/chat/conversations"),
  get: (id: string) => req(`/chat/conversations/${id}`),
  delete: (id: string) => req(`/chat/conversations/${id}`, { method: "DELETE" }),
};

// ─── Tools ────────────────────────────────────────────────────────────────

export type ToolType = "ppt" | "website" | "document" | "table" | "code";

export const tools = {
  generate: (toolType: ToolType, prompt: string) =>
    req<{ data: { task_id: string } }>("/tools/generate", {
      method: "POST", body: JSON.stringify({ tool_type: toolType, prompt })
    }),
  getTask: (taskId: string) => req<{ data: Record<string, unknown> }>(`/tools/tasks/${taskId}`),
  pollTask: (taskId: string, onUpdate: (data: Record<string, unknown>) => void) => {
    const id = setInterval(async () => {
      const { data } = await tools.getTask(taskId);
      onUpdate(data);
      if (data.status === "completed" || data.status === "failed") clearInterval(id);
    }, 2000);
    return () => clearInterval(id);
  },
};

// ─── Research（SSE 串流）────────────────────────────────────────────────

export function streamResearch(
  query: string,
  depth: "quick" | "standard" | "deep",
  onEvent: SSECallback,
  signal?: AbortSignal
): void {
  getValidToken().then(tok => {
    fetch(`${BASE}/research/research`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ query, depth }),
      signal,
    }).then(async (res) => {
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const d = line.slice(6);
            if (d === "[DONE]") return;
            try { onEvent(JSON.parse(d)); } catch {}
          }
        }
      }
    }).catch((e) => { if (e.name !== "AbortError") onEvent({ type: "error", message: e.message }); });
  });
}

// ─── Agent ────────────────────────────────────────────────────────────────

export function streamAgent(
  goal: string,
  agents: string[],
  onEvent: SSECallback,
  signal?: AbortSignal,
  webAccess: boolean = false,
): void {
  getValidToken().then(tok => {
    fetch(`${BASE}/agents/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ goal, agents, web_access: webAccess }),
      signal,
    }).then(async (res) => {
      if (!res.ok || !res.body) {
        onEvent({ type: "error", message: `HTTP ${res.status}` });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const d = line.slice(6);
            if (d === "[DONE]") return;
            try { onEvent(JSON.parse(d)); } catch {}
          }
        }
      }
    }).catch((e) => { if (e.name !== "AbortError") onEvent({ type: "error", message: e.message }); });
  });
}

export function streamDynamicAgent(
  goal: string,
  onEvent: SSECallback,
  signal?: AbortSignal,
  webAccess: boolean = false,
  maxAgents: number = 5,
): void {
  getValidToken().then(tok => {
    fetch(`${BASE}/agents/dynamic`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ goal, web_access: webAccess, max_agents: maxAgents }),
      signal,
    }).then(async (res) => {
      if (!res.ok || !res.body) {
        onEvent({ type: "error", message: `HTTP ${res.status}` });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const d = line.slice(6);
            if (d === "[DONE]") return;
            try { onEvent(JSON.parse(d)); } catch {}
          }
        }
      }
    }).catch((e) => { if (e.name !== "AbortError") onEvent({ type: "error", message: e.message }); });
  });
}

// ─── Computer（CUA 電腦控制）────────────────────────────────────────────────

export const computer = {
  screenshot: () =>
    req<{ image: string; timestamp: number }>("/computer/screenshot"),

  click: (x: number, y: number, button = "left") =>
    req<{ ok: boolean; screenshot: string }>("/computer/click", {
      method: "POST", body: JSON.stringify({ x, y, button })
    }),

  type: (text: string) =>
    req<{ ok: boolean }>("/computer/type", {
      method: "POST", body: JSON.stringify({ text })
    }),

  key: (key: string) =>
    req<{ ok: boolean; screenshot: string }>("/computer/key", {
      method: "POST", body: JSON.stringify({ key })
    }),

  scroll: (x: number, y: number, direction = "down", amount = 3) =>
    req<{ ok: boolean }>("/computer/scroll", {
      method: "POST", body: JSON.stringify({ x, y, direction, amount })
    }),

  open: (url: string) =>
    req<{ ok: boolean; screenshot: string }>("/computer/open", {
      method: "POST", body: JSON.stringify({ url })
    }),

  shell: (cmd: string) =>
    req<{ ok: boolean; output: string }>("/computer/shell", {
      method: "POST", body: JSON.stringify({ cmd })
    }),
};

export function streamComputer(
  task: string,
  onEvent: SSECallback,
  signal?: AbortSignal,
  maxSteps = 20
): void {
  getValidToken().then(tok => {
    fetch(`${BASE}/computer/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ task, max_steps: maxSteps }),
      signal,
    }).then(async (res) => {
      if (!res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try { onEvent(JSON.parse(line.slice(6))); } catch {}
          }
        }
      }
    }).catch((e) => { if (e.name !== "AbortError") onEvent({ type: "error", message: e.message }); });
  });
}

// ─── File ─────────────────────────────────────────────────────────────────

// 手動組 multipart/form-data：固定 boundary + 明確 Content-Type，避免 Tauri plugin-http
// 送 FormData 時 body 邊界與標頭邊界不一致導致後端「Did not find boundary character」400。
async function buildMultipart(file: File, fields: Record<string, string>): Promise<{ body: Uint8Array; contentType: string }> {
  const boundary = "----xchatBoundary" + Math.random().toString(16).slice(2) + Date.now().toString(16);
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const [k, v] of Object.entries(fields)) {
    chunks.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  chunks.push(enc.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
    `Content-Type: ${file.type || "application/octet-stream"}\r\n\r\n`
  ));
  chunks.push(fileBytes);
  chunks.push(enc.encode(`\r\n--${boundary}--\r\n`));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const body = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { body.set(c, off); off += c.length; }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

export const files = {
  upload: async (file: File) => {
    const { body, contentType } = await buildMultipart(file, {});
    return req<{ data: { file_id: string; file_name: string; extracted_text: string } }>(
      "/files/upload", { method: "POST", body: body as unknown as BodyInit, headers: { "Content-Type": contentType } }
    );
  },
  ask: (fileId: string, question: string) =>
    req<{ data: { answer: string } }>(`/files/files/${fileId}/ask`, {
      method: "POST", body: JSON.stringify({ question })
    }),
  // 列出此知識庫已上傳的檔案
  list: () => req<{ data: { items: KBFile[] } }>("/files/files"),
  // 批次刪除（單選=1個、多選=多個）；連動清向量+原檔+記錄
  batchDelete: (fileIds: string[]) =>
    req<{ data: { deleted: string[]; missing: string[]; count: number }; message?: string }>(
      "/files/files/batch-delete", { method: "POST", body: JSON.stringify({ file_ids: fileIds }) }),
  // 檢視某檔實際入庫的切片內容（圖片=視覺描述/OCR）
  chunks: (fileId: string) =>
    req<{ data: { file_id: string; file_name: string; mime_type?: string; chunk_count: number; chunks: FileChunk[]; extracted_text?: string } }>(
      `/files/files/${fileId}/chunks`),
};

export interface FileChunk {
  chunk_idx: number;
  content: string;
  source_type?: string;
  local_path?: string | null;
}

export interface KBFile {
  file_id: string;
  file_name: string;
  size_bytes?: number;
  mime_type?: string;
  page_count?: number | null;
  text_length?: number;
  uploaded_at?: string | null;
}

// ─── 本地優先知識庫（原檔留本機，只索引向量）────────────────────────────────
export interface LocalDoc {
  local_path: string;
  file_name: string;
  file_hash: string;
  chunks: number;
  indexed_at: string | null;
}
export const local = {
  // 上傳檔案內容做 OCR+embedding；原始位元組過手即丟，只存向量並標記 local_path
  ingest: async (file: File, localPath: string, fileHash: string) => {
    const { body, contentType } = await buildMultipart(file, { local_path: localPath, file_hash: fileHash });
    return req<{ data: { local_path: string; file_name: string; chunks: number; file_hash: string; extracted_text?: string }; message?: string }>(
      "/files/local/ingest", { method: "POST", body: body as unknown as BodyInit, headers: { "Content-Type": contentType } }
    );
  },
  list: () => req<{ data: { items: LocalDoc[] } }>("/files/local"),
  hashes: () => req<{ data: { hashes: Record<string, string> } }>("/files/local/hashes"),
  remove: (localPath: string) =>
    req<{ data: { local_path: string }; message?: string }>("/files/local", {
      method: "DELETE", body: JSON.stringify({ local_path: localPath }),
    }),
};

// ─── 排程任務（xChat Work — scheduler 服務）────────────────────────────────
export interface ScheduledTask {
  task_id: string;
  name: string;
  cron_expr: string;
  action_type: "prompt" | "script" | "office";
  payload: Record<string, unknown>;
  enabled: boolean;
  next_run: string | null;
  last_run: string | null;
  created_at: string | null;
}
export interface ScheduledRun {
  run_id: string;
  task_id: string;
  task_name?: string;
  started_at: string | null;
  finished_at: string | null;
  status: string;
  output: string;
}
export const scheduler = {
  list: () => req<{ data: { items: ScheduledTask[] } }>("/scheduler/tasks"),
  create: (t: { name: string; cron_expr: string; action_type: string; payload: Record<string, unknown>; enabled?: boolean; notify?: boolean; post_to_conv?: boolean }) =>
    req<{ data: ScheduledTask; message?: string }>("/scheduler/tasks", { method: "POST", body: JSON.stringify(t) }),
  update: (taskId: string, patch: Record<string, unknown>) =>
    req<{ data: ScheduledTask; message?: string }>(`/scheduler/tasks/${taskId}`, { method: "PUT", body: JSON.stringify(patch) }),
  remove: (taskId: string) =>
    req<{ message?: string }>(`/scheduler/tasks/${taskId}`, { method: "DELETE" }),
  runNow: (taskId: string) =>
    req<{ data: ScheduledRun; message?: string }>(`/scheduler/tasks/${taskId}/run-now`, { method: "POST" }),
  runs: (taskId: string) =>
    req<{ data: { items: ScheduledRun[] } }>(`/scheduler/tasks/${taskId}/runs`),
  unread: () =>
    req<{ data: { count: number; items: { run_id: string; task_name: string; status: string; preview: string }[] } }>("/scheduler/unread"),
  markRead: (runIds?: string[]) =>
    req<{ data: { marked: number } }>("/scheduler/runs/read", { method: "POST", body: JSON.stringify(runIds ? { run_ids: runIds } : {}) }),
};

// ─── Agent 動作前批准 ───────────────────────────────────────────────────────
export const agents = {
  approve: (approvalId: string, approved: boolean) =>
    req<{ data: { matched: boolean } }>("/agents/approve", { method: "POST", body: JSON.stringify({ approval_id: approvalId, approved }) }),
  // 桌面/瀏覽器代理動作前批准
  approveComputer: (approvalId: string, approved: boolean) =>
    req<{ ok: boolean }>("/computer/approve", { method: "POST", body: JSON.stringify({ approval_id: approvalId, approved }) }),
};

export const API_BASE = BASE;

// ─── LLM Wiki 條目（後端：file 服務 /wiki/*）────────────────────────────────
export interface WikiPageSummary {
  slug: string;
  title: string;
  summary: string;
  key_facts_count: number;
  sources_count: number;
  related: string[];
  updated_at: string | null;
}
export interface WikiPageFull {
  slug: string;
  title: string;
  summary: string;
  key_facts: string[];
  sources: { file_id: string; file_name: string }[];
  related: string[];
  created_at: string | null;
  updated_at: string | null;
}
export interface NotebookSummary {
  name: string;
  description: string;
  page_count: number;
  created_at: string | null;
  updated_at: string | null;
  last_page_updated: string | null;
}
export interface WikiLintReport {
  summary: string;
  contradictions: { slugs: string[]; issue: string }[];
  orphans: string[];
  missing_links: { from: string; should_relate_to: string; reason: string }[];
}
const nbq = (notebook?: string) => (notebook && notebook !== "default" ? `?notebook=${encodeURIComponent(notebook)}` : "");
export const wiki = {
  // ─── 條目 CRUD（per notebook）
  list: (notebook?: string) =>
    req<{ data: { notebook: string; count: number; pages: WikiPageSummary[] } }>(`/files/wiki/${nbq(notebook)}`),
  get: (slug: string, notebook?: string) =>
    req<{ data: WikiPageFull }>(`/files/wiki/${encodeURIComponent(slug)}${nbq(notebook)}`),
  update: (slug: string, patch: Partial<Pick<WikiPageFull, "title" | "summary" | "key_facts" | "related">>, notebook?: string) =>
    req<{ data: WikiPageFull; message?: string }>(`/files/wiki/${encodeURIComponent(slug)}${nbq(notebook)}`, {
      method: "PUT", body: JSON.stringify(patch),
    }),
  remove: (slug: string, notebook?: string) =>
    req<{ data: { slug: string }; message?: string }>(`/files/wiki/${encodeURIComponent(slug)}${nbq(notebook)}`, {
      method: "DELETE",
    }),
  // ─── lint / ingest / export per notebook
  lint: (notebook?: string) =>
    req<{ data: { notebook: string; report: WikiLintReport; pages_examined: number } }>(
      `/files/wiki/lint${nbq(notebook)}`, { method: "POST" }),
  ingest: (fileId: string, notebook?: string) =>
    req<{ data: { file: string; notebook: string; applied: { slug: string; title: string; created: boolean }[]; count: number }; message?: string }>(
      `/files/wiki/ingest${nbq(notebook)}`, { method: "POST", body: JSON.stringify({ file_id: fileId }) }),
  // ─── notebook 管理
  notebooks: {
    list: () =>
      req<{ data: { notebooks: NotebookSummary[]; count: number } }>("/files/wiki/notebooks"),
    create: (name: string, description?: string) =>
      req<{ data: NotebookSummary; message?: string }>("/files/wiki/notebooks", {
        method: "POST", body: JSON.stringify({ name, description: description || "" }),
      }),
    rename: (oldName: string, newName: string) =>
      req<{ data: { old: string; new: string; pages_moved: number }; message?: string }>(
        `/files/wiki/notebooks/${encodeURIComponent(oldName)}`,
        { method: "PUT", body: JSON.stringify({ name: newName }) }),
    remove: (name: string) =>
      req<{ data: { name: string; pages_deleted: number }; message?: string }>(
        `/files/wiki/notebooks/${encodeURIComponent(name)}`, { method: "DELETE" }),
  },
};
