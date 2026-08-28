/* ================= 状态（跨模块共享；用对象属性读写，避免 ES module let 导出坑） ================= */
export const state = {
  currentView: 'dashboard',
  skillsTab: 'installed',
  discSource: 'repos',
  currentPromptAgent: 'dsh',
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