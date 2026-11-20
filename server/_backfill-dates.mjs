// 一次性脚本：用改进后的日期解析逻辑，回填缺失 published_at 的文章
// 使用前必须先停掉 dev 服务，避免内存态与 data.json 冲突
import { loadStore, getArticles, updateArticle } from "./lib/store.mjs";
import { fetchAndExtract } from "./lib/extractors.mjs";

// store 不会在 import 时自动加载（只有服务启动时才调），必须先显式载入
loadStore();

const targets = getArticles().filter((a) => !a.published_at && a.source_url);
console.log(`待回填（所有分类，无发布时间）: ${targets.length}\n`);

let ok = 0;
let stillNone = 0;
let failed = 0;

for (const a of targets) {
  const tag = `[${a.category}] ${a.title.slice(0, 46)}`;
  try {
    const ex = await fetchAndExtract(a.source_url);
    if (ex.published_at) {
      updateArticle(a.id, { published_at: ex.published_at });
      console.log(`  ✓ ${ex.published_at.slice(0, 10)}  ${tag} — ${a.source_name || ""}`);
      ok++;
    } else {
      console.log(`  - 仍无日期  ${tag} — ${a.source_name || ""}`);
      stillNone++;
    }
  } catch (e) {
    console.log(`  ✗ 失败 ${e?.name || "Error"}  ${tag} — ${String(e?.message || e).slice(0, 40)}`);
    failed++;
  }
}

console.log(`\n完成: 回填成功 ${ok} / 仍无日期 ${stillNone} / 抓取失败 ${failed}`);
// 等待 scheduleSave 的防抖落盘
await new Promise((r) => setTimeout(r, 2500));
console.log("DONE");
