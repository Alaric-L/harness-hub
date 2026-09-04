// tests/data-io.test.ts —— G4 导入导出核心逻辑（组装 / 校验 / 导入前快照 / 覆盖写回）
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  applyImport,
  buildExportPayload,
  snapshotBeforeImport,
  validateBackup,
  type ExportPayload
} from '../src/main/data-io'
import { loadSettings, loadStore } from '../src/main/store'

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'data-io-'))
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

function sampleData() {
  return {
    version: 1,
    mcpItems: [
      { id: 'm1', name: 'tavily', desc: 'web', spec: { type: 'http', url: 'https://x' }, apps: { dsh: true } }
    ],
    skills: [],
    prompts: { dsh: [], claude: [], codex: [], gemini: [], grok: [], opencode: [], hermes: [] },
    skillRepos: []
  } as const
}

function sampleSettings() {
  return {
    dirOverrides: {},
    syncMethod: 'auto' as const,
    backupBeforeWrite: true,
    skillUninstallBackup: true
  }
}

describe('buildExportPayload', () => {
  it('version=1、exportedAt 可注入、data/settings 原样保留', () => {
    const now = new Date('2025-01-01T00:00:00.000Z')
    const payload = buildExportPayload(sampleData(), sampleSettings(), now)

    expect(payload.version).toBe(1)
    expect(payload.exportedAt).toBe('2025-01-01T00:00:00.000Z')
    expect(payload.data).toEqual(sampleData())
    expect(payload.settings).toEqual(sampleSettings())
  })
})

describe('validateBackup', () => {
  it('合法备份：还原 data/settings', () => {
    const payload = validateBackup(
      JSON.stringify({
        version: 1,
        exportedAt: '2025-01-01T00:00:00.000Z',
        data: sampleData(),
        settings: sampleSettings()
      })
    )

    expect(payload.version).toBe(1)
    expect(payload.exportedAt).toBe('2025-01-01T00:00:00.000Z')
    expect(payload.data).toEqual(sampleData())
    expect(payload.settings).toEqual(sampleSettings())
  })

  it('非 JSON 文本抛错', () => {
    expect(() => validateBackup('{ not json')).toThrow(/不是合法 JSON/)
  })

  it('version 非 1 抛错', () => {
    expect(() =>
      validateBackup(JSON.stringify({ version: 3, data: {}, settings: {} }))
    ).toThrow(/版本不支持/)
  })

  it('缺 data / 缺 settings / 根非对象均抛错', () => {
    expect(() => validateBackup(JSON.stringify({ version: 1, settings: {} }))).toThrow(/缺.*data/)
    expect(() => validateBackup(JSON.stringify({ version: 1, data: {} }))).toThrow(/缺.*settings/)
    expect(() => validateBackup('[1,2,3]')).toThrow(/格式错误/)
  })

  it('exportedAt 缺失时回填当前时间', () => {
    const payload = validateBackup(JSON.stringify({ version: 1, data: {}, settings: {} }))
    expect(typeof payload.exportedAt).toBe('string')
  })
})

describe('snapshotBeforeImport', () => {
  it('同时备份 data 与 settings：文件名 <name>-<ts>.preimport.bak、内容一致、返回路径列表', async () => {
    const dataF = path.join(tmp, 'data.json')
    const setF = path.join(tmp, 'settings.json')
    const backupDir = path.join(tmp, 'backups')
    await fs.writeFile(dataF, '{"data":1}', 'utf8')
    await fs.writeFile(setF, '{"settings":1}', 'utf8')
    // 本地时间 2025-01-01 00:00:00（快照时间戳为本地时间，构造本地时间避免时区偏差）
    const now = new Date(2025, 0, 1, 0, 0, 0)

    const made = await snapshotBeforeImport(dataF, setF, backupDir, now)

    expect(made).toHaveLength(2)
    const names = made.map((p) => path.basename(p)).sort()
    expect(names[0]).toBe('data-20250101-000000.preimport.bak')
    expect(names[1]).toBe('settings-20250101-000000.preimport.bak')
    const dataSnap = made.find((p) => path.basename(p).startsWith('data-'))!
    const setSnap = made.find((p) => path.basename(p).startsWith('settings-'))!
    expect(await fs.readFile(dataSnap, 'utf8')).toBe('{"data":1}')
    expect(await fs.readFile(setSnap, 'utf8')).toBe('{"settings":1}')
  })

  it('源文件不存在时跳过该项，不生成空快照', async () => {
    const missing = path.join(tmp, 'no-such.json')
    const backupDir = path.join(tmp, 'backups')

    const made = await snapshotBeforeImport(missing, missing, backupDir)

    expect(made).toEqual([])
    await expect(fs.access(backupDir)).rejects.toThrow()
  })
})

