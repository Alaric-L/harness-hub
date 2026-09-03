# ~/.agents/skills 共享目录部署目标 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `~/.agents/skills`（Agent Skills 标准共享目录）纳为 Skills 模块的完整部署目标：矩阵列/计数徽章/详情 tab 共享置顶，开关、导入、卸载、更新、备份恢复全链路与 harness 落点一致。

**Architecture:** Skills 层伪目标建模——`AGENTS` 保持 7 成员不变，新增 `SkillTargetId = AgentId | 'shared'` 作为 Skills 部署维度；主进程经 `resolveSkillsTargetDir` / `assertSkillTargetRoot` 路由（`'shared'` → `~/.agents/skills`，不支持 dirOverride），渲染层经 `SKILL_TARGETS` 序列（共享置顶，仅 Skills 视图消费）。MCP / 提示词 / Dashboard / 侧边栏 / Harness 管理页表面结构性零改动。

**Tech Stack:** Electron 44 + electron-vite 5（main 为 TypeScript strict，renderer 为原生 JS）、vitest 4（`--pool=threads`）、无新增依赖。

**Spec:** `docs/superpowers/specs/2026-09-03-agents-shared-skills-design.md`（含证据表与 4 项核心决策 D1–D4；执行本计划前先读 spec）。

## Global Constraints

- 验证命令（本会话沙箱下 forks 池无法启动，threads 池已验证可用）：
  - 单文件测试：`npx vitest run --pool=threads tests/<file>`
  - 全量测试：`npx vitest run --pool=threads`
  - 主进程类型门：`npx tsc --noEmit -p tsconfig.node.json`（baseline exit 0）
- `pnpm build`（esbuild 服务需命名管道，受限沙箱禁止）：仅 Task 12 执行，需以 `sandbox_permissions: danger-full-access` 升级运行一次（本次会话已验证升级后 exit 0），或由用户在沙箱外执行。
- 提交信息一律中文 + Conventional Commits 英文类型前缀（如 `feat: 新增 …`）；`git add` 用**显式文件列表**——工作区有用户未提交的 `docs/设计文档.md`、`docs/设计原型.html`，严禁加入暂存区，也严禁修改这两个文件。
- `shared` 落点 = `<home>/.agents/skills`，**不支持 dirOverrides**（spec D3：标准位置固定）。
- UI 显示名统一「共享目录」（name 与 short 同值；`skillsDir` 展示值 `~/.agents/skills`）。
- 最小改动：不动无关代码/格式；仅清理**因本改动而孤立**的 import（逐任务列出）。
- 渲染层 DOM 模块（matrix/detail/skills）无单测——spec §9 已声明并经用户确认；`data.js` 为纯数据模块，有 `tests/renderer/import-notice.test.ts` 先例，新增单测。
- 测试密闭性：所有触及共享目录路径的测试必须经 `SkillCtx.env` 注入 fake home（现有测试经 `dirOverrides` 隔离 harness 路径，但 shared 不走 overrides）。

## 与 spec 的偏差说明（实施前披露）

1. **spec §5「import-notice.js targets 标签映射」→ 落点改为 skills.js**：`importConfirmMessage(method, count, targets)` 接收的是调用方（skills.js:199-200）已格式化的短名数组，无法区分 `'shared'` 原始 id；映射改在 skills.js 构建 targets 处用 `SKILL_TARGET_BY` 完成。用户可见行为与 spec 一致；spec §9 的 import-notice 测试项随之取消（纯函数本身无行为变化）。
2. **spec §4 路由点 5/6（toggleSkill/bulkToggleSkill）**：`toggleSkillOne` 从 `src/main/ipc.ts:169-187` 迁移至 `src/main/services/skills.ts` 并增加 `ctx` 注入参数——ipc 模块依赖 electron 无法在 vitest 中导入，迁移后该路由才可 TDD；ipc.ts 调用方同步改签名，行为不变。
3. **spec §9「渲染层无单测」精确化**：DOM 模块无单测；`data.js` 纯数据新增 `tests/renderer/data.test.ts`。

---

### Task 1: 类型与共享目录路径解析（SkillTargetId / resolveSkillsTargetDir）

**Files:**
- Modify: `src/main/types.ts`（新增 `SkillTargetId`；`SkillInstalled.apps` 与 `UnmanagedSkill.foundIn` 键域扩）
- Modify: `src/main/paths.ts`（新增 3 个导出函数，置于 `resolveAgentPaths` 之后）
- Test: `tests/paths.test.ts`（文件末尾新增 describe；更新顶部 import）

**Interfaces:**
- Consumes: 现有 `resolveHome` / `resolveAgentPaths`（`src/main/paths.ts`）。
- Produces: `type SkillTargetId = AgentId | 'shared'`（types.ts）；`agentsSharedRoot(env?): string`、`agentsSharedSkillsDir(env?): string`、`resolveSkillsTargetDir(targetId: SkillTargetId, overrides: Partial<Record<AgentId, string>>, env?): string`（paths.ts）。后续所有任务依赖这四个名字。

- [ ] **Step 1: 写失败测试**

`tests/paths.test.ts` 顶部 import 块替换为：

```ts
import {
  AGENTS,
  agentsSharedRoot,
  agentsSharedSkillsDir,
  dataRoot,
  ssotSkillsDir,
  skillBackupsDir,
  fileBackupDir,
  dataFile,
  settingsFile,
  resolveAgentPaths,
  resolveSkillsTargetDir
} from '../src/main/paths'
```

文件末尾追加：

```ts
describe('Agent Skills 共享目录路径', () => {
  it('agentsSharedRoot / agentsSharedSkillsDir 拼接 <home>/.agents 与 <home>/.agents/skills', () => {
    expect(agentsSharedRoot(WIN_ENV)).toBe(path.join(HOME, '.agents'))
    expect(agentsSharedSkillsDir(WIN_ENV)).toBe(path.join(HOME, '.agents', 'skills'))
  })

  it('resolveSkillsTargetDir：shared -> <home>/.agents/skills，不受 dirOverrides 影响', () => {
    expect(resolveSkillsTargetDir('shared', { dsh: 'D:\\x' }, WIN_ENV)).toBe(
      path.join(HOME, '.agents', 'skills')
    )
  })

  it('resolveSkillsTargetDir：harness id -> resolveAgentPaths().skillsDir（含覆盖）', () => {
    expect(resolveSkillsTargetDir('dsh', { dsh: 'D:\\x' }, WIN_ENV)).toBe(path.join('D:\\x', 'skills'))
    expect(resolveSkillsTargetDir('claude', {}, WIN_ENV)).toBe(path.join(HOME, '.claude', 'skills'))
  })

  it('resolveSkillsTargetDir：未知 id 抛错（与 resolveAgentPaths 同文案）', () => {
    expect(() => resolveSkillsTargetDir('bogus' as never, {}, WIN_ENV)).toThrow(/未知 agent id/)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run --pool=threads tests/paths.test.ts`
Expected: FAIL —— `SyntaxError: The requested module '../src/main/paths' does not provide an export named 'agentsSharedRoot'`（或同类导出缺失错误）

- [ ] **Step 3: 实现**

`src/main/types.ts` 第 2 行后新增类型，并修改两个接口的键域：

```ts
export type AgentId = 'dsh'|'claude'|'codex'|'gemini'|'grok'|'opencode'|'hermes';
/** Skills 部署目标：7 个 harness，或 Agent Skills 共享目录（~/.agents/skills） */
export type SkillTargetId = AgentId | 'shared';
```

