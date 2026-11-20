import { useEffect, useRef, useState } from "react";
import { useParams, Link, useLocation } from "react-router-dom";
import { ArrowLeft, Copy, Sparkles, Save, Check, Trash2, FileText, Link2, ShieldCheck, Languages } from "lucide-react";
import { Card, Radio, Select, Input, Button, Tabs, Tag, Switch, Space, Empty, Alert, Divider, Popconfirm, Tooltip, message } from "antd";
import {
  fetchArticle,
  fetchVersions,
  rewriteArticleReq,
  translateArticleReq,
  createVersion,
  updateVersion,
  deleteVersion,
  activateVersion,
  checkOriginality,
  getAttribution,
  setAttribution,
  fetchFeatures,
  type Article,
  type ArticleVersion,
  type OriginalityResult,
  type AttributionResult,
} from "@/api/client";
import MarkdownView from "@/components/article/MarkdownView";
import ChunkedMarkdownView from "@/components/article/ChunkedMarkdownView";

const INTENSITY = [
  { label: "轻度润色", value: "light" },
  { label: "中度改写", value: "medium" },
  { label: "深度二创", value: "deep" },
];
const STYLES = [
  { label: "CSDN 人话改写", value: "csdn" },
  { label: "教程步骤风", value: "tutorial" },
  { label: "观点评论风", value: "opinion" },
  { label: "中性干货风", value: "dry" },
];
const CSDN_REWRITE_PROMPT = `你是一位长期写 CSDN 的技术博主。请把输入文章改写为一篇适合 CSDN 发布的中文技术文章。

目标：保留技术事实、数据、限制条件、链接、命令、版本号、代码块和代码语言标记；不得添加原文没有的测试结论、性能数据、使用体验、源码分析结论或社区反馈。第三方项目使用第三方视角，只有原文明确给出依据时才能写“我试了”或“我查看源码后发现”。

规则：去掉套话和机械连接词；不要逐句同义词替换，按“解决什么问题 → 核心机制 → 适用场景 → 如何上手 → 注意事项”重新组织；专业术语首次出现时附一句简短解释；复杂信息优先用表格或列表；保留代码语义；最多插入 3 处“> 配图建议：……”；第一行输出不标题党的 CSDN 风格标题。

输出：只输出完整 Markdown 成稿，第一行是“# 标题”；不输出改写说明；不确定的信息写“原文未说明”或省略。`;
const TEMPLATES = [
  { label: "无（保留原结构）", value: "" },
  { label: "背景-痛点-方案-踩坑-总结", value: "背景-痛点-方案-踩坑-总结" },
  { label: "是什么-为什么-怎么做", value: "是什么-为什么-怎么做" },
  { label: "问题-分析-结论", value: "问题-分析-结论" },
];
const LARGE_EDITOR_CONTENT = 12000;

const copy = (text: string, ok = "已复制到剪贴板") => {
  if (!text) return;
  navigator.clipboard?.writeText(text);
  message.success(ok);
};

/** 判断文本是否以中文为主（与后端 isMostlyChinese 口径一致） */
const isMostlyChinese = (s: string) => {
  const cjk = (s.match(/[\u4e00-\u9fff]/g) || []).length;
  const en = (s.match(/[A-Za-z]/g) || []).length;
  if (cjk + en === 0) return false;
  return cjk / (cjk + en) >= 0.4;
};

