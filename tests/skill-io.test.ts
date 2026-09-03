// tests/skill-io.test.ts —— E2：卸载备份 / 恢复 / ZIP 安装 / 从 harness 导入
// 备份结构对齐 cc-switch skill.rs:3490-3540：<skill-backups>/<yyyyMMdd_HHmmss>_<slug>/skill/ + meta.json；
// 保留最近 20 份（SKILL_BACKUP_RETAIN_COUNT），backupId 校验拒绝路径穿越（backup_path_for_id）。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { loadSettings, loadStore, saveSettings, saveStore } from '../src/main/store'
import type { AgentId, SkillInstalled, SkillTargetId } from '../src/main/types'
import { deploySkill, uninstallSkill, type SkillCtx } from '../src/main/services/skills'
import {
  deleteSkillBackup,
  importSkills,
  installSkillZip,
  listSkillBackups,
  listUnmanagedSkills,
  restoreSkillBackup
} from '../src/main/services/skill-io'

const AGENT_IDS: AgentId[] = ['dsh', 'claude', 'codex', 'gemini', 'grok', 'opencode', 'hermes']

let tmp: string
let userHome: string
let homes: string
let ssot: string
let backups: string
let dataPath: string
let settingsPath: string
let ctx: SkillCtx

function skillsDirOf(agentId: AgentId): string {
  return path.join(homes, agentId, 'skills')
}

/** 在 dsh + claude 两个 harness 放同名 manual skill，dsh 单独放 other */
async function seedHarnessSkills(): Promise<void> {
  for (const id of ['dsh', 'claude'] as AgentId[]) {
    await fs.mkdir(path.join(skillsDirOf(id), 'manual'), { recursive: true })
    await fs.writeFile(
      path.join(skillsDirOf(id), 'manual', 'SKILL.md'),
      '---\nname: Manual\ndescription: hand placed\n---\nx',
      'utf8'
    )
  }
  await fs.mkdir(path.join(skillsDirOf('dsh'), 'other'), { recursive: true })
  await fs.writeFile(
    path.join(skillsDirOf('dsh'), 'other', 'SKILL.md'),
    '---\nname: Other\n---\nx',
    'utf8'
  )
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-io-'))
  userHome = path.join(tmp, 'user-home')
  homes = path.join(tmp, 'homes')
  ssot = path.join(tmp, 'ssot')
  backups = path.join(tmp, 'skill-backups')
  dataPath = path.join(tmp, 'data.json')
  settingsPath = path.join(tmp, 'settings.json')
  const overrides: Partial<Record<AgentId, string>> = {}
  for (const id of AGENT_IDS) overrides[id] = path.join(homes, id)
  await saveSettings(settingsPath, {
    dirOverrides: overrides,
    syncMethod: 'auto',
    backupBeforeWrite: true,
    skillUninstallBackup: true
  })
  ctx = { dataFile: dataPath, settingsFile: settingsPath, ssotDir: ssot, backupsDir: backups,
          env: { HOME: userHome, USERPROFILE: userHome } }
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

/** 构造带 frontmatter 的源 skill 目录（含嵌套 scripts/run.js） */
async function makeSkill(base: string, dir: string, name: string, desc: string): Promise<string> {
  const skill = path.join(base, dir)
  await fs.mkdir(skill, { recursive: true })
  await fs.writeFile(
    path.join(skill, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${desc}\n---\n# ${name}\n\nbody text`,
    'utf8'
  )
  await fs.mkdir(path.join(skill, 'scripts'), { recursive: true })
  await fs.writeFile(path.join(skill, 'scripts', 'run.js'), 'console.log(1)', 'utf8')
  return skill
}

function entry(
  dir: string,
  name: string,
  desc = '',
  apps: Partial<Record<SkillTargetId, boolean>> = {}
): SkillInstalled {
  return { dir, name, desc, repo: null, hasUpdate: false, apps }
}

async function seed(items: SkillInstalled[]): Promise<void> {
  await saveStore(dataPath, {
    version: 1,
    mcpItems: [],
    skills: items,
    prompts: { dsh: [], claude: [], codex: [], gemini: [], grok: [], opencode: [], hermes: [] },
    skillRepos: []
  })
}

/** 递归收集相对路径 -> 内容，用于整树比对 */
async function tree(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  async function walk(dir: string): Promise<void> {
    for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) await walk(full)
      else out[path.relative(root, full)] = await fs.readFile(full, 'utf8')
    }
  }
  await walk(root)
  return out
}

