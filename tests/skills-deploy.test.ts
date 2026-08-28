// tests/skills-deploy.test.ts —— E1：SSOT 部署（symlink/junction 优先、copy 回退）与 SKILL.md frontmatter 解析
// 对齐 cc-switch skill.rs：sync_to_app_dir:2241 / remove_path:2318 / replace_dest_with_copy:2351 / parse_skill_metadata_static:2721
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { deploySkill, undeploySkill } from '../src/main/services/skills'
import { parseSkillMd } from '../src/main/skillmd'

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'skills-deploy-'))
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

/** 递归收集相对路径 -> 内容，用于整树比对（读链接目标时穿透到源，正是部署语义） */
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

describe('deploySkill', () => {
  it('auto 模式新建：symlink/junction 优先，目标内容与源一致（读文件比对）', async () => {
    const ssot = path.join(tmp, 'ssot')
    const target = path.join(tmp, 'apps')
    const source = await makeSkill(ssot, 'hello', 'Hello', 'Greets')
    const originalMd = await fs.readFile(path.join(source, 'SKILL.md'), 'utf8')

    const method = await deploySkill(ssot, 'hello', target, 'auto')

    // junction/symlink 任一合法（本机实测 junction 无需管理员权限；POSIX 无权限时回退 copy）
    expect(['symlink', 'copy']).toContain(method)
    const dest = path.join(target, 'hello')
    const st = await fs.lstat(dest)
    expect(st.isSymbolicLink()).toBe(method === 'symlink')
    expect(await fs.readFile(path.join(dest, 'SKILL.md'), 'utf8')).toBe(originalMd)
    expect(await fs.readFile(path.join(dest, 'scripts', 'run.js'), 'utf8')).toBe('console.log(1)')
  })

  it('auto 模式目标已是实体目录 -> 复制替换（stale 内容被清除）', async () => {
    const ssot = path.join(tmp, 'ssot')
    const target = path.join(tmp, 'apps')
    await makeSkill(ssot, 'hello', 'Hello', 'Greets')
    const dest = path.join(target, 'hello')
    await fs.mkdir(dest, { recursive: true })
    await fs.writeFile(path.join(dest, 'SKILL.md'), 'STALE', 'utf8')
    await fs.writeFile(path.join(dest, 'junk.txt'), 'JUNK', 'utf8')

    const method = await deploySkill(ssot, 'hello', target, 'auto')

    expect(method).toBe('copy')
    const st = await fs.lstat(dest)
    expect(st.isSymbolicLink()).toBe(false)
    expect(st.isDirectory()).toBe(true)
    expect(await tree(dest)).toEqual(await tree(path.join(ssot, 'hello')))
  })

  it('auto 模式目标已是 symlink/junction -> 先删再建（仍为链接）', async () => {
    const ssot = path.join(tmp, 'ssot')
    const target = path.join(tmp, 'apps')
    const source = await makeSkill(ssot, 'hello', 'Hello', 'Greets')
    const first = await deploySkill(ssot, 'hello', target, 'auto')

    const second = await deploySkill(ssot, 'hello', target, 'auto')

    // 首次成功为 symlink 时，第二次必然以链接方式重建（目标已是链接 -> 先删再建）
    if (first === 'symlink') expect(second).toBe('symlink')
    const dest = path.join(target, 'hello')
    expect(await fs.readFile(path.join(dest, 'SKILL.md'), 'utf8')).toBe(
      await fs.readFile(path.join(source, 'SKILL.md'), 'utf8')
    )
  })

  it('copy 模式：递归目录复制内容一致，且替换已有实体目录目标', async () => {
    const ssot = path.join(tmp, 'ssot')
    const target = path.join(tmp, 'apps')
    await makeSkill(ssot, 'hello', 'Hello', 'Greets')
    const dest = path.join(target, 'hello')
    await fs.mkdir(dest, { recursive: true })
    await fs.writeFile(path.join(dest, 'SKILL.md'), 'STALE', 'utf8')

    const method = await deploySkill(ssot, 'hello', target, 'copy')

    expect(method).toBe('copy')
    expect(await tree(dest)).toEqual(await tree(path.join(ssot, 'hello')))
    // 目标为真实目录（非链接）
    expect((await fs.lstat(dest)).isSymbolicLink()).toBe(false)
  })
})

