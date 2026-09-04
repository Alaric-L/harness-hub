// src/main/services/prompts.ts —— v2：saved 命名库 + live 指令文件运行时快照
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { AGENTS, dataFile, fileBackupDir, resolveAgentPaths, settingsFile } from '../paths'
import { atomicWrite, backupFile } from '../safety'
import { loadSettings, loadStore, saveStore } from '../store'
import type { HomeEnv } from '../paths'
import type { AgentId, AppSettings, PromptItem, PromptSnapshot } from '../types'

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

function backupDirFor(settings: AppSettings, base: string): string {
  return settings.backupBeforeWrite ? base : path.join(base, '.disabled')
}

function newPromptId(): string {
  return randomUUID().slice(0, 8)
}

function isNotFound(err: unknown): boolean {
  if (!(err instanceof Error) || !('code' in err)) return false
  return (err as { code?: string }).code === 'ENOENT'
}

async function writePromptFile(
  filePath: string,
  content: string,
  backupBase: string,
  settings: AppSettings
): Promise<void> {
  await backupFile(filePath, backupDirFor(settings, backupBase))
  await atomicWrite(filePath, content)
}

function normalizePrompt(raw: PromptItem): PromptItem {
  const p = raw as PromptItem & { enabled?: unknown }
  return {
    id: p.id,
    name: p.name,
    ...(p.desc !== undefined ? { desc: p.desc } : {}),
    content: p.content,
    createdAt: p.createdAt || p.updatedAt || 0,
    updatedAt: p.updatedAt ?? 0
  }
}

async function readLiveState(filePath: string): Promise<{
  exists: boolean
  content: string
  mtime: number | null
}> {
  try {
    const [content, stat] = await Promise.all([
      fs.readFile(filePath, 'utf8'),
      fs.stat(filePath)
    ])
    return { exists: true, content, mtime: stat.mtimeMs }
  } catch (err) {
    if (isNotFound(err)) return { exists: false, content: '', mtime: null }
    throw err
  }
}

export function listPrompts(agentId: AgentId, ctx?: PromptCtx): PromptItem[] {
  const c = ctxOf(ctx)
  return (loadStore(c.dataFile).prompts[agentId] ?? []).map(normalizePrompt)
}

export async function savePrompt(
  agentId: AgentId,
  item: PromptItem,
  ctx?: PromptCtx
): Promise<PromptItem[]> {
  const c = ctxOf(ctx)
  const data = loadStore(c.dataFile)
  const list = (data.prompts[agentId] ?? []).map(normalizePrompt)
  const idx = list.findIndex((p) => p.id === item.id)
  const now = Date.now()

  if (idx < 0) {
    list.push({
      id: newPromptId(),
      name: item.name,
      desc: item.desc,
      content: item.content,
      createdAt: now,
      updatedAt: now
    })
  } else {
    list[idx] = {
      ...list[idx],
      name: item.name,
      desc: item.desc,
      content: item.content,
      updatedAt: now
    }
  }

  data.prompts[agentId] = list
  await saveStore(c.dataFile, data)
  return list
}

export async function deletePrompt(
  agentId: AgentId,
  id: string,
  ctx?: PromptCtx
): Promise<PromptItem[]> {
  const c = ctxOf(ctx)
  const data = loadStore(c.dataFile)
  const list = (data.prompts[agentId] ?? []).map(normalizePrompt)
  const idx = list.findIndex((p) => p.id === id)
  if (idx < 0) throw new Error(`提示词不存在：${id}`)

  list.splice(idx, 1)
  data.prompts[agentId] = list
  await saveStore(c.dataFile, data)
  return list
}

function uniqueCopyName(list: PromptItem[], base: string): string {
  if (!list.some((p) => p.name === base)) return base
  let n = 2
  while (list.some((p) => p.name === `${base} (${n})`)) n++
  return `${base} (${n})`
}

export async function copyPrompt(
  agentId: AgentId,
  id: string,
  targets: AgentId[],
  ctx?: PromptCtx
): Promise<{ copiedTo: AgentId[] }> {
  const c = ctxOf(ctx)
  const data = loadStore(c.dataFile)
  const source = (data.prompts[agentId] ?? []).map(normalizePrompt).find((p) => p.id === id)
  if (!source) throw new Error(`提示词不存在：${id}`)

  const copiedTo: AgentId[] = []
  for (const target of targets) {
    if (target === agentId || copiedTo.includes(target)) continue
    if (!AGENTS.some((a) => a.id === target)) continue
    const list = (data.prompts[target] ?? []).map(normalizePrompt)
    const now = Date.now()
    list.push({
      id: newPromptId(),
      name: uniqueCopyName(list, source.name),
      desc: source.desc,
      content: source.content,
      createdAt: now,
      updatedAt: now
    })
    data.prompts[target] = list
    copiedTo.push(target)
  }

  if (copiedTo.length > 0) await saveStore(c.dataFile, data)
  return { copiedTo }
}

export async function getPromptSnapshot(
  agentId: AgentId,
  ctx?: PromptCtx
): Promise<PromptSnapshot> {
  const c = ctxOf(ctx)
  const data = loadStore(c.dataFile)
  const settings = loadSettings(c.settingsFile)
  const prompts = (data.prompts[agentId] ?? []).map(normalizePrompt)
  const r = resolveAgentPaths(agentId, settings.dirOverrides, c.env)
  const live = await readLiveState(r.promptFile)
  const matchedIds = prompts.filter((p) => p.content === live.content).map((p) => p.id)

  return {
    prompts,
    live: {
      agentId,
      path: r.promptFile,
      exists: live.exists,
      content: live.content,
      mtime: live.mtime,
      matchedIds
    }
  }
}

export async function saveLivePrompt(
  agentId: AgentId,
  content: string,
  ctx?: PromptCtx
): Promise<PromptSnapshot> {
  const c = ctxOf(ctx)
  const settings = loadSettings(c.settingsFile)
  const r = resolveAgentPaths(agentId, settings.dirOverrides, c.env)
  await writePromptFile(r.promptFile, content, c.backupDir, settings)
  return getPromptSnapshot(agentId, ctx)
}

export async function applyPrompt(
  agentId: AgentId,
  id: string,
  ctx?: PromptCtx
): Promise<PromptSnapshot> {
  const c = ctxOf(ctx)
  const data = loadStore(c.dataFile)
  const settings = loadSettings(c.settingsFile)
  const list = (data.prompts[agentId] ?? []).map(normalizePrompt)
  const target = list.find((p) => p.id === id)
  if (!target) throw new Error(`提示词不存在：${id}`)

  const r = resolveAgentPaths(agentId, settings.dirOverrides, c.env)
  await writePromptFile(r.promptFile, target.content, c.backupDir, settings)
  return getPromptSnapshot(agentId, ctx)
}
