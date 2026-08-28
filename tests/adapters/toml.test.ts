// tests/adapters/toml.test.ts —— D2: codex/grok 的 TOML 形态 MCP 增删读（文本级块操作，保留注释）
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  readTomlMcp,
  writeTomlMcpEntry,
  removeTomlMcpEntry
} from '../../src/main/adapters/toml'

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tomlmcp-'))
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

/** 预置含注释与其他表的典型 codex config.toml */
const FIXTURE_TOML = [
  '# top-level comment',
  'model = "gpt-5"',
  '',
  '[mcp_servers.existing]',
  '# server comment',
  'type = "stdio"',
  'command = "npx"',
  'args = ["-y", "filesystem"]',
  '',
  '[other.section]',
  '# other section comment',
  'enabled = true',
  ''
].join('\n')

async function writeFixture(file: string): Promise<void> {
  await fs.writeFile(file, FIXTURE_TOML, 'utf8')
}

describe('codex 写入格式（type 显式 + http_headers 子表）', () => {
  it('写入 stdio spec：生成 [mcp_servers.<id>] 块，含 type/command/args/env 子表', async () => {
    const file = path.join(tmp, 'config.toml')
    await writeTomlMcpEntry(file, 'filesystem', stdioSpec, 'codex', path.join(tmp, 'backups'))

    const raw = await fs.readFile(file, 'utf8')
    expect(raw).toContain('[mcp_servers.filesystem]')
    expect(raw).toContain('type = "stdio"')
    expect(raw).toContain('command = "npx"')
    expect(raw).toContain('args = ["-y", "filesystem"]')
    expect(raw).toContain('[mcp_servers.filesystem.env]')
    expect(raw).toContain('FOO = "bar"')
    expect(await readTomlMcp(file, 'codex')).toEqual({ filesystem: stdioSpec })
  })

  it('写入 http spec：url + http_headers 子表（headers 映射）', async () => {
    const file = path.join(tmp, 'config.toml')
    await writeTomlMcpEntry(file, 'remote', httpSpec, 'codex', path.join(tmp, 'backups'))

    const raw = await fs.readFile(file, 'utf8')
    expect(raw).toContain('type = "http"')
    expect(raw).toContain('url = "https://example.com/mcp"')
    expect(raw).toContain('[mcp_servers.remote.http_headers]')
    expect(raw).toContain('Authorization = "Bearer token"')
    expect(await readTomlMcp(file, 'codex')).toEqual({ remote: httpSpec })
  })
})

describe('grok 写入格式（不写 type，headers 键）', () => {
  it('写入 stdio spec：无 type 行、有 command/args', async () => {
    const file = path.join(tmp, 'config.toml')
    await writeTomlMcpEntry(file, 'g1', stdioSpec, 'grok', path.join(tmp, 'backups'))

    const raw = await fs.readFile(file, 'utf8')
    expect(raw).not.toContain('type =')
    expect(raw).toContain('[mcp_servers.g1]')
    expect(raw).toContain('command = "npx"')
    expect(await readTomlMcp(file, 'grok')).toEqual({ g1: stdioSpec })
  })

  it('写入 http spec：headers 子表而非 http_headers', async () => {
    const file = path.join(tmp, 'config.toml')
    await writeTomlMcpEntry(file, 'g2', httpSpec, 'grok', path.join(tmp, 'backups'))

    const raw = await fs.readFile(file, 'utf8')
    expect(raw).not.toContain('http_headers')
    expect(raw).toContain('[mcp_servers.g2.headers]')
    expect(await readTomlMcp(file, 'grok')).toEqual({ g2: httpSpec })
  })
})

