// tests/services/mcp.test.ts —— D4: MCP service 全业务流（库 CRUD、单开关、批量、导入合并、预览）
// 用临时目录构造 8 个 harness 假家目录：settings.dirOverrides 指向 fixture，
// 各格式配置文件预置真实样例（claude json 含 projects 键、codex toml 含注释与其它表）。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { AGENTS } from '../../src/main/paths'
import { loadStore, saveSettings, saveStore } from '../../src/main/store'
import type { AgentId, AppSettings, McpItem } from '../../src/main/types'
import {
  bulkToggleMcp,
  deleteMcp,
  importMcpFromHarnesses,
  listMcp,
  previewMcp,
  saveMcp,
  toggleMcp,
  type McpCtx
} from '../../src/main/services/mcp'

const AGENT_IDS: AgentId[] = ['dsh', 'claude', 'codex', 'gemini', 'grok', 'opencode', 'zcode', 'hermes']

/** 覆盖后各 agent 的 MCP 配置文件相对路径（对齐 resolveAgentPaths 语义） */
const MCP_FILE_NAME: Record<AgentId, string> = {
  dsh: 'profiles/web/cordis.patch.yml',
  claude: '.claude.json',
  codex: 'config.toml',
  gemini: 'settings.json',
  grok: 'config.toml',
  opencode: 'opencode.json',
  zcode: 'cli/config.json',
  hermes: 'config.yaml'
}

const TAVILY: McpItem = {
  id: 'tavily',
  name: 'Tavily',
  spec: { type: 'http', url: 'https://mcp.example.com/tavily?key=testKey' },
  apps: {}
}
const DBX: McpItem = {
  id: 'dbx',
  name: 'DBX',
  spec: { type: 'stdio', command: 'npx', args: ['-y', '@dbx-app/mcp-server@latest'] },
  apps: {}
}

let tmp: string
let homesDir: string
let dataPath: string
let settingsPath: string
let backupDir: string
let overrides: Partial<Record<AgentId, string>>
let ctx: McpCtx

function pathOf(agentId: AgentId): string {
  return path.join(homesDir, agentId, MCP_FILE_NAME[agentId])
}

function emptyPrompts(): Record<AgentId, unknown[]> {
  const prompts: Record<AgentId, unknown[]> = {} as Record<AgentId, unknown[]>
  for (const id of AGENT_IDS) prompts[id] = []
  return prompts
}

async function seed(items: McpItem[]): Promise<void> {
  await saveStore(dataPath, {
    version: 1,
    mcpItems: items,
    skills: [],
    prompts: emptyPrompts() as never,
    skillRepos: []
  })
}

async function currentItems(): Promise<McpItem[]> {
  return loadStore(dataPath).mcpItems
}

/** 纯文本 DSH 解析：取 insert 中 id 匹配的条目 */
function findDshEntry(doc: unknown, id: string): { config: Record<string, unknown> } | undefined {
  const seq = doc as Array<{ insert?: Array<{ id: string; config?: Record<string, unknown> }> }>
  for (const el of seq) {
    const hit = (el.insert ?? []).find((i) => i.id === id)
    if (hit) return { config: (hit.config ?? {}) as Record<string, unknown> }
  }
  return undefined
}

