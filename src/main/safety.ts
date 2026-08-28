// src/main/safety.ts —— 写 harness 配置文件共用的安全原语（备份 + 原子写入）
import fs from 'node:fs/promises'
import path from 'node:path'

/** 本地时间 -> yyyyMMdd-HHmmss（补零，供备份文件名时间戳段） */
function timestamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  )
}

/** 目标不存在（ENOENT）才返回 true；其余错误原样上抛 */
function isNotFound(err: unknown): boolean {
  if (!(err instanceof Error) || !('code' in err)) return false
  return (err as { code?: string }).code === 'ENOENT'
}

/**
 * 目标存在才备份：内容写入 <backupDir>/<basename>.<yyyyMMdd-HHmmss>.bak。
 * backupDir 不存在则递归创建；目标不存在返回 null（不创建任何东西）。
 */
export async function backupFile(
  filePath: string,
  backupDir: string
): Promise<string | null> {
  let content: string
  try {
    content = await fs.readFile(filePath, 'utf8')
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
  await fs.mkdir(backupDir, { recursive: true })
  const backupPath = path.join(backupDir, `${path.basename(filePath)}.${timestamp()}.bak`)
  await fs.writeFile(backupPath, content, 'utf8')
  return backupPath
}

/**
 * 原子写入：0) 父目录不存在则递归创建（对齐 cc-switch write_text_file）；
 * 1) 写 <path>.tmp；2) validate(content) 抛错则删 tmp 并上抛（原文件不动）；
 * 3) fs.rename 替换；4) 任何失败路径都确保清理 tmp。
 */
export async function atomicWrite(
  filePath: string,
  content: string,
  validate?: (s: string) => void
): Promise<void> {
  const tmpPath = filePath + '.tmp'
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(tmpPath, content, 'utf8')
    if (validate) validate(content)
    await fs.rename(tmpPath, filePath)
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {})
    throw err
  }
}
