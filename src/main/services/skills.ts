// src/main/services/skills.ts —— Skill 部署：将 <ssotDir>/<skillDir> 部署到 <targetDir>/<skillDir>
// symlink 优先、失败回退 copy（对齐 cc-switch skill.rs sync_to_app_dir:2241 / remove_path:2318 /
// replace_dest_with_copy:2351）。Windows 用 junction 创建目录联接（无需管理员权限），
// 且 fs.lstatSync().isSymbolicLink() 对 junction 亦返回 true——检测/清理与 symlink 完全兼容。
import fs from 'node:fs/promises'
import path from 'node:path'

export type DeployMethod = 'auto' | 'symlink' | 'copy'
export type DeployResult = 'symlink' | 'copy'

/** ENOENT/ENOTDIR 才视为不存在，其余错误原样上抛 */
function isNotFound(err: unknown): boolean {
  if (!(err instanceof Error) || !('code' in err)) return false
  const code = (err as { code?: string }).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/** lstat 判路径是否存在（symlink/junction 亦计入） */
async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p)
    return true
  } catch (err) {
    if (isNotFound(err)) return false
    throw err
  }
}

/** lstat 判是否为符号链接（Windows junction 的 isSymbolicLink() 亦为 true） */
async function isLink(p: string): Promise<boolean> {
  try {
    return (await fs.lstat(p)).isSymbolicLink()
  } catch (err) {
    if (isNotFound(err)) return false
    throw err
  }
}

/** 删除任意形态目标（symlink/junction/实体目录/文件）；不存在则 no-op（对齐 cc-switch remove_path:2318） */
async function removePath(p: string): Promise<void> {
  await fs.rm(p, { recursive: true, force: true })
}

/** 创建目录链接：Windows 用 junction（无需管理员权限），POSIX 用 dir；目标统一绝对路径 */
async function createLink(source: string, dest: string): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true })
  const type = process.platform === 'win32' ? 'junction' : 'dir'
  await fs.symlink(path.resolve(source), dest, type)
}

/**
 * 复制替换：先递归复制到同父目录临时名，再删目标并 rename（对齐 cc-switch replace_dest_with_copy:2351）；
 * 任一步失败都清理临时目录后上抛，目标目录不被半覆盖。
 */
async function copyDirReplace(source: string, dest: string): Promise<void> {
  const parent = path.dirname(dest)
  await fs.mkdir(parent, { recursive: true })
  const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const stage = path.join(parent, `.${path.basename(dest)}.tmp-${nonce}`)
  try {
    await fs.cp(source, stage, { recursive: true })
    if (await pathExists(dest)) await removePath(dest)
    await fs.rename(stage, dest)
  } catch (err) {
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {})
    throw err
  }
}

/** 先删再建 symlink；创建失败回退 copy 并返回实际方式 */
async function linkOrCopy(source: string, dest: string): Promise<DeployResult> {
  try {
    await createLink(source, dest)
    return 'symlink'
  } catch {
    await removePath(dest) // 清除可能残留的半建链接
    await copyDirReplace(source, dest)
    return 'copy'
  }
}

/**
 * 将 <ssotDir>/<skillDir> 部署到 <targetDir>/<skillDir>，返回实际方式 'symlink'|'copy'。
 * - auto：目标已是实体目录 -> 复制替换；目标已是 symlink/junction -> 先删再建；
 *   新建优先 symlink，失败回退 copy（对齐 cc-switch skill.rs:2266-2293）
 * - symlink：强制链接（失败上抛，不回退，对齐 cc-switch:2295-2301）
 * - copy：强制复制替换（对齐 cc-switch:2302-2305）
 */
export async function deploySkill(
  ssotDir: string,
  skillDir: string,
  targetDir: string,
  method: DeployMethod
): Promise<DeployResult> {
  const source = path.join(ssotDir, skillDir)
  const dest = path.join(targetDir, skillDir)
  switch (method) {
    case 'auto': {
      // 实体目录 -> 复制替换
      if ((await pathExists(dest)) && !(await isLink(dest))) {
        await copyDirReplace(source, dest)
        return 'copy'
      }
      // symlink/junction 或不存在 -> 先删再建，失败回退 copy
      if (await isLink(dest)) await removePath(dest)
      return linkOrCopy(source, dest)
    }
    case 'symlink': {
      if (await pathExists(dest)) await removePath(dest)
      await createLink(source, dest)
      return 'symlink'
    }
    case 'copy': {
      await copyDirReplace(source, dest)
      return 'copy'
    }
  }
}

/** 移除部署目标：symlink/junction 或实体目录均可（判 lstat 后 fs.rm recursive）；不存在则 no-op */
export async function undeploySkill(targetDir: string): Promise<void> {
  if (!(await pathExists(targetDir))) return
  await fs.rm(targetDir, { recursive: true, force: true })
}