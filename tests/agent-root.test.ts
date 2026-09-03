// tests/agent-root.test.ts —— 需求 3：MCP / Skills 写入前检测「最外层配置目录」（Harness 管理的目录覆盖已生效）
// 目录不存在 -> 不写入并抛可读错误（渲染层 toast 提示）；批量操作预检避免部分写入。
// fixture 同 mcp.test.ts / skill-io.test.ts：mkdtemp 假 harness 家目录，settings.dirOverrides 指向 fixture。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { AGENTS } from '../src/main/paths'
import { loadStore, saveSettings, saveStore } from '../src/main/store'
import type { AgentId, AppSettings, McpItem, SkillInstalled } from '../src/main/types'
import { assertAgentRoot, assertSkillTargetRoot } from '../src/main/services/agent-root'
import { bulkToggleMcp, saveMcp, toggleMcp, type McpCtx } from '../src/main/services/mcp'
import { deploySkill, uninstallSkill, type SkillCtx } from '../src/main/services/skills'
import { importSkills, restoreSkillBackup } from '../src/main/services/skill-io'

const AGENT_IDS: AgentId[] = ['dsh', 'claude', 'codex', 'gemini', 'grok', 'opencode', 'hermes']

/** 覆盖后各 agent 的 MCP 配置文件相对路径（对齐 resolveAgentPaths 语义） */
const MCP_FILE_NAME: Record<AgentId, string> = {
  dsh: 'profiles/web/cordis.patch.yml',
  claude: '.claude.json',
  codex: 'config.toml',
  gemini: 'settings.json',
  grok: 'config.toml',
  opencode: 'opencode.json',
  hermes: 'config.yaml'
}

let tmp: string
let homes: string
let ssot: string
let backups: string
let dataPath: string
let settingsPath: string
let overrides: Partial<Record<AgentId, string>>
let mcpCtx: McpCtx
let skillCtx: SkillCtx

function homeOf(agentId: AgentId): string {
  return path.join(homes, agentId)
}

/** 删除指定 agent 的最外层配置目录（模拟未安装） */
async function removeHome(agentId: AgentId): Promise<void> {
  await fs.rm(homeOf(agentId), { recursive: true, force: true })
}

function emptyPrompts(): Record<AgentId, unknown[]> {
  const prompts: Record<AgentId, unknown[]> = {} as Record<AgentId, unknown[]>
  for (const id of AGENT_IDS) prompts[id] = []
  return prompts
}

async function seed(items: McpItem[]): Promise<void> {
  await saveStore(dataPath, {
    version: 1,
    mcpItems: items,
    skills: [],
    prompts: emptyPrompts() as never,
    skillRepos: []
  })
}

