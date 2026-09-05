import { describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  AGENTS,
  agentsSharedRoot,
  agentsSharedSkillsDir,
  dataRoot,
  ssotSkillsDir,
  skillBackupsDir,
  fileBackupDir,
  dataFile,
  settingsFile,
  resolveAgentPaths,
  resolveSkillsTargetDir
} from '../src/main/paths'

// 注入式 home：Windows 下优先 USERPROFILE
const HOME = 'C:\\Users\\tester'
const WIN_ENV = { HOME: '/home/tester', USERPROFILE: HOME }

describe('dataRoot 与数据目录拼接', () => {
  it('Windows 下用 USERPROFILE 返回 <home>/.harness-hub', () => {
    expect(dataRoot(WIN_ENV)).toBe(path.join(HOME, '.harness-hub'))
  })

  it('无 USERPROFILE 时回退 HOME', () => {
    expect(dataRoot({ HOME: '/home/tester' })).toBe(path.join('/home/tester', '.harness-hub'))
  })

  it('USERPROFILE 优先于 HOME', () => {
    expect(dataRoot({ HOME: '/wrong', USERPROFILE: HOME })).toBe(path.join(HOME, '.harness-hub'))
  })

  it('ssotSkillsDir / skillBackupsDir / fileBackupDir / dataFile / settingsFile 拼接正确', () => {
    const root = path.join(HOME, '.harness-hub')
    expect(ssotSkillsDir(WIN_ENV)).toBe(path.join(root, 'skills'))
    expect(skillBackupsDir(WIN_ENV)).toBe(path.join(root, 'skill-backups'))
    expect(fileBackupDir(WIN_ENV)).toBe(path.join(root, 'backups'))
    expect(dataFile(WIN_ENV)).toBe(path.join(root, 'data.json'))
    expect(settingsFile(WIN_ENV)).toBe(path.join(root, 'settings.json'))
  })
})

describe('AGENTS 常量', () => {
  it('包含 8 个 harness 且顺序固定 DSH 置顶', () => {
    expect(AGENTS.map((a) => a.id)).toEqual([
      'dsh',
      'opencode',
      'zcode',
      'codex',
      'claude',
      'grok',
      'gemini',
      'hermes'
    ])
  })

  it('各项默认落点（dir/mcpPath/mcpFormat/skillsDir/promptFile）与全局约束第 9 条一致', () => {
    const expected: Record<
      string,
      { dir: string; mcpPath: string; mcpFormat: string; skillsDir: string; promptFile: string }
    > = {
      dsh: {
        dir: '~/.dsh',
        mcpPath: '~/.dsh/profiles/web/cordis.patch.yml',
        mcpFormat: 'yaml-patch',
        skillsDir: '~/.dsh/skills',
        promptFile: '~/.dsh/AGENTS.md'
      },
      claude: {
        dir: '~/.claude',
        mcpPath: '~/.claude.json',
        mcpFormat: 'json',
        skillsDir: '~/.claude/skills',
        promptFile: '~/.claude/CLAUDE.md'
      },
      codex: {
        dir: '~/.codex',
        mcpPath: '~/.codex/config.toml',
        mcpFormat: 'toml',
        skillsDir: '~/.codex/skills',
        promptFile: '~/.codex/AGENTS.md'
      },
      gemini: {
        dir: '~/.gemini',
        mcpPath: '~/.gemini/settings.json',
        mcpFormat: 'json',
        skillsDir: '~/.gemini/skills',
        promptFile: '~/.gemini/GEMINI.md'
      },
      grok: {
        dir: '~/.grok',
        mcpPath: '~/.grok/config.toml',
        mcpFormat: 'toml',
        skillsDir: '~/.grok/skills',
        promptFile: '~/.grok/AGENTS.md'
      },
      opencode: {
        dir: '~/.config/opencode',
        mcpPath: '~/.config/opencode/opencode.json',
        mcpFormat: 'json',
        skillsDir: '~/.config/opencode/skills',
        promptFile: '~/.config/opencode/AGENTS.md'
      },
      zcode: {
        dir: '~/.zcode',
        mcpPath: '~/.zcode/cli/config.json',
        mcpFormat: 'json',
        skillsDir: '~/.zcode/skills',
        promptFile: '~/.zcode/AGENTS.md'
      },
      hermes: {
        dir: '~/.hermes',
        mcpPath: '~/.hermes/config.yaml',
        mcpFormat: 'yaml',
        skillsDir: '~/.hermes/skills',
        promptFile: '~/.hermes/SOUL.md'
      }
    }
    expect(AGENTS).toHaveLength(8)
    for (const a of AGENTS) {
      expect({
        dir: a.dir,
        mcpPath: a.mcpPath,
        mcpFormat: a.mcpFormat,
        skillsDir: a.skillsDir,
        promptFile: a.promptFile
      }).toEqual(expected[a.id])
    }
  })
})

