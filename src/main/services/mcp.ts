// src/main/services/mcp.ts —— D4: MCP service（库 CRUD、单开关、批量、导入合并、预览）
// 统一库存于 store.data.mcpItems（McpItem[]，apps = Partial<Record<AgentId, boolean>>）；
// harness 落点经 resolveAgentPaths(agentId, settings.dirOverrides)；写操作透传 D1-D3 adapter，
// adapter 抛错（inline toml 拒改、坏文件等）向上传播，本层不吞错。
// 路径可通过 McpCtx 注入（单测指向临时目录），默认取 <home>/.harness-hub。
import path from 'node:path'
import {
  readJsonMcp,
  removeJsonMcpEntry,
  specToZcode,
  writeJsonMcpEntry
} from '../adapters/json'
import {
  readTomlMcp,
  removeTomlMcpEntry,
  writeTomlMcpEntry
} from '../adapters/toml'
import { readYamlMcp, removeYamlMcpEntry, upsertYamlMcpEntry } from '../adapters/yaml'
import { readDshMcp, removeDshMcp, upsertDshMcp } from '../adapters/dsh'
import { assertAgentRoot } from './agent-root'
import { AGENTS, dataFile, fileBackupDir, resolveAgentPaths, settingsFile } from '../paths'
import { loadSettings, loadStore, saveStore } from '../store'
import type { HomeEnv } from '../paths'
import type { AgentId, AppSettings, McpItem, McpSpec } from '../types'

/** 依赖注入点：单测传入临时目录（data.json / settings.json / 备份根）；缺省走真实 home */
export interface McpCtx {
  dataFile?: string
  settingsFile?: string
  backupDir?: string
  env?: HomeEnv
}

interface McpAdapter {
  read: (p: string) => Promise<Record<string, McpSpec>>
  write: (p: string, id: string, spec: McpSpec, backupDir: string) => Promise<void>
  remove: (p: string, id: string, backupDir: string) => Promise<void>
}

function ctxOf(ctx?: McpCtx): Required<Pick<McpCtx, 'dataFile' | 'settingsFile' | 'backupDir' | 'env'>> {
  return {
    dataFile: ctx?.dataFile ?? dataFile(),
    settingsFile: ctx?.settingsFile ?? settingsFile(),
    backupDir: ctx?.backupDir ?? fileBackupDir(),
    env: ctx?.env ?? process.env
  }
}

/**
 * adapter 分发：json -> claude/gemini/opencode/zcode（D1 kind 参数）、
 * toml -> codex/grok（D2 flavor）、yaml -> hermes、yaml-patch -> dsh。
 * mcpFormat 只在对应 agent 上出现，kind/flavor 断言安全。
 */
function adapterFor(agentId: AgentId): McpAdapter {
  const agent = AGENTS.find((a) => a.id === agentId)
  if (!agent) throw new Error(`unknown agent id: ${agentId}`)
  switch (agent.mcpFormat) {
    case 'json': {
      const kind = agentId as 'claude' | 'gemini' | 'opencode' | 'zcode'
      return {
        read: (p) => readJsonMcp(p, kind),
        write: (p, id, spec, b) => writeJsonMcpEntry(p, id, spec, kind, b),
        remove: (p, id, b) => removeJsonMcpEntry(p, id, kind, b)
      }
    }
    case 'toml': {
      const flavor = agentId as 'codex' | 'grok'
      return {
        read: (p) => readTomlMcp(p, flavor),
        write: (p, id, spec, b) => writeTomlMcpEntry(p, id, spec, flavor, b),
        remove: (p, id, b) => removeTomlMcpEntry(p, id, b)
      }
    }
    case 'yaml':
      return { read: readYamlMcp, write: upsertYamlMcpEntry, remove: removeYamlMcpEntry }
    case 'yaml-patch':
      return { read: readDshMcp, write: upsertDshMcp, remove: removeDshMcp }
  }
  throw new Error(`unknown mcpFormat for agent: ${agentId}`)
}