describe('增/删/替换：注释与其他表逐字节保留、只动目标块', () => {
  it('在既有文件追加新块：注释与其他表原样保留', async () => {
    const file = path.join(tmp, 'config.toml')
    await writeFixture(file)

    await writeTomlMcpEntry(
      file,
      'new-mcp',
      { type: 'stdio', command: 'echo' },
      'codex',
      path.join(tmp, 'backups')
    )

    const raw = await fs.readFile(file, 'utf8')
    expect(raw).toContain('# top-level comment')
    expect(raw).toContain('model = "gpt-5"')
    expect(raw).toContain('[other.section]\n# other section comment\nenabled = true')
    expect(raw).toContain('[mcp_servers.existing]')
    expect(raw).toContain('[mcp_servers.new-mcp]')
    expect(await readTomlMcp(file, 'codex')).toEqual({
      existing: { type: 'stdio', command: 'npx', args: ['-y', 'filesystem'] },
      'new-mcp': { type: 'stdio', command: 'echo' }
    })
  })

  it('替换已有块：旧块内容消失、注释与其他表保留', async () => {
    const file = path.join(tmp, 'config.toml')
    await writeFixture(file)

    await writeTomlMcpEntry(
      file,
      'existing',
      { type: 'http', url: 'https://new.example.com/mcp' },
      'codex',
      path.join(tmp, 'backups')
    )

    const raw = await fs.readFile(file, 'utf8')
    expect(raw).not.toContain('command = "npx"')
    expect(raw).not.toContain('args = ["-y", "filesystem"]')
    expect(raw).toContain('url = "https://new.example.com/mcp"')
    expect(raw).toContain('# top-level comment')
    expect(raw).toContain('[other.section]\n# other section comment\nenabled = true')
  })

  it('替换已有块后读回仅剩该条目（上一条目规范化断言）', async () => {
    const file = path.join(tmp, 'config.toml')
    await writeFixture(file)

    await writeTomlMcpEntry(
      file,
      'existing',
      { type: 'http', url: 'https://new.example.com/mcp' },
      'codex',
      path.join(tmp, 'backups')
    )

    expect(await readTomlMcp(file, 'codex')).toEqual({
      existing: { type: 'http', url: 'https://new.example.com/mcp' }
    })
  })

  it('删除块：注释与其他表保留、目标块连同其内部注释删除', async () => {
    const file = path.join(tmp, 'config.toml')
    await writeFixture(file)

    await removeTomlMcpEntry(file, 'existing', path.join(tmp, 'backups'))

    const raw = await fs.readFile(file, 'utf8')
    expect(raw).not.toContain('[mcp_servers.existing]')
    expect(raw).not.toContain('command = "npx"')
    expect(raw).toContain('# top-level comment')
    expect(raw).toContain('model = "gpt-5"')
    expect(raw).toContain('[other.section]\n# other section comment\nenabled = true')
    expect(await readTomlMcp(file, 'codex')).toEqual({})
  })

  it('删除文件尾的块：结果精确匹配且无 .tmp 残留', async () => {
    const file = path.join(tmp, 'config.toml')
    await fs.writeFile(file, '# c\n[mcp_servers.a]\nx = 1\n', 'utf8')

    await removeTomlMcpEntry(file, 'a', path.join(tmp, 'backups'))

    expect(await fs.readFile(file, 'utf8')).toBe('# c\n')
    await expect(fs.access(file + '.tmp')).rejects.toThrow()
  })

  it('更新已有文件时先备份：backupDir 内 .bak 为原始内容', async () => {
    const file = path.join(tmp, 'config.toml')
    await writeFixture(file)
    const backupDir = path.join(tmp, 'backups')

    await writeTomlMcpEntry(file, 'existing', httpSpec, 'codex', backupDir)

    const files = await fs.readdir(backupDir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^config\.toml\.\d{8}-\d{6}\.bak$/)
    expect(await fs.readFile(path.join(backupDir, files[0]), 'utf8')).toBe(
      FIXTURE_TOML
    )
  })
})

