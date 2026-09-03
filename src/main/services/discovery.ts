// src/main/services/discovery.ts —— E3：发现页（GitHub 仓库 / skills.sh）+ 仓库管理 + 更新检测
// 语义对齐 cc-switch services/skill.rs：
// - 仓库列表/安装/更新共用同一下载管线：https://github.com/{owner}/{name}/archive/refs/heads/{branch}.zip
//   无需 token；归档根统一 <repo>-<sha>/，解压时剥掉（extract_repo_archive:3244）
// - 坐标校验（validate_repo_ref:2910）：owner=字母数字+'-'（过滤非 GitHub 来源）、
//   name=字母数字+'._-'、branch 按段白名单（防 URL 拼接收写）
// - skills.sh 搜索（search_skills_sh:3942）：/api/search?q=&limit=&offset=，
//   响应 {skills:[{id, skillId, name, installs, source}]}，source=owner/repo 拆坐标并校验过滤
// - 更新比对：重拉仓库 zip 后按安装名匹配 skill 目录，目录整体内容哈希不同 -> hasUpdate
// 安全约束：zip 解压条目上限 5000、拒绝 ../ 与绝对路径条目、临时目录用完清理（对齐 E2 skill-io）
// 可测性：下载/解压/扫描/比对拆为「可注入路径」纯函数；网络请求用 Node 全局 fetch（Node 24 内置）。
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { unzipSync } from 'fflate'
import { resolveSkillsTargetDir } from '../paths'
import { assertSkillTargetRoot } from './agent-root'
import { loadSettings, loadStore, saveStore } from '../store'
import { parseSkillMd } from '../skillmd'
import { deploySkill, resolveSkillCtx, sanitizeSkillDirName } from './skills'
import type { SkillCtx } from './skills'
import type { SkillTargetId, RepoConfig, SkillInstalled } from '../types'

// ---- 类型 ----

/** 仓库中发现的可安装 skill（返回给前端） */
export interface DiscoveredSkill {
  key: string          // 'owner/name:directory'
  name: string
  desc: string
  directory: string    // 仓库内相对路径（正斜杠）
  repo: string         // 'owner/name'
}

/** skills.sh 搜索结果条目：key=id、directory=skillId、repo=source（契约字段 desc 保留为空串） */
export interface SkillsShItem {
  key: string
  name: string
  desc: string
  directory: string
  repo: string
  installs: number
}

/** zip 条目数上限（对齐 E2/E3：5000） */
export const MAX_ZIP_ENTRIES = 5000

// ---- 坐标校验（纯函数） ----

/** GitHub owner：字母数字与 '-' 且 ≤39（GitHub 用户名/组织不含点——带点 owner 即非 GitHub 来源） */
const OWNER_RE = /^[A-Za-z0-9-]{1,39}$/
/** GitHub 仓库名：字母数字与 '._-' 且 ≤100（含点合法），整体不能是 '.' 或 '..' */
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/

/**
 * 仓库坐标校验（对齐 cc-switch validate_repo_ref:2910）。三个字段都会被拼进
 * github.com 下载 URL，任何逃逸字符都可能改写请求落点，这里按段白名单堵死。
 */
export function validateRepoRef(owner: string, name: string, branch: string): void {
  if (!OWNER_RE.test(owner)) {
    throw new Error(`invalid repo owner: ${owner}`)
  }
  if (!NAME_RE.test(name) || name === '.' || name === '..') {
    throw new Error(`invalid repo name: ${name}`)
  }
  // branch 合法含 '/'（feature/x），按段做 git ref 校验（空串/HEAD 是"默认分支"哨兵）
  if (branch === '' || branch.toLowerCase() === 'HEAD') return
  if (branch.length > 255 || branch.startsWith('/') || branch.endsWith('/') || branch.includes('//')) {
    throw new Error(`invalid repo branch: ${branch}`)
  }
  if (branch.includes('@{')) {
    throw new Error(`invalid repo branch: ${branch}`)
  }
  if (branch.split('').some((c) => c <= '\u001f' || c === '\u007f' || ' ~^:?*[\\#%'.includes(c))) {
    throw new Error(`invalid repo branch: ${branch}`)
  }
  const segments = branch.split('/')
  if (segments.some((s) => !s || s.startsWith('.') || s.endsWith('.') || s.endsWith('.lock'))) {
    throw new Error(`invalid repo branch: ${branch}`)
  }
}

