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
