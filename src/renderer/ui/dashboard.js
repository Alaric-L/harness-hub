/* ================= Dashboard（G1：MCP 统计改读真实库；G2：Skills 同理；G3：提示词与已接入同步改读真实 state） ================= */
import { AGENTS } from '../data.js';
import { icon } from '../icons.js';
import { $ } from './common.js';
import { state } from '../state.js';

export function renderDashboard(){
  $('stat-agents').textContent = state.agents ? state.agents.length : 0;
  $('stat-mcp').textContent = state.mcpItems.length;
  $('stat-skill').textContent = state.skillsItems.length;
  // 激活提示词 = 各库 enabled 计数（state.promptsByAgent 汇总，与提示词页同源）
  $('stat-prompt').textContent = AGENTS.reduce((n,a)=> n + (state.promptsByAgent[a.id]||[]).filter(p=>p.enabled).length, 0);

  $('dash-agent-grid').innerHTML = AGENTS.map(a=>{
    const mcp = state.mcpItems.filter(i=>i.apps[a.id]).length;
    const skill = state.skillsItems.filter(i=>i.apps[a.id]).length;
    const prompt = (state.promptsByAgent[a.id]||[]).filter(p=>p.enabled).length;
    return `<div class="mini-agent-card">
      ${icon(a.id, 28, a.name)}
      <div>
        <div class="m-name">${a.name}</div>
        <div class="m-meta">MCP ${mcp} · Skills ${skill} · 提示词 ${prompt}</div>
      </div>
    </div>`;
  }).join('');
}