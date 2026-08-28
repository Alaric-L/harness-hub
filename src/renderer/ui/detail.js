/* ================= 详情面板（G1：MCP 预览改走 previewMcp 真实后端） ================= */
import { AGENTS, AGENT_BY, SKILLS_INSTALLED, SSOT_DIR } from '../data.js';
import { icon } from '../icons.js';
import { $, esc, showToast } from './common.js';
import { state } from '../state.js';

export function openDetail(itemId, kind){
  const isMcp = kind==='mcp';
  const item = isMcp ? state.mcpItems.find(i=>i.id===itemId) : SKILLS_INSTALLED.find(i=>i.dir===itemId);
  state.detailCtx = {kind, id: itemId};
  $('detail-title').textContent = item.name;
  $('detail-sub').textContent = `${item.desc} · ${isMcp?'MCP 服务':'Skill'}`;

  const tabs = $('detail-tabs');
  tabs.innerHTML = AGENTS.map((a,i)=>
    `<button class="detail-tab ${i===0?'active':''}" data-agent="${a.id}" title="${a.name}">
      ${icon(a.id, 14, a.name)}<span>${a.short}</span>
    </button>`).join('');

  function renderBody(agentId){
    const agent = AGENT_BY(agentId);
    const enabled = !!item.apps[agentId];
    let html = '';
    if(isMcp){
      const links = [];
      if(item.docs) links.push(`<a class="detail-link" href="${item.docs}" target="_blank" title="${item.docs}">↗ 文档</a>`);
      if(item.homepage) links.push(`<a class="detail-link" href="${item.homepage}" target="_blank" title="${item.homepage}">↗ 主页</a>`);
      html = `
        ${links.length ? `<div style="display:flex; gap:8px; margin-bottom:14px; flex-wrap:wrap;">${links.join('')}</div>` : ''}
        <div class="detail-status ${enabled?'on':'off'}">${enabled?'✓ 已在此 harness 启用':'○ 未启用'}</div>
        <div class="detail-label">配置文件</div>
        <div class="code-block">${esc(agent.mcpPath)}</div>
        <div class="detail-label">写入内容预览（${agent.mcpFormat === 'yaml-patch' ? 'YAML patch 插件条目' : agent.mcpFormat.toUpperCase()}）</div>
        <div class="code-block" id="detail-preview">加载中…</div>`;
      $('detail-body').innerHTML = html;
      if(enabled){
        window.hub.previewMcp(itemId, agentId).then(text=>{
          const el = $('detail-preview');
          if(el) el.textContent = text;
        }).catch(err=>{
          const el = $('detail-preview');
          if(el) el.textContent = '';
          showToast('操作失败：' + err.message);
        });
      } else {
        const el = $('detail-preview');
        if(el) el.textContent = `// ${item.id} 未在 ${agent.name} 中启用`;
      }
      return;
    }
    html = `
        <div class="detail-status ${enabled?'on':'off'}">${enabled?'✓ 已部署到 '+agent.short:'○ 未部署'}</div>
        <div class="detail-label">部署位置</div>
        <div class="code-block">${esc(agent.skillsDir + '/' + item.dir + (enabled ? '\n  -> ' + SSOT_DIR + '/' + item.dir : ''))}</div>
        <div class="detail-label">SKILL.md 预览</div>
        <div class="code-block">---
name: ${item.name}
description: ${item.desc}
---

（Skill 指令正文，来自 ${item.repo || '本地'}）</div>`;
    $('detail-body').innerHTML = html;
  }

  tabs.querySelectorAll('.detail-tab').forEach(t=>{
    t.addEventListener('click', ()=>{
      tabs.querySelectorAll('.detail-tab').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      renderBody(t.dataset.agent);
    });
  });
  renderBody(AGENTS[0].id);
  $('detail-panel').classList.add('open');
}
$('detail-close').addEventListener('click', ()=> $('detail-panel').classList.remove('open'));