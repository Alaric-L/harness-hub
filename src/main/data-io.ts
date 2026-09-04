// src/main/data-io.ts —— G4 数据导入导出核心逻辑（组装 / 校验 / 导入前快照 / 覆盖写回）
// 纯函数 + 显式路径参数，供 ipc.ts 与单测复用；dialog 交互留在 ipc 层（人工验证路径）。
import fs from 'node:fs/promises'
import path from 'node:path'
import { saveSettings, saveStore } from './store'
import type { StoreData } from './store'
import type { AppSettings } from './types'

/** 导出/导入的单 JSON 备份结构；导入可接受历史 v1，导出固定 v2 */
export interface ExportPayload {
  version: 1 | 2
  exportedAt: string
  data: StoreData
  settings: AppSettings
}

function normalizePromptData(data: StoreData): StoreData {
  const prompts = data.prompts ?? ({} as StoreData['prompts'])
  const normalized = Object.fromEntries(
    Object.entries(prompts).map(([agentId, items]) => [
      agentId,
      (Array.isArray(items) ? items : []).map((item) => {
        const legacy = item as typeof item & { enabled?: unknown }
        const { enabled: _ignored, ...rest } = legacy
        return {
          ...rest,
          createdAt: rest.createdAt ?? rest.updatedAt ?? 0
        }
      })
    ])
  ) as StoreData['prompts']
  return { ...data, prompts: normalized }
}

export function buildExportPayload(
  data: StoreData,
  settings: AppSettings,
  now: Date = new Date()
): ExportPayload {
  return { version: 2, exportedAt: now.toISOString(), data, settings }
}

/**
 * 解析并校验备份文件文本：version 为 1 或 2 且 data/settings 均为对象；不合法抛可读错误。
 * 纯校验，不触碰任何磁盘数据（校验通过后由调用方决定快照与覆盖）。
 */
export function validateBackup(raw: string): ExportPayload {
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch (err) {
    throw new Error(`备份文件不是合法 JSON：${(err as Error).message}`)
  }
  const o = obj as Partial<ExportPayload>
  if (!o || typeof o !== 'object' || Array.isArray(o)) {
    throw new Error('备份文件格式错误：应为 JSON 对象')
  }
  if (o.version !== 1 && o.version !== 2) {
    throw new Error(`备份文件版本不支持：${String(o.version)}（当前支持 1、2）`)
  }
  if (!o.data || typeof o.data !== 'object' || Array.isArray(o.data)) {
    throw new Error('备份文件缺少 data 字段')
  }
  if (!o.settings || typeof o.settings !== 'object' || Array.isArray(o.settings)) {
    throw new Error('备份文件缺少 settings 字段')
  }
  return {
    version: o.version,
    exportedAt: typeof o.exportedAt === 'string' ? o.exportedAt : new Date().toISOString(),
    data: normalizePromptData(o.data as StoreData),
    settings: o.settings as AppSettings
  }
}

/** 本地时间 -> yyyyMMdd-HHmmss（导入前快照时间戳段，与 safety.ts 同格式） */
export function snapshotTimestamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/**
 * 导入前快照：把 dataFile/settingsFile 复制为 <backupDir>/data-<ts>.preimport.bak 与
 * settings-<ts>.preimport.bak（任务文档 G4 命名）。源文件不存在则跳过该项（不创建空快照）。
 * 返回实际生成的快照路径列表。
 */
export async function snapshotBeforeImport(
  dataFile: string,
  settingsFile: string,
  backupDir: string,
  now: Date = new Date()
): Promise<string[]> {
  const ts = snapshotTimestamp(now)
  const sources: Array<[string, string]> = [
    [dataFile, 'data'],
    [settingsFile, 'settings']
  ]
  // 先收集存在的源内容，无任何可备份项则不创建备份目录（与 safety.backupFile 一致）
  const pending: Array<[string, string]> = []
  for (const [src, name] of sources) {
    let content: string
    try {
      content = await fs.readFile(src, 'utf8')
    } catch (err) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw err
    }
    pending.push([name, content])
  }
  if (pending.length === 0) return []
  await fs.mkdir(backupDir, { recursive: true })
  const made: string[] = []
  for (const [name, content] of pending) {
    const target = path.join(backupDir, `${name}-${ts}.preimport.bak`)
    await fs.writeFile(target, content, 'utf8')
    made.push(target)
  }
  return made
}

/**
 * 覆盖写回 dataFile/settingsFile（走 saveStore/saveSettings：原子写入 + JSON 回验）。
 * 仅在导入校验通过且快照完成后调用。
 */
export async function applyImport(
  payload: ExportPayload,
  dataFile: string,
  settingsFile: string
): Promise<void> {
  await saveStore(dataFile, payload.data)
  await saveSettings(settingsFile, payload.settings)
}
