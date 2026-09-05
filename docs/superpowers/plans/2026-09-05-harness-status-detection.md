# Harness 状态检测重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以「配置根目录存在 AND MCP 落点文件存在」作为 8 个 harness 统一的主状态判据（已配置/未配置），CLI 版本探测降级为次要信息通道，并按两层结构重构 Dashboard 概览卡片。

**Architecture:** 新增主进程配置检测服务 `agent-config.ts`（同步 fs 调用，dirOverrides/claude 特例内聚）；`agents-version.ts` 去除 `installed`/Zcode 特判、改为单 agent 的 `probeCliVersion`；IPC 由 `getAgentVersions` 单通道切换为 `detectAgentConfigs` + `probeCliVersion` + `openAgentDocs` 三通道；渲染层以纯函数视图模型（`dashboard-view.js`）驱动两层卡片，CLI 探测并发发起、逐个回填，不阻塞主状态。

**Tech Stack:** Electron (electron-vite) + TypeScript 主进程 + vanilla JS 渲染层 + vitest。

**Spec:** `docs/superpowers/specs/2026-09-05-harness-status-detection-design.md`（判定规则 4.1、数据模型 5.1、页面改动 6.x、边界 8、验收 9）。视觉参考：`docs/superpowers/specs/2026-09-05-harness-card-redesign.html`。

**设计文档与原型**（`docs/设计文档.md` 第七/九/十节、`docs/设计原型.html` Dashboard 区）已于 2026-09-05 同步完成，**本计划仅覆盖代码实施**，实施时不得再改动文档。

## Global Constraints（摘自 spec，全任务隐含遵守）

- 判定规则（spec 4.1，逐字）：`已配置 = 配置根目录存在 AND MCP 落点文件存在`。提示词文件与 Skills 目录**不参与判定**。
- Claude Code 特例（spec 4.1）：根目录条件 = `~/.claude` 目录存在 或 `~/.claude.json` 文件存在；两项合取后实际退化为「`~/.claude.json` 存在」。
- 目录覆盖联动（spec 4.1）：检测路径必须经 `resolveAgentPaths`（dirOverrides 生效），不得硬编码。
- 主状态为本地同步检测（`fs.statSync`），无网络依赖；任何文件系统异常视为「未配置」并记录原因，不得中断渲染（spec 8）。
- CLI 探测失败不影响主状态、不阻塞任何按钮或操作（spec 4.2）；代码中不得再出现 ZCode 专属分支（spec 9 验收第 1 条）。
- 按钮文案：`更新 CLI` / `查看安装方式` / `查看安装选项`（spec 6.2）；官网链接常量与 `AGENT_TOOL_META` 同处维护（spec 6.2 URL 表）。
- 「刷新状态」两步：先 `detectAgentConfigs`（主状态先行刷新），再并发 CLI 探测异步回填（spec 6.3）。
- MCP / Skills / 提示词三页读写路径不受影响（spec 2.2 非目标）；每任务完成后 `npm test` 必须全绿。
- 提交信息使用中文（Conventional Commits 英文类型前缀），如 `feat: 新增配置检测服务`。
- 项目尚未发布（AGENTS.md）：无兼容性负担，直接替换 `getAgentVersions` 通道，无需过渡。

---

### Task 1: 主进程配置检测服务 `agent-config.ts`

**Files:**
- Create: `src/main/services/agent-config.ts`
- Test: `tests/agent-config.test.ts`

**Interfaces:**
- Consumes: `AGENTS`、`resolveAgentPaths`、`HomeEnv`（`src/main/paths.ts`）；`CliVersionInfo` 类型（Step 3 先在 `agents-version.ts` 落地最小定义，Task 2 重构时原样保留）。
- Produces: `interface AgentStatus { agentId: AgentId; configDetected: boolean; configPath: string; error: string | null; cli: CliVersionInfo | null }`；`detectAgentConfig(agentId, overrides, env?): AgentStatus`；`detectAgentConfigs(overrides, env?): AgentStatus[]`（`cli` 恒为 `null`，由渲染层探测后回填——spec 5.1）。

- [ ] **Step 1: 写失败测试**（判定规则、claude 特例、空目录、提示词不参与、覆盖、异常防御）

```ts
// tests/agent-config.test.ts —— 配置检测主状态判定（spec 4.1：根目录 AND MCP 落点文件；提示词/Skills 不参与）
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { detectAgentConfigs } from '../src/main/services/agent-config'

let tmp: string
const env = () => ({ USERPROFILE: tmp, HOME: tmp })

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-config-'))
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

function statusOf(list: ReturnType<typeof detectAgentConfigs>, id: string) {
  const s = list.find((x) => x.agentId === id)
  if (!s) throw new Error(`缺少 ${id} 的状态`)
  return s
}

describe('detectAgentConfigs（spec 4.1 判定规则）', () => {
  it('返回全部 8 个 agent 的状态，cli 槽位恒为 null（由渲染层回填）', () => {
    const list = detectAgentConfigs({}, env())
    expect(list).toHaveLength(8)
    for (const s of list) {
      expect(s.cli).toBeNull()
      expect(s.error).toBeNull()
    }
  })

  it('根目录 + MCP 落点文件均存在 → 已配置，configPath = 落点文件', async () => {
    await fs.mkdir(path.join(tmp, '.codex'), { recursive: true })
    await fs.writeFile(path.join(tmp, '.codex', 'config.toml'), '[mcp_servers]')
    const s = statusOf(detectAgentConfigs({}, env()), 'codex')
    expect(s.configDetected).toBe(true)
    expect(s.configPath).toBe(path.join(tmp, '.codex', 'config.toml'))
  })

  it('DSH 深层落点 ~/.dsh/profiles/web/cordis.patch.yml → 已配置', async () => {
    await fs.mkdir(path.join(tmp, '.dsh', 'profiles', 'web'), { recursive: true })
    await fs.writeFile(path.join(tmp, '.dsh', 'profiles', 'web', 'cordis.patch.yml'), 'x')
    expect(statusOf(detectAgentConfigs({}, env()), 'dsh').configDetected).toBe(true)
  })

  it('仅根目录存在（空目录）→ 未配置，configPath = 根目录', async () => {
    await fs.mkdir(path.join(tmp, '.codex'), { recursive: true })
    const s = statusOf(detectAgentConfigs({}, env()), 'codex')
    expect(s.configDetected).toBe(false)
    expect(s.configPath).toBe(path.join(tmp, '.codex'))
  })

  it('根目录 + 提示词文件但无 MCP 落点 → 未配置（提示词不参与判定，spec 验收第 2 条）', async () => {
    await fs.mkdir(path.join(tmp, '.grok'), { recursive: true })
    await fs.writeFile(path.join(tmp, '.grok', 'AGENTS.md'), '# prompt')
    expect(statusOf(detectAgentConfigs({}, env()), 'grok').configDetected).toBe(false)
  })

  it('根目录 + Skills 目录但无 MCP 落点 → 未配置（Skills 不参与判定）', async () => {
    await fs.mkdir(path.join(tmp, '.hermes', 'skills'), { recursive: true })
    expect(statusOf(detectAgentConfigs({}, env()), 'hermes').configDetected).toBe(false)
  })

  it('根目录是文件而非目录 → 未配置且不抛异常（防御路径）', async () => {
    await fs.writeFile(path.join(tmp, '.hermes'), 'not a dir')
    expect(statusOf(detectAgentConfigs({}, env()), 'hermes').configDetected).toBe(false)
  })

  it('claude 仅 ~/.claude.json（无 ~/.claude 目录）→ 已配置（根目录条件经落点文件满足）', async () => {
    await fs.writeFile(path.join(tmp, '.claude.json'), '{}')
    const s = statusOf(detectAgentConfigs({}, env()), 'claude')
    expect(s.configDetected).toBe(true)
    expect(s.configPath).toBe(path.join(tmp, '.claude.json'))
  })

  it('claude 仅 ~/.claude 目录（无 .claude.json）→ 未配置（判定退化为 .claude.json 存在）', async () => {
    await fs.mkdir(path.join(tmp, '.claude'), { recursive: true })
    expect(statusOf(detectAgentConfigs({}, env()), 'claude').configDetected).toBe(false)
  })

  it('配置目录覆盖生效：gemini 覆盖目录内 settings.json → 按覆盖路径判定为已配置', async () => {
    const ovr = path.join(tmp, 'gem-override')
    await fs.mkdir(ovr, { recursive: true })
    await fs.writeFile(path.join(ovr, 'settings.json'), '{}')
    const s = statusOf(detectAgentConfigs({ gemini: ovr }, env()), 'gemini')
    expect(s.configDetected).toBe(true)
    expect(s.configPath).toBe(path.join(ovr, 'settings.json'))
  })

  it('覆盖目录存在但无落点文件 → 未配置（覆盖不放宽规则）', async () => {
    const ovr = path.join(tmp, 'gem-empty')
    await fs.mkdir(ovr, { recursive: true })
    expect(statusOf(detectAgentConfigs({ gemini: ovr }, env()), 'gemini').configDetected).toBe(false)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/agent-config.test.ts`