/**
 * 解析仓库 URL：接受 https://github.com/{owner}/{repo}（含 .git 后缀、尾斜杠）
 * 或 {owner}/{repo} 简写；拆出 owner/name 并做坐标校验（非法 URL / 非法字符即抛错）。
 */
export function parseRepoUrl(input: string): { owner: string; name: string } {
  const raw = (input ?? '').trim()
  let cleaned = raw.replace(/^https?:\/\/github\.com\//, '')
  cleaned = cleaned.replace(/^github\.com\//, '')
  cleaned = cleaned.replace(/\.git$/, '')
  cleaned = cleaned.replace(/\/+$/, '')
  const parts = cleaned.split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`invalid repo url: ${raw}`)
  }
  const [owner, name] = parts
  validateRepoRef(owner, name, 'main')
  return { owner, name }
}

// ---- skills.sh 响应解析（纯函数） ----

/**
 * 解析 /api/search 响应。source 必须为 'owner/repo' 且通过坐标校验
 * （带点/多段的非 GitHub 来源被过滤，对齐 cc-switch search_skills_sh:3971）。
 */
export function parseSkillsShResponse(json: unknown): SkillsShItem[] {
  if (!json || typeof json !== 'object') return []
  const root = json as { skills?: unknown }
  if (!Array.isArray(root.skills)) return []
  const out: SkillsShItem[] = []
  for (const raw of root.skills) {
    if (!raw || typeof raw !== 'object') continue
    const s = raw as Record<string, unknown>
    const id = typeof s.id === 'string' ? s.id : ''
    const skillId = typeof s.skillId === 'string' ? s.skillId : ''
    const name = typeof s.name === 'string' ? s.name : ''
    const installs = typeof s.installs === 'number' ? s.installs : 0
    const source = typeof s.source === 'string' ? s.source : ''
    const parts = source.split('/')
    if (parts.length !== 2) continue
    const [owner, repoName] = parts
    try {
      validateRepoRef(owner, repoName, 'main')
    } catch {
      continue // 非 GitHub 来源过滤
    }
    if (!id || !skillId) continue
    out.push({ key: id, name, desc: '', directory: skillId, repo: source, installs })
  }
  return out
}

// ---- zip 安全解压（纯函数，不碰网络） ----

/** 条目名校验：拒绝绝对路径（/、\、盘符前缀）与含 '..' 段的条目 */
function assertSafeZipEntry(name: string): void {
  if (/^[A-Za-z]:[\\/]/.test(name) || name.startsWith('/') || name.startsWith('\\')) {
    throw new Error(`非法的 zip 路径（绝对路径）：${name}`)
  }
  if (name.split(/[\\/]/).includes('..')) {
    throw new Error(`非法的 zip 路径（路径穿越）：${name}`)
  }
}

/** 安全解压：条目数上限 5000、拒绝 ../ 与绝对路径；返回 name -> 内容 映射 */
export function unzipZipSafe(buf: Uint8Array): Record<string, Uint8Array> {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(buf)
  } catch (err) {
    throw new Error(`zip 解压失败：${(err as Error).message}`)
  }
  const names = Object.keys(files)
  if (names.length === 0) throw new Error('zip 为空')
  if (names.length > MAX_ZIP_ENTRIES) throw new Error(`zip 条目数超出上限 ${MAX_ZIP_ENTRIES}`)
  for (const name of names) assertSafeZipEntry(name)
  return files
}

