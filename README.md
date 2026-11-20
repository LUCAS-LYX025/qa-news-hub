# QA News Hub · 测试工程师资讯平台

> 一个面向测试 / QA 工程师的资讯聚合与内容再创作工作台。自动从订阅源抓取优质文章，做质量评分、去重、摘要与分类，并提供一套完整的「二创改写 → 原创度查重 → 署名 → 多平台发布」流水线。

<p align="center">
  <img src="https://img.shields.io/badge/React-18-blue" alt="React 18">
  <img src="https://img.shields.io/badge/Vite-6-646CFF" alt="Vite 6">
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6" alt="TypeScript">
  <img src="https://img.shields.io/badge/Node.js-18%2B-339933" alt="Node.js">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT">
</p>

---

## 它能做什么

**资讯聚合**

- 从订阅源自动采集文章，内置 20 个推荐源（TesterHome、InfoQ、美团技术、Anthropic Engineering、Simon Willison、LangChain、掘金 AI 等）
- 支持单链接抓取、批量抓取、订阅源定时采集三种方式
- URL 归一化去重（剥离 `utm_*` / `spm` 等追踪参数），质量门槛拦截（低于 61 分不入库），列表页识别，避免把导航页当文章收进来
- 多维度筛选：分类、关键词搜索、质量分过滤、时间排序

**内容理解**

- 自动摘要（抽取式）、关键词提取、质量评分
- 中文判定 + 免费在线翻译（Google / MyMemory 自动回退，零配置可用；也可选接本地 Ollama 大模型）

**二创工作台**（核心亮点）

- AI 改写：三种强度（轻度 / 中度 / 深度），支持写作风格、模板、保护词（代码 / URL / 版本号自动保留）
- 多版本管理：改写结果可保存为多个版本，随时切换激活
- 原创度查重：字符二元组 Jaccard 相似度，量化改写效果
- 来源署名：一键生成 Markdown 引用块，合规标注原文出处
- 多平台预览：CSDN / 微信公众号预览，支持复制「含来源署名的发布稿」

---

## 技术栈

| 层次 | 技术 |
|------|------|
| 前端 | React 18 · TypeScript · Vite 6 · Ant Design 5 · Tailwind CSS 3 · React Router 7（HashRouter）· zustand |
| 后端 | Node.js 原生 `http` · cheerio（HTML 解析）· 内存存储 + JSON 文件持久化 |
| 采集 | 平台专属解析器 + 通用正文提取 + 链接抽取 + 多策略日期解析 |
| 智能 | 本地启发式改写 / 可选本地大模型（Ollama 兼容 `/v1/chat/completions`）/ 免费在线翻译回退 |

> 设计取舍：项目定位是**本地演示与工作流验证**，所以用内存 + JSON 文件而非数据库，零依赖即可跑起来。大规模部署时可替换为数据库。

---

## 快速开始

### 环境要求

- Node.js 18+（推荐 20 / 22）
- npm

### 启动

```bash
# 1. 克隆
git clone https://github.com/LUCAS-LYX025/qa-news-hub.git
cd qa-news-hub

# 2. 安装依赖
npm install

# 3. 启动（开发模式，Vite 中间件同时提供前端与 API）
npm run dev
```

打开 <http://localhost:5173>，使用演示账号登录：

```
用户名：admin-demo
密码：1234567890
```

其他命令：

```bash
npm run build          # 类型检查 + 生产构建
npm run server         # 独立后端服务（http://localhost:8787）
npm run check          # TypeScript 类型检查
node server/smoke-test.mjs   # 冒烟测试（需服务已启动）
```

### macOS 一键启动（可选）

项目根目录提供两个双击脚本：

- `start-qa-hub.command` — 日常启动，终端里选翻译模式（① 免费翻译 ② 本地 Ollama），自动装依赖并拉起服务；已做端口检测，重复双击不会开第二个实例
- `enable-autostart.command` — 只跑一次，注册 `launchd` 开机自启 + 崩溃自动拉起（由系统托管，服务不再「一挂不起」）

底层由 `dev-runner.sh` 做自愈监督：端口空了就拉起 vite，进程退出后 5 秒内自动重启。

