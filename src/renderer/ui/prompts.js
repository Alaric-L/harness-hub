/* ================= 提示词视图（迁移原型 1754-1911；promptEditing/copySourcePrompt/currentPromptAgent 经 state） ================= */
import { AGENTS, AGENT_BY, PROMPTS } from '../data.js';
import { icon } from '../icons.js';
import { $, showToast, askConfirm, esc } from './common.js';
import { state } from '../state.js';
import { renderDashboard } from './dashboard.js';

export function renderPrompts(){
  // harness tabs
  $('prompt-tabs').innerHTML = AGENTS.map(a=>`
    <button class="prompt-tab ${a.id===state.currentPromptAgent?'active':''}" data-agent="${a.id}" title="${a.name}">
      ${icon(a.id, 15, a.name)}<span>${a.short}</span>
    </button>`).join('');
  $('prompt-tabs').querySelectorAll('.prompt-tab').forEach(t=>{
    t.addEventListener('click', ()=>{
      state.currentPromptAgent = t.dataset.agent;
      renderPrompts();
    });
  });

  const agent = AGENT_BY(state.currentPromptAgent);
  const list = PROMPTS[state.currentPromptAgent];
  $('prompt-file').textContent = `指令文件 · ${agent.promptFile}`;

  if(list.length===0){
    $('prompt-list').innerHTML = `<div class="empty-box">
      <h4>「${agent.short}」还没有提示词</h4>
      <p>新增一条提示词并激活，内容将写入 ${agent.promptFile}</p>
      <button class="btn btn-primary" id="btn-add-prompt-empty">+ 新增提示词</button>
    </div>`;
    $('btn-add-prompt-empty').addEventListener('click', ()=> openPromptForm(null));
    return;
  }

  $('prompt-list').innerHTML = list.map(p=>`
    <div class="prompt-card ${p.enabled?'on':''}">
      <label class="switch" title="${p.enabled?'点击停用（指令文件将被清空）':'点击激活并写入指令文件'}">
        <input type="checkbox" ${p.enabled?'checked':''} data-pt-toggle="${p.id}">
        <span class="slider"></span>
      </label>
      <div class="pc-main">
        <div class="pc-name">${esc(p.name)}
          ${p.enabled ? `<span class="pc-on-badge">已激活 · 写入 ${agent.promptFile}</span>` : ''}
        </div>
        ${p.desc ? `<div class="pc-desc">${esc(p.desc)}</div>` : ''}
        <div class="pc-meta">更新于 ${p.updated}</div>
      </div>
      <div class="pc-actions">
        <button class="btn btn-ghost btn-sm" data-pt-copy="${p.id}">复制到其他 harness</button>
        <button class="btn btn-ghost btn-sm" data-pt-edit="${p.id}">编辑</button>
        <button class="btn btn-ghost btn-sm" data-pt-del="${p.id}" ${p.enabled?'disabled title="已激活的提示词不可删除，请先停用"':''}>删除</button>
      </div>
    </div>`).join('');

  // 激活 / 停用
  $('prompt-list').querySelectorAll('[data-pt-toggle]').forEach(cb=>{
    cb.addEventListener('change', ()=>{
      const p = PROMPTS[state.currentPromptAgent].find(x=>x.id===cb.dataset.ptToggle);
      if(cb.checked){
        PROMPTS[state.currentPromptAgent].forEach(x=> x.enabled = false);
        p.enabled = true;
        p.updated = '刚刚';
        showToast(`已激活「${p.name}」，内容写入 ${agent.promptFile}（原文件外部改动已自动回填）`);
      } else {
        p.enabled = false;
        showToast(`已停用「${p.name}」，${agent.promptFile} 已清空`);
      }
      renderPrompts();
    });
  });
  // 编辑
  $('prompt-list').querySelectorAll('[data-pt-edit]').forEach(btn=>{
    btn.addEventListener('click', ()=> openPromptForm(btn.dataset.ptEdit));
  });
  // 删除
  $('prompt-list').querySelectorAll('[data-pt-del]').forEach(btn=>{
    if(btn.disabled) return;
    btn.addEventListener('click', ()=>{
      const p = PROMPTS[state.currentPromptAgent].find(x=>x.id===btn.dataset.ptDel);
      askConfirm('删除提示词', `确定删除「${p.name}」？`, ()=>{
        const arr = PROMPTS[state.currentPromptAgent];
        arr.splice(arr.indexOf(p),1);
        renderPrompts();
        renderDashboard();
        showToast(`已删除提示词「${p.name}」`);
      }, '删除');
    });
  });
  // 复制到其他 harness
  $('prompt-list').querySelectorAll('[data-pt-copy]').forEach(btn=>{
    btn.addEventListener('click', ()=> openCopyModal(btn.dataset.ptCopy));
  });
}

