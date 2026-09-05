# ZCode Harness 支持实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 harness-hub 新增第 8 个 harness「ZCode」（置于 OpenCode 之后），支持 MCP / Skills / 提示词 / Dashboard 全链路管理与扫描同步。

**Architecture:** 沿用既有 harness 对称结构：`AgentId` 联合类型 + `AGENTS` 元信息数组为主进程唯一清单源，渲染层 `data.js` 的 `AGENTS` 为展示副本；MCP 写入经 `adapters/json.ts` 新增 `zcode` kind（嵌套键 `mcp.servers`）；Skills / 提示词走通用 `skillsDir` / `promptFile` 管线零逻辑改动；Dashboard 版本探测对 ZCode（桌面应用、无 CLI/npm 包）改用配置目录存在性判定。

**Tech Stack:** Electron + electron-vite + TypeScript（主进程）/ vanilla JS（渲染层）/ vitest 单测；无新依赖。

**Spec:** 本计划自带完整设计（来源：2026-09-05 会话中的设计陈述与用户确认）。关键外部依据：ZCode 官方文档 MCP 配置格式 https://zcode.z.ai/cn/docs/mcp-services 、Skill 目录约定 https://zcode.z.ai/cn/docs/skill ；本机实测 `~/.zcode/`（含 `cli/config.json`、`AGENTS.md`）与图标文件 `C:\Users\admin\AppData\Local\Programs\ZCode\resources\icon_windows.png`（1024×1024 PNG）。

## Global Constraints

- **提交信息**：中文 + Conventional Commits 英文类型前缀，形如 `feat: 新增 ZCode harness 核心定义`。
- **最小改动**：只动 ZCode 相关行与「7→8」文案；不顺手重构、不触发文件级格式化；无关死代码不动（`src/renderer/format.js` 的 `specPreview` 是无人引用的死代码，保持原样）。
- **TDD**：先写失败测试再写实现。
- **harness 顺序**（固定，DSH 置顶）：DSH → OpenCode → **ZCode** → Codex → Claude Code → Grok → Gemini CLI → Hermes。
- **ZCode 落点**：`dir: ~/.zcode`、`mcpPath: ~/.zcode/cli/config.json`（`mcpFormat: 'json'`，MCP 键为嵌套 `mcp.servers`）、`skillsDir: ~/.zcode/skills`、`promptFile: ~/.zcode/AGENTS.md`。
- **ZCode MCP 条目格式**（官方文档确认）：stdio → `{ command, args?, env? }`（不写 type）；远程 → `{ type: 'http'|'sse', url, headers? }`；读取时忽略 `enable` 字段（条目存在即视为已配置，与 opencode 对 `enabled` 的处理对称）；`mcp` 键下的 `servers` 之外的所有键（如 `plugins`）与其他顶层键原样保留。
- **版本探测**：ZCode 无 CLI 二进制、无 npm 包（本机实测 + 官方仅桌面应用分发），按 `resolveAgentPaths('zcode', dirOverrides).root` 目录存在性判定 installed；版本恒为 `null`（界面显示「—」/「未知」）；安装按钮触发时抛可读错误引导官网下载。
- **兼容性**：项目未发布、无存量数据（仓库级 AGENTS.md），无需迁移。
- **每个任务结束时跑全量 `pnpm test` 保证绿**（纯单测，秒级）。

## 范围外（明确不做，最终报告中披露）

1. `scripts/smoke-g3.js`：该脚本引用提示词 v2 模型已删除的 `enabled` 字段（对照 `src/main/types.ts` 的 `PromptItem`），早已过期且不属于 `npm test` 组成部分，本次不更新其 7→8 计数。
2. `src/renderer/format.js` 的 `specPreview`：死代码（真实预览走主进程 `previewMcp`），不补 zcode 分支。

## 文件结构总览

| 文件 | 改动 | 职责 |
|---|---|---|
| `src/main/types.ts` | 修改 | `AgentId` 联合加 `'zcode'` |
| `src/main/paths.ts` | 修改 | `AGENTS` 数组插入 zcode（第 3 位）+ 注释 7→8 |
| `src/main/store.ts` | 修改 | 默认 `prompts.zcode: []` |
| `src/main/adapters/json.ts` | 修改 | 新增 zcode kind：嵌套键读写删 + 条目双向转换 |
| `src/main/services/mcp.ts` | 修改 | adapter 分发 cast 扩宽 + `previewJson` zcode 分支 |
| `src/main/services/agents-version.ts` | 修改 | `AGENT_TOOL_META` 可空 npm/install + `probeZcode` 目录探测 |
| `src/main/ipc.ts` / `src/main/services/skill-io.ts` | 修改 | 仅注释 7→8 |
| `src/renderer/data.js` | 修改 | 渲染层 `AGENTS` 副本插入 zcode + 注释 7→8 |
| `src/renderer/icons.js` | 修改 | `ICONS.zcode`（base64 PNG） |
| `src/renderer/index.html` / `src/renderer/main.js` | 修改 | Dashboard 副标题 7→8 |
| `src/renderer/ui/dashboard.js` | 修改 | 「已安装（无版本可探）」徽标变体 |
| `package.json` | 修改 | description 7→8 |
| `docs/设计文档.md` / `docs/设计原型.html` | 修改 | 表格/清单/mock/文案同步 |
| `build/zcode-icon.png` | 新增 | ZCode 品牌图标原图（源自安装目录） |
| 各 `tests/**` | 修改 | 清单/夹具/新断言 |

---

### Task 1: 核心定义层（types / paths / store）

**Files:**
- Modify: `src/main/types.ts:2-3`
- Modify: `src/main/paths.ts:1,49-76`
- Modify: `src/main/store.ts:26-34`
- Test: `tests/paths.test.ts`、`tests/store.test.ts`
- Test(最小夹具): `tests/services/mcp.test.ts:23-34,92-186`（仅加 MCP_FILE_NAME + FIXTURES 条目，防止 beforeEach 对 8 个 AGENTS 写 fixture 时 undefined 崩溃；断言在 Task 3 补）

**Interfaces:**
- Produces: `AgentId` 联合含 `'zcode'`；`AGENTS` 数组第 3 位 `{ id: 'zcode', name: 'ZCode', short: 'ZCode', dir: '~/.zcode', mcpPath: '~/.zcode/cli/config.json', mcpFormat: 'json', skillsDir: '~/.zcode/skills', promptFile: '~/.zcode/AGENTS.md' }`；`defaultStore().prompts.zcode = []`。后续所有任务依赖此清单。

- [ ] **Step 1: 写失败测试（paths.test.ts）**

`tests/paths.test.ts` 三处修改：

① 「包含 7 个 harness 且顺序固定 DSH 置顶」改为 8 个并更新顺序断言：

