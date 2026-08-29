// src/main/ipc.ts —— IPC API 契约全部 hub:<name> 通道注册（见任务文档「IPC API 契约」）
// 副作用模块：src/main/index.ts 顶层 `import './ipc'` 即完成全部注册，无需调用。
// 真实实现：getAppInit / getSettings / setSettings / setDirOverride / exportData / importData
// 已接通 store 与 data-io；其余通道按契约返回类型返回安全空默认值，由 D/E/F/G 块实现。
import fs from 'node:fs/promises'
import { dialog, ipcMain } from 'electron'
import path from 'node:path'
import {
  AGENTS,
  dataFile,
  fileBackupDir,
  resolveAgentPaths,
  settingsFile,
  ssotSkillsDir
} from './paths'
import { loadSettings, loadStore, saveSettings, saveStore } from './store'
import type { StoreData } from './store'
import { applyImport, buildExportPayload, snapshotBeforeImport, validateBackup } from './data-io'
import {
  bulkToggleMcp,
  deleteMcp,
  importMcpFromHarnesses,
  listMcp,
  previewMcp,
  saveMcp,
  toggleMcp
} from './services/mcp'
import {
  copyPrompt,
  deletePrompt,
  disablePrompt,
  enablePrompt,
  importPromptsFromHarnesses,
  listPrompts,
  savePrompt
} from './services/prompts'
import {
  addRepo,
  checkSkillUpdates,
  installSkillFromRepo,
  installSkillFromSh,
  listDiscoveryRepos,
  listRepos,
  removeRepo,
  searchSkillsSh,
  updateSkill
} from './services/discovery'
import { deploySkill, undeploySkill, uninstallSkill } from './services/skills'
import { assertAgentRoot } from './services/agent-root'
import { getAgentVersions, installAgent } from './services/agents-version'
import {
  deleteSkillBackup,
  importSkills,
  installSkillZip,
  listSkillBackups,
  listUnmanagedSkills,
  restoreSkillBackup
} from './services/skill-io'
import type {
  AgentId,
  AppSettings,
  McpItem,
  PromptItem,
  SkillInstalled
} from './types'

/** 统一错误处理：任意异常转为可读消息（渲染层 toast 展示用） */
function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ---- 启动 ----