describe('undeploySkill', () => {
  it('移除 symlink/junction 形态（只删链接，源目录不受影响）', async () => {
    const ssot = path.join(tmp, 'ssot')
    const target = path.join(tmp, 'apps')
    const source = await makeSkill(ssot, 'hello', 'Hello', 'Greets')
    await deploySkill(ssot, 'hello', target, 'auto')
    const dest = path.join(target, 'hello')

    await undeploySkill(dest)

    await expect(fs.lstat(dest)).rejects.toThrow()
    // 源目录完好
    expect(await fs.readFile(path.join(source, 'SKILL.md'), 'utf8')).toContain('name: Hello')
  })

  it('移除实体目录形态（copy 部署）', async () => {
    const ssot = path.join(tmp, 'ssot')
    const target = path.join(tmp, 'apps')
    const source = await makeSkill(ssot, 'hello', 'Hello', 'Greets')
    await deploySkill(ssot, 'hello', target, 'copy')
    const dest = path.join(target, 'hello')
    expect((await fs.lstat(dest)).isSymbolicLink()).toBe(false)

    await undeploySkill(dest)

    await expect(fs.lstat(dest)).rejects.toThrow()
    expect(await fs.readFile(path.join(source, 'SKILL.md'), 'utf8')).toContain('name: Hello')
  })

  it('目标不存在时静默 no-op（幂等）', async () => {
    const dest = path.join(tmp, 'apps', 'nope')
    await expect(undeploySkill(dest)).resolves.toBeUndefined()
  })
})

describe('parseSkillMd', () => {
  it('解析正常 frontmatter 的 name/description', async () => {
    const dir = path.join(tmp, 'hello')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      path.join(dir, 'SKILL.md'),
      '---\nname: Hello Skill\ndescription: Greets the user\n---\n# Body',
      'utf8'
    )

    expect(parseSkillMd(dir)).toEqual({ name: 'Hello Skill', desc: 'Greets the user' })
  })

  it('无 frontmatter（无 --- 块）时回退目录名，desc 为空串', async () => {
    const dir = path.join(tmp, 'plain-skill')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'SKILL.md'), '# Plain skill\nno frontmatter here', 'utf8')

    expect(parseSkillMd(dir)).toEqual({ name: 'plain-skill', desc: '' })
  })

  it('SKILL.md 缺失返回 null（调用方处理）', async () => {
    const dir = path.join(tmp, 'empty')
    await fs.mkdir(dir, { recursive: true })

    expect(parseSkillMd(dir)).toBeNull()
  })

  it('frontmatter 前导 BOM 不影响解析', async () => {
    const dir = path.join(tmp, 'bom')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      path.join(dir, 'SKILL.md'),
      '\uFEFF---\nname: Bom Skill\ndescription: with bom\n---\nbody',
      'utf8'
    )

    expect(parseSkillMd(dir)).toEqual({ name: 'Bom Skill', desc: 'with bom' })
  })

  it('frontmatter 缺键时逐键回退：name->目录名，description->空串', async () => {
    const dir = path.join(tmp, 'partial')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'SKILL.md'), '---\ndescription: only desc\n---\nbody', 'utf8')

    expect(parseSkillMd(dir)).toEqual({ name: 'partial', desc: 'only desc' })

    const dir2 = path.join(tmp, 'name-only')
    await fs.mkdir(dir2, { recursive: true })
    await fs.writeFile(path.join(dir2, 'SKILL.md'), '---\nname: only name\n---\nbody', 'utf8')

    expect(parseSkillMd(dir2)).toEqual({ name: 'only name', desc: '' })
  })

  it('frontmatter 是坏 YAML 时回退目录名（对齐 cc-switch unwrap_or_default）', async () => {
    const dir = path.join(tmp, 'broken')
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'SKILL.md'), '---\nname: [unclosed\n---\nbody', 'utf8')

    expect(parseSkillMd(dir)).toEqual({ name: 'broken', desc: '' })
  })
})