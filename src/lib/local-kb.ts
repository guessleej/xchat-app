/**
 * 本地優先知識庫 — Tauri 端輔助
 * 使用者選一個本機資料夾，原始檔案永遠留在自己電腦；
 * 這裡只負責：挑資料夾、遞迴掃描支援的檔、讀位元組、算雜湊、開原檔。
 * 實際 OCR/embedding 由後端 /files/local/ingest 處理，僅回傳向量索引結果。
 */

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// 與後端 SUPPORTED_TYPES 對齊的副檔名 → MIME
const EXT_MIME: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export interface ScannedFile {
  path: string; // 絕對路徑（本機）
  name: string; // 檔名
  mime: string;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** 跳出原生資料夾選取對話框，回傳所選資料夾絕對路徑（取消回 null）。 */
export async function pickFolder(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const res = await open({ directory: true, multiple: false, title: "選擇要納入知識庫的本機資料夾" });
  if (!res || Array.isArray(res)) return (Array.isArray(res) ? res[0] : null) ?? null;
  return res;
}

/** 遞迴掃描資料夾，回傳所有支援格式的檔案（絕對路徑 + MIME）。 */
export async function scanFolder(dir: string): Promise<ScannedFile[]> {
  const { readDir } = await import("@tauri-apps/plugin-fs");
  const sep = dir.includes("\\") ? "\\" : "/";
  const out: ScannedFile[] = [];

  async function walk(d: string) {
    let entries: { name: string; isDirectory: boolean; isFile: boolean }[] = [];
    try {
      entries = (await readDir(d)) as typeof entries;
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.name || e.name.startsWith(".")) continue; // 跳過隱藏檔
      const full = d.endsWith(sep) ? d + e.name : d + sep + e.name;
      if (e.isDirectory) {
        await walk(full);
      } else if (e.isFile) {
        const mime = EXT_MIME[extOf(e.name)];
        if (mime) out.push({ path: full, name: e.name, mime });
      }
    }
  }

  await walk(dir);
  return out;
}

/** 讀取檔案位元組。 */
export async function readBytes(path: string): Promise<Uint8Array> {
  const { readFile } = await import("@tauri-apps/plugin-fs");
  return await readFile(path);
}

/** 以 SHA-256 計算內容雜湊（hex），供同步時判斷檔案是否變更。 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", ab);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 把掃描到的檔案轉成可上傳的 File 物件（含內容與 MIME）。 */
export async function toFile(sf: ScannedFile): Promise<File> {
  const bytes = await readBytes(sf.path);
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new File([ab], sf.name, { type: sf.mime });
}

/** 用系統預設程式開啟本機原檔。 */
export async function openLocalPath(path: string): Promise<void> {
  const { open } = await import("@tauri-apps/plugin-shell");
  await open(path);
}