/** ENOENT/ENOTDIR 才视为不存在 */
function isNotFound(err: unknown): boolean {
  if (!(err instanceof Error) || !('code' in err)) return false
  const code = (err as { code?: string }).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.lstat(p)
    return true
  } catch (err) {
    if (isNotFound(err)) return false
    throw err
  }
}

/**
 * 将仓库归档解压到 destDir（剥掉归档自带的一层 <repo>-<sha>/ 根目录，对齐
 * cc-switch extract_repo_archive:3244）。根名取首个条目的第一段，不在根下的条目跳过。
 */
export async function extractRepoArchiveToDir(buf: Uint8Array, destDir: string): Promise<void> {
  const files = unzipZipSafe(buf)
  const names = Object.keys(files)
  const rootName = names[0].split(/[\\/]/)[0] ?? ''
  await fsp.mkdir(destDir, { recursive: true })
  for (const name of names) {
    if (name.endsWith('/') || name.endsWith('\\')) continue // 目录条目
    const parts = name.split(/[\\/]/)
    if (parts[0] !== rootName) continue // 根目录之外的杂项条目不落盘
    const rel = parts.slice(1).join(path.sep)
    if (!rel) continue
    const target = path.join(destDir, rel)
    if (!target.startsWith(destDir + path.sep)) {
      throw new Error(`非法的 zip 路径：${name}`)
    }
    await fsp.mkdir(path.dirname(target), { recursive: true })
    await fsp.writeFile(target, files[name])
  }
}

// ---- 仓库 skill 扫描 / 源目录解析（纯函数，可注入路径） ----

/**
 * 递归扫描含 SKILL.md 的 skill 目录（含 SKILL.md 即视为 skill，不再下钻）。
 * directory 为相对仓库根的正斜杠路径；仓库根本身是 skill 时用仓库名（对齐
 * cc-switch scan_dir_recursive:2646 / build_skill_from_metadata:2694）。
 */
export function scanRepoSkills(rootDir: string, owner: string, name: string): DiscoveredSkill[] {
  const out: DiscoveredSkill[] = []
  const walk = (dir: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (err) {
      if (isNotFound(err)) return
      throw err
    }
    if (entries.some((e) => e.isFile() && e.name === 'SKILL.md')) {
      const directory =
        dir === rootDir
          ? name
          : path.relative(rootDir, dir).split(path.sep).join('/')
      const md = parseSkillMd(dir)
      out.push({
        key: `${owner}/${name}:${directory}`,
        name: md?.name ?? directory,
        desc: md?.desc ?? '',
        directory,
        repo: `${owner}/${name}`
      })
      return
    }
    for (const ent of entries) {
      if (ent.isDirectory()) walk(path.join(dir, ent.name))
    }
  }
  walk(rootDir)
  return out
}

/** 递归按名字查找含 SKILL.md 的目录（深度 ≤3、跳过隐藏目录，对齐 cc-switch find_skill_dir_by_name:2952） */
function findSkillDirByName(rootDir: string, target: string, depth: number): string | null {
  if (depth > 3) return null
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true })
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue
    const full = path.join(rootDir, ent.name)
    if (ent.name.toLowerCase() === target.toLowerCase() && fs.existsSync(path.join(full, 'SKILL.md'))) {
      return full
    }
  }
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue
    const found = findSkillDirByName(path.join(rootDir, ent.name), target, depth + 1)
    if (found) return found
  }
  return null
}

/**
 * 在解压出的仓库目录中定位目标 skill 源目录（对齐 cc-switch resolve_skill_source_dir:2986）：
 * 1. 直接相对路径命中（校验含 SKILL.md）；
 * 2. 按安装名（末段）递归查找；
 * 3. 兜底：仓库根本身含 SKILL.md。
 * 穿越/绝对路径一律返回 null。
 */
