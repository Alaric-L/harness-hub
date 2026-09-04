/* ================= 状态（跨模块共享；用对象属性读写，避免 ES module let 导出坑） ================= */
export const state = {
  currentView: 'dashboard',
  skillsTab: 'installed',
  discSource: 'repos',
  currentPromptAgent: 'dsh',
  agents: null,          // getAppInit().agents（G1 起填充，G3 消费）
  settings: null,        // getAppInit().settings（G1 起填充，G3 消费）
  agentVersions: null,   // hub.getAgentVersions() 返回的版本探测结果（Dashboard 概览；null=尚未加载）
  agentsDetailed: null,  // hub.getAgentsDetailed() 返回 {agents, resolved}（G3 新增：真实解析路径）
  promptsByAgent: {},    // hub.listPrompts/savePrompt/applyPrompt/... 返回的每 harness 提示词库（v2 起不再内置激活状态）
  promptSnapshots: {},   // getPromptSnapshot/saveLivePrompt/applyPrompt 返回的每 harness 快照
  promptFormIntent: null, // { applyAfterSave: boolean } | null
  mcpItems: [],          // IPC listMcp/saveMcp/toggleMcp/... 返回的统一库（不再内置 mock）
  skillsItems: [],       // IPC listSkills/toggleSkill/uninstallSkill/importSkills/... 返回的统一库（G2 起不再内置 mock）
  skillBackups: [],      // IPC listSkillBackups 返回的备份列表
  unmanagedSkills: [],   // IPC listUnmanagedSkills 返回的未纳管列表
  skillRepos: [],        // IPC listRepos/addRepo/removeRepo 返回的仓库配置
  discoveredSkills: null, // 发现页仓库模式缓存（null=尚未加载）
  shSkills: [],          // 发现页 skills.sh 模式缓存
  mcpQuery: '',
  skillQuery: '',
  discQuery: '',
  discRepo: 'all',
  discStatus: 'all',
  mcpEditingId: null,
  promptEditing: null,   // {agentId, id} | null
  copySourcePrompt: null,
  confirmCb: null,
  detailCtx: null,       // {kind, id}
  wizType: 'stdio',
  toastTimer: null,
};
