// src/main/services/agents-version.ts —— Dashboard「Harness 概览」版本探测 / 安装（对齐 cc-switch「本地环境检查」）
// 语义对齐 cc-switch commands/misc.rs：
// - 本地版本：`{bin} --version` 子进程 + 正则提取（VERSION_RE:1013）
// - 最新版本：npm registry dist-tags.latest（fetch_npm_latest_for_tool:961）
// - 安装/更新：npm i -g <pkg>@latest（npm_install_command_for:509）
// 本实现 7 个 harness 全部走 npm（含 hermes：npm 上 hermes-agent 提供 hermes 二进制，registry 已实测）。
// 探测代价高（每个工具一次 --version 子进程 + 一次 npm 网络请求），渲染层初始化 / 手动刷新时触发，不做缓存。
import { exec } from 'node:child_process'
import { AGENTS } from '../paths'
import type { AgentId } from '../types'

/** --version 探测超时（含 not-found 场景） */
const PROBE_TIMEOUT_MS = 15_000
/** 安装命令超时（npm 全局安装可能较慢） */
const INSTALL_TIMEOUT_MS = 600_000
/** npm registry 请求超时 */
const NPM_TIMEOUT_MS = 15_000

/** 每个 agent 的二进制名 / npm 包 / 安装命令（dsh 安装命令按产品要求「npm install -g @deepseek-ai/dsh」） */
export const AGENT_TOOL_META: Record<AgentId, { bin: string; npm: string; install: string }> = {
  dsh: { bin: 'dsh', npm: '@deepseek-ai/dsh', install: 'npm install -g @deepseek-ai/dsh' },
  claude: { bin: 'claude', npm: '@anthropic-ai/claude-code', install: 'npm i -g @anthropic-ai/claude-code@latest' },
  codex: { bin: 'codex', npm: '@openai/codex', install: 'npm i -g @openai/codex@latest' },
  gemini: { bin: 'gemini', npm: '@google/gemini-cli', install: 'npm i -g @google/gemini-cli@latest' },
  grok: { bin: 'grok', npm: '@xai-official/grok', install: 'npm i -g @xai-official/grok@latest' },
  opencode: { bin: 'opencode', npm: 'opencode-ai', install: 'npm i -g opencode-ai@latest' },
  hermes: { bin: 'hermes', npm: 'hermes-agent', install: 'npm i -g hermes-agent@latest' }
}

/** Dashboard 单 agent 的版本信息 */
export interface AgentVersionInfo {
  agentId: AgentId
  version: string | null       // 本地版本（--version 成功解析）
  latestVersion: string | null // npm latest（网络失败为 null）
  error: string | null         // 探测失败原因（未安装 / 无法解析）
  installed: boolean
}

/** 从 CLI 版本输出提取纯版本号（对齐 cc-switch VERSION_RE:1013；无匹配返回 null） */
const VERSION_RE = /\d+\.\d+\.\d+(-[\w.]+)?/
export function extractVersion(raw: string): string | null {
  const m = VERSION_RE.exec(raw)
  return m ? m[0] : null
}

/** 解析 npm registry /<pkg>/latest 响应（纯函数，可注入测试） */
export function parseNpmLatestResponse(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null
  const v = (json as { version?: unknown }).version
  return typeof v === 'string' && v ? v : null
}

/** 执行 shell 命令并捕获输出；失败时把 stdout/stderr 挂到错误对象上供上层取用 */
function runCommand(cmd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(
      cmd,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as Error & { code?: unknown; stdout?: string; stderr?: string }
          e.stdout = stdout
          e.stderr = stderr
          reject(e)
          return
        }
        resolve({ stdout, stderr })
      }
    )
  })
}

/** 执行 <bin> --version，返回 (version, error)；未安装 / 无法解析时 version=null */
export async function probeLocalVersion(bin: string): Promise<{ version: string | null; error: string | null }> {
  try {
    const { stdout, stderr } = await runCommand(`${bin} --version`, PROBE_TIMEOUT_MS)
    const raw = `${stdout}\n${stderr}`.trim()
    const version = extractVersion(raw)
    return version
      ? { version, error: null }
      : { version: null, error: `已找到 ${bin} 但未能从输出解析版本号` }
  } catch (err) {
    const e = err as { code?: unknown; message?: string }
    const code = e.code
    const msg = String(e.message ?? '')
    // Windows cmd 找不到命令：exit 1 + 「不是内部或外部命令」；POSIX：127 / ENOENT
    if (code === 'ENOENT' || code === 127 || /not (recognized|found)|不是内部或外部命令|无法识别/.test(msg)) {
      return { version: null, error: `${bin} 未安装或不在 PATH 中` }
    }
    return { version: null, error: `${bin} --version 执行失败：${msg.split('\n').pop() ?? msg}` }
  }
}

/** 查询 npm 包 dist-tags.latest（网络失败返回 null，不抛错） */
export async function fetchNpmLatest(pkg: string): Promise<string | null> {
  try {
    const resp = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`, {
      signal: AbortSignal.timeout(NPM_TIMEOUT_MS)
    })
    if (!resp.ok) return null
    return parseNpmLatestResponse(await resp.json())
  } catch {
    return null
  }
}

/** 探测指定 agent（缺省全部 7 个）；各 agent 独立成败，并发执行取最慢者耗时 */
export async function getAgentVersions(ids?: AgentId[]): Promise<AgentVersionInfo[]> {
  const targets: AgentId[] = ids && ids.length > 0 ? ids : AGENTS.map((a) => a.id)
  const entries = await Promise.all(
    targets.map(async (agentId) => {
      const meta = AGENT_TOOL_META[agentId]
      if (!meta) return null
      const [probe, latestVersion] = await Promise.all([
        probeLocalVersion(meta.bin),
        fetchNpmLatest(meta.npm)
      ])
      const info: AgentVersionInfo = {
        agentId,
        version: probe.version,
        latestVersion,
        error: probe.error,
        installed: probe.version !== null
      }
      return info
    })
  )
  return entries.filter((e): e is AgentVersionInfo => e !== null)
}

/** 安装 / 更新 agent：执行安装命令后重新探测该 agent 并返回最新信息 */
export async function installAgent(agentId: AgentId): Promise<AgentVersionInfo> {
  const meta = AGENT_TOOL_META[agentId]
  if (!meta) throw new Error(`未知 agent：${agentId}`)
  try {
    await runCommand(meta.install, INSTALL_TIMEOUT_MS)
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    const detail = String(e.stderr ?? e.message ?? '').trim().split('\n').pop() ?? '安装命令执行失败'
    throw new Error(`安装 ${agentId} 失败：${detail}`)
  }
  return (await getAgentVersions([agentId]))[0]
}