export function resolveSkillSourceDir(rootDir: string, spec: string): string | null {
  const cleaned = spec.replace(/\\/g, '/').replace(/^\.\//, '')
  if (
    !cleaned ||
    cleaned.startsWith('/') ||
    /^[A-Za-z]:\//.test(cleaned) ||
    cleaned.split('/').includes('..') ||
    cleaned.includes('//')
  ) {
    return null
  }
  // 1. 直接相对路径命中（校验含 SKILL.md；不中则继续走名字递归，对齐 cc-switch:2986）
  const direct = path.join(rootDir, ...cleaned.split('/'))
  if (fs.existsSync(path.join(direct, 'SKILL.md'))) return direct
  // 2. 按安装名递归查找
  const installName = cleaned.split('/').pop()
  if (installName) {
    const found = findSkillDirByName(rootDir, installName, 0)
    if (found) return found
  }
  // 3. 仓库根兜底
  if (fs.existsSync(path.join(rootDir, 'SKILL.md'))) return rootDir
  return null
}

// ---- 更新比对（纯函数：目录整体内容哈希） ----

/** 递归收集相对路径 -> sha256 内容摘要（路径排序保证确定性）；目录缺失返回 null */
export function computeDirHash(dir: string): string | null {
  const rels: string[] = []
  const walk = (cur: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true })
    } catch (err) {
      if (isNotFound(err)) return
      throw err
    }
    for (const ent of entries) {
      const full = path.join(cur, ent.name)
      if (ent.isDirectory()) walk(full)
      else rels.push(path.relative(dir, full).split(path.sep).join('/'))
    }
  }
  try {
    if (!fs.statSync(dir).isDirectory()) return null
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
  walk(dir)
  rels.sort()
  const h = createHash('sha256')
  for (const rel of rels) {
    const content = fs.readFileSync(path.join(dir, ...rel.split('/')))
    h.update(rel).update('\0').update(content).update('\0')
  }
  return h.digest('hex')
}

/** 两个目录内容是否不同（任一缺失视作不同，对齐 cc-switch local_hash None != Some） */
export function dirsDiffer(dirA: string, dirB: string): boolean {
  return computeDirHash(dirA) !== computeDirHash(dirB)
}

// ---- 仓库管理（store 操作） ----

export function listRepos(ctx?: SkillCtx): RepoConfig[] {
  const c = resolveSkillCtx(ctx)
  return loadStore(c.dataFile).skillRepos
}

/** 添加仓库：URL 解析 + 坐标/branch 校验；同 owner/name 已存在时仅更新 branch */
export async function addRepo(url: string, branch: string, ctx?: SkillCtx): Promise<RepoConfig[]> {
  const c = resolveSkillCtx(ctx)
  const { owner, name } = parseRepoUrl(url)
  const b = (branch ?? '').trim() || 'main'
  validateRepoRef(owner, name, b)
  const data = loadStore(c.dataFile)
  const existing = data.skillRepos.find((r) => r.owner === owner && r.name === name)
  if (existing) {
    existing.branch = b
  } else {
    data.skillRepos.push({ owner, name, branch: b })
  }
  await saveStore(c.dataFile, data)
  return data.skillRepos
}

export async function removeRepo(owner: string, name: string, ctx?: SkillCtx): Promise<RepoConfig[]> {
  const c = resolveSkillCtx(ctx)
  const data = loadStore(c.dataFile)
  data.skillRepos = data.skillRepos.filter((r) => !(r.owner === owner && r.name === name))
  await saveStore(c.dataFile, data)
  return data.skillRepos
}

// ---- 下载管线（内部核心，供列表/安装/更新复用；网络失败抛可读错误） ----

const DOWNLOAD_TIMEOUT_MS = 30_000