```ts
  it('包含 8 个 harness 且顺序固定 DSH 置顶', () => {
    expect(AGENTS.map((a) => a.id)).toEqual([
      'dsh',
      'opencode',
      'zcode',
      'codex',
      'claude',
      'grok',
      'gemini',
      'hermes'
    ])
  })
```

② 默认落点 expected 表中 `opencode` 条目之后追加：

```ts
      zcode: {
        dir: '~/.zcode',
        mcpPath: '~/.zcode/cli/config.json',
        mcpFormat: 'json',
        skillsDir: '~/.zcode/skills',
        promptFile: '~/.zcode/AGENTS.md'
      },
```

同测试内 `expect(AGENTS).toHaveLength(7)` 改为 `expect(AGENTS).toHaveLength(8)`。

③ 「codex / gemini / grok / opencode / hermes 默认落点」测试中追加：

```ts
    expect(resolveAgentPaths('zcode', {}, WIN_ENV)).toEqual({
      root: path.join(HOME, '.zcode'),
      mcpPath: path.join(HOME, '.zcode', 'cli', 'config.json'),
      skillsDir: path.join(HOME, '.zcode', 'skills'),
      promptFile: path.join(HOME, '.zcode', 'AGENTS.md')
    })
```

「resolveAgentPaths 目录覆盖」describe 中追加：

```ts
  it('zcode 覆盖 D:\\z -> MCP 落点 = <覆盖>/cli/config.json（相对结构保留，无特例）', () => {
    const o = resolveAgentPaths('zcode', { zcode: 'D:\\z' }, WIN_ENV)
    expect(o.root).toBe('D:\\z')
    expect(o.mcpPath).toBe(path.join('D:\\z', 'cli', 'config.json'))
    expect(o.skillsDir).toBe(path.join('D:\\z', 'skills'))
    expect(o.promptFile).toBe(path.join('D:\\z', 'AGENTS.md'))
  })
```

- [ ] **Step 2: 写失败测试（store.test.ts）**

`tests/store.test.ts` 第 17 行 AGENT_IDS 追加 `'zcode'`（顺序任意，追加在 `'opencode'` 后）：

```ts
const AGENT_IDS = ['dsh', 'claude', 'codex', 'gemini', 'grok', 'opencode', 'zcode', 'hermes'] as const
```

同时第 19 行注释「prompts 七键空数组」改为「prompts 八键空数组」。

- [ ] **Step 3: 写失败测试（mcp.test.ts 最小夹具）**

`tests/services/mcp.test.ts`：

① 第 23 行 AGENT_IDS 追加 `'zcode'`（`'opencode'` 之后）：

```ts
const AGENT_IDS: AgentId[] = ['dsh', 'claude', 'codex', 'gemini', 'grok', 'opencode', 'zcode', 'hermes']
```

② 第 26-34 行 MCP_FILE_NAME 追加（对齐 resolveAgentPaths 相对结构）：

```ts
  zcode: 'cli/config.json',
```

③ FIXTURES（第 92 行起）在 `opencode` 条目后追加（镜像本机真实 `~/.zcode/cli/config.json`：含 plugins 键 + mcp.servers.memory 条目）：

```ts
  zcode: `{
  "plugins": {
    "enabledPlugins": {
      "superpowers@claude-plugins-official": true
    }
  },
  "mcp": {
    "servers": {
      "memory": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-memory"],
        "env": {}
      }
    }
  }
}
`,
```

- [ ] **Step 4: 运行测试确认失败**

Run: `pnpm vitest run tests/paths.test.ts tests/store.test.ts`
Expected: FAIL —— AGENTS 长度 7≠8、顺序不含 zcode、defaultStore 缺 zcode 键。

- [ ] **Step 5: 实现**

① `src/main/types.ts` 第 2 行联合追加 `'zcode'`（置于 `'opencode'` 后），第 3 行注释「7 个 harness」→「8 个 harness」：

```ts
export type AgentId = 'dsh'|'claude'|'codex'|'gemini'|'grok'|'opencode'|'zcode'|'hermes';
/** Skills 部署目标：8 个 harness，或 Agent Skills 共享目录（~/.agents/skills） */
```

② `src/main/paths.ts`：第 1 行注释「7 harness 落点」→「8 harness 落点」；第 49 行注释「7 harness 元信息」→「8 harness 元信息」；在 opencode 条目（第 58-60 行）之后插入：

```ts
  { id: 'zcode', name: 'ZCode', short: 'ZCode', dir: '~/.zcode',
    mcpPath: '~/.zcode/cli/config.json', mcpFormat: 'json',
    skillsDir: '~/.zcode/skills', promptFile: '~/.zcode/AGENTS.md' },
```

③ `src/main/store.ts` defaultStore 中 `opencode: [],` 之后插入一行 `zcode: [],`。

- [ ] **Step 6: 运行全量测试确认通过**

Run: `pnpm test`
Expected: PASS（全部测试文件）。若 `tests/services/mcp.test.ts` 的 beforeEach 报 FIXTURES 缺键，说明 Step 3 未完成。

- [ ] **Step 7: 提交**

```bash
git add src/main/types.ts src/main/paths.ts src/main/store.ts tests/paths.test.ts tests/store.test.ts tests/services/mcp.test.ts
git commit -m "feat: 新增 ZCode harness 核心定义（类型/路径/默认提示词库）"
```

---

### Task 2: JSON adapter 支持 zcode kind（mcp.servers 嵌套键）

