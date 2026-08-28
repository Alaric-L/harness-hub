// tests/prompts.test.ts —— F1: 提示词库 + 激活（含 live 回填）；F2: 复制到其他 harness
// 对齐 cc-switch prompt.rs：upsert_prompt:64-98 / enable_prompt:116-191 / delete_prompt:100-114
// fixture 与 mcp.test.ts 同套路：mkdtemp 假 harness 家目录，settings.dirOverrides 指向 fixture。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { AGENTS } from '../src/main/paths'
import { saveSettings, saveStore } from '../src/main/store'
import type { AgentId, AppSettings, PromptItem } from '../src/main/types'
import {
  copyPrompt,
  deletePrompt,
  disablePrompt,
  enablePrompt,
  listPrompts,
  savePrompt,
  type PromptCtx
} from '../src/main/services/prompts'

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
async function seed(agentId: AgentId, items: PromptItem[]): Promise<void> {
  const prompts = emptyPrompts()
  prompts[agentId] = items
  await saveStore(dataPath, {
    version: 1,
    mcpItems: [],
    skills: [],
    prompts,
    skillRepos: []
  })
}

async function readLive(agentId: AgentId): Promise<string> {
  return fs.readFile(promptFileOf(agentId), 'utf8')
}

async function writeLive(agentId: AgentId, content: string): Promise<void> {
  await fs.mkdir(path.dirname(promptFileOf(agentId)), { recursive: true })
  await fs.writeFile(promptFileOf(agentId), content, 'utf8')
}

/** 列出 backup 目录（若 backupBeforeWrite=false 时实际为 <backupDir>/.disabled）下的 .bak 文件 */
async function backupFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir).catch(() => [] as string[])
  return entries.filter((f) => f.endsWith('.bak'))
}

