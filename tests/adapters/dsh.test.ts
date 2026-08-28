// tests/adapters/dsh.test.ts —— DSH cordis.patch.yml adapter（结构与真实 ~/.dsh/profiles/web/cordis.patch.yml 一致，url/key 为假值）
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { readDshMcp, removeDshMcp, upsertDshMcp } from '../../src/main/adapters/dsh'

interface PatchInsertItem {
  id: string
  name: string
  config: Record<string, unknown>
}
interface PatchElement {
  insert?: PatchInsertItem[]
}

const FIXTURE = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).

# Tavily search MCP server, connected natively via streamable-http.
- insert:
    - id: mcp-tavily
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: tavily
        transport: streamable-http
        url: https://mcp.example.com/tavily?key=testKey

# dbx MCP server, spawned via npx over stdio.
- insert:
    - id: mcp-dbx
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: dbx
        transport: stdio
        command: npx
        args: ['-y', '@dbx-app/mcp-server@latest']

# Playwright MCP server, spawned via npx over stdio.
- insert:
    - id: mcp-playwright
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: playwright
        transport: stdio
        command: npx
        args: ['-y', '@playwright/mcp@latest']

# ─── skills section: untouched by the mcp adapters ───────────────────────────
- insert:
    - id: skill-filesystem-superpowers
      name: '@deepseek-ai/dsh-skill-filesystem'
      config:
        customSkillDirs: ['D:\\Code\\Personal\\superpowers\\skills']