**Files:**
- Modify: `src/main/adapters/json.ts`
- Test: `tests/adapters/json.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `AgentId`（无直接依赖，纯 adapter 层）。
- Produces: `readJsonMcp / writeJsonMcpEntry / removeJsonMcpEntry` 的 `kind` 参数接受 `'zcode'`；`export function specToZcode(spec: McpSpec): Record<string, unknown>`（Task 3 的 `previewJson` 使用）。

- [ ] **Step 1: 写失败测试**

`tests/adapters/json.test.ts` 文件末尾追加（复用文件顶部已有的 `stdioSpec` / `httpSpec` / `readRaw`）：

```ts
describe('zcode（mcp.servers 嵌套键，stdio/远程双向转换）', () => {
  it('读取：stdio/远程条目 -> 统一 spec（忽略 enable 字段），plugins 等无关键不影响', async () => {
    const file = path.join(tmp, 'cli', 'config.json')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(
      file,
      JSON.stringify({
        plugins: { enabledPlugins: { demo: true } },
        mcp: {
          servers: {
            memory: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], env: { K: 'V' }, enable: false },
            vision: { type: 'http', url: 'https://mcp.example.com/vision', headers: { Authorization: 'Bearer t' } }
          }
        }
      }),
      'utf8'
    )
    expect(await readJsonMcp(file, 'zcode')).toEqual({
      memory: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
        env: { K: 'V' }
      },
      vision: {
        type: 'http',
        url: 'https://mcp.example.com/vision',
        headers: { Authorization: 'Bearer t' }
      }
    })
  })

  it('文件不存在返回 {}；mcp 存在但 servers 缺失返回 {}', async () => {
    expect(await readJsonMcp(path.join(tmp, 'none', 'config.json'), 'zcode')).toEqual({})
    const file = path.join(tmp, 'mcp-no-servers.json')
    await fs.writeFile(file, JSON.stringify({ mcp: {} }), 'utf8')
    expect(await readJsonMcp(file, 'zcode')).toEqual({})
  })

  it('写入 stdio：落 mcp.servers.<id>（无 type / enable 字段），plugins 等顶层键保留', async () => {
    const file = path.join(tmp, 'zcode-config.json')
    await fs.writeFile(file, JSON.stringify({ plugins: { a: 1 } }), 'utf8')
    await writeJsonMcpEntry(file, 'memory', stdioSpec, 'zcode', path.join(tmp, 'backups'))
    const raw = await readRaw(file)
    expect((raw as { mcp: { servers: Record<string, unknown> } }).mcp.servers.memory).toEqual({
      command: 'npx',
      args: ['-y', 'filesystem'],
      env: { FOO: 'bar' }
    })
    expect(raw['plugins']).toEqual({ a: 1 })
  })

  it('写入 http/sse：条目含 type + url + headers', async () => {
    const file = path.join(tmp, 'zcode-http.json')
    await writeJsonMcpEntry(file, 'tavily', httpSpec, 'zcode', path.join(tmp, 'backups'))
    const raw = await readRaw(file)
    expect((raw as { mcp: { servers: Record<string, unknown> } }).mcp.servers.tavily).toEqual({
      type: 'http',
      url: httpSpec.url,
      headers: { Authorization: 'Bearer token' }
    })
  })

  it('往返：stdio 无损还原；type=sse 读取为 sse', async () => {
    const file = path.join(tmp, 'zcode-roundtrip.json')
    await writeJsonMcpEntry(file, 'a', stdioSpec, 'zcode', path.join(tmp, 'backups'))
    await writeJsonMcpEntry(file, 'b', { type: 'sse', url: 'https://s.example/sse' }, 'zcode', path.join(tmp, 'backups'))
    const read = await readJsonMcp(file, 'zcode')
    expect(read.a).toEqual(stdioSpec)
    expect(read.b).toEqual({ type: 'sse', url: 'https://s.example/sse' })
  })

  it('覆盖与删除：条目替换 / 条目移除，其余条目与键保留', async () => {
    const file = path.join(tmp, 'zcode-crud.json')
    const backupDir = path.join(tmp, 'backups')
    await writeJsonMcpEntry(file, 'a', stdioSpec, 'zcode', backupDir)
    await writeJsonMcpEntry(file, 'b', httpSpec, 'zcode', backupDir)
    await writeJsonMcpEntry(file, 'a', { type: 'stdio', command: 'uvx' }, 'zcode', backupDir)
    let read = await readJsonMcp(file, 'zcode')
    expect(read.a).toEqual({ type: 'stdio', command: 'uvx' })
    expect(read.b).toEqual(httpSpec)

    await removeJsonMcpEntry(file, 'a', 'zcode', backupDir)
    read = await readJsonMcp(file, 'zcode')
    expect(read.a).toBeUndefined()
    expect(read.b).toEqual(httpSpec)
  })

  it('mcp 键为非对象时写入抛错（宁可不改不破坏）', async () => {
    const file = path.join(tmp, 'zcode-bad.json')
    await fs.writeFile(file, JSON.stringify({ mcp: 'oops' }), 'utf8')
    await expect(
      writeJsonMcpEntry(file, 'x', stdioSpec, 'zcode', path.join(tmp, 'backups'))
    ).rejects.toThrow(/mcp/)
  })
})
```

同时更新文件第 1 行头注释：`—— D1: claude/gemini/opencode JSON MCP adapters` → `—— D1: claude/gemini/opencode/zcode JSON MCP adapters`。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/adapters/json.test.ts`
Expected: FAIL —— `readJsonMcp(file, 'zcode')` 类型/运行错误或返回 `{}` 断言不匹配。

- [ ] **Step 3: 实现 `src/main/adapters/json.ts`**

① 文件头注释更新：

```ts
// src/main/adapters/json.ts —— D1: claude/gemini/opencode/zcode 的 JSON 形态 MCP 增删读
// claude/gemini: mcpServers 键，统一 spec 原样存取；opencode: mcp 键，local/remote 双向转换；
// zcode: mcp.servers 嵌套键（对齐官方文档 https://zcode.z.ai/cn/docs/mcp-services）
```

② `JsonKind` 与 KIND_KEY（第 7-13 行）改为（KIND_KEY 不含 zcode，zcode 走专用两级键路径）：

```ts
type JsonKind = 'claude' | 'gemini' | 'opencode' | 'zcode'

const KIND_KEY: Record<'claude' | 'gemini' | 'opencode', string> = {
  claude: 'mcpServers',
  gemini: 'mcpServers',
  opencode: 'mcp'
}
```

③ 在 `openCodeToSpec` 函数之后追加 zcode 转换与键路径辅助：

```ts
/** 统一 McpSpec -> zcode 写入条目：stdio -> {command,args?,env?}（不写 type，对齐官方示例）；远程 -> {type,url,headers?} */
export function specToZcode(spec: McpSpec): Record<string, unknown> {
  if (spec.type === 'stdio') {
    const entry: Record<string, unknown> = { command: spec.command ?? '' }
    if (spec.args && spec.args.length > 0) entry['args'] = spec.args
    if (spec.env && Object.keys(spec.env).length > 0) entry['env'] = spec.env
    return entry
  }
  const entry: Record<string, unknown> = { type: spec.type, url: spec.url ?? '' }
  if (spec.headers && Object.keys(spec.headers).length > 0) entry['headers'] = spec.headers
  return entry
}

/** zcode 读取逆向：有 command -> stdio；有 url -> http/sse（type 缺省按 http）；均无返回 null（调用方跳过该条） */
function zcodeToSpec(entry: Record<string, unknown>): McpSpec | null {
  if (typeof entry['command'] === 'string' && entry['command']) {
    const spec: McpSpec = { type: 'stdio', command: entry['command'] }
    if (Array.isArray(entry['args'])) {
      spec.args = entry['args'].filter((a): a is string => typeof a === 'string')
    }
    const env = entry['env']
    if (env && typeof env === 'object' && !Array.isArray(env)) {
      spec.env = env as Record<string, string>
    }
    return spec
  }
  if (typeof entry['url'] === 'string' && entry['url']) {
    const spec: McpSpec = { type: entry['type'] === 'sse' ? 'sse' : 'http', url: entry['url'] }
    const headers = entry['headers']
    if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
      spec.headers = headers as Record<string, string>
    }
    return spec
  }
  return null
}

/** zcode 读取侧：取 obj.mcp.servers（任一级缺失/非对象返回 null） */
function readZcodeMap(obj: Record<string, unknown>): Record<string, unknown> | null {
  const mcp = obj['mcp']
  if (typeof mcp !== 'object' || mcp === null || Array.isArray(mcp)) return null
  const servers = (mcp as Record<string, unknown>)['servers']
  if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) return null
  return servers as Record<string, unknown>
}

/** zcode 写入侧：确保 mcp / mcp.servers 两级对象存在并返回 servers map（已存在但非对象抛错） */
function ensureZcodeMap(obj: Record<string, unknown>): Record<string, unknown> {
  const mcp = ensureObjectMap(obj, 'mcp')
  return ensureObjectMap(mcp, 'servers')
}
```