async function saveSettingsWith(settings: AppSettings): Promise<void> {
  await saveSettings(settingsPath, settings)
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prompts-'))
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

describe('listPrompts', () => {
  it('返回指定 harness 的提示词库', async () => {
    const p1: PromptItem = {
      id: 'p1', name: 'A', content: 'content-A', enabled: false, updatedAt: 1
    }
    await seed('dsh', [p1])

    const list = listPrompts('dsh', ctx)

    expect(list).toHaveLength(1)
    expect(list[0]).toEqual(p1)
  })

  it('库为空时返回空数组', async () => {
    await seed('dsh', [])

    expect(listPrompts('dsh', ctx)).toEqual([])
  })
})

describe('savePrompt', () => {
  it('新增：默认未激活、id 为截断 uuid、updatedAt 为 now（传入 enabled=true 也被强制为 false）', async () => {
    await seed('dsh', [])
    const before = Date.now()

    const list = await savePrompt(
      'dsh',
      { id: '', name: 'New', desc: 'descr', content: 'C', enabled: true, updatedAt: 0 },
      ctx
    )

    expect(list).toHaveLength(1)
    const item = list[0]
    expect(item.enabled).toBe(false)
    expect(item.name).toBe('New')
    expect(item.content).toBe('C')
    expect(item.updatedAt).toBeGreaterThanOrEqual(before)
    expect(item.id).toMatch(/^[0-9a-f]{8}$/)
  })

  it('编辑：保留 id、刷新 updatedAt、不触碰指令文件（未激活条目）', async () => {
    const p1: PromptItem = {
      id: 'p1', name: 'A', content: 'old', enabled: false, updatedAt: 1
    }
    await seed('dsh', [p1])

    const list = await savePrompt(
      'dsh',
      { ...p1, content: 'new', updatedAt: 0 },
      ctx
    )

    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('p1')
    expect(list[0].content).toBe('new')
    expect(list[0].updatedAt).toBeGreaterThan(1)
    // 未激活编辑不写指令文件
    await expect(readLive('dsh')).rejects.toThrow()
  })

  it('编辑已激活条目：保存后立即写入指令文件', async () => {
    const p1: PromptItem = {
      id: 'p1', name: 'A', content: 'A1', enabled: true, updatedAt: 1234
    }
    await seed('dsh', [p1])
    await writeLive('dsh', 'A1')

    await savePrompt('dsh', { ...p1, content: 'A2', updatedAt: 0 }, ctx)

    expect(listPrompts('dsh', ctx)[0].content).toBe('A2')
    expect(await readLive('dsh')).toBe('A2')
  })
})

describe('enablePrompt（live 回填）', () => {
  it('live 文件外部被改 -> 激活另一条，原激活条目 content/updatedAt 回填为 live 内容', async () => {
    const p1: PromptItem = {
      id: 'p1', name: 'A', content: 'A-content', enabled: true, updatedAt: 10
    }
    const p2: PromptItem = {
      id: 'p2', name: 'B', content: 'B-content', enabled: false, updatedAt: 20
    }
    await seed('dsh', [p1, p2])
    await writeLive('dsh', 'EXTERNAL-LIVE-CONTENT')

    await enablePrompt('dsh', 'p2', ctx)

    const list = listPrompts('dsh', ctx)
    const a = list.find((i) => i.id === 'p1')!
    const b = list.find((i) => i.id === 'p2')!
    expect(a.content).toBe('EXTERNAL-LIVE-CONTENT')
    expect(a.updatedAt).toBeGreaterThan(10)
    expect(a.enabled).toBe(false)
    expect(b.enabled).toBe(true)
    expect(await readLive('dsh')).toBe('B-content')
  })

  it('无启用条目 + live 非空 -> 创建「原始提示词 <local time>」备份条目（enabled:false）', async () => {
    const p1: PromptItem = {
      id: 'p1', name: 'A', content: 'A-content', enabled: false, updatedAt: 1
    }
    await seed('dsh', [p1])
    await writeLive('dsh', 'ORPHAN-CONTENT')

    await enablePrompt('dsh', 'p1', ctx)

    const list = listPrompts('dsh', ctx)
    expect(list).toHaveLength(2)
    const backup = list.find((i) => i.id !== 'p1')!
    expect(backup.enabled).toBe(false)
    expect(backup.content).toBe('ORPHAN-CONTENT')
    expect(backup.name).toMatch(/^原始提示词 \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(list.find((i) => i.id === 'p1')!.enabled).toBe(true)
    expect(await readLive('dsh')).toBe('A-content')
  })

  it('live 内容已存在于某条目 -> 不重复创建备份条目', async () => {
    const p1: PromptItem = {
      id: 'p1', name: 'A', content: 'DUP-CONTENT', enabled: false, updatedAt: 1
    }
    await seed('dsh', [p1])
    await writeLive('dsh', 'DUP-CONTENT')

    await enablePrompt('dsh', 'p1', ctx)

    const list = listPrompts('dsh', ctx)
    expect(list).toHaveLength(1)
    expect(await readLive('dsh')).toBe('DUP-CONTENT')
  })

  it('live 文件为空字符串 -> 不做回填也不建备份', async () => {
    const p1: PromptItem = {
      id: 'p1', name: 'A', content: 'A-content', enabled: true, updatedAt: 10
    }
    const p2: PromptItem = {
      id: 'p2', name: 'B', content: 'B-content', enabled: false, updatedAt: 20
    }
    await seed('dsh', [p1, p2])
    await writeLive('dsh', '')

    await enablePrompt('dsh', 'p2', ctx)

    const list = listPrompts('dsh', ctx)
    expect(list).toHaveLength(2)
    expect(list.find((i) => i.id === 'p1')!.content).toBe('A-content')
    expect(await readLive('dsh')).toBe('B-content')
  })

  it('目标条目不存在 -> 抛错且指令文件不被改写', async () => {
    await seed('dsh', [])
    await writeLive('dsh', 'KEEP')

    await expect(enablePrompt('dsh', 'nope', ctx)).rejects.toThrow()

    expect(await readLive('dsh')).toBe('KEEP')
  })
})

describe('disablePrompt', () => {
  it('停用最后一条 -> 指令文件清空（写空字符串）', async () => {
    const p1: PromptItem = {
      id: 'p1', name: 'A', content: 'A-content', enabled: true, updatedAt: 10
    }
    await seed('dsh', [p1])
    await writeLive('dsh', 'A-content')

    await disablePrompt('dsh', ctx)

    const list = listPrompts('dsh', ctx)
    expect(list[0].enabled).toBe(false)
    expect(await readLive('dsh')).toBe('')
  })

  it('停用后仍有其他激活（防御，理论不可达）-> 指令文件不动', async () => {
    const p1: PromptItem = {
      id: 'p1', name: 'A', content: 'A-content', enabled: true, updatedAt: 10
    }
    const p2: PromptItem = {
      id: 'p2', name: 'B', content: 'B-content', enabled: true, updatedAt: 20
    }
    await seed('dsh', [p1, p2])
    await writeLive('dsh', 'LIVE')

    await disablePrompt('dsh', ctx)

    const list = listPrompts('dsh', ctx)
    expect(list.filter((i) => i.enabled)).toHaveLength(1)
    expect(await readLive('dsh')).toBe('LIVE')
  })

  it('指令文件不存在时停用为空库：不创建文件（静默 no-op）', async () => {
    await seed('dsh', [])

    await disablePrompt('dsh', ctx)

    await expect(readLive('dsh')).rejects.toThrow()
  })
})

describe('deletePrompt', () => {
  it('删除已启用条目抛错「无法删除已启用的提示词，请先停用」', async () => {
    const p1: PromptItem = {
      id: 'p1', name: 'A', content: 'A-content', enabled: true, updatedAt: 10
    }
    await seed('dsh', [p1])

    await expect(deletePrompt('dsh', 'p1', ctx)).rejects.toThrow(
      '无法删除已启用的提示词，请先停用'
    )

    expect(listPrompts('dsh', ctx)).toHaveLength(1)
  })

  it('未激活条目可删除', async () => {
    const p1: PromptItem = {
      id: 'p1', name: 'A', content: 'A-content', enabled: true, updatedAt: 10
    }
    const p2: PromptItem = {
      id: 'p2', name: 'B', content: 'B-content', enabled: false, updatedAt: 20
    }
    await seed('dsh', [p1, p2])

    const list = await deletePrompt('dsh', 'p2', ctx)

    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('p1')
  })
})

describe('写前备份（backupBeforeWrite）', () => {
  it('开启时：写指令文件前把原内容备份到 <backupDir>', async () => {
    const p1: PromptItem = {
      id: 'p1', name: 'A', content: 'B-content', enabled: false, updatedAt: 10
    }
    await seed('dsh', [p1])
    await writeLive('dsh', 'OLD-CONTENT')

    await enablePrompt('dsh', 'p1', ctx)

    expect(await readLive('dsh')).toBe('B-content')
    const files = await backupFiles(backupDir)
    expect(files.length).toBeGreaterThan(0)
    const bakContent = await fs.readFile(path.join(backupDir, files[0]), 'utf8')
    expect(bakContent).toBe('OLD-CONTENT')
  })

  it('关闭时：备份改指 <backupDir>/.disabled（父目录不产生 .bak）', async () => {
    await saveSettingsWith({
      dirOverrides: overrides,
      syncMethod: 'auto',
      backupBeforeWrite: false,
      skillUninstallBackup: true
    })
    const p1: PromptItem = {
      id: 'p1', name: 'A', content: 'B-content', enabled: false, updatedAt: 10
    }
    await seed('dsh', [p1])
    await writeLive('dsh', 'OLD-CONTENT')

    await enablePrompt('dsh', 'p1', ctx)

    expect(await readLive('dsh')).toBe('B-content')
    expect(await backupFiles(backupDir)).toEqual([])
    const disabledDir = path.join(backupDir, '.disabled')
    const files = await backupFiles(disabledDir)
    expect(files.length).toBeGreaterThan(0)
    const bakContent = await fs.readFile(path.join(disabledDir, files[0]), 'utf8')
    expect(bakContent).toBe('OLD-CONTENT')
  })
})

describe('copyPrompt（复制到其他 harness）', () => {
  it('复制到多个目标：各目标库新增条目（enabled:false、id 唯一、updatedAt 更新），源条目与源库不变', async () => {
    const src: PromptItem = {
      id: 'p1', name: '通用提示词', desc: 'd', content: 'SRC-CONTENT', enabled: true, updatedAt: 1
    }
    const existing: PromptItem = {
      id: 'c1', name: '已有', content: 'C', enabled: false, updatedAt: 2
    }
    const prompts = emptyPrompts()
    prompts.dsh = [src]
    prompts.claude = [existing]
    await saveStore(dataPath, { version: 1, mcpItems: [], skills: [], prompts, skillRepos: [] })
    const before = Date.now()

    const res = await copyPrompt('dsh', 'p1', ['claude', 'codex'], ctx)

    expect(res.copiedTo).toEqual(['claude', 'codex'])
    const claude = listPrompts('claude', ctx)
    expect(claude).toHaveLength(2)
    const copyC = claude.find((i) => i.id !== 'c1')!
    expect(copyC.name).toBe('通用提示词')
    expect(copyC.desc).toBe('d')
    expect(copyC.content).toBe('SRC-CONTENT')
    expect(copyC.enabled).toBe(false)
    expect(copyC.id).toMatch(/^[0-9a-f]{8}$/)
    expect(copyC.id).not.toBe('p1')
    expect(copyC.updatedAt).toBeGreaterThanOrEqual(before)
    const codex = listPrompts('codex', ctx)
    expect(codex).toHaveLength(1)
    expect(codex[0].enabled).toBe(false)
    expect(codex[0].content).toBe('SRC-CONTENT')
    expect(codex[0].id).not.toBe(copyC.id)
    // 源库条目原样保留
    expect(listPrompts('dsh', ctx)).toEqual([src])
  })

  it('同名自动加序号：目标库已有同名 -> 复制为「名称 (2)」；再复制 -> 「名称 (3)」', async () => {
    const src: PromptItem = {
      id: 'p1', name: 'A', content: 'SRC', enabled: false, updatedAt: 1
    }
    const existingA: PromptItem = {
      id: 'a1', name: 'A', content: 'OLD', enabled: false, updatedAt: 2
    }
    const prompts = emptyPrompts()
    prompts.dsh = [src]
    prompts.claude = [existingA]
    await saveStore(dataPath, { version: 1, mcpItems: [], skills: [], prompts, skillRepos: [] })

    await copyPrompt('dsh', 'p1', ['claude'], ctx)
    expect(listPrompts('claude', ctx).map((i) => i.name)).toEqual(['A', 'A (2)'])

    await copyPrompt('dsh', 'p1', ['claude'], ctx)
    expect(listPrompts('claude', ctx).map((i) => i.name)).toEqual(['A', 'A (2)', 'A (3)'])
  })

  it('目标库激活条目不受影响：激活状态与指令文件均不变', async () => {
    const src: PromptItem = {
      id: 'p1', name: 'P', content: 'SRC', enabled: false, updatedAt: 1
    }
    const active: PromptItem = {
      id: 'act', name: '活跃', content: 'LIVE-ACTIVE', enabled: true, updatedAt: 3
    }
    const prompts = emptyPrompts()
    prompts.dsh = [src]
    prompts.claude = [active]
    await saveStore(dataPath, { version: 1, mcpItems: [], skills: [], prompts, skillRepos: [] })
    await writeLive('claude', 'LIVE-ACTIVE')

    await copyPrompt('dsh', 'p1', ['claude'], ctx)

    const claude = listPrompts('claude', ctx)
    expect(claude).toHaveLength(2)
    expect(claude.find((i) => i.id === 'act')!.enabled).toBe(true)
    expect(claude.find((i) => i.id === 'act')!.content).toBe('LIVE-ACTIVE')
    expect(claude.filter((i) => i.enabled)).toHaveLength(1)
    expect(await readLive('claude')).toBe('LIVE-ACTIVE')
  })

  it('目标=源自身 -> 跳过且源库不变', async () => {
    const src: PromptItem = {
      id: 'p1', name: 'A', content: 'SRC', enabled: false, updatedAt: 1
    }
    await seed('dsh', [src])

    const res = await copyPrompt('dsh', 'p1', ['dsh'], ctx)

    expect(res.copiedTo).toEqual([])
    expect(listPrompts('dsh', ctx)).toEqual([src])
  })

  it('空 targets -> 返回空 copiedTo 且库不变', async () => {
    const src: PromptItem = {
      id: 'p1', name: 'A', content: 'SRC', enabled: false, updatedAt: 1
    }
    await seed('dsh', [src])

    const res = await copyPrompt('dsh', 'p1', [], ctx)

    expect(res.copiedTo).toEqual([])
    expect(listPrompts('dsh', ctx)).toEqual([src])
  })

  it('源 id 不存在 -> 抛错「提示词不存在」且目标库不变', async () => {
    await seed('dsh', [])

    await expect(copyPrompt('dsh', 'nope', ['claude'], ctx)).rejects.toThrow('提示词不存在：nope')

    expect(listPrompts('claude', ctx)).toEqual([])
  })

  it('异常目标 agent（非已知 harness）-> 跳过，不影响其他合法目标', async () => {
    const src: PromptItem = {
      id: 'p1', name: 'A', content: 'SRC', enabled: false, updatedAt: 1
    }
    await seed('dsh', [src])

    const res = await copyPrompt('dsh', 'p1', ['claude', 'garbage' as AgentId], ctx)

    expect(res.copiedTo).toEqual(['claude'])
    expect(listPrompts('claude', ctx)).toHaveLength(1)
  })
})