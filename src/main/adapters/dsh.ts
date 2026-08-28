// src/main/adapters/dsh.ts —— DSH cordis.patch.yml 的 MCP adapter（yaml-patch insert 条目）
// 顶层为数组，元素形如 {insert: [{id, name, config}]}；MCP 条目以 `mcp-<id>` 命名、
// name 为 '@deepseek-ai/dsh-mcp-client'（技能等其他 insert 条目不参与）。
// stdio -> config.transport 'stdio'；http/sse -> 'streamable-http'（DSH 客户端仅这两种传输）。
// 用 yaml 包的 parseDocument 编辑（保留注释），写前备份 + atomicWrite 落盘（validate = yaml.parse）。
import fs from 'node:fs/promises'
import {
  parse,
  parseDocument,
  Scalar,
  YAMLMap,
  YAMLSeq,
  type Document,
} from 'yaml'
import { atomicWrite, backupFile } from '../safety'
import type { McpSpec } from '../types'

const DSH_CLIENT_NAME = '@deepseek-ai/dsh-mcp-client'

async function readTextIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

function stringArray(v: unknown): string[] | undefined {
  if (v instanceof YAMLSeq) v = v.toJSON()
  if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string')) {
    return v as string[]
  }
  return undefined
}

function stringMap(v: unknown): Record<string, string> | undefined {
  if (v instanceof YAMLMap) v = v.toJSON()
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    const entries = Object.entries(v as Record<string, unknown>)
    if (entries.length === 0) return undefined
    const out: Record<string, string> = {}
    for (const [k, val] of entries) if (typeof val === 'string') out[k] = val
    return out
  }
  return undefined
}

/** dsh config 映射 -> 统一 spec（逆向还原写入格式） */
function dshConfigToSpec(cfg: YAMLMap): McpSpec | undefined {
  const transport = cfg.get('transport')
  if (transport === 'stdio') {
    const command = cfg.get('command')
    if (typeof command !== 'string') return undefined
    const spec: McpSpec = { type: 'stdio', command }
    const args = stringArray(cfg.get('args'))
    if (args) spec.args = args
    const env = stringMap(cfg.get('env'))
    if (env) spec.env = env
    return spec
  }
  if (transport === 'streamable-http') {
    const url = cfg.get('url')
    if (typeof url !== 'string') return undefined
    const spec: McpSpec = { type: 'http', url }
    const headers = stringMap(cfg.get('headers'))
    if (headers) spec.headers = headers
    return spec
  }
  return undefined
}

/** 统一 spec -> dsh config 映射（serverName 恒为统一 id） */
function buildDshConfig(doc: Document, id: string, spec: McpSpec): YAMLMap {
  const cfg = new YAMLMap()
  cfg.set('serverName', id)
  if (spec.type === 'stdio') {
    cfg.set('transport', 'stdio')
    if (spec.command) cfg.set('command', spec.command)
    if (spec.args && spec.args.length > 0) {
      const seq = doc.createNode(spec.args) as YAMLSeq
      seq.flow = true
      cfg.set('args', seq)
    }
    if (spec.env && Object.keys(spec.env).length > 0) cfg.set('env', doc.createNode(spec.env))
  } else {
    cfg.set('transport', 'streamable-http')
    if (spec.url) cfg.set('url', spec.url)
    if (spec.headers && Object.keys(spec.headers).length > 0) {
      cfg.set('headers', doc.createNode(spec.headers))
    }
  }
  return cfg
}

function keyString(p: { key: unknown }): string | null {
  return p.key instanceof Scalar && typeof p.key.value === 'string' ? p.key.value : null
}

