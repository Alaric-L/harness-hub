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
  dashboard:{title:'Dashboard', sub:'7 个 harness 的配置总览', search:false},
  mcp:{title:'MCP 服务', sub:'统一管理 MCP 配置，按 harness 一键开关并写入各自配置文件', search:false},
  skills:{title:'Skills', sub:'中央库安装与分发，支持仓库发现、更新与备份', search:true},
  prompts:{title:'提示词', sub:'每个 harness 一套提示词库，单条激活写入指令文件', search:false},
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
    // G3：预加载全部提示词库（Dashboard 激活计数与 tab 切换同源真实数据）
    await Promise.all(AGENTS.map(a=>
      window.hub.listPrompts(a.id).then(list=>{ state.promptsByAgent[a.id] = list; })
    ));
  } catch (err) { showToast('操作失败：' + err.message); }

  // 启动时自动从各 harness 导入一次（MCP / 未纳管 Skills / 提示词），有变化时汇总提示
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

/* ================= 启动自动刷新：从各 harness 配置目录导入一次 =================
 * MCP：合并 harness 配置文件条目进库（只动本地库，不写 harness 文件）；
 * Skills：未纳管 skill 自动导入中央库并部署到发现位置（apps=发现所在 harness）；
 * 提示词：指令文件 live 内容不在库中的新增「原始提示词」条目。
 * 各步独立成败（失败 console 记录 + 汇总 toast 提示），幂等：已导入的不会重复。 */
async function autoRefreshFromHarnesses(){
  const summary = { mcp: 0, skill: 0, prompt: 0 };
  const errors = [];
  try {
    const { added } = await window.hub.importMcpFromHarnesses();
    state.mcpItems = await window.hub.listMcp();
    summary.mcp = added.length;
  } catch (err) { errors.push('MCP：' + err.message); }
  try {
    const unmanaged = await window.hub.listUnmanagedSkills();
    if(unmanaged.length > 0){
      const items = unmanaged.map(s=>{
        const apps = {};
        for(const id of s.foundIn) apps[id] = true;
        return { dir: s.dir, apps };
      });
      try {
        state.skillsItems = await window.hub.importSkills(items);
        summary.skill = items.length;
      } catch (err) { errors.push('Skills：' + err.message); }
    }
  } catch (err) { errors.push('Skills：' + err.message); }
  try {
    const res = await window.hub.importPromptsFromHarnesses();
    await Promise.all(AGENTS.map(a=>
      window.hub.listPrompts(a.id).then(list=>{ state.promptsByAgent[a.id] = list; })
    ));
    summary.prompt = res.added;
  } catch (err) { errors.push('提示词：' + err.message); }

  if(summary.mcp + summary.skill + summary.prompt > 0){
    showToast(`启动时已自动导入：MCP +${summary.mcp} · Skills +${summary.skill} · 提示词 +${summary.prompt}`);
  }
  if(errors.length > 0){
    showToast('启动自动刷新部分失败：' + errors[0]);
  }
}
init();