/**
 * 下载仓库归档 zip 并解压到临时目录（剥掉 <repo>-<sha>/ 根），返回临时目录绝对路径。
 * 调用方负责用 fs.rm(recursive) 清理。branch 为 'HEAD'/空时按 main -> master 回退。
 */
async function downloadRepoZip(owner: string, name: string, branch: string): Promise<string> {
  validateRepoRef(owner, name, branch)
  const candidates: string[] = []
  if (branch && branch.toLowerCase() !== 'HEAD') candidates.push(branch)
  if (!candidates.includes('main')) candidates.push('main')
  if (!candidates.includes('master')) candidates.push('master')

  let lastErr: Error | null = null
  for (const b of candidates) {
    const url = `https://github.com/${owner}/${name}/archive/refs/heads/${b}.zip`
    let resp: Response
    try {
      resp = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
    } catch (err) {
      lastErr = err as Error
      continue
    }
    if (!resp.ok) {
      lastErr = new Error(`HTTP ${resp.status}`)
      continue
    }
    const buf = new Uint8Array(await resp.arrayBuffer())
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'harnesshub-repo-'))
    try {
      await extractRepoArchiveToDir(buf, tmpDir)
      return tmpDir
    } catch (err) {
      await fsp.rm(tmpDir, { recursive: true, force: true })
      lastErr = err as Error
    }
  }
  throw new Error(`仓库下载失败 ${owner}/${name}：${lastErr?.message ?? '未知错误'}`)
}

// ---- 发现 ----

/**
 * 列出所有仓库内的 skill。单仓库失败跳过并记录可读错误（不崩）；
 * errors 供渲染层 toast 展示（不抛异常）。
 */
export async function listDiscoveryRepos(ctx?: SkillCtx): Promise<{ skills: DiscoveredSkill[]; errors: string[] }> {
  const c = resolveSkillCtx(ctx)
  const repos = loadStore(c.dataFile).skillRepos
  const skills: DiscoveredSkill[] = []
  const errors: string[] = []
  for (const repo of repos) {
    let tmpDir: string | null = null
    try {
      tmpDir = await downloadRepoZip(repo.owner, repo.name, repo.branch || 'main')
      skills.push(...scanRepoSkills(tmpDir, repo.owner, repo.name))
    } catch (err) {
      errors.push(`${repo.owner}/${repo.name}：${(err as Error).message}`)
    } finally {
      if (tmpDir) await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  }
  return { skills, errors }
}

/** 搜索 skills.sh 公共目录：GET /api/search?q=&limit=&offset=，返回解析后的条目 */
export async function searchSkillsSh(q: string): Promise<SkillsShItem[]> {
  const url = `https://skills.sh/api/search?q=${encodeURIComponent(q)}&limit=50&offset=0`
  let resp: Response
  try {
    resp = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  } catch (err) {
    throw new Error(`skills.sh 请求失败：${(err as Error).message}`)
  }
  if (!resp.ok) {
    throw new Error(`skills.sh 请求失败（HTTP ${resp.status}）`)
  }
  let json: unknown
  try {
    json = await resp.json()
  } catch (err) {
    throw new Error(`skills.sh 响应解析失败：${(err as Error).message}`)
  }
  return parseSkillsShResponse(json)
}

// ---- 安装（仓库 / skills.sh） ----

/**
 * 安装核心：把解压出的仓库目录中的目标 skill 复制入 SSOT 并入库（repo=owner/name、
 * apps 全 false、hasUpdate false）。extractedDir 为可注入路径（单测用伪造目录）。
 */
export async function installSkillFromRepoDir(
  extractedDir: string,
  owner: string,
  name: string,
  skillDir: string,
  ctx?: SkillCtx
): Promise<SkillInstalled[]> {
  const c = resolveSkillCtx(ctx)
  const source = resolveSkillSourceDir(extractedDir, skillDir)
  if (!source) throw new Error(`未找到 skill 目录：${skillDir}`)
  const installName = sanitizeSkillDirName(path.basename(source))
  const destRoot = path.join(c.ssotDir, installName)
  if (await pathExists(destRoot)) throw new Error(`skill 已存在：${installName}`)
  await fsp.mkdir(path.dirname(destRoot), { recursive: true })
  await fsp.cp(source, destRoot, { recursive: true })

  const md = parseSkillMd(destRoot)
  const data = loadStore(c.dataFile)
  data.skills.push({
    dir: installName,
    name: md?.name ?? installName,
    desc: md?.desc ?? '',
    repo: `${owner}/${name}`,
    hasUpdate: false,
    apps: {}
  })
  await saveStore(c.dataFile, data)
  return data.skills
}

/** 仓库安装：下载 zip（branch 缺省 main）-> 解压 -> 目标 skill 目录复制入 SSOT */
export async function installSkillFromRepo(
  owner: string,
  name: string,
  branch: string,
  skillDir: string,
  ctx?: SkillCtx
): Promise<SkillInstalled[]> {
  validateRepoRef(owner, name, branch || 'main')
  const tmpDir = await downloadRepoZip(owner, name, branch || 'main')
  try {
    return await installSkillFromRepoDir(tmpDir, owner, name, skillDir, ctx)
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true })
  }
}