async function seedSkills(items: SkillInstalled[]): Promise<void> {
  await saveStore(dataPath, {
    version: 1,
    mcpItems: [],
    skills: items,
    prompts: emptyPrompts() as never,
    skillRepos: []
  })
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-root-'))
  homes = path.join(tmp, 'homes')
  ssot = path.join(tmp, 'ssot')
  backups = path.join(tmp, 'backups')
  dataPath = path.join(tmp, 'data.json')
  settingsPath = path.join(tmp, 'settings.json')
  overrides = {}
  for (const a of AGENTS) {
    overrides[a.id] = homeOf(a.id)
    await fs.mkdir(homeOf(a.id), { recursive: true })
  }
  const settings: AppSettings = {
    dirOverrides: overrides,
    syncMethod: 'auto',
    backupBeforeWrite: true,
    skillUninstallBackup: true
  }
  await saveSettings(settingsPath, settings)
  mcpCtx = {
    dataFile: dataPath,
    settingsFile: settingsPath,
    backupDir: path.join(tmp, 'mcp-backups'),
    env: { HOME: '/none', USERPROFILE: tmp }
  }
  skillCtx = {
    dataFile: dataPath,
    settingsFile: settingsPath,
    ssotDir: ssot,
    backupsDir: backups,
    env: { HOME: '/none', USERPROFILE: tmp }
  }
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('assertAgentRoot', () => {
  it('目录存在时返回解析结果，覆盖目录生效', () => {
    const r = assertAgentRoot('dsh', overrides, { HOME: '/none', USERPROFILE: tmp })
    expect(r.root).toBe(homeOf('dsh'))
    expect(r.skillsDir).toBe(path.join(homeOf('dsh'), 'skills'))
  })

  it('目录缺失时抛可读错误（含 agent 名与路径）', async () => {
    await removeHome('codex')
    expect(() => assertAgentRoot('codex', overrides, { HOME: '/none', USERPROFILE: tmp })).toThrow(
      /未检测到 Codex 的配置目录/
    )
  })
})

describe('MCP 写入目录检查', () => {
  const DBX: McpItem = {
    id: 'dbx',
    name: 'DBX',
    spec: { type: 'stdio', command: 'npx', args: ['dbx'] },
    apps: {}
  }

  it('toggleMcp 启用到目录缺失的 harness 时抛错，且不写文件、不改库', async () => {
    await removeHome('codex')
    await seed([DBX])

    await expect(toggleMcp('dbx', 'codex', true, mcpCtx)).rejects.toThrow(/配置目录/)

    expect(loadStore(dataPath).mcpItems[0].apps.codex).toBeUndefined()
    await expect(fs.access(path.join(homeOf('codex'), MCP_FILE_NAME.codex))).rejects.toThrow()
  })

  it('saveMcp 预检：任一目标 harness 目录缺失则整单拒绝（不产生部分写入）', async () => {
    await removeHome('codex')
    await seed([])
    const item: McpItem = {
      id: 'x',
      name: 'X',
      spec: { type: 'stdio', command: 'npx', args: ['x'] },
      apps: { claude: true, codex: true }
    }

    await expect(saveMcp(item, undefined, mcpCtx)).rejects.toThrow(/配置目录/)

    // claude 目录存在但文件未被写入（预检发生在任何写入之前）
    await expect(fs.access(path.join(homeOf('claude'), MCP_FILE_NAME.claude))).rejects.toThrow()
    expect(loadStore(dataPath).mcpItems).toHaveLength(0)
  })

  it('bulkToggleMcp 目标目录缺失时抛错', async () => {
    await removeHome('codex')
    await seed([DBX])

    await expect(bulkToggleMcp('codex', true, mcpCtx)).rejects.toThrow(/配置目录/)
    expect(loadStore(dataPath).mcpItems[0].apps.codex).toBeUndefined()
  })
})

describe('Skills 写入目录检查', () => {
  /** 在 dsh harness 放一个未纳管 skill（目录存在） */
  async function seedHarnessSkill(dir: string): Promise<void> {
    const p = path.join(homeOf('dsh'), 'skills', dir)
    await fs.mkdir(p, { recursive: true })
    await fs.writeFile(path.join(p, 'SKILL.md'), '---\nname: Manual\ndescription: x\n---\nx', 'utf8')
  }

  it('importSkills：任一目标 harness 目录缺失则整批拒绝（SSOT 无写入、不入库）', async () => {
    await seedHarnessSkill('manual')
    await removeHome('codex')
    await seedSkills([])

    await expect(
      importSkills([{ dir: 'manual', apps: { dsh: true, codex: true } }], skillCtx)
    ).rejects.toThrow(/配置目录/)

    await expect(fs.access(path.join(ssot, 'manual'))).rejects.toThrow()
    expect(loadStore(dataPath).skills).toHaveLength(0)
  })

  it('restoreSkillBackup deploy=true 且目标目录缺失时拒绝（不产生任何恢复写入）', async () => {
    // 1. 建 SSOT skill 并部署到 dsh/codex -> 卸载生成备份（meta.apps={dsh:true, codex:true}）
    const skill = path.join(ssot, 'hello')
    await fs.mkdir(path.join(skill, 'scripts'), { recursive: true })
    await fs.writeFile(path.join(skill, 'SKILL.md'), '---\nname: Hello\ndescription: d\n---\nx', 'utf8')
    await fs.writeFile(path.join(skill, 'scripts', 'run.js'), 'x', 'utf8')
    await seedSkills([
      { dir: 'hello', name: 'Hello', desc: 'd', repo: null, hasUpdate: false, apps: { dsh: true, codex: true } }
    ])
    await deploySkill(ssot, 'hello', path.join(homeOf('dsh'), 'skills'), 'auto')
    await deploySkill(ssot, 'hello', path.join(homeOf('codex'), 'skills'), 'auto')
    await uninstallSkill('hello', skillCtx)
    const id = (await fs.readdir(backups))[0]
    expect(id).toBeTruthy()

    // 2. 删除 codex 目录后恢复 -> 拒绝，SSOT 不被重建、不入库
    await removeHome('codex')
    await expect(restoreSkillBackup(id, true, skillCtx)).rejects.toThrow(/配置目录/)
    await expect(fs.access(path.join(ssot, 'hello'))).rejects.toThrow()
    expect(loadStore(dataPath).skills).toHaveLength(0)
  })
})

describe('assertSkillTargetRoot', () => {
  // USERPROFILE 用 getter 惰性取值：describe 体在收集期执行，彼时 tmp 尚未赋值（beforeEach 中才建）
  const ENV = { HOME: '/none', get USERPROFILE() { return tmp } }

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
