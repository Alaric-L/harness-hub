// tests/discovery.test.ts —— E3：发现页（GitHub / skills.sh）+ 仓库管理 + 更新检测
// 单测只测纯逻辑（URL/坐标解析、skills.sh 响应解析、zip 解压安全、目录扫描/解析、
// 更新比对、仓库管理模式、extracted-dir 安装/更新核心），不发起真实网络。
// 网络路径（downloadRepoZip/listDiscoveryRepos/searchSkillsSh/checkSkillUpdates/
// updateSkill/installSkillFromRepo/installSkillFromSh）由 dev 模式人工验证（任务文档 E3 验收）。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { loadSettings, loadStore, saveSettings, saveStore } from '../src/main/store'
import type { AgentId, SkillInstalled } from '../src/main/types'
import type { SkillCtx } from '../src/main/services/skills'
import {
  addRepo,
  dirsDiffer,
  extractRepoArchiveToDir,
  installSkillFromRepoDir,
  listRepos,
  parseRepoUrl,
  parseSkillsShResponse,
  removeRepo,
  resolveSkillSourceDir,
  scanRepoSkills,
  unzipZipSafe,
  updateSkillFromExtractedDir,
  validateRepoRef
} from '../src/main/services/discovery'

const AGENT_IDS: AgentId[] = ['dsh', 'claude', 'codex', 'gemini', 'grok', 'opencode', 'zcode', 'hermes']

let tmp: string
let homes: string
let ssot: string
let dataPath: string
let settingsPath: string
let ctx: SkillCtx

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'discovery-'))
  homes = path.join(tmp, 'homes')
  ssot = path.join(tmp, 'ssot')
  dataPath = path.join(tmp, 'data.json')
  settingsPath = path.join(tmp, 'settings.json')
  const overrides: Partial<Record<AgentId, string>> = {}
  for (const id of AGENT_IDS) overrides[id] = path.join(homes, id)
  await saveSettings(settingsPath, {
    dirOverrides: overrides,
    syncMethod: 'copy',
    backupBeforeWrite: true,
    skillUninstallBackup: true
  })
  ctx = { dataFile: dataPath, settingsFile: settingsPath, ssotDir: ssot }
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