④ `readJsonMcp`（第 98-111 行）改为：

```ts
export async function readJsonMcp(
  filePath: string,
  kind: JsonKind
): Promise<Record<string, McpSpec>> {
  const obj = await readJsonObject(filePath)
  const rawMap = kind === 'zcode' ? readZcodeMap(obj) : obj[KIND_KEY[kind]]
  if (typeof rawMap !== 'object' || rawMap === null || Array.isArray(rawMap)) return {}
  const out: Record<string, McpSpec> = {}
  for (const [id, entry] of Object.entries(rawMap as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    if (kind === 'opencode') {
      out[id] = openCodeToSpec(entry as Record<string, unknown>)
    } else if (kind === 'zcode') {
      const spec = zcodeToSpec(entry as Record<string, unknown>)
      if (spec) out[id] = spec
    } else {
      out[id] = entry as McpSpec
    }
  }
  return out
}
```

⑤ `writeJsonMcpEntry`（第 117-131 行）核心两行改为：

```ts
  const obj = await readJsonObject(filePath)
  const map = kind === 'zcode' ? ensureZcodeMap(obj) : ensureObjectMap(obj, KIND_KEY[kind])
  map[id] = kind === 'opencode' ? specToOpenCode(spec) : kind === 'zcode' ? specToZcode(spec) : spec
```

⑥ `removeJsonMcpEntry`（第 137-152 行）取 existing 一行改为：

```ts
  const existing = kind === 'zcode' ? readZcodeMap(obj) : obj[KIND_KEY[kind]]
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm vitest run tests/adapters/json.test.ts`
Expected: PASS（含新增 zcode describe 全部用例）。

- [ ] **Step 5: 提交**

```bash
git add src/main/adapters/json.ts tests/adapters/json.test.ts
git commit -m "feat: JSON adapter 支持 ZCode mcp.servers 嵌套键读写"
```

---

### Task 3: MCP service 接线（adapter 分发 + 预览）与业务流断言

**Files:**
- Modify: `src/main/services/mcp.ts:49-79,301-305`
- Test: `tests/services/mcp.test.ts`（在 Task 1 已加夹具的基础上补断言）

**Interfaces:**
- Consumes: Task 2 的 JsonKind 含 `'zcode'` 与导出的 `specToZcode`；Task 1 的 AGENTS zcode 条目。
- Produces: `toggleMcp / saveMcp / bulkToggleMcp / deleteMcp / importMcpFromHarnesses / previewMcp` 对 `agentId='zcode'` 全部可用（渲染层无感知）。

- [ ] **Step 1: 写失败测试**

`tests/services/mcp.test.ts` 三处扩展：

① 「toggleMcp 开启」测试：`await toggleMcp('dbx', 'hermes', true, ctx)` 之后追加一行：

```ts
    await toggleMcp('tavily', 'zcode', true, ctx)
```

在 opencode 断言块之后追加断言，并把 apps 断言扩展：

```ts
    // zcode json：mcp.servers.tavily（远程条目 type+url）；plugins 键与 memory 条目保留
    const zcode = JSON.parse(await fs.readFile(pathOf('zcode'), 'utf8'))
    expect(zcode.mcp.servers.tavily).toEqual({
      type: 'http',
      url: 'https://mcp.example.com/tavily?key=testKey'
    })
    expect(zcode.mcp.servers.memory).toBeDefined()
    expect(zcode.plugins).toBeDefined()
```

末尾 apps 断言改为：

```ts
    expect(tv.apps).toEqual({ dsh: true, codex: true, grok: true, zcode: true })
    expect(db.apps).toEqual({ claude: true, gemini: true, opencode: true, hermes: true })
```

② 「toggleMcp 关闭」测试：两个 for 循环的 agent 列表由 `['dsh', 'claude', 'codex', 'hermes']` 扩为 `['dsh', 'claude', 'codex', 'hermes', 'zcode']`，并在 hermes 断言后追加：

```ts
    // zcode json：条目移除、memory 条目与 plugins 键保留
    const zcode = JSON.parse(await fs.readFile(pathOf('zcode'), 'utf8'))
    expect(zcode.mcp.servers.tavily).toBeUndefined()
    expect(zcode.mcp.servers.memory).toBeDefined()
    expect(zcode.plugins).toBeDefined()
```

③ 「导入新条目」测试：`writeImportFixtures` 的 `files` 对象追加 zcode 条目：

```ts
      zcode: `{
  "mcp": {
    "servers": {
      "vision": {
        "command": "npx",
        "args": ["-y", "zai-mcp-server"],
        "enable": false
      }
    }
  }
}
`,
```

`res.added` 排序断言改为：

```ts
    expect(res.added.map((i) => i.id).sort()).toEqual([
      'brave',
      'docker',
      'fetch',
      'filesystem',
      'github',
      'vision',
      'weather'
    ])
```

apps 断言区追加（enable:false 条目仍导入——enable 字段被忽略，与 opencode 对称）：

```ts
    expect(items.find((i) => i.id === 'vision')?.apps).toEqual({ zcode: true })
```

④ 「previewMcp」测试追加：

```ts
    const zcodePreview = await previewMcp('dbx', 'zcode', ctx)
    expect(zcodePreview).toContain('"servers"')
    expect(zcodePreview).toContain('"command": "npx"')
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/services/mcp.test.ts`
Expected: FAIL —— zcode 走 claude/gemini 分支读不到 mcp.servers / 预览缺 servers 键。

- [ ] **Step 3: 实现 `src/main/services/mcp.ts`**

① 导入 `specToZcode`（第 7-11 行的 json 导入块追加）：

```ts
import {
  readJsonMcp,
  removeJsonMcpEntry,
  specToZcode,
  writeJsonMcpEntry
} from '../adapters/json'
```