`SkillInstalled.apps` 行改为：

```ts
  apps: Partial<Record<SkillTargetId, boolean>>;
```

`UnmanagedSkill.foundIn` 行改为：

```ts
  foundIn: SkillTargetId[]; path: string;
```

`src/main/paths.ts`：type import 行改为 `import type { AgentId, AgentInfo, SkillTargetId } from './types'`；文件末尾（`resolveAgentPaths` 之后）追加：

```ts
/** Agent Skills 共享目录根 <home>/.agents（标准位置固定，不提供目录覆盖） */
export function agentsSharedRoot(env: HomeEnv = process.env): string {
  return path.join(resolveHome(env), '.agents')
}

/** Agent Skills 共享 skills 目录 <home>/.agents/skills */
export function agentsSharedSkillsDir(env: HomeEnv = process.env): string {
  return path.join(agentsSharedRoot(env), 'skills')
}

/**
 * Skills 部署目标目录解析：'shared' -> ~/.agents/skills（不支持目录覆盖）；
 * harness id -> resolveAgentPaths().skillsDir（dirOverrides 生效）。
 */
export function resolveSkillsTargetDir(
  targetId: SkillTargetId,
  overrides: Partial<Record<AgentId, string>>,
  env: HomeEnv = process.env
): string {
  if (targetId === 'shared') return agentsSharedSkillsDir(env)
  return resolveAgentPaths(targetId, overrides, env).skillsDir
}
```

- [ ] **Step 4: 运行确认通过 + 类型门**

Run: `npx vitest run --pool=threads tests/paths.test.ts`
Expected: PASS（16 passed）
Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: exit 0（键域放宽不影响现有代码——`Object.keys(...) as AgentId[]` 为非检查断言，仍编译通过）

- [ ] **Step 5: 提交**

```bash
git add src/main/types.ts src/main/paths.ts tests/paths.test.ts
git commit -m "feat: 新增 SkillTargetId 类型与共享目录路径解析"
```

---

### Task 2: 写入前共享目录根存在性断言（assertSkillTargetRoot）

**Files:**
- Modify: `src/main/services/agent-root.ts`（新增导出函数；新增 `path` import）
- Test: `tests/agent-root.test.ts`（新增 describe + import 更新）

**Interfaces:**
- Consumes: Task 1 的 `agentsSharedRoot`；现有 `assertAgentRoot`。
- Produces: `assertSkillTargetRoot(targetId: SkillTargetId, overrides: Partial<Record<AgentId, string>>, env?: HomeEnv): string`——根目录存在时返回目标 skills 目录绝对路径（`'shared'` → `<home>/.agents/skills`），缺失时抛可读错误。Task 4/5/6/7 依赖。

- [ ] **Step 1: 写失败测试**

`tests/agent-root.test.ts` 的 agent-root import 行改为：

```ts
import { assertAgentRoot, assertSkillTargetRoot } from '../src/main/services/agent-root'
```

文件末尾追加（`tmp` 即各测试 home 的父目录，`skillCtx.env` 的 USERPROFILE 即指向它——本 describe 直接用同款 env）：

```ts
describe('assertSkillTargetRoot', () => {
  const ENV = { HOME: '/none', USERPROFILE: tmp }

  it('shared：<home>/.agents 存在时返回 <root>/skills（忽略 dirOverrides）', async () => {
    await fs.mkdir(path.join(tmp, '.agents'), { recursive: true })
    expect(assertSkillTargetRoot('shared', overrides, ENV)).toBe(path.join(tmp, '.agents', 'skills'))
  })

  it('shared：<home>/.agents 缺失时抛可读错误', () => {
    expect(() => assertSkillTargetRoot('shared', overrides, ENV)).toThrow(
      /未检测到 Agent Skills 共享目录/
    )
  })

  it('harness id：委托 assertAgentRoot，返回其 skillsDir', () => {
    expect(assertSkillTargetRoot('dsh', overrides, ENV)).toBe(path.join(homeOf('dsh'), 'skills'))
  })
})
```

注意：`overrides` 在 beforeEach 中为全部 7 个 harness 建好了目录，`.agents` 不存在（第一个用例内自建）。两个 shared 用例间 tmp 经 beforeEach 重建，互不污染。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run --pool=threads tests/agent-root.test.ts`
Expected: FAIL —— `assertSkillTargetRoot is not a function`（导出缺失）

- [ ] **Step 3: 实现**

`src/main/services/agent-root.ts` 顶部 import 更新（新增 `path`、`agentsSharedRoot`、`SkillTargetId`）：

```ts
import fs from 'node:fs'
import path from 'node:path'
import { AGENTS, agentsSharedRoot, resolveAgentPaths } from '../paths'
import type { HomeEnv, ResolvedAgentPaths } from '../paths'
import type { AgentId, SkillTargetId } from '../types'
```

文件末尾追加：

```ts
/**
 * 解析 Skills 部署目标（'shared' 或 harness）的 skills 目录并确认其根目录存在。
 * - 'shared'：检查 <home>/.agents 存在（dirOverrides 不适用，标准位置固定）；
 *   子目录 skills 由部署方 mkdir 创建，与 harness 语义一致。
 * - harness：委托 assertAgentRoot（检查其最外层配置目录，dirOverrides 覆盖后即用覆盖值）。
 * 不存在抛可读错误（渲染层 toast）；存在返回目标 skills 目录绝对路径。
 */
