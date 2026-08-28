// src/main/services/prompts.ts —— F1: 提示词库 + 激活（含 live 回填）
// 库存于 store.data.prompts[agentId]（PromptItem[]，每条单状态 enabled）；
// 激活 = 整文件写入指令文件，激活前把 live 内容回填到原激活条目（无激活条目时创建「原始提示词」备份条目）。
// 对齐 cc-switch prompt.rs：upsert_prompt:64-98 / enable_prompt:116-191 / delete_prompt:100-114。
// 路径可通过 PromptCtx 注入（单测指向临时目录），默认取 <home>/.harness-hub。
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { dataFile, fileBackupDir, resolveAgentPaths, settingsFile } from '../paths'
import { atomicWrite, backupFile } from '../safety'
import { loadSettings, loadStore, saveStore } from '../store'
import type { HomeEnv } from '../paths'
import type { AgentId, AppSettings, PromptItem } from '../types'

/** 依赖注入点：单测传入临时目录（data.json / settings.json / 备份根）；缺省走真实 home */
export interface PromptCtx {
  dataFile?: string
  settingsFile?: string
  backupDir?: string
  env?: HomeEnv
}

function ctxOf(ctx?: PromptCtx): Required<Pick<PromptCtx, 'dataFile' | 'settingsFile' | 'backupDir' | 'env'>> {
  return {
    dataFile: ctx?.dataFile ?? dataFile(),
    settingsFile: ctx?.settingsFile ?? settingsFile(),
    backupDir: ctx?.backupDir ?? fileBackupDir(),
    env: ctx?.env ?? process.env
  }
}

/** backupBeforeWrite 关闭时备份落点改到隐藏子目录（与 McpCtx 同套路） */
function backupDirFor(settings: AppSettings, base: string): string {
  return settings.backupBeforeWrite ? base : path.join(base, '.disabled')
}

/** 新条目 id：crypto.randomUUID() 截断为前 8 位 */
function newPromptId(): string {
  return randomUUID().slice(0, 8)
}

/** 本地时间 yyyy-MM-dd HH:mm（备份条目名用） */
function localTime(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function isNotFound(err: unknown): boolean {
  if (!(err instanceof Error) || !('code' in err)) return false
  return (err as { code?: string }).code === 'ENOENT'
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** 读指令文件 live 内容；不存在返回空串（其余错误上抛） */
async function readLiveFile(p: string): Promise<string> {
  try {
    return await fs.readFile(p, 'utf8')
  } catch (err) {
    if (isNotFound(err)) return ''
    throw err
  }
}

/** 写前备份 + 原子写入（对齐 cc-switch write_text_file + 本项目 backupFile 语义） */
async function writePromptFile(filePath: string, content: string, backupBase: string, settings: AppSettings): Promise<void> {
  await backupFile(filePath, backupDirFor(settings, backupBase))
  await atomicWrite(filePath, content)
}

/** 返回指定 harness 的提示词库 */
export function listPrompts(agentId: AgentId, ctx?: PromptCtx): PromptItem[] {
  const c = ctxOf(ctx)
  return loadStore(c.dataFile).prompts[agentId] ?? []
}

/**
 * 新增/编辑。
 * 新增：enabled 强制 false（对齐 cc-switch 保存语义）、id=randomUUID 截断、updatedAt=now；
 * 编辑：保留 id 刷新 updatedAt；enabled=true 时保存后立即写入指令文件（cc-switch upsert_prompt:79-82）。
 */
export async function savePrompt(agentId: AgentId, item: PromptItem, ctx?: PromptCtx): Promise<PromptItem[]> {
  const c = ctxOf(ctx)
  const data = loadStore(c.dataFile)
  const settings = loadSettings(c.settingsFile)
  const list = data.prompts[agentId] ?? []
  const idx = list.findIndex((p) => p.id === item.id)

  if (idx < 0) {
    list.push({
      id: newPromptId(),
      name: item.name,
      desc: item.desc,
      content: item.content,
      enabled: false,
      updatedAt: Date.now()
    })
  } else {
    list[idx] = { ...item, updatedAt: Date.now() }
  }

  await saveStore(c.dataFile, data)

  if (idx >= 0 && item.enabled) {
    const r = resolveAgentPaths(agentId, settings.dirOverrides, c.env)
    await writePromptFile(r.promptFile, item.content, c.backupDir, settings)
  }

  return list
}

/**
 * 激活（含 live 回填，cc-switch enable_prompt:116-191）：
 * 1) 读指令文件 live 内容，非空时：库内有启用条目 -> 回填其 content+updatedAt；
 *    无启用条目且内容未存在于任何条目 -> 创建「原始提示词 <local time>」备份条目（enabled:false）；
 * 2) 全库 enabled=false、目标 true；
 * 3) writePromptFile(promptFile, 目标 content) -> 存库。
 */
export async function enablePrompt(agentId: AgentId, id: string, ctx?: PromptCtx): Promise<PromptItem[]> {
  const c = ctxOf(ctx)
  const data = loadStore(c.dataFile)
  const settings = loadSettings(c.settingsFile)
  const list = data.prompts[agentId] ?? []
  const target = list.find((p) => p.id === id)
  if (!target) throw new Error(`提示词不存在：${id}`)

  const r = resolveAgentPaths(agentId, settings.dirOverrides, c.env)
  const live = await readLiveFile(r.promptFile)

  if (live.trim() !== '') {
    const active = list.find((p) => p.enabled)
    if (active) {
      active.content = live
      active.updatedAt = Date.now()
    } else if (!list.some((p) => p.content.trim() === live.trim())) {
      list.push({
        id: newPromptId(),
        name: `原始提示词 ${localTime()}`,
        desc: '自动备份的原始提示词',
        content: live,
        enabled: false,
        updatedAt: Date.now()
      })
    }
  }

  for (const p of list) p.enabled = false
  const targetNow = list.find((p) => p.id === id)!
  targetNow.enabled = true

  await writePromptFile(r.promptFile, targetNow.content, c.backupDir, settings)
  await saveStore(c.dataFile, data)
  return list
}

/**
 * 停用当前启用条目：置 false 后若库中无其他启用条目则清空指令文件
 * （写空字符串，文件存在时；对齐 cc-switch upsert_prompt:83-94）。
 */
export async function disablePrompt(agentId: AgentId, ctx?: PromptCtx): Promise<PromptItem[]> {
  const c = ctxOf(ctx)
  const data = loadStore(c.dataFile)
  const settings = loadSettings(c.settingsFile)
  const list = data.prompts[agentId] ?? []
  const active = list.find((p) => p.enabled)
  if (active) active.enabled = false

  if (!list.some((p) => p.enabled)) {
    const r = resolveAgentPaths(agentId, settings.dirOverrides, c.env)
    if (await fileExists(r.promptFile)) {
      await writePromptFile(r.promptFile, '', c.backupDir, settings)
    }
  }

  await saveStore(c.dataFile, data)
  return list
}

/** 删除：启用中的条目抛错（对齐 cc-switch delete_prompt:106-110），其余直接移除 */
export async function deletePrompt(agentId: AgentId, id: string, ctx?: PromptCtx): Promise<PromptItem[]> {
  const c = ctxOf(ctx)
  const data = loadStore(c.dataFile)
  const list = data.prompts[agentId] ?? []
  const idx = list.findIndex((p) => p.id === id)
  if (idx < 0) throw new Error(`提示词不存在：${id}`)
  if (list[idx].enabled) throw new Error('无法删除已启用的提示词，请先停用')

  list.splice(idx, 1)
  await saveStore(c.dataFile, data)
  return list
}