describe('读取：统一 McpSpec 往返', () => {
  it('codex 读法：显式 type（含 sse）、http_headers 优先于 headers', async () => {
    const file = path.join(tmp, 'config.toml')
    await fs.writeFile(
      file,
      [
        '[mcp_servers.local]',
        'type = "stdio"',
        'command = "npx"',
        'args = ["-y", "fs"]',
        '',
        '[mcp_servers.remote]',
        'type = "sse"',
        'url = "https://example.com/sse"',
        'http_headers = { Authorization = "Bearer x", "X-Custom" = "y" }',
        '',
        '[mcp_servers.both]',
        'type = "http"',
        'url = "https://u"',
        'http_headers = { Authorization = "from-http-headers" }',
        'headers = { Authorization = "from-headers" }',
        ''
      ].join('\n'),
      'utf8'
    )

    expect(await readTomlMcp(file, 'codex')).toEqual({
      local: { type: 'stdio', command: 'npx', args: ['-y', 'fs'] },
      remote: { type: 'sse', url: 'https://example.com/sse', headers: { Authorization: 'Bearer x', 'X-Custom': 'y' } },
      both: { type: 'http', url: 'https://u', headers: { Authorization: 'from-http-headers' } }
    })
  })

  it('grok 读法：无 type 时按 url 推断（url->http 否则 stdio）、http_headers 归一为 headers', async () => {
    const file = path.join(tmp, 'config.toml')
    await fs.writeFile(
      file,
      [
        '[mcp_servers.local]',
        'command = "grok-run"',
        '',
        '[mcp_servers.remote]',
        'url = "https://example.com/mcp"',
        'http_headers = { Authorization = "Bearer t" }',
        ''
      ].join('\n'),
      'utf8'
    )

    expect(await readTomlMcp(file, 'grok')).toEqual({
      local: { type: 'stdio', command: 'grok-run' },
      remote: { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer t' } }
    })
  })

  it('容错读取历史错误格式 [mcp.servers]（与 [mcp_servers] 合并）', async () => {
    const file = path.join(tmp, 'config.toml')
    await fs.writeFile(
      file,
      ['[mcp.servers.old1]', 'command = "legacy"', '', '[mcp_servers.new1]', 'command = "modern"', ''].join('\n'),
      'utf8'
    )

    expect(await readTomlMcp(file, 'codex')).toEqual({
      old1: { type: 'stdio', command: 'legacy' },
      new1: { type: 'stdio', command: 'modern' }
    })
  })

  it('读取不存在文件返回 {}；坏 TOML 抛错（消息含文件名）', async () => {
    const missing = path.join(tmp, 'no', 'such.toml')
    expect(await readTomlMcp(missing, 'codex')).toEqual({})

    const bad = path.join(tmp, 'broken.toml')
    await fs.writeFile(bad, 'this is [ not valid toml', 'utf8')
    await expect(readTomlMcp(bad, 'codex')).rejects.toThrow(/broken\.toml/)
  })
})

describe('块边界', () => {
  it('表后紧跟其他表：删除前一表不波及后一表', async () => {
    const file = path.join(tmp, 'config.toml')
    await fs.writeFile(
      file,
      [
        '[mcp_servers.a]',
        'command = "a"',
        '[mcp_servers.b]',
        'command = "b"',
        ''
      ].join('\n'),
      'utf8'
    )

    await removeTomlMcpEntry(file, 'a', path.join(tmp, 'backups'))

    expect(await readTomlMcp(file, 'codex')).toEqual({
      b: { type: 'stdio', command: 'b' }
    })
    expect(await fs.readFile(file, 'utf8')).toContain('[mcp_servers.b]\ncommand = "b"')
  })

  it('嵌套表头 [mcp_servers.id.env] 属于父块：删除连同子表一起清除、写入连同子表一起生成', async () => {
    const file = path.join(tmp, 'config.toml')
    await fs.writeFile(
      file,
      [
        '# keep me',
        '[mcp_servers.a]',
        'type = "stdio"',
        'command = "a"',
        '[mcp_servers.a.env]',
        'FOO = "bar"',
        '[mcp_servers.b]',
        'command = "b"',
        ''
      ].join('\n'),
      'utf8'
    )

    await removeTomlMcpEntry(file, 'a', path.join(tmp, 'backups'))

    const raw = await fs.readFile(file, 'utf8')
    expect(raw).toContain('# keep me')
    expect(raw).not.toContain('[mcp_servers.a]')
    expect(raw).not.toContain('[mcp_servers.a.env]')
    expect(raw).not.toContain('FOO = "bar"')
    expect(await readTomlMcp(file, 'codex')).toEqual({ b: { type: 'stdio', command: 'b' } })

    // 再写入 a：带 env 子表
    await writeTomlMcpEntry(file, 'a', stdioSpec, 'codex', path.join(tmp, 'backups'))
    expect(await readTomlMcp(file, 'codex')).toEqual({
      b: { type: 'stdio', command: 'b' },
      a: stdioSpec
    })
  })

  it('写入时清理 [mcp.servers] 错误格式同名块', async () => {
    const file = path.join(tmp, 'config.toml')
    await fs.writeFile(
      file,
      [
        '[mcp.servers.foo]',
        'command = "old"',
        '',
        '[other.table]',
        'k = 1',
        ''
      ].join('\n'),
      'utf8'
    )

    await writeTomlMcpEntry(
      file,
      'foo',
      { type: 'stdio', command: 'new' },
      'codex',
      path.join(tmp, 'backups')
    )

    const raw = await fs.readFile(file, 'utf8')
    expect(raw).not.toContain('[mcp.servers.foo]')
    expect(raw).toContain('[mcp_servers.foo]')
    expect(raw).toContain('command = "new"')
    expect(raw).toContain('[other.table]\nk = 1')
    expect(await readTomlMcp(file, 'codex')).toEqual({
      foo: { type: 'stdio', command: 'new' }
    })
  })

  it('删除时同时清理 [mcp_servers] 与 [mcp.servers] 同名块', async () => {
    const file = path.join(tmp, 'config.toml')
    await fs.writeFile(
      file,
      [
        '[mcp.servers.dup]',
        'command = "legacy-dup"',
        '[mcp_servers.dup]',
        'command = "dup"',
        '[mcp_servers.keep]',
        'command = "keep"',
        ''
      ].join('\n'),
      'utf8'
    )

    await removeTomlMcpEntry(file, 'dup', path.join(tmp, 'backups'))

    const raw = await fs.readFile(file, 'utf8')
    expect(raw).not.toContain('dup')
    expect(await readTomlMcp(file, 'codex')).toEqual({ keep: { type: 'stdio', command: 'keep' } })
  })

  it('前缀相似 id（x vs xy）互不干扰', async () => {
    const file = path.join(tmp, 'config.toml')
    await fs.writeFile(
      file,
      ['[mcp_servers.xy]', 'command = "xy"', '[mcp_servers.x]', 'command = "x"', ''].join('\n'),
      'utf8'
    )

    await removeTomlMcpEntry(file, 'x', path.join(tmp, 'backups'))

    expect(await readTomlMcp(file, 'codex')).toEqual({ xy: { type: 'stdio', command: 'xy' } })
  })
})

describe('inline 形态 mcp_servers（读取正常、写入/删除抛错，宁可不改不破坏）', () => {
  const INLINE_TOML = 'mcp_servers = { inline = { type = "stdio", command = "echo" } }\n'

  it('读取返回条目', async () => {
    const file = path.join(tmp, 'config.toml')
    await fs.writeFile(file, INLINE_TOML, 'utf8')

    expect(await readTomlMcp(file, 'codex')).toEqual({
      inline: { type: 'stdio', command: 'echo' }
    })
  })

  it('写入抛错且原文件逐字节不变', async () => {
    const file = path.join(tmp, 'config.toml')
    await fs.writeFile(file, INLINE_TOML, 'utf8')

    await expect(
      writeTomlMcpEntry(file, 'x', stdioSpec, 'codex', path.join(tmp, 'backups'))
    ).rejects.toThrow(/refusing to modify/)

    expect(await fs.readFile(file, 'utf8')).toBe(INLINE_TOML)
    await expect(fs.access(file + '.tmp')).rejects.toThrow()
  })

  it('删除抛错且原文件逐字节不变', async () => {
    const file = path.join(tmp, 'config.toml')
    await fs.writeFile(file, INLINE_TOML, 'utf8')

    await expect(removeTomlMcpEntry(file, 'inline', path.join(tmp, 'backups'))).rejects.toThrow(
      /refusing to modify/
    )

    expect(await fs.readFile(file, 'utf8')).toBe(INLINE_TOML)
  })
})

describe('文件不存在与坏文件', () => {
  it('写入不存在路径自动创建文件（含嵌套目录），读取回统一 spec', async () => {
    const file = path.join(tmp, 'nested', 'deep', 'config.toml')

    expect(await readTomlMcp(file, 'grok')).toEqual({})

    await writeTomlMcpEntry(file, 'g1', httpSpec, 'grok', path.join(tmp, 'backups'))
    expect(await readTomlMcp(file, 'grok')).toEqual({ g1: httpSpec })
    await expect(fs.access(file + '.tmp')).rejects.toThrow()
  })

  it('删除不存在文件为无操作（不创建文件）；删除不存在 id 不写回', async () => {
    const missing = path.join(tmp, 'nope.toml')
    await expect(
      removeTomlMcpEntry(missing, 'x', path.join(tmp, 'backups'))
    ).resolves.toBeUndefined()
    await expect(fs.access(missing)).rejects.toThrow()

    const file = path.join(tmp, 'config.toml')
    await fs.writeFile(file, '# only comment\n', 'utf8')
    await removeTomlMcpEntry(file, 'absent', path.join(tmp, 'backups'))
    expect(await fs.readFile(file, 'utf8')).toBe('# only comment\n')
  })

  it('坏 TOML 时写入/删除抛错，原文件不被覆盖且无 .tmp 残留', async () => {
    const file = path.join(tmp, 'bad.toml')
    const bad = 'this is [ not valid toml'
    await fs.writeFile(file, bad, 'utf8')

    await expect(
      writeTomlMcpEntry(file, 'x', stdioSpec, 'codex', path.join(tmp, 'backups'))
    ).rejects.toThrow(/bad\.toml/)
    await expect(removeTomlMcpEntry(file, 'x', path.join(tmp, 'backups'))).rejects.toThrow(
      /bad\.toml/
    )

    expect(await fs.readFile(file, 'utf8')).toBe(bad)
    await expect(fs.access(file + '.tmp')).rejects.toThrow()
  })
})