/** backupBeforeWrite 关闭时备份落点改到隐藏子目录（adapter 恒调 backupFile，仅换目录） */
function backupDirFor(settings: AppSettings, base: string): string {
  return settings.backupBeforeWrite ? base : path.join(base, '.disabled')
}

async function writeEntry(
  agentId: AgentId,
  id: string,
  spec: McpSpec,
  settings: AppSettings,
  c: ReturnType<typeof ctxOf>
): Promise<void> {
  // 写入前检查该 harness 的最外层配置目录存在（目录覆盖已生效）；不存在抛可读错误不写入
  const r = assertAgentRoot(agentId, settings.dirOverrides, c.env)
  await adapterFor(agentId).write(r.mcpPath, id, spec, backupDirFor(settings, c.backupDir))
}

async function removeEntry(
  agentId: AgentId,
  id: string,
  settings: AppSettings,
  c: ReturnType<typeof ctxOf>
): Promise<void> {
  const r = resolveAgentPaths(agentId, settings.dirOverrides, c.env)
  await adapterFor(agentId).remove(r.mcpPath, id, backupDirFor(settings, c.backupDir))
}

/** 返回库列表（同步读 store） */
export function listMcp(ctx?: McpCtx): McpItem[] {
  const c = ctxOf(ctx)
  return loadStore(c.dataFile).mcpItems
}

/** 单开关：on -> adapter 写入该 harness 条目；off -> 删除该条目；随后存 store */
export async function toggleMcp(id: string, agentId: AgentId, on: boolean, ctx?: McpCtx): Promise<McpItem[]> {
  const c = ctxOf(ctx)
  const data = loadStore(c.dataFile)
  const item = data.mcpItems.find((i) => i.id === id)
  if (!item) throw new Error(`MCP item not found: ${id}`)
  const settings = loadSettings(c.settingsFile)
  if (on) {
    await writeEntry(agentId, id, item.spec, settings, c)
    item.apps[agentId] = true
  } else {
    await removeEntry(agentId, id, settings, c)
    delete item.apps[agentId]
  }
  await saveStore(c.dataFile, data)
  return data.mcpItems
}

/** 批量开关：遍历全部 item 逐条按 toggle 语义（正确性优先，落盘次数后优化） */
export async function bulkToggleMcp(agentId: AgentId, on: boolean, ctx?: McpCtx): Promise<McpItem[]> {
  const c = ctxOf(ctx)
  const data = loadStore(c.dataFile)
  const settings = loadSettings(c.settingsFile)
  if (on) assertAgentRoot(agentId, settings.dirOverrides, c.env) // 写入前预检目录，避免逐条写入中途失败
  for (const item of data.mcpItems) {
    if (on) {
      if (!item.apps[agentId]) {
        await writeEntry(agentId, item.id, item.spec, settings, c)
        item.apps[agentId] = true
      }
    } else if (item.apps[agentId]) {
      await removeEntry(agentId, item.id, settings, c)
      delete item.apps[agentId]
    }
  }
  await saveStore(c.dataFile, data)
  return data.mcpItems
}

/**
 * 新增/编辑 + 差量写入。
 * 新增：直接入库，已启用 harness 逐个写入；编辑：diff prevApps（缺省取库内 apps）
 * 与新 apps —— 关闭的 harness 移除条目、启用的 harness 写入（含 spec 变更覆盖）。
 */
