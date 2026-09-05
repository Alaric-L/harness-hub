// tests/agents-version.test.ts —— Dashboard 版本探测的纯函数（extractVersion / parseNpmLatestResponse / probeZcode / 元数据）
// 语义对齐 cc-switch commands/misc.rs：VERSION_RE:1013 提取、npm dist-tags.latest、npm_install_command_for:509。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  AGENT_TOOL_META,
  extractVersion,
  installAgent,
  parseNpmLatestResponse,
  probeZcode
} from '../src/main/services/agents-version'

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agents-ver-'))
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

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
  it('覆盖全部 8 个 agent：CLI 型含 npm 包与安装命令，zcode 为桌面应用（null）', () => {
    for (const id of ['dsh', 'claude', 'codex', 'gemini', 'grok', 'opencode', 'hermes'] as const) {
      expect(AGENT_TOOL_META[id]).toBeDefined()
      expect(AGENT_TOOL_META[id].bin.length).toBeGreaterThan(0)
      expect(AGENT_TOOL_META[id].npm!.length).toBeGreaterThan(0)
      expect(AGENT_TOOL_META[id].install).toContain('npm')
    }
    expect(AGENT_TOOL_META.zcode).toEqual({ bin: 'zcode', npm: null, install: null })
    expect(AGENT_TOOL_META.dsh.install).toBe('npm install -g @deepseek-ai/dsh')
  })
})

describe('probeZcode', () => {
  it('配置目录存在 -> installed: true、version: null、无错误', async () => {
    const root = path.join(tmp, '.zcode')
    await fs.mkdir(root, { recursive: true })
    expect(probeZcode(root)).toEqual({ version: null, error: null, installed: true })
  })

  it('配置目录缺失 -> installed: false、错误信息含 ZCode 与路径', () => {
    const root = path.join(tmp, 'nope')
    const res = probeZcode(root)
    expect(res.installed).toBe(false)
    expect(res.version).toBeNull()
    expect(res.error).toContain('ZCode')
    expect(res.error).toContain(root)
  })
})

describe('installAgent zcode 拦截', () => {
  it('zcode 无安装渠道：抛可读错误（官网引导），不执行任何命令', async () => {
    await expect(installAgent('zcode')).rejects.toThrow(/ZCode 为桌面应用/)
  })
})
