// tests/agents-version.test.ts —— Dashboard 版本探测的纯函数（extractVersion / parseNpmLatestResponse / 元数据）
// 语义对齐 cc-switch commands/misc.rs：VERSION_RE:1013 提取、npm dist-tags.latest、npm_install_command_for:509。
import { describe, expect, it } from 'vitest'
import {
  AGENT_TOOL_META,
  extractVersion,
  parseNpmLatestResponse
} from '../src/main/services/agents-version'

describe('extractVersion', () => {
  it('从标准 CLI 输出提取版本号', () => {
    expect(extractVersion('claude-code/1.0.78 linux-x64 node-v20.18.1')).toBe('1.0.78')
    expect(extractVersion('Codex CLI 0.2.1\n')).toBe('0.2.1')
    expect(extractVersion('Gemini CLI 1.2.3 (latest)')).toBe('1.2.3')
  })

  it('提取带预发布后缀 / 前导 v 的版本号', () => {
    expect(extractVersion('2.1.156-beta.1')).toBe('2.1.156-beta.1')
    expect(extractVersion('v1.2.3')).toBe('1.2.3')
  })

  it('无版本号时返回 null', () => {
    expect(extractVersion('unknown')).toBeNull()
    expect(extractVersion('')).toBeNull()
    expect(extractVersion('command not found')).toBeNull()
  })
})

describe('parseNpmLatestResponse', () => {
  it('解析 npm /latest 响应（取 version 字段）', () => {
    expect(parseNpmLatestResponse({ name: 'claude-code', version: '1.0.78' })).toBe('1.0.78')
  })

  it('非对象 / 缺版本字段 / 空串返回 null', () => {
    expect(parseNpmLatestResponse(null)).toBeNull()
    expect(parseNpmLatestResponse('x')).toBeNull()
    expect(parseNpmLatestResponse({ name: 'x' })).toBeNull()
    expect(parseNpmLatestResponse({ version: '' })).toBeNull()
    expect(parseNpmLatestResponse({ version: 42 })).toBeNull()
  })
})

describe('AGENT_TOOL_META', () => {
  it('覆盖全部 7 个 agent 且 dsh 安装命令符合产品要求', () => {
    for (const id of ['dsh', 'claude', 'codex', 'gemini', 'grok', 'opencode', 'hermes'] as const) {
      expect(AGENT_TOOL_META[id]).toBeDefined()
      expect(AGENT_TOOL_META[id].bin.length).toBeGreaterThan(0)
      expect(AGENT_TOOL_META[id].npm.length).toBeGreaterThan(0)
      expect(AGENT_TOOL_META[id].install).toContain('npm')
    }
    expect(AGENT_TOOL_META.dsh.install).toBe('npm install -g @deepseek-ai/dsh')
  })
})
