/* ================= 聚合入口（B2：主视图 mock 渲染 / B3：表单与弹窗全量初始化 / G1：启动接真实后端 / G3：getAgentsDetailed + 提示词库全量加载） ================= */
import { state } from './state.js';
import { AGENTS, AGENT_BY } from './data.js';
import { $, showToast } from './ui/common.js';
import { renderSidebarAgents } from './ui/sidebar.js';
import { renderDashboard } from './ui/dashboard.js';
import { renderCountBar, renderMatrix, applyMatrixFilters } from './ui/matrix.js';
import { renderPrompts } from './ui/prompts.js';
import { renderAgents } from './ui/agents.js';
import { renderDiscovery } from './ui/skills.js';
import './ui/wizard.js';
import './ui/settings.js';

/* ================= 视图切换 ================= */
const viewMeta = {
  dashboard:{title:'Dashboard', sub:'8 个 harness 的配置总览', search:false},
  mcp:{title:'MCP 服务', sub:'统一管理 MCP 配置，按 harness 一键开关并写入各自配置文件', search:false},
  skills:{title:'Skills', sub:'中央库安装与分发，支持仓库发现、更新与备份', search:true},
  prompts:{title:'提示词', sub:'当前指令文件与已保存提示词库分层管理', search:false},
  agents:{title:'Harness 管理', sub:'各 harness 的配置落点与目录覆盖', search:false},
  settings:{title:'设置', sub:'数据备份、导入导出与全局选项', search:false},
};

document.querySelectorAll('.nav-item[data-view]').forEach(btn=>{
  btn.addEventListener('click', ()=> switchView(btn.dataset.view));
});
function switchView(v){
  state.currentView = v;
  document.querySelectorAll('.nav-item[data-view]').forEach(b=>b.classList.toggle('active', b.dataset.view===v));
  document.querySelectorAll('.view').forEach(el=>el.classList.remove('active'));
  $('view-'+v).classList.add('active');
  $('view-title').textContent = viewMeta[v].title;
  $('view-sub').textContent = viewMeta[v].sub;
  $('search-box').style.display = viewMeta[v].search ? 'flex' : 'none';
}

/* 侧栏 harness 点击 -> 跳到该 harness 的提示词库（原型 1986-1993，B3 接通 renderPrompts） */
$('sidebar-agent-list').addEventListener('click', e=>{
  const row = e.target.closest('.agent-row');
  if(!row) return;
  state.currentPromptAgent = row.dataset.agent;
  switchView('prompts');
  renderPrompts();
  showToast(`已切换到 ${AGENT_BY(state.currentPromptAgent).name} 的提示词库`);
});

/* ================= 顶栏搜索（Skills 已安装视图） ================= */
$('search-input').addEventListener('input', e=>{
  const q = e.target.value.trim().toLowerCase();
  if(state.currentView==='skills'){ state.skillQuery = q; if(state.skillsTab==='installed') applyMatrixFilters('skill'); }
});

/* ================= 初始化（G1：getAppInit + listMcp 拉真实数据后全量渲染，保持 B 块顺序；G3：+getAgentsDetailed 与全部提示词库） ================= */
async function init(){
  try {
    const init = await window.hub.getAppInit();
    state.agents = init.agents;
    state.settings = init.settings;
  } catch (err) { showToast('操作失败：' + err.message); }
  try {
    // G3：真实解析路径（Harness 管理卡 + 提示词页头部指令文件路径）
    state.agentsDetailed = await window.hub.getAgentsDetailed();
  } catch (err) { showToast('操作失败：' + err.message); }
  try {
    // Dashboard 概览：探测各 harness 当前/最新版本（子进程 + npm 网络，慢则各卡独立显示）
    state.agentVersions = await window.hub.getAgentVersions();
  } catch (err) { showToast('操作失败：' + err.message); }
  try {
    state.mcpItems = await window.hub.listMcp();
  } catch (err) { showToast('操作失败：' + err.message); }
  try {
    state.skillsItems = await window.hub.listSkills();
  } catch (err) { showToast('操作失败：' + err.message); }
  try {
    // 预加载全部 saved 提示词库（Dashboard saved 计数与 tab 切换使用；live 按当前 harness 单独读取）
    await Promise.all(AGENTS.map(a=>
      window.hub.listPrompts(a.id).then(list=>{ state.promptsByAgent[a.id] = list; })
    ));
  } catch (err) { showToast('操作失败：' + err.message); }

  // 启动时自动从各 harness 导入一次 MCP 配置，有变化时提示
  await autoRefreshFromHarnesses();

  renderSidebarAgents();
  renderDashboard();
  renderCountBar('mcp-countbar', state.mcpItems, 'mcp');
  renderCountBar('skills-countbar', state.skillsItems, 'skill');
  renderMatrix('mcp');
  renderMatrix('skill');
  renderPrompts();
  renderAgents();
  renderDiscovery();
}

/* ================= 启动自动刷新：仅导入 MCP 配置 =================
 * v2 提示词不再自动导入：live 内容仅在提示词页运行时读取，
 * 进入 saved 库必须由用户通过「另存为」或「新增」显式创建。 */
async function autoRefreshFromHarnesses(){
  const summary = { mcp: 0 };
  const errors = [];
  try {
    const { added } = await window.hub.importMcpFromHarnesses();
    state.mcpItems = await window.hub.listMcp();
    summary.mcp = added.length;
  } catch (err) {
    errors.push('MCP：' + err.message);
  }

  if(summary.mcp > 0){
    showToast(`启动时已自动导入：MCP +${summary.mcp}`);
  }
  if(errors.length > 0){
    showToast('启动自动刷新部分失败：' + errors[0]);
  }
}
init();