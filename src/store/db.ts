import { openDB, DBSchema, IDBPDatabase } from "idb";

interface XChatDB extends DBSchema {
  conversations: {
    key: string;
    value: {
      id: string;
      title: string;
      model: string;
      created_at: number;
      updated_at: number;
      pinned: boolean;
    };
    indexes: { by_updated: number };
  };
  messages: {
    key: string;
    value: {
      id: string;
      conversation_id: string;
      role: "user" | "assistant";
      content: string;
      reasoning?: string;
      tool_calls?: string[];
      images?: string[];
      timestamp: number;
      task_id?: string;
      tool_type?: "ppt" | "website" | "document" | "table" | "code";
      download_name?: string;
      preview_html?: string;
      streaming?: boolean;
    };
    indexes: { by_conv: string };
  };
}

let _db: IDBPDatabase<XChatDB> | null = null;

async function getDB(): Promise<IDBPDatabase<XChatDB>> {
  if (_db) return _db;
  _db = await openDB<XChatDB>("xchat-desktop-v1", 1, {
    upgrade(db) {
      const convStore = db.createObjectStore("conversations", { keyPath: "id" });
      convStore.createIndex("by_updated", "updated_at");
      const msgStore = db.createObjectStore("messages", { keyPath: "id" });
      msgStore.createIndex("by_conv", "conversation_id");
    },
  });
  return _db;
}

export const db = {
  async saveConversation(conv: XChatDB["conversations"]["value"]) {
    (await getDB()).put("conversations", conv);
  },

  async listConversations(): Promise<XChatDB["conversations"]["value"][]> {
    const all = await (await getDB()).getAllFromIndex("conversations", "by_updated");
    return all.reverse();
  },

  async deleteConversation(id: string) {
    const d = await getDB();
    const tx = d.transaction(["conversations", "messages"], "readwrite");
    await tx.objectStore("conversations").delete(id);
    const keys = await tx.objectStore("messages").index("by_conv").getAllKeys(id);
    for (const k of keys) tx.objectStore("messages").delete(k);
    await tx.done;
  },

  async saveMessage(msg: XChatDB["messages"]["value"]) {
    (await getDB()).put("messages", msg);
  },

  async deleteMessage(id: string) {
    (await getDB()).delete("messages", id);
  },

  async getMessages(convId: string): Promise<XChatDB["messages"]["value"][]> {
    const msgs = await (await getDB()).getAllFromIndex("messages", "by_conv", convId);
    return msgs.sort((a, b) => a.timestamp - b.timestamp);
  },

  async updateMessageContent(id: string, content: string, reasoning?: string) {
    const d = await getDB();
    const msg = await d.get("messages", id);
    if (!msg) return;
    msg.content = content;
    if (reasoning !== undefined) msg.reasoning = reasoning;
    await d.put("messages", msg);
  },
};
