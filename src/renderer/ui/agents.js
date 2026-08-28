/* ================= Harness 管理视图（迁移原型 1913-1950） ================= */
import { AGENTS, AGENT_BY } from '../data.js';
import { icon } from '../icons.js';
import { $, showToast } from './common.js';

export function renderAgents(){
  $('agent-cards').innerHTML = AGENTS.map(a=>`
    <div class="agent-card">
      <div class="agent-card-head">
        ${icon(a.id, 24, a.name)}
        <div>
          <div class="name">${a.name}</div>
          <div class="dir-badge">默认目录 ${a.dir}</div>
        </div>
      </div>
      <div class="path-rows">
        <div class="path-row"><span>MCP 配置</span><code title="${a.mcpPath}">${a.mcpPath}</code></div>
        <div class="path-row"><span>Skills 目录</span><code title="${a.skillsDir}">${a.skillsDir}</code></div>
        <div class="path-row"><span>提示词文件</span><code title="${a.promptFile}">${a.promptFile}</code></div>
      </div>
      <div class="dir-override">
        <label>配置目录覆盖（留空 = 默认路径）</label>
        <div class="dir-input-row">
          <input class="field-input mono" placeholder="${a.dir}" data-dir-input="${a.id}">
          <button class="btn btn-ghost btn-sm" data-dir-browse="${a.id}">浏览</button>
          <button class="btn btn-ghost btn-sm" data-dir-reset="${a.id}">重置</button>
        </div>
      </div>
    </div>`).join('');

  $('agent-cards').querySelectorAll('[data-dir-browse]').forEach(btn=>{
    btn.addEventListener('click', ()=> showToast('（原型）打开系统目录选择对话框'));
  });
  $('agent-cards').querySelectorAll('[data-dir-reset]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const input = document.querySelector(`[data-dir-input="${btn.dataset.dirReset}"]`);
      if(!input.value){ showToast('当前已是默认路径'); return; }
      input.value = '';
      showToast(`已恢复 ${AGENT_BY(btn.dataset.dirReset).name} 的默认配置目录`);
    });
  });
}