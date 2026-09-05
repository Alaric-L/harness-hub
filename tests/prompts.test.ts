// tests/prompts.test.ts —— v2：saved 命名库 CRUD
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
  listPrompts,
  savePrompt,
  type PromptCtx
} from '../src/main/services/prompts'

const AGENT_IDS: AgentId[] = ['dsh', 'claude', 'codex', 'gemini', 'grok', 'opencode', 'zcode', 'hermes']

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

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'prompts-'))
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
