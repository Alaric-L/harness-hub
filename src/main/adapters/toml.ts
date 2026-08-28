// src/main/adapters/toml.ts —— D2: codex/grok 的 TOML 形态 MCP 增删读
// 读取用 smol-toml parse；写入/删除为文本级块操作（保留注释与其他表），
// 块 = `[mcp_servers.<id>]` 表头行起到下一个非注释表头（不含嵌套子表头）或文件尾。
import fs from 'node:fs/promises'
import { parse } from 'smol-toml'
import { atomicWrite, backupFile } from '../safety'
import type { McpSpec } from '../types'

type TomlFlavor = 'codex' | 'grok'

/** 正确表根；历史错误格式 [mcp.servers] 读取容错、写入前清理 */
const STANDARD_ROOT = 'mcp_servers'
const LEGACY_ROOT = 'mcp.servers'

/** 目标不存在（ENOENT）才返回 true；其余错误原样上抛 */
function isNotFound(err: unknown): boolean {
  if (!(err instanceof Error) || !('code' in err)) return false
  return (err as { code?: string }).code === 'ENOENT'
}

/** 读文件文本；文件不存在返回 null */
async function readTextOrNone(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
}

/** 行是否是表头（`[a.b]` / `[[a.b]]`，允许尾随注释；行内无换行） */
function isTableHeader(line: string): boolean {
  return /^\s*\[\[?[\s\S]*?\]\]?\s*(?:#.*)?$/.test(line)
}

/** 表头行 -> 路径文本（如 `mcp_servers.a.env`）；非表头返回 null */
function headerPath(line: string): string | null {
  const m = /^\s*\[\[?([\s\S]*?)\]\]?\s*(?:#.*)?$/.exec(line)
  return m ? m[1].trim() : null
}

/** 正则转义 */
function escRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 是否可用 TOML bare key（否则用带引号 key） */
function isBareKey(s: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(s)
}

/** keyPart：bare 或双引号 quoted（与生成/查找一致） */
function keyPart(key: string): string {
  return isBareKey(key) ? key : JSON.stringify(key)
}

/** TOML 基本字符串（JSON 转义与 TOML 兼容） */
function q(s: string): string {
  return JSON.stringify(s)
}

/** 查找 `[root.id]` 表头的行号；不存在返回 -1 */
function findBlockStart(lines: string[], root: string, id: string): number {
  const re = new RegExp(`^\\s*\\[${escRegExp(root)}.${escRegExp(keyPart(id))}\\]\\s*(?:#.*)?$`)
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i
  }
  return -1
}

/** 块结束行号（不含）：下一个非注释表头且非目标 id 的嵌套子表头，或文件尾 */
function findBlockEnd(lines: string[], start: number, root: string, id: string): number {
  const prefix = `${root}.${keyPart(id)}.`
  for (let i = start + 1; i < lines.length; i++) {
    const p = headerPath(lines[i])
    if (p === null) continue
    if (p.startsWith(prefix)) continue // 嵌套子表（env/env/headers 等）属于本块
    return i
  }
  return lines.length
}

/** 删除 [root.id] 块；返回新行数组与是否发生了删除 */
function removeBlock(
  lines: string[],
  root: string,
  id: string
): { lines: string[]; removed: boolean } {
  const start = findBlockStart(lines, root, id)
  if (start < 0) return { lines, removed: false }
  const end = findBlockEnd(lines, start, root, id)
  return { lines: [...lines.slice(0, start), ...lines.slice(end)], removed: true }
}

/**
 * root（mcp_servers / mcp.servers）是否是标准表形态。
 * 非标准 = 根作用域出现 `root = {...}`（inline 表）或 `root.x = ...`（dotted 键定义）。
 * 表作用域内的同名键是局部键，不算。
 */
function hasNonStandardRoot(content: string, root: string): boolean {
  const lines = content.split('\n')
  const inlineRe = new RegExp(`^${escRegExp(root)}\\s*=`)
  const dottedRe = new RegExp(`^${escRegExp(root)}\\.`)
  let inTable = false // 根作用域之后进入任一表头即视为表作用域
  for (const line of lines) {
    if (headerPath(line) !== null) {
      inTable = true
      continue
    }
    if (inTable) continue
    const t = line.trim()
    if (inlineRe.test(t) || dottedRe.test(t)) return true
  }
  return false
}

/** 生成 `[mcp_servers.<id>]` 块文本（末行带 \n）。codex 显式 type + http_headers；grok 无 type + headers */
function buildBlockText(id: string, spec: McpSpec, flavor: TomlFlavor): string {
  const key = keyPart(id)
  const lines: string[] = []
  if (flavor === 'codex') lines.push(`type = ${q(spec.type)}`)
  if (spec.command) lines.push(`command = ${q(spec.command)}`)
  if (spec.args && spec.args.length > 0) lines.push(`args = [${spec.args.map(q).join(', ')}]`)
  if (spec.url) lines.push(`url = ${q(spec.url)}`)
  const headersKey = flavor === 'codex' ? 'http_headers' : 'headers'
  if (spec.headers && Object.keys(spec.headers).length > 0) {
    lines.push(`[mcp_servers.${key}.${headersKey}]`)
    for (const [k, v] of Object.entries(spec.headers)) lines.push(`  ${keyPart(k)} = ${q(v)}`)
  }
  if (spec.env && Object.keys(spec.env).length > 0) {
    lines.push(`[mcp_servers.${key}.env]`)
    for (const [k, v] of Object.entries(spec.env)) lines.push(`  ${keyPart(k)} = ${q(v)}`)
  }
  return `[mcp_servers.${key}]\n${lines.join('\n')}\n`
}

/** 追加块到文件尾：已有内容末尾补一条空行分隔（文件为空则直接写块） */
function appendBlockText(content: string, blockText: string): string {
  if (content === '') return blockText
  if (content.endsWith('\n')) {
    if (content.endsWith('\n\n')) return content + blockText
    return content + '\n' + blockText
  }
  return content + '\n\n' + blockText
}

/** {id: 条目表} 中的表值；值非表（数组/标量）时跳过 */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 取字符串键值表（标量字符串化，非标量跳过）；不存在或空返 undefined */
function pickStringMap(v: unknown): Record<string, string> | undefined {
  if (!isPlainObject(v)) return undefined
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      out[k] = String(val)
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** TOML 条目表 -> 统一 McpSpec（type 显式有效则用，否则 url->http 无 url->stdio；http_headers 优先于 headers） */
function entryToSpec(entry: Record<string, unknown>): McpSpec {
  const rawType = typeof entry['type'] === 'string' ? entry['type'] : undefined
  const url = typeof entry['url'] === 'string' ? entry['url'] : undefined
  const type =
    rawType === 'stdio' || rawType === 'http' || rawType === 'sse' ? rawType : url ? 'http' : 'stdio'
  const spec: McpSpec = { type }
  if (typeof entry['command'] === 'string') spec.command = entry['command']
  if (Array.isArray(entry['args'])) {
    const args = (entry['args'] as unknown[]).filter((a): a is string => typeof a === 'string')
    if (args.length > 0) spec.args = args
  }
  if (url) spec.url = url
  const headers = pickStringMap(entry['http_headers']) ?? pickStringMap(entry['headers'])
  if (headers) spec.headers = headers
  const env = pickStringMap(entry['env'])
  if (env) spec.env = env
  return spec
}

/** 取 [mcp_servers] 条目表；容错同时读历史错误格式 [mcp.servers]（TOML 中为嵌套表 doc.mcp.servers），返回"标准表、遗留表" */
function serverTablesOf(doc: unknown): [Record<string, unknown> | undefined, Record<string, unknown> | undefined] {
  if (!isPlainObject(doc)) return [undefined, undefined]
  const standard = (doc as Record<string, unknown>)[STANDARD_ROOT]
  const mcp = (doc as Record<string, unknown>)['mcp']
  const legacy = isPlainObject(mcp) ? (mcp as Record<string, unknown>)['servers'] : undefined
  return [
    isPlainObject(standard) ? standard : undefined,
    isPlainObject(legacy) ? legacy : undefined
  ]
}

/**
 * 读取 TOML 配置中全部 MCP 条目。
 * smol-toml 解析取 [mcp_servers]（容错同时读 [mcp.servers]）；文件不存在返回 {}；坏 TOML 抛错。
 * codex/grok 读法一致：type 显式有效则用（grok 不写 type，按 url 推断）、http_headers 优先于 headers。
 */
export async function readTomlMcp(
  filePath: string,
  _flavor: TomlFlavor
): Promise<Record<string, McpSpec>> {
  const content = await readTextOrNone(filePath)
  if (content === null) return {}
  let doc: unknown
  try {
    doc = parse(content)
  } catch (err) {
    throw new Error(`failed to parse ${filePath}: ${(err as Error).message}`)
  }
  const [standard, legacy] = serverTablesOf(doc)
  if (!standard && !legacy) return {}
  const out: Record<string, McpSpec> = {}
  for (const table of [standard, legacy]) {
    if (!table) continue
    for (const [id, entry] of Object.entries(table)) {
      if (!isPlainObject(entry)) continue
      if (!(id in out)) out[id] = entryToSpec(entry) // 标准表优先，遗留格式只补缺
    }
  }
  return out
}

/** 现有内容可解析 + root 为标准表；否则抛错（宁可不改不破坏） */
function assertModifiable(filePath: string, content: string): void {
  if (content === '') return
  try {
    parse(content)
  } catch (err) {
    throw new Error(`failed to parse ${filePath}: ${(err as Error).message}`)
  }
  if (hasNonStandardRoot(content, STANDARD_ROOT)) {
    throw new Error(
      `"${STANDARD_ROOT}" in ${filePath} is not a standard [${STANDARD_ROOT}] table; refusing to modify`
    )
  }
}

/**
 * 写入（或覆盖）TOML 配置中 id 的 MCP 条目（文本级块操作）。
 * 替换同名块或文件尾追加；写前清理 [mcp.servers] 错误格式同名块；
 * 坏 TOML / inline 形态 mcp_servers 明确抛错；写前 backupFile，atomicWrite 落盘（smol-toml 解析回验）。
 */
export async function writeTomlMcpEntry(
  filePath: string,
  id: string,
  spec: McpSpec,
  flavor: TomlFlavor,
  backupDir: string
): Promise<void> {
  const original = await readTextOrNone(filePath)
  const content = original ?? ''
  assertModifiable(filePath, content)

  let lines = content === '' ? [] : content.split('\n')
  // 历史错误格式 [mcp.servers]：自身为标准表时清理同名块（best-effort）
  if (content !== '' && !hasNonStandardRoot(content, LEGACY_ROOT)) {
    lines = removeBlock(lines, LEGACY_ROOT, id).lines
  }

  const blockText = buildBlockText(id, spec, flavor)
  const start = findBlockStart(lines, STANDARD_ROOT, id)
  let newContent: string
  if (start >= 0) {
    const end = findBlockEnd(lines, start, STANDARD_ROOT, id)
    const blockLines = blockText.split('\n')
    newContent = [...lines.slice(0, start), ...blockLines, ...lines.slice(end)].join('\n')
  } else {
    newContent = appendBlockText(lines.join('\n'), blockText)
  }

  await backupFile(filePath, backupDir)
  await atomicWrite(filePath, newContent, (s) => {
    parse(s)
  })
}

/**
 * 删除 TOML 配置中 id 的 MCP 条目：同时清理 [mcp_servers] 与 [mcp.servers] 同名块。
 * 文件不存在 / 无目标块时不写回；inline 形态 mcp_servers 明确抛错。
 */
export async function removeTomlMcpEntry(
  filePath: string,
  id: string,
  backupDir: string
): Promise<void> {
  const content = await readTextOrNone(filePath)
  if (content === null) return
  assertModifiable(filePath, content)

  let lines = content.split('\n')
  let removed = false
  for (const root of [STANDARD_ROOT, LEGACY_ROOT]) {
    if (hasNonStandardRoot(content, root)) continue
    const r = removeBlock(lines, root, id)
    if (r.removed) {
      lines = r.lines
      removed = true
    }
  }
  if (!removed) return

  await backupFile(filePath, backupDir)
  let newContent = lines.join('\n')
  // 原文件以换行结尾且删后丢失时补回（保持文件级尾随换行）
  if (lines.length > 0 && content.endsWith('\n') && !newContent.endsWith('\n')) {
    newContent += '\n'
  }
  await atomicWrite(filePath, newContent, (s) => {
    parse(s)
  })
}