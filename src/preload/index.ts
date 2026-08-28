// src/preload/index.ts —— contextBridge 暴露 window.hub（IPC API 契约全部 38 个通道）
// 每个方法体 = ipcRenderer.invoke('hub:' + name, ...args)，均返回 Promise；
// 错误由 ipcMain.handle 统一 reject Error（渲染层 toast 展示用）。
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('hub', {
  // 启动
  getAppInit: (...args: unknown[]) => ipcRenderer.invoke('hub:getAppInit', ...args),
  // MCP
  listMcp: (...args: unknown[]) => ipcRenderer.invoke('hub:listMcp', ...args),
  saveMcp: (...args: unknown[]) => ipcRenderer.invoke('hub:saveMcp', ...args),
  deleteMcp: (...args: unknown[]) => ipcRenderer.invoke('hub:deleteMcp', ...args),
  toggleMcp: (...args: unknown[]) => ipcRenderer.invoke('hub:toggleMcp', ...args),
  bulkToggleMcp: (...args: unknown[]) => ipcRenderer.invoke('hub:bulkToggleMcp', ...args),
  importMcpFromHarnesses: (...args: unknown[]) => ipcRenderer.invoke('hub:importMcpFromHarnesses', ...args),
  previewMcp: (...args: unknown[]) => ipcRenderer.invoke('hub:previewMcp', ...args),
  // Skills
  listSkills: (...args: unknown[]) => ipcRenderer.invoke('hub:listSkills', ...args),
  toggleSkill: (...args: unknown[]) => ipcRenderer.invoke('hub:toggleSkill', ...args),
  uninstallSkill: (...args: unknown[]) => ipcRenderer.invoke('hub:uninstallSkill', ...args),
  listSkillBackups: (...args: unknown[]) => ipcRenderer.invoke('hub:listSkillBackups', ...args),
  restoreSkillBackup: (...args: unknown[]) => ipcRenderer.invoke('hub:restoreSkillBackup', ...args),
  deleteSkillBackup: (...args: unknown[]) => ipcRenderer.invoke('hub:deleteSkillBackup', ...args),
  installSkillZip: (...args: unknown[]) => ipcRenderer.invoke('hub:installSkillZip', ...args),
  listUnmanagedSkills: (...args: unknown[]) => ipcRenderer.invoke('hub:listUnmanagedSkills', ...args),
  importSkills: (...args: unknown[]) => ipcRenderer.invoke('hub:importSkills', ...args),
  checkSkillUpdates: (...args: unknown[]) => ipcRenderer.invoke('hub:checkSkillUpdates', ...args),
  updateSkill: (...args: unknown[]) => ipcRenderer.invoke('hub:updateSkill', ...args),
  // 发现
  listDiscoveryRepos: (...args: unknown[]) => ipcRenderer.invoke('hub:listDiscoveryRepos', ...args),
  searchSkillsSh: (...args: unknown[]) => ipcRenderer.invoke('hub:searchSkillsSh', ...args),
  listRepos: (...args: unknown[]) => ipcRenderer.invoke('hub:listRepos', ...args),
  addRepo: (...args: unknown[]) => ipcRenderer.invoke('hub:addRepo', ...args),
  removeRepo: (...args: unknown[]) => ipcRenderer.invoke('hub:removeRepo', ...args),
  installSkillFromRepo: (...args: unknown[]) => ipcRenderer.invoke('hub:installSkillFromRepo', ...args),
  installSkillFromSh: (...args: unknown[]) => ipcRenderer.invoke('hub:installSkillFromSh', ...args),
  // 提示词
  listPrompts: (...args: unknown[]) => ipcRenderer.invoke('hub:listPrompts', ...args),
  savePrompt: (...args: unknown[]) => ipcRenderer.invoke('hub:savePrompt', ...args),
  deletePrompt: (...args: unknown[]) => ipcRenderer.invoke('hub:deletePrompt', ...args),
  enablePrompt: (...args: unknown[]) => ipcRenderer.invoke('hub:enablePrompt', ...args),
  disablePrompt: (...args: unknown[]) => ipcRenderer.invoke('hub:disablePrompt', ...args),
  copyPrompt: (...args: unknown[]) => ipcRenderer.invoke('hub:copyPrompt', ...args),
  // Harness 管理与设置
  setDirOverride: (...args: unknown[]) => ipcRenderer.invoke('hub:setDirOverride', ...args),
  browseDir: (...args: unknown[]) => ipcRenderer.invoke('hub:browseDir', ...args),
  exportData: (...args: unknown[]) => ipcRenderer.invoke('hub:exportData', ...args),
  importData: (...args: unknown[]) => ipcRenderer.invoke('hub:importData', ...args),
  getSettings: (...args: unknown[]) => ipcRenderer.invoke('hub:getSettings', ...args),
  setSettings: (...args: unknown[]) => ipcRenderer.invoke('hub:setSettings', ...args)
})