// src/main/paths.ts —— 全项目路径解析的唯一来源（数据根目录 + 7 harness 落点 + 目录覆盖）
import path from 'node:path'
import type { AgentId, AgentInfo, SkillTargetId } from './types'

/** 可注入的 home 环境（单测用）；运行期取 process.env */
export interface HomeEnv {
  HOME?: string
  USERPROFILE?: string
}

function resolveHome(env: HomeEnv = process.env): string {
  // Windows 优先 USERPROFILE，其余平台 HOME
  const home = env.USERPROFILE || env.HOME
  if (!home) throw new Error('HOME/USERPROFILE 均未设置，无法解析数据目录')
  return home
}

/** 数据根目录 <home>/.harness-hub */
export function dataRoot(env: HomeEnv = process.env): string {
  return path.join(resolveHome(env), '.harness-hub')
}

/** SSOT skills 目录 <root>/skills */
export function ssotSkillsDir(env: HomeEnv = process.env): string {
  return path.join(dataRoot(env), 'skills')
}

/** skill 卸载备份目录 <root>/skill-backups */
export function skillBackupsDir(env: HomeEnv = process.env): string {
  return path.join(dataRoot(env), 'skill-backups')
}

/** 配置文件备份目录 <root>/backups */
export function fileBackupDir(env: HomeEnv = process.env): string {
  return path.join(dataRoot(env), 'backups')
}

/** 主数据文件 <root>/data.json */
export function dataFile(env: HomeEnv = process.env): string {
  return path.join(dataRoot(env), 'data.json')
}

/** 设置文件 <root>/settings.json */
export function settingsFile(env: HomeEnv = process.env): string {
  return path.join(dataRoot(env), 'settings.json')
}

/**
 * 7 harness 元信息（全局约束第 9 条，与原型 766-788 行一致）。
 * dir/mcpPath/skillsDir/promptFile 存「~ 风格模板」，渲染层展示用；
 * 实际绝对路径经 resolveAgentPaths 计算。
 * 顺序固定 DSH 置顶。
 */
export const AGENTS: AgentInfo[] = [
  { id: 'dsh', name: 'DeepSeek Harness', short: 'DSH', dir: '~/.dsh',
    mcpPath: '~/.dsh/profiles/web/cordis.patch.yml', mcpFormat: 'yaml-patch',
    skillsDir: '~/.dsh/skills', promptFile: '~/.dsh/AGENTS.md' },
  { id: 'claude', name: 'Claude Code', short: 'Claude', dir: '~/.claude',
    mcpPath: '~/.claude.json', mcpFormat: 'json',
    skillsDir: '~/.claude/skills', promptFile: '~/.claude/CLAUDE.md' },
  { id: 'codex', name: 'Codex', short: 'Codex', dir: '~/.codex',
    mcpPath: '~/.codex/config.toml', mcpFormat: 'toml',
    skillsDir: '~/.codex/skills', promptFile: '~/.codex/AGENTS.md' },
  { id: 'gemini', name: 'Gemini CLI', short: 'Gemini', dir: '~/.gemini',
    mcpPath: '~/.gemini/settings.json', mcpFormat: 'json',
    skillsDir: '~/.gemini/skills', promptFile: '~/.gemini/GEMINI.md' },
  { id: 'grok', name: 'Grok Build', short: 'Grok', dir: '~/.grok',
    mcpPath: '~/.grok/config.toml', mcpFormat: 'toml',
    skillsDir: '~/.grok/skills', promptFile: '~/.grok/AGENTS.md' },
  { id: 'opencode', name: 'OpenCode', short: 'OpenCode', dir: '~/.config/opencode',
    mcpPath: '~/.config/opencode/opencode.json', mcpFormat: 'json',
    skillsDir: '~/.config/opencode/skills', promptFile: '~/.config/opencode/AGENTS.md' },
  { id: 'hermes', name: 'Hermes', short: 'Hermes', dir: '~/.hermes',
    mcpPath: '~/.hermes/config.yaml', mcpFormat: 'yaml',
    skillsDir: '~/.hermes/skills', promptFile: '~/.hermes/SOUL.md' }
]

export interface ResolvedAgentPaths {
  mcpPath: string
  skillsDir: string
  promptFile: string
  root: string
}

/** 「~ 风格模板」展开为绝对路径（模板内用 / 分隔，node:path 负责 Windows 规范化） */
function expandHome(template: string, home: string): string {
  return template.startsWith('~')
    ? path.join(home, template.slice(1).replace(/^[/\\]+/, ''))
    : template
}

/** 模板相对 agent.dir 的偏移；不在 dir 下时原样返回（如 claude 的 ~/.claude.json） */
function relToDir(agent: AgentInfo, key: 'mcpPath'): string {
  const t = agent[key]
  return t.startsWith(agent.dir + '/') ? t.slice(agent.dir.length + 1) : t
}

/**
 * 解析 agent 三类落点的真实绝对路径。
 * 覆盖 = 根目录替换（全局约束第 10 条）：root=覆盖目录，MCP/Skills/提示词按相对结构拼接。
 * claude 特例（对齐 cc-switch config.rs:171-184）：默认 MCP 落点 ~/.claude.json 在配置目录外；
 * 覆盖后 MCP 落点 = <覆盖>/.claude.json（文件移入覆盖目录，保留原文件名）。
 */
export function resolveAgentPaths(
  agentId: AgentId,
  overrides: Partial<Record<AgentId, string>>,
  env: HomeEnv = process.env
): ResolvedAgentPaths {
  const agent = AGENTS.find((a) => a.id === agentId)
  if (!agent) throw new Error(`未知 agent id：${agentId}`)
  const home = resolveHome(env)
  const override = overrides[agentId]
  if (override) {
    const root = path.resolve(override)
    const skillsDir = path.join(root, 'skills')
    const promptFile = path.join(root, path.basename(agent.promptFile))
    const mcpPath =
      agentId === 'claude'
        ? path.join(root, '.claude.json')
        : path.join(root, relToDir(agent, 'mcpPath'))
    return { mcpPath, skillsDir, promptFile, root }
  }
  const root = expandHome(agent.dir, home)
  const skillsDir = expandHome(agent.skillsDir, home)
  const promptFile = expandHome(agent.promptFile, home)
  const mcpPath = expandHome(agent.mcpPath, home)
  return { mcpPath, skillsDir, promptFile, root }
}

/** Agent Skills 共享目录根 <home>/.agents（标准位置固定，不提供目录覆盖） */
export function agentsSharedRoot(env: HomeEnv = process.env): string {
  return path.join(resolveHome(env), '.agents')
}

/** Agent Skills 共享 skills 目录 <home>/.agents/skills */
export function agentsSharedSkillsDir(env: HomeEnv = process.env): string {
  return path.join(agentsSharedRoot(env), 'skills')
}

/**
 * Skills 部署目标目录解析：'shared' -> ~/.agents/skills（不支持目录覆盖）；
 * harness id -> resolveAgentPaths().skillsDir（dirOverrides 生效）。
 */
export function resolveSkillsTargetDir(
  targetId: SkillTargetId,
  overrides: Partial<Record<AgentId, string>>,
  env: HomeEnv = process.env
): string {
  if (targetId === 'shared') return agentsSharedSkillsDir(env)
  return resolveAgentPaths(targetId, overrides, env).skillsDir
}
