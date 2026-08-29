// src/main/services/skill-io.ts —— E2：Skill 备份列表/恢复/删除、ZIP 安装、从 harness 导入
// 备份结构对齐 cc-switch skill.rs:3490-3540：<backupsDir>/<backupId>/skill/ + meta.json（自描述，不依赖 data.json；
// 导入导出数据后备份列表仍有效）；backupId 校验拒绝路径穿越（backup_path_for_id）；
// ZIP 安装限制条目数（5000）并拒绝 ../ 与绝对路径条目（对齐 cc-switch 教训）。
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { unzipSync } from 'fflate'
import { assertAgentRoot } from './agent-root'
import { AGENTS, resolveAgentPaths } from '../paths'
import type { HomeEnv } from '../paths'
import { loadSettings, loadStore, saveStore } from '../store'
import { parseSkillMd } from '../skillmd'
import { deploySkill, resolveSkillCtx, sanitizeSkillDirName } from './skills'
import type { SkillCtx } from './skills'
import type { AgentId, SkillBackup, SkillInstalled, UnmanagedSkill } from '../types'

/** ENOENT/ENOTDIR 才视为不存在，其余错误原样上抛 */
function isNotFound(err: unknown): boolean {
  if (!(err instanceof Error) || !('code' in err)) return false
  const code = (err as { code?: string }).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/** lstat 判路径是否存在（symlink/junction 亦计入） */
async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.lstat(p)
    return true
  } catch (err) {
    if (isNotFound(err)) return false
    throw err
  }
}

/** 读备份目录 meta.json；缺失 / 坏 JSON / 非对象一律返回 null（listSkillBackups 跳过该目录） */
function readBackupMeta(backupDir: string): Record<string, unknown> | null {
  let raw: string
  try {
    raw = fs.readFileSync(path.join(backupDir, 'meta.json'), 'utf8')
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/** backupId 校验：拒绝空、'.'、含 '..' 与路径分隔符（防路径穿越，对齐 cc-switch backup_path_for_id） */
function assertSafeBackupId(backupId: string): void {
  if (
    !backupId ||
    backupId === '.' ||
    backupId.includes('..') ||
    backupId.includes('/') ||
    backupId.includes('\\')
  ) {
    throw new Error(`invalid backup id: ${backupId}`)
  }
}

/** 扫磁盘：各备份目录的 meta.json（自描述，不依赖库）；坏 meta / 非目录跳过；按 createdAt 倒序 */
export function listSkillBackups(ctx?: SkillCtx): SkillBackup[] {
  const c = resolveSkillCtx(ctx)
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(c.backupsDir, { withFileTypes: true })
  } catch (err) {
    if (isNotFound(err)) return []
    throw err
  }
  const out: SkillBackup[] = []
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const backupDir = path.join(c.backupsDir, ent.name)
    const meta = readBackupMeta(backupDir)
    if (!meta) continue
    const sourceDir = typeof meta.sourceDir === 'string' ? meta.sourceDir : ent.name
    out.push({
      backupId: ent.name,
      name: typeof meta.name === 'string' ? meta.name : sourceDir,
      dir: sourceDir,
      desc: typeof meta.desc === 'string' ? meta.desc : '',
      createdAt:
        typeof meta.backupCreatedAt === 'number'
          ? meta.backupCreatedAt
          : fs.statSync(backupDir).mtimeMs,
      path: backupDir
    })
  }
  out.sort((a, b) => b.createdAt - a.createdAt)
  return out
}

/**
 * 恢复备份：校验 backupId -> 备份 skill/ 子目录复制回 SSOT -> 依 meta.json 重建库条目；
 * deploy=true 时按 meta.apps 部署（meta 无 apps 字段则只恢复不部署）；SSOT 已存在同名时拒绝。
 */
export async function restoreSkillBackup(
  backupId: string,
  deploy: boolean,
  ctx?: SkillCtx
): Promise<SkillBackup[]> {
  const c = resolveSkillCtx(ctx)
  assertSafeBackupId(backupId)
  const backupDir = path.join(c.backupsDir, backupId)
  const meta = readBackupMeta(backupDir)
  if (!meta) throw new Error(`backup not found: ${backupId}`)
  const dir = typeof meta.sourceDir === 'string' && meta.sourceDir ? meta.sourceDir : null
  if (!dir) throw new Error(`backup meta missing sourceDir: ${backupId}`)
  const dest = path.join(c.ssotDir, dir)
  if (await pathExists(dest)) throw new Error(`skill already exists: ${dir}`)

  // 预检：恢复且部署时，所有要部署的 harness 配置目录必须存在（任一缺失则整单拒绝，不产生任何写入）
  const deployApps: Partial<Record<AgentId, boolean>> =
    deploy && typeof meta.apps === 'object' && meta.apps !== null && !Array.isArray(meta.apps)
      ? (meta.apps as Partial<Record<AgentId, boolean>>)
      : {}
  const settings = loadSettings(c.settingsFile)
  for (const agentId of Object.keys(deployApps) as AgentId[]) {
    if (deployApps[agentId]) assertAgentRoot(agentId, settings.dirOverrides, c.env)
  }

  await fsp.cp(path.join(backupDir, 'skill'), dest, { recursive: true })

  const md = parseSkillMd(dest)
  const data = loadStore(c.dataFile)
  data.skills.push({
    dir,
    name: md?.name ?? (typeof meta.name === 'string' ? meta.name : dir),
    desc: md?.desc ?? (typeof meta.desc === 'string' ? meta.desc : ''),
    repo: typeof meta.repo === 'string' ? meta.repo : null,
    hasUpdate: false,
    apps: deployApps
  })
  await saveStore(c.dataFile, data)

  if (deploy) {
    for (const agentId of Object.keys(deployApps) as AgentId[]) {
      if (deployApps[agentId]) {
        const r = resolveAgentPaths(agentId, settings.dirOverrides, c.env)
        await deploySkill(c.ssotDir, dir, r.skillsDir, settings.syncMethod)
      }
    }
  }
  return listSkillBackups(ctx)
}

