// src/main/ipc.ts —— IPC API 契约全部 hub:<name> 通道注册（见任务文档「IPC API 契约」）
// 副作用模块：src/main/index.ts 顶层 `import './ipc'` 即完成全部注册，无需调用。
// 真实实现：getAppInit / getSettings / setSettings / setDirOverride 已接通 store；
// 其余通道按契约返回类型返回安全空默认值，由 D/E/F/G 块实现。
import { dialog, ipcMain } from 'electron'
import path from 'node:path'
import { AGENTS, dataFile, resolveAgentPaths, settingsFile, ssotSkillsDir } from './paths'
import { loadSettings, loadStore, saveSettings, saveStore } from './store'
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
  deletePrompt,
  disablePrompt,
  enablePrompt,
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

ipcMain.handle('hub:toggleSkill', async (_event, dir: string, agentId: AgentId, on: boolean) => {
  try {
    const data = loadStore(dataFile())
    const entry = data.skills.find((s) => s.dir === dir)
    if (!entry) throw new Error(`skill not found: ${dir}`)
    entry.apps = entry.apps ?? {}
    const settings = loadSettings(settingsFile())
    const r = resolveAgentPaths(agentId, settings.dirOverrides)
    if (on) {
      await deploySkill(ssotSkillsDir(), dir, r.skillsDir, settings.syncMethod)
      entry.apps[agentId] = true
    } else {
      await undeploySkill(path.join(r.skillsDir, dir))
      delete entry.apps[agentId]
    }
    await saveStore(dataFile(), data)
    return data.skills
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
    return { copiedTo: [] as AgentId[] } // TODO(Cx): 由 D/E/F/G 块实现
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

// ---- Harness 管理与设置 ----

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
    return null // TODO(Cx): 由 D/E/F/G 块实现（内部调 dialog.showOpenDialog）
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:exportData', async () => {
  try {
    return '' // TODO(Cx): 由 D/E/F/G 块实现
  } catch (err) {
    throw new Error(errMessage(err))
  }
})

ipcMain.handle('hub:importData', async () => {
  try {
    return '' // TODO(Cx): 由 D/E/F/G 块实现
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