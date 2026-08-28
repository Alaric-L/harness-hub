// tests/adapters/json.test.ts —— D1: claude/gemini/opencode JSON MCP adapters
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  readJsonMcp,
  writeJsonMcpEntry,
  removeJsonMcpEntry
} from '../../src/main/adapters/json'

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'jsonmcp-'))
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

const stdioSpec = {
  type: 'stdio' as const,
  command: 'npx',
  args: ['-y', 'filesystem'],
  env: { FOO: 'bar' }
}

const httpSpec = {
  type: 'http' as const,
  url: 'https://example.com/mcp',
  headers: { Authorization: 'Bearer token' }
}

/** 读取文件 raw JSON（供磁盘格式断言） */
async function readRaw(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>
}

describe('claude / gemini（mcpServers 键，spec 原样存取）', () => {
  it('写入一条 stdio spec：其他键与已有 mcpServers 条目保留、新条目正确', async () => {
    const file = path.join(tmp, 'claude.json')
    await fs.writeFile(
      file,
      JSON.stringify({
        projects: [{ name: 'p1' }],
        mcpServers: { existing: { type: 'stdio', command: 'old', args: ['-a'] } }
      }),
      'utf8'
    )
    const backupDir = path.join(tmp, 'backups')

    await writeJsonMcpEntry(file, 'new-mcp', stdioSpec, 'claude', backupDir)

    const raw = await readRaw(file)
    expect(raw['projects']).toEqual([{ name: 'p1' }])
    expect((raw as { mcpServers: Record<string, unknown> })['mcpServers']['existing']).toEqual({
      type: 'stdio',
      command: 'old',
      args: ['-a']
    })
    expect((raw as { mcpServers: Record<string, unknown> })['mcpServers']['new-mcp']).toEqual(
      stdioSpec
    )
    expect(await readJsonMcp(file, 'claude')).toEqual({
      existing: { type: 'stdio', command: 'old', args: ['-a'] },
      'new-mcp': stdioSpec
    })
  })

  it('gemini 与 claude 同样走 mcpServers 键', async () => {
    const file = path.join(tmp, 'gemini.json')
    await fs.writeFile(file, JSON.stringify({ other: 1 }), 'utf8')

    await writeJsonMcpEntry(file, 'g1', stdioSpec, 'gemini', path.join(tmp, 'backups'))
    await writeJsonMcpEntry(file, 'g2', httpSpec, 'gemini', path.join(tmp, 'backups'))

    const raw = await readRaw(file)
    expect(raw['other']).toBe(1)
    const servers = (raw as { mcpServers: Record<string, unknown> })['mcpServers']
    expect(servers['g1']).toEqual(stdioSpec)
    expect(servers['g2']).toEqual(httpSpec)
    expect(await readJsonMcp(file, 'gemini')).toEqual({ g1: stdioSpec, g2: httpSpec })
  })

  it('removeJsonMcpEntry 删除单条，其他键与其他条目保留；删不存在的 id 无影响', async () => {
    const file = path.join(tmp, 'claude.json')
    await fs.writeFile(
      file,
      JSON.stringify({
        projects: [1, 2],
        mcpServers: {
          keep: { type: 'stdio', command: 'k' },
          drop: { type: 'stdio', command: 'd' }
        }
      }),
      'utf8'
    )

    await removeJsonMcpEntry(file, 'drop', 'claude', path.join(tmp, 'backups'))
    // 再次删除已不存在的 id：无操作但仍写回（其余内容不变）
    await removeJsonMcpEntry(file, 'drop', 'claude', path.join(tmp, 'backups'))

    const raw = await readRaw(file)
    expect(raw['projects']).toEqual([1, 2])
    expect((raw as { mcpServers: Record<string, unknown> })['mcpServers']).toEqual({
      keep: { type: 'stdio', command: 'k' }
    })
  })

  it('坏 JSON 时写入抛错，且原文件不被破坏', async () => {
    const file = path.join(tmp, 'bad.json')
    await fs.writeFile(file, '{ not valid json', 'utf8')

    await expect(
      writeJsonMcpEntry(file, 'x', stdioSpec, 'claude', path.join(tmp, 'backups'))
    ).rejects.toThrow()

    expect(await fs.readFile(file, 'utf8')).toBe('{ not valid json')
    await expect(fs.access(file + '.tmp')).rejects.toThrow()
  })

  it('空文件时写入抛错，且原文件不被覆盖', async () => {
    const file = path.join(tmp, 'empty.json')
    await fs.writeFile(file, '', 'utf8')

    await expect(
      writeJsonMcpEntry(file, 'x', stdioSpec, 'claude', path.join(tmp, 'backups'))
    ).rejects.toThrow()

    expect(await fs.readFile(file, 'utf8')).toBe('')
  })

  it('readJsonMcp 解析坏 JSON 抛错（消息含文件名）', async () => {
    const file = path.join(tmp, 'broken.json')
    await fs.writeFile(file, '{{{', 'utf8')

    await expect(readJsonMcp(file, 'claude')).rejects.toThrow(/broken\.json/)
  })

  it('claude spec 往返无损（含 args/env），结果为合法 JSON 且无 .tmp 残留', async () => {
    const file = path.join(tmp, 'claude.json')
    await writeJsonMcpEntry(file, 'm1', stdioSpec, 'claude', path.join(tmp, 'backups'))

    expect(await readJsonMcp(file, 'claude')).toEqual({ m1: stdioSpec })

    const raw = await fs.readFile(file, 'utf8')
    expect(() => JSON.parse(raw)).not.toThrow()
    await expect(fs.access(file + '.tmp')).rejects.toThrow()
  })

  it('写入不存在路径自动创建文件（含嵌套目录），读取不存在文件返回 {}', async () => {
    const file = path.join(tmp, 'nested', 'deep', 'claude.json')

    expect(await readJsonMcp(file, 'claude')).toEqual({})

    await writeJsonMcpEntry(file, 'm1', stdioSpec, 'claude', path.join(tmp, 'backups'))
    expect(await readJsonMcp(file, 'claude')).toEqual({ m1: stdioSpec })
  })
})