ipcMain.handle('hub:getAppInit', async () => {
  try {
    // loadSettings 为同步函数，直接调用（store.ts）；返回 7 agents + settings
    return { agents: AGENTS, settings: loadSettings(settingsFile()) }
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

// ---- Harness 版本探测 / 安装（Dashboard 概览） ----

ipcMain.handle('hub:getAgentVersions', async (_event, ids?: AgentId[]) => {
  try {
    return await getAgentVersions(ids)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:installAgent', async (_event, agentId: AgentId) => {
  try {
    return await installAgent(agentId)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

// ---- MCP ----

ipcMain.handle('hub:listMcp', async () => {
  try {
    return listMcp()
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:saveMcp', async (_event, item: McpItem, prevApps?: Record<AgentId, boolean>) => {
  try {
    return await saveMcp(item, prevApps)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:deleteMcp', async (_event, id: string) => {
  try {
    return await deleteMcp(id)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:toggleMcp', async (_event, id: string, agentId: AgentId, on: boolean) => {
  try {
    return await toggleMcp(id, agentId, on)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:bulkToggleMcp', async (_event, agentId: AgentId, on: boolean) => {
  try {
    return await bulkToggleMcp(agentId, on)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:importMcpFromHarnesses', async () => {
  try {
    return await importMcpFromHarnesses()
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:previewMcp', async (_event, id: string, agentId: AgentId) => {
  try {
    return await previewMcp(id, agentId)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

// ---- Skills ----

ipcMain.handle('hub:listSkills', async () => {
  try {
    return loadStore(dataFile()).skills
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

/** 单个 skill 的部署/移除语义（toggleSkill 与 bulkToggleSkill 共用；错误由调用方聚合） */
async function toggleSkillOne(
  data: StoreData,
  entry: SkillInstalled,
  agentId: AgentId,
  on: boolean
): Promise<void> {
  entry.apps = entry.apps ?? {}
  const settings = loadSettings(settingsFile())
  // 部署前检查该 harness 的最外层配置目录存在（目录覆盖已生效）；关闭方向无需检查
  const r = on ? assertAgentRoot(agentId, settings.dirOverrides) : resolveAgentPaths(agentId, settings.dirOverrides)
  if (on) {
    await deploySkill(ssotSkillsDir(), entry.dir, r.skillsDir, settings.syncMethod)
    entry.apps[agentId] = true
  } else {
    await undeploySkill(path.join(r.skillsDir, entry.dir))
    delete entry.apps[agentId]
  }
}

ipcMain.handle('hub:toggleSkill', async (_event, dir: string, agentId: AgentId, on: boolean) => {
  try {
    const data = loadStore(dataFile())
    const entry = data.skills.find((s) => s.dir === dir)
    if (!entry) throw new Error(`skill not found: ${dir}`)
    await toggleSkillOne(data, entry, agentId, on)
    await saveStore(dataFile(), data)
    return data.skills
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:bulkToggleSkill', async (_event, agentId: AgentId, on: boolean) => {
  try {
    const data = loadStore(dataFile())
    // 错误聚合：单条失败不中断，收集后返回，避免中途放弃
    const errors: string[] = []
    for (const entry of data.skills) {
      try {
        await toggleSkillOne(data, entry, agentId, on)
      } catch (err) {
        errors.push(`${entry.dir}: ${errMessage(err)}`)
      }
    }
    await saveStore(dataFile(), data)
    return { skills: data.skills, errors }
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:uninstallSkill', async (_event, dir: string) => {
  try {
    return await uninstallSkill(dir)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:listSkillBackups', async () => {
  try {
    return listSkillBackups()
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:restoreSkillBackup', async (_event, backupId: string, deploy: boolean) => {
  try {
    return await restoreSkillBackup(backupId, deploy)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:deleteSkillBackup', async (_event, backupId: string) => {
  try {
    return await deleteSkillBackup(backupId)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:installSkillZip', async () => {
  try {
    const res = await dialog.showOpenDialog({
      title: '选择 Skill ZIP 文件',
      properties: ['openFile'],
      filters: [{ name: 'ZIP 归档', extensions: ['zip'] }]
    })
    if (res.canceled || !res.filePaths[0]) return [] as SkillInstalled[] // 用户取消：渲染层安静处理
    return await installSkillZip(res.filePaths[0])
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:listUnmanagedSkills', async () => {
  try {
    return listUnmanagedSkills()
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle(
  'hub:importSkills',
  async (_event, items: { dir: string; apps: Partial<Record<AgentId, boolean>> }[]) => {
    try {
      return await importSkills(items)
    } catch (err) {
      throw new Error(errMessage(err))
    }
  }
)

ipcMain.handle('hub:checkSkillUpdates', async () => {
  try {
    return await checkSkillUpdates()
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:updateSkill', async (_event, dir: string) => {
  try {
    return await updateSkill(dir)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

// ---- 发现 ----

ipcMain.handle('hub:listDiscoveryRepos', async () => {
  try {
    return await listDiscoveryRepos()
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:searchSkillsSh', async (_event, q: string) => {
  try {
    return await searchSkillsSh(q)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:listRepos', async () => {
  try {
    return listRepos()
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:addRepo', async (_event, url: string, branch: string) => {
  try {
    return await addRepo(url, branch)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:removeRepo', async (_event, owner: string, name: string) => {
  try {
    return await removeRepo(owner, name)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle(
  'hub:installSkillFromRepo',
  async (_event, owner: string, repo: string, branch: string, skillDir: string) => {
    try {
      return await installSkillFromRepo(owner, repo, branch, skillDir)
    } catch (err) {
      throw new Error(errMessage(err))
    }
  }
)

ipcMain.handle('hub:installSkillFromSh', async (_event, key: string, repo: string) => {
  try {
    return await installSkillFromSh(key, repo)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

// ---- 提示词 ----

ipcMain.handle('hub:listPrompts', async (_event, agentId: AgentId) => {
  try {
    return listPrompts(agentId)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:savePrompt', async (_event, agentId: AgentId, item: PromptItem) => {
  try {
    return await savePrompt(agentId, item)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:deletePrompt', async (_event, agentId: AgentId, id: string) => {
  try {
    return await deletePrompt(agentId, id)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:enablePrompt', async (_event, agentId: AgentId, id: string) => {
  try {
    return await enablePrompt(agentId, id)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:disablePrompt', async (_event, agentId: AgentId) => {
  try {
    return await disablePrompt(agentId)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:copyPrompt', async (_event, agentId: AgentId, id: string, targets: AgentId[]) => {
  try {
    return await copyPrompt(agentId, id, targets)
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:importPromptsFromHarnesses', async () => {
  try {
    return await importPromptsFromHarnesses()
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

// ---- Harness 管理与设置 ----

// G3 新增（IPC API 契约扩展）：返回模板 agents + 各 harness 经 resolveAgentPaths 解析后的真实绝对路径。
// 供 Harness 管理页展示与目录覆盖后的全量刷新（提示词页头部真实指令文件路径亦取自此）。
ipcMain.handle('hub:getAgentsDetailed', async () => {
  try {
    const settings = loadSettings(settingsFile())
    const resolved = {} as Record<AgentId, ReturnType<typeof resolveAgentPaths>>
    for (const a of AGENTS) resolved[a.id] = resolveAgentPaths(a.id, settings.dirOverrides)
    return { agents: AGENTS, resolved }
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:setDirOverride', async (_event, agentId: AgentId, dir: string | null) => {
  try {
    const settings = loadSettings(settingsFile())
    if (dir === null) {
      delete settings.dirOverrides[agentId]
    } else {
      settings.dirOverrides[agentId] = dir
    }
    await saveSettings(settingsFile(), settings)
    return settings
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:browseDir', async (_event, agentId: AgentId) => {
  try {
    const res = await dialog.showOpenDialog({
      title: `选择 ${agentId} 的配置目录`,
      properties: ['openDirectory']
    })
    // 用户取消：返回 null（渲染层安静处理，不填回输入框）
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0]
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:exportData', async (_event, filePath?: string) => {
  try {
    const payload = buildExportPayload(loadStore(dataFile()), loadSettings(settingsFile()))
    // 传入 filePath 则直接写入（自动化/smoke 用）；否则弹 save dialog（人工路径）
    let target = filePath
    if (!target) {
      const res = await dialog.showSaveDialog({
        title: '导出 HarnessHub 配置',
        defaultPath: 'harness-hub-backup.json',
        filters: [{ name: 'JSON 备份', extensions: ['json'] }]
      })
      if (res.canceled || !res.filePath) return '' // 用户取消：渲染层安静处理
      target = res.filePath
    }
    await fs.writeFile(target, JSON.stringify(payload, null, 2), 'utf8')
    return target
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:importData', async (_event, filePath?: string) => {
  try {
    // 传入 filePath 则直接使用（自动化/smoke 用）；否则弹 open dialog（人工路径）
    let src = filePath
    if (!src) {
      const res = await dialog.showOpenDialog({
        title: '选择 HarnessHub 备份文件',
        properties: ['openFile'],
        filters: [{ name: 'JSON 备份', extensions: ['json'] }]
      })
      if (res.canceled || !res.filePaths[0]) return '' // 用户取消
      src = res.filePaths[0]
    }
    // 1) 解析校验（不破坏现有数据：校验失败直接抛错，原文件不动）
    const payload = validateBackup(await fs.readFile(src, 'utf8'))
    // 2) 导入前快照：当前 data/settings 复制到 <fileBackupDir>/<name>-<ts>.preimport.bak
    await snapshotBeforeImport(dataFile(), settingsFile(), fileBackupDir())
    // 3) 校验通过才覆盖写回（原子写入 + JSON 回验）
    await applyImport(payload, dataFile(), settingsFile())
    return 'ok'
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:getSettings', async () => {
  try {
    return loadSettings(settingsFile())
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:setSettings', async (_event, s: AppSettings) => {
  try {
    await saveSettings(settingsFile(), s)
    return s
  } catch (err) {
    throw new Error(errMessage(err))
  }
})