// src/main/adapters/json.ts —— D1: claude/gemini/opencode/zcode 的 JSON 形态 MCP 增删读
// claude/gemini: mcpServers 键，统一 spec 原样存取；opencode: mcp 键，local/remote 双向转换；
// zcode: mcp.servers 嵌套键（对齐官方文档 https://zcode.z.ai/cn/docs/mcp-services）
import fs from 'node:fs/promises'
import { atomicWrite, backupFile } from '../safety'
import type { McpSpec } from '../types'

type JsonKind = 'claude' | 'gemini' | 'opencode' | 'zcode'

const KIND_KEY: Record<'claude' | 'gemini' | 'opencode', string> = {
  claude: 'mcpServers',
  gemini: 'mcpServers',
  opencode: 'mcp'
}

/** 目标不存在（ENOENT）才返回 true；其余错误原样上抛 */
function isNotFound(err: unknown): boolean {
  if (!(err instanceof Error) || !('code' in err)) return false
  return (err as { code?: string }).code === 'ENOENT'
}

/** 读现有 JSON 对象；文件不存在返回 {}；解析失败或根非对象抛错（消息含文件名） */
async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch (err) {
    if (isNotFound(err)) return {}
    throw err
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`failed to parse ${filePath}: ${(err as Error).message}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`invalid json root in ${filePath}`)
  }
  return parsed as Record<string, unknown>
}

/** 统一 McpSpec -> opencode 写入条目：stdio->local、http/sse->remote；空字段省略 */
function specToOpenCode(spec: McpSpec): Record<string, unknown> {
  if (spec.type === 'stdio') {
    const command = spec.command ? [spec.command, ...(spec.args ?? [])] : [...(spec.args ?? [])]
    const entry: Record<string, unknown> = { type: 'local', command, enabled: true }
    if (spec.env && Object.keys(spec.env).length > 0) entry['environment'] = spec.env
    return entry
  }
  const entry: Record<string, unknown> = { type: 'remote', enabled: true }
  if (spec.url) entry['url'] = spec.url
  if (spec.headers && Object.keys(spec.headers).length > 0) entry['headers'] = spec.headers
  return entry
}

/** opencode 读取逆向：local->stdio（command 数组首元素为 command、environment->env）、remote->sse */
function openCodeToSpec(entry: Record<string, unknown>): McpSpec {
  if (entry['type'] !== 'remote') {
    const commandArr = Array.isArray(entry['command']) ? (entry['command'] as string[]) : []
    const spec: McpSpec = { type: 'stdio' }
    if (commandArr.length > 0) {
      spec.command = commandArr[0]
      if (commandArr.length > 1) spec.args = commandArr.slice(1)
    }
    const environment = entry['environment']
    if (environment && typeof environment === 'object' && !Array.isArray(environment)) {
      spec.env = environment as Record<string, string>
    }
    return spec
  }
  const spec: McpSpec = { type: 'sse' }
  if (typeof entry['url'] === 'string') spec.url = entry['url']
  const headers = entry['headers']
  if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
    spec.headers = headers as Record<string, string>
  }
  return spec
}

/** 统一 McpSpec -> zcode 写入条目：stdio -> {command,args?,env?}（不写 type，对齐官方示例）；远程 -> {type,url,headers?} */
export function specToZcode(spec: McpSpec): Record<string, unknown> {
  if (spec.type === 'stdio') {
    const entry: Record<string, unknown> = { command: spec.command ?? '' }
    if (spec.args && spec.args.length > 0) entry['args'] = spec.args
    if (spec.env && Object.keys(spec.env).length > 0) entry['env'] = spec.env
    return entry
  }
  const entry: Record<string, unknown> = { type: spec.type, url: spec.url ?? '' }
  if (spec.headers && Object.keys(spec.headers).length > 0) entry['headers'] = spec.headers
  return entry
}

/** zcode 读取逆向：有 command -> stdio；有 url -> http/sse（type 缺省按 http）；均无返回 null（调用方跳过该条） */
function zcodeToSpec(entry: Record<string, unknown>): McpSpec | null {
  if (typeof entry['command'] === 'string' && entry['command']) {
    const spec: McpSpec = { type: 'stdio', command: entry['command'] }
    if (Array.isArray(entry['args'])) {
      spec.args = entry['args'].filter((a): a is string => typeof a === 'string')
    }
    const env = entry['env']
    if (env && typeof env === 'object' && !Array.isArray(env)) {
      spec.env = env as Record<string, string>
    }
    return spec
  }
  if (typeof entry['url'] === 'string' && entry['url']) {
    const spec: McpSpec = { type: entry['type'] === 'sse' ? 'sse' : 'http', url: entry['url'] }
    const headers = entry['headers']
    if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
      spec.headers = headers as Record<string, string>
    }
    return spec
  }
  return null
}

/** zcode 读取侧：取 obj.mcp.servers（任一级缺失/非对象返回 null） */
function readZcodeMap(obj: Record<string, unknown>): Record<string, unknown> | null {
  const mcp = obj['mcp']
  if (typeof mcp !== 'object' || mcp === null || Array.isArray(mcp)) return null
  const servers = (mcp as Record<string, unknown>)['servers']
  if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) return null
  return servers as Record<string, unknown>
}

/** zcode 写入侧：确保 mcp / mcp.servers 两级对象存在并返回 servers map（已存在但非对象抛错） */
function ensureZcodeMap(obj: Record<string, unknown>): Record<string, unknown> {
  const mcp = ensureObjectMap(obj, 'mcp')
  return ensureObjectMap(mcp, 'servers')
}

/** 取目标键下的条目 map；缺失时新建并挂回；已存在但非对象则抛错（宁可不改不破坏） */
function ensureObjectMap(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = obj[key]
  if (existing === undefined) {
    const map: Record<string, unknown> = {}
    obj[key] = map
    return map
  }
  if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) {
    throw new Error(`key "${key}" is not a JSON object`)
  }
  return existing as Record<string, unknown>
}

/**
 * 读取 kind 配置文件中全部 MCP 条目。
 * 解析失败抛错；键不存在（或文件不存在）返回 {}。
 */
export async function readJsonMcp(
  filePath: string,
  kind: JsonKind
): Promise<Record<string, McpSpec>> {
  const obj = await readJsonObject(filePath)
  const rawMap = kind === 'zcode' ? readZcodeMap(obj) : obj[KIND_KEY[kind]]
  if (typeof rawMap !== 'object' || rawMap === null || Array.isArray(rawMap)) return {}
  const out: Record<string, McpSpec> = {}
  for (const [id, entry] of Object.entries(rawMap as Record<string, unknown>)) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    if (kind === 'opencode') {
      out[id] = openCodeToSpec(entry as Record<string, unknown>)
    } else if (kind === 'zcode') {
      const spec = zcodeToSpec(entry as Record<string, unknown>)
      if (spec) out[id] = spec
    } else {
      out[id] = entry as McpSpec
    }
  }
  return out
}

/**
 * 写入（或覆盖）kind 配置中 id 的 MCP 条目，其他键与其他条目保留。
 * 读现有 JSON -> 修改目标键 -> 原子写回；文件不存在时创建仅含该键的 JSON。
 */
export async function writeJsonMcpEntry(
  filePath: string,
  id: string,
  spec: McpSpec,
  kind: JsonKind,
  backupDir: string
): Promise<void> {
  const obj = await readJsonObject(filePath)
  const map = kind === 'zcode' ? ensureZcodeMap(obj) : ensureObjectMap(obj, KIND_KEY[kind])
  map[id] = kind === 'opencode' ? specToOpenCode(spec) : kind === 'zcode' ? specToZcode(spec) : spec
  await backupFile(filePath, backupDir)
  await atomicWrite(filePath, JSON.stringify(obj, null, 2), (s) => {
    JSON.parse(s)
  })
}

/**
 * 删除 kind 配置中 id 的 MCP 条目，其他键与其他条目保留。
 * id 不存在时无操作也写回；原子写回。
 */
export async function removeJsonMcpEntry(
  filePath: string,
  id: string,
  kind: JsonKind,
  backupDir: string
): Promise<void> {
  const obj = await readJsonObject(filePath)
  const existing = kind === 'zcode' ? readZcodeMap(obj) : obj[KIND_KEY[kind]]
  if (typeof existing === 'object' && existing !== null && !Array.isArray(existing)) {
    delete (existing as Record<string, unknown>)[id]
  }
  await backupFile(filePath, backupDir)
  await atomicWrite(filePath, JSON.stringify(obj, null, 2), (s) => {
    JSON.parse(s)
  })
}