describe('resolveAgentPaths 默认（无覆盖）', () => {
  it('dsh -> 默认绝对路径', () => {
    expect(resolveAgentPaths('dsh', {}, WIN_ENV)).toEqual({
      root: path.join(HOME, '.dsh'),
      mcpPath: path.join(HOME, '.dsh', 'profiles', 'web', 'cordis.patch.yml'),
      skillsDir: path.join(HOME, '.dsh', 'skills'),
      promptFile: path.join(HOME, '.dsh', 'AGENTS.md')
    })
  })

  it('claude -> MCP 落点 ~/.claude.json 在配置目录外', () => {
    expect(resolveAgentPaths('claude', {}, WIN_ENV)).toEqual({
      root: path.join(HOME, '.claude'),
      mcpPath: path.join(HOME, '.claude.json'),
      skillsDir: path.join(HOME, '.claude', 'skills'),
      promptFile: path.join(HOME, '.claude', 'CLAUDE.md')
    })
  })

  it('codex / gemini / grok / opencode / hermes 默认落点', () => {
    expect(resolveAgentPaths('codex', {}, WIN_ENV)).toEqual({
      root: path.join(HOME, '.codex'),
      mcpPath: path.join(HOME, '.codex', 'config.toml'),
      skillsDir: path.join(HOME, '.codex', 'skills'),
      promptFile: path.join(HOME, '.codex', 'AGENTS.md')
    })
    expect(resolveAgentPaths('gemini', {}, WIN_ENV)).toEqual({
      root: path.join(HOME, '.gemini'),
      mcpPath: path.join(HOME, '.gemini', 'settings.json'),
      skillsDir: path.join(HOME, '.gemini', 'skills'),
      promptFile: path.join(HOME, '.gemini', 'GEMINI.md')
    })
    expect(resolveAgentPaths('grok', {}, WIN_ENV)).toEqual({
      root: path.join(HOME, '.grok'),
      mcpPath: path.join(HOME, '.grok', 'config.toml'),
      skillsDir: path.join(HOME, '.grok', 'skills'),
      promptFile: path.join(HOME, '.grok', 'AGENTS.md')
    })
    expect(resolveAgentPaths('opencode', {}, WIN_ENV)).toEqual({
      root: path.join(HOME, '.config', 'opencode'),
      mcpPath: path.join(HOME, '.config', 'opencode', 'opencode.json'),
      skillsDir: path.join(HOME, '.config', 'opencode', 'skills'),
      promptFile: path.join(HOME, '.config', 'opencode', 'AGENTS.md')
    })
    expect(resolveAgentPaths('hermes', {}, WIN_ENV)).toEqual({
      root: path.join(HOME, '.hermes'),
      mcpPath: path.join(HOME, '.hermes', 'config.yaml'),
      skillsDir: path.join(HOME, '.hermes', 'skills'),
      promptFile: path.join(HOME, '.hermes', 'SOUL.md')
    })
    expect(resolveAgentPaths('zcode', {}, WIN_ENV)).toEqual({
      root: path.join(HOME, '.zcode'),
      mcpPath: path.join(HOME, '.zcode', 'cli', 'config.json'),
      skillsDir: path.join(HOME, '.zcode', 'skills'),
      promptFile: path.join(HOME, '.zcode', 'AGENTS.md')
    })
  })
})

