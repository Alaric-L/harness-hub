// src/main/services/skills.ts —— Skill 部署：将 <ssotDir>/<skillDir> 部署到 <targetDir>/<skillDir>
// symlink 优先、失败回退 copy（对齐 cc-switch skill.rs sync_to_app_dir:2241 / remove_path:2318 /
// replace_dest_with_copy:2351）。Windows 用 junction 创建目录联接（无需管理员权限），
// 且 fs.lstatSync().isSymbolicLink() 对 junction 亦返回 true——检测/清理与 symlink 完全兼容。
import fs from 'node:fs/promises'
import path from 'node:path'
import { AGENTS, dataFile, resolveSkillsTargetDir, settingsFile, skillBackupsDir, ssotSkillsDir } from '../paths'
import type { HomeEnv } from '../paths'
import { loadSettings, loadStore, saveStore } from '../store'
import type { StoreData } from '../store'
import { parseSkillMd } from '../skillmd'
import type { SkillInstalled, SkillTargetId } from '../types'
import { assertSkillTargetRoot } from './agent-root'

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

/**
 * 单个 skill 的部署/移除语义（ipc 的 toggleSkill 与 bulkToggleSkill 共用；错误由调用方聚合）。
 * 'shared' 目标部署到 <home>/.agents/skills（写入前检查 <home>/.agents 存在）；不落库——
 * 调用方负责 saveStore。
 */
export async function toggleSkillOne(
  data: StoreData,
  entry: SkillInstalled,
  targetId: SkillTargetId,
  on: boolean,
  ctx?: SkillCtx
): Promise<void> {
  const c = resolveSkillCtx(ctx)
  entry.apps = entry.apps ?? {}
  const settings = loadSettings(c.settingsFile)
  // 部署前检查目标根目录存在（harness 查其最外层配置目录；shared 查 <home>/.agents）；关闭方向无需检查
  const skillsDir = on
    ? assertSkillTargetRoot(targetId, settings.dirOverrides, c.env)
    : resolveSkillsTargetDir(targetId, settings.dirOverrides, c.env)
  if (on) {
    await deploySkill(c.ssotDir, entry.dir, skillsDir, settings.syncMethod)
    entry.apps[targetId] = true
  } else {
    await undeploySkill(path.join(skillsDir, entry.dir))
    delete entry.apps[targetId]
  }
}

// ---- E2：卸载备份（结构对齐 cc-switch skill.rs:3490-3540，备份自描述不依赖库） ----

/** E2 依赖注入点：data.json / settings.json / SSOT 目录 / 备份根目录；缺省走真实 home */
export interface SkillCtx {
  dataFile?: string
  settingsFile?: string
  ssotDir?: string
  backupsDir?: string
  env?: HomeEnv
}

export interface ResolvedSkillCtx {
  dataFile: string
  settingsFile: string
  ssotDir: string
  backupsDir: string
  env: HomeEnv
}

export function resolveSkillCtx(ctx?: SkillCtx): ResolvedSkillCtx {
  return {
    dataFile: ctx?.dataFile ?? dataFile(),
    settingsFile: ctx?.settingsFile ?? settingsFile(),
    ssotDir: ctx?.ssotDir ?? ssotSkillsDir(),
    backupsDir: ctx?.backupsDir ?? skillBackupsDir(),
    env: ctx?.env ?? process.env
  }
}

/** skill 目录名净化：非字母数字下划线横线替换为 _（对齐 cc-switch slug 语义） */
export function sanitizeSkillDirName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_')
}

/** 本地时间 -> yyyyMMdd_HHmmss（备份目录名前缀；任务文档 E2 要求 '_' 分隔） */
function timestamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  )
}

/** 备份 id：<yyyyMMdd_HHmmss>_<slug>；同秒撞名追加 _1、_2…… */
async function nextBackupId(backupsDir: string, slug: string): Promise<string> {
  const ts = timestamp()
  let id = `${ts}_${slug}`
  let n = 1
  while (await pathExists(path.join(backupsDir, id))) {
    id = `${ts}_${slug}_${n}`
    n++
  }
  return id
}

/** 备份保留上限（对齐 cc-switch SKILL_BACKUP_RETAIN_COUNT） */
const SKILL_BACKUP_RETAIN_COUNT = 20

/** 按 mtime 淘汰最旧，仅保留最近 20 份备份目录；备份根不存在时 no-op */
async function pruneSkillBackups(backupsDir: string): Promise<void> {
  let entries
  try {
    entries = await fs.readdir(backupsDir, { withFileTypes: true })
  } catch (err) {
    if (isNotFound(err)) return
    throw err
  }
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(backupsDir, e.name))
  if (dirs.length <= SKILL_BACKUP_RETAIN_COUNT) return
  const statted = await Promise.all(
    dirs.map(async (p) => ({ p, mtimeMs: (await fs.stat(p)).mtimeMs }))
  )
  statted.sort((a, b) => b.mtimeMs - a.mtimeMs || (a.p < b.p ? 1 : -1))
  for (const { p } of statted.slice(SKILL_BACKUP_RETAIN_COUNT)) {
    await fs.rm(p, { recursive: true, force: true })
  }
}

/**
 * E2 卸载：从所有启用 harness 移除部署 -> 备份 SSOT 目录到
 * <backupsDir>/<yyyyMMdd_HHmmss>_<slug>/skill/ + meta.json（{name, desc, repo, backupCreatedAt, sourceDir, apps}）
 * -> 删 SSOT 目录与库条目。settings.skillUninstallBackup=false 时直接删 SSOT（不产备份）。
 */
export async function uninstallSkill(dir: string, ctx?: SkillCtx): Promise<SkillInstalled[]> {
  const c = resolveSkillCtx(ctx)
  const data = loadStore(c.dataFile)
  const entry = data.skills.find((s) => s.dir === dir)
  if (!entry) throw new Error(`skill not found: ${dir}`)
  const settings = loadSettings(c.settingsFile)
  const source = path.join(c.ssotDir, dir)

  // 1. 从所有启用目标（harness 或共享目录）移除部署
  for (const targetId of Object.keys(entry.apps ?? {}) as SkillTargetId[]) {
    if (entry.apps[targetId]) {
      await undeploySkill(path.join(resolveSkillsTargetDir(targetId, settings.dirOverrides, c.env), dir))
    }
  }

  // 2. 备份（开关开启时）：复制 SSOT -> 备份 skill/ + meta.json，随后按上限淘汰
  if (settings.skillUninstallBackup) {
    const md = parseSkillMd(source)
    const backupDir = path.join(c.backupsDir, await nextBackupId(c.backupsDir, sanitizeSkillDirName(dir)))
    await fs.mkdir(path.join(backupDir, 'skill'), { recursive: true })
    await fs.cp(source, path.join(backupDir, 'skill'), { recursive: true })
    await fs.writeFile(
      path.join(backupDir, 'meta.json'),
      JSON.stringify(
        {
          name: md?.name ?? entry.name,
          desc: md?.desc ?? entry.desc,
          repo: entry.repo,
          backupCreatedAt: Date.now(),
          sourceDir: dir,
          apps: entry.apps ?? {}
        },
        null,
        2
      ),
      'utf8'
    )
    await pruneSkillBackups(c.backupsDir)
  }

  // 3. 删 SSOT 目录与库条目
  await fs.rm(source, { recursive: true, force: true })
  data.skills = data.skills.filter((s) => s.dir !== dir)
  await saveStore(c.dataFile, data)
  return data.skills
}