Expected: FAIL（`Cannot find module '../src/main/services/agent-config'`）

- [ ] **Step 3: 写实现**（注意：`CliVersionInfo` 在 Task 2 才落地 `agents-version.ts`；本步先在 `agents-version.ts` 顶部补充该 interface 导出（最小新增，Task 2 重构时保留），再写 `agent-config.ts`）

`src/main/services/agents-version.ts` 顶部（`AgentVersionInfo` 定义之前）最小新增：

```ts
/** Dashboard 单 agent 的 CLI 版本信息（次要信息通道；与主状态解耦，spec 5.1） */
export interface CliVersionInfo {
  version: string | null       // 本地版本（--version 成功解析）
  latestVersion: string | null // npm latest（网络失败为 null）
  error: string | null         // 探测失败原因（未找到 CLI / 无法解析）
  checkedAt: number            // 探测时间戳（epoch ms）
}
```

`src/main/services/agent-config.ts` 全文：

```ts
// src/main/services/agent-config.ts —— Dashboard 主状态：配置检测（spec 2026-09-05-harness-status-detection-design.md 4.1）
// 判定：已配置 = 配置根目录存在 AND MCP 落点文件存在（提示词/Skills 不参与判定）。
// 本地同步 statSync、无网络依赖；任何文件系统异常视为「未配置」并记录原因，不中断检测（spec 8）。
import fs from 'node:fs'
import { AGENTS, resolveAgentPaths } from '../paths'
import type { HomeEnv } from '../paths'
import type { AgentId } from '../types'
import type { CliVersionInfo } from './agents-version'

/** Dashboard 单 agent 的主状态（cli 为次要信息槽位，本模块恒填 null，渲染层探测后回填） */
export interface AgentStatus {
  agentId: AgentId
  configDetected: boolean  // 主状态：判定规则见文件头
  configPath: string       // 实际命中路径：已配置 = MCP 落点文件；未配置 = 根目录（排错展示用）
  error: string | null     // 检测过程文件系统异常原因（spec 8「专门的错误字段」）；正常为 null
  cli: CliVersionInfo | null
}

/** statSync 结果分类：目录 / 文件 / 不存在（含 ENOTDIR）/ 异常（如权限拒绝） */
function statKind(p: string): 'dir' | 'file' | 'missing' | 'error' {
  try {
    const s = fs.statSync(p)
    if (s.isDirectory()) return 'dir'
    if (s.isFile()) return 'file'
    return 'missing'
  } catch (err) {
    const code = (err as { code?: string }).code
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'error'
  }
}

/**
 * 单 agent 配置检测。
 * claude 特例（spec 4.1）：MCP 落点 ~/.claude.json 在根目录外，根目录条件放宽为
 * 「~/.claude 目录 或 ~/.claude.json 文件任一存在」；两项合取后实际退化为「.claude.json 存在」。
 */
export function detectAgentConfig(
  agentId: AgentId,
  overrides: Partial<Record<AgentId, string>>,
  env: HomeEnv = process.env
): AgentStatus {
  const agent = AGENTS.find((a) => a.id === agentId)
  if (!agent) throw new Error(`未知 agent id：${agentId}`)
  const r = resolveAgentPaths(agentId, overrides, env)
  const rootKind = statKind(r.root)
  const mcpKind = statKind(r.mcpPath)
  const rootOk = agentId === 'claude'
    ? (rootKind === 'dir' || mcpKind === 'file')
    : rootKind === 'dir'
  const error =
    rootKind === 'error' || mcpKind === 'error'
      ? `检测 ${r.root} / ${r.mcpPath} 时发生文件系统异常（如权限拒绝），已按未配置处理`
      : null
  const configDetected = rootOk && mcpKind === 'file'
  return { agentId, configDetected, configPath: configDetected ? r.mcpPath : r.root, error, cli: null }
}

/** 全量配置检测（全部 8 个 harness）；同步本地调用，几十毫秒量级 */
export function detectAgentConfigs(
  overrides: Partial<Record<AgentId, string>>,
  env: HomeEnv = process.env
): AgentStatus[] {
  return AGENTS.map((a) => detectAgentConfig(a.id, overrides, env))
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/agent-config.test.ts`
Expected: PASS（12 个断言用例全绿）

- [ ] **Step 5: 提交**

```bash
git add src/main/services/agent-config.ts src/main/services/agents-version.ts tests/agent-config.test.ts
git commit -m "feat: 新增配置检测服务 detectAgentConfigs（Dashboard 主状态判定）"
```

---

### Task 2: `agents-version.ts` 重构为 CLI 次要信息通道 + 官网链接

