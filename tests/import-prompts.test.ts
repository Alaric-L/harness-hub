// tests/import-prompts.test.ts —— F1 扩展：提示词页「从各 harness 导入」（importPromptsFromHarnesses）
// 遍历各 harness 指令文件（resolveAgentPaths，目录覆盖已生效），内容不在库中则新增「原始提示词」禁用条目。
// fixture 与 prompts.test.ts 同套路：mkdtemp 假 harness 家目录，settings.dirOverrides 指向 fixture。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { AGENTS } from '../src/main/paths'
import { loadStore, saveSettings, saveStore } from '../src/main/store'
import type { AgentId, AppSettings, PromptItem } from '../src/main/types'
import { importPromptsFromHarnesses, type PromptCtx } from '../src/main/services/prompts'

const AGENT_IDS: AgentId[] = ['dsh', 'claude', 'codex', 'gemini', 'grok', 'opencode', 'hermes']

/** 覆盖后各 agent 的指令文件（basename，对齐 resolveAgentPaths 覆盖语义） */
function promptFileName(agentId: AgentId): string {
  const tpl = AGENTS.find((a) => a.id === agentId)!.promptFile
  return path.basename(tpl)
}

let tmp: string
let homesDir: string
let dataPath: string
let settingsPath: string
let backupDir: string
let overrides: Partial<Record<AgentId, string>>
let ctx: PromptCtx

function promptFileOf(agentId: AgentId): string {
  return path.join(homesDir, agentId, promptFileName(agentId))
}

function emptyPrompts(): Record<AgentId, PromptItem[]> {
  const prompts = {} as Record<AgentId, PromptItem[]>
  for (const id of AGENT_IDS) prompts[id] = []
  return prompts
}

/** 以 prompts 库种 store（其余集合为空） */
async function seed(prompts: Record<AgentId, PromptItem[]>): Promise<void> {
  await saveStore(dataPath, {
    version: 1,
    mcpItems: [],
    skills: [],
    prompts,
    skillRepos: []
  })
}

async function writeLive(agentId: AgentId, content: string): Promise<void> {
  await fs.mkdir(path.dirname(promptFileOf(agentId)), { recursive: true })
  await fs.writeFile(promptFileOf(agentId), content, 'utf8')
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'import-prompts-'))
  homesDir = path.join(tmp, 'homes')
  dataPath = path.join(tmp, 'hub', 'data.json')
  settingsPath = path.join(tmp, 'hub', 'settings.json')
  backupDir = path.join(tmp, 'hub', 'backups')
  overrides = {}
  for (const a of AGENTS) {
    overrides[a.id] = path.join(homesDir, a.id)
    await fs.mkdir(path.join(homesDir, a.id), { recursive: true })
  }
  const settings: AppSettings = {
    dirOverrides: overrides,
    syncMethod: 'auto',
    backupBeforeWrite: true,
    skillUninstallBackup: true
  }
  await saveSettings(settingsPath, settings)
  ctx = {
    dataFile: dataPath,
    settingsFile: settingsPath,
    backupDir,
    env: { HOME: '/none', USERPROFILE: tmp }
  }
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('importPromptsFromHarnesses', () => {
  it('扫描各 harness 指令文件，内容不在库中的新增「原始提示词」禁用条目', async () => {
    await writeLive('dsh', '# dsh live content')
    await writeLive('claude', '# claude live content')
    await seed(emptyPrompts())

    const res = await importPromptsFromHarnesses(ctx)

    expect(res.added).toBe(2)
    expect(res.imported.dsh).toHaveLength(1)
    expect(res.imported.claude).toHaveLength(1)
    const dshList = loadStore(dataPath).prompts.dsh
    expect(dshList).toHaveLength(1)
    expect(dshList[0]).toMatchObject({
      content: '# dsh live content',
      enabled: false,
      desc: '从 harness 配置目录导入的原始提示词'
    })
    expect(dshList[0].name).toContain('原始提示词')
  })

  it('内容已存在（含激活条目）时不重复导入', async () => {
    await writeLive('dsh', '# same content')
    await seed({
      ...emptyPrompts(),
      dsh: [{ id: 'x1', name: 'A', content: '# same content', enabled: true, updatedAt: 1 }]
    })

    const res = await importPromptsFromHarnesses(ctx)

    expect(res.added).toBe(0)
    expect(loadStore(dataPath).prompts.dsh).toHaveLength(1)
  })

  it('指令文件不存在或为空时跳过该 harness', async () => {
    await seed(emptyPrompts())

    const res = await importPromptsFromHarnesses(ctx)

    expect(res.added).toBe(0)
    expect(res.imported).toEqual({})
  })

  it('目录覆盖已生效：只从覆盖目录读指令文件', async () => {
    // 覆盖目录之外的模板路径不读取：override 指向 homesDir/<id>，模板路径在别处
    await writeLive('dsh', '# override live')
    // 在模板默认位置也放一份不同内容，验证读取的是覆盖目录那份
    const tpl = AGENTS.find((a) => a.id === 'dsh')!.promptFile
    const fakeHome = path.join(tmp, 'fakehome')
    const tplPath = path.join(fakeHome, tpl.replace(/^~\/?/, ''))
    await fs.mkdir(path.dirname(tplPath), { recursive: true })
    await fs.writeFile(tplPath, '# template live', 'utf8')
    await seed(emptyPrompts())

    const res = await importPromptsFromHarnesses(ctx)

    expect(loadStore(dataPath).prompts.dsh[0].content).toBe('# override live')
    expect(res.added).toBe(1)
  })
})
