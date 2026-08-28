/* ================= 设置视图（G4：接真实 getSettings/setSettings/exportData/importData；外观区块浅色保持、深色禁用不改） ================= */
import { AGENTS } from '../data.js';
import { $, showToast } from './common.js';
import { state } from '../state.js';
import { renderSidebarAgents } from './sidebar.js';
import { renderDashboard } from './dashboard.js';
import { renderCountBar, renderMatrix } from './matrix.js';
import { renderPrompts } from './prompts.js';
import { renderAgents } from './agents.js';
import { renderDiscovery } from './skills.js';

/* ---------- 加载：启动时 getSettings() 填充（SPA 设置 DOM 常驻，一次填充即可） ---------- */
async function loadSettingsView(){
  try {
    const s = await window.hub.getSettings();
    state.settings = s;
    $('set-backup-before-write').checked = !!s.backupBeforeWrite;
    $('set-skill-uninstall-backup').checked = !!s.skillUninstallBackup;
    document.querySelectorAll('#sync-method-row .radio-pill').forEach(pill=>{
      const active = (pill.dataset.sync || '') === s.syncMethod;
      pill.classList.toggle('active', active);
      pill.querySelector('input').checked = active;
    });
  } catch (err) { showToast('操作失败：' + err.message); }
}

/* ---------- 变更即保存：setSettings({...}) -> toast「已保存」 ---------- */
async function saveSettingsView(patch){
  try {
    const base = state.settings || await window.hub.getSettings();
    state.settings = await window.hub.setSettings({ ...base, ...patch });
    showToast('已保存');
  } catch (err) { showToast('操作失败：' + err.message); }
}

$('set-backup-before-write').addEventListener('change', e=> saveSettingsView({ backupBeforeWrite: e.target.checked }));
$('set-skill-uninstall-backup').addEventListener('change', e=> saveSettingsView({ skillUninstallBackup: e.target.checked }));

document.querySelectorAll('#sync-method-row .radio-pill').forEach(pill=>{
  pill.addEventListener('click', ()=>{
    const value = pill.dataset.sync;
    document.querySelectorAll('#sync-method-row .radio-pill').forEach(p=>p.classList.remove('active'));
    pill.classList.add('active');
    pill.querySelector('input').checked = true;
    if(!value || value === (state.settings && state.settings.syncMethod)) return; // 已选中：仅视觉同步，不重复写
    saveSettingsView({ syncMethod: value });
  });
});

/* ---------- 导出 ---------- */
$('btn-export-data').addEventListener('click', async ()=>{
  try {
    const p = await window.hub.exportData();
    if(p) showToast(`已导出到 ${p}`);
  } catch (err) { showToast('操作失败：' + err.message); }
});

/* ---------- 导入（成功后渲染层全量刷新） ---------- */
$('btn-import-data').addEventListener('click', async ()=>{
  try {
    const r = await window.hub.importData();
    if(r !== 'ok') return;   // 用户取消：安静处理
    await refreshAllViews();
    showToast('导入成功，已创建导入前快照');
  } catch (err) { showToast('操作失败：' + err.message); }
});

/* 导入成功后全量刷新：与 main.js init 同源重拉全部数据 + 重渲染各视图 */
async function refreshAllViews(){
  try {
    const init = await window.hub.getAppInit();
    state.agents = init.agents;
    state.settings = init.settings;
  } catch (err) { showToast('操作失败：' + err.message); }
  try {
    state.agentsDetailed = await window.hub.getAgentsDetailed();
  } catch (err) { /* 单库失败不影响其余刷新 */ }
  try { state.mcpItems = await window.hub.listMcp(); } catch (err) { /* 同上 */ }
  try { state.skillsItems = await window.hub.listSkills(); } catch (err) { /* 同上 */ }
  try {
    await Promise.all(AGENTS.map(a=>
      window.hub.listPrompts(a.id).then(list=>{ state.promptsByAgent[a.id] = list; })
    ));
  } catch (err) { /* 同上 */ }

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

loadSettingsView();