/** 删除备份：校验 backupId 后 rm -rf 备份目录；返回最新备份列表 */
export async function deleteSkillBackup(backupId: string, ctx?: SkillCtx): Promise<SkillBackup[]> {
  const c = resolveSkillCtx(ctx)
  assertSafeBackupId(backupId)
  await fsp.rm(path.join(c.backupsDir, backupId), { recursive: true, force: true })
  return listSkillBackups(ctx)
}

/** ZIP 条目数上限（任务文档 E2/E3：5000） */
const MAX_ZIP_ENTRIES = 5000

/** zip 条目名校验：拒绝绝对路径（/、\、盘符前缀）与含 '..' 段的条目 */
function assertSafeZipEntry(name: string): void {
  if (/^[A-Za-z]:[\\/]/.test(name) || name.startsWith('/') || name.startsWith('\\')) {
    throw new Error(`非法的 zip 路径（绝对路径）：${name}`)
  }
  if (name.split(/[\\/]/).includes('..')) {
    throw new Error(`非法的 zip 路径（路径穿越）：${name}`)
  }
}

/**
 * ZIP 安装：fflate 解压（条目上限 5000、拒绝 ../ 与绝对路径）-> 取含 SKILL.md 的目录
 * （zip 根或单层子目录；多候选拒绝）-> 复制入 SSOT -> 入库（repo=null、apps 全 false）。
 * zipPath 由调用方传入（G 块 dialog 选文件后调用本函数）。zip 内 symlink 条目经 fflate 物化为实际内容。
 */
export async function installSkillZip(zipPath: string, ctx?: SkillCtx): Promise<SkillInstalled[]> {
  const c = resolveSkillCtx(ctx)
  let buf: Buffer
  try {
    buf = await fsp.readFile(zipPath)
  } catch (err) {
    throw new Error(`无法读取 zip：${zipPath}（${(err as Error).message}）`)
  }
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(new Uint8Array(buf))
  } catch (err) {
    throw new Error(`zip 解压失败：${(err as Error).message}`)
  }
  const names = Object.keys(files)
  if (names.length === 0) throw new Error('zip 为空')
  if (names.length > MAX_ZIP_ENTRIES) throw new Error(`zip 条目数超出上限 ${MAX_ZIP_ENTRIES}`)
  for (const name of names) assertSafeZipEntry(name)

  // 定位含 SKILL.md 的目录：zip 根优先；否则单层子目录恰有一个直接含 SKILL.md
  let skillRoot: string | null = null
  const rootHasSkill = names.some(
    (n) => n.replace(/\\/g, '/').replace(/^\.\//, '') === 'SKILL.md'
  )
  if (!rootHasSkill) {
    const candidates = new Set<string>()
    for (const n of names) {
      const parts = n.replace(/\\/g, '/').split('/').filter((s) => s !== '' && s !== '.')
      if (parts.length >= 2 && parts[1] === 'SKILL.md') candidates.add(parts[0])
    }
    const sorted = [...candidates].sort()
    if (sorted.length === 0) throw new Error('zip 中未找到 SKILL.md')
    if (sorted.length > 1) throw new Error(`zip 含多个 skill 目录：${sorted.join(', ')}`)
    skillRoot = sorted[0]
  }

  const stem = sanitizeSkillDirName(path.basename(zipPath).replace(/\.zip$/i, ''))
  const dirName = skillRoot ?? (stem || 'skill')
  const destRoot = path.join(c.ssotDir, dirName)
  if (await pathExists(destRoot)) throw new Error(`skill 已存在：${dirName}`)
  await fsp.mkdir(destRoot, { recursive: true })

  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/') || name.endsWith('\\')) continue // 目录条目
    let rel: string
    if (skillRoot) {
      const slash = skillRoot + '/'
      const back = skillRoot + '\\'
      if (name.startsWith(slash)) rel = name.slice(slash.length)
      else if (name.startsWith(back)) rel = name.slice(back.length)
      else continue // skill 目录之外的杂项条目不复制
    } else {
      rel = name.replace(/^[\\/]+/, '')
    }
    const target = path.join(destRoot, rel)
    if (!target.startsWith(destRoot + path.sep)) {
      throw new Error(`非法的 zip 路径：${name}`)
    }
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, data)
  }

  const md = parseSkillMd(destRoot)
  const data = loadStore(c.dataFile)
  data.skills.push({
    dir: dirName,
    name: md?.name ?? dirName,
    desc: md?.desc ?? '',
    repo: null,
    hasUpdate: false,
    apps: {}
  })
  await saveStore(c.dataFile, data)
  return data.skills
}

