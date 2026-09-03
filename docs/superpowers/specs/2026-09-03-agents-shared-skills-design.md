# ~/.agents/skills 共享目录作为 Skills 部署目标 — 设计文档

- 日期：2026-09-03
- 状态：待评审
- 范围：仅 Skills 模块（MCP / 提示词 / Harness 管理页均不涉及）

## 证据表（前置）

| 字段名/标识符 | 是否存在 | 文件:行号 | 当前如何被使用 |
|---|---|---|---|
| `AGENTS`（7 harness 元信息，DSH 置顶） | 存在 | `src/main/paths.ts:54-76`；渲染层副本 `src/renderer/data.js:2-25` | 定义各 harness 的 MCP/Skills/提示词三类落点；被 skills 与非 skills 两类表面迭代消费 |
| `resolveAgentPaths`（未知 id 抛错） | 存在 | `src/main/paths.ts:104-128` | 部署/扫描/写入前解析 harness 落点绝对路径（含 dirOverrides） |
| `deploySkill` / `undeploySkill` | 存在 | `src/main/services/skills.ts:94-129` | SSOT → 目标目录的 symlink/junction（失败回退 copy）部署；`auto` 遇实体目录复制替换 |
| `uninstallSkill`（遍历 `apps` keys 部署落点） | 存在 | `src/main/services/skills.ts:214-259` | 卸载时从所有启用落点移除部署 + 备份 |
| `restoreSkillBackup` / `importSkills`（预检 + 部署循环） | 存在 | `src/main/services/skill-io.ts:104-152 / 317-364` | 备份恢复与导入：`assertAgentRoot` 预检后按 `apps` 部署 |
| `updateSkillFromExtractedDir`（重部署） | 存在 | `src/main/services/discovery.ts:590-633` | 更新 SSOT 后重部署到启用落点 |
| `listUnmanagedSkills` / `findSourceDir` | 存在 | `src/main/services/skill-io.ts:260-311` | 仅扫 7 个 harness skillsDir 发现未纳管 skill 并定位导入源 |
| `SkillInstalled.apps` / `UnmanagedSkill.foundIn` | 存在 | `src/main/types.ts:21-26, 36-39` | 部署矩阵数据模型，键域为 `AgentId`（7 值） |
| `renderMatrix` / `renderCountBar`（MCP+Skills 双用） | 存在 | `src/renderer/ui/matrix.js:10-24, 66-85` | 矩阵列与计数徽章按 `AGENTS` 迭代；MCP 与 Skills 分支共用 |
| `openDetail` tabs（MCP+Skill 双用） | 存在 | `src/renderer/ui/detail.js:15-18, 51-63` | 详情页按 `AGENTS` 渲染 tabs 与部署位置 |
| 导入弹窗 mini-toggles / 「发现于」行 | 存在 | `src/renderer/ui/skills.js:149-169` | 预选由 `foundIn` 驱动；来源标签映射 harness short 名 |
| `importConfirmMessage` targets 标签 | 存在 | `src/renderer/ui/import-notice.js:33-38` | 二级确认文案按 `AGENT_BY(id)?.short` 列部署目标 |
| `assertAgentRoot` | 存在 | `src/main/services/agent-root.ts:21-38` | 写入前检查 harness 根目录存在，缺失抛可读错误 |
| `~/.agents/skills` 目录 | 存在（本机为空） | 实际检查 | Agent Skills 开放标准（agentskills.io）的用户级全局目录，多工具共管 |
| DSH 同时加载 `~/.dsh/skills`(rank 400) 与 `~/.agents/skills`(rank 500) | 存在 | dsh-skill-filesystem `lib/index.js:21-25, 150-188`；同名裁决 dsh-skill `lib/index.js:519`（rank 升序取先） | DSH 专属目录优先于共享目录；此为 harness 自身行为，HarnessHub 不依赖 |
| `AGENTS` 的非 skills 消费点（~15 处，共享须排除） | 存在 | `main.js:76,109`、`dashboard.js:46,48,76`、`sidebar.js:8`、`prompts.js:42,150,217`、`settings.js:81`、`mcp-form.js:60`、`mcp.ts:54,230,335`、`prompts.ts:229,261`、`agents-version.ts:109`、`ipc.ts:77,429` | 建模决策依据：字面加第 8 成员需逐处排他过滤，漏一处即出现死开关或 `resolveAgentPaths` 抛错 |

## 1. 背景与目标