/** 备份根下现存备份目录名列表 */
async function backupDirs(): Promise<string[]> {
  let ents
  try {
    ents = await fs.readdir(backups, { withFileTypes: true })
  } catch {
    return []
  }
  return ents.filter((e) => e.isDirectory()).map((e) => e.name)
}

describe('uninstallSkill', () => {
  it('卸载：SSOT 移除、备份目录内容完整（skill/ 子目录 + meta.json）、库条目移除', async () => {
    const source = await makeSkill(ssot, 'hello', 'Hello', 'Greets')
    await seed([entry('hello', 'Hello', 'Greets')])
    const before = await tree(source)

    const list = await uninstallSkill('hello', ctx)

    await expect(fs.lstat(path.join(ssot, 'hello'))).rejects.toThrow()
    expect(loadStore(dataPath).skills).toEqual([])
    expect(list).toEqual([])
    const ids = await backupDirs()
    expect(ids).toHaveLength(1)
    const meta = JSON.parse(await fs.readFile(path.join(backups, ids[0], 'meta.json'), 'utf8'))
    expect(meta).toMatchObject({
      name: 'Hello',
      desc: 'Greets',
      repo: null,
      sourceDir: 'hello',
      apps: {}
    })
    expect(typeof meta.backupCreatedAt).toBe('number')
    expect(await tree(path.join(backups, ids[0], 'skill'))).toEqual(before)
  })

  it('卸载前先从所有启用 harness 移除部署', async () => {
    await makeSkill(ssot, 'hello', 'Hello', 'Greets')
    await seed([entry('hello', 'Hello', 'Greets', { dsh: true, claude: true })])
    await deploySkill(ssot, 'hello', skillsDirOf('dsh'), 'auto')
    await deploySkill(ssot, 'hello', skillsDirOf('claude'), 'auto')

    await uninstallSkill('hello', ctx)

    await expect(fs.lstat(path.join(skillsDirOf('dsh'), 'hello'))).rejects.toThrow()
    await expect(fs.lstat(path.join(skillsDirOf('claude'), 'hello'))).rejects.toThrow()
  })

  it('卸载前从共享目录移除部署', async () => {
    const sharedSkills = path.join(userHome, '.agents', 'skills')
    await makeSkill(ssot, 'hello', 'Hello', 'Greets')
    await seed([entry('hello', 'Hello', 'Greets', { shared: true })])
    await deploySkill(ssot, 'hello', sharedSkills, 'auto')

    await uninstallSkill('hello', ctx)

    await expect(fs.lstat(path.join(sharedSkills, 'hello'))).rejects.toThrow()
  })

  it('backup 开关关闭时直接删 SSOT，不产生备份', async () => {
    const settings = loadSettings(settingsPath)
    settings.skillUninstallBackup = false
    await saveSettings(settingsPath, settings)
    await makeSkill(ssot, 'hello', 'Hello', 'Greets')
    await seed([entry('hello', 'Hello')])

    await uninstallSkill('hello', ctx)

    await expect(fs.lstat(path.join(ssot, 'hello'))).rejects.toThrow()
    expect(await backupDirs()).toEqual([])
    expect(loadStore(dataPath).skills).toEqual([])
  })

  it('库中不存在的 dir 抛错', async () => {
    await seed([])
    await expect(uninstallSkill('nope', ctx)).rejects.toThrow()
  })
})