**Files:**
- Modify: `src/main/services/agents-version.ts`（全文重构：删除 `AgentVersionInfo`/`ProbeResult.installed`/`probeZcode`/`getAgentVersions`，新增 `probeCliVersion` 与 `docsUrl`）
- Modify: `tests/agents-version.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `CliVersionInfo`（本任务保留该定义，Task 1 已引用）。
- Produces: `AGENT_TOOL_META: Record<AgentId, { bin: string; npm: string | null; install: string | null; docsUrl: string }>`（8 个官网链接见 spec 6.2 URL 表）；`probeLocalVersion(bin): Promise<{ version: string | null; error: string | null }>`；`probeCliVersion(agentId): Promise<CliVersionInfo | null>`（zcode 返回 `null`，不执行子进程/网络）；`installAgent(agentId): Promise<CliVersionInfo>`；`extractVersion`/`parseNpmLatestResponse`/`fetchNpmLatest` 不变。

- [ ] **Step 1: 更新测试（先失败）**

`tests/agents-version.test.ts` 全文替换为：

```ts
// tests/agents-version.test.ts —— CLI 版本探测纯函数（extractVersion / parseNpmLatestResponse / 元数据 / zcode 通道）
// 语义对齐 cc-switch commands/misc.rs：VERSION_RE:1013 提取、npm dist-tags.latest。
// 主状态判定见 tests/agent-config.test.ts；本模块为次要信息通道（spec 4.2）。
import { describe, expect, it } from 'vitest'
import {
  AGENT_TOOL_META,
  extractVersion,
  installAgent,
  parseNpmLatestResponse,
  probeCliVersion
} from '../src/main/services/agents-version'

describe('extractVersion', () => {
  it('从标准 CLI 输出提取版本号', () => {
    expect(extractVersion('claude-code/1.0.78 linux-x64 node-v20.18.1')).toBe('1.0.78')
    expect(extractVersion('Codex CLI 0.2.1\n')).toBe('0.2.1')
    expect(extractVersion('Gemini CLI 1.2.3 (latest)')).toBe('1.2.3')
  })

  it('提取带预发布后缀 / 前导 v 的版本号', () => {
    expect(extractVersion('2.1.156-beta.1')).toBe('2.1.156-beta.1')
    expect(extractVersion('v1.2.3')).toBe('1.2.3')
  })

  it('无版本号时返回 null', () => {
    expect(extractVersion('unknown')).toBeNull()
    expect(extractVersion('')).toBeNull()
    expect(extractVersion('command not found')).toBeNull()
  })
})

describe('parseNpmLatestResponse', () => {
  it('解析 npm /latest 响应（取 version 字段）', () => {
    expect(parseNpmLatestResponse({ name: 'claude-code', version: '1.0.78' })).toBe('1.0.78')
  })

  it('非对象 / 缺版本字段 / 空串返回 null', () => {
    expect(parseNpmLatestResponse(null)).toBeNull()
    expect(parseNpmLatestResponse('x')).toBeNull()
    expect(parseNpmLatestResponse({ name: 'x' })).toBeNull()
    expect(parseNpmLatestResponse({ version: '' })).toBeNull()
    expect(parseNpmLatestResponse({ version: 42 })).toBeNull()
  })
})

describe('AGENT_TOOL_META', () => {
  it('覆盖全部 8 个 agent：CLI 型含 npm 包与安装命令，zcode 为桌面应用（null）', () => {
    for (const id of ['dsh', 'claude', 'codex', 'gemini', 'grok', 'opencode', 'hermes'] as const) {
      expect(AGENT_TOOL_META[id]).toBeDefined()
      expect(AGENT_TOOL_META[id].bin.length).toBeGreaterThan(0)
      expect(AGENT_TOOL_META[id].npm!.length).toBeGreaterThan(0)
      expect(AGENT_TOOL_META[id].install).toContain('npm')
    }
    expect(AGENT_TOOL_META.zcode).toEqual({
      bin: 'zcode', npm: null, install: null, docsUrl: 'https://zcode.z.ai/docs/install'
    })
    expect(AGENT_TOOL_META.dsh.install).toBe('npm install -g @deepseek-ai/dsh')
  })

  it('全部 8 个 agent 的官网链接齐全（「查看安装方式/选项」按钮，spec 6.2 URL 表）', () => {
    const expected: Record<string, string> = {
      dsh: 'https://github.com/deepseek-ai/deepseek-harness',
      opencode: 'https://opencode.ai/docs',
      zcode: 'https://zcode.z.ai/docs/install',
      codex: 'https://github.com/openai/codex',
      claude: 'https://code.claude.com/docs',
      grok: 'https://docs.x.ai/build/overview',
      gemini: 'https://github.com/google-gemini/gemini-cli',
      hermes: 'https://github.com/NousResearch/hermes-agent'
    }
    for (const [id, url] of Object.entries(expected)) {
      expect(AGENT_TOOL_META[id as keyof typeof AGENT_TOOL_META].docsUrl).toBe(url)
    }
  })
})

describe('probeCliVersion', () => {
  it('zcode 无 CLI/npm 包 → 恒为 null（不执行任何子进程/网络请求，spec 4.2 无特判渲染）', async () => {
    await expect(probeCliVersion('zcode')).resolves.toBeNull()
  })
})