/** 构造带 frontmatter 的 skill 目录（含嵌套 scripts/run.js） */
async function makeSkill(base: string, dir: string, name: string, desc: string, marker = 'v1'): Promise<string> {
  const skill = path.join(base, dir)
  await fs.mkdir(skill, { recursive: true })
  await fs.writeFile(
    path.join(skill, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${desc}\n---\n# ${name}\n\nbody ${marker}`,
    'utf8'
  )
  await fs.mkdir(path.join(skill, 'scripts'), { recursive: true })
  await fs.writeFile(path.join(skill, 'scripts', 'run.js'), `console.log('${marker}')`, 'utf8')
  return skill
}

async function seed(items: SkillInstalled[]): Promise<void> {
  await saveStore(dataPath, {
    version: 1,
    mcpItems: [],
    skills: items,
    prompts: { dsh: [], claude: [], codex: [], gemini: [], grok: [], opencode: [], zcode: [], hermes: [] },
    skillRepos: []
  })
}

// ========== parseRepoUrl ==========

describe('parseRepoUrl', () => {
  it('https://github.com/owner/repo 拆出 owner/name', () => {
    expect(parseRepoUrl('https://github.com/obra/superpowers')).toEqual({ owner: 'obra', name: 'superpowers' })
  })

  it('owner/repo 简写同样拆出坐标', () => {
    expect(parseRepoUrl('obra/superpowers')).toEqual({ owner: 'obra', name: 'superpowers' })
  })

  it('带 .git 后缀时剥离', () => {
    expect(parseRepoUrl('https://github.com/obra/superpowers.git')).toEqual({ owner: 'obra', name: 'superpowers' })
    expect(parseRepoUrl('obra/superpowers.git')).toEqual({ owner: 'obra', name: 'superpowers' })
  })

  it('非法 URL（段数不对 / 非 github.com 域 / 空）拒绝', () => {
    expect(() => parseRepoUrl('https://github.com/obra')).toThrow()
    expect(() => parseRepoUrl('https://github.com/obra/superpowers/extra')).toThrow()
    expect(() => parseRepoUrl('https://evil.example/obra/superpowers')).toThrow()
    expect(() => parseRepoUrl('')).toThrow()
    expect(() => parseRepoUrl('https://github.com/obra/superpowers?tab=readme')).toThrow()
  })

  it('非法字符拒绝（空格 / 注入字符 / 路径穿越段）', () => {
    expect(() => parseRepoUrl('obra name/superpowers')).toThrow()
    expect(() => parseRepoUrl('obra/superpowers!')).toThrow()
    expect(() => parseRepoUrl('obra/../superpowers')).toThrow()
    expect(() => parseRepoUrl('.. /superpowers'.replace(' ', ''))).toThrow()
  })
})

// ========== validateRepoRef ==========

describe('validateRepoRef', () => {
  it('合法坐标不抛错（branch 含 / 段也合法，对齐 cc-switch git ref）', () => {
    expect(() => validateRepoRef('obra', 'superpowers', 'main')).not.toThrow()
    expect(() => validateRepoRef('vercel-labs', 'agent-skills', 'feature/x')).not.toThrow()
    expect(() => validateRepoRef('JimLiu', 'baoyu-skills', 'master')).not.toThrow()
  })

  it('owner 只允许字母数字与连字符（带点/下划线即拒绝，过滤非 GitHub 来源）', () => {
    expect(() => validateRepoRef('open.feishu.cn', 'lark', 'main')).toThrow()
    expect(() => validateRepoRef('skills_volces', 'x', 'main')).toThrow()
  })

  it('name 允许 ._- 但拒绝空/纯点/路径穿越', () => {
    expect(() => validateRepoRef('o', '', 'main')).toThrow()
    expect(() => validateRepoRef('o', '..', 'main')).toThrow()
    expect(() => validateRepoRef('o', '.', 'main')).toThrow()
    expect(() => validateRepoRef('o', 'a/b', 'main')).toThrow()
  })

  it('branch 拒绝控制字符 / 特殊符号 / 穿越段（防 URL 拼接收写）', () => {
    expect(() => validateRepoRef('o', 'r', '..%2f..')).toThrow()
    expect(() => validateRepoRef('o', 'r', 'main@{x}')).toThrow()
    expect(() => validateRepoRef('o', 'r', 'a b')).toThrow()
    expect(() => validateRepoRef('o', 'r', 'a#b')).toThrow()
    expect(() => validateRepoRef('o', 'r', '/main')).toThrow()
    expect(() => validateRepoRef('o', 'r', 'main/')).toThrow()
    expect(() => validateRepoRef('o', 'r', 'a//b')).toThrow()
  })
})

// ========== parseSkillsShResponse ==========

describe('parseSkillsShResponse', () => {
  it('样例 JSON：id→key、skillId→directory、source→repo、installs 透传', () => {
    // 形状对齐 skills.sh /api/search 实测（searchType/searchVersion 冗余字段容忍）
    const json = {
      query: 'puppeteer',
      searchType: 'fuzzy',
      searchVersion: 'legacy',
      skills: [
        { id: 'mindrally/skills/puppeteer-automation', skillId: 'puppeteer-automation', name: 'puppeteer-automation', installs: 1701, source: 'mindrally/skills' },
        { id: 'lambdatest/agent-skills/puppeteer-skill', skillId: 'puppeteer-skill', name: 'puppeteer-skill', installs: 190, source: 'lambdatest/agent-skills' }
      ],
      count: 2,
      duration_ms: 627
    }
    const out = parseSkillsShResponse(json)
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      key: 'mindrally/skills/puppeteer-automation',
      name: 'puppeteer-automation',
      desc: '',
      directory: 'puppeteer-automation',
      repo: 'mindrally/skills',
      installs: 1701
    })
    expect(out[1].repo).toBe('lambdatest/agent-skills')
  })

  it('非 GitHub source（带点 owner / 无斜杠 / 多段）被白名单过滤', () => {
    const json = {
      skills: [
        { id: 'a', skillId: 'a', name: 'a', installs: 1, source: 'open.feishu.cn/lark' },
        { id: 'b', skillId: 'b', name: 'b', installs: 1, source: 'no-slash' },
        { id: 'c', skillId: 'c', name: 'c', installs: 1, source: 'owner/repo/extra' },
        { id: 'd', skillId: 'd', name: 'd', installs: 1, source: 'obra/superpowers' }
      ]
    }
    const out = parseSkillsShResponse(json)
    expect(out).toHaveLength(1)
    expect(out[0].repo).toBe('obra/superpowers')
  })

  it('响应非对象 / skills 非数组 / 条目缺字段时安全返回空或跳过', () => {
    expect(parseSkillsShResponse(null)).toEqual([])
    expect(parseSkillsShResponse({})).toEqual([])
    expect(parseSkillsShResponse({ skills: [{ id: 'x', name: 'x' }] })).toEqual([])
    expect(parseSkillsShResponse({ skills: 'nope' })).toEqual([])
  })
})

