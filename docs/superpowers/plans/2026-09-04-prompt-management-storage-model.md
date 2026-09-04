# 提示词管理存储模型调整实施计划

## 证据表（前置）

| 字段名/标识符 | 是否存在 | 文件:行号 | 当前如何被使用 |
|---|---|---|---|
| `PromptItem.enabled` | 存在 | `src/main/types.ts:29-32` | 当前提示词数据模型用 `enabled` 表示唯一激活状态；spec 中的 `isActive` 对应本仓库实际字段 `enabled` |
| `StoreData.prompts` | 存在 | `src/main/store.ts:6-13` | `data.json` 中按 7 个 `AgentId` 保存 `PromptItem[]`；`loadStore` 只做 JSON cast，不清洗字段 |
| `savePrompt` | 存在 | `src/main/services/prompts.ts:84-117` | 新增/编辑 saved 记录；当前编辑 `enabled=true` 的条目会立即写指令文件 |
| `enablePrompt` | 存在 | `src/main/services/prompts.ts:119-161` | 当前“激活”实现：回填 live、切换 enabled 唯一状态并写指令文件 |
| `disablePrompt` | 存在 | `src/main/services/prompts.ts:163-184` | 当前“停用”实现：清空 enabled 并在无其他激活时清空指令文件 |
| `deletePrompt` | 存在 | `src/main/services/prompts.ts:186-198` | 当前删除 saved 记录，并禁止删除 enabled 条目 |
| `copyPrompt` | 存在 | `src/main/services/prompts.ts:208-244` | 复制 saved 记录到其他 harness，当前插入 `enabled:false` 新条目且不写文件 |
| `importPromptsFromHarnesses` | 存在 | `src/main/services/prompts.ts:246-283` | 手动/启动导入 live 内容为新 saved 记录；v2 需移除该入口 |
| `readLiveFile` / `writePromptFile` | 存在 | `src/main/services/prompts.ts:62-76` | 读取指令文件；写入前经 `backupFile` 备份，再经 `atomicWrite` 原子写入 |
| `backupFile` / `atomicWrite` | 存在 | `src/main/safety.ts:24-39 / 46-60` | 提供写前备份与原子写入；v2 的 live 编辑与应用必须继续复用 |
| `resolveAgentPaths` | 存在 | `src/main/paths.ts:104-128` | 按 `dirOverrides` 解析各 harness 的真实 `promptFile`，已覆盖目录覆盖场景 |
| `AGENTS.promptFile` | 存在 | `src/main/paths.ts:54-76` | 7 个 harness 指令文件模板；渲染层 `data.js` 有同名副本 |
| 提示词 IPC 通道 | 存在 | `src/main/ipc.ts:340-396` | 注册 list/save/delete/enable/disable/copy/import 七类通道 |
| `window.hub` 提示词方法 | 存在 | `src/preload/index.ts:41-48` | 渲染层调用提示词 IPC 的唯一桥接层 |
| `state.promptsByAgent` | 存在 | `src/renderer/state.js:10-12` | 缓存每 harness saved 库，Dashboard 与提示词页共用 |
| `renderPrompts` | 存在 | `src/renderer/ui/prompts.js:40-138` | 当前渲染 harness tab、saved 卡片、激活开关、删除/复制操作 |
| 提示词表单 Modal | 存在 | `src/renderer/index.html:400-425` | 当前新增/编辑 saved 记录，文案仍描述“激活后写入” |
| 复制 Modal | 存在 | `src/renderer/index.html:427-439` | 当前复制到其他 harness，文案仍描述“未激活” |
| `askConfirm` | 存在 | `src/renderer/ui/common.js:25-38` | 只支持取消/确认两按钮，不满足应用冲突时的三选一，需要新 Modal |
| 启动自动导入 | 存在 | `src/renderer/main.js:81-83 / 95-121` | 启动时调用 `importPromptsFromHarnesses` 自动生成 saved 记录；v2 需删除提示词分支 |
| 手动导入按钮 | 存在 | `src/renderer/index.html:149-152 / src/renderer/ui/prompts.js:142-167` | 当前可从 7 个 harness 导入 live 内容；v2 的 live→saved 唯一入口改为“另存为”，需移除 |
| Dashboard 提示词计数 | 存在 | `src/renderer/ui/dashboard.js:43-52 / src/renderer/index.html:56` | 当前统计 enabled 数量；v2 后 enabled 不存在，必须改为 saved 总数并更新标签 |
| `ExportPayload.version: 1` | 存在 | `src/main/data-io.ts:9-25` | 当前导出 JSON 固定 version 1 |
| `validateBackup` | 存在 | `src/main/data-io.ts:28-58` | 当前仅接受 version 1，导入旧备份时不清洗提示词字段 |
| 提示词测试 | 存在 | `tests/prompts.test.ts:109-501` / `tests/import-prompts.test.ts:85-143` | 覆盖当前激活、停用、删除保护、导入与复制旧行为，需要随模型重写 |
| 数据导入导出测试 | 存在 | `tests/data-io.test.ts:46-96` | 当前断言导出 version 1 且 version 2 报错（本计划保持该行为） |
| 纯渲染层测试先例 | 存在 | `tests/renderer/import-notice.test.ts` / `tests/renderer/data.test.ts` | 证明 Vitest 可直接测试无 DOM 依赖的 renderer 纯函数模块 |
| 当前基线 | 已验证 | 本会话命令输出 | `npx vitest run --pool=threads`：19 个文件、255 个测试全部通过；`npx tsc --noEmit -p tsconfig.node.json`：exit 0 |

## 计划头

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将提示词管理从“唯一激活 + 自动导入/回填”改为“运行时 live 内容 + 无激活状态的 saved 命名库”，并保留备份与原子写入安全机制。

**Architecture:** 后端以 `PromptSnapshot` 为提示词页单一读取契约，其中 `live` 不落库、`saved prompts` 去除 `enabled` 状态；写文件动作收敛为 `saveLivePrompt` 与 `applyPrompt`，均复用 `writePromptFile`。渲染层拆分“当前内容区”和“已保存库区”，一致性状态由 `matchedIds` 运行时计算；启动与手动导入提示词的路径全部移除。

**Tech Stack:** Electron 44 + electron-vite 5（main/preload TypeScript strict，renderer 原生 ES Module）、Vitest 4（`--pool=threads`）、无新增依赖。

**Spec:** `docs/superpowers/specs/2026-09-04-prompt-management-storage-model-design.md`

## Global Constraints

- 范围仅提示词管理；MCP、Skills、Harness 管理与设置页不得引入行为变化。Dashboard 因旧 `enabled` 计数失去数据源，仅将统计口径改为 saved 总数并更新文案。
- spec 示例中的 `description` 映射到现有持久化字段 `desc`；本计划不重命名数据契约。
- spec 中的 `isActive` 对应本仓库当前实际字段 `enabled`；实施后 TypeScript 与新写入数据均不再包含 `enabled`/`isActive`。
- `StoreData.version` 与备份导出 JSON 的 `ExportPayload.version` 均保持 `1`；项目未发版、无历史数据，不做版本迁移与旧数据兼容。
- live 不落库；saved 记录新增时写入 `createdAt` 与 `updatedAt`（无历史数据，无需读取兜底）。
- “应用”和“编辑当前内容保存”必须继续经过 `backupFile + atomicWrite`。
- 不新增依赖，不做无关重构，不触发文件级格式化。
- 验证命令：`npx vitest run --pool=threads tests/prompts.test.ts tests/prompt-live.test.ts tests/renderer/prompt-view.test.ts tests/data-io.test.ts`、`npx vitest run --pool=threads`、`npx tsc --noEmit -p tsconfig.node.json`。
- `pnpm build` 依赖命名管道，沙箱内可能失败；最终验证时按需申请升级执行，或由用户在沙箱外执行。
- 工作区已有用户改动：`electron-builder.yml`、`package.json`、`dist-build-win.log`。所有 `git add` 必须使用显式文件列表，严禁加入这些无关改动。
- 提交信息使用中文正文 + Conventional Commits 英文类型前缀，例如 `feat: 重构提示词存储模型`。

## 显式假设与裁决