describe('opencode（mcp 键，local/remote 双向转换）', () => {
  it('stdio spec 写入为 local：command 数组合并 + environment 映射 + enabled:true', async () => {
    const file = path.join(tmp, 'nested', 'opencode.json')
    await writeJsonMcpEntry(file, 'srv', stdioSpec, 'opencode', path.join(tmp, 'backups'))

    const raw = await readRaw(file)
    const mcp = (raw as { mcp: Record<string, unknown> })['mcp']
    expect(mcp['srv']).toEqual({
      type: 'local',
      command: ['npx', '-y', 'filesystem'],
      environment: { FOO: 'bar' },
      enabled: true
    })
  })

  it('local 读取回统一 stdio spec（command 数组拆合、environment->env）', async () => {
    const file = path.join(tmp, 'opencode.json')
    await writeJsonMcpEntry(file, 'srv', stdioSpec, 'opencode', path.join(tmp, 'backups'))

    expect(await readJsonMcp(file, 'opencode')).toEqual({ srv: stdioSpec })
  })

  it('http spec 写入为 remote：url + headers + enabled:true', async () => {
    const file = path.join(tmp, 'opencode.json')
    await writeJsonMcpEntry(file, 'http-srv', httpSpec, 'opencode', path.join(tmp, 'backups'))

    const raw = await readRaw(file)
    const mcp = (raw as { mcp: Record<string, unknown> })['mcp']
    expect(mcp['http-srv']).toEqual({
      type: 'remote',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer token' },
      enabled: true
    })
  })

  it('remote 读取回统一 sse spec（url + headers）', async () => {
    const file = path.join(tmp, 'opencode.json')
    await writeJsonMcpEntry(file, 'sse-srv', httpSpec, 'opencode', path.join(tmp, 'backups'))

    expect(await readJsonMcp(file, 'opencode')).toEqual({
      'sse-srv': { type: 'sse', url: httpSpec.url, headers: httpSpec.headers }
    })
  })

  it('空字段省略：无 env 不写 environment、无 headers 不写 headers，enabled 始终存在', async () => {
    const file = path.join(tmp, 'opencode.json')

    await writeJsonMcpEntry(
      file,
      'bare',
      { type: 'stdio', command: 'echo' },
      'opencode',
      path.join(tmp, 'backups')
    )
    await writeJsonMcpEntry(
      file,
      'bare-http',
      { type: 'http', url: 'https://example.com/mcp' },
      'opencode',
      path.join(tmp, 'backups')
    )

    const mcp = (await readRaw(file)) as { mcp: Record<string, unknown> }
    expect(mcp['mcp']['bare']).toEqual({ type: 'local', command: ['echo'], enabled: true })
    expect(mcp['mcp']['bare-http']).toEqual({ type: 'remote', url: 'https://example.com/mcp', enabled: true })
  })

  it('写多条时其他条目保留；读取不存在文件返回 {}', async () => {
    const file = path.join(tmp, 'opencode.json')

    expect(await readJsonMcp(file, 'opencode')).toEqual({})

    await writeJsonMcpEntry(file, 'a', stdioSpec, 'opencode', path.join(tmp, 'backups'))
    await writeJsonMcpEntry(file, 'b', httpSpec, 'opencode', path.join(tmp, 'backups'))

    expect(await readJsonMcp(file, 'opencode')).toEqual({
      a: stdioSpec,
      b: { type: 'sse', url: httpSpec.url, headers: httpSpec.headers }
    })
  })

  it('remove 仅删目标 id，文件合法且无 .tmp 残留', async () => {
    const file = path.join(tmp, 'opencode.json')
    await writeJsonMcpEntry(file, 'a', stdioSpec, 'opencode', path.join(tmp, 'backups'))
    await writeJsonMcpEntry(file, 'b', httpSpec, 'opencode', path.join(tmp, 'backups'))

    await removeJsonMcpEntry(file, 'a', 'opencode', path.join(tmp, 'backups'))

    const raw = await fs.readFile(file, 'utf8')
    expect(() => JSON.parse(raw)).not.toThrow()
    await expect(fs.access(file + '.tmp')).rejects.toThrow()
    expect(await readJsonMcp(file, 'opencode')).toEqual({
      b: { type: 'sse', url: httpSpec.url, headers: httpSpec.headers }
    })
  })
})