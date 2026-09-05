import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadSettings, loadStore, saveSettings, saveStore } from '../src/main/store'

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'store-'))
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

const AGENT_IDS = ['dsh', 'claude', 'codex', 'gemini', 'grok', 'opencode', 'zcode', 'hermes'] as const

/** prompts 八键空数组（与全局约束统一数据模型一致） */
function emptyPrompts(): Record<string, unknown[]> {
  const prompts: Record<string, unknown[]> = {}
  for (const id of AGENT_IDS) prompts[id] = []
  return prompts
}

function defaultData() {
  return { version: 1, mcpItems: [], skills: [], prompts: emptyPrompts(), skillRepos: [] }
}

function sampleData() {
  return {
    version: 1,
    mcpItems: [
      {
        id: 'm1',
        name: 'tavily',
        desc: 'web search',
        spec: { type: 'stdio', command: 'npx', args: ['-y', 'tavily-mcp'] },
        apps: { dsh: true }
      }
    ],
    skills: [
      { dir: 'test-skill', name: 'Test Skill', desc: 'd', repo: null, hasUpdate: false, apps: { claude: true, shared: true } }
    ],
    prompts: {
      ...emptyPrompts(),
      dsh: [
        { id: 'p1', name: 'base', content: '# hi', enabled: true, updatedAt: 123 }
      ]
    },
    skillRepos: [{ owner: 'o', name: 'r', branch: 'main' }]
  }
}

describe('loadStore', () => {
  it('文件不存在返回默认结构（version:1、空数组、prompts 七键空数组）', () => {
    const data = loadStore(path.join(tmp, 'data.json'))

    expect(data).toEqual(defaultData())
  })

  it('saveStore 后 loadStore 往返数据一致', async () => {
    const file = path.join(tmp, 'nested', 'data.json')
    const sample = sampleData()

    await saveStore(file, sample)
    const loaded = loadStore(file)

    expect(loaded).toEqual(sample)
    // spec §9：apps 含 shared 键（共享目录部署目标）往返后保留，与旧数据兼容
    expect(loaded.skills[0]?.apps).toEqual({ claude: true, shared: true })
  })

  it('坏 JSON 抛错（错误消息含文件名），且原文件不被覆盖', async () => {
    const file = path.join(tmp, 'data.json')
    await fs.writeFile(file, '{ not valid json', 'utf8')

    await expect(() => loadStore(file)).toThrowError(/data\.json/)

    // 静默覆盖防护：磁盘上坏文件原样保留
    expect(await fs.readFile(file, 'utf8')).toBe('{ not valid json')
  })
})

describe('saveStore', () => {
  it('原子性：写入的文件是合法 JSON（读回可 parse）且无 .tmp 残留', async () => {
    const file = path.join(tmp, 'data.json')
    const sample = sampleData()

    await saveStore(file, sample)

    const raw = await fs.readFile(file, 'utf8')
    expect(() => JSON.parse(raw)).not.toThrow()
    expect(JSON.parse(raw)).toEqual(sample)
    await expect(fs.access(file + '.tmp')).rejects.toThrow()
  })
})

describe('loadSettings / saveSettings', () => {
  it('loadSettings 文件不存在返回默认（无覆盖、syncMethod copy、备份均 true）', () => {
    const s = loadSettings(path.join(tmp, 'settings.json'))

    expect(s).toEqual({
      dirOverrides: {},
      syncMethod: 'copy',
      backupBeforeWrite: true,
      skillUninstallBackup: true
    })
  })

  it('loadSettings / saveSettings 往返一致', async () => {
    const file = path.join(tmp, 'settings.json')
    const custom = {
      dirOverrides: { dsh: 'D:\\x', claude: null as string | null },
      syncMethod: 'symlink' as const,
      backupBeforeWrite: false,
      skillUninstallBackup: true
    }

    await saveSettings(file, custom)
    const loaded = loadSettings(file)

    expect(loaded).toEqual(custom)
    expect(loaded.syncMethod).toBe('symlink')
    expect(loaded.backupBeforeWrite).toBe(false)
  })
})