1. **假设：spec 的 `description` 是文案层面的字段描述，实际实现沿用现有 `desc`。** 依据：`src/main/types.ts:30` 与全部现有服务/UI/测试均使用 `desc`；重命名会引入不必要的数据迁移。若该假设错误，代价是导出的数据字段名仍为 `desc`，与 spec 字面示例不一致。
2. **裁决：移除“从各 harness 导入”按钮与后端函数。** 依据：spec 规定“另存为”是 live 进入 saved 的唯一入口，且启动不得自动产生记录；保留手动批量导入会违背该模型。若判断错误，代价是丢失一个旧入口，需要另行恢复。
3. **裁决：Dashboard 标签改为“已保存提示词”并统计 saved 总数。** 依据：删除 `enabled` 后“激活中的提示词”无法计算；这是必要关联影响。若判断错误，代价是 Dashboard 文案不符合用户预期。
4. **测试例外：IPC/preload 与 DOM 集成无自动化单测。** 依据：`ipc.ts` 顶层导入 `electron`，现有测试体系没有 Electron IPC harness；DOM 模块无测试先例。计划用服务层测试、纯 renderer 函数测试、TypeScript 门与人工验收覆盖；实施前需用户确认本计划即确认该例外。

---

### Task 1: 后端数据模型与提示词服务契约重构

**Files:**
- Modify: `src/main/types.ts`
- Modify: `src/main/services/prompts.ts`
- Modify: `src/main/ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `tests/prompts.test.ts`
- Create: `tests/prompt-live.test.ts`
- Delete: `tests/import-prompts.test.ts`

**Interfaces:**
- Consumes: 现有 `PromptCtx`、`resolveAgentPaths`、`loadStore`、`saveStore`、`backupFile`、`atomicWrite`。
- Produces:
  - `PromptItem = { id, name, desc?, content, createdAt, updatedAt }`
  - `PromptLive = { agentId, path, exists, content, mtime, matchedIds }`
  - `PromptSnapshot = { prompts, live }`
  - `listPrompts(agentId, ctx?): PromptItem[]`
  - `savePrompt(agentId, item, ctx?): Promise<PromptItem[]>`
  - `deletePrompt(agentId, id, ctx?): Promise<PromptItem[]>`
  - `copyPrompt(agentId, id, targets, ctx?): Promise<{ copiedTo: AgentId[] }>`
  - `getPromptSnapshot(agentId, ctx?): Promise<PromptSnapshot>`
  - `saveLivePrompt(agentId, content, ctx?): Promise<PromptSnapshot>`
  - `applyPrompt(agentId, id, ctx?): Promise<PromptSnapshot>`
  - IPC：`hub:getPromptSnapshot`、`hub:saveLivePrompt`、`hub:applyPrompt`；移除 `hub:enablePrompt`、`hub:disablePrompt`、`hub:importPromptsFromHarnesses`。

- [ ] **Step 1: 重写 saved 模型回归测试**

将 `tests/prompts.test.ts` 的 import 块替换为：

```ts
import {
  copyPrompt,
  deletePrompt,
  listPrompts,
  savePrompt,
  type PromptCtx
} from '../src/main/services/prompts'
```

将 `savePrompt`、`deletePrompt`、`copyPrompt` 三个旧 describe 整体替换为：

```ts
describe('savePrompt（saved 库 CRUD）', () => {
  it('新增：生成 id、createdAt、updatedAt，不写 enabled，不写指令文件', async () => {
    await seed('dsh', [])
    await writeLive('dsh', 'LIVE')
    const before = Date.now()

    const list = await savePrompt('dsh', {
      id: '', name: 'New', desc: 'd', content: 'C', createdAt: 0, updatedAt: 0
    }, ctx)

    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ name: 'New', desc: 'd', content: 'C' })
    expect(list[0].id).toMatch(/^[0-9a-f]{8}$/)
    expect(list[0].createdAt).toBeGreaterThanOrEqual(before)
    expect(list[0].updatedAt).toBeGreaterThanOrEqual(before)
    expect(list[0]).not.toHaveProperty('enabled')
    expect(await readLive('dsh')).toBe('LIVE')
  })

  it('编辑：仅更新库记录，不联动写入指令文件', async () => {
    const p1: PromptItem = {
      id: 'p1', name: 'A', content: 'old', createdAt: 1, updatedAt: 1
    }
    await seed('dsh', [p1])
    await writeLive('dsh', 'LIVE')

    const list = await savePrompt('dsh', {
      ...p1, name: 'A2', content: 'new', updatedAt: 0
    }, ctx)

    expect(list[0]).toMatchObject({ id: 'p1', name: 'A2', content: 'new' })
    expect(list[0].createdAt).toBe(1)
    expect(list[0].updatedAt).toBeGreaterThan(1)
    expect(await readLive('dsh')).toBe('LIVE')
  })
})

describe('deletePrompt（saved 记录）', () => {
  it('删除与当前文件内容一致的记录也不修改指令文件', async () => {
    const p1: PromptItem = {
      id: 'p1', name: 'A', content: 'A-content', createdAt: 1, updatedAt: 1
    }
    await seed('dsh', [p1])
    await writeLive('dsh', 'A-content')

    const list = await deletePrompt('dsh', 'p1', ctx)

    expect(list).toEqual([])
    expect(await readLive('dsh')).toBe('A-content')
  })
})

describe('copyPrompt（复制到其他 harness）', () => {
  it('目标新增普通 saved 记录，不携带应用状态，不写目标指令文件', async () => {
    const src: PromptItem = {
      id: 'p1', name: 'A', desc: 'd', content: 'SRC', createdAt: 1, updatedAt: 1
    }
    await seed('dsh', [src])
    await writeLive('claude', 'CLAUDE-LIVE')

    const res = await copyPrompt('dsh', 'p1', ['claude'], ctx)

    expect(res.copiedTo).toEqual(['claude'])
    const copied = listPrompts('claude', ctx)[0]
    expect(copied).toMatchObject({
      name: 'A', desc: 'd', content: 'SRC', createdAt: copied.updatedAt
    })
    expect(copied).not.toHaveProperty('enabled')
    expect(await readLive('claude')).toBe('CLAUDE-LIVE')
  })
})
```

删除该文件中旧的 `enablePrompt`、`disablePrompt`、`deletePrompt 禁止删除`、`写前备份` 相关测试（备份断言移入 Task 1 Step 2 的 live 测试）。

- [ ] **Step 2: 新增 live / apply 服务测试**

创建 `tests/prompt-live.test.ts`，完整内容如下：

```ts
// tests/prompt-live.test.ts —— v2：live 读取、快照一致性、live 保存与应用
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { AGENTS } from '../src/main/paths'
import { saveSettings, saveStore } from '../src/main/store'
import type { AgentId, AppSettings, PromptItem } from '../src/main/types'
import {
  applyPrompt,
  getPromptSnapshot,
  saveLivePrompt,
  type PromptCtx
} from '../src/main/services/prompts'

const AGENT_IDS: AgentId[] = ['dsh', 'claude', 'codex', 'gemini', 'grok', 'opencode', 'hermes']

function promptFileName(agentId: AgentId): string {
  const tpl = AGENTS.find((a) => a.id === agentId)!.promptFile
  return path.basename(tpl)
}

let tmp: string
let homesDir: string
let dataPath: string
let settingsPath: string
let backupDir: string
let ctx: PromptCtx

function promptFileOf(agentId: AgentId): string {
  return path.join(homesDir, agentId, promptFileName(agentId))
}

function emptyPrompts(): Record<AgentId, PromptItem[]> {
  const prompts = {} as Record<AgentId, PromptItem[]>
  for (const id of AGENT_IDS) prompts[id] = []
  return prompts
}

async function seed(items: PromptItem[]): Promise<void> {
  await saveStore(dataPath, {
    version: 1,
    mcpItems: [],
    skills: [],
    prompts: { ...emptyPrompts(), dsh: items },
    skillRepos: []
  })
}