/** 各格式 fixture 文件内容（真实样例：注释/其它表/非 MCP 键） */
const FIXTURES: Record<AgentId, string> = {
  dsh: `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries.

# Playwright MCP server, spawned via npx over stdio.
- insert:
    - id: mcp-playwright
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: playwright
        transport: stdio
        command: npx
        args: ['-y', '@playwright/mcp@latest']

# skill insert: untouched by the mcp adapters.
- insert:
    - id: skill-filesystem
      name: '@deepseek-ai/dsh-skill-filesystem'
      config:
        customSkillDirs: ['D:\\\\skills']
`,
  claude: `{
  "projects": {
    "D:/work": {
      "mcpServers": {}
    }
  },
  "mcpServers": {
    "playwright": {
      "type": "stdio",
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
`,
  codex: `# Codex 顶层注释
model = "gpt-5-codex"

[mcp_servers]
# 已存在的条目
[mcp_servers.brave]
type = "stdio"
command = "npx"
args = ["-y", "@brave/brave-mcp-server"]

[other.section]
enabled = true
`,
  gemini: `{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem"]
    }
  }
}
`,
  grok: `# Grok build 配置
model = "grok-4"

[mcp_servers.weather]
command = "npx"
args = ["-y", "weather-mcp"]
`,
  opencode: `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "playwright": {
      "type": "local",
      "command": ["npx", "-y", "@playwright/mcp@latest"],
      "enabled": true
    }
  }
}
`,
  zcode: `{
  "plugins": {
    "enabledPlugins": {
      "superpowers@claude-plugins-official": true
    }
  },
  "mcp": {
    "servers": {
      "memory": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-memory"],
        "env": {}
      }
    }
  }
}
`,
  hermes: `# Hermes 配置
provider: anthropic

mcp_servers:
  filesystem:
    command: npx
    args:
      - -y
      - '@modelcontextprotocol/server-filesystem'
    enabled: true
  docker:
    command: npx
    args:
      - -y
      - docker-mcp
    enabled: true
`
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-svc-'))
  homesDir = path.join(tmp, 'homes')
  dataPath = path.join(tmp, 'hub', 'data.json')
  settingsPath = path.join(tmp, 'hub', 'settings.json')
  backupDir = path.join(tmp, 'hub', 'backups')
  overrides = {}
  for (const a of AGENTS) {
    overrides[a.id] = path.join(homesDir, a.id)
    await fs.mkdir(path.join(homesDir, a.id, path.dirname(MCP_FILE_NAME[a.id])), {
      recursive: true
    })
  }
  for (const a of AGENTS) {
    await fs.writeFile(pathOf(a.id), FIXTURES[a.id], 'utf8')
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

describe('toggleMcp 开启', () => {
  it('on：逐 harness 写入对应格式文件并更新 store apps', async () => {
    await seed([TAVILY, DBX])

    await toggleMcp('tavily', 'dsh', true, ctx)
    await toggleMcp('dbx', 'claude', true, ctx)
    await toggleMcp('tavily', 'codex', true, ctx)
    await toggleMcp('dbx', 'gemini', true, ctx)
    await toggleMcp('tavily', 'grok', true, ctx)
    await toggleMcp('dbx', 'opencode', true, ctx)
    await toggleMcp('dbx', 'hermes', true, ctx)
    await toggleMcp('tavily', 'zcode', true, ctx)

    // claude json：mcpServers 含 dbx；playwright 与 projects 键保留
    const claude = JSON.parse(await fs.readFile(pathOf('claude'), 'utf8'))
    expect(claude.mcpServers.dbx).toEqual(DBX.spec)
    expect(claude.mcpServers.playwright).toBeDefined()
    expect(claude.projects).toBeDefined()

    // codex toml：[mcp_servers.tavily] 块（codex flavor 显式 type）
    const codex = await fs.readFile(pathOf('codex'), 'utf8')
    expect(codex).toContain('[mcp_servers.tavily]')
    expect(codex).toContain('type = "http"')
    expect(codex).toContain('url = "https://mcp.example.com/tavily?key=testKey"')

    // grok toml：无 type 行（grok flavor）
    const grok = await fs.readFile(pathOf('grok'), 'utf8')
    expect(grok).toContain('[mcp_servers.tavily]')
    expect(grok).not.toMatch(/type\s*=/)

    // dsh patch：insert 含 mcp-tavily（streamable-http）
    const dshDoc = parseYaml(await fs.readFile(pathOf('dsh'), 'utf8'))
    const tavilyDsh = findDshEntry(dshDoc, 'mcp-tavily')
    expect(tavilyDsh).toBeDefined()
    expect(tavilyDsh!.config.transport).toBe('streamable-http')
    expect(tavilyDsh!.config.url).toBe(TAVILY.spec.url)

    // hermes yaml：mcp_servers.dbx（command + enabled，无 type）；原有条目保留
    const hermes = parseYaml(await fs.readFile(pathOf('hermes'), 'utf8'))
    expect(hermes.mcp_servers.dbx.command).toBe('npx')
    expect(hermes.mcp_servers.dbx.enabled).toBe(true)
    expect(hermes.mcp_servers.filesystem).toBeDefined()
    expect(hermes.mcp_servers.docker).toBeDefined()

    // gemini json：mcpServers.dbx
    const gemini = JSON.parse(await fs.readFile(pathOf('gemini'), 'utf8'))
    expect(gemini.mcpServers.dbx).toEqual(DBX.spec)

    // opencode json：local 形态（command 数组 + enabled）
    const opencode = JSON.parse(await fs.readFile(pathOf('opencode'), 'utf8'))
    expect(opencode.mcp.dbx).toEqual({
      type: 'local',
      command: ['npx', '-y', '@dbx-app/mcp-server@latest'],
      enabled: true
    })

    // zcode json：mcp.servers.tavily（远程条目 type+url）；plugins 键与 memory 条目保留
    const zcode = JSON.parse(await fs.readFile(pathOf('zcode'), 'utf8'))
    expect(zcode.mcp.servers.tavily).toEqual({
      type: 'http',
      url: 'https://mcp.example.com/tavily?key=testKey'
    })
    expect(zcode.mcp.servers.memory).toBeDefined()
    expect(zcode.plugins).toBeDefined()

    // store apps 反映所有开关
    const items = await currentItems()
    const tv = items.find((i) => i.id === 'tavily')!
    const db = items.find((i) => i.id === 'dbx')!
    expect(tv.apps).toEqual({ dsh: true, codex: true, grok: true, zcode: true })
    expect(db.apps).toEqual({ claude: true, gemini: true, opencode: true, hermes: true })
  })
})

describe('toggleMcp 关闭', () => {
  it('off：从启用文件移除条目，其他内容保留', async () => {
    await seed([TAVILY])
    for (const agent of ['dsh', 'claude', 'codex', 'hermes', 'zcode'] as AgentId[]) {
      await toggleMcp('tavily', agent, true, ctx)
    }

    for (const agent of ['dsh', 'claude', 'codex', 'hermes', 'zcode'] as AgentId[]) {
      await toggleMcp('tavily', agent, false, ctx)
    }

    // claude json：条目移除、playwright 与 projects 保留
    const claude = JSON.parse(await fs.readFile(pathOf('claude'), 'utf8'))
    expect(claude.mcpServers.tavily).toBeUndefined()
    expect(claude.mcpServers.playwright).toBeDefined()
    expect(claude.projects).toBeDefined()

    // codex toml：块移除、注释/其它表保留
    const codex = await fs.readFile(pathOf('codex'), 'utf8')
    expect(codex).not.toContain('[mcp_servers.tavily]')
    expect(codex).toContain('# Codex 顶层注释')
    expect(codex).toContain('model = "gpt-5-codex"')
    expect(codex).toContain('[mcp_servers.brave]')
    expect(codex).toContain('[other.section]')

    // dsh patch：insert 移除、skill 条目保留
    const dshDoc = parseYaml(await fs.readFile(pathOf('dsh'), 'utf8'))
    expect(findDshEntry(dshDoc, 'mcp-tavily')).toBeUndefined()
    expect(findDshEntry(dshDoc, 'mcp-playwright')).toBeDefined()
    expect(findDshEntry(dshDoc, 'skill-filesystem')).toBeDefined()

    // hermes yaml：条目移除、原有两个 server 与 provider 保留
    const hermes = parseYaml(await fs.readFile(pathOf('hermes'), 'utf8'))
    expect(hermes.mcp_servers.tavily).toBeUndefined()
    expect(hermes.mcp_servers.filesystem).toBeDefined()
    expect(hermes.mcp_servers.docker).toBeDefined()
    expect(hermes.provider).toBe('anthropic')

    // zcode json：条目移除、memory 条目与 plugins 键保留
    const zcode = JSON.parse(await fs.readFile(pathOf('zcode'), 'utf8'))
    expect(zcode.mcp.servers.tavily).toBeUndefined()
    expect(zcode.mcp.servers.memory).toBeDefined()
    expect(zcode.plugins).toBeDefined()

    // store apps 已清空
    const items = await currentItems()
    expect(items.find((i) => i.id === 'tavily')!.apps).toEqual({})
  })
})

describe('bulkToggleMcp', () => {
  it('批量关闭/开启：逐条按 toggle 语义作用于全部 item', async () => {
    await seed([{ ...TAVILY, apps: { claude: true } }, { ...DBX, apps: { codex: true } }])
    await toggleMcp('tavily', 'claude', true, ctx)
    await toggleMcp('dbx', 'codex', true, ctx)

    await bulkToggleMcp('claude', false, ctx)
    const claude = JSON.parse(await fs.readFile(pathOf('claude'), 'utf8'))
    expect(claude.mcpServers.tavily).toBeUndefined()
    expect(claude.mcpServers.playwright).toBeDefined()

    await bulkToggleMcp('dsh', true, ctx)
    const dshDoc = parseYaml(await fs.readFile(pathOf('dsh'), 'utf8'))
    expect(findDshEntry(dshDoc, 'mcp-tavily')).toBeDefined()
    expect(findDshEntry(dshDoc, 'mcp-dbx')).toBeDefined()

    const items = await currentItems()
    expect(items.find((i) => i.id === 'tavily')!.apps.claude).toBeFalsy()
    expect(items.find((i) => i.id === 'tavily')!.apps.dsh).toBe(true)
    expect(items.find((i) => i.id === 'dbx')!.apps.dsh).toBe(true)
  })
})

describe('saveMcp', () => {
  it('编辑：关闭一个启用、新增一个启用 -> 两文件正确差异', async () => {
    await seed([{ ...DBX, apps: { claude: true } }])
    await toggleMcp('dbx', 'claude', true, ctx)

    await saveMcp({ ...DBX, name: 'DBX v2', apps: { codex: true } }, { claude: true }, ctx)

    const claude = JSON.parse(await fs.readFile(pathOf('claude'), 'utf8'))
    expect(claude.mcpServers.dbx).toBeUndefined()
    expect(claude.mcpServers.playwright).toBeDefined()
    const codex = await fs.readFile(pathOf('codex'), 'utf8')
    expect(codex).toContain('[mcp_servers.dbx]')
    expect(codex).toContain('[mcp_servers.brave]')
    const items = await currentItems()
    expect(items.find((i) => i.id === 'dbx')?.name).toBe('DBX v2')
    expect(items.find((i) => i.id === 'dbx')?.apps).toEqual({ codex: true })
  })

  it('新增：直接入库 + 已启用 harness 逐个写入', async () => {
    await seed([])

    const fresh: McpItem = {
      id: 'fresh',
      name: 'Fresh',
      spec: { type: 'stdio', command: 'uvx', args: ['mcp-server-fresh'] },
      apps: { dsh: true, gemini: true }
    }
    await saveMcp(fresh, undefined, ctx)

    expect((await currentItems()).map((i) => i.id)).toContain('fresh')
    const dshDoc = parseYaml(await fs.readFile(pathOf('dsh'), 'utf8'))
    expect(findDshEntry(dshDoc, 'mcp-fresh')).toBeDefined()
    const gemini = JSON.parse(await fs.readFile(pathOf('gemini'), 'utf8'))
    expect(gemini.mcpServers.fresh).toEqual(fresh.spec)
  })
})

describe('deleteMcp', () => {
  it('从所有启用 harness 移除条目并删库条目', async () => {
    await seed([{ ...DBX, apps: { claude: true, codex: true, dsh: true } }])
    await toggleMcp('dbx', 'claude', true, ctx)
    await toggleMcp('dbx', 'codex', true, ctx)
    await toggleMcp('dbx', 'dsh', true, ctx)

    await deleteMcp('dbx', ctx)

    const claude = JSON.parse(await fs.readFile(pathOf('claude'), 'utf8'))
    expect(claude.mcpServers.dbx).toBeUndefined()
    expect(claude.mcpServers.playwright).toBeDefined()
    const codex = await fs.readFile(pathOf('codex'), 'utf8')
    expect(codex).not.toContain('[mcp_servers.dbx]')
    const dshDoc = parseYaml(await fs.readFile(pathOf('dsh'), 'utf8'))
    expect(findDshEntry(dshDoc, 'mcp-dbx')).toBeUndefined()
    expect((await currentItems()).find((i) => i.id === 'dbx')).toBeUndefined()
  })
})

describe('importMcpFromHarnesses', () => {
  /** 覆盖 8 个 fixture 为导入专用内容（每条目 id 可控） */
  async function writeImportFixtures(): Promise<Record<AgentId, string>> {
    const files: Record<AgentId, string> = {
      dsh: `# patch layer
- insert:
    - id: mcp-tavily
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: tavily
        transport: streamable-http
        url: https://mcp.example.com/tavily?key=testKey
- insert:
    - id: mcp-fetch
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: fetch
        transport: stdio
        command: uvx
        args: ['mcp-server-fetch']
`,
      claude: `{
  "projects": { "D:/work": { "mcpServers": {} } },
  "mcpServers": {
    "tavily": { "type": "http", "url": "https://mcp.example.com/tavily?key=testKey" },
    "github": { "type": "stdio", "command": "gh", "args": ["mcp"] }
  }
}
`,
      codex: `# Codex 导入 fixture
model = "gpt-5-codex"

[mcp_servers.brave]
type = "stdio"
command = "npx"
args = ["-y", "@brave/brave-mcp-server"]
`,
      gemini: `{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem"]
    }
  }
}
`,
      grok: `# Grok 导入 fixture

[mcp_servers.weather]
command = "npx"
args = ["-y", "weather-mcp"]
`,
      opencode: `{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "github": {
      "type": "remote",
      "url": "https://mcp.example.com/github",
      "enabled": true
    }
  }
}
`,
      zcode: `{
  "mcp": {
    "servers": {
      "vision": {
        "command": "npx",
        "args": ["-y", "zai-mcp-server"],
        "enable": false
      }
    }
  }
}
`,
      hermes: `mcp_servers:
  docker:
    command: npx
    args:
      - -y
      - docker-mcp
    enabled: true
`
    }
    for (const [id, content] of Object.entries(files)) {
      await fs.writeFile(pathOf(id as AgentId), content, 'utf8')
    }
    return files
  }

  it('导入新条目（apps 仅该 agent true）+ 标记已存在条目（不回写文件）', async () => {
    await seed([{ ...TAVILY, apps: { dsh: true } }])
    const before = await writeImportFixtures()

    const res = await importMcpFromHarnesses(ctx)

    expect(res.added.map((i) => i.id).sort()).toEqual([
      'brave',
      'docker',
      'fetch',
      'filesystem',
      'github',
      'vision',
      'weather'
    ])
    expect(res.marked.map((i) => i.id).sort()).toEqual(['github', 'tavily'])

    const items = await currentItems()
    const tv = items.find((i) => i.id === 'tavily')!
    expect(tv.apps).toEqual({ dsh: true, claude: true })
    const gh = items.find((i) => i.id === 'github')!
    expect(gh.apps).toEqual({ claude: true, opencode: true })
    expect(items.find((i) => i.id === 'fetch')?.apps).toEqual({ dsh: true })
    expect(items.find((i) => i.id === 'brave')?.apps).toEqual({ codex: true })
    expect(items.find((i) => i.id === 'filesystem')?.apps).toEqual({ gemini: true })
    expect(items.find((i) => i.id === 'weather')?.apps).toEqual({ grok: true })
    expect(items.find((i) => i.id === 'docker')?.apps).toEqual({ hermes: true })
    expect(items.find((i) => i.id === 'vision')?.apps).toEqual({ zcode: true })

    // 各文件逐字节不变（仅标记，不回写）
    for (const [id, content] of Object.entries(before)) {
      expect(await fs.readFile(pathOf(id as AgentId), 'utf8')).toBe(content)
    }
  })
})

describe('previewMcp', () => {
  it('DSH 预览含 - insert:、TOML 含 [mcp_servers.、JSON 含 mcpServers、YAML 含 mcp_servers:', async () => {
    await seed([TAVILY, DBX])

    const dshPreview = await previewMcp('tavily', 'dsh', ctx)
    expect(dshPreview).toContain('- insert:')
    expect(dshPreview).toContain('mcp-tavily')

    const tomlPreview = await previewMcp('tavily', 'codex', ctx)
    expect(tomlPreview).toContain('[mcp_servers.tavily]')

    const jsonPreview = await previewMcp('dbx', 'claude', ctx)
    expect(jsonPreview).toContain('mcpServers')

    const yamlPreview = await previewMcp('dbx', 'hermes', ctx)
    expect(yamlPreview).toContain('mcp_servers:')

    const zcodePreview = await previewMcp('dbx', 'zcode', ctx)
    expect(zcodePreview).toContain('"servers"')
    expect(zcodePreview).toContain('"command": "npx"')
  })
})

describe('备份控制', () => {
  it('backupBeforeWrite=true：写操作前在备份目录产生 .bak 文件', async () => {
    await seed([DBX])

    await toggleMcp('dbx', 'claude', true, ctx)

    const files = await fs.readdir(backupDir)
    expect(files.some((f) => f.endsWith('.bak'))).toBe(true)
    // .claude.json 原本存在，应出现其备份
    expect(files.some((f) => f.startsWith('.claude.json.'))).toBe(true)
  })

  it('backupBeforeWrite=false：不产生备份文件且写入正常', async () => {
    await saveSettings(settingsPath, {
      dirOverrides: overrides,
      syncMethod: 'auto',
      backupBeforeWrite: false,
      skillUninstallBackup: true
    })
    await seed([DBX])

    await toggleMcp('dbx', 'claude', true, ctx)

    const entries = await fs.readdir(backupDir).catch(() => [] as string[])
    expect(entries.filter((f) => f.endsWith('.bak'))).toEqual([])
    const claude = JSON.parse(await fs.readFile(pathOf('claude'), 'utf8'))
    expect(claude.mcpServers.dbx).toEqual(DBX.spec)
  })
})

describe('listMcp', () => {
  it('返回库列表（同步读 store）', async () => {
    await seed([TAVILY, DBX])
    expect(await listMcp(ctx)).toHaveLength(2)
    expect(listMcp(ctx).map((i) => i.id)).toEqual(['tavily', 'dbx'])
  })
})