// ========== zip 解压安全 ==========

describe('unzipZipSafe', () => {
  it('路径穿越条目（../）拒绝', () => {
    const zip = zipSync({ '../evil.txt': strToU8('x') })
    expect(() => unzipZipSafe(zip)).toThrow(/路径穿越|非法/)
  })

  it('绝对路径条目（/ 与盘符前缀）拒绝', () => {
    expect(() => unzipZipSafe(zipSync({ '/abs.txt': strToU8('x') }))).toThrow(/绝对路径|非法/)
    expect(() => unzipZipSafe(zipSync({ 'C:\\evil.txt': strToU8('x') }))).toThrow(/绝对路径|非法/)
  })

  it('条目数超上限（5000）拒绝', () => {
    const entries: Record<string, Uint8Array> = {}
    for (let i = 0; i < 5001; i++) entries[`d/f${i}.txt`] = strToU8('x')
    expect(() => unzipZipSafe(zipSync(entries))).toThrow(/上限/)
  })

  it('正常 zip 返回全部条目，空 zip 拒绝', () => {
    const zip = zipSync({
      'repo-main/skills/foo/SKILL.md': strToU8('---\nname: Foo\n---\n'),
      'repo-main/README.md': strToU8('# repo')
    })
    const files = unzipZipSafe(zip)
    expect(Object.keys(files)).toHaveLength(2)
    expect(() => unzipZipSafe(zipSync({}))).toThrow()
  })
})

// ========== 仓库归档解压（剥 <repo>-<sha>/ 根） ==========

describe('extractRepoArchiveToDir', () => {
  it('剥掉归档根目录后落盘，skill 目录可提取', async () => {
    const zip = zipSync({
      'superpowers-main/skills/foo/SKILL.md': strToU8('---\nname: Foo\ndescription: Bar\n---\n# Foo\n'),
      'superpowers-main/skills/foo/scripts/run.js': strToU8('console.log(1)'),
      'superpowers-main/README.md': strToU8('# repo')
    })
    const dest = path.join(tmp, 'extracted')
    await extractRepoArchiveToDir(zip, dest)
    expect(await fs.readFile(path.join(dest, 'skills', 'foo', 'SKILL.md'), 'utf8')).toContain('name: Foo')
    expect(await fs.readFile(path.join(dest, 'skills', 'foo', 'scripts', 'run.js'), 'utf8')).toBe('console.log(1)')
    expect(await fs.readFile(path.join(dest, 'README.md'), 'utf8')).toBe('# repo')
  })

  it('恶意 zip 在解压阶段即被安全校验拦截', async () => {
    const dest = path.join(tmp, 'evil-dest')
    await expect(extractRepoArchiveToDir(zipSync({ '../evil.txt': strToU8('x') }), dest)).rejects.toThrow()
    await expect(extractRepoArchiveToDir(zipSync({ 'C:/evil.txt': strToU8('x') }), dest)).rejects.toThrow()
  })
})

// ========== 仓库 skill 扫描 ==========