describe('resolveAgentPaths 目录覆盖', () => {
  it('dsh 覆盖 D:\\x -> 三类落点根替换为覆盖目录', () => {
    const o = resolveAgentPaths('dsh', { dsh: 'D:\\x' }, WIN_ENV)
    expect(o.root).toBe('D:\\x')
    expect(o.mcpPath).toBe(path.join('D:\\x', 'profiles', 'web', 'cordis.patch.yml'))
    expect(o.skillsDir).toBe(path.join('D:\\x', 'skills'))
    expect(o.promptFile).toBe(path.join('D:\\x', 'AGENTS.md'))
  })

  it('claude 覆盖 D:\\y -> MCP 落点 = <覆盖>/.claude.json（文件移入覆盖目录保留原名）', () => {
    const o = resolveAgentPaths('claude', { claude: 'D:\\y' }, WIN_ENV)
    expect(o.root).toBe('D:\\y')
    expect(o.mcpPath).toBe(path.join('D:\\y', '.claude.json'))
    expect(o.skillsDir).toBe(path.join('D:\\y', 'skills'))
    expect(o.promptFile).toBe(path.join('D:\\y', 'CLAUDE.md'))
  })

  it('覆盖只影响指定 agent，其他 agent 仍走默认', () => {
    const overrides = { dsh: 'D:\\x' }
    // claude 未覆盖，保持默认（root 仍是 <home>/.claude，mcpPath 仍在 home 下）
    expect(resolveAgentPaths('claude', overrides, WIN_ENV)).toEqual({
      root: path.join(HOME, '.claude'),
      mcpPath: path.join(HOME, '.claude.json'),
      skillsDir: path.join(HOME, '.claude', 'skills'),
      promptFile: path.join(HOME, '.claude', 'CLAUDE.md')
    })
    // 被覆盖的 dsh 生效
    expect(resolveAgentPaths('dsh', overrides, WIN_ENV).mcpPath).toBe(
      path.join('D:\\x', 'profiles', 'web', 'cordis.patch.yml')
    )
  })

  it('zcode 覆盖 D:\\z -> MCP 落点 = <覆盖>/cli/config.json（相对结构保留，无特例）', () => {
    const o = resolveAgentPaths('zcode', { zcode: 'D:\\z' }, WIN_ENV)
    expect(o.root).toBe('D:\\z')
    expect(o.mcpPath).toBe(path.join('D:\\z', 'cli', 'config.json'))
    expect(o.skillsDir).toBe(path.join('D:\\z', 'skills'))
    expect(o.promptFile).toBe(path.join('D:\\z', 'AGENTS.md'))
  })
})

describe('Agent Skills 共享目录路径', () => {
  it('agentsSharedRoot / agentsSharedSkillsDir 拼接 <home>/.agents 与 <home>/.agents/skills', () => {
    expect(agentsSharedRoot(WIN_ENV)).toBe(path.join(HOME, '.agents'))
    expect(agentsSharedSkillsDir(WIN_ENV)).toBe(path.join(HOME, '.agents', 'skills'))
  })

  it('resolveSkillsTargetDir：shared -> <home>/.agents/skills，不受 dirOverrides 影响', () => {
    expect(resolveSkillsTargetDir('shared', { dsh: 'D:\\x' }, WIN_ENV)).toBe(
      path.join(HOME, '.agents', 'skills')
    )
  })

  it('resolveSkillsTargetDir：harness id -> resolveAgentPaths().skillsDir（含覆盖）', () => {
    expect(resolveSkillsTargetDir('dsh', { dsh: 'D:\\x' }, WIN_ENV)).toBe(path.join('D:\\x', 'skills'))
    expect(resolveSkillsTargetDir('claude', {}, WIN_ENV)).toBe(path.join(HOME, '.claude', 'skills'))
  })

  it('resolveSkillsTargetDir：未知 id 抛错（与 resolveAgentPaths 同文案）', () => {
    expect(() => resolveSkillsTargetDir('bogus' as never, {}, WIN_ENV)).toThrow(/未知 agent id/)
  })
})