/**
 * skills.sh 安装：key=skills.sh id（形状 {owner}/{repo}/{skillId}）、repo=source。
 * skillId 由 key 去 repo 前缀推导；随后走仓库 zip 同一流程（对齐 cc-switch，key=id、目录名=skillId）。
 */
export async function installSkillFromSh(
  key: string,
  repo: string,
  ctx?: SkillCtx
): Promise<SkillInstalled[]> {
  const parts = repo.split('/')
  if (parts.length !== 2) throw new Error(`invalid repo: ${repo}`)
  const [owner, name] = parts
  validateRepoRef(owner, name, 'main')
  const skillId = key.startsWith(repo + '/') ? key.slice(repo.length + 1) : key
  if (!skillId) throw new Error(`invalid skill key: ${key}`)
  return installSkillFromRepo(owner, name, 'main', skillId, ctx)
}

// ---- 更新检测 / 更新 ----

/**
 * 更新检测：对库中 repo!=null 的 skill，按 (owner, name) 分组重拉仓库 zip，
 * 依安装名匹配 skill 目录并整目录内容比对（不同 -> hasUpdate:true）。
 * 网络失败的分组跳过（该组 skill 不标可更新）；返回更新后的列表（不落库）。
 */
export async function checkSkillUpdates(ctx?: SkillCtx): Promise<SkillInstalled[]> {
  const c = resolveSkillCtx(ctx)
  const data = loadStore(c.dataFile)
  const repos = data.skillRepos

  // 按 repo 字符串分组（branch 优先取 skillRepos 配置，缺省 main）
  const groups = new Map<string, SkillInstalled[]>()
  for (const skill of data.skills) {
    if (!skill.repo || !skill.repo.includes('/')) continue
    const [owner, name] = skill.repo.split('/')
    const branch = repos.find((r) => r.owner === owner && r.name === name)?.branch || 'main'
    const key = `${owner}/${name}:${branch}`
    const list = groups.get(key) ?? []
    list.push(skill)
    groups.set(key, list)
  }

  const flagged = new Map<string, boolean>()
  for (const [groupKey, group] of groups) {
    const [owner, name, branch] = groupKey.split(':')
    let tmpDir: string | null = null
    try {
      tmpDir = await downloadRepoZip(owner, name, branch)
      const remote = scanRepoSkills(tmpDir, owner, name)
      for (const skill of group) {
        const installName = skill.dir.split(/[\\/]/).pop()?.toLowerCase()
        const match = remote.find(
          (r) => r.directory.split('/').pop()?.toLowerCase() === installName
        )
        if (!match) continue
        const source = resolveSkillSourceDir(tmpDir, match.directory)
        if (!source) continue
        if (dirsDiffer(path.join(c.ssotDir, skill.dir), source)) {
          flagged.set(skill.dir, true)
        }
      }
    } catch {
      // 网络失败：跳过该分组，不标可更新
    } finally {
      if (tmpDir) await fsp.rm(tmpDir, { recursive: true, force: true })
    }
  }

  return data.skills.map((s) => ({ ...s, hasUpdate: flagged.get(s.dir) ?? s.hasUpdate }))
}