② `adapterFor` 的 json 分支 cast 扩宽（第 57-63 行）：

```ts
    case 'json': {
      const kind = agentId as 'claude' | 'gemini' | 'opencode' | 'zcode'
      return {
        read: (p) => readJsonMcp(p, kind),
        write: (p, id, spec, b) => writeJsonMcpEntry(p, id, spec, kind, b),
        remove: (p, id, b) => removeJsonMcpEntry(p, id, kind, b)
      }
    }
```

③ 分发注释（第 49-52 行）更新为：

```ts
 * adapter 分发：json -> claude/gemini/opencode/zcode（D1 kind 参数）、
```

④ `previewJson`（第 301-305 行）改为：

```ts
/** JSON 预览：claude/gemini 用 mcpServers，opencode 用 mcp，zcode 用 mcp.servers（条目经转换） */
function previewJson(id: string, spec: McpSpec, agentId: AgentId): string {
  if (agentId === 'zcode') {
    return JSON.stringify({ mcp: { servers: { [id]: specToZcode(spec) } } }, null, 2)
  }
  const key = agentId === 'opencode' ? 'mcp' : 'mcpServers'
  return JSON.stringify({ [key]: { [id]: spec } }, null, 2)
}
```

- [ ] **Step 4: 运行全量测试确认通过**

Run: `pnpm test`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/main/services/mcp.ts tests/services/mcp.test.ts
git commit -m "feat: MCP service 接入 ZCode 分发与预览"
```

---

### Task 4: Dashboard 版本探测支持 ZCode（目录存在性判定）

**Files:**
- Modify: `src/main/services/agents-version.ts`
- Test: `tests/agents-version.test.ts`

**Interfaces:**
- Consumes: Task 1 的 AGENTS zcode 条目与 `resolveAgentPaths`（来自 `../paths`）。
- Produces: `AGENT_TOOL_META: Record<AgentId, { bin: string; npm: string | null; install: string | null }>`（zcode 后两项为 null）；`probeZcode(root: string): ProbeResult`；`getAgentVersions` 对 zcode 返回 `{ version: null, latestVersion: null, installed: <目录存在>, error: <缺失时可读错误> }`；`installAgent('zcode')` 抛可读错误（渲染层 toast 引导官网）。`ProbeResult = { version: string | null; error: string | null; installed: boolean }`（`probeLocalVersion` 返回形状同步变化，外部仅 `getAgentVersions` 消费）。

- [ ] **Step 1: 写失败测试**

`tests/agents-version.test.ts`：

① 导入块与顶部 fixture 扩展：

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  AGENT_TOOL_META,
  extractVersion,
  parseNpmLatestResponse,
  probeZcode
} from '../src/main/services/agents-version'

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-ver-'))
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})
```

② 原「覆盖全部 7 个 agent」测试改为：

```ts
describe('AGENT_TOOL_META', () => {
  it('覆盖全部 8 个 agent：CLI 型含 npm 包与安装命令，zcode 为桌面应用（null）', () => {
    for (const id of ['dsh', 'claude', 'codex', 'gemini', 'grok', 'opencode', 'hermes'] as const) {
      expect(AGENT_TOOL_META[id]).toBeDefined()
      expect(AGENT_TOOL_META[id].bin.length).toBeGreaterThan(0)
      expect(AGENT_TOOL_META[id].npm!.length).toBeGreaterThan(0)
      expect(AGENT_TOOL_META[id].install).toContain('npm')
    }
    expect(AGENT_TOOL_META.zcode).toEqual({ bin: 'zcode', npm: null, install: null })
    expect(AGENT_TOOL_META.dsh.install).toBe('npm install -g @deepseek-ai/dsh')
  })
})

describe('probeZcode', () => {
  it('配置目录存在 -> installed: true、version: null、无错误', async () => {
    const root = path.join(tmp, '.zcode')
    await fs.mkdir(root, { recursive: true })
    expect(probeZcode(root)).toEqual({ version: null, error: null, installed: true })
  })

  it('配置目录缺失 -> installed: false、错误信息含 ZCode 与路径', () => {
    const root = path.join(tmp, 'nope')
    const res = probeZcode(root)
    expect(res.installed).toBe(false)
    expect(res.version).toBeNull()
    expect(res.error).toContain('ZCode')
    expect(res.error).toContain(root)
  })
})
```

③ 文件头注释更新为「—— Dashboard 版本探测的纯函数（extractVersion / parseNpmLatestResponse / probeZcode / 元数据）」。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm vitest run tests/agents-version.test.ts`
Expected: FAIL —— `AGENT_TOOL_META.zcode` undefined / `probeZcode` 未导出。

- [ ] **Step 3: 实现 `src/main/services/agents-version.ts`**

① 导入区追加：

```ts
import fs from 'node:fs'
import { resolveAgentPaths, settingsFile } from '../paths'
import { loadSettings } from '../store'
```

② 头注释（第 6 行）改为：

```ts
// 本实现除 zcode（桌面应用：无 CLI/npm 包，按配置目录存在性探测、安装引导官网下载）外，其余 7 个 harness 走 npm。
```

③ `AGENT_TOOL_META` 类型与 zcode 条目（第 20-28 行）：

```ts
export const AGENT_TOOL_META: Record<
  AgentId,
  { bin: string; npm: string | null; install: string | null }
> = {
  dsh: { bin: 'dsh', npm: '@deepseek-ai/dsh', install: 'npm install -g @deepseek-ai/dsh' },
  claude: { bin: 'claude', npm: '@anthropic-ai/claude-code', install: 'npm i -g @anthropic-ai/claude-code@latest' },
  codex: { bin: 'codex', npm: '@openai/codex', install: 'npm i -g @openai/codex@latest' },
  gemini: { bin: 'gemini', npm: '@google/gemini-cli', install: 'npm i -g @google/gemini-cli@latest' },
  grok: { bin: 'grok', npm: '@xai-official/grok', install: 'npm i -g @xai-official/grok@latest' },
  opencode: { bin: 'opencode', npm: 'opencode-ai', install: 'npm i -g opencode-ai@latest' },
  zcode: { bin: 'zcode', npm: null, install: null },
  hermes: { bin: 'hermes', npm: 'hermes-agent', install: 'npm i -g hermes-agent@latest' }
}
```

④ 新增探测结果类型与 `probeZcode`（置于 `probeLocalVersion` 之前）：

```ts
/** 版本探测结果（installed 与 version 解耦：zcode 目录存在但版本不可探） */
export interface ProbeResult {
  version: string | null
  error: string | null
  installed: boolean
}
```

`probeLocalVersion` 的返回改为 `Promise<ProbeResult>`（三处 return 语句补 `installed` 字段）：

```ts
export async function probeLocalVersion(bin: string): Promise<ProbeResult> {
  try {
    const { stdout, stderr } = await runCommand(`${bin} --version`, PROBE_TIMEOUT_MS)
    const raw = `${stdout}\n${stderr}`.trim()
    const version = extractVersion(raw)
    return version
      ? { version, error: null, installed: true }
      : { version: null, error: `已找到 ${bin} 但未能从输出解析版本号`, installed: false }
  } catch (err) {
    const e = err as { code?: unknown; message?: string }
    const code = e.code
    const msg = String(e.message ?? '')
    // Windows cmd 找不到命令：exit 1 + 「不是内部或外部命令」；POSIX：127 / ENOENT
    if (code === 'ENOENT' || code === 127 || /not (recognized|found)|不是内部或外部命令|无法识别/.test(msg)) {
      return { version: null, error: `${bin} 未安装或不在 PATH 中`, installed: false }
    }
    return { version: null, error: `${bin} --version 执行失败：${msg.split('\n').pop() ?? msg}`, installed: false }
  }
}

