/* ================= Dashboard（版本探测接真实后端：getAgentVersions / installAgent，对齐 cc-switch 本地环境检查） ================= */
import { AGENTS } from '../data.js';
import { icon } from '../icons.js';
import { $, showToast } from './common.js';
import { state } from '../state.js';
import { isUpdateAvailable } from '../version.js';
import { savedPromptCount } from './prompt-view.js';

/** 当前 agent 的版本探测结果（未加载返回 null） */
function versionOf(agentId){
  return (state.agentVersions || []).find(v=>v.agentId===agentId) || null;
}

/** 卡片状态徽标：加载中 / 未安装 / 可更新 / 最新 */
function statusBadge(agentId, v){
  if(!state.agentVersions) return '';
  if(!v) return `<span class="avc-badge loading">…</span>`;
  if(!v.installed) return `<span class="avc-badge warn">未安装</span>`;
  return isUpdateAvailable(v.version, v.latestVersion)
    ? `<span class="avc-badge upd">可更新</span>`
    : `<span class="avc-badge ok">✓ 最新</span>`;
}

/** 动作区：未安装→安装；可更新→更新；最新→就绪文案 */
function actionButton(agentId, v){
  if(!state.agentVersions || !v){
    return `<span class="avc-ready">探测中…</span>`;
  }
  if(!v.installed){
    return `<button class="btn btn-ghost btn-sm" data-agent-action="${agentId}" data-action="install">安装</button>`;
  }
  if(isUpdateAvailable(v.version, v.latestVersion)){
    return `<button class="btn btn-primary btn-sm" data-agent-action="${agentId}" data-action="update">更新</button>`;
  }
  return `<span class="avc-ready">✓ 已是最新</span>`;
}

export function renderDashboard(){
  const versions = state.agentVersions || [];
  // 第一个统计卡「已安装 Harness」= 探测到版本的 agent 数（版本数据未加载时回退「已接入」总数）
  $('stat-agents').textContent = state.agentVersions
    ? versions.filter(v=>v.installed).length
    : (state.agents ? state.agents.length : 0);
  $('stat-mcp').textContent = state.mcpItems.length;
  $('stat-skill').textContent = state.skillsItems.length;
  // 已保存提示词 = 各 harness saved 库总数（live 不落库、不参与计数）
  $('stat-prompt').textContent = savedPromptCount(state.promptsByAgent);

  $('dash-agent-grid').innerHTML = AGENTS.map(a=>{
    const v = versionOf(a.id);
    const mcp = state.mcpItems.filter(i=>i.apps[a.id]).length;
    const skill = state.skillsItems.filter(i=>i.apps[a.id]).length;
    const prompt = (state.promptsByAgent[a.id]||[]).length;
    const current = !state.agentVersions ? '…'
      : (v && v.version) ? v.version
      : (v && v.error) ? '未安装'
      : '—';
    const latest = !state.agentVersions ? '…' : (v && v.latestVersion) ? v.latestVersion : '未知';
    return `<div class="agent-ver-card">
      <div class="avc-head">
        ${icon(a.id, 24, a.name)}
        <div class="avc-name">${a.name}</div>
        ${statusBadge(a.id, v)}
      </div>
      <div class="avc-row"><span>当前版本</span><span class="mono" title="${v && v.error ? v.error : ''}">${current}</span></div>
      <div class="avc-row"><span>最新版本</span><span class="mono">${latest}</span></div>
      <div class="avc-meta">MCP ${mcp} · Skills ${skill} · 提示词 ${prompt}</div>
      <div class="avc-actions">${actionButton(a.id, v)}</div>
    </div>`;
  }).join('');

  // 安装 / 更新（安装中按钮保持禁用 + 文案，await 结束后以新状态重渲染）
  $('dash-agent-grid').querySelectorAll('[data-agent-action]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const agentId = btn.dataset.agentAction;
      const action = btn.dataset.action;
      const agent = AGENTS.find(a=>a.id===agentId);
      btn.disabled = true;
      const orig = btn.textContent;
      btn.textContent = action === 'install' ? '安装中…' : '更新中…';
      try {
        const info = await window.hub.installAgent(agentId);
        state.agentVersions = (state.agentVersions || []).filter(x=>x.agentId!==agentId).concat(info);
        renderDashboard();
        showToast(`已${action==='install'?'安装':'更新'} ${agent.name}（当前 ${info.version || '未知'}）`);
      } catch (err) {
        showToast('操作失败：' + err.message);
        btn.disabled = false;
        btn.textContent = orig;
      }
    });
  });
}

/* 概览区「刷新版本」按钮：强制全量重探测 */
$('btn-dash-refresh').addEventListener('click', async ()=>{
  const btn = $('btn-dash-refresh');
  btn.disabled = true;
  try {
    state.agentVersions = await window.hub.getAgentVersions();
    renderDashboard();
    showToast('已刷新 Harness 版本信息');
  } catch (err) {
    showToast('操作失败：' + err.message);
  } finally {
    btn.disabled = false;
  }
});