describe('installAgent zcode 拦截', () => {
  it('zcode 无安装渠道：抛可读错误（官网引导），不执行任何命令', async () => {
    await expect(installAgent('zcode')).rejects.toThrow(/ZCode 为桌面应用/)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/agents-version.test.ts`
Expected: FAIL（`probeCliVersion` 未导出、`AGENT_TOOL_META` 缺 `docsUrl`）

- [ ] **Step 3: 重构实现**

`src/main/services/agents-version.ts` 全文替换为：

```ts
// src/main/services/agents-version.ts —— Dashboard「Harness 概览」CLI 版本信息（次要信息通道）
// 语义对齐 cc-switch commands/misc.rs：
// - 本地版本：`{bin} --version` 子进程 + 正则提取（VERSION_RE:1013）
// - 最新版本：npm registry dist-tags.latest（fetch_npm_latest_for_tool:961）
// - 安装/更新：npm i -g <pkg>@latest（npm_install_command_for:509）
// 主状态（已配置/未配置）由 agent-config.ts 配置检测负责，本模块不参与判定（spec 4.2）；
// zcode（桌面应用，无 CLI/npm 包）cli 恒为 null，与其它 7 个同走一套渲染，无特判分支。
// 探测代价高（每个工具一次 --version 子进程 + 一次 npm 网络请求），渲染层按需逐个触发，不做缓存。
import { exec } from 'node:child_process'
import type { AgentId } from '../types'

/** --version 探测超时（含 not-found 场景） */
const PROBE_TIMEOUT_MS = 15_000
/** 安装命令超时（npm 全局安装可能较慢） */
const INSTALL_TIMEOUT_MS = 600_000
/** npm registry 请求超时 */
const NPM_TIMEOUT_MS = 15_000

/** 每个 agent 的二进制名 / npm 包 / 安装命令 / 官网链接（dsh 安装命令按产品要求「npm install -g @deepseek-ai/dsh」） */
export const AGENT_TOOL_META: Record<
  AgentId,
  { bin: string; npm: string | null; install: string | null; docsUrl: string }
> = {
  dsh: { bin: 'dsh', npm: '@deepseek-ai/dsh', install: 'npm install -g @deepseek-ai/dsh',
    docsUrl: 'https://github.com/deepseek-ai/deepseek-harness' },
  claude: { bin: 'claude', npm: '@anthropic-ai/claude-code', install: 'npm i -g @anthropic-ai/claude-code@latest',
    docsUrl: 'https://code.claude.com/docs' },
  codex: { bin: 'codex', npm: '@openai/codex', install: 'npm i -g @openai/codex@latest',
    docsUrl: 'https://github.com/openai/codex' },
  gemini: { bin: 'gemini', npm: '@google/gemini-cli', install: 'npm i -g @google/gemini-cli@latest',
    docsUrl: 'https://github.com/google-gemini/gemini-cli' },
  grok: { bin: 'grok', npm: '@xai-official/grok', install: 'npm i -g @xai-official/grok@latest',
    docsUrl: 'https://docs.x.ai/build/overview' },
  opencode: { bin: 'opencode', npm: 'opencode-ai', install: 'npm i -g opencode-ai@latest',
    docsUrl: 'https://opencode.ai/docs' },
  zcode: { bin: 'zcode', npm: null, install: null, docsUrl: 'https://zcode.z.ai/docs/install' },
  hermes: { bin: 'hermes', npm: 'hermes-agent', install: 'npm i -g hermes-agent@latest',
    docsUrl: 'https://github.com/NousResearch/hermes-agent' }
}

/** Dashboard 单 agent 的 CLI 版本信息（次要信息通道；与主状态解耦，spec 5.1） */
export interface CliVersionInfo {
  version: string | null       // 本地版本（--version 成功解析）
  latestVersion: string | null // npm latest（网络失败为 null）
  error: string | null         // 探测失败原因（未找到 CLI / 无法解析）
  checkedAt: number            // 探测时间戳（epoch ms）
}

/** 从 CLI 版本输出提取纯版本号（对齐 cc-switch VERSION_RE:1013；无匹配返回 null） */
const VERSION_RE = /\d+\.\d+\.\d+(-[\w.]+)?/
export function extractVersion(raw: string): string | null {
  const m = VERSION_RE.exec(raw)
  return m ? m[0] : null
}

/** 解析 npm registry /<pkg>/latest 响应（纯函数，可注入测试） */
export function parseNpmLatestResponse(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null
  const v = (json as { version?: unknown }).version
  return typeof v === 'string' && v ? v : null
}

/** 执行 shell 命令并捕获输出；失败时把 stdout/stderr 挂到错误对象上供上层取用 */
function runCommand(cmd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(
      cmd,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as Error & { code?: unknown; stdout?: string; stderr?: string }
          e.stdout = stdout
          e.stderr = stderr
          reject(e)
          return
        }
        resolve({ stdout, stderr })
      }
    )
  })
}

/** 本地探测结果（不含安装语义：主状态由 agent-config.ts 负责） */
export interface LocalProbe {
  version: string | null
  error: string | null
}

/** 执行 <bin> --version；未安装 / 无法解析时 version=null 并给出可读原因 */
export async function probeLocalVersion(bin: string): Promise<LocalProbe> {
  try {
    const { stdout, stderr } = await runCommand(`${bin} --version`, PROBE_TIMEOUT_MS)
    const raw = `${stdout}\n${stderr}`.trim()
    const version = extractVersion(raw)
    return version
      ? { version, error: null }
      : { version: null, error: `已找到 ${bin} 但未能从输出解析版本号` }
  } catch (err) {
    const e = err as { code?: unknown; message?: string }
    const code = e.code
    const msg = String(e.message ?? '')
    // Windows cmd 找不到命令：exit 1 + 「不是内部或外部命令」；POSIX：127 / ENOENT
    if (code === 'ENOENT' || code === 127 || /not (recognized|found)|不是内部或外部命令|无法识别/.test(msg)) {
      return { version: null, error: `${bin} 未安装或不在 PATH 中` }
    }
    return { version: null, error: `${bin} --version 执行失败：${msg.split('\n').pop() ?? msg}` }
  }
}