/** zcode 桌面应用探测：无 CLI / npm 包，按配置目录存在性判定；版本恒为 null（无法探测） */
export function probeZcode(root: string): ProbeResult {
  try {
    if (fs.statSync(root).isDirectory()) return { version: null, error: null, installed: true }
  } catch {
    // fallthrough
  }
  return { version: null, error: `未检测到 ZCode 的配置目录（${root}）`, installed: false }
}
```

⑤ `getAgentVersions` 的探测并发块（第 110-127 行）改为：

```ts
  const entries = await Promise.all(
    targets.map(async (agentId) => {
      const meta = AGENT_TOOL_META[agentId]
      if (!meta) return null
      const probe = agentId === 'zcode'
        ? probeZcode(resolveAgentPaths('zcode', loadSettings(settingsFile()).dirOverrides).root)
        : await probeLocalVersion(meta.bin)
      const latestVersion = meta.npm ? await fetchNpmLatest(meta.npm) : null
      const info: AgentVersionInfo = {
        agentId,
        version: probe.version,
        latestVersion,
        error: probe.error,
        installed: probe.installed
      }
      return info
    })
  )
```

同时第 107 行注释「探测指定 agent（缺省全部 7 个）」→「探测指定 agent（缺省全部 8 个）」。

⑥ `installAgent` 开头加无安装渠道拦截（第 134 行 `if (!meta)` 之后）：

```ts
  if (!meta.install) {
    throw new Error('ZCode 为桌面应用，无法通过 npm 安装，请从官网下载：https://zcode.z.ai/docs/install')
  }
```

- [ ] **Step 4: 运行全量测试确认通过**

Run: `pnpm test`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/main/services/agents-version.ts tests/agents-version.test.ts
git commit -m "feat: Dashboard 版本探测支持 ZCode（目录存在性判定）"
```

---

### Task 5: 其余测试夹具清单扩展 + 主进程注释同步

**Files:**
- Test: `tests/agent-root.test.ts:16-27`、`tests/skill-io.test.ts:21,106`、`tests/discovery.test.ts:30,79`、`tests/prompts.test.ts:17`、`tests/prompt-live.test.ts:16`、`tests/data-io.test.ts:32`
- Modify: `src/main/ipc.ts:73`（注释）、`src/main/services/skill-io.ts:315`（注释）

**Interfaces:**
- Consumes: Task 1 的 `AgentId` 含 `'zcode'`。
- Produces: 全部测试的 AGENT_IDS / prompts 夹具覆盖 8 个 harness（TypeScript `Record<AgentId,...>` 类型完整）。

- [ ] **Step 1: 更新测试清单**

各文件逐个修改（机械追加，无新断言）：

① `tests/agent-root.test.ts` 第 16 行：

```ts
const AGENT_IDS: AgentId[] = ['dsh', 'claude', 'codex', 'gemini', 'grok', 'opencode', 'zcode', 'hermes']
```

第 19-27 行 MCP_FILE_NAME 追加 `zcode: 'cli/config.json',`（beforeEach 的 `path.dirname` 会自动创建 `cli` 子目录）。

② `tests/skill-io.test.ts` 第 21 行 AGENT_IDS 追加 `'zcode'`；第 106 行 prompts 字面量追加 `zcode: []`：

```ts
    prompts: { dsh: [], claude: [], codex: [], gemini: [], grok: [], opencode: [], zcode: [], hermes: [] },
```

③ `tests/discovery.test.ts` 第 30 行 AGENT_IDS 追加 `'zcode'`；第 79 行 prompts 字面量同上追加 `zcode: []`。

④ `tests/prompts.test.ts` 第 17 行 AGENT_IDS 追加 `'zcode'`。

⑤ `tests/prompt-live.test.ts` 第 16 行 AGENT_IDS 追加 `'zcode'`。

⑥ `tests/data-io.test.ts` 第 32 行 prompts 字面量追加 `zcode: []`。

- [ ] **Step 2: 主进程注释 7→8**

① `src/main/ipc.ts` 第 73 行：`// loadSettings 为同步函数，直接调用（store.ts）；返回 7 agents + settings` → `返回 8 agents + settings`。

② `src/main/services/skill-io.ts` 第 315 行：`/** 在 7 个 harness skillsDir 中定位 dir 的源路径（第一个命中；无则 null） */` → `/** 在 8 个 harness skillsDir 中定位 dir 的源路径（第一个命中；无则 null） */`。

- [ ] **Step 3: 运行全量测试确认通过**

Run: `pnpm test`
Expected: PASS。若 `tests/skills-deploy.test.ts` 出现 AGENTS 相关失败（预期不会：该文件不遍历 agent 清单），按同样模式补 zcode 夹具。

- [ ] **Step 4: 提交**

```bash
git add tests/agent-root.test.ts tests/skill-io.test.ts tests/discovery.test.ts tests/prompts.test.ts tests/prompt-live.test.ts tests/data-io.test.ts src/main/ipc.ts src/main/services/skill-io.ts
git commit -m "test: 测试夹具与注释同步 ZCode harness 清单"
```

---

### Task 6: 渲染层接入（图标资产 / data.js / 文案 / 已安装徽标）

**Files:**
- Create: `build/zcode-icon.png`（1024×1024 原图复制）
- Modify: `src/renderer/icons.js`、`src/renderer/data.js:2-30`、`src/renderer/index.html:40`、`src/renderer/main.js:16`、`src/renderer/ui/dashboard.js:14-36`
- Test: `tests/renderer/data.test.ts`

**Interfaces:**
- Consumes: 无（渲染层静态数据）。
- Produces: 渲染层 `AGENTS` 含 zcode（第 3 位）；`ICONS.zcode` base64 PNG；Dashboard 对「已安装但无版本可探」的 agent（zcode）显示「✓ 已安装」徽标与就绪文案。

