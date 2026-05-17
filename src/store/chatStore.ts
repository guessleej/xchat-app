import { create } from "zustand";
import { db } from "./db";

function newUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  streaming?: boolean;
  toolCalls?: string[];
  images?: string[];
  timestamp: number;
  taskId?: string;
  toolType?: "ppt" | "website" | "document" | "table" | "code";
  downloadName?: string;
  previewHtml?: string;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  created_at: number;
  updated_at: number;
  pinned: boolean;
}

interface ChatState {
  convId: string;
  conversations: Conversation[];
  messages: Message[];
  loading: boolean;
  taskStatus: string;

  newConversation: () => void;
  loadConversation: (id: string) => Promise<void>;
  loadHistory: () => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;

  addUserMessage: (content: string, images?: string[]) => string;
  addAssistantMessage: () => string;
  appendContent: (id: string, chunk: string) => void;
  appendReasoning: (id: string, chunk: string) => void;
  addToolCall: (id: string, tool: string) => void;
  attachToolResult: (id: string, info: { taskId: string; toolType: Message["toolType"]; downloadName?: string; previewHtml?: string }) => void;
  finishMessage: (id: string) => Promise<void>;
  // 直接寫入 DB（不經過記憶體 messages）— 用於背景任務寫到原始對話
  saveAssistantToDb: (params: {
    messageId: string; convId: string; content: string;
    taskId?: string; toolType?: Message["toolType"];
    downloadName?: string; previewHtml?: string; timestamp?: number;
    streaming?: boolean;
  }) => Promise<void>;
  persistConversationFor: (convId: string, title: string, tool?: string) => Promise<void>;

  setLoading: (v: boolean) => void;
  setTaskStatus: (s: string) => void;
  persistConversation: (title?: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set, get) => ({
  convId: newUuid(),
  conversations: [],
  messages: [],
  loading: false,
  taskStatus: "",

  newConversation() {
    set({ convId: newUuid(), messages: [], taskStatus: "" });
  },

  async loadConversation(id) {
    const msgs = await db.getMessages(id);
    set({
      convId: id,
      messages: msgs.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        reasoning: m.reasoning,
        toolCalls: m.tool_calls,
        images: m.images,
        timestamp: m.timestamp,
        taskId: m.task_id,
        toolType: m.tool_type,
        downloadName: m.download_name,
        previewHtml: m.preview_html,
        streaming: m.streaming,
      })),
    });
  },

  async loadHistory() {
    const convs = await db.listConversations();
    set({ conversations: convs });
  },

  async deleteConversation(id) {
    await db.deleteConversation(id);
    const convs = get().conversations.filter((c) => c.id !== id);
    set({ conversations: convs });
    if (get().convId === id) get().newConversation();
  },

  addUserMessage(content, images) {
    const id = newUuid();
    const msg: Message = { id, role: "user", content, images, timestamp: Date.now() };
    set((s) => ({ messages: [...s.messages, msg] }));
    db.saveMessage({
      id,
      conversation_id: get().convId,
      role: "user",
      content,
      images,
      timestamp: msg.timestamp,
    });
    return id;
  },

  addAssistantMessage() {
    const id = newUuid();
    const lastTs = get().messages[get().messages.length - 1]?.timestamp ?? 0;
    const msg: Message = {
      id, role: "assistant", content: "", streaming: true,
      timestamp: Math.max(Date.now(), lastTs + 1),
    };
    set((s) => ({ messages: [...s.messages, msg] }));
    return id;
  },

  appendContent(id, chunk) {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, content: m.content + chunk } : m
      ),
    }));
  },

  appendReasoning(id, chunk) {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, reasoning: (m.reasoning ?? "") + chunk } : m
      ),
    }));
  },

  addToolCall(id, tool) {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, toolCalls: [...(m.toolCalls ?? []), tool] } : m
      ),
    }));
  },

  attachToolResult(id, info) {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? {
          ...m, taskId: info.taskId, toolType: info.toolType,
          downloadName: info.downloadName, previewHtml: info.previewHtml,
        } : m
      ),
    }));
  },

  async finishMessage(id) {
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, streaming: false } : m)),
    }));
    const msg = get().messages.find((m) => m.id === id);
    if (msg) {
      await db.saveMessage({
        id,
        conversation_id: get().convId,
        role: "assistant",
        content: msg.content,
        reasoning: msg.reasoning,
        tool_calls: msg.toolCalls,
        timestamp: msg.timestamp,
        task_id: msg.taskId,
        tool_type: msg.toolType,
        download_name: msg.downloadName,
        preview_html: msg.previewHtml,
      });
    }
  },

  setLoading: (v) => set({ loading: v }),
  setTaskStatus: (s) => set({ taskStatus: s }),

  async saveAssistantToDb({ messageId, convId, content, taskId, toolType, downloadName, previewHtml, timestamp, streaming }) {
    await db.saveMessage({
      id: messageId,
      conversation_id: convId,
      role: "assistant",
      content,
      task_id: taskId,
      tool_type: toolType,
      download_name: downloadName,
      preview_html: previewHtml,
      timestamp: timestamp ?? Date.now(),
      streaming: streaming ?? false,
    });
    if (get().convId === convId) {
      const exists = get().messages.some((m) => m.id === messageId);
      if (exists) {
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === messageId ? { ...m, content, streaming: streaming ?? false,
              taskId, toolType, downloadName, previewHtml } : m
          ),
        }));
      } else {
        // 若記憶體中沒這個 id（已被切到別處又切回來），補上
        set((s) => ({
          messages: [...s.messages, {
            id: messageId, role: "assistant", content,
            streaming: streaming ?? false, timestamp: timestamp ?? Date.now(),
            taskId, toolType, downloadName, previewHtml,
          }],
        }));
      }
    }
  },

  async persistConversationFor(convId, title, tool) {
    const { conversations } = get();
    const existing = conversations.find((c) => c.id === convId);
    const conv: Conversation = {
      id: convId,
      title: existing?.title || title,
      model: tool || existing?.model || "chat",
      created_at: existing?.created_at ?? Date.now(),
      updated_at: Date.now(),
      pinned: existing?.pinned ?? false,
    };
    await db.saveConversation(conv);
    const rest = conversations.filter((c) => c.id !== convId);
    set({ conversations: [conv, ...rest] });
  },

  async persistConversation(title) {
    const { convId, messages, conversations } = get();
    const existing = conversations.find((c) => c.id === convId);
    const t = title ?? existing?.title ?? messages[0]?.content?.slice(0, 30) ?? "新對話";
    const conv: Conversation = {
      id: convId,
      title: t,
      model: "default",
      created_at: existing?.created_at ?? Date.now(),
      updated_at: Date.now(),
      pinned: existing?.pinned ?? false,
    };
    await db.saveConversation(conv);
    const rest = conversations.filter((c) => c.id !== convId);
    set({ conversations: [conv, ...rest] });
  },
}));
