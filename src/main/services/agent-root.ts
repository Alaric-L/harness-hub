// src/main/services/agent-root.ts —— 写入 harness 配置前的「最外层配置目录」存在性检查
// 需求：MCP / Skills 写入其他 harness 配置目录时，先检测该 harness 的最外层配置目录
// （Harness 管理页展示的配置目录，dirOverrides 覆盖后即用覆盖值）是否存在；
// 不存在则不写入并抛可读错误（渲染层 toast 提示）。
import fs from 'node:fs'
import path from 'node:path'
import { AGENTS, agentsSharedRoot, resolveAgentPaths } from '../paths'
import type { HomeEnv, ResolvedAgentPaths } from '../paths'
import type { AgentId, SkillTargetId } from '../types'

/** ENOENT / ENOTDIR 才视为不存在，其余错误原样上抛 */
function isNotFound(err: unknown): boolean {
  if (!(err instanceof Error) || !('code' in err)) return false
  const code = (err as { code?: string }).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/**
 * 解析 agent 落点并确认最外层配置目录（dirOverrides 已生效）存在。
 * 不存在抛可读错误（含 agent 名与路径，供渲染层 toast）；存在返回解析结果供调用方继续写。
 */
export function assertAgentRoot(
  agentId: AgentId,
  overrides: Partial<Record<AgentId, string>>,
  env: HomeEnv = process.env
): ResolvedAgentPaths {
  const r = resolveAgentPaths(agentId, overrides, env)
  try {
    if (!fs.statSync(r.root).isDirectory()) {
      throw new Error(`配置目录不是文件夹：${r.root}`)
    }
  } catch (err) {
    if (isNotFound(err)) {
      const name = AGENTS.find((a) => a.id === agentId)?.name ?? agentId
      throw new Error(`未检测到 ${name} 的配置目录（${r.root}），已跳过写入。请先在 Harness 管理或对应工具中创建该目录。`)
    }
    throw err
  }
  return r
}

/**
 * 解析 Skills 部署目标（'shared' 或 harness）的 skills 目录并确认其根目录存在。
 * - 'shared'：检查 <home>/.agents 存在（dirOverrides 不适用，标准位置固定）；
 *   子目录 skills 由部署方 mkdir 创建，与 harness 语义一致。
 * - harness：委托 assertAgentRoot（检查其最外层配置目录，dirOverrides 覆盖后即用覆盖值）。
 * 不存在抛可读错误（渲染层 toast）；存在返回目标 skills 目录绝对路径。
 */
export function assertSkillTargetRoot(
  targetId: SkillTargetId,
  overrides: Partial<Record<AgentId, string>>,
  env: HomeEnv = process.env
): string {
  if (targetId === 'shared') {
    const root = agentsSharedRoot(env)
    let isDir = false
    try {
      isDir = fs.statSync(root).isDirectory()
    } catch (err) {
      if (isNotFound(err)) {
        throw new Error(`未检测到 Agent Skills 共享目录（${root}），已跳过写入。请先创建该目录。`)
      }
      throw err
    }
    if (!isDir) throw new Error(`共享目录不是文件夹：${root}`)
    return path.join(root, 'skills')
  }
  return assertAgentRoot(targetId, overrides, env).skillsDir
}