`~/.agents/skills` 是 Agent Skills 开放标准定义的用户级全局技能目录：支持读取它的 harness（如 DSH，已源码验证）自动加载其中的 Skill；`npx skills` 等外部工具也向它安装内容。此前 HarnessHub 完全不感知该目录。

目标：将其纳管为**完整部署目标**——Skills 矩阵中出现置于 DSH 之前的「共享目录」列，开关语义与 7 个 harness 完全一致；「每个 harness 如何处理该目录内容，由 harness 自己控制」，HarnessHub 不追踪哪些 harness 读取它。

## 2. 核心决策

- **D1 共享目录 = 完整部署目标**（取代早期「仅扫描导入」方案）：开启 = 部署 `~/.agents/skills/<dir>`；关闭/卸载/更新/备份恢复全链路一致。
- **D2 建模 = Skills 层伪目标**：`AGENTS` 保持 7 个成员不变；Skills 层引入 `SkillTargetId = AgentId | 'shared'` 作为部署维度。理由：`AgentInfo` 是 MCP+Skills+提示词三合一记录，字面加第 8 成员将迫使 ~15 处非 skills 消费点排他过滤（证据表末行）；伪目标方案的注入点全部集中在 skills 语境，其他表面结构上零污染。UX 与「第 8 列」完全一致。
- **D3 「由 harness 自己控制」原则**：不维护 per-harness「是否读取共享目录」的能力矩阵，不做同名双份加载的冲突警告。DSH 同时读专属目录与共享目录时由 DSH 自身 rank 裁决（已验证，无功能冲突）。
- **D4 位置**：仅 Skills 页的矩阵列 / 计数徽章 / 详情 tab 中置于 DSH 之前；Dashboard（已接入 harness 数、概览网格）、侧边栏、Harness 管理页、提示词页、MCP 页、版本探测均不出现（它不是 harness）。

## 3. 数据模型与路径

```ts
// src/main/types.ts
export type SkillTargetId = AgentId | 'shared'
SkillInstalled.apps: Partial<Record<SkillTargetId, boolean>>   // 键域扩
UnmanagedSkill.foundIn: SkillTargetId[]                        // 键域扩
```

```ts
// src/main/paths.ts 新增
export function agentsSharedRoot(env): string            // <home>/.agents
export function agentsSharedSkillsDir(env): string       // <home>/.agents/skills
export function resolveSkillsTargetDir(id, overrides, env): string
// 'shared' → agentsSharedSkillsDir；AgentId → resolveAgentPaths(id,...).skillsDir
```

- 共享目录**不支持 dirOverride**（标准位置固定；DSH 的 `DSH_AGENTS_HOME` 为其私有 env，不读取）。
- 渲染层在 `data.js` 导出 `SKILL_TARGETS = ['shared', ...AGENTS]` 统一迭代序列，Skills 视图各消费点一律引用该序列，不再各自内联。

## 4. 后端设计

**路由点改造**（`resolveAgentPaths` 直调改 `resolveSkillsTargetDir`，共 6 处部署循环/入口）：

1. `skills.ts` `uninstallSkill`——apps 遍历移除部署（含 shared）。
2. `skill-io.ts` `restoreSkillBackup`——预检 + 部署循环（含 shared）。
3. `skill-io.ts` `importSkills`——预检 + 部署循环（含 shared）。
4. `discovery.ts` `updateSkillFromExtractedDir`——预检 + 重部署（含 shared）。
5. `ipc.ts` `toggleSkill`——单开关。
6. `ipc.ts` `bulkToggleSkill`——批量开关。

**根目录断言**：`agent-root.ts` 新增 `assertSkillTargetRoot(id, ...)`：`'shared'` 检查 `~/.agents` 存在（子目录由部署 `mkdir` 创建，与 harness 语义一致）；缺失时错误文案：「未检测到 Agent Skills 共享目录（`~/.agents`），已跳过写入。请先创建该目录。」所有写入路径沿用现有**预检模式**：任一启用目标根缺失则整单拒绝，不产生部分写入。

**未纳管扫描与导入源**：`listUnmanagedSkills` 与 `findSourceDir` 在 7 个 harness 目录之后追加扫描共享目录；同名合并时 harness 路径优先（`path` 取先命中者，与 DSH rank 语义一致），`foundIn` 记录含 `'shared'`。

**安装默认值**：ZIP / 仓库 / skills.sh 安装与备份恢复的 `apps` 默认全 false（含 shared），用户手动开启——与 harness 一致。

## 5. 前端设计

