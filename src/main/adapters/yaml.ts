// src/main/adapters/yaml.ts —— Hermes config.yaml 的 MCP adapter（mcp_servers 键）
// 用 yaml 包的 parseDocument 编辑（保留注释），写前备份 + atomicWrite 原子落盘（validate = yaml.parse）。
// 格式语义对齐 cc-switch mcp/hermes.rs：不写 type（Hermes 从 command/url 推断）；
// stdio 写 command/args/env（空数组/空对象省略）；http/sse 写 url/headers（空对象省略）；
// 恒写 enabled: true；对已存在条目 merge-on-write（保留 timeout/sampling 等特有字段，只覆盖统一模型管理的键）。
import fs from 'node:fs/promises'
import { parse, parseDocument, Scalar, YAMLMap, YAMLSeq, type Document } from 'yaml'
import { atomicWrite, backupFile } from '../safety'
import type { McpSpec } from '../types'

/** 统一模型管理的键：写入时完全归 spec 所有，类型切换时旧值移除（enabled 恒为 true） */
const MANAGED_KEYS: readonly string[] = ['command', 'args', 'env', 'url', 'headers', 'enabled']

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

/** hermes 单条条目 -> 统一 spec（对齐 cc-switch convert_from_hermes_format:117+） */
function hermesEntryToSpec(id: string, m: YAMLMap): McpSpec {
  const command = m.get('command')
  if (typeof command === 'string') {
    const spec: McpSpec = { type: 'stdio', command }
    const args = stringArray(m.get('args'))
    if (args) spec.args = args
    const env = stringMap(m.get('env'))
    if (env) spec.env = env
    return spec
  }
  const url = m.get('url')
  if (typeof url === 'string') {
    const spec: McpSpec = { type: 'sse', url }
    const headers = stringMap(m.get('headers'))
    if (headers) spec.headers = headers
    return spec
  }
  throw new Error(`Hermes MCP server '${id}' has neither 'command' nor 'url' field`)
}

/** 统一 spec -> hermes 条目对象（对齐 cc-switch convert_to_hermes_format:61-105） */
function hermesSpecToObject(spec: McpSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (spec.type === 'stdio') {
    if (spec.command) out.command = spec.command
    if (spec.args && spec.args.length > 0) out.args = spec.args.slice()
    if (spec.env && Object.keys(spec.env).length > 0) out.env = { ...spec.env }
  } else {
    if (spec.url) out.url = spec.url
    if (spec.headers && Object.keys(spec.headers).length > 0) out.headers = { ...spec.headers }
  }
  out.enabled = true
  return out
}

function setSeqFlow(node: unknown): void {
  if (node instanceof YAMLSeq) {
    node.flow = true
    return
  }
  if (node instanceof YAMLMap) {
    for (const p of node.items) setSeqFlow(p.value)
  }
}

/** merge-on-write：itemMap 覆盖统一键（移除已存在但新 spec 不管理的键），保留 hermes 特有键 */
function mergeManagedInto(existing: YAMLMap, itemMap: YAMLMap): void {
  const incoming = new Set<string>()
  for (const p of itemMap.items) incoming.add(String((p.key as Scalar).value))
  for (const p of [...existing.items]) {
    if (!(p.key instanceof Scalar)) continue
    const k = String(p.key.value)
    if (MANAGED_KEYS.includes(k) && !incoming.has(k)) existing.delete(p.key.value)
  }
  for (const p of itemMap.items) {
    const k = String((p.key as Scalar).value)
    const hit = existing.items.find((q) => q.key instanceof Scalar && String(q.key.value) === k)
    if (hit) hit.value = p.value
    else existing.set((p.key as Scalar).value, p.value)
  }
}

export async function readYamlMcp(path: string): Promise<Record<string, McpSpec>> {
  const content = await readTextIfExists(path)
  if (content === null) return {}
  // 统一转为基础 Document 类型：get() 返回 unknown、contents 为 Node|null，便于 typeof 收窄与节点构建
  const doc = parseDocument(content) as Document
  const servers = doc.get('mcp_servers')
  if (!(servers instanceof YAMLMap)) return {}
  const out: Record<string, McpSpec> = {}
  for (const pair of servers.items) {
    if (!(pair.key instanceof Scalar) || typeof pair.key.value !== 'string') continue
    if (!(pair.value instanceof YAMLMap)) continue
    out[pair.key.value] = hermesEntryToSpec(pair.key.value, pair.value)
  }
  return out
}

export async function upsertYamlMcpEntry(
  path: string,
  id: string,
  spec: McpSpec,
  backupDir: string
): Promise<void> {
  const content = await readTextIfExists(path)
  const doc = parseDocument(content ?? '') as Document
  let root = doc.contents
  if (root === null) {
    root = new YAMLMap()
    doc.contents = root
  }
  if (!(root instanceof YAMLMap)) throw new Error('hermes config.yaml root must be a map')
  let servers = doc.get('mcp_servers')
  if (servers === null || servers === undefined) {
    servers = new YAMLMap()
    root.set('mcp_servers', servers)
  }
  if (!(servers instanceof YAMLMap)) throw new Error("'mcp_servers' must be a map in hermes config.yaml")

  const itemNode = doc.createNode(hermesSpecToObject(spec)) as YAMLMap
  setSeqFlow(itemNode)
  const pair = servers.items.find((p) => p.key instanceof Scalar && String(p.key.value) === id)
  if (pair) {
    if (pair.value instanceof YAMLMap) mergeManagedInto(pair.value, itemNode)
    else pair.value = itemNode
  } else {
    servers.set(id, itemNode)
  }

  await backupFile(path, backupDir)
  await atomicWrite(path, doc.toString() ?? '', (s) => {
    parse(s)
  })
}

export async function removeYamlMcpEntry(
  path: string,
  id: string,
  backupDir: string
): Promise<void> {
  const content = await readTextIfExists(path)
  if (content === null) return
  const doc = parseDocument(content) as Document
  const servers = doc.get('mcp_servers')
  if (!(servers instanceof YAMLMap)) return
  const pair = servers.items.find((p) => p.key instanceof Scalar && String(p.key.value) === id)
  if (!pair) return
  servers.delete(pair.key.value)

  await backupFile(path, backupDir)
  await atomicWrite(path, doc.toString() ?? '', (s) => {
    parse(s)
  })
}