export async function saveMcp(
  item: McpItem,
  prevApps?: Partial<Record<AgentId, boolean>>,
  ctx?: McpCtx
): Promise<McpItem[]> {
  const c = ctxOf(ctx)
  const data = loadStore(c.dataFile)
  const settings = loadSettings(c.settingsFile)
  const idx = data.mcpItems.findIndex((i) => i.id === item.id)
  const next = item.apps ?? {}

  // 预检：本次要启用的所有 harness 配置目录必须存在，任一缺失则整单拒绝（避免部分写入）
  for (const agentId of Object.keys(next) as AgentId[]) {
    if (next[agentId]) assertAgentRoot(agentId, settings.dirOverrides, c.env)
  }

  if (idx >= 0) {
    const prev = prevApps ?? data.mcpItems[idx].apps ?? {}
    for (const agentId of Object.keys(prev) as AgentId[]) {
      if (prev[agentId] && !next[agentId]) {
        await removeEntry(agentId, item.id, settings, c)
      }
    }
    for (const agentId of Object.keys(next) as AgentId[]) {
      if (next[agentId]) {
        await writeEntry(agentId, item.id, item.spec, settings, c)
      }
    }
    data.mcpItems[idx] = item
  } else {
    for (const agentId of Object.keys(next) as AgentId[]) {
      if (next[agentId]) {
        await writeEntry(agentId, item.id, item.spec, settings, c)
      }
    }
    data.mcpItems.push(item)
  }

  await saveStore(c.dataFile, data)
  return data.mcpItems
}

/** 删除：从所有启用 harness 移除条目 + 删库条目 */
export async function deleteMcp(id: string, ctx?: McpCtx): Promise<McpItem[]> {
  const c = ctxOf(ctx)
  const data = loadStore(c.dataFile)
  const idx = data.mcpItems.findIndex((i) => i.id === id)
  if (idx < 0) throw new Error(`MCP item not found: ${id}`)
  const settings = loadSettings(c.settingsFile)
  const item = data.mcpItems[idx]
  for (const agentId of Object.keys(item.apps ?? {}) as AgentId[]) {
    if (item.apps[agentId]) {
      await removeEntry(agentId, id, settings, c)
    }
  }
  data.mcpItems.splice(idx, 1)
  await saveStore(c.dataFile, data)
  return data.mcpItems
}

/**
 * 逐 agent 读各格式配置 -> 与库比对：id 不存在 -> 新条目（apps 仅该 agent true）；
 * 已存在 -> 仅标记该 agent 为 true（不回写文件）。返回 {added, marked}。
 */
export async function importMcpFromHarnesses(
  ctx?: McpCtx
): Promise<{ added: McpItem[]; marked: McpItem[] }> {
  const c = ctxOf(ctx)
  const data = loadStore(c.dataFile)
  const settings = loadSettings(c.settingsFile)
  const added: McpItem[] = []
  const marked: McpItem[] = []
  for (const agent of AGENTS) {
    const r = resolveAgentPaths(agent.id, settings.dirOverrides, c.env)
    const found = await adapterFor(agent.id).read(r.mcpPath)
    for (const [id, spec] of Object.entries(found)) {
      const existing = data.mcpItems.find((i) => i.id === id)
      if (existing) {
        if (!existing.apps[agent.id]) {
          existing.apps[agent.id] = true
          marked.push(existing)
        }
      } else {
        const item: McpItem = { id, name: id, spec, apps: { [agent.id]: true } }
        data.mcpItems.push(item)
        added.push(item)
      }
    }
  }
  await saveStore(c.dataFile, data)
  return { added, marked }
}

/** DSH 预览（对齐 dsh adapter 写入形态：insert 元素 + mcp-<id> 条目） */
function previewDsh(id: string, spec: McpSpec): string {
  const lines = [
    '- insert:',
    `  - id: mcp-${id}`,
    `    name: '@deepseek-ai/dsh-mcp-client'`,
    '    config:',
    `      serverName: ${id}`
  ]
  if (spec.type === 'stdio') {
    lines.push('      transport: stdio')
    if (spec.command) lines.push(`      command: ${spec.command}`)
    if (spec.args && spec.args.length > 0) {
      lines.push(`      args: [${spec.args.map((a) => `'${a}'`).join(', ')}]`)
    }
    if (spec.env && Object.keys(spec.env).length > 0) {
      lines.push(`      env: ${JSON.stringify(spec.env)}`)
    }
  } else {
    lines.push('      transport: streamable-http')
    if (spec.url) lines.push(`      url: ${spec.url}`)
    if (spec.headers && Object.keys(spec.headers).length > 0) {
      lines.push(`      headers: ${JSON.stringify(spec.headers)}`)
    }
  }
  return lines.join('\n')
}