export default function RewriteWorkbenchPage() {
  const { id } = useParams();
  const location = useLocation();
  const [article, setArticle] = useState<Article | null>(null);
  const [versions, setVersions] = useState<ArticleVersion[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editorLoaded, setEditorLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [translationLoaded, setTranslationLoaded] = useState(false);
  const [showSourcePreview, setShowSourcePreview] = useState(false);
  const [showPublishPreview, setShowPublishPreview] = useState(false);
  const editAreaRef = useRef<HTMLTextAreaElement | null>(null);

  const [intensity, setIntensity] = useState("medium");
  const [style, setStyle] = useState("csdn");
  const [template, setTemplate] = useState("");
  const [protect, setProtect] = useState("");
  const [customPrompt, setCustomPrompt] = useState(CSDN_REWRITE_PROMPT);

  const [orig, setOrig] = useState<OriginalityResult | null>(null);
  const [att, setAtt] = useState<AttributionResult | null>(null);
  const [attForm, setAttForm] = useState({ author: "", url: "", note: "", declare_original: false });
  const [localLlm, setLocalLlm] = useState<boolean | null>(null);
  const [freeTranslate, setFreeTranslate] = useState<boolean | null>(null);

  const refresh = async () => {
    if (!id) return;
    const a = await fetchArticle(id);
    setArticle(a);
    const vs = await fetchVersions(id);
    setVersions(vs);
    const act = vs.find((v) => v.id === a.active_version) || vs[vs.length - 1];
    if (act) {
      setActiveId(act.id);
      setEditTitle(act.title);
      setEditContent(act.content.length > LARGE_EDITOR_CONTENT ? "" : act.content);
      setEditorLoaded(act.content.length <= LARGE_EDITOR_CONTENT);
    } else {
      // 长文不预填受控文本框，否则 React/Ant Design 会在进入页面时同步处理大量文本。
      setEditContent("");
      setEditTitle(a.title);
      setEditorLoaded(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    refresh().catch(() => {});
    getAttribution(id)
      .then((r) => {
        setAtt(r);
        setAttForm({
          author: r.attribution.author || "",
          url: r.attribution.url || "",
          note: r.attribution.note || "",
          declare_original: !!r.attribution.declare_original,
        });
      })
      .catch(() => {});
    fetchFeatures()
      .then((f) => {
        setLocalLlm(f.local_llm);
        setFreeTranslate(f.free_translate);
      })
      .catch(() => {
        setLocalLlm(null);
        setFreeTranslate(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!article) return <div className="text-center py-16 text-slate-400">加载中或文章不存在…</div>;

  const onRewrite = async () => {
    if (!article) return;
    const sourceLength = (article.content_md || article.content).length;
    if (localLlm === false && sourceLength > LARGE_EDITOR_CONTENT) {
      message.warning("当前文章较长，本地启发式改写会影响页面流畅度；请启动本地模型后再改写。");
      return;
    }
    setBusy("rewrite");
    try {
      await rewriteArticleReq(article.id, {
        intensity,
        style,
        protect: protect.split(/[\n,，]/).map((s) => s.trim()).filter(Boolean),
        template,
        custom_prompt: customPrompt,
      });
      message.success("AI 改写完成，已存为新版本");
      await refresh();
    } catch (e: any) {
      message.error(e?.message || "改写失败");
    } finally {
      setBusy(null);
    }
  };

  const onSaveVersion = async () => {
    if (!article || !editContent.trim()) {
      message.warning("版本内容不能为空");
      return;
    }
    setBusy("save");
    try {
      if (activeId) {
        await updateVersion(article.id, activeId, { title: editTitle, content: editContent });
        message.success("版本已更新");
      } else {
        const v = await createVersion(article.id, {
          title: editTitle || `${article.title}（手动改写）`,
          content: editContent,
        });
        setActiveId(v.id);
        message.success("已保存为新版本");
      }
      await refresh();
    } catch (e: any) {
      message.error(e?.message || "保存失败");
    } finally {
      setBusy(null);
    }
  };

  const onActivate = async (vid: string) => {
    if (!article) return;
    await activateVersion(article.id, vid);
    const v = versions.find((x) => x.id === vid);
    if (v) {
      setActiveId(vid);
      setEditTitle(v.title);
      setEditContent(v.content.length > LARGE_EDITOR_CONTENT ? "" : v.content);
      setEditorLoaded(v.content.length <= LARGE_EDITOR_CONTENT);
    }
    message.success("已设为当前版本");
  };

  const onDelete = async (vid: string) => {
    if (!article) return;
    await deleteVersion(article.id, vid);
    message.success("已删除该版本");
    await refresh();
  };

  const onCheck = async () => {
    if (!article) return;
    setBusy("orig");
    try {
      setOrig(await checkOriginality(article.id, editContent));
    } finally {
      setBusy(null);
    }
  };

  const onSaveAtt = async () => {
    if (!article) return;
    const r = await setAttribution(article.id, attForm);
    setAtt(r);
    message.success("署名信息已保存");
  };

  const isSourceChinese = isMostlyChinese(article.content_md || article.content || "");
  // 提示文案（中文文章不渲染翻译按钮，故此提示仅对外文生效）
  const translateTip =
    localLlm === true
    ? "使用本地大模型翻译为简体中文，载入编辑区供二创"
    : freeTranslate === false
    ? "翻译已关闭，需接入本地大模型（设置 LOCAL_LLM_URL）"
    : "使用免费在线翻译（Google）译为中文，载入编辑区供二创；英文原文已保留";

  const onTranslate = async () => {
    if (!article) return;
    setBusy("translate");
    try {
      const r = await translateArticleReq(article.id);
      if (r.engine === "llm" || r.engine === "free") {
        setEditContent(r.content);
        setEditTitle(`${article.title}（中文译本）`);
        setEditorLoaded(true);
        setTranslationLoaded(true);
        requestAnimationFrame(() => editAreaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
        message.success(
          r.engine === "free"
            ? "已用免费在线翻译译为中文，可继续二创；英文原文已保留"
            : "已用本地大模型翻译为中文，可继续二创；英文原文已保留",
        );
      } else if (r.engine === "skipped") {
        setTranslationLoaded(false);
        message.info(r.message || "原文已是中文，无需翻译");
      } else {
        setTranslationLoaded(false);
        message.warning(r.message || "翻译不可用：可接入本地大模型（设置 LOCAL_LLM_URL）或检查网络");
      }
    } catch (e: any) {
      message.error(e?.message || "翻译失败");
    } finally {
      setBusy(null);
    }
  };

  // 生成「可发布」Markdown：正文 + 来源署名引用块（发布到 CSDN/微信前直接整体复制）
  const onCopyPublish = () => {
    const body = editContent || article.content_md || article.content;
    const snippet = att?.snippet || "";
    const full = snippet ? `${body}\n\n${snippet}` : body;
    copy(full, "已复制含来源署名的发布稿（可直接粘贴到 CSDN / 公众号）");
  };

  const loadEditorContent = (content: string, title: string, ok: string) => {
    setEditContent(content);
    setEditTitle(title);
    setEditorLoaded(true);
    message.success(ok);
    requestAnimationFrame(() => editAreaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  return (
    <div>
      <Link to={`/article/${article.id}${location.search}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-amber-600 mb-4">
        <ArrowLeft className="h-4 w-4" /> 返回文章详情
      </Link>
      <h1 className="text-xl font-bold text-slate-900 mb-1">二创工作台</h1>
      <p className="text-sm text-slate-500 mb-5">
        对《{article.title}》进行复制改写或 AI 二创，支持多版本管理与来源署名。
        <Tag className="ml-2" color={isSourceChinese ? "blue" : "orange"}>
          {isSourceChinese ? "原文语言：中文" : "原文语言：外文"}
        </Tag>
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 原文 */}
        <Card title="原文（Markdown）" size="small" extra={<Space size={4}>
          <Button size="small" icon={<Copy />} onClick={() => copy(article.content_md || article.content, "原文 Markdown 已复制")}>复制原文</Button>
          <Button size="small" type="primary" ghost icon={<FileText />} onClick={() => loadEditorContent(article.content_md || article.content, `${article.title}（手动改写）`, "已载入编辑区，可直接手动改写")}>复制到编辑区</Button>
          {/* 中文文章不显示翻译按钮（无需翻译） */}
          {!isSourceChinese && (
            <Tooltip title={translateTip}>
              <Button
                size="small"
                type="primary"
                icon={<Languages />}
                loading={busy === "translate"}
                onClick={onTranslate}
              >翻译为中文</Button>
            </Tooltip>
          )}
        </Space>}>
          {(article.content_md || article.content).length > 12000 && !showSourcePreview ? (
            <Alert
              type="info"
              showIcon
              message="原文较长，已延迟预览以保持工作台流畅"
              action={<Button size="small" onClick={() => setShowSourcePreview(true)}>查看原文预览</Button>}
            />
          ) : (
            <div className="max-h-[60vh] overflow-y-auto">
              {(article.content_md || article.content).length > LARGE_EDITOR_CONTENT
                ? <ChunkedMarkdownView content={article.content_md || article.content} />
                : <MarkdownView content={article.content_md || article.content} />}
            </div>
          )}
        </Card>

        {/* 工作区 */}
        <div className="space-y-4">
          <Card title="AI 改写" size="small">
            <div className="space-y-3">
              {localLlm === false && (
                <Alert
                  type="info"
                  showIcon
                  className="text-xs"
                  message="当前为「本地启发式」改写"
                  description="公共在线翻译受网络和第三方服务限制。推荐启动本地 Ollama（qwen2.5:3b），完全免费、无需账号，首次下载后可离线翻译。"
                />
              )}
              {localLlm === true && (
                <Alert type="success" showIcon className="text-xs" message="已接入本地大模型，改写质量更佳" />
              )}
              <div>
                <div className="text-xs text-slate-500 mb-1">改写强度</div>
                <Radio.Group options={INTENSITY} value={intensity} onChange={(e) => setIntensity(e.target.value)} optionType="button" buttonStyle="solid" />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">风格预设</div>
                <Select className="w-full" options={STYLES} value={style} onChange={(value) => {
                  setStyle(value);
                  if (value === "csdn" && !customPrompt.trim()) setCustomPrompt(CSDN_REWRITE_PROMPT);
                }} size="small" />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">结构化模板（重命名顶层小标题）</div>
                <Select className="w-full" options={TEMPLATES} value={template} onChange={setTemplate} size="small" allowClear placeholder="不套用" />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">保护词（不改写，逗号/换行分隔：命令、API、版本号等）</div>
                <Input.TextArea rows={2} value={protect} onChange={(e) => setProtect(e.target.value)} placeholder="例如：Playwright, npm, kubectl" size="small" />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">自定义改写提示词（仅本地模型生效）</div>
                <Input.TextArea rows={8} value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} size="small" />
              </div>
              <Button type="primary" icon={<Sparkles />} loading={busy === "rewrite"} onClick={onRewrite} block>
                AI 改写并生成新版本
              </Button>
            </div>
          </Card>

          <Card title="手动改写 / 编辑（复制后可在此直接改）" size="small">
            <Input
              className="mb-2"
              size="small"
              placeholder="版本标题"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
            />
            <Input.TextArea
              ref={editAreaRef}
              rows={10}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              placeholder="在此粘贴内容，或点击左侧“复制到编辑区”按需载入原文"
            />
            {!editorLoaded && (
              <Alert
                className="mt-2"
                type="info"
                showIcon
                message={activeId ? "当前版本内容较长，尚未载入编辑框" : "原文尚未载入编辑框"}
                description="AI 改写不受影响；需要手动编辑时，点击左侧“复制到编辑区”。"
                action={activeId ? <Button size="small" onClick={() => {
                  const version = versions.find((item) => item.id === activeId);
                  if (version) loadEditorContent(version.content, version.title, "已载入当前版本，可直接编辑");
                }}>载入当前版本</Button> : undefined}
              />
            )}
            {translationLoaded && (
              <Alert
                className="mt-2"
                type="success"
                showIcon
                message="翻译结果已载入此编辑框"
                description="可直接修改；点击“存为新版本”后会保留译文。"
              />
            )}
            <div className="flex items-center justify-between mt-2">
              <Button icon={<Save />} loading={busy === "save"} onClick={onSaveVersion}>
                {activeId ? "保存修改" : "存为新版本"}
              </Button>
              <Button icon={<ShieldCheck />} loading={busy === "orig"} onClick={onCheck}>
                查重 / 原创度
              </Button>
            </div>
            {orig && (
              <Alert
                className="mt-2"
                type={orig.flagged ? "error" : orig.similar ? "warning" : "success"}
                showIcon
                message={`与原文相似度 ${orig.similarity}%`}
                description={
                  orig.flagged
                    ? "相似度过高，平台可能判定非原创/洗稿，请加大改写幅度或声明转载。"
                    : orig.similar
                    ? "相似度偏高，建议再润色后发布。"
                    : "相似度可控，可声明原创二创。"
                }
              />
            )}
          </Card>

          <Card title={`版本列表（${versions.length}）`} size="small">
            {versions.length === 0 ? (
              <Empty description="还没有版本，先 AI 改写或手动保存一份" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <div className="space-y-2">
                {versions.map((v) => (
                  <div
                    key={v.id}
                    className={`rounded-lg border p-2.5 ${v.id === activeId ? "border-amber-400 bg-amber-50" : "border-slate-200"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-800 truncate">{v.title}</div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          <Tag color={v.type === "ai" ? "blue" : "default"}>{v.type === "ai" ? "AI" : "手动"}</Tag>
                          {v.style && <Tag>{v.style}</Tag>}
                          {v.engine && <span className="ml-1">{v.engine === "llm" ? "大模型" : "本地启发式"}</span>}
                        </div>
                      </div>
                      <Space size={2}>
                        <Tooltip title="设为当前版本"><Button size="small" type={v.id === activeId ? "primary" : "default"} icon={<Check />} onClick={() => onActivate(v.id)} /></Tooltip>
                        <Tooltip title="复制内容"><Button size="small" icon={<Copy />} onClick={() => copy(v.content, "版本内容已复制")} /></Tooltip>
                        <Popconfirm title="删除该版本？" onConfirm={() => onDelete(v.id)} okText="删除" cancelText="取消">
                          <Button size="small" danger icon={<Trash2 />} />
                        </Popconfirm>
                      </Space>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="来源署名（二创法定要求）" size="small">
            <div className="space-y-2">
              <Input size="small" placeholder="原作者" value={attForm.author} onChange={(e) => setAttForm({ ...attForm, author: e.target.value })} />
              <Input size="small" placeholder="原文链接" value={attForm.url} onChange={(e) => setAttForm({ ...attForm, url: e.target.value })} />
              <Input size="small" placeholder="授权 / 转载说明（可选）" value={attForm.note} onChange={(e) => setAttForm({ ...attForm, note: e.target.value })} />
              <div className="flex items-center gap-2">
                <Switch checked={attForm.declare_original} onChange={(v) => setAttForm({ ...attForm, declare_original: v })} />
                <span className="text-xs text-slate-500">已做实质性改写，声明为原创二创</span>
              </div>
              <Space>
                <Button size="small" type="primary" onClick={onSaveAtt}>保存署名</Button>
                {att?.snippet && <Button size="small" icon={<Link2 />} onClick={() => copy(att.snippet, "署名片段已复制")}>复制引用块</Button>}
              </Space>
              {att?.snippet && (
                <div className="mt-2 rounded bg-slate-50 border border-slate-200 p-2 text-xs text-slate-600 whitespace-pre-wrap">{att.snippet}</div>
              )}
            </div>
          </Card>

          <Card title="多平台预览" size="small">
            <Button className="mb-3" type="primary" ghost icon={<Link2 />} onClick={onCopyPublish} block>
              复制「含来源署名的发布稿」（直接贴到 CSDN / 公众号）
            </Button>
            {!showPublishPreview && (editContent || article.content).length > 12000 ? (
              <Alert
                type="info"
                showIcon
                message="当前稿件较长，预览按需加载以保持编辑流畅"
                action={<Button size="small" onClick={() => setShowPublishPreview(true)}>打开预览</Button>}
              />
            ) : <Tabs
              items={[
                {
                  key: "csdn",
                  label: "CSDN",
                  children: (
                    <div>
                      <Alert type="info" showIcon className="mb-2" message="CSDN 支持 Markdown、代码高亮与目录，可直接粘贴发布。" />
                      <div className="max-h-72 overflow-y-auto"><ChunkedMarkdownView content={editContent || article.content} /></div>
                    </div>
                  ),
                },
                {
                  key: "wechat",
                  label: "微信公众号",
                  children: (
                    <div>
                      <Alert type="warning" showIcon className="mb-2" message="微信不支持外链、图片需先上传素材拿链接、代码块样式不同，发布前请检查排版。" />
                      <div className="max-h-72 overflow-y-auto"><ChunkedMarkdownView content={editContent || article.content} /></div>
                    </div>
                  ),
                },
              ]}
            />}
          </Card>
        </div>
      </div>
    </div>
  );
}