/**
 * 扫描各 harness skillsDir：有 SKILL.md 且不在库中的目录；同一 dir 在多个 harness 出现时合并 foundIn
 * （path 取第一个命中的 harness 源路径）。
 */
export function listUnmanagedSkills(ctx?: SkillCtx): UnmanagedSkill[] {
  const c = resolveSkillCtx(ctx)
  const settings = loadSettings(c.settingsFile)
  const known = new Set(loadStore(c.dataFile).skills.map((s) => s.dir))
  const found = new Map<string, { agents: AgentId[]; path: string }>()
  for (const agent of AGENTS) {
    const r = resolveAgentPaths(agent.id, settings.dirOverrides, c.env)
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(r.skillsDir, { withFileTypes: true })
    } catch (err) {
      if (isNotFound(err)) continue
      throw err
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      const dir = ent.name
      if (known.has(dir)) continue
      const skillPath = path.join(r.skillsDir, dir)
      if (!parseSkillMd(skillPath)) continue // 无 SKILL.md -> 非 skill
      const rec = found.get(dir) ?? { agents: [], path: skillPath }
      rec.agents.push(agent.id)
      found.set(dir, rec)
    }
  }
  const out: UnmanagedSkill[] = []
  for (const [dir, rec] of found) {
    const md = parseSkillMd(rec.path)
    out.push({ dir, name: md?.name ?? dir, desc: md?.desc ?? '', foundIn: rec.agents, path: rec.path })
  }
  out.sort((a, b) => a.dir.localeCompare(b.dir))
  return out
}

/** 在 7 个 harness skillsDir 中定位 dir 的源路径（第一个命中；无则 null） */
async function findSourceDir(
  dir: string,
  overrides: Partial<Record<AgentId, string>>,
  env: HomeEnv
): Promise<string | null> {
  for (const agent of AGENTS) {
    const r = resolveAgentPaths(agent.id, overrides, env)
    const skillPath = path.join(r.skillsDir, dir)
    try {
      if ((await fsp.stat(skillPath)).isDirectory() && parseSkillMd(skillPath)) return skillPath
    } catch (err) {
      if (isNotFound(err)) continue
      throw err
    }
  }
  return null
}

/**
 * 从 harness 导入：将 items（{dir, apps}）对应源目录复制入 SSOT -> 入库（apps 按选择）-> 按 apps 部署。
 * 源目录以当前磁盘扫描定位；找不到 / 已入库 / SSOT 已存在同名时抛错。
 */
export async function importSkills(
  items: { dir: string; apps: Partial<Record<AgentId, boolean>> }[],
  ctx?: SkillCtx
): Promise<SkillInstalled[]> {
  const c = resolveSkillCtx(ctx)
  const settings = loadSettings(c.settingsFile)
  const data = loadStore(c.dataFile)
  const known = new Set(data.skills.map((s) => s.dir))
  for (const item of items) {
    if (known.has(item.dir)) throw new Error(`skill 已在库中：${item.dir}`)
    if (await pathExists(path.join(c.ssotDir, item.dir))) {
      throw new Error(`skill 已存在：${item.dir}`)
    }
  }
  // 预检：所有要部署的 harness 配置目录必须存在（任一缺失则整批拒绝，对齐「目录不存在不导入并提示」）
  const deployTargets = new Set<AgentId>()
  for (const item of items) {
    for (const agentId of Object.keys(item.apps ?? {}) as AgentId[]) {
      if (item.apps[agentId]) deployTargets.add(agentId)
    }
  }
  for (const agentId of deployTargets) assertAgentRoot(agentId, settings.dirOverrides, c.env)
  for (const item of items) {
    const source = await findSourceDir(item.dir, settings.dirOverrides, c.env)
    if (!source) throw new Error(`未找到 skill 源目录：${item.dir}`)
    const dest = path.join(c.ssotDir, item.dir)
    await fsp.cp(source, dest, { recursive: true })
    const md = parseSkillMd(dest)
    data.skills.push({
      dir: item.dir,
      name: md?.name ?? item.dir,
      desc: md?.desc ?? '',
      repo: null,
      hasUpdate: false,
      apps: item.apps ?? {}
    })
  }
  await saveStore(c.dataFile, data)
  for (const item of items) {
    for (const agentId of Object.keys(item.apps ?? {}) as AgentId[]) {
      if (item.apps[agentId]) {
        const r = resolveAgentPaths(agentId, settings.dirOverrides, c.env)
        await deploySkill(c.ssotDir, item.dir, r.skillsDir, settings.syncMethod)
      }
    }
  }
  return data.skills
}