describe('listSkillBackups', () => {
  it('扫磁盘 meta.json；无 meta / 坏 meta 的目录跳过，非目录条目跳过', async () => {
    const good = path.join(backups, 'bk_good')
    await fs.mkdir(path.join(good, 'skill'), { recursive: true })
    await fs.writeFile(
      path.join(good, 'meta.json'),
      JSON.stringify({ name: 'G', desc: 'd', repo: 'a/b', backupCreatedAt: 1111, sourceDir: 's1' }),
      'utf8'
    )
    const bad = path.join(backups, 'bk_bad')
    await fs.mkdir(path.join(bad, 'skill'), { recursive: true })
    await fs.writeFile(path.join(bad, 'meta.json'), 'not json', 'utf8')
    const nometa = path.join(backups, 'bk_nometa')
    await fs.mkdir(path.join(nometa, 'skill'), { recursive: true })
    await fs.writeFile(path.join(backups, 'file.txt'), 'x', 'utf8')

    const list = listSkillBackups(ctx)

    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      backupId: 'bk_good',
      name: 'G',
      dir: 's1',
      desc: 'd',
      createdAt: 1111,
      path: good
    })
  })

  it('备份根不存在时返回空列表', () => {
    expect(listSkillBackups(ctx)).toEqual([])
  })
})

describe('restoreSkillBackup', () => {
  it('恢复：备份 skill/ 复制回 SSOT + 依 meta.json 重建库条目（apps 空，不部署）', async () => {
    const source = await makeSkill(ssot, 'hello', 'Hello', 'Greets')
    await seed([entry('hello', 'Hello', 'Greets')])
    const before = await tree(source)
    await uninstallSkill('hello', ctx)
    const id = (await backupDirs())[0]

    const list = await restoreSkillBackup(id, false, ctx)

    expect(await tree(path.join(ssot, 'hello'))).toEqual(before)
    const skills = loadStore(dataPath).skills
    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({
      dir: 'hello',
      name: 'Hello',
      desc: 'Greets',
      repo: null,
      hasUpdate: false,
      apps: {}
    })
    expect(list.some((b) => b.backupId === id)).toBe(true)
    // 备份目录保留
    expect(await backupDirs()).toContain(id)
  })

  it('deploy=true 时按 meta.json 记录的 apps 重新部署到指定 harness', async () => {
    await makeSkill(ssot, 'hello', 'Hello', 'Greets')
    await seed([entry('hello', 'Hello', 'Greets', { dsh: true, claude: true })])
    await deploySkill(ssot, 'hello', skillsDirOf('dsh'), 'auto')
    await deploySkill(ssot, 'hello', skillsDirOf('claude'), 'auto')
    await uninstallSkill('hello', ctx)
    await expect(fs.lstat(path.join(skillsDirOf('dsh'), 'hello'))).rejects.toThrow()
    const id = (await backupDirs())[0]

    await restoreSkillBackup(id, true, ctx)

    expect(await fs.readFile(path.join(skillsDirOf('dsh'), 'hello', 'SKILL.md'), 'utf8')).toContain(
      'name: Hello'
    )
    expect(
      await fs.readFile(path.join(skillsDirOf('claude'), 'hello', 'SKILL.md'), 'utf8')
    ).toContain('name: Hello')
    expect(loadStore(dataPath).skills[0].apps).toEqual({ dsh: true, claude: true })
  })

  it('SSOT 已存在同名 skill 时拒绝恢复（防覆盖）', async () => {
    await makeSkill(ssot, 'hello', 'Hello', 'Greets')
    await seed([entry('hello', 'Hello')])
    await uninstallSkill('hello', ctx)
    const id = (await backupDirs())[0]
    await makeSkill(ssot, 'hello', 'Hello2', 'x')
    await seed([entry('hello', 'Hello2')])

    await expect(restoreSkillBackup(id, false, ctx)).rejects.toThrow()
  })
})

describe('deleteSkillBackup', () => {
  it('校验后 rm -rf 备份目录；重复删除幂等', async () => {
    await makeSkill(ssot, 'hello', 'Hello', 'Greets')
    await seed([entry('hello', 'Hello')])
    await uninstallSkill('hello', ctx)
    const id = (await backupDirs())[0]

    const list = await deleteSkillBackup(id, ctx)

    expect(await backupDirs()).toEqual([])
    expect(list).toEqual([])
    await deleteSkillBackup(id, ctx) // 幂等
    expect(await backupDirs()).toEqual([])
  })
})

