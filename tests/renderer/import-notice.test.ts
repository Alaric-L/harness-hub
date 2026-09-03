// tests/renderer/import-notice.test.ts —— Skills 导入：部署提示/确认文案（纯函数，三模式预置，auto 备恢复）
import { describe, it, expect } from 'vitest'
import { importDeployHint, importConfirmMessage } from '../../src/renderer/ui/import-notice.js'

describe('importDeployHint（弹窗内提示文案）', () => {
  it('symlink：说明链接部署、原目录被删除替换为链接、原始文件仅存中央库', () => {
    const t = importDeployHint('symlink')

    expect(t).toContain('部署方式：符号链接')
    expect(t).toContain('删除并替换为链接')
    expect(t).toContain('原始文件仅保留在中央库一份')
  })

  it('copy：说明复制部署、原目录被整体替换为副本、此后互不联动', () => {
    const t = importDeployHint('copy')

    expect(t).toContain('部署方式：复制')
    expect(t).toContain('整体替换为副本')
    expect(t).toContain('互不联动')
  })

  it('auto：分别说明链接与复制两种处理，并指出来源 harness 走复制替换', () => {
    const t = importDeployHint('auto')

    expect(t).toContain('按目标位置现状二选一')
    expect(t).toContain('创建符号链接')
    expect(t).toContain('复制替换')
    expect(t).toContain('来源 harness 已存在原目录')
  })

  it('未知部署方式抛错（fail fast，防止静默误导用户）', () => {
    expect(() => importDeployHint('mystery')).toThrow('未知的部署方式')
  })
})

describe('importConfirmMessage（执行前二级确认文案）', () => {
  it('symlink：含数量、目标 harness 短名与替换警示，以“是否继续？”收尾', () => {
    const t = importConfirmMessage('symlink', 3, ['DSH', 'Claude'])

    expect(t).toContain('3 个 Skill')
    expect(t).toContain('DSH、Claude')
    expect(t).toContain('删除并替换为链接')
    expect(t.endsWith('是否继续？')).toBe(true)
  })

  it('copy：含数量、目标 harness 与副本替换警示', () => {
    const t = importConfirmMessage('copy', 1, ['Codex'])

    expect(t).toContain('1 个 Skill')
    expect(t).toContain('Codex')
    expect(t).toContain('整体替换为副本')
    expect(t.endsWith('是否继续？')).toBe(true)
  })

  it('auto：说明混合处理（已有目录复制替换、其余建链接）', () => {
    const t = importConfirmMessage('auto', 2, ['DSH', 'Gemini'])

    expect(t).toContain('复制替换为副本')
    expect(t).toContain('创建符号链接')
    expect(t.endsWith('是否继续？')).toBe(true)
  })

  it('未知部署方式抛错', () => {
    expect(() => importConfirmMessage('mystery', 1, ['DSH'])).toThrow('未知的部署方式')
  })

  it('目标列表为空：文案改为“只入库不部署”，不出现空 harness 列表', () => {
    const t = importConfirmMessage('symlink', 2, [])

    expect(t).toContain('2 个 Skill')
    expect(t).toContain('只入库、不部署到任何 harness')
    expect(t).not.toContain('到。') // 不允许出现“部署到 。”的空列表残缺句
    expect(t.endsWith('是否继续？')).toBe(true)
  })
})