describe('scanRepoSkills', () => {
  it('递归扫描含 SKILL.md 的目录，frontmatter 缺失回退目录名', async () => {
    const root = path.join(tmp, 'repo')
    await makeSkill(root, path.join('skills', 'foo'), 'Foo', 'Does foo')
    await makeSkill(root, path.join('skills', 'bar'), 'bar-name', '')
    const out = scanRepoSkills(root, 'obra', 'superpowers')
    expect(out).toHaveLength(2)
    const foo = out.find((s) => s.directory === 'skills/foo')
    expect(foo).toMatchObject({ key: 'obra/superpowers:skills/foo', name: 'Foo', desc: 'Does foo', repo: 'obra/superpowers' })
    const bar = out.find((s) => s.directory === 'skills/bar')
    expect(bar?.name).toBe('bar-name')
  })

  it('仓库根本身就是 skill 时 directory 用仓库名（对齐 cc-switch）', async () => {
    const root = path.join(tmp, 'repo-root-skill')
    await makeSkill(root, 'root', 'RootSkill', 'Root desc')
    // makeSkill 造在 root 子目录；直接把 SKILL.md 放根
    await fs.writeFile(path.join(root, 'SKILL.md'), '---\nname: RootSkill\ndescription: Root desc\n---\n', 'utf8')
    const out = scanRepoSkills(root, 'o', 'r')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ directory: 'r', key: 'o/r:r', name: 'RootSkill' })
  })
})

// ========== skill 源目录解析 ==========

describe('resolveSkillSourceDir', () => {
  it('直接相对路径命中优先', async () => {
    const root = path.join(tmp, 'repo')
    await makeSkill(root, path.join('skills', 'foo'), 'Foo', '')
    const hit = resolveSkillSourceDir(root, 'skills/foo')
    expect(hit).toBe(path.join(root, 'skills', 'foo'))
  })

  it('按安装名递归回退（嵌套目录）', async () => {
    const root = path.join(tmp, 'repo')
    await makeSkill(root, path.join('a', 'b', 'foo'), 'Foo', '')
    const hit = resolveSkillSourceDir(root, 'foo')
    expect(hit).toBe(path.join(root, 'a', 'b', 'foo'))
  })

  it('仓库根含 SKILL.md 时兜底返回根', async () => {
    const root = path.join(tmp, 'repo')
    await fs.mkdir(root, { recursive: true })
    await fs.writeFile(path.join(root, 'SKILL.md'), '---\nname: R\n---\n', 'utf8')
    expect(resolveSkillSourceDir(root, 'anything')).toBe(root)
  })

  it('找不到 / 含穿越段时返回 null', async () => {
    const root = path.join(tmp, 'repo')
    expect(resolveSkillSourceDir(root, 'missing')).toBeNull()
    expect(resolveSkillSourceDir(root, '../escape')).toBeNull()
  })
})

// ========== 更新比对 ==========

describe('dirsDiffer', () => {
  it('内容相同 → 无更新；文件内容不同 → 有更新', async () => {
    const a = await makeSkill(tmp, 'a', 'S', '')
    const b = await makeSkill(tmp, 'b', 'S', '')
    expect(dirsDiffer(a, b)).toBe(false)
    await fs.writeFile(path.join(b, 'SKILL.md'), '---\nname: S\n---\nchanged', 'utf8')
    expect(dirsDiffer(a, b)).toBe(true)
  })

  it('新增/缺失文件也判定有更新', async () => {
    const a = await makeSkill(tmp, 'a', 'S', '')
    const b = await makeSkill(tmp, 'b', 'S', '')
    await fs.writeFile(path.join(b, 'extra.txt'), 'x', 'utf8')
    expect(dirsDiffer(a, b)).toBe(true)
  })

  it('目录缺失视为存在差异（对齐 cc-switch None != Some）', async () => {
    const a = await makeSkill(tmp, 'a', 'S', '')
    expect(dirsDiffer(a, path.join(tmp, 'missing'))).toBe(true)
  })
})

// ========== 仓库管理 ==========