/**
 * 更新核心：用解压出的仓库内容整体覆盖 SSOT 对应目录，并重新部署到已启用目标（harness 或共享目录）
 * （调 E1 deploySkill）。extractedDir 为可注入路径（单测用伪造目录）。
 */
export async function updateSkillFromExtractedDir(
  dir: string,
  extractedDir: string,
  ctx?: SkillCtx
): Promise<SkillInstalled[]> {
  const c = resolveSkillCtx(ctx)
  const data = loadStore(c.dataFile)
  const entry = data.skills.find((s) => s.dir === dir)
  if (!entry) throw new Error(`skill not found: ${dir}`)

  const remote = scanRepoSkills(extractedDir, '', '')
  const installName = dir.split(/[\\/]/).pop()?.toLowerCase()
  const match = remote.find((r) => r.directory.split('/').pop()?.toLowerCase() === installName)
  if (!match) throw new Error(`未找到 skill 目录：${dir}`)
  const source = resolveSkillSourceDir(extractedDir, match.directory)
  if (!source) throw new Error(`未找到 skill 目录：${dir}`)

  // 预检：所有已启用部署目标（harness 或共享目录）的根目录必须存在（任一缺失则拒绝更新，SSOT 不做任何改动）
  const settings = loadSettings(c.settingsFile)
  for (const targetId of Object.keys(entry.apps ?? {}) as SkillTargetId[]) {
    if (entry.apps[targetId]) assertSkillTargetRoot(targetId, settings.dirOverrides, c.env)
  }

  // 覆盖 SSOT 目录
  const destRoot = path.join(c.ssotDir, dir)
  await fsp.rm(destRoot, { recursive: true, force: true })
  await fsp.mkdir(path.dirname(destRoot), { recursive: true })
  await fsp.cp(source, destRoot, { recursive: true })

  const md = parseSkillMd(destRoot)
  entry.name = md?.name ?? entry.name
  entry.desc = md?.desc ?? entry.desc
  entry.hasUpdate = false
  await saveStore(c.dataFile, data)

  // 重新部署到已启用部署目标（harness 或共享目录）
  for (const targetId of Object.keys(entry.apps ?? {}) as SkillTargetId[]) {
    if (entry.apps[targetId]) {
      await deploySkill(
        c.ssotDir,
        dir,
        resolveSkillsTargetDir(targetId, settings.dirOverrides, c.env),
        settings.syncMethod
      )
    }
  }
  return data.skills
}

/** 更新单个 skill：重拉仓库 zip 覆盖 SSOT + 重新部署到已启用目标（harness 或共享目录） */
export async function updateSkill(dir: string, ctx?: SkillCtx): Promise<SkillInstalled[]> {
  const c = resolveSkillCtx(ctx)
  const data = loadStore(c.dataFile)
  const entry = data.skills.find((s) => s.dir === dir)
  if (!entry) throw new Error(`skill not found: ${dir}`)
  if (!entry.repo || !entry.repo.includes('/')) {
    throw new Error(`本地安装的 skill 无法更新：${dir}`)
  }
  const [owner, name] = entry.repo.split('/')
  const branch = data.skillRepos.find((r) => r.owner === owner && r.name === name)?.branch || 'main'
  const tmpDir = await downloadRepoZip(owner, name, branch)
  try {
    return await updateSkillFromExtractedDir(dir, tmpDir, ctx)
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true })
  }
}