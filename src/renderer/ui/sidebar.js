/* ================= Sidebar & Dashboard ================= */
import { AGENTS } from '../data.js';
import { icon } from '../icons.js';
import { $ } from './common.js';

export function renderSidebarAgents(){
  const el = $('sidebar-agent-list');
  el.innerHTML = AGENTS.map(a=>`
    <button class="agent-row" data-agent="${a.id}" title="${a.name}">
      ${icon(a.id, 16, a.name)}
      <span class="name-mono">${a.short}</span>
    </button>`).join('');
}