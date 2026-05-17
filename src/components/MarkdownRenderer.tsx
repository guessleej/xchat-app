import React, { useState, useEffect, useRef, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import type { Components } from "react-markdown";

// ─── 代碼塊（語言標籤 + 一鍵複製）────────────────────────────────────────────
function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });

  return (
    <div className="code-block">
      <div className="code-block__header">
        <span className="code-block__lang">{lang || "text"}</span>
        <button className="code-block__copy" onClick={copy}>
          {copied ? "✓ 已複製" : "複製"}
        </button>
      </div>
      <pre className="code-block__pre">
        <code className={lang ? `language-${lang}` : ""}>{code}</code>
      </pre>
    </div>
  );
}

// ─── Mermaid 圖表（動態載入）─────────────────────────────────────────────────
function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string>("");
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, theme: "dark" });
      mermaid
        .render(`mermaid-${Math.random().toString(36).slice(2)}`, code)
        .then(({ svg: s }) => { if (!cancelled) setSvg(s); })
        .catch((e) => { if (!cancelled) setErr(String(e)); });
    });
    return () => { cancelled = true; };
  }, [code]);

  if (err) return <pre className="code-block__pre" style={{ color: "var(--red)" }}>{err}</pre>;
  if (!svg) return <div className="mermaid-loading">圖表載入中...</div>;
  return <div className="mermaid-container" dangerouslySetInnerHTML={{ __html: svg }} />;
}

// ─── 深度思考塊（可展開/收合）────────────────────────────────────────────────
export function ThinkingBlock({ content, streaming }: { content: string; streaming?: boolean }) {
  const [open, setOpen] = useState(!!streaming);
  useEffect(() => { if (!streaming) setOpen(false); }, [streaming]);

  return (
    <div className="thinking-block">
      <button className="thinking-block__toggle" onClick={() => setOpen((v) => !v)}>
        <span className="thinking-block__icon">{open ? "▾" : "▸"}</span>
        {streaming ? <span className="thinking-block__pulse">思考中...</span> : "深度思考過程"}
      </button>
      {open && <pre className="thinking-block__content">{content}</pre>}
    </div>
  );
}

// 從 React children 遞迴取出純文字（避免 [object Object] bug）
function childrenToText(c: unknown): string {
  if (c == null || typeof c === "boolean") return "";
  if (typeof c === "string" || typeof c === "number") return String(c);
  if (Array.isArray(c)) return c.map(childrenToText).join("");
  if (typeof c === "object" && c !== null && "props" in c) {
    return childrenToText((c as { props?: { children?: unknown } }).props?.children);
  }
  return "";
}

// ─── react-markdown components 覆寫 ─────────────────────────────────────────
function buildComponents(): Components {
  return {
    code({ className, children, ...props }) {
      const lang = /language-(\w+)/.exec(className || "")?.[1] ?? "";
      const codeText = childrenToText(children);
      const isBlock = !props.style && codeText.includes("\n");
      const code = codeText.replace(/\n$/, "");

      if (isBlock || className) {
        if (lang === "mermaid") return <MermaidBlock code={code} />;
        return <CodeBlock lang={lang} code={code} />;
      }
      return <code className="inline-code" {...props}>{children}</code>;
    },
    table({ children }) {
      return <div className="table-wrapper"><table>{children}</table></div>;
    },
    // Electron: 外部連結使用 xchatAPI.openExternal，web 版 fallback 用 target="_blank"
    a({ href, children }) {
      return (
        <a href={href} onClick={(e) => {
          if (href && window.xchatAPI?.openExternal) {
            e.preventDefault();
            window.xchatAPI.openExternal(href);
          }
        }} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    },
    img({ src, alt }) {
      return <img src={src} alt={alt} loading="lazy" className="md-image" />;
    },
  };
}

const MD_COMPONENTS = buildComponents();

// ─── 主 Markdown 渲染器 ──────────────────────────────────────────────────────
interface MarkdownRendererProps {
  text: string;
  streaming?: boolean;
  reasoning?: string;
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  text, streaming, reasoning,
}: MarkdownRendererProps) {
  return (
    <div className="markdown">
      {reasoning && <ThinkingBlock content={reasoning} streaming={streaming && !text} />}
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [rehypeHighlight, { detect: true, ignoreMissing: true }],
          rehypeKatex,
          rehypeRaw,
        ]}
        components={MD_COMPONENTS}
      >
        {text}
      </ReactMarkdown>
      {streaming && !reasoning && <span className="streaming-cursor">▋</span>}
    </div>
  );
});