export async function readDshMcp(path: string): Promise<Record<string, McpSpec>> {
  const content = await readTextIfExists(path)
  if (content === null) return {}
  // 统一转为基础 Document 类型：get() 返回 unknown、contents 为 Node|null，便于 typeof 收窄与节点构建
  const doc = parseDocument(content) as Document
  const root = doc.contents
  if (!(root instanceof YAMLSeq)) return {}
  const out: Record<string, McpSpec> = {}
  for (const element of root.items) {
    if (!(element instanceof YAMLMap)) continue
    const inserts = element.get('insert')
    if (!(inserts instanceof YAMLSeq)) continue
    for (const item of inserts.items) {
      if (!(item instanceof YAMLMap)) continue
      const mcpId = item.get('id')
      if (typeof mcpId !== 'string' || !mcpId.startsWith('mcp-')) continue
      if (item.get('name') !== DSH_CLIENT_NAME) continue
      const cfg = item.get('config')
      if (!(cfg instanceof YAMLMap)) continue
      const spec = dshConfigToSpec(cfg)
      if (spec) out[mcpId.slice(4)] = spec
    }
  }
  return out
}

export async function upsertDshMcp(
  path: string,
  id: string,
  spec: McpSpec,
  backupDir: string
): Promise<void> {
  const content = await readTextIfExists(path)
  const doc = parseDocument(content ?? '') as Document
  let root = doc.contents
  if (root === null) {
    root = new YAMLSeq()
    doc.contents = root
  }
  if (!(root instanceof YAMLSeq)) {
    throw new Error('dsh patch file root must be a sequence of insert/override/disable elements')
  }

  const cfg = buildDshConfig(doc, id, spec)
  const targetId = `mcp-${id}`
  let updated = false
  for (const element of root.items) {
    if (!(element instanceof YAMLMap)) continue
    const inserts = element.get('insert')
    if (!(inserts instanceof YAMLSeq)) continue
    const item = inserts.items.find((it) => {
      if (!(it instanceof YAMLMap)) return false
      return it.get('id') === targetId && it.get('name') === DSH_CLIENT_NAME
    })
    if (item instanceof YAMLMap) {
      const cfgPair = item.items.find((p) => keyString(p) === 'config')
      if (cfgPair) cfgPair.value = cfg
      else item.set('config', cfg)
      updated = true
      break
    }
  }

  if (!updated) {
    const item = new YAMLMap()
    item.set('id', targetId)
    item.set('name', DSH_CLIENT_NAME)
    item.set('config', cfg)
    const inserts = new YAMLSeq()
    inserts.add(item)
    const element = new YAMLMap()
    element.set('insert', inserts)
    root.add(element)
  }

  await backupFile(path, backupDir)
  await atomicWrite(path, doc.toString() ?? '', (s) => {
    parse(s)
  })
}

export async function removeDshMcp(
  path: string,
  id: string,
  backupDir: string
): Promise<void> {
  const content = await readTextIfExists(path)
  if (content === null) return
  const doc = parseDocument(content) as Document
  const root = doc.contents
  if (!(root instanceof YAMLSeq)) return

  const targetId = `mcp-${id}`
  let changed = false
  for (const element of [...root.items]) {
    if (!(element instanceof YAMLMap)) continue
    const inserts = element.get('insert')
    if (!(inserts instanceof YAMLSeq)) continue
    const idx = inserts.items.findIndex((it) => {
      if (!(it instanceof YAMLMap)) return false
      return it.get('id') === targetId && it.get('name') === DSH_CLIENT_NAME
    })
    if (idx < 0) continue
    inserts.items.splice(idx, 1)
    changed = true
    // 该元素仅含 insert 且已清空 -> 整体移除该顶层元素（不留空 `- insert:` 占位）
    const other = element.items.filter((p) => keyString(p) !== 'insert')
    if (inserts.items.length === 0 && other.length === 0) {
      const elIdx = root.items.indexOf(element)
      if (elIdx >= 0) root.items.splice(elIdx, 1)
    }
  }
  if (!changed) return

  await backupFile(path, backupDir)
  await atomicWrite(path, doc.toString() ?? '', (s) => {
    parse(s)
  })
}