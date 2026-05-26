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

// ─── 圖表（甜甜圈 / 長條 / 折線，免依賴、SVG 自繪）──────────────────────────────
const CHART_COLORS = ["#4f8cff","#34c759","#ff9f0a","#ff375f","#bf5af2","#5ac8fa","#ffd60a","#30d158","#ff6482","#64d2ff","#a78bfa","#ffb340","#8e8e93"];

function ChartBlock({ code }: { code: string }) {
  let spec: { type?: string; title?: string; data?: Array<{ label: string; value: number }> };
  try { spec = JSON.parse(code); } catch { return <CodeBlock lang="chart" code={code} />; }
  const type = (spec.type || "bar").toLowerCase();
  const data = (spec.data || []).filter((d) => d && typeof d.value === "number" && isFinite(d.value));
  if (!data.length) return <div style={{ color: "var(--text3)", padding: 12 }}>（圖表無資料）</div>;
  const fmt = (n: number) => n.toLocaleString();
  const wrap: React.CSSProperties = { background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 12, padding: 14, margin: "10px 0" };
  const titleEl = spec.title ? <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "var(--text2)" }}>{spec.title}</div> : null;

  if (type === "pie" || type === "donut") {
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    const R = 80, r = type === "donut" ? 46 : 0, cx = 100, cy = 100;
    let acc = 0;
    const arcs = data.map((d, i) => {
      const a0 = (acc / total) * 2 * Math.PI - Math.PI / 2; acc += d.value;
      const a1 = (acc / total) * 2 * Math.PI - Math.PI / 2;
      const x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0);
      const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = r > 0
        ? `M${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} L${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} A${r},${r} 0 ${large} 0 ${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} Z`
        : `M${cx},${cy} L${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} Z`;
      return <path key={i} d={p} fill={CHART_COLORS[i % CHART_COLORS.length]} />;
    });
    return (
      <div style={wrap}>{titleEl}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
          <svg viewBox="0 0 200 200" width="180" height="180" style={{ flexShrink: 0 }}>{arcs}</svg>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, minWidth: 180 }}>
            {data.map((d, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: CHART_COLORS[i % CHART_COLORS.length], flexShrink: 0 }} />
                <span style={{ color: "var(--text2)", flex: 1 }}>{d.label}</span>
                <span style={{ color: "var(--text3)" }}>{fmt(d.value)}（{((d.value / total) * 100).toFixed(1)}%）</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (type === "line") {
    const max = Math.max(...data.map((d) => d.value)) || 1;
    const W = 380, H = 170, pad = 30;
    const pts = data.map((d, i) => {
      const x = pad + (W - 2 * pad) * (data.length === 1 ? 0.5 : i / (data.length - 1));
      const y = H - pad - (H - 2 * pad) * (d.value / max);
      return [x, y] as const;
    });
    return (
      <div style={wrap}>{titleEl}
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W }}>
          <polyline fill="none" stroke="#4f8cff" strokeWidth="2" points={pts.map((p) => p.join(",")).join(" ")} />
          {pts.map(([x, y], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r="3" fill="#4f8cff" />
              <text x={x} y={y - 8} textAnchor="middle" fontSize="9" fill="var(--text2)">{fmt(data[i].value)}</text>
              <text x={x} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--text3)">{data[i].label}</text>
            </g>
          ))}
        </svg>
      </div>
    );
  }

  // bar（水平長條）
  const max = Math.max(...data.map((d) => d.value)) || 1;
  return (
    <div style={wrap}>{titleEl}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span style={{ width: 110, textAlign: "right", color: "var(--text2)", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</span>
            <div style={{ flex: 1, background: "var(--bg3)", borderRadius: 4, height: 18, position: "relative" }}>
              <div style={{ width: `${((d.value / max) * 100).toFixed(1)}%`, background: CHART_COLORS[i % CHART_COLORS.length], height: "100%", borderRadius: 4, minWidth: 2 }} />
            </div>
            <span style={{ width: 90, color: "var(--text3)", flexShrink: 0 }}>{fmt(d.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
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
        if (lang === "chart") return <ChartBlock code={code} />;
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