describe('备份上限（保留最近 20 份）', () => {
  it('造 21 份备份后只剩 20 份，最旧的一份被淘汰', async () => {
    const items: SkillInstalled[] = []
    for (let i = 1; i <= 21; i++) {
      items.push(entry(`s${String(i).padStart(2, '0')}`, `S${i}`))
    }
    await seed(items)

    const created: { id: string; mtime: number }[] = []
    for (const it of items) {
      await makeSkill(ssot, it.dir, it.name, '')
      await uninstallSkill(it.dir, ctx)
      const ids = await backupDirs()
      const newest = ids.find((x) => !created.some((c) => c.id === x))
      expect(newest).toBeTruthy()
      created.push({ id: newest as string, mtime: (await fs.stat(path.join(backups, newest as string))).mtimeMs })
      await new Promise((r) => setTimeout(r, 5))
    }

    expect(await backupDirs()).toHaveLength(20)
    const list = listSkillBackups(ctx)
    expect(list).toHaveLength(20)
    // 被淘汰的是创建最早（mtime 最小）的那份
    const minMtime = Math.min(...created.map((c) => c.mtime))
    const evicted = created.find((c) => c.mtime === minMtime) as { id: string }
    expect(await backupDirs()).not.toContain(evicted.id)
    // 列表按备份时间倒序
    const times = list.map((b) => b.createdAt)
    expect([...times].sort((a, b) => b - a)).toEqual(times)
  })
})

describe('installSkillZip', () => {
  it('单层子目录 zip 解压安装成功：复制入 SSOT + 入库（repo=null、apps 全 false）', async () => {
    const zipPath = path.join(tmp, 'pkg.zip')
    await fs.writeFile(
      zipPath,
      zipSync({
        'my-skill/SKILL.md': strToU8('---\nname: Zip Skill\ndescription: from zip\n---\nbody'),
        'my-skill/scripts/run.js': strToU8('console.log(2)'),
        'my-skill/': strToU8('')
      })
    )

    const list = await installSkillZip(zipPath, ctx)

    expect(await fs.readFile(path.join(ssot, 'my-skill', 'SKILL.md'), 'utf8')).toContain(
      'name: Zip Skill'
    )
    expect(await fs.readFile(path.join(ssot, 'my-skill', 'scripts', 'run.js'), 'utf8')).toBe(
      'console.log(2)'
    )
    const installed = loadStore(dataPath).skills.find((s) => s.dir === 'my-skill')
    expect(installed).toMatchObject({
      dir: 'my-skill',
      name: 'Zip Skill',
      desc: 'from zip',
      repo: null,
      hasUpdate: false,
      apps: {}
    })
    expect(list.some((s) => s.dir === 'my-skill')).toBe(true)
  })

  it('zip 根含 SKILL.md 时以 zip 文件名为目录名', async () => {
    const zipPath = path.join(tmp, 'zip-skill.zip')
    await fs.writeFile(
      zipPath,
      zipSync({
        'SKILL.md': strToU8('---\nname: Root\ndescription: at root\n---\nx'),
        'notes.md': strToU8('n')
      })
    )

    await installSkillZip(zipPath, ctx)

    expect(await fs.readFile(path.join(ssot, 'zip-skill', 'SKILL.md'), 'utf8')).toContain(
      'name: Root'
    )
    expect(await fs.readFile(path.join(ssot, 'zip-skill', 'notes.md'), 'utf8')).toBe('n')
  })

  it('条目数超上限（5000）拒绝', async () => {
    const entries: Record<string, Uint8Array> = {}
    for (let i = 0; i < 5001; i++) entries[`d${i}/f`] = strToU8('x')
    const zipPath = path.join(tmp, 'big.zip')
    await fs.writeFile(zipPath, zipSync(entries))

    await expect(installSkillZip(zipPath, ctx)).rejects.toThrow(/5000/)
  })

  it('路径穿越（../）与绝对路径条目拒绝', async () => {
    const trav = path.join(tmp, 'trav.zip')
    await fs.writeFile(trav, zipSync({ '../evil/SKILL.md': strToU8('x') }))
    await expect(installSkillZip(trav, ctx)).rejects.toThrow()

    const abs = path.join(tmp, 'abs.zip')
    await fs.writeFile(abs, zipSync({ '/evil/SKILL.md': strToU8('x') }))
    await expect(installSkillZip(abs, ctx)).rejects.toThrow()
  })

  it('无 SKILL.md 或多候选目录的 zip 拒绝', async () => {
    const none = path.join(tmp, 'none.zip')
    await fs.writeFile(none, zipSync({ 'a.txt': strToU8('x') }))
    await expect(installSkillZip(none, ctx)).rejects.toThrow(/SKILL\.md/)

    const multi = path.join(tmp, 'multi.zip')
    await fs.writeFile(
      multi,
      zipSync({ 'a/SKILL.md': strToU8('x'), 'b/SKILL.md': strToU8('y') })
    )
    await expect(installSkillZip(multi, ctx)).rejects.toThrow()
  })

  it('SSOT 已存在同名 skill 时拒绝安装', async () => {
    await makeSkill(ssot, 'my-skill', 'Zip Skill', 'from zip')
    await seed([entry('my-skill', 'Zip Skill')])
    const zipPath = path.join(tmp, 'pkg.zip')
    await fs.writeFile(
      zipPath,
      zipSync({ 'my-skill/SKILL.md': strToU8('---\nname: Zip Skill\n---\nx') })
    )

    await expect(installSkillZip(zipPath, ctx)).rejects.toThrow(/已存在|exist/i)
  })
})