---

## 首次使用建议

仓库**不包含采集数据文件**（`server/data.json` 已加入 `.gitignore`）。首次启动时系统会自动加载内置种子文章，你能立刻看到界面效果。想填充真实内容：

1. 进入「订阅源」页面 → 一键添加推荐源（约 20 个）
2. 对每个源点击「立即采集」，或等待后台调度器按间隔自动跑
3. 回到「资讯流」查看采集结果（仅 61 分及以上入库）

---

## 目录结构

```
qa-news-hub/
├── src/                          # 前端
│   ├── pages/                    # 页面：资讯流 / 详情 / 二创工作台 / 订阅源 / 分类 / 投稿
│   ├── api/client.ts             # API 客户端（自动解包 entity）
│   └── auth/store.ts             # 登录态（zustand）
├── server/
│   ├── index.mjs                 # 独立后端入口
│   ├── vite-plugin.mjs           # 开发模式下把 API 挂进 Vite
│   ├── lib/
│   │   ├── api.mjs               # REST 路由、采集调度、抓取入库拦截
│   │   ├── extractors.mjs        # 正文 / 标题 / 日期 / 链接抽取
│   │   ├── analyze.mjs           # 质量评分、摘要、关键词、去重、改写、查重、署名
│   │   └── store.mjs             # 内存状态 + JSON 持久化、版本管理
│   ├── data/recommended-sources.json  # 推荐订阅源
│   └── smoke-test.mjs            # 冒烟测试
├── start-qa-hub.command          # macOS 双击启动器
├── enable-autostart.command      # macOS 开机自启注册器
└── dev-runner.sh                 # 自愈监督器
```

---

## API 概览

所有接口前缀为 `/api/v1/qa-news`，成功响应统一包裹在 `entity` 字段中，失败返回 `{ detail: { message, code } }`。

```
POST   /auth/login                     登录（token 在 entity.access_token）
GET    /categories /features           分类与能力探测
GET    /articles                       资讯流（分类/搜索/排序/质量过滤）
POST   /articles/crawl                 单链接抓取
POST   /articles/crawl-batch           批量抓取
GET    /articles/:id                   文章详情
POST   /articles/:id/summarize         重新摘要
POST   /articles/:id/rescore           重新评分
POST   /articles/:id/rewrite           AI 改写
POST   /articles/:id/translate         翻译为中文
POST   /articles/:id/originality       原创度 / 查重
GET|POST   /articles/:id/versions      改写版本管理
GET|POST   /articles/:id/attribution   来源署名
GET    /subscriptions                  订阅源列表
POST   /subscriptions                  新增订阅
POST   /subscriptions/:id/run          立即采集
```

完整路由见 `server/lib/api.mjs`。

---

## 配置

复制 `.env.example` 为 `.env` 后按需修改：

| 变量 | 说明 |
|------|------|
| `VITE_API_BASE_URL` | API 前缀，开发默认 `/api/v1/qa-news` |
| `LOCAL_LLM_URL` | 可选，本地大模型 OpenAI 兼容端点（如 Ollama `http://localhost:11434/v1`），配置后改写能力更强 |
| `DISABLE_FREE_TRANSLATE=1` | 可选，关闭免费在线翻译 |

翻译默认走免费在线服务，无需任何 Key 即可使用；可选接入 DeepL / 百度翻译（见 `.env.example`）。

---

## 说明与限制

- **数据持久化**：内存 + JSON 文件，适合本地演示；并发写入通过去重兜底与调度器文件锁防护，但不适合高并发生产环境。
- **抓取依赖目标站点 HTML**：站点改版或反爬可能导致个别源失效；采集失败会在订阅源状态里体现。
- **改写能力**：默认本地启发式（确定性、保护代码 / URL / 版本号），对短篇或术语密集中文的相似度下降有限；接入本地大模型可显著改善。转载内容请务必保留来源署名，尊重版权。
- **登录为演示用途**：账号信息硬编码在后端，请勿直接暴露到公网作为真实认证使用。

---

## License

[MIT](LICENSE) © 2026 LUCAS-LYX025