describe('applyImport', () => {
  it('覆盖写回 data.json / settings.json（读回一致）', async () => {
    const dataF = path.join(tmp, 'data.json')
    const setF = path.join(tmp, 'settings.json')
    await fs.writeFile(dataF, '{"old":true}', 'utf8')
    await fs.writeFile(setF, '{"old":true}', 'utf8')
    const payload: ExportPayload = {
      version: 1,
      exportedAt: '2025-01-01T00:00:00.000Z',
      data: sampleData(),
      settings: { ...sampleSettings(), backupBeforeWrite: false }
    }

    await applyImport(payload, dataF, setF)

    expect(loadStore(dataF)).toEqual(sampleData())
    expect(loadSettings(setF)).toEqual({ ...sampleSettings(), backupBeforeWrite: false })
  })
})

describe('导入全流程（与 ipc 相同顺序：校验 -> 快照 -> 覆盖）', () => {
  it('合法备份：先出快照再覆盖，两文件均被替换且快照内容为覆盖前原值', async () => {
    const dataF = path.join(tmp, 'data.json')
    const setF = path.join(tmp, 'settings.json')
    const backupDir = path.join(tmp, 'backups')
    await fs.writeFile(dataF, JSON.stringify({ version: 1, mcpItems: [], skills: [], prompts: {}, skillRepos: [] }))
    await fs.writeFile(setF, JSON.stringify(sampleSettings()))

    const payload = validateBackup(
      JSON.stringify({ version: 1, data: sampleData(), settings: { ...sampleSettings(), backupBeforeWrite: false } })
    )
    const made = await snapshotBeforeImport(dataF, setF, backupDir)
    await applyImport(payload, dataF, setF)

    expect(made).toHaveLength(2)
    expect(loadStore(dataF)).toEqual(sampleData())
    expect(loadSettings(setF).backupBeforeWrite).toBe(false)
    // 快照保留覆盖前的原值
    const dataSnap = made.find((p) => path.basename(p).startsWith('data-'))!
    expect(await fs.readFile(dataSnap, 'utf8')).toBe(JSON.stringify({ version: 1, mcpItems: [], skills: [], prompts: {}, skillRepos: [] }))
  })

  it('校验失败时不产生快照、不覆盖现有数据', async () => {
    const dataF = path.join(tmp, 'data.json')
    const setF = path.join(tmp, 'settings.json')
    const backupDir = path.join(tmp, 'backups')
    await fs.writeFile(dataF, '{"keep":"data"}', 'utf8')
    await fs.writeFile(setF, '{"keep":"settings"}', 'utf8')
    const originalData = await fs.readFile(dataF, 'utf8')
    const originalSet = await fs.readFile(setF, 'utf8')

    expect(() => validateBackup('{ bad json')).toThrow(/不是合法 JSON/)

    // 校验失败路径：不生成快照、原文件不动
    await expect(fs.access(backupDir)).rejects.toThrow()
    expect(await fs.readFile(dataF, 'utf8')).toBe(originalData)
    expect(await fs.readFile(setF, 'utf8')).toBe(originalSet)
  })
})