`

let tmp: string
let patchPath: string
let backupDir: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-adapter-'))
  patchPath = path.join(tmp, 'cordis.patch.yml')
  backupDir = path.join(tmp, 'backups')
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

async function writePatch(content: string): Promise<void> {
  await fs.writeFile(patchPath, content, 'utf8')
}
async function readPatch(): Promise<string> {
  return fs.readFile(patchPath, 'utf8')
}
function parsePatch(text: string): PatchElement[] {
  return parseYaml(text) as PatchElement[]
}
function patchIds(text: string): string[] {
  return parsePatch(text).flatMap((el) => (el.insert ?? []).map((i) => i.id))
}

describe('readDshMcp', () => {
  it('还原 mcp-* 前缀的 dsh-mcp-client 条目为统一 spec，忽略技能等非 mcp 条目', async () => {
    await writePatch(FIXTURE)

    const result = await readDshMcp(patchPath)

    expect(result).toEqual({
      tavily: { type: 'http', url: 'https://mcp.example.com/tavily?key=testKey' },
      dbx: { type: 'stdio', command: 'npx', args: ['-y', '@dbx-app/mcp-server@latest'] },
      playwright: { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
    })
  })

  it('文件不存在返回空对象', async () => {
    expect(await readDshMcp(path.join(tmp, 'no-such.yml'))).toEqual({})
  })

  it('根不是数组（如普通映射）时返回空对象', async () => {
    await writePatch('some:\n  key: value\n')
    expect(await readDshMcp(patchPath)).toEqual({})
  })
})

describe('upsertDshMcp', () => {
  it('新增条目：注释保留、其他条目顺序与内容不变、新条目追加在末尾', async () => {
    await writePatch(FIXTURE)

    await upsertDshMcp(
      patchPath,
      'fetch',
      { type: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] },
      backupDir
    )

    const text = await readPatch()
    expect(text).toContain('# Your patch layer for this dsh profile')
    expect(text).toContain('# Playwright MCP server, spawned via npx over stdio.')
    expect(patchIds(text)).toEqual([
      'mcp-tavily',
      'mcp-dbx',
      'mcp-playwright',
      'skill-filesystem-superpowers',
      'mcp-fetch',
    ])
    // 其他条目内容不变
    const baseline = parsePatch(FIXTURE)
    const patch = parsePatch(text)
    expect(patch[1]).toEqual(baseline[1])
    expect(patch[2]).toEqual(baseline[2])
    expect(patch[3]).toEqual(baseline[3])
    // 新条目格式符合契约
    expect(patch[4].insert![0]).toEqual({
      id: 'mcp-fetch',
      name: '@deepseek-ai/dsh-mcp-client',
      config: {
        serverName: 'fetch',
        transport: 'stdio',
        command: 'uvx',
        args: ['mcp-server-fetch'],
      },
    })
  })

  it('更新已有 mcp-tavily 的 url：只改目标条目，不破坏其他条目', async () => {
    await writePatch(FIXTURE)

    await upsertDshMcp(
      patchPath,
      'tavily',
      { type: 'http', url: 'https://mcp.example.com/tavily/v2', headers: { Authorization: 'Bearer abc' } },
      backupDir
    )

    const text = await readPatch()
    expect(text).toContain('# dbx MCP server, spawned via npx over stdio.')
    expect(patchIds(text)).toEqual([
      'mcp-tavily',
      'mcp-dbx',
      'mcp-playwright',
      'skill-filesystem-superpowers',
    ])
    const patch = parsePatch(text)
    expect(patch[0].insert![0]).toEqual({
      id: 'mcp-tavily',
      name: '@deepseek-ai/dsh-mcp-client',
      config: {
        serverName: 'tavily',
        transport: 'streamable-http',
        url: 'https://mcp.example.com/tavily/v2',
        headers: { Authorization: 'Bearer abc' },
      },
    })
    const baseline = parsePatch(FIXTURE)
    expect(patch[1]).toEqual(baseline[1])
    expect(patch[2]).toEqual(baseline[2])
    expect(patch[3]).toEqual(baseline[3])
  })

  it('文件不存在时新建：目录递归创建，写入单个 insert 条目并可读回', async () => {
    const nonexistent = path.join(tmp, 'profiles', 'web', 'cordis.patch.yml')

    await upsertDshMcp(
      nonexistent,
      'dbx',
      { type: 'stdio', command: 'npx', args: ['-y', '@dbx-app/mcp-server@latest'] },
      backupDir
    )

    const patch = parsePatch(await fs.readFile(nonexistent, 'utf8'))
    expect(patch).toHaveLength(1)
    expect(patch[0].insert![0].config).toEqual({
      serverName: 'dbx',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@dbx-app/mcp-server@latest'],
    })
    expect(await readDshMcp(nonexistent)).toEqual({
      dbx: { type: 'stdio', command: 'npx', args: ['-y', '@dbx-app/mcp-server@latest'] },
    })
  })

  it('往返：写入后 readDshMcp 还原与其他条目一致', async () => {
    await writePatch(FIXTURE)
    const before = await readDshMcp(patchPath)

    await upsertDshMcp(
      patchPath,
      'fetch',
      { type: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] },
      backupDir
    )

    const after = await readDshMcp(patchPath)
    expect(after).toEqual({
      ...before,
      fetch: { type: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] },
    })
  })

  it('写入前执行备份：backupDir 中出现原文件备份', async () => {
    await writePatch(FIXTURE)

    await upsertDshMcp(patchPath, 'fetch', { type: 'stdio', command: 'uvx' }, backupDir)

    const files = await fs.readdir(backupDir)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^cordis\.patch\.yml\.\d{8}-\d{6}\.bak$/)
    expect(await fs.readFile(path.join(backupDir, files[0]), 'utf8')).toBe(FIXTURE)
  })
})

describe('removeDshMcp', () => {
  it('删除单个条目：注释与其他条目保留', async () => {
    await writePatch(FIXTURE)

    await removeDshMcp(patchPath, 'dbx', backupDir)

    const text = await readPatch()
    expect(text).not.toContain('mcp-dbx')
    expect(text).toContain('# Tavily search MCP server, connected natively via streamable-http.')
    expect(patchIds(text)).toEqual([
      'mcp-tavily',
      'mcp-playwright',
      'skill-filesystem-superpowers',
    ])
    const baseline = parsePatch(FIXTURE)
    const patch = parsePatch(text)
    expect(patch[0]).toEqual(baseline[0])
    expect(patch[1]).toEqual(baseline[2])
    expect(patch[2]).toEqual(baseline[3])
  })

  it('条目不存在时不改动文件', async () => {
    await writePatch(FIXTURE)

    await removeDshMcp(patchPath, 'no-such-id', backupDir)

    expect(await readPatch()).toBe(FIXTURE)
  })
})