- [ ] **Step 1: 写失败测试（data.test.ts）**

`tests/renderer/data.test.ts` 第 6-10 行改为：

```ts
  it('共享目录置顶，其后为 8 个 harness（顺序与 AGENTS 一致）', () => {
    expect(SKILL_TARGETS[0]).toBe(SHARED_TARGET)
    expect(SKILL_TARGETS.slice(1)).toEqual(AGENTS)
    expect(SKILL_TARGETS).toHaveLength(9)
  })
```

Run: `pnpm vitest run tests/renderer/data.test.ts`
Expected: FAIL（渲染层 AGENTS 仍 7 个）。

- [ ] **Step 2: 生成图标资产**

在仓库根目录执行（一次性）：

```powershell
Copy-Item "C:\Users\admin\AppData\Local\Programs\ZCode\resources\icon_windows.png" "build\zcode-icon.png" -Force
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile((Resolve-Path "build\zcode-icon.png"))
$bmp = New-Object System.Drawing.Bitmap 64, 64
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($src, 0, 0, 64, 64)
$g.Dispose(); $src.Dispose()
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
[Convert]::ToBase64String($ms.ToArray()) | Set-Content -NoNewline "build\zcode-icon.b64"
(Get-Item "build\zcode-icon.b64").Length
```

确认输出长度 > 0。用 read 工具读取 `build/zcode-icon.b64` 的完整 base64 字符串（记为 `<B64>`，供下面两处嵌入；嵌入完成后删除该临时文件）。

- [ ] **Step 3: 嵌入 icons.js**

`src/renderer/icons.js` 的 `ICONS` 中 `opencode` 条目（第 10 行）之后插入（与 hermes 同构，`<B64>` 替换为上一步读到的字符串）：

```js
  zcode: `<img src="data:image/png;base64,<B64>" alt="ZCode">`,
```

（`.aicon img{width:100%;height:100%;object-fit:contain}` 已有 CSS 控制缩放，无需内联尺寸。）

- [ ] **Step 4: data.js / index.html / main.js 文案与清单**

① `src/renderer/data.js`：第 27 行注释「7 harness + Agent Skills 共享目录」→「8 harness + Agent Skills 共享目录」；AGENTS 数组 opencode 条目（第 6-8 行）之后插入：

```js
  {id:'zcode',    name:'ZCode',              short:'ZCode',    dir:'~/.zcode',
   mcpPath:'~/.zcode/cli/config.json', mcpFormat:'json',
   skillsDir:'~/.zcode/skills', promptFile:'~/.zcode/AGENTS.md'},
```

② `src/renderer/index.html` 第 40 行：`7 个 harness 的配置总览` → `8 个 harness 的配置总览`。

③ `src/renderer/main.js` 第 16 行：`dashboard:{title:'Dashboard', sub:'7 个 harness 的配置总览', search:false},` → `sub:'8 个 harness 的配置总览'`。

- [ ] **Step 5: dashboard.js 已安装徽标变体**

`src/renderer/ui/dashboard.js` 的 `statusBadge`（第 15-22 行）在 `if(!v.installed)` 行后插入：

```js
  // 桌面应用型 harness（如 ZCode）：目录存在即已安装，无 CLI 版本可探
  if(!v.version && !v.latestVersion) return `<span class="avc-badge ok">✓ 已安装</span>`;
```

`actionButton`（第 25-36 行）在 `if(!v.installed){...}` 块后插入：

```js
  if(!v.version && !v.latestVersion) return `<span class="avc-ready">✓ 已安装</span>`;
```

（条件仅在 zcode 成立：CLI 型 agent installed ⇔ version 非 null。）

- [ ] **Step 6: 运行全量测试确认通过**

Run: `pnpm test`
Expected: PASS。

- [ ] **Step 7: 清理与提交**

删除临时文件：`Remove-Item "build\zcode-icon.b64"`。

```bash
git add build/zcode-icon.png src/renderer/icons.js src/renderer/data.js src/renderer/index.html src/renderer/main.js src/renderer/ui/dashboard.js tests/renderer/data.test.ts
git commit -m "feat: 渲染层接入 ZCode（图标/清单/文案/已安装徽标）"
```

---

### Task 7: 设计文档与设计原型同步

**Files:**
- Modify: `docs/设计文档.md`、`docs/设计原型.html`、`package.json:4`

**Interfaces:**
- Consumes: Task 6 的 `<B64>` 图标 base64（若 Task 6 已删除临时文件，重新执行 Task 6 Step 2 的缩放命令再生成 `build/zcode-icon.b64`；完成后再次删除）。
- Produces: 文档与原型展示 8 个 harness。

- [ ] **Step 1: 更新 `docs/设计文档.md`**

逐处修改（行号基于当前版本）：

① 第 13 行：`**支持的 harness（共 7 个，DeepSeek Harness 置顶）**：` → `**支持的 harness（共 8 个，DeepSeek Harness 置顶）**：`

② 表格（第 15-23 行）：在 OpenCode 行后插入 ZCode 行，原 3-7 行顺延为 4-8：

```markdown
| 3 | ZCode | `~/.zcode` | `cli/config.json`（`mcp.servers` JSON） | `~/.zcode/skills` | `~/.zcode/AGENTS.md` |
```

③ 第 46 行：`harness 顺序固定：DSH → OpenCode → Codex → ...` → `harness 顺序固定：DSH → OpenCode → ZCode → Codex → Claude Code → Grok → Gemini CLI → Hermes`

④ 第 89 行：`作为 Skills 部署的**第 8 个目标（置于 DSH 前）**` → `作为 Skills 部署的**第 9 个目标（置于 DSH 前）**`

⑤ 第 96 行：`**部署列 = 7 个 harness + 共享目录（共 8 列，共享置顶）**` → `**部署列 = 8 个 harness + 共享目录（共 9 列，共享置顶）**`；句尾 `MCP 矩阵仍为 7 列` → `MCP 矩阵仍为 8 列`

⑥ 第 112 行：`（7 harness + 共享目录，共享置顶）` → `（8 harness + 共享目录，共享置顶）`

⑦ 第 157 行：`- 7 张 harness 卡片：...` → `- 8 张 harness 卡片：...`

⑧ Dashboard 节（第 165-172 行）在「操作按钮」条目后追加一条：

```markdown
  - 版本探测补充：ZCode 为桌面应用（无 CLI/npm 包），按配置目录存在性判定已安装，版本列显示「—」/「未知」，状态徽标为「✓ 已安装」；点「安装」提示从官网下载（https://zcode.z.ai/docs/install）
```