$('btn-add-prompt').addEventListener('click', ()=> openPromptForm(null));

export function openPromptForm(editingId){
  state.promptEditing = editingId ? {agentId: state.currentPromptAgent, id: editingId} : null;
  const agent = AGENT_BY(state.currentPromptAgent);
  const editing = editingId ? PROMPTS[state.currentPromptAgent].find(p=>p.id===editingId) : null;
  $('pf-title').textContent = editing ? '编辑提示词' : '新增提示词';
  $('pf-sub').textContent = `${agent.name} · 激活后写入 ${agent.promptFile}`;
  $('pf-name').value = editing ? editing.name : '';
  $('pf-desc').value = editing ? (editing.desc||'') : '';
  $('pf-content').value = editing ? editing.content : '';
  $('modal-prompt-form').classList.add('open');
}
$('pf-cancel').addEventListener('click', ()=> $('modal-prompt-form').classList.remove('open'));
$('pf-save').addEventListener('click', ()=>{
  const name = $('pf-name').value.trim();
  if(!name){ showToast('请填写提示词名称'); return; }
  const agent = AGENT_BY(state.currentPromptAgent);
  if(state.promptEditing){
    const p = PROMPTS[state.promptEditing.agentId].find(x=>x.id===state.promptEditing.id);
    p.name = name;
    p.desc = $('pf-desc').value.trim();
    p.content = $('pf-content').value;
    p.updated = '刚刚';
    showToast(p.enabled ? `已保存并写入 ${agent.promptFile}` : '已保存（未激活，不影响指令文件）');
  } else {
    PROMPTS[state.currentPromptAgent].push({
      id: state.currentPromptAgent + '-' + Date.now(), name,
      desc: $('pf-desc').value.trim(), content: $('pf-content').value,
      enabled:false, updated:'刚刚',
    });
    showToast(`已创建提示词「${name}」（未激活）`);
  }
  $('modal-prompt-form').classList.remove('open');
  renderPrompts();
  renderDashboard();
});

/* ---- 复制到其他 harness ---- */
export function openCopyModal(promptId){
  state.copySourcePrompt = PROMPTS[state.currentPromptAgent].find(p=>p.id===promptId);
  const fromAgent = AGENT_BY(state.currentPromptAgent);
  $('cp-sub').textContent = `将「${state.copySourcePrompt.name}」（来自 ${fromAgent.name}）复制为以下 harness 提示词库中的新条目`;
  const targets = AGENTS.filter(a=>a.id!==state.currentPromptAgent);
  $('cp-targets').innerHTML = targets.map(a=>{
    const n = PROMPTS[a.id].length;
    return `<label class="target-item">
      <input type="checkbox" value="${a.id}">
      ${icon(a.id, 16, a.name)}
      <span class="name">${a.name}</span>
      <span class="t-meta">库中已有 ${n} 条</span>
    </label>`;
  }).join('');
  $('modal-copy').classList.add('open');
}
$('cp-cancel').addEventListener('click', ()=> $('modal-copy').classList.remove('open'));
$('cp-confirm').addEventListener('click', ()=>{
  const checked = [...document.querySelectorAll('#cp-targets input:checked')].map(c=>c.value);
  if(checked.length===0){ showToast('请至少选择一个目标 harness'); return; }
  checked.forEach(id=>{
    let name = state.copySourcePrompt.name;
    let n = 1;
    while(PROMPTS[id].some(p=>p.name===name)) name = `${state.copySourcePrompt.name} (${++n})`;
    PROMPTS[id].push({...state.copySourcePrompt, id: id+'-'+Date.now()+Math.random(), name, enabled:false, updated:'刚刚（复制）'});
  });
  $('modal-copy').classList.remove('open');
  const names = checked.map(id=>AGENT_BY(id).short).join('、');
  showToast(`已复制到 ${names}（未激活，可在各自库中激活）`);
  renderPrompts();
  renderDashboard();
});