async function writeLive(content: string): Promise<void> {
  await fs.mkdir(path.dirname(promptFileOf('dsh')), { recursive: true })
  await fs.writeFile(promptFileOf('dsh'), content, 'utf8')
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prompt-live-'))
  homesDir = path.join(tmp, 'homes')
  dataPath = path.join(tmp, 'hub', 'data.json')
  settingsPath = path.join(tmp, 'hub', 'settings.json')
  backupDir = path.join(tmp, 'hub', 'backups')
  const dirOverrides: Partial<Record<AgentId, string>> = {}
  for (const a of AGENTS) {
    dirOverrides[a.id] = path.join(homesDir, a.id)
    await fs.mkdir(path.join(homesDir, a.id), { recursive: true })
  }
  const settings: AppSettings = {
    dirOverrides,
    syncMethod: 'auto',
    backupBeforeWrite: true,
    skillUninstallBackup: true
  }
  await saveSettings(settingsPath, settings)
  ctx = { dataFile: dataPath, settingsFile: settingsPath, backupDir, env: { HOME: '/none', USERPROFILE: tmp } }
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('getPromptSnapshot', () => {
  it('指令文件不存在：exists=false、内容为空、mtime=null、无匹配', async () => {
    await seed([])

    const snap = await getPromptSnapshot('dsh', ctx)

    expect(snap.prompts).toEqual([])
    expect(snap.live).toEqual({
      agentId: 'dsh',
      path: promptFileOf('dsh'),
      exists: false,
      content: '',
      mtime: null,
      matchedIds: []
    })
  })

  it('内容完全相等才匹配，可命中多条重复记录', async () => {
    const p1: PromptItem = { id: 'p1', name: 'A', content: 'SAME', createdAt: 1, updatedAt: 1 }
    const p2: PromptItem = { id: 'p2', name: 'B', content: 'SAME', createdAt: 2, updatedAt: 2 }
    const p3: PromptItem = { id: 'p3', name: 'C', content: 'OTHER', createdAt: 3, updatedAt: 3 }
    await seed([p1, p2, p3])
    await writeLive('SAME')

    const snap = await getPromptSnapshot('dsh', ctx)

    expect(snap.live.exists).toBe(true)
    expect(snap.live.content).toBe('SAME')
    expect(typeof snap.live.mtime).toBe('number')
    expect(snap.live.matchedIds).toEqual(['p1', 'p2'])
  })

  it('目录覆盖生效时读取覆盖目录中的指令文件', async () => {
    await seed([])
    await writeLive('OVERRIDE-LIVE')

    const snap = await getPromptSnapshot('dsh', ctx)

    expect(snap.live.path).toBe(promptFileOf('dsh'))
    expect(snap.live.content).toBe('OVERRIDE-LIVE')
  })
})

describe('saveLivePrompt', () => {
  it('保存当前内容：创建缺失文件、写后返回一致性快照并保留旧内容备份', async () => {
    const p1: PromptItem = { id: 'p1', name: 'A', content: 'NEW', createdAt: 1, updatedAt: 1 }
    await seed([p1])
    await writeLive('OLD')

    const snap = await saveLivePrompt('dsh', 'NEW', ctx)

    expect(snap.live.content).toBe('NEW')
    expect(snap.live.exists).toBe(true)
    expect(snap.live.matchedIds).toEqual(['p1'])
    const files = (await fs.readdir(backupDir)).filter((f) => f.endsWith('.bak'))
    expect(files).toHaveLength(1)
    expect(await fs.readFile(path.join(backupDir, files[0]), 'utf8')).toBe('OLD')
  })
})

describe('applyPrompt', () => {
  it('应用 saved 内容：写指令文件、备份旧内容、不修改 saved 库', async () => {
    const p1: PromptItem = { id: 'p1', name: 'A', content: 'A', createdAt: 1, updatedAt: 1 }
    const p2: PromptItem = { id: 'p2', name: 'B', content: 'B', createdAt: 2, updatedAt: 2 }
    await seed([p1, p2])
    await writeLive('OLD')

    const snap = await applyPrompt('dsh', 'p2', ctx)

    expect(await fs.readFile(promptFileOf('dsh'), 'utf8')).toBe('B')
    expect(snap.live.content).toBe('B')
    expect(snap.live.matchedIds).toEqual(['p2'])
    expect(snap.prompts).toEqual([p1, p2])
    const files = (await fs.readdir(backupDir)).filter((f) => f.endsWith('.bak'))
    expect(files).toHaveLength(1)
    expect(await fs.readFile(path.join(backupDir, files[0]), 'utf8')).toBe('OLD')
  })

  it('目标不存在：抛错且指令文件不被修改', async () => {
    await seed([])
    await writeLive('KEEP')

    await expect(applyPrompt('dsh', 'nope', ctx)).rejects.toThrow('提示词不存在：nope')

    expect(await fs.readFile(promptFileOf('dsh'), 'utf8')).toBe('KEEP')
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run --pool=threads tests/prompts.test.ts tests/prompt-live.test.ts`
Expected: FAIL，报错包含 `createdAt` 不存在、`getPromptSnapshot` 未导出或 `applyPrompt` 未导出。

- [ ] **Step 4: 实施类型与服务**

将 `src/main/types.ts` 中 `PromptItem` 替换，并新增 live 类型：

```ts
export interface PromptItem {
  id: string; name: string; desc?: string;
  content: string; createdAt: number; updatedAt: number;   // epoch ms
}

export interface PromptLive {
  agentId: AgentId;
  path: string;
  exists: boolean;
  content: string;
  mtime: number | null;       // epoch ms
  matchedIds: string[];        // 与 saved content 完全相等的记录
}

export interface PromptSnapshot {
  prompts: PromptItem[];
  live: PromptLive;
}
```

将 `src/main/services/prompts.ts` 整体替换为：

```ts
// src/main/services/prompts.ts —— v2：saved 命名库 + live 指令文件运行时快照
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { AGENTS, dataFile, fileBackupDir, resolveAgentPaths, settingsFile } from '../paths'
import { atomicWrite, backupFile } from '../safety'
import { loadSettings, loadStore, saveStore } from '../store'
import type { HomeEnv } from '../paths'
import type { AgentId, AppSettings, PromptItem, PromptSnapshot } from '../types'

export interface PromptCtx {
  dataFile?: string
  settingsFile?: string
  backupDir?: string
  env?: HomeEnv
}

function ctxOf(ctx?: PromptCtx): Required<Pick<PromptCtx, 'dataFile' | 'settingsFile' | 'backupDir' | 'env'>> {
  return {
    dataFile: ctx?.dataFile ?? dataFile(),
    settingsFile: ctx?.settingsFile ?? settingsFile(),
    backupDir: ctx?.backupDir ?? fileBackupDir(),
    env: ctx?.env ?? process.env
  }
}

function backupDirFor(settings: AppSettings, base: string): string {
  return settings.backupBeforeWrite ? base : path.join(base, '.disabled')
}

function newPromptId(): string {
  return randomUUID().slice(0, 8)
}

function isNotFound(err: unknown): boolean {
  if (!(err instanceof Error) || !('code' in err)) return false
  return (err as { code?: string }).code === 'ENOENT'
}

async function writePromptFile(
  filePath: string,
  content: string,
  backupBase: string,
  settings: AppSettings
): Promise<void> {
  await backupFile(filePath, backupDirFor(settings, backupBase))
  await atomicWrite(filePath, content)
}

async function readLiveState(filePath: string): Promise<{
  exists: boolean
  content: string
  mtime: number | null
}> {
  try {
    const [content, stat] = await Promise.all([
      fs.readFile(filePath, 'utf8'),
      fs.stat(filePath)
    ])
    return { exists: true, content, mtime: stat.mtimeMs }
  } catch (err) {
    if (isNotFound(err)) return { exists: false, content: '', mtime: null }
    throw err
  }
}

export function listPrompts(agentId: AgentId, ctx?: PromptCtx): PromptItem[] {
  const c = ctxOf(ctx)
  return loadStore(c.dataFile).prompts[agentId] ?? []
}

export async function savePrompt(
  agentId: AgentId,
  item: PromptItem,
  ctx?: PromptCtx
): Promise<PromptItem[]> {
  const c = ctxOf(ctx)
  const data = loadStore(c.dataFile)
  const list = data.prompts[agentId] ?? []
  const idx = list.findIndex((p) => p.id === item.id)
  const now = Date.now()

  if (idx < 0) {
    list.push({
      id: newPromptId(),
      name: item.name,
      desc: item.desc,
      content: item.content,
      createdAt: now,
      updatedAt: now
    })
  } else {
    list[idx] = {
      ...list[idx],
      name: item.name,
      desc: item.desc,
      content: item.content,
      updatedAt: now
    }
  }

  data.prompts[agentId] = list
  await saveStore(c.dataFile, data)
  return list
}

export async function deletePrompt(
  agentId: AgentId,
  id: string,
  ctx?: PromptCtx
): Promise<PromptItem[]> {
  const c = ctxOf(ctx)
  const data = loadStore(c.dataFile)
  const list = data.prompts[agentId] ?? []
  const idx = list.findIndex((p) => p.id === id)
  if (idx < 0) throw new Error(`提示词不存在：${id}`)

  list.splice(idx, 1)
  data.prompts[agentId] = list
  await saveStore(c.dataFile, data)
  return list
}

function uniqueCopyName(list: PromptItem[], base: string): string {
  if (!list.some((p) => p.name === base)) return base
  let n = 2
  while (list.some((p) => p.name === `${base} (${n})`)) n++
  return `${base} (${n})`
}

export async function copyPrompt(
  agentId: AgentId,
  id: string,
  targets: AgentId[],
  ctx?: PromptCtx
): Promise<{ copiedTo: AgentId[] }> {
  const c = ctxOf(ctx)
  const data = loadStore(c.dataFile)
  const source = (data.prompts[agentId] ?? []).find((p) => p.id === id)
  if (!source) throw new Error(`提示词不存在：${id}`)

  const copiedTo: AgentId[] = []
  for (const target of targets) {
    if (target === agentId || copiedTo.includes(target)) continue
    if (!AGENTS.some((a) => a.id === target)) continue
    const list = data.prompts[target] ?? []
    const now = Date.now()
    list.push({
      id: newPromptId(),
      name: uniqueCopyName(list, source.name),
      desc: source.desc,
      content: source.content,
      createdAt: now,
      updatedAt: now
    })
    data.prompts[target] = list
    copiedTo.push(target)
  }

  if (copiedTo.length > 0) await saveStore(c.dataFile, data)
  return { copiedTo }
}

export async function getPromptSnapshot(
  agentId: AgentId,
  ctx?: PromptCtx
): Promise<PromptSnapshot> {
  const c = ctxOf(ctx)
  const data = loadStore(c.dataFile)
  const settings = loadSettings(c.settingsFile)
  const prompts = data.prompts[agentId] ?? []
  const r = resolveAgentPaths(agentId, settings.dirOverrides, c.env)
  const live = await readLiveState(r.promptFile)
  const matchedIds = prompts.filter((p) => p.content === live.content).map((p) => p.id)

  return {
    prompts,
    live: {
      agentId,
      path: r.promptFile,
      exists: live.exists,
      content: live.content,
      mtime: live.mtime,
      matchedIds
    }
  }
}

export async function saveLivePrompt(
  agentId: AgentId,
  content: string,
  ctx?: PromptCtx
): Promise<PromptSnapshot> {
  const c = ctxOf(ctx)
  const settings = loadSettings(c.settingsFile)
  const r = resolveAgentPaths(agentId, settings.dirOverrides, c.env)
  await writePromptFile(r.promptFile, content, c.backupDir, settings)
  return getPromptSnapshot(agentId, ctx)
}

export async function applyPrompt(
  agentId: AgentId,
  id: string,
  ctx?: PromptCtx
): Promise<PromptSnapshot> {
  const c = ctxOf(ctx)
  const data = loadStore(c.dataFile)
  const settings = loadSettings(c.settingsFile)
  const list = data.prompts[agentId] ?? []
  const target = list.find((p) => p.id === id)
  if (!target) throw new Error(`提示词不存在：${id}`)

  const r = resolveAgentPaths(agentId, settings.dirOverrides, c.env)
  await writePromptFile(r.promptFile, target.content, c.backupDir, settings)
  return getPromptSnapshot(agentId, ctx)
}
```

- [ ] **Step 5: 更新 IPC 与 preload 契约**

在 `src/main/ipc.ts` 中，将提示词服务 import 替换为：

```ts
import {
  applyPrompt,
  copyPrompt,
  deletePrompt,
  getPromptSnapshot,
  listPrompts,
  saveLivePrompt,
  savePrompt
} from './services/prompts'
```

将 `src/main/ipc.ts:342-396` 的提示词 handler 替换为：

```ts
ipcMain.handle('hub:listPrompts', async (_event, agentId: AgentId) => {
  try {
    return listPrompts(agentId)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:getPromptSnapshot', async (_event, agentId: AgentId) => {
  try {
    return await getPromptSnapshot(agentId)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:savePrompt', async (_event, agentId: AgentId, item: PromptItem) => {
  try {
    return await savePrompt(agentId, item)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:deletePrompt', async (_event, agentId: AgentId, id: string) => {
  try {
    return await deletePrompt(agentId, id)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:saveLivePrompt', async (_event, agentId: AgentId, content: string) => {
  try {
    return await saveLivePrompt(agentId, content)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:applyPrompt', async (_event, agentId: AgentId, id: string) => {
  try {
    return await applyPrompt(agentId, id)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:copyPrompt', async (_event, agentId: AgentId, id: string, targets: AgentId[]) => {
  try {
    return await copyPrompt(agentId, id, targets)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})
```

在 `src/preload/index.ts:41-48` 中替换提示词方法：

```ts
listPrompts: (...args: unknown[]) => ipcRenderer.invoke('hub:listPrompts', ...args),
getPromptSnapshot: (...args: unknown[]) => ipcRenderer.invoke('hub:getPromptSnapshot', ...args),
savePrompt: (...args: unknown[]) => ipcRenderer.invoke('hub:savePrompt', ...args),
deletePrompt: (...args: unknown[]) => ipcRenderer.invoke('hub:deletePrompt', ...args),
saveLivePrompt: (...args: unknown[]) => ipcRenderer.invoke('hub:saveLivePrompt', ...args),
applyPrompt: (...args: unknown[]) => ipcRenderer.invoke('hub:applyPrompt', ...args),
copyPrompt: (...args: unknown[]) => ipcRenderer.invoke('hub:copyPrompt', ...args),
```

执行删除：

```powershell
git rm tests/import-prompts.test.ts
```

- [ ] **Step 6: 运行验证**

Run: `npx vitest run --pool=threads tests/prompts.test.ts tests/prompt-live.test.ts`
Expected: PASS。

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: exit 0（注意 renderer 尚未更新，但 main/preload 类型必须已闭环）。

- [ ] **Step 7: Commit**

```powershell
git add src/main/types.ts src/main/services/prompts.ts src/main/ipc.ts src/preload/index.ts tests/prompts.test.ts tests/prompt-live.test.ts
git commit -m "feat: 重构提示词后端存储模型"
```

---

### Task 2: 渲染层纯函数（状态文案、时间与对比 diff）

**Files:**
- Create: `src/renderer/ui/prompt-view.js`
- Test: `tests/renderer/prompt-view.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `PromptLive` / `PromptItem` 数据形状（renderer 不导入 main 类型，只按对象形状使用）。
- Produces:
  - `liveStatusText(live, prompts): string`
  - `formatPromptMtime(mtime): string`
  - `promptDiffText(current, saved): string`
  - `savedPromptCount(promptsByAgent): number`

- [ ] **Step 1: 写失败测试**

创建 `tests/renderer/prompt-view.test.ts`：

```ts
// tests/renderer/prompt-view.test.ts —— v2 提示词页纯函数：状态、时间、diff 与 Dashboard 计数
import { describe, expect, it } from 'vitest'
import {
  formatPromptMtime,
  liveStatusText,
  promptDiffText,
  savedPromptCount
} from '../../src/renderer/ui/prompt-view.js'

const prompts = [
  { id: 'p1', name: '默认助手', content: 'SAME', createdAt: 1, updatedAt: 1 },
  { id: 'p2', name: '重复条目', content: 'SAME', createdAt: 2, updatedAt: 2 },
  { id: 'p3', name: '精简模式', content: 'OTHER', createdAt: 3, updatedAt: 3 }
]

describe('liveStatusText', () => {
  it('文件不存在显示未找到指令文件', () => {
    expect(liveStatusText({ exists: false, content: '', matchedIds: [] }, prompts))
      .toBe('未找到指令文件')
  })

  it('文件为空显示文件为空', () => {
    expect(liveStatusText({ exists: true, content: '', matchedIds: [] }, prompts))
      .toBe('文件为空')
  })

  it('单条匹配显示与该条一致', () => {
    expect(liveStatusText({ exists: true, content: 'OTHER', matchedIds: ['p3'] }, prompts))
      .toBe('与「精简模式」一致')
  })

  it('多条匹配显示等 N 条一致', () => {
    expect(liveStatusText({ exists: true, content: 'SAME', matchedIds: ['p1', 'p2'] }, prompts))
      .toBe('与「默认助手」等 2 条一致')
  })

  it('无匹配显示自定义内容', () => {
    expect(liveStatusText({ exists: true, content: 'NEW', matchedIds: [] }, prompts))
      .toBe('自定义内容（未保存）')
  })
})

describe('formatPromptMtime', () => {
  it('缺失时返回未知，存在时返回本地时间字符串', () => {
    expect(formatPromptMtime(null)).toBe('未知')
    const text = formatPromptMtime(new Date(2026, 8, 3, 14, 22).getTime())
    expect(text).toContain('2026/9/3')
    expect(text).toContain('14:22')
  })
})

describe('promptDiffText', () => {
  it('输出删除当前行、新增 saved 行与共同行', () => {
    expect(promptDiffText('A\nB\nC', 'A\nD\nC')).toBe([
      '  A',
      '- B',
      '+ D',
      '  C'
    ].join('\n'))
  })

  it('当前内容为空时全部 saved 行为新增', () => {
    expect(promptDiffText('', 'A\nB')).toBe('+ A\n+ B')
  })
})

describe('savedPromptCount', () => {
  it('汇总各 harness saved 记录数量', () => {
    expect(savedPromptCount({
      dsh: prompts,
      claude: [prompts[0]],
      codex: undefined
    })).toBe(4)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --pool=threads tests/renderer/prompt-view.test.ts`
Expected: FAIL，报错为模块 `src/renderer/ui/prompt-view.js` 不存在。

- [ ] **Step 3: 实现纯函数**

创建 `src/renderer/ui/prompt-view.js`：

```js
/* ================= 提示词 v2 纯渲染函数（无 DOM，可单测） ================= */

/** 根据运行时 live 状态与 saved 库计算状态徽章文案 */
export function liveStatusText(live, prompts){
  if(!live) return '未知';
  if(!live.exists) return '未找到指令文件';
  if(live.content === '') return '文件为空';
  const matched = prompts.filter(p => live.matchedIds.includes(p.id));
  if(matched.length === 0) return '自定义内容（未保存）';
  if(matched.length === 1) return `与「${matched[0].name}」一致`;
  return `与「${matched[0].name}」等 ${matched.length} 条一致`;
}

/** mtime epoch ms -> 本地可读时间；null/undefined -> 未知 */
export function formatPromptMtime(mtime){
  if(!mtime) return '未知';
  return new Date(mtime).toLocaleString('zh-CN', { hour12: false });
}

function splitLines(text){
  if(text === '') return [];
  return String(text).split(/\r\n|\r|\n/);
}

/** 小文本 line diff：保留共同行，`-` 为当前内容将被替换的行，`+` 为 saved 内容新增行 */
export function promptDiffText(current, saved){
  const a = splitLines(current);
  const b = splitLines(saved);
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for(let i = a.length - 1; i >= 0; i--){
    for(let j = b.length - 1; j >= 0; j--){
      dp[i][j] = a[i] === b[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const lines = [];
  let i = 0, j = 0;
  while(i < a.length && j < b.length){
    if(a[i] === b[j]){
      lines.push(`  ${a[i]}`); i++; j++;
    } else if(dp[i + 1][j] >= dp[i][j + 1]){
      lines.push(`- ${a[i]}`); i++;
    } else {
      lines.push(`+ ${b[j]}`); j++;
    }
  }
  while(i < a.length){ lines.push(`- ${a[i]}`); i++; }
  while(j < b.length){ lines.push(`+ ${b[j]}`); j++; }
  return lines.join('\n');
}

/** Dashboard 统计：saved 库总数（live 不参与计数） */
export function savedPromptCount(promptsByAgent){
  return Object.values(promptsByAgent || {}).reduce((n, list) => {
    return n + (Array.isArray(list) ? list.length : 0);
  }, 0);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run --pool=threads tests/renderer/prompt-view.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```powershell
git add src/renderer/ui/prompt-view.js tests/renderer/prompt-view.test.ts
git commit -m "feat: 新增提示词视图纯函数"
```

---

### Task 3: 提示词页面 v2 交互与布局

**Files:**
- Modify: `src/renderer/state.js`
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/styles.css`
- Modify: `src/renderer/ui/prompts.js`

**Interfaces:**
- Consumes: Task 1 的 `window.hub.getPromptSnapshot/saveLivePrompt/applyPrompt/listPrompts/savePrompt/deletePrompt/copyPrompt`；Task 2 的 `liveStatusText/formatPromptMtime/promptDiffText`。
- Produces: “当前内容”区（刷新、编辑、另存为）、“已保存的提示词”区（应用、对比、复制、编辑、删除）、三选一应用冲突确认 Modal、对比 Modal。

- [ ] **Step 1: 扩展渲染层状态**

在 `src/renderer/state.js` 的 `promptsByAgent` 行后新增：

```js
promptSnapshots: {},   // getPromptSnapshot/saveLivePrompt/applyPrompt 返回的每 harness 快照
promptFormIntent: null, // { applyAfterSave: boolean } | null
```

- [ ] **Step 2: 替换提示词视图结构**

将 `src/renderer/index.html:144-155` 替换为：

```html
<!-- ===== Prompts ===== -->
<section class="view" id="view-prompts">
  <div class="prompt-tabs" id="prompt-tabs"></div>
  <div class="prompt-head">
    <span class="prompt-file" id="prompt-file"></span>
  </div>
  <div class="prompt-live-card" id="prompt-live-card"></div>
  <div class="saved-header">
    <h4>已保存的提示词</h4>
    <button class="btn btn-primary btn-icon" id="btn-add-prompt">+ 新增提示词</button>
  </div>
  <div class="prompt-list" id="prompt-list"></div>
  <div class="empty-box hidden" id="prompt-saved-empty">
    <h4>还没有保存的提示词</h4>
    <p>可将当前内容另存为新提示词，或直接新增一条命名提示词。</p>
    <button class="btn btn-primary" id="btn-add-prompt-empty">+ 新增提示词</button>
  </div>
</section>
```

将 `modal-prompt-form` 的 hint 替换为：

```html
<div class="field-hint">保存后仅更新提示词库，不会写入指令文件；需要写入时请在列表中点击「应用」。</div>
```

在 `modal-copy` 的 info box 后追加以下三个 Modal（放在 `modal-copy` 结束标签之后）：

```html
<!-- ===== 编辑当前内容 Modal ===== -->
<div class="modal-overlay" id="modal-live-form">
  <div class="modal modal-lg">
    <h3>编辑当前内容</h3>
    <p class="modal-sub" id="live-form-sub"></p>
    <div class="modal-scroll">
      <label class="field-label">当前指令文件内容</label>
      <textarea class="field-input" id="live-editor-content" style="min-height:280px;"></textarea>
      <div class="field-hint">保存会直接写回指令文件；写入前自动备份，并使用原子写入。</div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="live-editor-cancel">取消</button>
      <button class="btn btn-primary" id="live-editor-save">保存当前内容</button>
    </div>
  </div>
</div>

<!-- ===== 应用提示词冲突确认 Modal ===== -->
<div class="modal-overlay" id="modal-apply-prompt">
  <div class="modal" style="width:480px;">
    <h3>应用提示词</h3>
    <p class="modal-sub" id="apply-prompt-message"></p>
    <div class="prompt-apply-actions">
      <button class="btn btn-ghost" id="apply-cancel">取消</button>
      <button class="btn btn-ghost" id="apply-save-first">先保存当前内容为新提示词再应用</button>
      <button class="btn btn-danger" id="apply-overwrite">直接覆盖</button>
    </div>
  </div>
</div>

<!-- ===== 提示词对比 Modal ===== -->
<div class="modal-overlay" id="modal-prompt-compare">
  <div class="modal modal-lg">
    <h3 id="prompt-compare-title">对比提示词</h3>
    <p class="modal-sub" id="prompt-compare-sub"></p>
    <div class="modal-scroll">
      <div class="field-label">差异（`-` 当前文件内容，`+` 已保存提示词内容）</div>
      <pre class="prompt-diff" id="prompt-compare-diff"></pre>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="prompt-compare-close">关闭</button>
      <button class="btn btn-primary" id="prompt-compare-apply">应用该提示词</button>
    </div>
  </div>
</div>
```

- [ ] **Step 3: 新增提示词 v2 样式**

在 `src/renderer/styles.css` 的 Prompts 区块中，保留现有 `.prompt-tabs/.prompt-head/.prompt-file/.prompt-list/.prompt-card/.pc-*`，删除 `.prompt-card.on` 与 `.pc-on-badge` 中激活语义的使用（样式可保留但不再由 JS 添加），并新增：

```css
.prompt-live-card{background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:16px 18px; box-shadow:var(--shadow-sm); margin-bottom:14px;}
.live-head{display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px;}
.live-title{font-size:13.5px; font-weight:700;}
.live-status{font-size:11px; font-weight:600; padding:4px 9px; border-radius:5px; background:var(--surface-3); color:var(--text-dim);}
.live-status.match{color:var(--on); background:#E6F7EE;}
.live-status.custom{color:#9A6700; background:#FFF8C5;}
.live-status.missing{color:var(--danger, #C0392B); background:#FDECEA;}
.live-mtime{font-size:11px; color:var(--text-faint); margin-left:auto;}
.live-actions{display:flex; gap:8px; margin-top:12px;}
.live-preview{margin-top:12px;}
.live-preview summary{cursor:pointer; font-size:12.5px; color:var(--text-dim);}
.live-preview pre{margin:8px 0 0; padding:12px; border:1px solid var(--border-soft); border-radius:var(--radius-sm); background:var(--surface-2); max-height:260px; overflow:auto; white-space:pre-wrap; word-break:break-word; font-size:12px; color:var(--text-dim);}
.saved-header{display:flex; align-items:center; justify-content:space-between; gap:12px; margin:18px 0 12px;}
.saved-header h4{font-family:var(--font-display); font-size:14px; margin:0;}
.hidden{display:none !important;}
.prompt-apply-actions{display:flex; flex-direction:column; gap:8px;}
.prompt-apply-actions .btn{width:100%;}
.btn-danger{background:#D93025; border-color:#D93025; color:#fff;}
.btn-danger:hover{background:#B3261E; border-color:#B3261E; color:#fff;}
.prompt-diff{margin:0; padding:12px; border:1px solid var(--border-soft); border-radius:var(--radius-sm); background:var(--surface-2); max-height:420px; overflow:auto; white-space:pre-wrap; word-break:break-word; font-size:12px; color:var(--text-dim);}
```

- [ ] **Step 4: 重写提示词视图逻辑**

将 `src/renderer/ui/prompts.js` 整体替换为：

```js
/* ================= 提示词 v2：当前内容（live） + 已保存命名库（saved） ================= */
import { AGENTS, AGENT_BY } from '../data.js';
import { icon } from '../icons.js';
import { $, showToast, askConfirm, esc } from './common.js';
import { state } from '../state.js';
import { renderDashboard } from './dashboard.js';
import { formatPromptMtime, liveStatusText, promptDiffText } from './prompt-view.js';

function resolvedOf(agentId){
  const r = state.agentsDetailed && state.agentsDetailed.resolved[agentId];
  return (r && r.promptFile) ? r.promptFile : AGENT_BY(agentId).promptFile;
}

function fmtUpdated(ts){
  if(!ts) return '未知';
  const diff = Date.now() - ts;
  if(diff < 60e3) return '刚刚';
  if(diff < 3600e3) return `${Math.floor(diff/60e3)} 分钟前`;
  if(diff < 86400e3) return `${Math.floor(diff/3600e3)} 小时前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

function syncSnapshot(snapshot){
  const agentId = snapshot.live.agentId;
  state.promptSnapshots[agentId] = snapshot;
  state.promptsByAgent[agentId] = snapshot.prompts;
}

export async function ensurePromptLib(agentId){
  if(state.promptsByAgent[agentId] === undefined){
    try {
      state.promptsByAgent[agentId] = await window.hub.listPrompts(agentId);
    } catch (err) {
      showToast('操作失败：' + err.message);
      state.promptsByAgent[agentId] = [];
    }
  }
}

async function ensurePromptSnapshot(agentId, force = false){
  if(force || state.promptSnapshots[agentId] === undefined){
    const snapshot = await window.hub.getPromptSnapshot(agentId);
    syncSnapshot(snapshot);
  }
}

function snapshotOf(agentId){
  return state.promptSnapshots[agentId];
}

function statusClass(live, prompts){
  if(!live.exists) return 'missing';
  if(live.content === '') return 'missing';
  return live.matchedIds.length === 0 ? 'custom' : 'match';
}

function renderLiveCard(agentId, promptFile){
  const snapshot = snapshotOf(agentId);
  const live = snapshot.live;
  const status = liveStatusText(live, snapshot.prompts);
  $('prompt-live-card').innerHTML = `
    <div class="live-head">
      <span class="live-title">当前内容</span>
      <span class="live-status ${statusClass(live, snapshot.prompts)}">${esc(status)}</span>
      <span class="live-mtime">最后修改：${formatPromptMtime(live.mtime)}</span>
      <button class="btn btn-ghost btn-sm" id="btn-refresh-live">刷新</button>
    </div>
    <details class="live-preview">
      <summary>内容预览</summary>
      <pre>${esc(live.content)}</pre>
    </details>
    <div class="live-actions">
      <button class="btn btn-ghost btn-sm" id="btn-edit-live">编辑</button>
      <button class="btn btn-primary btn-sm" id="btn-save-live-as">另存为新提示词</button>
    </div>
    <div class="field-hint">指令文件路径：${esc(promptFile)}</div>
  `;

  $('btn-refresh-live').addEventListener('click', async ()=>{
    try {
      syncSnapshot(await window.hub.getPromptSnapshot(agentId));
      renderPrompts();
      showToast('已刷新当前内容');
    } catch (err) {
      showToast('操作失败：' + err.message);
    }
  });
  $('btn-edit-live').addEventListener('click', ()=>{
    $('live-form-sub').textContent = `保存将直接写回 ${promptFile}`;
    $('live-editor-content').value = snapshotOf(agentId).live.content;
    $('modal-live-form').classList.add('open');
  });
  $('btn-save-live-as').addEventListener('click', ()=>{
    openPromptForm(null, { content: snapshotOf(agentId).live.content });
  });
}

function renderSavedList(agentId){
  const list = state.promptsByAgent[agentId] || [];
  const hasList = list.length > 0;
  $('prompt-list').innerHTML = list.map(p=>`
    <div class="prompt-card">
      <div class="pc-main">
        <div class="pc-name">${esc(p.name)}</div>
        ${p.desc ? `<div class="pc-desc">${esc(p.desc)}</div>` : ''}
        <div class="pc-meta">更新于 ${fmtUpdated(p.updatedAt)}</div>
      </div>
      <div class="pc-actions">
        <button class="btn btn-primary btn-sm" data-pt-apply="${p.id}">应用</button>
        <button class="btn btn-ghost btn-sm" data-pt-compare="${p.id}">对比</button>
        <button class="btn btn-ghost btn-sm" data-pt-copy="${p.id}">复制到其他 harness</button>
        <button class="btn btn-ghost btn-sm" data-pt-edit="${p.id}">编辑</button>
        <button class="btn btn-ghost btn-sm" data-pt-del="${p.id}">删除</button>
      </div>
    </div>`).join('');
  $('prompt-saved-empty').classList.toggle('hidden', hasList);
  $('prompt-list').classList.toggle('hidden', !hasList);
}

async function applyPromptById(agentId, id, name){
  try {
    syncSnapshot(await window.hub.applyPrompt(agentId, id));
    await renderPrompts();
    showToast(`已应用「${name}」`);
  } catch (err) {
    showToast('操作失败：' + err.message);
  }
}

function openApplyConfirm(agentId, prompt){
  const live = snapshotOf(agentId).live;
  $('apply-prompt-message').textContent =
    `当前文件有未保存的内容，应用「${prompt.name}」将覆盖它。可以先保存当前内容为新提示词，或直接覆盖。`;
  $('modal-apply-prompt').classList.add('open');

  $('apply-cancel').onclick = ()=>{
    $('modal-apply-prompt').classList.remove('open');
  };
  $('apply-overwrite').onclick = async ()=>{
    $('modal-apply-prompt').classList.remove('open');
    await applyPromptById(agentId, prompt.id, prompt.name);
  };
  $('apply-save-first').onclick = ()=>{
    $('modal-apply-prompt').classList.remove('open');
    openPromptForm(null, { content: live.content, applyAfterSave: true });
  };
}

function attachSavedActions(agentId){
  const list = state.promptsByAgent[agentId] || [];
  const find = id => list.find(p=>p.id===id);

  $('prompt-list').querySelectorAll('[data-pt-apply]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const p = find(btn.dataset.ptApply);
      if(!p) return;
      const live = snapshotOf(agentId).live;
      const noContent = !live.exists || live.content === '';
      if(live.matchedIds.length === 0 && !noContent){
        openApplyConfirm(agentId, p);
        return;
      }
      await applyPromptById(agentId, p.id, p.name);
    });
  });

  $('prompt-list').querySelectorAll('[data-pt-compare]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const p = find(btn.dataset.ptCompare);
      if(!p) return;
      const snapshot = snapshotOf(agentId);
      $('prompt-compare-title').textContent = `对比「${p.name}」`;
      $('prompt-compare-sub').textContent = `当前文件：${snapshot.live.path}`;
      $('prompt-compare-diff').textContent = promptDiffText(snapshot.live.content, p.content);
      $('prompt-compare-apply').onclick = async ()=>{
        $('modal-prompt-compare').classList.remove('open');
        const live = snapshotOf(agentId).live;
        const noContent = !live.exists || live.content === '';
        if(live.matchedIds.length === 0 && !noContent){
          openApplyConfirm(agentId, p);
          return;
        }
        await applyPromptById(agentId, p.id, p.name);
      };
      $('modal-prompt-compare').classList.add('open');
    });
  });

  $('prompt-list').querySelectorAll('[data-pt-edit]').forEach(btn=>{
    btn.addEventListener('click', ()=> openPromptForm(btn.dataset.ptEdit));
  });

  $('prompt-list').querySelectorAll('[data-pt-del]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const p = find(btn.dataset.ptDel);
      if(!p) return;
      askConfirm('删除提示词', `确定删除「${p.name}」？删除不会修改当前指令文件。`, async ()=>{
        try {
          state.promptsByAgent[agentId] = await window.hub.deletePrompt(agentId, p.id);
          const snapshot = snapshotOf(agentId);
          snapshot.prompts = state.promptsByAgent[agentId];
          snapshot.live.matchedIds = snapshot.prompts
            .filter(item => item.content === snapshot.live.content)
            .map(item => item.id);
          renderPrompts();
          renderDashboard();
          showToast(`已删除提示词「${p.name}」`);
        } catch (err) {
          showToast('操作失败：' + err.message);
        }
      }, '删除');
    });
  });

  $('prompt-list').querySelectorAll('[data-pt-copy]').forEach(btn=>{
    btn.addEventListener('click', ()=> openCopyModal(btn.dataset.ptCopy));
  });
}

export async function renderPrompts(){
  $('prompt-tabs').innerHTML = AGENTS.map(a=>`
    <button class="prompt-tab ${a.id===state.currentPromptAgent?'active':''}" data-agent="${a.id}" title="${a.name}">
      ${icon(a.id, 15, a.name)}<span>${a.short}</span>
    </button>`).join('');
  $('prompt-tabs').querySelectorAll('.prompt-tab').forEach(t=>{
    t.addEventListener('click', async ()=>{
      state.currentPromptAgent = t.dataset.agent;
      await renderPrompts();
    });
  });

  const agentId = state.currentPromptAgent;
  await ensurePromptSnapshot(agentId, true);
  const promptFile = snapshotOf(agentId).live.path || resolvedOf(agentId);
  $('prompt-file').textContent = `指令文件 · ${promptFile}`;

  renderLiveCard(agentId, promptFile);
  renderSavedList(agentId);
  attachSavedActions(agentId);
}

$('btn-add-prompt').addEventListener('click', ()=> openPromptForm(null));
$('btn-add-prompt-empty').addEventListener('click', ()=> openPromptForm(null));

$('live-editor-cancel').addEventListener('click', ()=>{
  $('modal-live-form').classList.remove('open');
});
$('live-editor-save').addEventListener('click', async ()=>{
  const agentId = state.currentPromptAgent;
  try {
    syncSnapshot(await window.hub.saveLivePrompt(agentId, $('live-editor-content').value));
    $('modal-live-form').classList.remove('open');
    await renderPrompts();
    showToast('当前内容已保存');
  } catch (err) {
    showToast('操作失败：' + err.message);
  }
});
$('prompt-compare-close').addEventListener('click', ()=>{
  $('modal-prompt-compare').classList.remove('open');
});

export function openPromptForm(editingId, initial = null){
  state.promptEditing = editingId ? {agentId: state.currentPromptAgent, id: editingId} : null;
  state.promptFormIntent = initial?.applyAfterSave ? { applyAfterSave: true } : null;
  const agent = AGENT_BY(state.currentPromptAgent);
  const editing = editingId ? state.promptsByAgent[state.currentPromptAgent].find(p=>p.id===editingId) : null;
  $('pf-title').textContent = editing ? '编辑提示词' : '新增提示词';
  $('pf-sub').textContent = `${agent.name} · 保存后仅更新提示词库`;
  $('pf-name').value = editing ? editing.name : '';
  $('pf-desc').value = editing ? (editing.desc||'') : '';
  $('pf-content').value = editing ? editing.content : (initial?.content || '');
  $('modal-prompt-form').classList.add('open');
}

$('pf-cancel').addEventListener('click', ()=> $('modal-prompt-form').classList.remove('open'));
$('pf-save').addEventListener('click', async ()=>{
  const name = $('pf-name').value.trim();
  if(!name){ showToast('请填写提示词名称'); return; }
  const agentId = state.currentPromptAgent;
  const editing = state.promptEditing;
  const intent = state.promptFormIntent;
  const previousIds = new Set((state.promptsByAgent[agentId] || []).map(p=>p.id));
  const item = editing
    ? {
        ...state.promptsByAgent[agentId].find(p=>p.id===editing.id),
        name,
        desc: $('pf-desc').value.trim(),
        content: $('pf-content').value
      }
    : {
        id: '',
        name,
        desc: $('pf-desc').value.trim(),
        content: $('pf-content').value,
        createdAt: 0,
        updatedAt: 0
      };

  try {
    const list = await window.hub.savePrompt(agentId, item);
    state.promptsByAgent[agentId] = list;

    if(intent?.applyAfterSave){
      const saved = list.find(p=>!previousIds.has(p.id));
      if(!saved) throw new Error('未找到刚保存的提示词');
      syncSnapshot(await window.hub.applyPrompt(agentId, saved.id));
      state.promptFormIntent = null;
      $('modal-prompt-form').classList.remove('open');
      await renderPrompts();
      renderDashboard();
      showToast(`已保存「${name}」并应用到当前指令文件`);
      return;
    }

    state.promptFormIntent = null;
    $('modal-prompt-form').classList.remove('open');
    await renderPrompts();
    renderDashboard();
    showToast(editing ? `已保存提示词「${name}」` : `已创建提示词「${name}」`);
  } catch (err) {
    showToast('操作失败：' + err.message);
  }
});

export async function openCopyModal(promptId){
  const agentId = state.currentPromptAgent;
  const source = (state.promptsByAgent[agentId]||[]).find(p=>p.id===promptId);
  if(!source) return;
  state.copySourcePrompt = source;
  const fromAgent = AGENT_BY(agentId);
  $('cp-sub').textContent = `将「${source.name}」（来自 ${fromAgent.name}）复制为以下 harness 提示词库中的新条目`;
  const targets = AGENTS.filter(a=>a.id!==agentId);
  for(const a of targets){ await ensurePromptLib(a.id); }
  $('cp-targets').innerHTML = targets.map(a=>{
    const n = state.promptsByAgent[a.id].length;
    return `<label class="target-item">
      <input type="checkbox" value="${a.id}">
      ${icon(a.id, 16, a.name)}
      <span class="name">${a.name}</span>
      <span class="t-meta">库中已有 ${n} 条</span>
    </label>`;
  }).join('');
  $('modal-copy').classList.add('open');
}

$('cp-cancel').addEventListener('click', ()=> $('modal-copy').classList.remove('open'));
$('cp-confirm').addEventListener('click', async ()=>{
  const checked = [...document.querySelectorAll('#cp-targets input:checked')].map(c=>c.value);
  if(checked.length===0){ showToast('请至少选择一个目标 harness'); return; }
  const agentId = state.currentPromptAgent;
  try {
    const res = await window.hub.copyPrompt(agentId, state.copySourcePrompt.id, checked);
    if(res.copiedTo.length===0){ showToast('未复制到任何 harness'); return; }
    for(const id of res.copiedTo){ state.promptsByAgent[id] = await window.hub.listPrompts(id); }
    $('modal-copy').classList.remove('open');
    const names = res.copiedTo.map(id=>AGENT_BY(id).short).join('、');
    showToast(`已复制到 ${names}（可在各自库中应用）`);
    renderPrompts();
    renderDashboard();
  } catch (err) {
    showToast('操作失败：' + err.message);
  }
});
```

同时将 `src/renderer/index.html:427-439` 的复制说明改为：

```html
<div class="info-box">ℹ 复制后的条目为普通已保存提示词：不会影响目标 harness 当前指令文件。同名条目将自动追加序号。</div>
```

- [ ] **Step 5: 运行自动化验证**

Run: `npx vitest run --pool=threads`
Expected: PASS。

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: exit 0。

- [ ] **Step 6: Commit**

```powershell
git add src/renderer/state.js src/renderer/index.html src/renderer/styles.css src/renderer/ui/prompts.js
git commit -m "feat: 重构提示词页面交互"
```

---

### Task 4: 启动行为与 Dashboard 统计口径

**Files:**
- Modify: `src/renderer/main.js`
- Modify: `src/renderer/ui/dashboard.js`
- Modify: `src/renderer/index.html`
- Test: `tests/renderer/prompt-view.test.ts`（Task 2 已覆盖 `savedPromptCount`，本任务先运行同一测试作为失败/通过门）

**Interfaces:**
- Consumes: Task 2 的 `savedPromptCount`；现有 `importMcpFromHarnesses`。
- Produces: 启动仅自动导入 MCP，不再调用提示词导入；Dashboard 显示“已保存提示词”总数。

- [ ] **Step 1: 运行现有纯函数测试作为基线**

Run: `npx vitest run --pool=threads tests/renderer/prompt-view.test.ts`
Expected: PASS（本任务是接线，逻辑已由该测试锁定）。

- [ ] **Step 2: 修改启动流程**

将 `src/renderer/main.js:19` 的提示词副标题改为：

```js
prompts:{title:'提示词', sub:'当前指令文件与已保存提示词库分层管理', search:false},
```

将 `src/renderer/main.js:95-121` 的 `autoRefreshFromHarnesses` 函数整体替换为：

```js
/* ================= 启动自动刷新：仅导入 MCP 配置 =================
 * v2 提示词不再自动导入：live 内容仅在提示词页运行时读取，
 * 进入 saved 库必须由用户通过「另存为」或「新增」显式创建。 */
async function autoRefreshFromHarnesses(){
  const summary = { mcp: 0 };
  const errors = [];
  try {
    const { added } = await window.hub.importMcpFromHarnesses();
    state.mcpItems = await window.hub.listMcp();
    summary.mcp = added.length;
  } catch (err) {
    errors.push('MCP：' + err.message);
  }

  if(summary.mcp > 0){
    showToast(`启动时已自动导入：MCP +${summary.mcp}`);
  }
  if(errors.length > 0){
    showToast('启动自动刷新部分失败：' + errors[0]);
  }
}
```

同步删除 `src/renderer/main.js:75-79` 注释中的“Dashboard 激活计数”表述，改为：

```js
// 预加载全部 saved 提示词库（Dashboard saved 计数与 tab 切换使用；live 按当前 harness 单独读取）
```

- [ ] **Step 3: 修改 Dashboard 统计**

在 `src/renderer/ui/dashboard.js` 顶部 import 中新增：

```js
import { savedPromptCount } from './prompt-view.js';
```

将 `dashboard.js:43-46` 替换为：

```js
$('stat-skill').textContent = state.skillsItems.length;
// 已保存提示词 = 各 harness saved 库总数（live 不落库、不参与计数）
$('stat-prompt').textContent = savedPromptCount(state.promptsByAgent);
```

将 `dashboard.js:48-67` 中每 harness 卡片的 `prompt` 计算与展示替换为：

```js
const prompt = (state.promptsByAgent[a.id]||[]).length;
```

`avc-meta` 行保持：

```js
<div class="avc-meta">MCP ${mcp} · Skills ${skill} · 提示词 ${prompt}</div>
```

将 `src/renderer/index.html:56` 的标签替换为：

```html
<div class="stat-card"><div class="num" id="stat-prompt">0</div><div class="lbl">已保存提示词</div></div>
```

- [ ] **Step 4: 运行验证**

Run: `npx vitest run --pool=threads`
Expected: PASS。

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: exit 0。

- [ ] **Step 5: Commit**

```powershell
git add src/renderer/main.js src/renderer/ui/dashboard.js src/renderer/index.html
git commit -m "feat: 调整提示词启动与统计行为"
```

---

### Task 5: 全量验证与人工验收

**Files:**
- No new source files.
- Potential generated artifacts from `pnpm build` are not committed.

**Interfaces:**
- Consumes: Task 1–4 的完整实现。
- Produces: 可交付的测试、类型、构建与人工验收证据。

- [ ] **Step 1: 静态残留检查**

Run:

```powershell
rg -n "enablePrompt|disablePrompt|importPromptsFromHarnesses|data-pt-toggle|btn-import-prompts|无法删除已启用|已激活|停用" src
```

Expected: 无输出。若出现 MCP/Skills 中同名概念，仅当确属其他模块才允许保留；提示词模块不得残留。

Run:

```powershell
rg -n "getPromptSnapshot|saveLivePrompt|applyPrompt|promptSnapshots|promptFormIntent" src
```

Expected: 同时出现 main、preload、renderer 相关调用与状态。

- [ ] **Step 2: 全量测试**

Run: `npx vitest run --pool=threads`
Expected: 全部测试 PASS；输出摘要中不得有 failed。

- [ ] **Step 3: 类型检查**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: exit 0，无输出。

- [ ] **Step 4: 构建**

Run: `pnpm build`
Expected: exit 0。若沙箱因 esbuild 命名管道限制失败，按项目既有约束申请升级执行一次，或由用户在沙箱外运行；不得因构建产物修改无关源码。

- [ ] **Step 5: 人工验收清单**

启动应用后逐项验证：

1. 外部修改当前 harness 指令文件后进入提示词 tab 或点击“刷新”，当前内容、mtime、一致性状态均更新。
2. 当前内容与某条 saved 一致时点击“应用”，无确认框，指令文件内容保持一致，写前备份生成。
3. 当前内容为未保存自定义内容时点击“应用”，出现“取消 / 先保存当前内容为新提示词再应用 / 直接覆盖”三选一：
   - 取消：文件不变；
   - 直接覆盖：文件变为目标内容；
   - 先保存再应用：需填写名称，保存后新记录出现且文件变为新记录内容。
4. 点击“另存为新提示词”，当前 live 内容固化为新 saved 记录，其他记录不变。
5. 删除与当前文件内容一致的 saved 记录，指令文件内容不变。
6. 点击“对比”，能看到当前内容与 saved 内容的行级 diff。
7. 复制到其他 harness 后，目标记录为普通 saved 记录，不携带应用状态，目标指令文件不变。
8. Dashboard 提示词统计显示 saved 总数，标签为“已保存提示词”。

- [ ] **Step 6: 收尾**

不需要额外提交；每个任务已完成各自中文 Conventional Commit。若人工验收发现问题，按问题归属回到对应任务修复，并追加 `fix:` 前缀中文提交。

---

## Self-Review

### Spec coverage

- 启动不再自动导入：Task 1 删除后端入口，Task 4 删除启动调用。
- live 不落库、运行时读取、路径覆盖：Task 1 `getPromptSnapshot` + `resolveAgentPaths`，Task 3 刷新交互。
- saved 模型去掉激活状态、删除保护、编辑不联动文件：Task 1 类型与服务，Task 3 删除按钮和保存表单。
- 一致性实时计算、多条重复显示：Task 1 `matchedIds`，Task 2 状态文案，Task 3 展示。
- 编辑 live、另存为、应用、对比、复制：Task 1 写文件 API，Task 2 diff，Task 3 UI。
- 应用冲突三选一：Task 3 `modal-apply-prompt`。
- 写前备份 + 原子写入：Task 1 `writePromptFile` 继续复用 `backupFile`/`atomicWrite`。
- 边界情况：文件不存在、空文件、重复记录、目录覆盖分别在 Task 1/2/3 覆盖。
- Dashboard 关联影响：Task 4。

### Placeholder scan

计划中没有 `TBD`、`TODO`、“后续实现”、“补充测试”之类占位；所有代码步骤均给出具体代码或精确替换位置。

### Type consistency

- `PromptItem` 在 main、测试与 renderer 纯函数中的形状一致：`id/name/desc/content/createdAt/updatedAt`。
- `PromptSnapshot` 仅由 main 构造，renderer 通过 IPC 接收后按 `snapshot.prompts` 与 `snapshot.live` 消费。
- IPC/preload/renderer 的方法名统一为 `getPromptSnapshot`、`saveLivePrompt`、`applyPrompt`、`listPrompts`、`savePrompt`、`deletePrompt`、`copyPrompt`。
- 旧 `enablePrompt`、`disablePrompt`、`importPromptsFromHarnesses` 在 main、preload、renderer 中成对移除。