⑨ Adapter 模式图（第 196-205 行）：`├── OpenCodeAdapter    (opencode.json + skills + AGENTS.md)` 之后插入：

```
  ├── ZcodeAdapter        (cli/config.json mcp.servers + skills + AGENTS.md)
```

⑩ 第 213 行：`目标 = 7 harness skills 目录 + 共享目录` → `目标 = 8 harness skills 目录 + 共享目录`

⑪ 第 215 行格式注记句尾追加：`、ZCode \`mcp.servers\` 嵌套键（stdio 不写 type、远程写 type+url、读取忽略 enable 字段）`

⑫ 第 237 行：`部署开关（7 harness + 共享目录置顶）` → `部署开关（8 harness + 共享目录置顶）`

- [ ] **Step 2: 更新 `docs/设计原型.html`**

逐处修改（行号基于当前版本；`<B64>` 为 Task 6 的 base64 字符串）：

① 第 395 行：`<div class="sub" id="view-sub">7 个 harness 的配置总览</div>` → `8 个 harness 的配置总览`

② 第 852-861 行 ICONS：`opencode:` 条目（第 858 行）之后插入：

```js
  zcode: `<img src="data:image/png;base64,<B64>" alt="ZCode">`,
```

③ 第 868-890 行 AGENTS：opencode 条目（第 872-874 行）之后插入：

```js
  {id:'zcode',    name:'ZCode',              short:'ZCode',    dir:'~/.zcode',
   mcpPath:'~/.zcode/cli/config.json', mcpFormat:'json',
   skillsDir:'~/.zcode/skills', promptFile:'~/.zcode/AGENTS.md'},
```

④ 第 895-903 行 AGENT_VERSIONS：opencode 条目后插入：

```js
  {agentId:'zcode',    version:null,      latestVersion:null,     error:null,                        installed:true},
```

⑤ 第 905 行注释：`/* ---- Skills 部署目标：7 harness + Agent Skills 共享目录（...） ---- */` → `8 harness`

⑥ statusBadge（第 1142-1148 行）`if(!v.installed)` 行后插入：

```js
  if(!v.version && !v.latestVersion) return `<span class="avc-badge ok">✓ 已安装</span>`;
```

actionButton（第 1151-1156 行）`if(!v.installed)` 行后插入：

```js
  if(!v.version && !v.latestVersion) return `<span class="avc-ready">✓ 已安装</span>`;
```

⑦ MCP_ITEMS 的 8 个 apps 字面量（第 915、919、923、927、931、935、939、943 行）：每个 `opencode:0,` 后追加 `zcode:0,`（如 `apps:{dsh:1,claude:1,codex:0,gemini:1,grok:0,opencode:0,zcode:0,hermes:0}`）

⑧ SKILLS_INSTALLED 的 6 个 apps 字面量（第 977、979、981、983、985、987 行）：同样在每个 `opencode:0,` 后追加 `zcode:0,`

⑨ PROMPTS（第 1033-1063 行）：`opencode: [...]` 块（第 1055-1058 行）之后插入：

```js
  zcode: [
    {id:'zc-1', name:'ZCode 全栈工程师', desc:'与 GLM 5.3 配合的连续多步开发工作流', updated:'1 天前',
     content:'你是 ZCode Agent。配合 GLM 5.3 系列模型工作时，先理解工作区上下文再动手，连续多步任务保持工具调用稳定。'},
  ],
```

⑩ LIVE（第 1069-1077 行）：`opencode:{...},` 之后插入：

```js
  zcode:{exists:true,  content: PROMPTS.zcode[0].content, mtime:'2026-09-04 11:02'},
```

⑪ 动态 push 的两处 apps 字面量（第 1738、1927 行）：`apps:{dsh:0,claude:0,codex:0,gemini:0,grok:0,opencode:0,hermes:0}` → 追加 `zcode:0`（`apps:{dsh:0,claude:0,codex:0,gemini:0,grok:0,opencode:0,zcode:0,hermes:0}`）

⑫ 第 2343 行：`dashboard:{title:'Dashboard', sub:'7 个 harness 的配置总览', search:false},` → `sub:'8 个 harness 的配置总览'`

- [ ] **Step 3: 更新 `package.json`**

第 4 行：`"description": "HarnessHub — MCP / Skills / Prompt manager for 7 AI coding harnesses",` → `for 8 AI coding harnesses`。

- [ ] **Step 4: 验证原型可用性（轻量）**

Run: `pnpm test`
Expected: PASS（文档改动不影响测试；此项为提交前的全量回归）。

- [ ] **Step 5: 提交**

```bash
git add docs/设计文档.md docs/设计原型.html package.json
git commit -m "docs: 设计文档与原型同步 ZCode harness"
```

---

### Task 8: 全量验证与收尾

**Files:** 无新改动（验证任务）。

- [ ] **Step 1: 全量测试**

Run: `pnpm test`
Expected: 全部 PASS，无 skip。记录用例总数与耗时摘要。

- [ ] **Step 2: 构建验证（渲染层打包完整性）**

Run: `pnpm build`
Expected: electron-vite 构建成功无报错（验证 icons.js 的 base64 嵌入与 data.js 语法无误）。

- [ ] **Step 3: 人工抽查（可选，需 GUI）**

`pnpm dev` 启动应用：侧边栏出现 ZCode（第 2 位，DSH 后）图标；MCP 矩阵出现 ZCode 列；提示词页出现 ZCode tab 且 live 读取 `~/.zcode/AGENTS.md`；Harness 管理出现 ZCode 卡片（MCP 落点含 `cli\config.json`）；Dashboard ZCode 卡片显示「✓ 已安装」。
（无 GUI 环境时跳过，在最终报告注明。）

- [ ] **Step 4: 收尾报告**

按全局约束「五、实施与报告规范」输出：改动概要、验证证据（命令 + 输出摘要）、关联影响披露（含「范围外」两项）、裁决披露、风险自陈。

---

## Self-Review 记录

1. **Spec 覆盖**：MCP（adapter/service/preview/导入）、Skills（通用管线 + 单层目录约束已由 ZCode 文档确认）、提示词（promptFile + 默认库键）、Dashboard（目录探测 + 已安装徽标 + 安装引导）、目录覆盖（relToDir 通用性已由 Task 1 覆盖测试验证）、图标（安装目录复制 + 缩放嵌入）、文档与原型、package.json——均有对应任务。
2. **占位符扫描**：唯一运行期产物 `<B64>` 由 Task 6 Step 2 的命令现场生成，非占位符。
3. **类型一致性**：`JsonKind` 四值、`KIND_KEY` 三键（zcode 走专用路径）、`ProbeResult` 三字段、`AGENT_TOOL_META` 可空 npm/install 与 agents-version.test.ts 的非空断言（`npm!`）一致。
