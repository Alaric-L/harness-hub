// tests/adapters/yaml.test.ts —— Hermes config.yaml 的 mcp_servers 编辑（parseDocument 保留注释）
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  readYamlMcp,
  removeYamlMcpEntry,
  upsertYamlMcpEntry,
} from '../../src/main/adapters/yaml'
import type { McpSpec } from '../../src/main/types'

const FIXTURE = `# Hermes global configuration
mode: creative

mcp_servers:
  # fetch content over stdio
  fetch:
    command: uvx
    args: [mcp-server-fetch]
    enabled: true
  # tavily search via http
  tavily:
    url: https://mcp.example.com/tavily
    headers:
      Authorization: Bearer test
    enabled: true
    timeout: 30
`

let tmp: string
let configPath: string
let backupDir: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'yaml-adapter-'))
  configPath = path.join(tmp, 'config.yaml')
  backupDir = path.join(tmp, 'backups')
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

async function writeConfig(content: string): Promise<void> {
  await fs.writeFile(configPath, content, 'utf8')
}
async function readConfig(): Promise<string> {
  return fs.readFile(configPath, 'utf8')
}
function parseConfig(text: string): { mcp_servers?: Record<string, Record<string, unknown>> } {
  return parseYaml(text) as { mcp_servers?: Record<string, Record<string, unknown>> }
}

describe('readYamlMcp', () => {
  it('有 command -> type=stdio，有 url -> type=sse，并剥离 hermes 特有字段', async () => {
    await writeConfig(FIXTURE)

    const result = await readYamlMcp(configPath)

    expect(result.fetch).toEqual({ type: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] })
    expect(result.tavily).toEqual({
      type: 'sse',
      url: 'https://mcp.example.com/tavily',
      headers: { Authorization: 'Bearer test' },
    })
    // 特有字段（enabled/timeout 等）不进入统一 spec
    expect(Object.keys(result.fetch)).toEqual(['type', 'command', 'args'])
    expect(Object.keys(result.tavily)).toEqual(['type', 'url', 'headers'])
  })

  it('文件不存在或无 mcp_servers 键时返回空对象', async () => {
    expect(await readYamlMcp(path.join(tmp, 'no-such.yaml'))).toEqual({})

    await writeConfig('some:\n  other: config\n')
    expect(await readYamlMcp(configPath)).toEqual({})
  })

  it('条目既无 command 也无 url 时抛错', async () => {
    await writeConfig('mcp_servers:\n  broken:\n    enabled: false\n')
    await expect(readYamlMcp(configPath)).rejects.toThrow(/neither 'command' nor 'url'/)
  })
})