describe('listUnmanagedSkills / importSkills', () => {
  it('扫描各 harness skillsDir：有 SKILL.md 且不在库中的目录 -> UnmanagedSkill，foundIn 合并', async () => {
    await seedHarnessSkills()
    await seed([entry('hello', 'Hello')])

    const list = listUnmanagedSkills(ctx)

    const manual = list.find((u) => u.dir === 'manual') as NonNullable<(typeof list)[number]>
    expect(manual).toMatchObject({
      dir: 'manual',
      name: 'Manual',
      desc: 'hand placed',
      foundIn: ['dsh', 'claude'],
      path: path.join(skillsDirOf('dsh'), 'manual')
    })
    const other = list.find((u) => u.dir === 'other')
    expect(other?.foundIn).toEqual(['dsh'])
    expect(list.some((u) => u.dir === 'hello')).toBe(false)
  })

  it('importSkills：源目录复制入 SSOT + 入库（apps 按选择）+ 按 apps 部署到 harness', async () => {
    await seedHarnessSkills()
    await seed([])

    const list = await importSkills([{ dir: 'manual', apps: { dsh: true, claude: true } }], ctx)

    expect(await fs.readFile(path.join(ssot, 'manual', 'SKILL.md'), 'utf8')).toContain(
      'name: Manual'
    )
    const sk = loadStore(dataPath).skills.find((s) => s.dir === 'manual')
    expect(sk).toMatchObject({ dir: 'manual', repo: null, apps: { dsh: true, claude: true } })
    expect(await fs.readFile(path.join(skillsDirOf('dsh'), 'manual', 'SKILL.md'), 'utf8')).toContain(
      'name: Manual'
    )
    expect(
      await fs.readFile(path.join(skillsDirOf('claude'), 'manual', 'SKILL.md'), 'utf8')
    ).toContain('name: Manual')
    expect(list.some((s) => s.dir === 'manual')).toBe(true)
    // 已导入的不再出现在未管理列表
    expect(listUnmanagedSkills(ctx).some((u) => u.dir === 'manual')).toBe(false)
    // 源目录仍在 harness 中
    expect(await fs.lstat(path.join(skillsDirOf('dsh'), 'manual'))).toBeTruthy()
  })

  it('importSkills 找不到源目录 / 已入库时抛错', async () => {
    await seed([])
    await expect(importSkills([{ dir: 'ghost', apps: {} }], ctx)).rejects.toThrow()

    await seedHarnessSkills()
    await seed([entry('manual', 'Manual')])
    await expect(importSkills([{ dir: 'manual', apps: {} }], ctx)).rejects.toThrow()
  })
})

