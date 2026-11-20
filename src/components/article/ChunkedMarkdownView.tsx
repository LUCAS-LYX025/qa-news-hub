import { useEffect, useMemo, useState } from "react";
import MarkdownView from "./MarkdownView";

const CHUNK_SIZE = 5000;

function splitMarkdown(content: string) {
  const chunks: string[] = [];
  let buffer = "";
  let inCodeFence = false;

  for (const line of content.split("\n")) {
    const isFence = /^\s*```/.test(line);
    if (buffer && !inCodeFence && buffer.length + line.length + 1 > CHUNK_SIZE) {
      chunks.push(buffer);
      buffer = "";
    }
    buffer = buffer ? `${buffer}\n${line}` : line;
    if (isFence) inCodeFence = !inCodeFence;
  }
  if (buffer) chunks.push(buffer);
  return chunks.length ? chunks : [""];
}

/** 长文按段渲染，避免 react-markdown 一次解析整篇内容而阻塞页面。 */
export default function ChunkedMarkdownView({ content }: { content: string }) {
  const chunks = useMemo(() => splitMarkdown(content), [content]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => setActiveIndex(0), [content]);

  return (
    <div>
      <MarkdownView content={chunks[activeIndex]} />
      {chunks.length > 1 && (
        <div className="mt-3 flex items-center gap-2 text-sm">
          <button
            type="button"
            disabled={activeIndex === 0}
            onClick={() => setActiveIndex((index) => index - 1)}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-slate-600 hover:border-amber-400 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            上一段
          </button>
          <span className="text-slate-500">{activeIndex + 1} / {chunks.length}</span>
          <button
            type="button"
            disabled={activeIndex >= chunks.length - 1}
            onClick={() => setActiveIndex((index) => index + 1)}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-slate-600 hover:border-amber-400 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            下一段
          </button>
        </div>
      )}
    </div>
  );
}
