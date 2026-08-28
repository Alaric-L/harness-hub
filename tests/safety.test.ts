import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { atomicWrite, backupFile } from '../src/main/safety'

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'safety-'))
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('backupFile', () => {
  it('备份不存在文件返回 null，且不创建备份目录', async () => {
    const backupDir = path.join(tmp, 'backups')
    const result = await backupFile(path.join(tmp, 'no-such-file.txt'), backupDir)

    expect(result).toBeNull()
    await expect(fs.access(backupDir)).rejects.toThrow()
  })

  it('备份已有文件：返回备份路径，内容与原文件一致，文件名含时间戳段', async () => {
    const src = path.join(tmp, 'config.json')
    const backupDir = path.join(tmp, 'backups')
    await fs.writeFile(src, '{"a":1}', 'utf8')

    const backupPath = await backupFile(src, backupDir)

    expect(backupPath).not.toBeNull()
    expect(path.basename(backupPath!)).toMatch(/^config\.json\.\d{8}-\d{6}\.bak$/)
    expect(await fs.readFile(backupPath!, 'utf8')).toBe('{"a":1}')
    // 原文件不动
    expect(await fs.readFile(src, 'utf8')).toBe('{"a":1}')
  })
})

describe('atomicWrite', () => {
  it('原子写入成功：内容正确且无 .tmp 残留', async () => {
    const file = path.join(tmp, 'target.txt')
    await atomicWrite(file, 'hello world')

    expect(await fs.readFile(file, 'utf8')).toBe('hello world')
    await expect(fs.access(file + '.tmp')).rejects.toThrow()
  })

  it('父目录不存在时自动递归创建（对齐 cc-switch write_text_file）', async () => {
    const file = path.join(tmp, 'nested', 'deeper', 'target.json')
    await atomicWrite(file, '{"ok":true}')

    expect(await fs.readFile(file, 'utf8')).toBe('{"ok":true}')
  })

  it('validate 抛错时不破坏原文件，且无 .tmp 残留', async () => {
    const file = path.join(tmp, 'target.txt')
    await fs.writeFile(file, 'original', 'utf8')

    await expect(
      atomicWrite(file, 'bad content', (s) => {
        if (s === 'bad content') throw new Error('invalid')
      })
    ).rejects.toThrow('invalid')

    expect(await fs.readFile(file, 'utf8')).toBe('original')
    await expect(fs.access(file + '.tmp')).rejects.toThrow()
  })
})
