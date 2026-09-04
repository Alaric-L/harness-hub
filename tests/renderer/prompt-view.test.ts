// tests/renderer/prompt-view.test.ts —— v2 提示词页纯函数：状态、时间、diff 与 Dashboard 计数
import { describe, expect, it } from 'vitest'
import {
  formatPromptMtime,
  liveStatusText,
  promptDiffText,
  savedPromptCount
} from '../../src/renderer/ui/prompt-view.js'

const prompts = [
  { id: 'p1', name: '默认助手', content: 'SAME', createdAt: 1, updatedAt: 1 },
  { id: 'p2', name: '重复条目', content: 'SAME', createdAt: 2, updatedAt: 2 },
  { id: 'p3', name: '精简模式', content: 'OTHER', createdAt: 3, updatedAt: 3 }
]

describe('liveStatusText', () => {
  it('文件不存在显示未找到指令文件', () => {
    expect(liveStatusText({ exists: false, content: '', matchedIds: [] }, prompts))
      .toBe('未找到指令文件')
  })

  it('文件为空显示文件为空', () => {
    expect(liveStatusText({ exists: true, content: '', matchedIds: [] }, prompts))
      .toBe('文件为空')
  })

  it('单条匹配显示与该条一致', () => {
    expect(liveStatusText({ exists: true, content: 'OTHER', matchedIds: ['p3'] }, prompts))
      .toBe('与「精简模式」一致')
  })

  it('多条匹配显示等 N 条一致', () => {
    expect(liveStatusText({ exists: true, content: 'SAME', matchedIds: ['p1', 'p2'] }, prompts))
      .toBe('与「默认助手」等 2 条一致')
  })

  it('无匹配显示自定义内容', () => {
    expect(liveStatusText({ exists: true, content: 'NEW', matchedIds: [] }, prompts))
      .toBe('自定义内容（未保存）')
  })
})

describe('formatPromptMtime', () => {
  it('缺失时返回未知，存在时返回本地时间字符串', () => {
    expect(formatPromptMtime(null)).toBe('未知')
    const text = formatPromptMtime(new Date(2026, 8, 3, 14, 22).getTime())
    expect(text).toContain('2026/9/3')
    expect(text).toContain('14:22')
  })
})

describe('promptDiffText', () => {
  it('输出删除当前行、新增 saved 行与共同行', () => {
    expect(promptDiffText('A\nB\nC', 'A\nD\nC')).toBe([
      '  A',
      '- B',
      '+ D',
      '  C'
    ].join('\n'))
  })

  it('当前内容为空时全部 saved 行为新增', () => {
    expect(promptDiffText('', 'A\nB')).toBe('+ A\n+ B')
  })
})

describe('savedPromptCount', () => {
  it('汇总各 harness saved 记录数量', () => {
    expect(savedPromptCount({
      dsh: prompts,
      claude: [prompts[0]],
      codex: undefined
    })).toBe(4)
  })
})