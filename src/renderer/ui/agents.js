/* ================= Harness 管理视图（迁移原型 1913-1950；G3：展示 resolveAgentPaths 真实路径 + 目录覆盖接线）
 * 渲染前拉取 hub.getAgentsDetailed()：卡片路径 = resolved（真实绝对路径），默认目录 = agents[i].dir（模板）；
 * 覆盖输入初值 = settings.dirOverrides[agentId] || ''；浏览 / 输入 change（失焦、回车）/ 重置均触发 setDirOverride 并刷新。 ================= */
import { AGENT_BY } from '../data.js';
import { icon } from '../icons.js';
import { $, showToast } from './common.js';
import { state } from '../state.js';

export async function renderAgents(){
  try {
    state.agentsDetailed = await window.hub.getAgentsDetailed();
  } catch (err) {
    showToast('操作失败：' + err.message);
    return;
  }
  const { agents, resolved } = state.agentsDetailed;
  const overrides = (state.settings && state.settings.dirOverrides) || {};

  $('agent-cards').innerHTML = agents.map(a=>{
    const r = resolved[a.id];
    const ov = overrides[a.id] || '';
    return `<div class="agent-card">
      <div class="agent-card-head">
        ${icon(a.id, 24, a.name)}
        <div>
          <div class="name">${a.name}</div>
          <div class="dir-badge">默认目录 ${a.dir}</div>
        </div>
      </div>
      <div class="path-rows">
        <div class="path-row"><span>MCP 配置</span><code title="${r.mcpPath}">${r.mcpPath}</code></div>
        <div class="path-row"><span>Skills 目录</span><code title="${r.skillsDir}">${r.skillsDir}</code></div>
        <div class="path-row"><span>提示词文件</span><code title="${r.promptFile}">${r.promptFile}</code></div>
      </div>
      <div class="dir-override">
        <label>配置目录覆盖（留空 = 默认路径）</label>
        <div class="dir-input-row">
          <input class="field-input mono" placeholder="${a.dir}" value="${ov}" data-dir-input="${a.id}">
          <button class="btn btn-ghost btn-sm" data-dir-browse="${a.id}">浏览</button>
          <button class="btn btn-ghost btn-sm" data-dir-reset="${a.id}">重置</button>
        </div>
      </div>
    </div>`;
  }).join('');

  $('agent-cards').querySelectorAll('[data-dir-browse]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const agentId = btn.dataset.dirBrowse;
      const agent = AGENT_BY(agentId);
      try {
        const dir = await window.hub.browseDir(agentId);   // 主进程 dialog 选目录；取消返回 null
        if(!dir) return;
        document.querySelector(`[data-dir-input="${agentId}"]`).value = dir;
        await saveOverride(agentId, dir);
        showToast(`已更新 ${agent.name} 的配置目录`);
      } catch (err) {
        showToast('操作失败：' + err.message);
      }
    });
  });
  $('agent-cards').querySelectorAll('[data-dir-input]').forEach(input=>{
    // 失焦 / 值变更时保存（change 在文本输入失焦时触发；回车主动失焦）
    input.addEventListener('change', async ()=>{
      const agentId = input.dataset.dirInput;
      const agent = AGENT_BY(agentId);
      const value = input.value.trim();
      await saveOverride(agentId, value || null);
      showToast(`已更新 ${agent.name} 的配置目录`);
    });
    input.addEventListener('keydown', e=>{
      if(e.key==='Enter') input.blur();
    });
  });
  $('agent-cards').querySelectorAll('[data-dir-reset]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const agentId = btn.dataset.dirReset;
      const agent = AGENT_BY(agentId);
      const input = document.querySelector(`[data-dir-input="${agentId}"]`);
      if(!input.value.trim()){ showToast('当前已是默认路径'); return; }
      input.value = '';
      await saveOverride(agentId, null);
      showToast(`已恢复 ${agent.name} 的默认配置目录`);
    });
  });
}

/** 保存覆盖：setDirOverride -> 重新拉取真实路径 -> 重渲染（重置传 null = 删覆盖） */
async function saveOverride(agentId, dir){
  try {
    state.settings = await window.hub.setDirOverride(agentId, dir);
    await renderAgents();
  } catch (err) {
    showToast('操作失败：' + err.message);
  }
}