describe('upsertYamlMcpEntry', () => {
  it('新增 stdio 条目：不写 type、恒写 enabled、空 args/env 省略', async () => {
    await writeConfig('# original header\nmode: fast\n')

    await upsertYamlMcpEntry(configPath, 'mysrv', { type: 'stdio', command: 'npx', args: [], env: {} }, backupDir)

    const text = await readConfig()
    expect(text).toContain('# original header')
    expect(parseConfig(text).mcp_servers!.mysrv).toEqual({ command: 'npx', enabled: true })
  })

  it('新增 http 条目：写 url/headers；空 headers 省略', async () => {
    await upsertYamlMcpEntry(configPath, 'web', { type: 'http', url: 'https://mcp.example.com/web' }, backupDir)
    expect(parseConfig(await readConfig()).mcp_servers!.web).toEqual({
      url: 'https://mcp.example.com/web',
      enabled: true,
    })

    await upsertYamlMcpEntry(configPath, 'web2', { type: 'http', url: 'https://x.test', headers: { 'X-Key': 'v' } }, backupDir)
    expect(parseConfig(await readConfig()).mcp_servers!.web2).toEqual({
      url: 'https://x.test',
      headers: { 'X-Key': 'v' },
      enabled: true,
    })
  })

  it('merge-on-write：已存在条目保留 timeout/sampling/auth 等特有字段，只覆盖统一键', async () => {
    await writeConfig(
      'mcp_servers:\n  my-server:\n    command: old-cmd\n    timeout: 30\n    sampling: 0.5\n    auth: oauth\n'
    )

    await upsertYamlMcpEntry(configPath, 'my-server', { type: 'stdio', command: 'npx', args: ['-y', 'pkg'] }, backupDir)

    const entry = parseConfig(await readConfig()).mcp_servers!['my-server']
    expect(entry).toEqual({
      command: 'npx',
      args: ['-y', 'pkg'],
      timeout: 30,
      sampling: 0.5,
      auth: 'oauth',
      enabled: true,
    })
    expect(entry).not.toHaveProperty('type')
  })

  it('类型切换时移除旧统一键：http->stdio 去掉 url/headers，stdio->http 去掉 command', async () => {
    await writeConfig('mcp_servers:\n  srv:\n    url: https://old.test\n    headers:\n      A: B\n    timeout: 5\n')

    await upsertYamlMcpEntry(configPath, 'srv', { type: 'stdio', command: 'npx' }, backupDir)
    expect(parseConfig(await readConfig()).mcp_servers!.srv).toEqual({
      command: 'npx',
      timeout: 5,
      enabled: true,
    })

    await upsertYamlMcpEntry(configPath, 'srv', { type: 'http', url: 'https://new.test' }, backupDir)
    expect(parseConfig(await readConfig()).mcp_servers!.srv).toEqual({
      url: 'https://new.test',
      timeout: 5,
      enabled: true,
    })
  })

  it('upsert 不影响其他条目与注释', async () => {
    await writeConfig(FIXTURE)
    const before = parseConfig(FIXTURE)

    await upsertYamlMcpEntry(configPath, 'tavily', { type: 'sse', url: 'https://new-tavily.example.com/mcp' }, backupDir)

    const text = await readConfig()
    expect(text).toContain('# fetch content over stdio')
    expect(text).toContain('mode: creative')
    const after = parseConfig(text)
    expect(after.mcp_servers!.fetch).toEqual(before.mcp_servers!.fetch)
    expect(after.mcp_servers!.tavily).toEqual({
      url: 'https://new-tavily.example.com/mcp',
      enabled: true,
      timeout: 30,
    })
  })

  it('往返：stdio 无损还原；url 条目读取为 sse（hermes 写侧不区分 http/sse）', async () => {
    const spec: McpSpec = { type: 'stdio', command: 'npx', args: ['-y', 'pkg'], env: { FOO: 'bar' } }
    await upsertYamlMcpEntry(configPath, 'rt', spec, backupDir)
    expect(await readYamlMcp(configPath)).toEqual({ rt: spec })

    await upsertYamlMcpEntry(
      configPath,
      'rt2',
      { type: 'http', url: 'https://rt.test', headers: { 'X-A': '1' } },
      backupDir
    )
    expect(await readYamlMcp(configPath)).toEqual({
      rt: spec,
      rt2: { type: 'sse', url: 'https://rt.test', headers: { 'X-A': '1' } },
    })
  })

  it('写入前执行备份：backupDir 中出现原内容备份', async () => {
    await writeConfig(FIXTURE)

    await upsertYamlMcpEntry(configPath, 'new', { type: 'stdio', command: 'cmd' }, backupDir)

    const files = await fs.readdir(backupDir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^config\.yaml\.\d{8}-\d{6}\.bak$/)
    expect(await fs.readFile(path.join(backupDir, files[0]), 'utf8')).toBe(FIXTURE)
  })
})

describe('removeYamlMcpEntry', () => {
  it('删除单个条目，保留其他条目与注释', async () => {
    await writeConfig(FIXTURE)

    await removeYamlMcpEntry(configPath, 'fetch', backupDir)

    const text = await readConfig()
    expect(text).toContain('# tavily search via http')
    const parsed = parseConfig(text)
    expect(parsed.mcp_servers!.fetch).toBeUndefined()
    expect(parsed.mcp_servers!.tavily).toEqual({
      url: 'https://mcp.example.com/tavily',
      headers: { Authorization: 'Bearer test' },
      enabled: true,
      timeout: 30,
    })
  })

  it('条目不存在时不改动文件', async () => {
    await writeConfig(FIXTURE)

    await removeYamlMcpEntry(configPath, 'no-such-id', backupDir)

    expect(await readConfig()).toBe(FIXTURE)
  })
})