/** TOML 预览（对齐 toml adapter 块格式；codex 显式 type + http_headers，grok 无 type + headers） */
function previewToml(id: string, spec: McpSpec, flavor: 'codex' | 'grok'): string {
  const key = /^[A-Za-z0-9_-]+$/.test(id) ? id : JSON.stringify(id)
  const lines: string[] = []
  if (flavor === 'codex') lines.push(`type = ${JSON.stringify(spec.type)}`)
  if (spec.command) lines.push(`command = ${JSON.stringify(spec.command)}`)
  if (spec.args && spec.args.length > 0) {
    lines.push(`args = [${spec.args.map((a) => JSON.stringify(a)).join(', ')}]`)
  }
  if (spec.url) lines.push(`url = ${JSON.stringify(spec.url)}`)
  const headersKey = flavor === 'codex' ? 'http_headers' : 'headers'
  if (spec.headers && Object.keys(spec.headers).length > 0) {
    lines.push(`[mcp_servers.${key}.${headersKey}]`)
    for (const [k, v] of Object.entries(spec.headers)) lines.push(`  ${k} = ${JSON.stringify(v)}`)
  }
  if (spec.env && Object.keys(spec.env).length > 0) {
    lines.push(`[mcp_servers.${key}.env]`)
    for (const [k, v] of Object.entries(spec.env)) lines.push(`  ${k} = ${JSON.stringify(v)}`)
  }
  return `[mcp_servers.${key}]\n${lines.join('\n')}`
}

/** JSON 预览：claude/gemini 用 mcpServers，opencode 用 mcp，zcode 用 mcp.servers（条目经转换） */
function previewJson(id: string, spec: McpSpec, agentId: AgentId): string {
  if (agentId === 'zcode') {
    return JSON.stringify({ mcp: { servers: { [id]: specToZcode(spec) } } }, null, 2)
  }
  const key = agentId === 'opencode' ? 'mcp' : 'mcpServers'
  return JSON.stringify({ [key]: { [id]: spec } }, null, 2)
}

/** hermes YAML 预览（对齐 yaml adapter：不写 type、恒写 enabled: true） */
function previewYaml(id: string, spec: McpSpec): string {
  const lines = ['mcp_servers:', `  ${id}:`]
  if (spec.type === 'stdio') {
    if (spec.command) lines.push(`    command: ${spec.command}`)
    if (spec.args && spec.args.length > 0) {
      lines.push('    args:')
      for (const a of spec.args) lines.push(`      - '${a}'`)
    }
    if (spec.env && Object.keys(spec.env).length > 0) {
      lines.push(`    env: ${JSON.stringify(spec.env)}`)
    }
  } else {
    if (spec.url) lines.push(`    url: ${spec.url}`)
    if (spec.headers && Object.keys(spec.headers).length > 0) {
      lines.push(`    headers: ${JSON.stringify(spec.headers)}`)
    }
  }
  lines.push('    enabled: true')
  return lines.join('\n')
}

/** 详情面板预览：按 agent 格式输出写入文本（复用 D1-D3 生成逻辑的文本形态，与渲染层 specPreview 对齐） */
export async function previewMcp(id: string, agentId: AgentId, ctx?: McpCtx): Promise<string> {
  const c = ctxOf(ctx)
  const data = loadStore(c.dataFile)
  const item = data.mcpItems.find((i) => i.id === id)
  if (!item) throw new Error(`MCP item not found: ${id}`)
  const agent = AGENTS.find((a) => a.id === agentId)
  if (!agent) throw new Error(`unknown agent id: ${agentId}`)
  switch (agent.mcpFormat) {
    case 'json':
      return previewJson(id, item.spec, agentId)
    case 'toml':
      return previewToml(id, item.spec, agentId as 'codex' | 'grok')
    case 'yaml':
      return previewYaml(id, item.spec)
    case 'yaml-patch':
      return previewDsh(id, item.spec)
  }
}