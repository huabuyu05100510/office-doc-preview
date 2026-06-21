# 翻译对比预览 · 质量检查 · 多人协同标注

> **模型**：Claude Sonnet 4.6（claude-sonnet-4-6）
> **日期**：2026-06-21
> **分支**：`feature/translation-compare-annotation`（基于 `feature/pdfium-unified-renderer`）
> **策略**：先 mock，端到端跑通；真实算法留 v2 增量

## 范围

1. **翻译前后对比预览**：左右双栏，段落级对应，hover/click 互高亮 + 滚动联动
2. **质量检查与纠错 + 标注**：mock 7 类 issue 建议；人工批注 CRUD（真实落盘）
3. **多人同时标注预览**：真实 WebSocket，标注/cursor/scroll/presence 实时同步

## Mock 边界

| 服务 | v1 | v2 |
|---|---|---|
| `/api/align` | 段索引 1:1 配对，score=0.92 | Gale-Church DP + simhash |
| `/api/qa/:taskId` | 硬编码 5-7 条 issue 样本 | 7 条规则真实跑 |
| `/api/annotations/*` | **真实 CRUD**（落盘 JSON） | 同 v1 |
| `ws /collab` | **真实 WebSocket + 广播** | 加重连 / 心跳 / 退避 |

## 新增模块

### 后端 `office-preview-app/server/src/`
- `align.mjs` — 段提取 + mock 配对 + 落盘缓存
- `qa.mjs` — runQA mock
- `annotations.mjs` — Annotation CRUD + 落盘
- `collab.mjs` — WebSocket hub + 房间路由
- `auth.mjs` — 匿名 JWT 签发

### 前端 `office-preview-app/web/src/`
- `compare/` — CompareView + useAlignSync + SegmentHighlighter
- `annotations/` — AnnotationLayer + AnnotationList + useAnnotationPicker
- `collab/` — useCollab + CursorsLayer + PresenceBar

### 测试
- vitest：align / qa / annotations / collab / useAlignSync / AnnotationLayer / useCollab
- Playwright：compare-highlight / qa-suggestions / annotation-flow / multiplayer + 截图回归

## 可观测

- 后端日志前缀：`[align]` / `[qa]` / `[annotate]` / `[collab]`
- `usePerf` 扩展：alignPairs / alignScoreAvg / qaIssues / annotationsTotal / collabOnline / wsLatencyMs
- 新端点：`/api/health/align`、`/api/health/qa`、`/api/health/collab`

## 验证

```bash
cd office-preview-app/server && npm test
cd office-preview-app/web && npm test
cd office-preview-app/web && npx playwright test
```
