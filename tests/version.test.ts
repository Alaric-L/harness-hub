// tests/version.test.ts —— 渲染层轻量 semver（镜像 cc-switch src/lib/version.ts）
// 用于 Dashboard 概览「是否有可用更新」判断：版本号是偏序关系，字符串不相等 ≠ 落后。
import { describe, expect, it } from 'vitest'
import { compareVersions, isUpdateAvailable } from '../src/renderer/version.js'

describe('compareVersions', () => {
  it('按主版本三段比较', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('1.2.4', '1.2.3')).toBe(1)
    expect(compareVersions('1.3.0', '1.2.9')).toBe(1)
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1)
    expect(compareVersions('1.2.3', '1.2.4')).toBe(-1)
  })

  it('预发布段：有预发布 < 无预发布；数字段按数值', () => {
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0-beta.1')).toBe(1)
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.1')).toBe(1)
    expect(compareVersions('1.0.0-beta.1', '1.0.0-beta.1')).toBe(0)
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.9')).toBe(1)
  })

  it('无法解析时保守返回 0', () => {
    expect(compareVersions('abc', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.0', '')).toBe(0)
    expect(compareVersions('', '')).toBe(0)
  })
})

describe('isUpdateAvailable', () => {
  it('latest 严格高于 current 才为 true', () => {
    expect(isUpdateAvailable('1.0.0', '1.0.1')).toBe(true)
    expect(isUpdateAvailable('1.0.1', '1.0.0')).toBe(false)
    expect(isUpdateAvailable('1.0.0', '1.0.0')).toBe(false)
  })

  it('本地抢先/预发布版反超 latest 时不提示更新', () => {
    expect(isUpdateAvailable('1.1.0-beta.1', '1.0.0')).toBe(false)
    expect(isUpdateAvailable('1.1.0', '1.0.0')).toBe(false)
  })

  it('current / latest 任一为空不提示', () => {
    expect(isUpdateAvailable(null, '1.0.0')).toBe(false)
    expect(isUpdateAvailable('1.0.0', null)).toBe(false)
    expect(isUpdateAvailable(undefined, undefined)).toBe(false)
    expect(isUpdateAvailable('', '1.0.0')).toBe(false)
  })
})
