// src/main/store.ts —— data.json / settings.json 的读写与默认值（纯函数，路径由调用方传入）
import fs from 'node:fs'
import { atomicWrite } from './safety'
import type { AgentId, AppSettings, McpItem, PromptItem, RepoConfig, SkillInstalled } from './types'

/** ~/.harness-hub/data.json 内容（统一数据模型） */
export interface StoreData {
  version: 1
  mcpItems: McpItem[]
  skills: SkillInstalled[]
  prompts: Record<AgentId, PromptItem[]>
  skillRepos: RepoConfig[]
}

/** ENOENT 才视为"文件不存在"，其余错误原样上抛 */
function isNotFound(err: unknown): boolean {
  if (!(err instanceof Error) || !('code' in err)) return false
  return (err as { code?: string }).code === 'ENOENT'
}

function defaultStore(): StoreData {
  return {
    version: 1,
    mcpItems: [],
    skills: [],
    prompts: {
      dsh: [],
      claude: [],
      codex: [],
      gemini: [],
      grok: [],
      opencode: [],
      hermes: []
    },
    skillRepos: []
  }
}

function defaultSettings(): AppSettings {
  return {
    dirOverrides: {},
    syncMethod: 'symlink',
    backupBeforeWrite: true,
    skillUninstallBackup: true
  }
}

/**
 * 读 data.json：不存在返回默认结构；坏 JSON 抛含文件名的错误（不静默覆盖）。
 */
export function loadStore(dataFile: string): StoreData {
  let raw: string
  try {
    raw = fs.readFileSync(dataFile, 'utf8')
  } catch (err) {
    if (isNotFound(err)) return defaultStore()
    throw err
  }
  try {
    return JSON.parse(raw) as StoreData
  } catch (err) {
    throw new Error(`无法解析 ${dataFile}：${(err as Error).message}`)
  }
}

/**
 * 写 data.json：atomicWrite + JSON.parse 回验（写入无效 JSON 时原文件不动）。
 */
export async function saveStore(dataFile: string, data: StoreData): Promise<void> {
  await atomicWrite(dataFile, JSON.stringify(data, null, 2), (s) => {
    JSON.parse(s)
  })
}

/**
 * 读 settings.json：不存在返回默认；坏 JSON 抛含文件名的错误。
 */
export function loadSettings(file: string): AppSettings {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (err) {
    if (isNotFound(err)) return defaultSettings()
    throw err
  }
  try {
    return JSON.parse(raw) as AppSettings
  } catch (err) {
    throw new Error(`无法解析 ${file}：${(err as Error).message}`)
  }
}

/**
 * 写 settings.json：atomicWrite + JSON.parse 回验。
 */
export async function saveSettings(file: string, s: AppSettings): Promise<void> {
  await atomicWrite(file, JSON.stringify(s, null, 2), (content) => {
    JSON.parse(content)
  })
}