export function assertSkillTargetRoot(
  targetId: SkillTargetId,
  overrides: Partial<Record<AgentId, string>>,
  env: HomeEnv = process.env
): string {
  if (targetId === 'shared') {
    const root = agentsSharedRoot(env)
    let isDir = false
    try {
      isDir = fs.statSync(root).isDirectory()
    } catch (err) {
      if (isNotFound(err)) {
        throw new Error(`未检测到 Agent Skills 共享目录（${root}），已跳过写入。请先创建该目录。`)
      }
      throw err
    }
    if (!isDir) throw new Error(`共享目录不是文件夹：${root}`)
    return path.join(root, 'skills')
  }
  return assertAgentRoot(targetId, overrides, env).skillsDir
}
```

- [ ] **Step 4: 运行确认通过 + 类型门**

Run: `npx vitest run --pool=threads tests/agent-root.test.ts`
Expected: PASS
Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: exit 0

- [ ] **Step 5: 提交**

```bash
git add src/main/services/agent-root.ts tests/agent-root.test.ts
git commit -m "feat: 写入前支持共享目录根存在性断言"
```

---

### Task 3: 卸载时从共享目录移除部署（uninstallSkill 路由）

**Files:**
- Modify: `src/main/services/skills.ts`（`uninstallSkill` 内 apps 遍历改路由；import 调整）
- Test: `tests/skill-io.test.ts`（beforeEach 注入 fake home env；entry 助手键域放宽；新增用例）

**Interfaces:**
- Consumes: Task 1 的 `resolveSkillsTargetDir` / `SkillTargetId`。
- Produces: `uninstallSkill` 支持 `apps.shared`（无新导出）。

- [ ] **Step 1: 写失败测试**

`tests/skill-io.test.ts` 三处修改：

① 顶部 type import 行加入 `SkillTargetId`：

```ts
import type { AgentId, SkillInstalled, SkillTargetId } from '../src/main/types'
```

② beforeEach 注入 fake home（共享目录不走 overrides，必须经 env 隔离；现有用例行为不变——harness 路径仍走 overrides）：

```ts
let tmp: string
let userHome: string
let homes: string
// ...
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-io-'))
  userHome = path.join(tmp, 'user-home')
  homes = path.join(tmp, 'homes')
  // ...（其余不变）
  ctx = { dataFile: dataPath, settingsFile: settingsPath, ssotDir: ssot, backupsDir: backups,
          env: { HOME: userHome, USERPROFILE: userHome } }
})
```

③ `entry` 助手的 apps 参数类型放宽：

```ts
function entry(
  dir: string,
  name: string,
  desc = '',
  apps: Partial<Record<SkillTargetId, boolean>> = {}
): SkillInstalled {
```

④ `describe('uninstallSkill')` 内追加用例：

```ts
it('卸载前从共享目录移除部署', async () => {
  const sharedSkills = path.join(userHome, '.agents', 'skills')
  await makeSkill(ssot, 'hello', 'Hello', 'Greets')
  await seed([entry('hello', 'Hello', 'Greets', { shared: true })])
  await deploySkill(ssot, 'hello', sharedSkills, 'auto')

  await uninstallSkill('hello', ctx)

  await expect(fs.lstat(path.join(sharedSkills, 'hello'))).rejects.toThrow()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run --pool=threads tests/skill-io.test.ts`
Expected: FAIL —— 新用例：`~<userHome>/.agents/skills/hello` 仍存在（卸载循环把 `'shared'` 当 harness id 传给 `resolveAgentPaths` 抛 `未知 agent id`，或残留部署导致 lstat 成功）；注意现有用例应全数通过

- [ ] **Step 3: 实现**

`src/main/services/skills.ts`：

① import 行调整——`resolveAgentPaths` 仅被本处使用，替换为 `resolveSkillsTargetDir`（`AGENTS` 为既有未使用导入，不动）：

```ts
import { AGENTS, dataFile, resolveSkillsTargetDir, settingsFile, skillBackupsDir, ssotSkillsDir } from '../paths'
```

② type import 加 `SkillTargetId`：

```ts
import type { AgentId, SkillInstalled, SkillTargetId } from '../types'
```

③ `uninstallSkill` 的移除循环（现 222-228 行）替换为：

```ts
// 1. 从所有启用目标（harness 或共享目录）移除部署
for (const targetId of Object.keys(entry.apps ?? {}) as SkillTargetId[]) {
  if (entry.apps[targetId]) {
    await undeploySkill(path.join(resolveSkillsTargetDir(targetId, settings.dirOverrides, c.env), dir))
  }
}
```

- [ ] **Step 4: 运行确认通过 + 类型门**

Run: `npx vitest run --pool=threads tests/skill-io.test.ts`
Expected: PASS（全部用例）
Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: exit 0

- [ ] **Step 5: 提交**

```bash
git add src/main/services/skills.ts tests/skill-io.test.ts
git commit -m "feat: 卸载时从共享目录移除部署"
```

---

### Task 4: 未纳管扫描与导入纳入共享目录（listUnmanagedSkills / findSourceDir / importSkills）

**Files:**
- Modify: `src/main/services/skill-io.ts`（`listUnmanagedSkills` 追加共享扫描；`findSourceDir` 追加共享兜底；`importSkills` 预检与部署循环改路由）
- Test: `tests/skill-io.test.ts`（新增 describe）

**Interfaces:**
- Consumes: Task 1 `agentsSharedSkillsDir` / `resolveSkillsTargetDir` / `SkillTargetId`；Task 2 `assertSkillTargetRoot`。
- Produces: `UnmanagedSkill.foundIn` 可含 `'shared'`（仅共享命中时 `path` 指向共享路径；harness+shared 同名时 harness 路径优先、`foundIn` 为 `[...harness, 'shared']`）；`importSkills` 的 `items[].apps` 键域为 `Partial<Record<SkillTargetId, boolean>>`。

- [ ] **Step 1: 写失败测试**

`tests/skill-io.test.ts` 末尾新增 describe（放在「backupId 校验」describe 之前）：

```ts
describe('共享目录扫描与导入', () => {
  const sharedSkills = (): string => path.join(userHome, '.agents', 'skills')

  /** 在共享目录放一个 skill（默认 ext-skill；appendFakeHome=false 时不建 ~/.agents 根） */
  async function seedSharedSkill(dir = 'ext-skill', createRoot = true): Promise<void> {
    if (createRoot) await fs.mkdir(sharedSkills(), { recursive: true })
    await fs.mkdir(path.join(sharedSkills(), dir), { recursive: true })
    await fs.writeFile(
      path.join(sharedSkills(), dir, 'SKILL.md'),
      '---\nname: Ext\ndescription: from shared\n---\nx',
      'utf8'
    )
  }

  it('扫描包含共享目录：仅共享命中的 skill foundIn=[shared]、path 指向共享目录', async () => {
    await seedSharedSkill()
    await seed([])

    const list = listUnmanagedSkills(ctx)

    const ext = list.find((u) => u.dir === 'ext-skill')
    expect(ext).toMatchObject({ dir: 'ext-skill', name: 'Ext', desc: 'from shared' })
    expect(ext?.foundIn).toEqual(['shared'])
    expect(ext?.path).toBe(path.join(sharedSkills(), 'ext-skill'))
  })

  it('harness 与共享目录同名：foundIn 合并（harness 在前）且 path 取 harness 路径', async () => {
    await seedHarnessSkills()   // dsh + claude 各有 manual（现有助手）
    await seedSharedSkill('manual')
    await seed([entry('hello', 'Hello')])

    const list = listUnmanagedSkills(ctx)

    const manual = list.find((u) => u.dir === 'manual')
    expect(manual?.foundIn).toEqual(['dsh', 'claude', 'shared'])
    expect(manual?.path).toBe(path.join(skillsDirOf('dsh'), 'manual'))
  })

  it('importSkills：从共享目录导入并部署回共享目录（原实体目录被复制替换）', async () => {
    await seedSharedSkill()
    await seed([])

    const list = await importSkills([{ dir: 'ext-skill', apps: { shared: true } }], ctx)

    const sk = loadStore(dataPath).skills.find((s) => s.dir === 'ext-skill')
    expect(sk).toMatchObject({ dir: 'ext-skill', repo: null, apps: { shared: true } })
    expect(await fs.readFile(path.join(ssot, 'ext-skill', 'SKILL.md'), 'utf8')).toContain('name: Ext')
    // syncMethod=auto：共享目录原为实体目录 -> 复制替换（纳管接管语义）
    expect((await fs.lstat(path.join(sharedSkills(), 'ext-skill'))).isSymbolicLink()).toBe(false)
    expect(await fs.readFile(path.join(sharedSkills(), 'ext-skill', 'SKILL.md'), 'utf8')).toContain(
      'name: Ext'
    )
    expect(list.some((s) => s.dir === 'ext-skill')).toBe(true)
  })

  it('importSkills：部署目标含 shared 但 <home>/.agents 缺失时整批拒绝（不写 SSOT、不入库）', async () => {
    await seed([])
    // 源放在 dsh（harness 目录存在），目标含 shared
    await fs.mkdir(path.join(skillsDirOf('dsh'), 'manual'), { recursive: true })
    await fs.writeFile(
      path.join(skillsDirOf('dsh'), 'manual', 'SKILL.md'),
      '---\nname: Manual\n---\nx',
      'utf8'
    )

    await expect(importSkills([{ dir: 'manual', apps: { shared: true } }], ctx)).rejects.toThrow(
      /共享目录/
    )

    await expect(fs.access(path.join(ssot, 'manual'))).rejects.toThrow()
    expect(loadStore(dataPath).skills).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run --pool=threads tests/skill-io.test.ts`
Expected: FAIL —— 前两个用例 `foundIn` 不含 `'shared'` / `path` 不指向共享目录；第三个用例 `apps` 断言失败（导入后 shared 未部署：`rejects.toThrow` 不触发、`apps` 为 `{}` 或部署落点错）

- [ ] **Step 3: 实现**

`src/main/services/skill-io.ts`：

① import 调整：`import { AGENTS, agentsSharedSkillsDir, resolveAgentPaths, resolveSkillsTargetDir } from '../paths'`（`resolveAgentPaths` 仍被 harness 扫描用，保留）；`import { assertAgentRoot, assertSkillTargetRoot } from './agent-root'`；type import 加 `SkillTargetId`。

② `listUnmanagedSkills`：`found` 声明的 agents 类型放宽为 `SkillTargetId[]`：

```ts
const found = new Map<string, { agents: SkillTargetId[]; path: string }>()
```

AGENTS for 循环结束之后、`const out` 之前追加共享扫描：

```ts
// 共享目录扫描（Agent Skills 标准全局目录；foundIn 记 'shared'，harness 未命中时 path 取共享路径）
let sharedEntries: fs.Dirent[]
try {
  sharedEntries = fs.readdirSync(agentsSharedSkillsDir(c.env), { withFileTypes: true })
} catch (err) {
  if (isNotFound(err)) sharedEntries = []
  else throw err
}
for (const ent of sharedEntries) {
  if (!ent.isDirectory()) continue
  if (known.has(ent.name)) continue
  const skillPath = path.join(agentsSharedSkillsDir(c.env), ent.name)
  if (!parseSkillMd(skillPath)) continue
  const rec = found.get(ent.name) ?? { agents: [], path: skillPath }
  rec.agents.push('shared')
  found.set(ent.name, rec)
}
```

③ `findSourceDir`（AGENTS 循环之后、`return null` 之前）追加共享兜底：

```ts
// 共享目录兜底定位
const sharedSkillPath = path.join(agentsSharedSkillsDir(env), dir)
try {
  if ((await fsp.stat(sharedSkillPath)).isDirectory() && parseSkillMd(sharedSkillPath)) {
    return sharedSkillPath
  }
} catch (err) {
  if (!isNotFound(err)) throw err
}
return null
```

④ `importSkills`：签名与预检/部署循环改路由——

签名（现 317-320 行）：

```ts
export async function importSkills(
  items: { dir: string; apps: Partial<Record<SkillTargetId, boolean>> }[],
  ctx?: SkillCtx
): Promise<SkillInstalled[]> {
```

预检（deployTargets 类型与断言）：

```ts
const deployTargets = new Set<SkillTargetId>()
for (const item of items) {
  for (const targetId of Object.keys(item.apps ?? {}) as SkillTargetId[]) {
    if (item.apps[targetId]) deployTargets.add(targetId)
  }
}
for (const targetId of deployTargets) assertSkillTargetRoot(targetId, settings.dirOverrides, c.env)
```

部署循环（现 355-362 行）：

```ts
for (const item of items) {
  for (const targetId of Object.keys(item.apps ?? {}) as SkillTargetId[]) {
    if (item.apps[targetId]) {
      await deploySkill(
        c.ssotDir,
        item.dir,
        resolveSkillsTargetDir(targetId, settings.dirOverrides, c.env),
        settings.syncMethod
      )
    }
  }
}
```

- [ ] **Step 4: 运行确认通过 + 类型门**

Run: `npx vitest run --pool=threads tests/skill-io.test.ts`
Expected: PASS（含既有用例——beforeEach 已注入 fake home，共享扫描读 `<tmp>/user-home/.agents/skills` 不存在即跳过，结果不变）
Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: exit 0

- [ ] **Step 5: 提交**

```bash
git add src/main/services/skill-io.ts tests/skill-io.test.ts
git commit -m "feat: 未纳管扫描与导入纳入共享目录"
```

---

### Task 5: 备份恢复部署到共享目录（restoreSkillBackup 路由）

**Files:**
- Modify: `src/main/services/skill-io.ts`（`restoreSkillBackup` 的 meta.apps 键域、预检与部署循环改路由）
- Test: `tests/skill-io.test.ts`（新增 describe）

**Interfaces:**
- Consumes: Task 1 `resolveSkillsTargetDir` / `SkillTargetId`；Task 2 `assertSkillTargetRoot`。
- Produces: 备份 meta.json 的 `apps` 含 `shared` 键时恢复后回部署到 `~/.agents/skills`。

- [ ] **Step 1: 写失败测试**

`tests/skill-io.test.ts` 末尾（Task 4 的 describe 之后）新增：

```ts
describe('备份恢复部署到共享目录', () => {
  it('restoreSkillBackup：按 meta.apps 部署到共享目录', async () => {
    const sharedSkills = path.join(userHome, '.agents', 'skills')
    await fs.mkdir(path.join(userHome, '.agents'), { recursive: true })
    await makeSkill(ssot, 'hello', 'Hello', 'Greets')
    await seed([entry('hello', 'Hello', 'Greets', { shared: true })])
    await uninstallSkill('hello', ctx)   // 生成备份，meta.apps={shared:true}
    const id = (await fs.readdir(backups))[0]
    expect(id).toBeTruthy()

    const list = await restoreSkillBackup(id, true, ctx)

    expect(await fs.readFile(path.join(sharedSkills, 'hello', 'SKILL.md'), 'utf8')).toContain(
      'name: Hello'
    )
    const sk = loadStore(dataPath).skills.find((s) => s.dir === 'hello')
    expect(sk?.apps).toEqual({ shared: true })
    expect(list.some((b) => b.dir === 'hello')).toBe(true)
  })

  it('deploy=true 且共享目录根缺失时拒绝（不产生任何恢复写入）', async () => {
    await makeSkill(ssot, 'hello', 'Hello', 'Greets')
    await seed([entry('hello', 'Hello', 'Greets', { shared: true })])
    await uninstallSkill('hello', ctx)
    const id = (await fs.readdir(backups))[0]
    // userHome/.agents 未创建（卸载不建目录）——预检应拒绝
    await expect(fs.access(path.join(userHome, '.agents'))).rejects.toThrow()

    await expect(restoreSkillBackup(id, true, ctx)).rejects.toThrow(/共享目录/)

    await expect(fs.access(path.join(ssot, 'hello'))).rejects.toThrow()
    expect(loadStore(dataPath).skills).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run --pool=threads tests/skill-io.test.ts`
Expected: FAIL —— 第一个用例部署落点仍是 `resolveAgentPaths('shared')` 抛错或落点错误；第二个用例错误文案为「未知 agent id」而非「共享目录」

- [ ] **Step 3: 实现**

`src/main/services/skill-io.ts` 的 `restoreSkillBackup`：

④ import 调整：本任务替换后 `assertAgentRoot` 在本文件已无使用点（Task 4 已替换 importSkills 处、此处替换恢复处），改回单导入：

```ts
import { assertSkillTargetRoot } from './agent-root'
```

① `deployApps` 类型（现 120-123 行）：

```ts
const deployApps: Partial<Record<SkillTargetId, boolean>> =
  deploy && typeof meta.apps === 'object' && meta.apps !== null && !Array.isArray(meta.apps)
    ? (meta.apps as Partial<Record<SkillTargetId, boolean>>)
    : {}
```

② 预检循环（现 125-127 行）：

```ts
for (const targetId of Object.keys(deployApps) as SkillTargetId[]) {
  if (deployApps[targetId]) assertSkillTargetRoot(targetId, settings.dirOverrides, c.env)
}
```

③ 部署循环（现 144-149 行）：

```ts
for (const targetId of Object.keys(deployApps) as SkillTargetId[]) {
  if (deployApps[targetId]) {
    await deploySkill(
      c.ssotDir,
      dir,
      resolveSkillsTargetDir(targetId, settings.dirOverrides, c.env),
      settings.syncMethod
    )
  }
}
```

- [ ] **Step 4: 运行确认通过 + 类型门**

Run: `npx vitest run --pool=threads tests/skill-io.test.ts`
Expected: PASS
Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: exit 0

- [ ] **Step 5: 提交**

```bash
git add src/main/services/skill-io.ts tests/skill-io.test.ts
git commit -m "feat: 备份恢复支持部署到共享目录"
```

---

### Task 6: 更新重部署到共享目录（updateSkillFromExtractedDir 路由）

**Files:**
- Modify: `src/main/services/discovery.ts`（`updateSkillFromExtractedDir` 预检与重部署循环改路由；import 调整）
- Test: `tests/discovery.test.ts`（新增 describe）

**Interfaces:**
- Consumes: Task 1 `resolveSkillsTargetDir` / `SkillTargetId`；Task 2 `assertSkillTargetRoot`。
- Produces: 无新导出（`apps.shared` 的 skill 更新后重部署到共享目录）。

- [ ] **Step 1: 写失败测试**

`tests/discovery.test.ts` 末尾新增（discovery 的 beforeEach ctx 无 env，本 describe 自建 ctx 变体）：

```ts
describe('updateSkillFromExtractedDir（共享目录路由）', () => {
  it('更新后重部署到共享目录', async () => {
    const userHome = path.join(tmp, 'user-home')
    const sharedSkills = path.join(userHome, '.agents', 'skills')
    await fs.mkdir(path.join(userHome, '.agents'), { recursive: true })
    const c: SkillCtx = { ...ctx, env: { HOME: userHome, USERPROFILE: userHome } }
    await makeSkill(ssot, 'hello', 'Hello', 'Greets v1', 'v1')
    await seed([
      { dir: 'hello', name: 'Hello', desc: '', repo: 'obra/superpowers', hasUpdate: true, apps: { shared: true } }
    ])
    const repoRoot = path.join(tmp, 'repo')
    await makeSkill(repoRoot, path.join('skills', 'hello'), 'Hello', 'Greets v2', 'v2')

    const result = await updateSkillFromExtractedDir('hello', repoRoot, c)

    const updated = result.find((s) => s.dir === 'hello')
    expect(updated).toMatchObject({ name: 'Hello', desc: 'Greets v2', hasUpdate: false })
    expect(await fs.readFile(path.join(sharedSkills, 'hello', 'SKILL.md'), 'utf8')).toContain('body v2')
  })

  it('apps.shared 开启但 <home>/.agents 缺失时拒绝更新（SSOT 不被改动）', async () => {
    const userHome = path.join(tmp, 'user-home2')   // 不建 .agents
    const c: SkillCtx = { ...ctx, env: { HOME: userHome, USERPROFILE: userHome } }
    await makeSkill(ssot, 'hello', 'Hello', 'Greets v1', 'v1')
    await seed([
      { dir: 'hello', name: 'Hello', desc: '', repo: 'obra/superpowers', hasUpdate: true, apps: { shared: true } }
    ])
    const repoRoot = path.join(tmp, 'repo')
    await makeSkill(repoRoot, path.join('skills', 'hello'), 'Hello', 'Greets v2', 'v2')

    await expect(updateSkillFromExtractedDir('hello', repoRoot, c)).rejects.toThrow(/共享目录/)
    expect(await fs.readFile(path.join(ssot, 'hello', 'SKILL.md'), 'utf8')).toContain('body v1')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run --pool=threads tests/discovery.test.ts`
Expected: FAIL —— 第一个用例落点错误（`resolveAgentPaths('shared')` 抛「未知 agent id」）；第二个用例错误文案不匹配

- [ ] **Step 3: 实现**

`src/main/services/discovery.ts`：

① import 调整——`resolveAgentPaths` 与 `assertAgentRoot` 仅被 `updateSkillFromExtractedDir` 使用（已 grep 确认：本文件仅 609/626 行引用 `AgentId`、609 行 `assertAgentRoot`、629 行 `resolveAgentPaths`），替换为：

```ts
import { resolveSkillsTargetDir } from '../paths'
import { assertSkillTargetRoot } from './agent-root'
```

type import 行改为（`AgentId` 随两处循环替换而孤立，移除）：

```ts
import type { SkillTargetId, RepoConfig, SkillInstalled } from '../types'
```

② `updateSkillFromExtractedDir` 预检循环（现 609-611 行）：

```ts
for (const targetId of Object.keys(entry.apps ?? {}) as SkillTargetId[]) {
  if (entry.apps[targetId]) assertSkillTargetRoot(targetId, settings.dirOverrides, c.env)
}
```

③ 重部署循环（现 626-631 行）：

```ts
for (const targetId of Object.keys(entry.apps ?? {}) as SkillTargetId[]) {
  if (entry.apps[targetId]) {
    await deploySkill(
      c.ssotDir,
      dir,
      resolveSkillsTargetDir(targetId, settings.dirOverrides, c.env),
      settings.syncMethod
    )
  }
}
```

- [ ] **Step 4: 运行确认通过 + 类型门**

Run: `npx vitest run --pool=threads tests/discovery.test.ts`
Expected: PASS
Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: exit 0

- [ ] **Step 5: 提交**

```bash
git add src/main/services/discovery.ts tests/discovery.test.ts
git commit -m "feat: Skill 更新重部署支持共享目录"
```

---

### Task 7: Skill 开关路由至共享目录（toggleSkillOne 迁移 + IPC 签名）

**Files:**
- Modify: `src/main/services/skills.ts`（新增导出 `toggleSkillOne`，带 ctx 注入）
- Modify: `src/main/ipc.ts`（删除本地 `toggleSkillOne`；三个 handler 签名改 `SkillTargetId`；清理孤立 import）
- Test: `tests/skill-io.test.ts`（新增 describe）

**Interfaces:**
- Consumes: Task 1 `resolveSkillsTargetDir` / `SkillTargetId`；Task 2 `assertSkillTargetRoot`；现有 `deploySkill` / `undeploySkill` / `resolveSkillCtx` / `loadSettings`（skills.ts 已导入）。
- Produces: `toggleSkillOne(data: StoreData, entry: SkillInstalled, targetId: SkillTargetId, on: boolean, ctx?: SkillCtx): Promise<void>`（services/skills.ts 导出，供 ipc.ts 两个 handler 调用；`StoreData` 类型经 `import type { StoreData } from '../store'` 引入，ipc.ts 现有 `import type { StoreData } from './store'` 与此独立不冲突）。IPC 通道 `hub:toggleSkill` / `hub:bulkToggleSkill` 的第 2 参数类型变为 `SkillTargetId`（preload 为无类型透传，无需改动）。

- [ ] **Step 1: 写失败测试**

`tests/skill-io.test.ts`：

① import 行更新——从 services/skills 增加导入 `toggleSkillOne`：

```ts
import { deploySkill, toggleSkillOne, uninstallSkill, type SkillCtx } from '../src/main/services/skills'
```

② 末尾新增 describe：

```ts
describe('toggleSkillOne（共享目录路由）', () => {
  it('开启 shared：部署到 <home>/.agents/skills 并置 apps.shared', async () => {
    await fs.mkdir(path.join(userHome, '.agents'), { recursive: true })
    await makeSkill(ssot, 'hello', 'Hello', 'Greets')
    await seed([entry('hello', 'Hello', 'Greets')])
    const data = loadStore(dataPath)
    const e = data.skills[0]!

    await toggleSkillOne(data, e, 'shared', true, ctx)

    expect(e.apps).toEqual({ shared: true })
    expect(
      await fs.readFile(path.join(userHome, '.agents', 'skills', 'hello', 'SKILL.md'), 'utf8')
    ).toContain('name: Hello')
  })

  it('开启 shared 但 <home>/.agents 缺失：抛可读错误、apps 不变、不产生部署', async () => {
    await makeSkill(ssot, 'hello', 'Hello', 'Greets')
    await seed([entry('hello', 'Hello', 'Greets')])
    const data = loadStore(dataPath)
    const e = data.skills[0]!

    await expect(toggleSkillOne(data, e, 'shared', true, ctx)).rejects.toThrow(/共享目录/)
    expect(e.apps).toEqual({})
  })

  it('关闭 shared：移除共享目录部署并清 apps.shared', async () => {
    const sharedSkills = path.join(userHome, '.agents', 'skills')
    await makeSkill(ssot, 'hello', 'Hello', 'Greets')
    await deploySkill(ssot, 'hello', sharedSkills, 'auto')
    await seed([entry('hello', 'Hello', 'Greets', { shared: true })])
    const data = loadStore(dataPath)
    const e = data.skills[0]!

    await toggleSkillOne(data, e, 'shared', false, ctx)

    expect(e.apps).toEqual({})
    await expect(fs.lstat(path.join(sharedSkills, 'hello'))).rejects.toThrow()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run --pool=threads tests/skill-io.test.ts`
Expected: FAIL —— `toggleSkillOne is not a function`（services/skills 未导出）

- [ ] **Step 3: 实现**

① `src/main/services/skills.ts` 新增导出（置于 `deploySkill`/`undeploySkill` 之后、E2 备份段之前）：

```ts
/**
 * 单个 skill 的部署/移除语义（ipc 的 toggleSkill 与 bulkToggleSkill 共用；错误由调用方聚合）。
 * 'shared' 目标部署到 <home>/.agents/skills（写入前检查 <home>/.agents 存在）；不落库——
 * 调用方负责 saveStore。
 */
export async function toggleSkillOne(
  data: StoreData,
  entry: SkillInstalled,
  targetId: SkillTargetId,
  on: boolean,
  ctx?: SkillCtx
): Promise<void> {
  const c = resolveSkillCtx(ctx)
  entry.apps = entry.apps ?? {}
  const settings = loadSettings(c.settingsFile)
  // 部署前检查目标根目录存在（harness 查其最外层配置目录；shared 查 <home>/.agents）；关闭方向无需检查
  const skillsDir = on
    ? assertSkillTargetRoot(targetId, settings.dirOverrides, c.env)
    : resolveSkillsTargetDir(targetId, settings.dirOverrides, c.env)
  if (on) {
    await deploySkill(c.ssotDir, entry.dir, skillsDir, settings.syncMethod)
    entry.apps[targetId] = true
  } else {
    await undeploySkill(path.join(skillsDir, entry.dir))
    delete entry.apps[targetId]
  }
}
```

配套 import：`import { assertSkillTargetRoot } from './agent-root'`、`import type { StoreData } from '../store'`（`loadSettings` 已在导入中；`data` 参数暂未在函数体内使用但保留签名——与 ipc 调用方及未来批量语义对齐，加 `void data` 或以 `_data` 命名均可，**不要**删参数：ipc 侧两个 handler 均传 `data`）。注意无循环依赖：agent-root 只依赖 paths。

② `src/main/ipc.ts`：

- 删除本地 `toggleSkillOne`（现 169-187 行）。
- import 调整：`import { toggleSkillOne, uninstallSkill } from './services/skills'`（`deploySkill`、`undeploySkill` 因迁移孤立，移除）；删除 `import { assertAgentRoot } from './services/agent-root'`（孤立）；paths import 中移除 `ssotSkillsDir`（仅 toggleSkillOne 使用）；删除 `import path from 'node:path'`（仅 toggleSkillOne 使用）；type import 加 `SkillTargetId`。
- 两个 handler 签名与传参（`agentId` → `targetId`）：

```ts
ipcMain.handle('hub:toggleSkill', async (_event, dir: string, targetId: SkillTargetId, on: boolean) => {
  try {
    const data = loadStore(dataFile())
    const entry = data.skills.find((s) => s.dir === dir)
    if (!entry) throw new Error(`skill not found: ${dir}`)
    await toggleSkillOne(data, entry, targetId, on)
    await saveStore(dataFile(), data)
    return data.skills
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:bulkToggleSkill', async (_event, targetId: SkillTargetId, on: boolean) => {
  try {
    const data = loadStore(dataFile())
    // 错误聚合：单条失败不中断，收集后返回，避免中途放弃
    const errors: string[] = []
    for (const entry of data.skills) {
      try {
        await toggleSkillOne(data, entry, targetId, on)
      } catch (err) {
        errors.push(`${entry.dir}: ${errMessage(err)}`)
      }
    }
    await saveStore(dataFile(), data)
    return { skills: data.skills, errors }
  } catch (err) {
    throw new Error(errMessage(err))
  }
})
```

- `hub:importSkills` handler 的 items 类型注解改为 `{ dir: string; apps: Partial<Record<SkillTargetId, boolean>> }[]`。

- [ ] **Step 4: 运行确认通过 + 类型门**

Run: `npx vitest run --pool=threads tests/skill-io.test.ts`
Expected: PASS
Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: exit 0（若报未使用变量 `data`，按 Step 3 的 `void data` 处理）
Run: `npx vitest run --pool=threads`（全量——确认 ipc 改动无回归）
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/main/services/skills.ts src/main/ipc.ts tests/skill-io.test.ts
git commit -m "feat: Skill 开关路由至共享目录（toggleSkillOne 迁移至 services）"
```

---

### Task 8: 渲染层数据与图标（data.js / icons.js）

**Files:**
- Modify: `src/renderer/data.js`（新增 `SHARED_TARGET` / `SKILL_TARGETS` / `SKILL_TARGET_BY`）
- Modify: `src/renderer/icons.js`（`ICONS.shared` 新增文件夹图标）
- Test: `tests/renderer/data.test.ts`（新建）

**Interfaces:**
- Consumes: 现有 `AGENTS` / `AGENT_BY`（data.js）。
- Produces: `SHARED_TARGET = { id: 'shared', name: '共享目录', short: '共享目录', skillsDir: '~/.agents/skills' }`；`SKILL_TARGETS = [SHARED_TARGET, ...AGENTS]`；`SKILL_TARGET_BY(id)`（`'shared'` 命中共享目标，其余回落 `AGENT_BY`）。Task 9/10/11 依赖这三个名字。

- [ ] **Step 1: 写失败测试**

新建 `tests/renderer/data.test.ts`：

```ts
// tests/renderer/data.test.ts —— Skills 部署目标序列（共享目录置顶，仅 Skills 视图使用）
import { describe, expect, it } from 'vitest'
import { AGENTS, SHARED_TARGET, SKILL_TARGETS, SKILL_TARGET_BY } from '../../src/renderer/data.js'

describe('SKILL_TARGETS / SKILL_TARGET_BY', () => {
  it('共享目录置顶，其后为 7 个 harness（顺序与 AGENTS 一致）', () => {
    expect(SKILL_TARGETS[0]).toBe(SHARED_TARGET)
    expect(SKILL_TARGETS.slice(1)).toEqual(AGENTS)
    expect(SKILL_TARGETS).toHaveLength(8)
  })

  it('SHARED_TARGET 关键字段', () => {
    expect(SHARED_TARGET).toMatchObject({ id: 'shared', name: '共享目录', skillsDir: '~/.agents/skills' })
  })

  it('SKILL_TARGET_BY：shared 命中共享目标；harness id 回落 AGENT_BY；未知 id 为 undefined', () => {
    expect(SKILL_TARGET_BY('shared')).toBe(SHARED_TARGET)
    expect(SKILL_TARGET_BY('dsh')?.id).toBe('dsh')
    expect(SKILL_TARGET_BY('nope')).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run --pool=threads tests/renderer/data.test.ts`
Expected: FAIL —— `SyntaxError: ... does not provide an export named 'SHARED_TARGET'`

- [ ] **Step 3: 实现**

① `src/renderer/data.js` 的 `AGENT_BY` 之后（MCP_PRESETS 之前）追加：

```js
/* ---- Skills 部署目标：7 harness + Agent Skills 共享目录（共享置顶，仅 Skills 视图使用；
 * MCP / 提示词 / Dashboard / 侧边栏仍只用 AGENTS ---- */
export const SHARED_TARGET = { id:'shared', name:'共享目录', short:'共享目录', skillsDir:'~/.agents/skills' };
export const SKILL_TARGETS = [SHARED_TARGET, ...AGENTS];
export function SKILL_TARGET_BY(id){ return id==='shared' ? SHARED_TARGET : AGENT_BY(id); }
```

② `src/renderer/icons.js` 的 `ICONS` 对象内（`hermes` 之后）新增：

```js
  shared: `<svg fill="currentColor" height="1em" style="flex:none;line-height:1" viewBox="0 0 24 24" width="1em" xmlns="http://www.w3.org/2000/svg"><title>共享目录</title><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"></path></svg>`,
```

（`icon()` 函数无需修改——所有 skill 视图调用点均显式传 title。）

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run --pool=threads tests/renderer/data.test.ts`
Expected: PASS（3 passed）

- [ ] **Step 5: 提交**

```bash
git add src/renderer/data.js src/renderer/icons.js tests/renderer/data.test.ts
git commit -m "feat: 渲染层新增共享目录部署目标数据与图标"
```

---

### Task 9: Skills 矩阵与计数徽章新增共享目录列（matrix.js）

**Files:**
- Modify: `src/renderer/ui/matrix.js`（skill 分支目标序列换 `SKILL_TARGETS`；toast 信息源换 `SKILL_TARGET_BY`；清理孤立 import）

**Interfaces:**
- Consumes: Task 8 的 `SKILL_TARGETS` / `SKILL_TARGET_BY`。
- Produces: 矩阵列与计数徽章首位出现「共享目录」；开关 `data-agent="shared"` 经现有 `window.hub.toggleSkill` / `bulkToggleSkill` 透传（preload 无类型，无需改动）。

**说明：** DOM 模块无单测（spec §9，用户已确认的 spec 声明）——验证为「同类纯模块测试已覆盖数据层（Task 8）+ Task 12 全量 build 与手测」。本任务改动逐一列出，执行时按清单核对。

- [ ] **Step 1: 修改 renderCountBar（skills 计数徽章共享置顶）**

import 行改为：

```js
import { AGENTS, SKILL_TARGETS, SKILL_TARGET_BY } from '../data.js';
```

（`AGENT_BY` 在本文件的三处使用全部随下面各步替换为 `SKILL_TARGET_BY`，故移除。）

`renderCountBar` 函数体：`const unit = ...` 行之后加：

```js
  const targets = kind==='skill' ? SKILL_TARGETS : AGENTS;
```

`const badges = AGENTS.map(a=>{` → `const badges = targets.map(a=>{`；徽章点击回调内 `const agent = AGENT_BY(agentId);` → `const agent = SKILL_TARGET_BY(agentId);`（MCP 分支同名落点不变——`SKILL_TARGET_BY` 对 harness id 回落 `AGENT_BY`）。

- [ ] **Step 2: 修改 renderMatrix（矩阵列共享置顶）**

函数体 `const items = ...` 之后加：

```js
  const targets = kind==='skill' ? SKILL_TARGETS : AGENTS;
```

thead 的 `${AGENTS.map(a=>...)}` → `${targets.map(a=>...)}`；cells 的 `const cells = AGENTS.map(a=>` → `const targets.map(a=>`。MCP 分支因 `kind==='mcp'` 仍取 `AGENTS`，行为不变。

- [ ] **Step 3: 修改开关 toast 信息源**

矩阵 checkbox change 回调内两处 `const agentObj = AGENT_BY(agent);` → `const agentObj = SKILL_TARGET_BY(agent);`（skill 分支 toast「部署到 ${agentObj.skillsDir}」对 shared 显示 `~/.agents/skills`；MCP 分支同名对象回落，不变）。

- [ ] **Step 4: 核对孤立导入**

搜索本文件剩余 `AGENT_BY` 使用——应为 0；确认 `AGENTS` 仍被使用（MCP 分支 / 非空判断）。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/ui/matrix.js
git commit -m "feat: Skills 矩阵与计数徽章新增共享目录列"
```

---

### Task 10: Skill 详情页共享目录 tab（detail.js）

**Files:**
- Modify: `src/renderer/ui/detail.js`（skill 分支 tabs 用 `SKILL_TARGETS`；renderBody 信息源换 `SKILL_TARGET_BY`）

**Interfaces:**
- Consumes: Task 8 的 `SKILL_TARGETS` / `SKILL_TARGET_BY`。
- Produces: skill 详情首位 tab「共享目录」，部署位置显示 `~/.agents/skills/<dir>`（关闭态）或 `~/.agents/skills/<dir> -> <SSOT>/<dir>`（开启态）。

**说明：** DOM 模块无单测（同 Task 9 说明）。

- [ ] **Step 1: 修改 tabs 渲染**

import 行改为：

```js
import { AGENTS, SKILL_TARGETS, SKILL_TARGET_BY, SSOT_DIR } from '../data.js';
```

`openDetail` 内 `const tabs = $('detail-tabs');` 之前加：

```js
  const targets = isMcp ? AGENTS : SKILL_TARGETS;
```

`tabs.innerHTML = AGENTS.map((a,i)=>` → `targets.map((a,i)=>`；末尾 `renderBody(AGENTS[0].id)` → `renderBody(targets[0].id)`。

- [ ] **Step 2: 修改 renderBody 信息源**

`renderBody` 内 `const agent = AGENT_BY(agentId);` → `const agent = SKILL_TARGET_BY(agentId);`（MCP 分支用 `agent.mcpPath` / `agent.mcpFormat`——harness id 回落同名对象，不变；skill 分支 `agent.skillsDir` / `agent.short` 对 shared 显示共享路径与「共享目录」）。

- [ ] **Step 3: 核对孤立导入**

搜索本文件剩余 `AGENT_BY` 使用——应为 0（`AGENTS` 仍被 isMcp 分支使用，保留）。

- [ ] **Step 4: 提交**

```bash
git add src/renderer/ui/detail.js
git commit -m "feat: Skill 详情页新增共享目录 tab"
```

---

### Task 11: Skills 导入弹窗支持共享目录（skills.js）

**Files:**
- Modify: `src/renderer/ui/skills.js`（mini-toggles 共享置顶；「发现于」标签映射；确认文案 targets 映射）

**Interfaces:**
- Consumes: Task 8 的 `SKILL_TARGETS` / `SKILL_TARGET_BY`；Task 4 后端返回的 `foundIn` 可含 `'shared'`。
- Produces: 导入弹窗首位共享开关；`importSkills` 的 `items[].apps` 可含 `shared` 键（preload 无类型透传）。

**说明：** DOM 模块无单测（同 Task 9 说明）。注意本文件「发现于」展示顺序遵循 `foundIn` 数组序（harness 在前、shared 在后），与开关/列的共享**置顶**序不同——这是 spec §5 的既定设计。

- [ ] **Step 1: 修改 import 与「发现于」标签**

import 行改为：

```js
import { SKILL_TARGETS, SKILL_TARGET_BY } from '../data.js';
```

（本文件 `AGENTS` / `AGENT_BY` 的全部使用随下面各步替换，移除。）

`renderUnmanaged` 内「发现于」行改为：

```js
        <div style="font-family:var(--font-mono);font-size:10.5px;color:var(--text-faint);margin-top:3px;">${s.path} · 发现于 ${s.foundIn.map(f=>SKILL_TARGET_BY(f)?.short||f).join('、')}</div>
```

- [ ] **Step 2: 修改 mini-toggles（共享置顶）**

同函数内：

```js
          ${SKILL_TARGETS.map(a=>`<button class="mini-toggle ${s.foundIn.includes(a.id)?'on':''}" data-um-app="${i}" data-app="${a.id}" title="${a.name}">${icon(a.id,15,a.name)}</button>`).join('')}
```

（仅 `AGENTS.map` → `SKILL_TARGETS.map`，其余不变——预选由 `foundIn.includes('shared')` 驱动：仅共享命中的 skill 预亮共享、不亮任何 harness。）

- [ ] **Step 3: 修改确认文案 targets 映射**

`import-skills-confirm` 回调内：

```js
  const targets = [...new Set(items.flatMap(it=>Object.entries(it.apps ?? {}).filter(([,on])=>on).map(([id])=>id)))]
    .map(id=>SKILL_TARGET_BY(id)?.short || id);
```

（仅末行 `AGENT_BY` → `SKILL_TARGET_BY`；`importConfirmMessage` 本身不改——见「与 spec 的偏差说明」第 1 条。）

- [ ] **Step 4: 核对孤立导入**

搜索本文件剩余 `AGENTS` / `AGENT_BY` 使用——应为 0。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/ui/skills.js
git commit -m "feat: Skills 导入弹窗支持共享目录"
```

---

### Task 12: 全量验证与手测清单

**Files:**
- 无新文件（仅验证；如手测发现缺陷，修复后重跑本任务全部验证门）

- [ ] **Step 1: 全量测试**

Run: `npx vitest run --pool=threads`
Expected: 19 个测试文件全 PASS（新增 `tests/renderer/data.test.ts`）

- [ ] **Step 2: 类型门**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: exit 0

- [ ] **Step 3: 构建（需脱离受限沙箱）**

Run: `pnpm build`（以 `sandbox_permissions: danger-full-access` 升级执行，或由用户在沙箱外运行）
Expected: exit 0，renderer 产物正常生成

- [ ] **Step 4: 手测清单（`pnpm dev`，逐项核对）**

1. Skills「已安装」视图：矩阵与计数徽章**首位**出现「共享目录」列（文件夹图标），其后为 DSH…Hermes。
2. 开启某 skill 的共享开关 → toast「已在 共享目录 中开启 …（部署到 ~/.agents/skills）」；`~/.agents/skills/<dir>` 出现（junction/链接或副本）。
3. `~/.agents` 不存在时（临时改名验证后还原）开启共享开关 → toast 报「未检测到 Agent Skills 共享目录…」，开关回弹、库未变。
4. 计数徽章「共享目录」点击批量开启/关闭 → toast「已在 共享目录 中全部开启/关闭 Skills」。
5. Skill 详情：首位 tab「共享目录」，部署位置显示 `~/.agents/skills/<dir>`；MCP 详情 tab 不变（7 个）。
6. 「导入本机 Skill」：在 `~/.agents/skills` 手工放一个含 SKILL.md 的目录 → 扫描列表出现该项，「发现于 共享目录」，mini-toggles 仅共享预亮；勾选导入+开 shared → 原实体目录被替换为部署形态。
7. 「发现于」混合场景：同名目录同时存在于某 harness 与共享目录 → 标签「DSH、共享目录」样式，导入后两者均预亮。
8. 反面清单：MCP 矩阵/表单、提示词页、Dashboard（已接入 harness 数/概览）、侧边栏、Harness 管理页——**均无共享目录踪迹**。
9. 卸载含 shared 部署的 skill → `~/.agents/skills/<dir>` 移除；「从备份恢复」勾选部署 → 回部署到共享目录。

- [ ] **Step 5: 收尾汇报**

按全局约束「五、实施与报告规范」输出报告（改动概要 / 验证证据 / 关联影响与设计期遗漏 / 裁决披露 / 风险自陈）；提及 `docs/设计文档.md`（用户有未提交改动，未触碰）可由用户自行补充共享目录章节。

---

## Self-Review（计划自检记录）

1. **Spec 覆盖**：spec §3（数据模型/路径）→ Task 1；§4 六个路由点 → Task 3（uninstall）、Task 4（import+扫描+源定位）、Task 5（restore）、Task 6（update）、Task 7（toggle/bulk，含迁移偏差说明 2）；根目录断言 → Task 2；§5 前端七行 → Task 8（data/icons）、Task 9（矩阵/徽章）、Task 10（详情）、Task 11（导入弹窗三处）；§6 IPC 契约 → Task 7（preload 无类型透传，无需改动，已在 Interfaces 注明）；§7 行为语义 → 各任务用例（auto 复制替换=Task 4 用例 3；卸载/恢复含 shared=Task 3/5；兼容性=Partial 键域自然兼容）；§8 明确不做 → 计划未引入任何对应改动；§9 测试计划 → 各任务 Step 1（import-notice 测试项按偏差说明 1 取消）。
2. **占位符扫描**：无 TBD/TODO；所有代码步骤含完整代码；命令均带期望输出。
3. **类型一致性**：`SkillTargetId`（Task 1 定义，Task 3-7 消费）、`resolveSkillsTargetDir` / `assertSkillTargetRoot` / `agentsSharedRoot` / `agentsSharedSkillsDir`（Task 1/2 定义，后续任务签名一致）、`SHARED_TARGET` / `SKILL_TARGETS` / `SKILL_TARGET_BY`（Task 8 定义，Task 9-11 消费）——已逐一核对拼写与参数序。
4. **执行顺序依赖**：Task 1→2→…→7 严格顺序（types/paths 先行）；Task 8→9/10/11 顺序（渲染层依赖数据）；Task 9/10/11 彼此独立可并行复核。
