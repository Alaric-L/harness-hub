/* ================= Dashboard（G1：MCP 统计改读真实库） ================= */
import { AGENTS, SKILLS_INSTALLED, PROMPTS } from '../data.js';
import { icon } from '../icons.js';
import { $ } from './common.js';
import { state } from '../state.js';

export function renderDashboard(){
  $('stat-mcp').textContent = state.mcpItems.length;
  $('stat-skill').textContent = SKILLS_INSTALLED.length;
  $('stat-prompt').textContent = AGENTS.reduce((n,a)=> n + PROMPTS[a.id].filter(p=>p.enabled).length, 0);

  $('dash-agent-grid').innerHTML = AGENTS.map(a=>{
    const mcp = state.mcpItems.filter(i=>i.apps[a.id]).length;
    const skill = SKILLS_INSTALLED.filter(i=>i.apps[a.id]).length;
    const prompt = PROMPTS[a.id].filter(p=>p.enabled).length;
    return `<div class="mini-agent-card">
      ${icon(a.id, 28, a.name)}
      <div>
        <div class="m-name">${a.name}</div>
        <div class="m-meta">MCP ${mcp} · Skills ${skill} · 提示词 ${prompt}</div>
      </div>
    </div>`;
  }).join('');
}