/** 查询 npm 包 dist-tags.latest（网络失败返回 null，不抛错） */
export async function fetchNpmLatest(pkg: string): Promise<string | null> {
  try {
    const resp = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`, {
      signal: AbortSignal.timeout(NPM_TIMEOUT_MS)
    })
    if (!resp.ok) return null
    return parseNpmLatestResponse(await resp.json())
  } catch {
    return null
  }
}

/** 探测单 agent 的 CLI 版本信息；zcode（无 CLI/npm 包）恒返回 null，不执行任何探测 */
export async function probeCliVersion(agentId: AgentId): Promise<CliVersionInfo | null> {
  const meta = AGENT_TOOL_META[agentId]
  if (!meta) throw new Error(`未知 agent：${agentId}`)
  if (!meta.npm) return null
  const probe = await probeLocalVersion(meta.bin)
  const latestVersion = await fetchNpmLatest(meta.npm)
  return { version: probe.version, latestVersion, error: probe.error, checkedAt: Date.now() }
}

/** 更新 CLI（npm 全局安装/更新）：执行安装命令后重新探测并返回最新 CLI 信息 */
export async function installAgent(agentId: AgentId): Promise<CliVersionInfo> {
  const meta = AGENT_TOOL_META[agentId]
  if (!meta) throw new Error(`未知 agent：${agentId}`)
  if (!meta.install) {
    throw new Error('ZCode 为桌面应用，无法通过 npm 安装，请从官网下载：https://zcode.z.ai/docs/install')
  }
  try {
    await runCommand(meta.install, INSTALL_TIMEOUT_MS)
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    const detail = String(e.stderr ?? e.message ?? '').trim().split('\n').pop() ?? '安装命令执行失败'
    throw new Error(`安装 ${agentId} 失败：${detail}`)
  }
  const info = await probeCliVersion(agentId)
  if (!info) throw new Error(`安装后探测 ${agentId} CLI 失败`)
  return info
}
```

注意：原文件中 `import { AGENTS, resolveAgentPaths, settingsFile } from '../paths'`、`import { loadSettings } from '../store'`、`import fs from 'node:fs'` 随 `probeZcode`/`getAgentVersions` 一并删除（本模块不再读配置）。

- [ ] **Step 4: 运行确认通过（含 Task 1 测试，防回归）**

Run: `npx vitest run tests/agents-version.test.ts tests/agent-config.test.ts`
Expected: PASS（agent-config 12 例 + agents-version 8 例全绿；`CliVersionInfo` 单一定义无冲突）

- [ ] **Step 5: 提交**

```bash
git add src/main/services/agents-version.ts tests/agents-version.test.ts
git commit -m "refactor: 版本探测降级为 CLI 次要信息通道并新增官网链接"
```

---

### Task 3: IPC / preload 契约切换（三通道替换 getAgentVersions）

**Files:**
- Modify: `src/main/ipc.ts`（electron import 加 `shell`；`agents-version` import 改为 `installAgent, probeCliVersion, AGENT_TOOL_META`；新增 `agent-config` import；替换 80-96 行区块）
- Modify: `src/preload/index.ts`（9-11 行区块替换 + 首行注释通道数 38 → 40）

**Interfaces:**
- Consumes: Task 1 `detectAgentConfigs`、Task 2 `probeCliVersion`/`AGENT_TOOL_META`/`installAgent`；`loadSettings`/`settingsFile`（ipc.ts 已有 import）。
- Produces: IPC 通道 `hub:detectAgentConfigs(): AgentStatus[]`、`hub:probeCliVersion(agentId): Promise<CliVersionInfo | null>`、`hub:openAgentDocs(agentId): Promise<void>`（`shell.openExternal`）；`hub:installAgent` 保留（返回类型变为 `CliVersionInfo`）。`window.hub.getAgentVersions` 删除（无兼容负担）。

- [ ] **Step 1: 修改 `src/main/ipc.ts`**

1 行 electron import 改为：

```ts
import { dialog, ipcMain, shell } from 'electron'
```

46 行 agents-version import 改为，并在其后新增 agent-config import：

```ts
import { AGENT_TOOL_META, installAgent, probeCliVersion } from './services/agents-version'
import { detectAgentConfigs } from './services/agent-config'
```

80-96 行区块（`// ---- Harness 版本探测 / 安装（Dashboard 概览） ----` 起、`hub:installAgent` 止）替换为：

```ts
// ---- Harness 状态检测 / CLI 版本 / 安装（Dashboard 概览，spec 2026-09-05） ----

ipcMain.handle('hub:detectAgentConfigs', async () => {
  try {
    // 主状态：本地同步文件系统检测（dirOverrides 生效，spec 4.1）
    return detectAgentConfigs(loadSettings(settingsFile()).dirOverrides)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:probeCliVersion', async (_event, agentId: AgentId) => {
  try {
    return await probeCliVersion(agentId)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:openAgentDocs', async (_event, agentId: AgentId) => {
  try {
    const meta = AGENT_TOOL_META[agentId]
    if (!meta) throw new Error(`未知 agent：${agentId}`)
    await shell.openExternal(meta.docsUrl)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:installAgent', async (_event, agentId: AgentId) => {
  try {
    return await installAgent(agentId)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})
```

- [ ] **Step 2: 修改 `src/preload/index.ts`**

首行注释 `—— contextBridge 暴露 window.hub（IPC API 契约全部 38 个通道）` 改为 `……全部 40 个通道`；9-11 行区块替换为：

```ts
  // Harness 状态检测 / CLI 版本 / 安装（Dashboard 概览）
  detectAgentConfigs: (...args: unknown[]) => ipcRenderer.invoke('hub:detectAgentConfigs', ...args),
  probeCliVersion: (...args: unknown[]) => ipcRenderer.invoke('hub:probeCliVersion', ...args),
  openAgentDocs: (...args: unknown[]) => ipcRenderer.invoke('hub:openAgentDocs', ...args),
  installAgent: (...args: unknown[]) => ipcRenderer.invoke('hub:installAgent', ...args),
```

- [ ] **Step 3: 构建 + 测试验证（接线任务，通道端到端在 Task 5 手动验证）**

Run: `npm test` 然后 `npm run build`
Expected: 测试全绿；electron-vite build 三端（main/preload/renderer）编译成功，无 unresolved import。

- [ ] **Step 4: 提交**

```bash
git add src/main/ipc.ts src/preload/index.ts
git commit -m "feat: IPC 切换为配置检测/CLI 探测/打开官网三通道"
```

---

### Task 4: 渲染层卡片视图模型（纯函数）

**Files:**
- Create: `src/renderer/ui/dashboard-view.js`
- Test: `tests/renderer/dashboard-view.test.js`

**Interfaces:**
- Consumes: `isUpdateAvailable`（`src/renderer/version.js`，已有测试）；`AgentStatus`/`CliVersionInfo` 的 JS 形态（Task 1/2 经 IPC 序列化而来：`{agentId, configDetected, configPath, error, cli}`、`{version, latestVersion, error, checkedAt}`）。
- Produces: `CLI_INFO_TOOLTIP: string`；`badgeModel(status) → { cls:'ok'|'off'|'loading', text }`；`secondaryModel(status) → { label, kind:'verline'|'note'|'note-ok'|'dir'|'skeleton', text?, version?, latest?, tooltip? }`；`actionModel(status) → { kind:'update'|'docs'|'none'|'loading', text?, primary? }`。Task 5 按这些字段渲染。

- [ ] **Step 1: 写失败测试（spec 6.2 矩阵逐行 + 边界）**

```js
// tests/renderer/dashboard-view.test.js —— Dashboard 卡片视图模型纯函数（spec 6.2 状态 × 展示 × 操作矩阵）
import { describe, expect, it } from 'vitest'
import { actionModel, badgeModel, CLI_INFO_TOOLTIP, secondaryModel } from '../../src/renderer/ui/dashboard-view.js'

const st = (over = {}) => ({
  agentId: 'x', configDetected: true, configPath: 'C:\\h\\.x', error: null, cli: null, ...over
})

describe('badgeModel（主徽标：仅反映配置检测）', () => {
  it('未加载 → loading/…', () => {
    expect(badgeModel(null)).toEqual({ cls: 'loading', text: '…' })
  })
  it('已配置 → ok/已配置', () => {
    expect(badgeModel(st())).toEqual({ cls: 'ok', text: '已配置' })
  })
  it('未配置 → off/未配置（中性灰，非警示色）', () => {
    expect(badgeModel(st({ configDetected: false }))).toEqual({ cls: 'off', text: '未配置' })
  })
})

describe('secondaryModel（次要信息区）', () => {
  it('未加载 → 骨架占位', () => {
    expect(secondaryModel(null)).toEqual({ label: 'CLI 版本', kind: 'skeleton', text: '…' })
  })

  it('未配置 → 配置目录 + 路径未找到（tooltip 带异常原因则用之）', () => {
    const m = secondaryModel(st({ configDetected: false, configPath: 'C:\\h\\.hermes' }))
    expect(m).toEqual({ label: '配置目录', kind: 'dir', text: 'C:\\h\\.hermes 未找到', tooltip: 'C:\\h\\.hermes' })
    const e = secondaryModel(st({ configDetected: false, configPath: 'C:\\h\\.hermes', error: '权限拒绝' }))
    expect(e.tooltip).toBe('权限拒绝')
  })

  it('cli 为 null（zcode）→ 未检测到本地 CLI + spec 6.4 tooltip', () => {
    const m = secondaryModel(st())
    expect(m.kind).toBe('note')
    expect(m.text).toBe('未检测到本地 CLI，可能通过 IDE 插件或桌面客户端使用')
    expect(m.tooltip).toBe(CLI_INFO_TOOLTIP)
  })

  it('有 latest 但本地无 CLI（claude 插件场景）→ 同样归入未检测到本地 CLI', () => {
    const m = secondaryModel(st({ cli: { version: null, latestVersion: '2.0.28', error: 'claude 未安装或不在 PATH 中', checkedAt: 1 } }))
    expect(m.kind).toBe('note')
    expect(m.text).toBe('未检测到本地 CLI，可能通过 IDE 插件或桌面客户端使用')
  })

  it('可更新 → verline：0.18.4 → 0.19.1', () => {
    const m = secondaryModel(st({ cli: { version: '0.18.4', latestVersion: '0.19.1', error: null, checkedAt: 1 } }))
    expect(m).toEqual({ label: 'CLI 版本', kind: 'verline', version: '0.18.4', latest: '0.19.1' })
  })

  it('已最新 → note-ok：已是最新 CLI 版本 v0.9.3', () => {
    const m = secondaryModel(st({ cli: { version: '0.9.3', latestVersion: '0.9.3', error: null, checkedAt: 1 } }))
    expect(m).toEqual({ label: 'CLI 版本', kind: 'note-ok', text: '已是最新 CLI 版本 v0.9.3' })
  })

  it('本地有 CLI 但 latest 未知（网络失败）→ note：版本号（最新版本未知），不宣称已最新', () => {
    const m = secondaryModel(st({ cli: { version: '0.9.3', latestVersion: null, error: null, checkedAt: 1 } }))
    expect(m.kind).toBe('note')
    expect(m.text).toBe('0.9.3（最新版本未知）')
    const withErr = secondaryModel(st({ cli: { version: '0.9.3', latestVersion: null, error: 'npm registry 请求失败', checkedAt: 1 } }))
    expect(withErr.tooltip).toBe('npm registry 请求失败')
  })
})

describe('actionModel（操作区）', () => {
  it('未加载 → loading 禁用占位', () => {
    expect(actionModel(null)).toEqual({ kind: 'loading', text: '…' })
  })
  it('未配置 → docs 查看安装选项（primary）', () => {
    expect(actionModel(st({ configDetected: false }))).toEqual({ kind: 'docs', text: '查看安装选项', primary: true })
  })
  it('未检测到 CLI（cli null 或 version null）→ docs 查看安装方式（ghost）', () => {
    expect(actionModel(st())).toEqual({ kind: 'docs', text: '查看安装方式', primary: false })
    expect(actionModel(st({ cli: { version: null, latestVersion: '2.0.28', error: 'x', checkedAt: 1 } })).toEqual({ kind: 'docs', text: '查看安装方式', primary: false })
  })
  it('可更新 → update 更新 CLI（primary）', () => {
    expect(actionModel(st({ cli: { version: '0.18.4', latestVersion: '0.19.1', error: null, checkedAt: 1 } }))).toEqual({ kind: 'update', text: '更新 CLI', primary: true })
  })
  it('已最新 / 最新未知 → 无按钮（纯文案在次要信息区）', () => {
    expect(actionModel(st({ cli: { version: '0.9.3', latestVersion: '0.9.3', error: null, checkedAt: 1 } })).kind).toBe('none')
    expect(actionModel(st({ cli: { version: '0.9.3', latestVersion: null, error: null, checkedAt: 1 } })).kind).toBe('none')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/renderer/dashboard-view.test.js`
Expected: FAIL（`Cannot find module '../../src/renderer/ui/dashboard-view.js'`）

- [ ] **Step 3: 写实现**

```js
/* ================= Dashboard 卡片视图模型（纯函数；输入 AgentStatus（含回填后的 cli），输出展示模型） =================
 * 状态 × 展示 × 操作矩阵见 spec 2026-09-05-harness-status-detection-design.md 6.2；
 * 视觉参考：docs/superpowers/specs/2026-09-05-harness-card-redesign.html。
 * 主徽标仅反映配置检测；CLI 版本为弱化的次要信息，探测失败不影响任何状态。 */
import { isUpdateAvailable } from '../version.js';

/** (i) 提示文案：CLI 版本信息的适用范围说明（spec 6.4） */
export const CLI_INFO_TOOLTIP = '此信息通过本地命令行检测获得，仅适用于通过 CLI 安装的场景；如果你通过插件或桌面客户端使用，该信息不可用，但不影响 MCP / Skills / 提示词的管理功能。';

/** 主徽标模型：仅反映配置检测结果（已配置绿 / 未配置中性灰 / 加载中） */
export function badgeModel(status){
  if(!status) return { cls: 'loading', text: '…' };
  return status.configDetected
    ? { cls: 'ok', text: '已配置' }
    : { cls: 'off', text: '未配置' };
}

/** 次要信息区模型：未配置→配置目录；已配置→CLI 版本（可更新/已最新/未检测到/最新未知） */
export function secondaryModel(status){
  if(!status) return { label: 'CLI 版本', kind: 'skeleton', text: '…' };
  if(!status.configDetected){
    return { label: '配置目录', kind: 'dir', text: `${status.configPath} 未找到`,
      tooltip: status.error || status.configPath };
  }
  const cli = status.cli;
  if(!cli || !cli.version){
    return { label: 'CLI 版本', kind: 'note',
      text: '未检测到本地 CLI，可能通过 IDE 插件或桌面客户端使用', tooltip: CLI_INFO_TOOLTIP };
  }
  if(cli.latestVersion && isUpdateAvailable(cli.version, cli.latestVersion)){
    return { label: 'CLI 版本', kind: 'verline', version: cli.version, latest: cli.latestVersion };
  }
  if(cli.latestVersion){
    return { label: 'CLI 版本', kind: 'note-ok', text: `已是最新 CLI 版本 v${cli.version}` };
  }
  return { label: 'CLI 版本', kind: 'note', text: `${cli.version}（最新版本未知）`,
    tooltip: cli.error || 'npm registry 请求失败，最新版本未知' };
}

/** 操作区模型：未配置→查看安装选项；未检测到 CLI→查看安装方式；可更新→更新 CLI；其余无按钮 */
export function actionModel(status){
  if(!status) return { kind: 'loading', text: '…' };
  if(!status.configDetected) return { kind: 'docs', text: '查看安装选项', primary: true };
  const cli = status.cli;
  if(!cli || !cli.version) return { kind: 'docs', text: '查看安装方式', primary: false };
  if(cli.latestVersion && isUpdateAvailable(cli.version, cli.latestVersion)){
    return { kind: 'update', text: '更新 CLI', primary: true };
  }
  return { kind: 'none' };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/renderer/dashboard-view.test.js`
Expected: PASS（4 组 14 例全绿）

- [ ] **Step 5: 提交**

```bash
git add src/renderer/ui/dashboard-view.js tests/renderer/dashboard-view.test.js
git commit -m "feat: 新增 Dashboard 卡片视图模型纯函数"
```

---

### Task 5: 渲染层接线（state / main.js / dashboard.js / styles.css）

**Files:**
- Modify: `src/renderer/state.js`（第 9 行 `agentVersions` → `agentStatus`）
- Modify: `src/renderer/main.js`（6 行 import；64-67 行 init 区块）
- Modify: `src/renderer/ui/dashboard.js`（全文重写）
- Modify: `src/renderer/styles.css`（337-351 行 avc 样式区块替换）

**Interfaces:**
- Consumes: Task 3 的 `window.hub.detectAgentConfigs/probeCliVersion/openAgentDocs/installAgent`；Task 4 的 `badgeModel/secondaryModel/actionModel/CLI_INFO_TOOLTIP`；既有 `isUpdateAvailable`（经 dashboard-view 间接使用，dashboard.js 不再直接 import）、`savedPromptCount`、`icon`、`$`、`showToast`、`AGENTS`。
- Produces: `renderDashboard()`（行为不变签名）；新增导出 `refreshCliVersions()`（main.js init 与「刷新状态」按钮共用：并发探测全部 CLI 并逐个回填刷新）。

**TDD 例外声明（已按用户约束在方案中显式列出）：** 本任务为 DOM 组装与样式接线，沿用本项目渲染层惯例（`renderMatrix`/`renderPrompts` 等均无 DOM 单测，纯逻辑已全部抽入 Task 4 受测模块），验证方式为 Step 4 全量测试 + Step 5 手动运行清单。

- [ ] **Step 1: `src/renderer/state.js` 第 9 行替换**

```js
  agentStatus: null,    // hub.detectAgentConfigs() 返回的主状态数组（cli 槽位由探测异步回填；null=尚未加载）
```

- [ ] **Step 2: `src/renderer/ui/dashboard.js` 全文替换**

```js
/* ================= Dashboard（主状态=配置检测 hub.detectAgentConfigs；CLI 版本=次要信息通道，spec 2026-09-05） ================= */
import { AGENTS } from '../data.js';
import { icon } from '../icons.js';
import { $, showToast } from './common.js';
import { state } from '../state.js';
import { savedPromptCount } from './prompt-view.js';
import { actionModel, badgeModel, CLI_INFO_TOOLTIP, secondaryModel } from './dashboard-view.js';

/** 当前 agent 的主状态（未加载返回 null） */
function statusOf(agentId){
  return (state.agentStatus || []).find(s=>s.agentId===agentId) || null;
}

/** 并发探测全部 CLI 版本并逐个回填（不阻塞调用方；每完成一个刷新一次 Dashboard） */
export function refreshCliVersions(){
  AGENTS.forEach(a=>{
    window.hub.probeCliVersion(a.id).then(info=>{
      const s = (state.agentStatus || []).find(x=>x.agentId===a.id);
      if(s) s.cli = info;
      renderDashboard();
    }).catch(()=>{ /* 探测失败：cli 保持 null，卡片显示「未检测到本地 CLI」，不影响主状态 */ });
  });
}

function renderDashboard(){
  // 第一个统计卡「已配置 Harness」= 配置检测判定存在的 agent 数（本地同步检测，不依赖 CLI 探测/网络）
  $('stat-agents').textContent = (state.agentStatus || []).filter(s=>s.configDetected).length;
  $('stat-mcp').textContent = state.mcpItems.length;
  $('stat-skill').textContent = state.skillsItems.length;
  // 已保存提示词 = 各 harness saved 库总数（live 不落库、不参与计数）
  $('stat-prompt').textContent = savedPromptCount(state.promptsByAgent);

  $('dash-agent-grid').innerHTML = AGENTS.map(a=>{
    const v = statusOf(a.id);
    const mcp = state.mcpItems.filter(i=>i.apps[a.id]).length;
    const skill = state.skillsItems.filter(i=>i.apps[a.id]).length;
    const prompt = (state.promptsByAgent[a.id]||[]).length;
    const badge = badgeModel(v);
    const sub = secondaryModel(v);
    const act = actionModel(v);
    const subBody =
      sub.kind==='verline' ? `<div class="avc-verline"><span class="mono">${sub.version} → ${sub.latest}</span><span class="avc-badge upd">可更新</span></div>`
      : sub.kind==='dir' ? `<div class="avc-dir" title="${sub.tooltip}">${sub.text}</div>`
      : sub.kind==='note-ok' ? `<div class="avc-note ok">${sub.text}</div>`
      : sub.kind==='note' ? `<div class="avc-note" title="${sub.tooltip}" data-cli-note="1">ⓘ ${sub.text}</div>`
      : `<span>…</span>`;
    const actBody =
      act.kind==='loading' ? `<button class="btn btn-ghost btn-sm" disabled>…</button>`
      : act.kind==='none' ? ``
      : `<button class="btn ${act.primary?'btn-primary':'btn-ghost'} btn-sm" data-agent-action="${a.id}" data-action="${act.kind}">${act.text}${act.kind==='docs'?' ↗':''}</button>`;
    return `<div class="agent-ver-card">
      <div class="avc-head">
        ${icon(a.id, 24, a.name)}
        <div class="avc-name">${a.name}</div>
        <span class="avc-badge ${badge.cls}">${badge.text}</span>
      </div>
      <div class="avc-sub">
        <div class="sub-label">${sub.label}</div>
        ${subBody}
      </div>
      <div class="avc-meta">MCP ${mcp} · Skills ${skill} · 提示词 ${prompt}</div>
      <div class="avc-actions">${actBody}</div>
    </div>`;
  }).join('');

  // (i) 提示：hover 由 title 提供，点击以 toast 展示完整说明（spec 6.4）
  $('dash-agent-grid').querySelectorAll('[data-cli-note]').forEach(el=>{
    el.addEventListener('click', ()=> showToast(CLI_INFO_TOOLTIP));
  });

  // 更新 CLI / 查看安装方式 / 查看安装选项（更新中按钮保持禁用 + 文案，结束后以新状态重渲染）
  $('dash-agent-grid').querySelectorAll('[data-agent-action]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const agentId = btn.dataset.agentAction;
      const action = btn.dataset.action;
      const agent = AGENTS.find(a=>a.id===agentId);
      if(action==='docs'){
        btn.disabled = true;
        try {
          await window.hub.openAgentDocs(agentId);
        } catch (err) {
          showToast('操作失败：' + err.message);
        } finally {
          btn.disabled = false;
        }
        return;
      }
      btn.disabled = true;
      const orig = btn.textContent;
      btn.textContent = '更新中…';
      try {
        const info = await window.hub.installAgent(agentId);
        const s = statusOf(agentId);
        if(s) s.cli = info;
        renderDashboard();
        showToast(`已更新 ${agent.name} CLI（当前 ${info.version || '未知'}）`);
      } catch (err) {
        showToast('操作失败：' + err.message);
        btn.disabled = false;
        btn.textContent = orig;
      }
    });
  });
}

/* 概览区「刷新状态」按钮：先同步配置检测刷新主状态区，再并发 CLI 探测回填次要信息区（spec 6.3） */
$('btn-dash-refresh').addEventListener('click', async ()=>{
  const btn = $('btn-dash-refresh');
  btn.disabled = true;
  try {
    state.agentStatus = await window.hub.detectAgentConfigs();
    renderDashboard();
    showToast('已刷新 Harness 状态');
  } catch (err) {
    showToast('操作失败：' + err.message);
  } finally {
    btn.disabled = false;
  }
  refreshCliVersions();
});
```

> 模板字符串中嵌套的 `${sub.version} → ${sub.latest}` 含字面箭头，实施时照抄即可。

- [ ] **Step 3: `src/renderer/main.js` 修改**

第 6 行 import 改为：

```js
import { refreshCliVersions, renderDashboard } from './ui/dashboard.js';
```

64-67 行区块（原 `state.agentVersions = await window.hub.getAgentVersions();` 的 try/catch）替换为：

```js
  try {
    // Dashboard 主状态：配置检测（本地同步文件系统检测，先行展示；spec 4.1）
    state.agentStatus = await window.hub.detectAgentConfigs();
  } catch (err) { showToast('操作失败：' + err.message); }
  // CLI 版本探测：并发发起、不阻塞初始化（完成后逐个回填并刷新卡片次要信息区）
  refreshCliVersions();
```

- [ ] **Step 4: `src/renderer/styles.css` 337-351 行区块替换**

```css
  /* Dashboard 概览：状态卡片（主徽标=配置检测，次要区=CLI 版本信息；视觉参考 specs/2026-09-05-harness-card-redesign.html） */
  .agent-ver-card{border:1px solid var(--border-soft); border-radius:var(--radius); padding:16px 20px; background:var(--surface-2); display:flex; flex-direction:column; gap:10px;}
  .avc-head{display:flex; align-items:center; gap:10px;}
  .avc-name{font-size:13.5px; font-weight:600; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}
  .avc-badge{font-size:10px; font-weight:600; padding:2px 8px; border-radius:10px; flex-shrink:0;}
  .avc-badge.ok{color:var(--on); background:#E6F7EE;}
  .avc-badge.upd{color:#966A0B; background:#FEF6E7; border:1px solid #F3DFAE;}
  .avc-badge.off{color:var(--text-dim); background:var(--surface-3);}
  .avc-badge.loading{color:var(--text-faint); background:var(--surface-3);}
  .avc-sub{border-top:1px solid var(--border-soft); padding-top:10px; display:flex; flex-direction:column; gap:4px;}
  .avc-sub .sub-label{font-size:11px; color:var(--text-faint);}
  .avc-verline{display:flex; align-items:center; justify-content:space-between; gap:8px;}
  .avc-verline .mono{font-family:var(--font-mono); font-size:12px; color:var(--text-dim);}
  .avc-note{font-size:12px; color:var(--text-faint); line-height:1.5; cursor:help;}
  .avc-note.ok{color:var(--text-dim);}
  .avc-dir{font-family:var(--font-mono); font-size:12px; color:var(--text-faint);}
  .avc-meta{font-size:11px; color:var(--text-faint); font-family:var(--font-mono);}
  .avc-actions{display:flex; justify-content:flex-end;}
```

（被替换的原区块含 `.avc-badge.warn`、`.avc-row`、`.avc-row span`、`.avc-row .mono`、`.avc-ready`——均为本次改动产生的孤立样式，随区块一并移除。）

- [ ] **Step 5: 全量测试 + 构建**

Run: `npm test` 然后 `npm run build`
Expected: 全部测试通过（含 Task 1-4 及既有 20 个测试文件）；构建成功。

- [ ] **Step 6: 手动验证清单（`npm run dev`）**

1. Dashboard 统计卡显示「已配置 Harness N」，N 与本机实际（8 个 harness 的配置根目录 AND MCP 落点文件）一致，且**启动即正确、不等网络**。
2. 卡片两层结构：主徽标（已配置绿/未配置灰）；次要区 CLI 版本逐步异步出现；MCP/Skills/提示词计数行保留。
3. 本机装了 CLI 的 harness：`x.y.z → a.b.c` + 可更新 + [更新 CLI]；未装 CLI 但已配置：ⓘ 未检测到本地 CLI + [查看安装方式]。
4. 任一未配置 harness：`<绝对路径> 未找到` + [查看安装选项]；点击后默认浏览器打开 spec 6.2 URL 表中对应官网。
5. 「⟳ 刷新状态」：点击后主状态区立即刷新，CLI 信息随后逐个回填。
6. 拔网线/断网重试：主状态不受影响，CLI 区显示「未检测到本地 CLI」或「x.y.z（最新版本未知）」，无警示色、无「安装」按钮。
7. 回归：MCP 开关写入、Skills 开关、提示词另存为/应用 三页操作正常（不依赖版本探测）。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/state.js src/renderer/main.js src/renderer/ui/dashboard.js src/renderer/styles.css
git commit -m "feat: Dashboard 卡片按两层结构重构渲染（主状态+CLI 次要信息）"
```

---

### Task 6: 全量回归与 spec 验收核对

**Files:**
- 无新增改动（本任务为验证；若发现缺陷，修复须回到对应任务补测试后单独提交 `test:`/`fix:` 信息）

- [ ] **Step 1: 全量测试与构建**

Run: `npm test` 然后 `npm run build`
Expected: 全绿 / 构建成功。

- [ ] **Step 2: 残留扫描（旧语义清零）**

Run: `grep -rn "getAgentVersions\|probeZcode\|agentVersions\|installed" src/ --include="*.ts" --include="*.js"`
Expected: 无 `getAgentVersions`/`probeZcode`/`agentVersions` 命中；`installed` 仅允许出现在 Skills 发现页无关语义处（`installed-badge`、`SKILLS_INSTALLED`、skills 状态筛选），不得出现在 Dashboard 版本语义中。

- [ ] **Step 3: 对照 spec 九节验收清单逐条核对**

- 全部 8 个 harness 判定基于 4.1 规则、无 Zcode 专属分支（Task 1/2 测试 + Step 2 扫描）
- 仅提示词文件存在 → 未配置（Task 1 用例）
- CLI 探测失败不影响主徽标、无警示色、无「安装」按钮（Task 4 用例 + Task 5 Step 6.6 手动）
- 统计数字不依赖网络（Task 1 同步实现 + Task 5 Step 6.1 手动）
- 目录覆盖后检测路径同步生效（Task 1 用例）
- 「刷新状态」主状态先行（Task 5 实现 + Step 6.5 手动）
- [更新 CLI] 回填次要区 / [查看安装*] 打开官网（Task 5 Step 6.4 手动）
- MCP/Skills/提示词回归（Task 5 Step 6.7 手动 + `npm test` 全绿）

- [ ] **Step 4: 收尾**

若全部通过，无需提交；若产生修复，按所属任务单独提交并在报告披露。