describe('listRepos / addRepo / removeRepo', () => {
  it('初始为空；addRepo 追加（branch 默认 main）；URL 两种形式均可', async () => {
    expect(await listRepos(ctx)).toEqual([])
    await addRepo('https://github.com/obra/superpowers', '', ctx)
    await addRepo('vercel-labs/agent-skills', 'master', ctx)
    const repos = await listRepos(ctx)
    expect(repos).toEqual([
      { owner: 'obra', name: 'superpowers', branch: 'main' },
      { owner: 'vercel-labs', name: 'agent-skills', branch: 'master' }
    ])
  })

  it('重复添加同仓库 → 仅更新 branch 不重复插入', async () => {
    await addRepo('obra/superpowers', '', ctx)
    await addRepo('https://github.com/obra/superpowers.git', 'dev', ctx)
    const repos = await listRepos(ctx)
    expect(repos).toHaveLength(1)
    expect(repos[0]).toEqual({ owner: 'obra', name: 'superpowers', branch: 'dev' })
  })

  it('非法 URL/坐标拒绝且不改状态', async () => {
    await expect(addRepo('not-a-url', '', ctx)).rejects.toThrow()
    await expect(addRepo('https://github.com/obra/superpowers/extra', '', ctx)).rejects.toThrow()
    await expect(addRepo('open.feishu.cn/lark', '', ctx)).rejects.toThrow()
    expect(await listRepos(ctx)).toEqual([])
  })

  it('removeRepo 按 owner/name 移除', async () => {
    await addRepo('obra/superpowers', '', ctx)
    await addRepo('vercel-labs/agent-skills', '', ctx)
    await removeRepo('obra', 'superpowers', ctx)
    const repos = await listRepos(ctx)
    expect(repos).toHaveLength(1)
    expect(repos[0].name).toBe('agent-skills')
  })
})

// ========== 仓库安装核心（extracted-dir 注入，无网络） ==========

describe('installSkillFromRepoDir', () => {
  it('复制目标 skill 目录入 SSOT 并入库（repo=owner/repo、apps 全 false、hasUpdate false）', async () => {
    const root = path.join(tmp, 'repo')
    await makeSkill(root, path.join('skills', 'hello'), 'Hello', 'Greets')
    const result = await installSkillFromRepoDir(root, 'obra', 'superpowers', 'skills/hello', ctx)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ dir: 'hello', name: 'Hello', desc: 'Greets', repo: 'obra/superpowers', hasUpdate: false, apps: {} })
    expect(await fs.readFile(path.join(ssot, 'hello', 'SKILL.md'), 'utf8')).toContain('name: Hello')
    expect(await fs.readFile(path.join(ssot, 'hello', 'scripts', 'run.js'), 'utf8')).toContain('v1')
    expect(loadStore(dataPath).skills).toHaveLength(1)
  })

  it('同名已存在 → 拒绝（不覆盖）', async () => {
    const root = path.join(tmp, 'repo')
    await makeSkill(root, path.join('skills', 'hello'), 'Hello', '')
    await installSkillFromRepoDir(root, 'o', 'r', 'skills/hello', ctx)
    await expect(installSkillFromRepoDir(root, 'o', 'r', 'skills/hello', ctx)).rejects.toThrow(/已存在/)
  })

  it('skill 目录找不到 → 报错且不入库', async () => {
    const root = path.join(tmp, 'repo')
    await makeSkill(root, path.join('skills', 'hello'), 'Hello', '')
    await expect(installSkillFromRepoDir(root, 'o', 'r', 'nope', ctx)).rejects.toThrow(/未找到/)
    expect(loadStore(dataPath).skills).toHaveLength(0)
  })
})

// ========== 更新核心（extracted-dir 注入，无网络） ==========

