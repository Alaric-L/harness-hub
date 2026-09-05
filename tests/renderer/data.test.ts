// tests/renderer/data.test.ts —— Skills 部署目标序列（共享目录置顶，仅 Skills 视图使用）
import { describe, expect, it } from 'vitest'
import { AGENTS, SHARED_TARGET, SKILL_TARGETS, SKILL_TARGET_BY } from '../../src/renderer/data.js'

describe('SKILL_TARGETS / SKILL_TARGET_BY', () => {
  it('共享目录置顶，其后为 8 个 harness（顺序与 AGENTS 一致）', () => {
    expect(SKILL_TARGETS[0]).toBe(SHARED_TARGET)
    expect(SKILL_TARGETS.slice(1)).toEqual(AGENTS)
    expect(SKILL_TARGETS).toHaveLength(9)
  })

  it('SHARED_TARGET 关键字段', () => {
    expect(SHARED_TARGET).toMatchObject({ id: 'shared', name: '共享目录(~/.agents/skills)', skillsDir: '~/.agents/skills' })
  })

  it('SKILL_TARGET_BY：shared 命中共享目标；harness id 回落 AGENT_BY；未知 id 为 undefined', () => {
    expect(SKILL_TARGET_BY('shared')).toBe(SHARED_TARGET)
    expect(SKILL_TARGET_BY('dsh')?.id).toBe('dsh')
    expect(SKILL_TARGET_BY('nope')).toBeUndefined()
  })
})