describe('共享目录扫描与导入', () => {
  const sharedSkills = (): string => path.join(userHome, '.agents', 'skills')

  /** 在共享目录放一个 skill（默认 ext-skill；appendFakeHome=false 时不建 ~/.agents 根） */
  async function seedSharedSkill(dir = 'ext-skill', createRoot = true): Promise<void> {
    if (createRoot) await fs.mkdir(sharedSkills(), { recursive: true })
    await fs.mkdir(path.join(sharedSkills(), dir), { recursive: true })
    await fs.writeFile(
      path.join(sharedSkills(), dir, 'SKILL.md'),
      '---\nname: Ext\ndescription: from shared\n---\nx',
      'utf8'
    )
  }

  it('扫描包含共享目录：仅共享命中的 skill foundIn=[shared]、path 指向共享目录', async () => {
    await seedSharedSkill()
    await seed([])

    const list = listUnmanagedSkills(ctx)

    const ext = list.find((u) => u.dir === 'ext-skill')
    expect(ext).toMatchObject({ dir: 'ext-skill', name: 'Ext', desc: 'from shared' })
    expect(ext?.foundIn).toEqual(['shared'])
    expect(ext?.path).toBe(path.join(sharedSkills(), 'ext-skill'))
  })

  it('harness 与共享目录同名：foundIn 合并（harness 在前）且 path 取 harness 路径', async () => {
    await seedHarnessSkills()   // dsh + claude 各有 manual（现有助手）
    await seedSharedSkill('manual')
    await seed([entry('hello', 'Hello')])

    const list = listUnmanagedSkills(ctx)

    const manual = list.find((u) => u.dir === 'manual')
    expect(manual?.foundIn).toEqual(['dsh', 'claude', 'shared'])
    expect(manual?.path).toBe(path.join(skillsDirOf('dsh'), 'manual'))
  })

  it('importSkills：从共享目录导入并部署回共享目录（原实体目录被复制替换）', async () => {
    await seedSharedSkill()
    await seed([])

    const list = await importSkills([{ dir: 'ext-skill', apps: { shared: true } }], ctx)

    const sk = loadStore(dataPath).skills.find((s) => s.dir === 'ext-skill')
    expect(sk).toMatchObject({ dir: 'ext-skill', repo: null, apps: { shared: true } })
    expect(await fs.readFile(path.join(ssot, 'ext-skill', 'SKILL.md'), 'utf8')).toContain('name: Ext')
    // syncMethod=auto：共享目录原为实体目录 -> 复制替换（纳管接管语义）
    expect((await fs.lstat(path.join(sharedSkills(), 'ext-skill'))).isSymbolicLink()).toBe(false)
    expect(await fs.readFile(path.join(sharedSkills(), 'ext-skill', 'SKILL.md'), 'utf8')).toContain(
      'name: Ext'
    )
    expect(list.some((s) => s.dir === 'ext-skill')).toBe(true)
  })

  it('importSkills：部署目标含 shared 但 <home>/.agents 缺失时整批拒绝（不写 SSOT、不入库）', async () => {
    await seed([])
    // 源放在 dsh（harness 目录存在），目标含 shared
    await fs.mkdir(path.join(skillsDirOf('dsh'), 'manual'), { recursive: true })
    await fs.writeFile(
      path.join(skillsDirOf('dsh'), 'manual', 'SKILL.md'),
      '---\nname: Manual\n---\nx',
      'utf8'
    )

    await expect(importSkills([{ dir: 'manual', apps: { shared: true } }], ctx)).rejects.toThrow(
      /共享目录/
    )

    await expect(fs.access(path.join(ssot, 'manual'))).rejects.toThrow()
    expect(loadStore(dataPath).skills).toHaveLength(0)
  })
})

describe('backupId 校验（防路径穿越）', () => {
  it('拒绝含 ../、/、\、空与 . 的 backupId', async () => {
    for (const bad of ['', '.', '..', '../x', 'a/b', 'a\\b']) {
      await expect(restoreSkillBackup(bad, false, ctx)).rejects.toThrow()
      await expect(deleteSkillBackup(bad, ctx)).rejects.toThrow()
    }
  })
})