describe('updateSkillFromExtractedDir', () => {
  it('重拉内容覆盖 SSOT、重新部署到已启用 harness、清 hasUpdate', async () => {
    const local = await makeSkill(ssot, 'hello', 'Hello', 'Greets v1', 'v1')
    await seed([{ dir: 'hello', name: 'Hello', desc: 'Greets v1', repo: 'obra/superpowers', hasUpdate: true, apps: { dsh: true, claude: true } }])
    // 已启用 harness 的配置目录需存在（需求：目录缺失则不部署）
    await fs.mkdir(path.join(homes, 'dsh'), { recursive: true })
    await fs.mkdir(path.join(homes, 'claude'), { recursive: true })

    const repoRoot = path.join(tmp, 'repo')
    await makeSkill(repoRoot, path.join('skills', 'hello'), 'Hello', 'Greets v2', 'v2')

    const result = await updateSkillFromExtractedDir('hello', repoRoot, ctx)
    const updated = result.find((s) => s.dir === 'hello')
    expect(updated).toMatchObject({ name: 'Hello', desc: 'Greets v2', hasUpdate: false })

    // SSOT 覆盖
    expect(await fs.readFile(path.join(ssot, 'hello', 'SKILL.md'), 'utf8')).toContain('body v2')
    expect(await fs.readFile(path.join(ssot, 'hello', 'scripts', 'run.js'), 'utf8')).toContain('v2')
    // 已启用 harness 重新部署（copy 模式实落盘）
    for (const id of ['dsh', 'claude'] as AgentId[]) {
      expect(await fs.readFile(path.join(homes, id, 'skills', 'hello', 'SKILL.md'), 'utf8')).toContain('body v2')
    }
    // 未启用 harness 不部署
    expect(await fs.readdir(path.join(homes, 'codex', 'skills')).catch(() => [])).toEqual([])
  })

  it('skill 不在库中 / 远程无匹配目录 → 报错', async () => {
    const repoRoot = path.join(tmp, 'repo')
    await makeSkill(repoRoot, path.join('skills', 'hello'), 'Hello', '')
    await expect(updateSkillFromExtractedDir('missing', repoRoot, ctx)).rejects.toThrow(/not found/)
    await seed([{ dir: 'hello', name: 'Hello', desc: '', repo: 'obra/superpowers', hasUpdate: false, apps: {} }])
    await expect(updateSkillFromExtractedDir('hello', path.join(tmp, 'empty-repo'), ctx)).rejects.toThrow(/未找到/)
  })
})

// ========== 更新核心：共享目录路由（自建 ctx 变体：外层 beforeEach ctx 无 env） ==========

describe('updateSkillFromExtractedDir（共享目录路由）', () => {
  it('更新后重部署到共享目录', async () => {
    const userHome = path.join(tmp, 'user-home')
    const sharedSkills = path.join(userHome, '.agents', 'skills')
    await fs.mkdir(path.join(userHome, '.agents'), { recursive: true })
    const c: SkillCtx = { ...ctx, env: { HOME: userHome, USERPROFILE: userHome } }
    await makeSkill(ssot, 'hello', 'Hello', 'Greets v1', 'v1')
    await seed([
      { dir: 'hello', name: 'Hello', desc: '', repo: 'obra/superpowers', hasUpdate: true, apps: { shared: true } }
    ])
    const repoRoot = path.join(tmp, 'repo')
    await makeSkill(repoRoot, path.join('skills', 'hello'), 'Hello', 'Greets v2', 'v2')

    const result = await updateSkillFromExtractedDir('hello', repoRoot, c)

    const updated = result.find((s) => s.dir === 'hello')
    expect(updated).toMatchObject({ name: 'Hello', desc: 'Greets v2', hasUpdate: false })
    expect(await fs.readFile(path.join(sharedSkills, 'hello', 'SKILL.md'), 'utf8')).toContain('body v2')
  })

  it('apps.shared 开启但 <home>/.agents 缺失时拒绝更新（SSOT 不被改动）', async () => {
    const userHome = path.join(tmp, 'user-home2')   // 不建 .agents
    const c: SkillCtx = { ...ctx, env: { HOME: userHome, USERPROFILE: userHome } }
    await makeSkill(ssot, 'hello', 'Hello', 'Greets v1', 'v1')
    await seed([
      { dir: 'hello', name: 'Hello', desc: '', repo: 'obra/superpowers', hasUpdate: true, apps: { shared: true } }
    ])
    const repoRoot = path.join(tmp, 'repo')
    await makeSkill(repoRoot, path.join('skills', 'hello'), 'Hello', 'Greets v2', 'v2')

    await expect(updateSkillFromExtractedDir('hello', repoRoot, c)).rejects.toThrow(/共享目录/)
    expect(await fs.readFile(path.join(ssot, 'hello', 'SKILL.md'), 'utf8')).toContain('body v1')
  })
})
