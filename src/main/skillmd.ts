// src/main/skillmd.ts —— 解析 Skill 目录的 SKILL.md frontmatter（name/description）
// 语义对齐 cc-switch skill.rs：parse_skill_metadata_static:2721（去 BOM、splitn(3, "---")、YAML 解析失败回退）
// 与 read_skill_name_desc:2743（name 缺省回退目录名、description 缺省空串）
import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'

/** frontmatter 解析结果：SKILL.md 缺失时 parseSkillMd 返回 null（调用方处理） */
export interface SkillMdMeta {
  name: string
  desc: string
}

/** ENOENT 才视为"文件不存在"，其余错误原样上抛 */
function isNotFound(err: unknown): boolean {
  if (!(err instanceof Error) || !('code' in err)) return false
  return (err as { code?: string }).code === 'ENOENT'
}

/**
 * 读 <dir>/SKILL.md 的 frontmatter（--- 块，yaml 包解析）取 name/description。
 * - SKILL.md 不存在 -> null（调用方处理）
 * - 无 frontmatter（内容不含 --- 块）/ 坏 YAML / 键缺失 -> 逐键回退：
 *   name 回退目录名，description 回退空串（对齐 cc-switch unwrap_or_default）
 */
export function parseSkillMd(dir: string): SkillMdMeta | null {
  let content: string
  try {
    content = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8')
  } catch (err) {
    if (isNotFound(err)) return null
    throw err
  }
  const fallbackName = path.basename(dir)
  content = content.replace(/^\uFEFF/, '') // 去 BOM（对齐 cc-switch:2723）
  const parts = content.split('---', 3)
  if (parts.length < 3) return { name: fallbackName, desc: '' }

  let meta: unknown
  try {
    meta = parseYaml(parts[1].trim())
  } catch {
    return { name: fallbackName, desc: '' }
  }
  const rec = meta as Record<string, unknown> | null
  const name = rec && typeof rec.name === 'string' ? rec.name : fallbackName
  const desc = rec && typeof rec.description === 'string' ? rec.description : ''
  return { name, desc }
}