| 位置 | 改动 |
|---|---|
| `matrix.js` 计数徽章（skill 分支） | 首位加「共享」徽章，`data-bulk="shared"`，点击走 `bulkToggleSkill('shared')`；toast「已在 共享目录 中全部开启/关闭 Skills」 |
| `matrix.js` 矩阵（skill 分支） | 表头与单元格首位加共享列；开关 `data-agent="shared"`；MCP 分支不动 |
| `detail.js`（skill 分支） | tabs 首位加共享 tab；部署位置显示 `~/.agents/skills/<dir>`；MCP 分支不动 |
| `skills.js` 导入弹窗 | mini-toggles 首位加共享按钮；`foundIn` 标签映射 `'shared'` → 「共享目录」；预选由 `foundIn` 含 `'shared'` 驱动（发现于共享目录的 skill 导入后 symlink 回写，纳管语义与 harness 目录一致） |
| `import-notice.js` | targets 标签映射 `'shared'` → 「共享目录」（`AGENT_BY` 无此 id） |
| `icons.js` | `ICONS.shared` 新增通用文件夹图标（非品牌 SVG，title「Agent Skills 共享目录」） |
| 「发现于」展示顺序 | harness short 名在前、「共享目录」在后（与扫描合并顺序一致，区别于开关/列的置顶顺序） |

## 6. IPC 契约变更

- `toggleSkill(dir, target: SkillTargetId, on)`、`bulkToggleSkill(target: SkillTargetId, on)`——参数键域扩，preload 类型同步。
- 返回结构不变（`SkillInstalled[]`，`apps` 多 shared 键透传）。

## 7. 行为语义

- **部署方式**：`settings.syncMethod`（auto/symlink/copy）对共享目录同样生效；`auto` 遇已有实体目录（如 `npx skills` 装的）复制替换——等同纳管接管；遇链接先删再建；Windows junction 免特权。
- **多工具共存**：外部工具 rm 重建目录会破坏我们的 symlink——无害降级为实体目录，重新开关即恢复。不做额外所有权保护（「当另一个 harness」的一致性代价，已接受）。
- **卸载/更新/备份恢复**：shared 与 harness 落点完全一致；卸载备份 `meta.json` 的 `apps` 含 shared 键，恢复时同样回部署。
- **兼容性**：旧 `data.json`（apps 无 shared 键）自然兼容（Partial）；新 `data.json` 被旧版本程序读取时，旧版在卸载/开关含 shared 键的条目会因未知 id 抛错——前向兼容限制，记录在案。

## 8. 明确不做

- shared 出现在 Dashboard / 侧边栏 / Harness 管理页 / 提示词页 / MCP 页 / 版本探测（已接入 harness 数保持 7）。
- shared 的目录覆盖（dirOverride）。
- per-harness「读取 shared」能力标志与相关提示。
- DSH 双份加载的冲突警告（由 harness rank 裁决，无需干预）。
- MCP / 提示词写入共享目录。
- 共享目录内外部安装的额外所有权保护。

## 9. 测试计划

- `paths.test.ts`：`agentsSharedRoot` / `agentsSharedSkillsDir` / `resolveSkillsTargetDir`（shared 与 7 harness 两分支）。
- `skills-deploy.test.ts`：`toggleSkill`/`bulkToggleSkill` 含 shared 路由；`uninstallSkill` 移除 shared 部署。
- `skill-io.test.ts`：未纳管扫描含 shared（仅 shared / harness+shared 合并时 harness 路径优先）；导入预选数据；导入部署回写 shared；恢复备份按 `meta.apps` 回部署 shared；`~/.agents` 缺失时预检整单拒绝。
- `discovery.test.ts`：`updateSkillFromExtractedDir` 重部署含 shared 路由与预检。
- `store.test.ts`：apps 含 shared 键的读写与旧数据兼容。
- `import-notice.test.ts`：targets 含 `'shared'` 时确认文案显示「共享目录」。
- 渲染层 DOM 无单测（现状仅主进程），UI 手测清单：矩阵列/徽章首位与开关、批量开关 toast、详情 tab 与部署位置、导入弹窗共享按钮预选与「发现于」标签。

## 10. 已取代的历史方案（记录）

- **方案一（特殊「共享」开关 + 冲突警告 + 所有权保护）**：被 D3「由 harness 自己控制」原则取代——警告与保护均不必要。
- **方案二（仅扫描导入，不部署）**：被 D1 取代——放弃了共享目录一次部署多 harness 生效的原生能力。
- **方案三（把支持标准的 harness 专属目录换成 shared）**：仍否决——依赖易变的支持矩阵。
