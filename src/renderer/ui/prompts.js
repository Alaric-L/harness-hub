/* ================= 提示词视图（迁移原型 1754-1911；G3：全部接真实后端）
 * 数据源 = state.promptsByAgent[agentId]（listPrompts/enablePrompt/disablePrompt/savePrompt/
 * deletePrompt/copyPrompt 返回的 PromptItem[]，含 updatedAt 时间戳）；指令文件路径取
 * state.agentsDetailed.resolved[agentId].promptFile（真实绝对路径，不再用 AGENTS 模板）。
 * promptEditing/copySourcePrompt/currentPromptAgent 经 state。 ================= */
import { AGENTS, AGENT_BY } from '../data.js';
import { icon } from '../icons.js';
import { $, showToast, askConfirm, esc } from './common.js';
import { state } from '../state.js';
import { renderDashboard } from './dashboard.js';

/** 当前 harness 解析后的真实路径（getAgentsDetailed 填充；未加载时回退模板） */
function resolvedOf(agentId){
  const r = state.agentsDetailed && state.agentsDetailed.resolved[agentId];
  return (r && r.promptFile) ? r.promptFile : AGENT_BY(agentId).promptFile;
}

/** updatedAt（epoch ms）-> 可读文本 */
function fmtUpdated(ts){
  if(!ts) return '未知';
  const diff = Date.now() - ts;
  if(diff < 60e3) return '刚刚';
  if(diff < 3600e3) return `${Math.floor(diff/60e3)} 分钟前`;
  if(diff < 86400e3) return `${Math.floor(diff/3600e3)} 小时前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

/** 确保指定 harness 提示词库已加载（未加载则 IPC 拉取） */
export async function ensurePromptLib(agentId){
  if(state.promptsByAgent[agentId] === undefined){
    try {
      state.promptsByAgent[agentId] = await window.hub.listPrompts(agentId);
    } catch (err) {
      showToast('操作失败：' + err.message);
      state.promptsByAgent[agentId] = [];
    }
  }
}

export async function renderPrompts(){
  // harness tabs
  $('prompt-tabs').innerHTML = AGENTS.map(a=>`
    <button class="prompt-tab ${a.id===state.currentPromptAgent?'active':''}" data-agent="${a.id}" title="${a.name}">
      ${icon(a.id, 15, a.name)}<span>${a.short}</span>
    </button>`).join('');
  $('prompt-tabs').querySelectorAll('.prompt-tab').forEach(t=>{
    t.addEventListener('click', async ()=>{
      state.currentPromptAgent = t.dataset.agent;
      await ensurePromptLib(state.currentPromptAgent);
      renderPrompts();
    });
  });

  await ensurePromptLib(state.currentPromptAgent);
  const agentId = state.currentPromptAgent;
  const agent = AGENT_BY(agentId);
  const promptFile = resolvedOf(agentId);
  const list = state.promptsByAgent[agentId];
  $('prompt-file').textContent = `指令文件 · ${promptFile}`;

  if(list.length===0){
    $('prompt-list').innerHTML = `<div class="empty-box">
      <h4>「${agent.short}」还没有提示词</h4>
      <p>新增一条提示词并激活，内容将写入 ${promptFile}</p>
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
          ${p.enabled ? `<span class="pc-on-badge">已激活 · 写入 ${promptFile}</span>` : ''}
        </div>
        ${p.desc ? `<div class="pc-desc">${esc(p.desc)}</div>` : ''}
        <div class="pc-meta">更新于 ${fmtUpdated(p.updatedAt)}</div>
      </div>
      <div class="pc-actions">
        <button class="btn btn-ghost btn-sm" data-pt-copy="${p.id}">复制到其他 harness</button>
        <button class="btn btn-ghost btn-sm" data-pt-edit="${p.id}">编辑</button>
        <button class="btn btn-ghost btn-sm" data-pt-del="${p.id}" ${p.enabled?'disabled title="已激活的提示词不可删除，请先停用"':''}>删除</button>
      </div>
    </div>`).join('');

  // 激活 / 停用（G3：走 enablePrompt/disablePrompt；失败回滚 checkbox）
  $('prompt-list').querySelectorAll('[data-pt-toggle]').forEach(cb=>{
    cb.addEventListener('change', async ()=>{
      const p = state.promptsByAgent[agentId].find(x=>x.id===cb.dataset.ptToggle);
      if(!p) return;
      const on = cb.checked;
      try {
        if(on){
          state.promptsByAgent[agentId] = await window.hub.enablePrompt(agentId, p.id);
          showToast(`已激活「${p.name}」，内容写入 ${promptFile}（原文件外部改动已自动回填）`);
        } else {
          state.promptsByAgent[agentId] = await window.hub.disablePrompt(agentId);
          showToast(`已停用「${p.name}」，${promptFile} 已清空`);
        }
        renderPrompts();
        renderDashboard();
      } catch (err) {
        cb.checked = !on;   // 失败回滚 checkbox
        showToast('操作失败：' + err.message);
      }
    });
  });
  // 编辑
  $('prompt-list').querySelectorAll('[data-pt-edit]').forEach(btn=>{
    btn.addEventListener('click', ()=> openPromptForm(btn.dataset.ptEdit));
  });
  // 删除（启用中条目按钮已禁用；确认后走 deletePrompt）
  $('prompt-list').querySelectorAll('[data-pt-del]').forEach(btn=>{
    if(btn.disabled) return;
    btn.addEventListener('click', ()=>{
      const p = state.promptsByAgent[agentId].find(x=>x.id===btn.dataset.ptDel);
      askConfirm('删除提示词', `确定删除「${p.name}」？`, async ()=>{
        try {
          state.promptsByAgent[agentId] = await window.hub.deletePrompt(agentId, p.id);
          renderPrompts();
          renderDashboard();
          showToast(`已删除提示词「${p.name}」`);
        } catch (err) {
          showToast('操作失败：' + err.message);
        }
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
  const promptFile = resolvedOf(state.currentPromptAgent);
  const editing = editingId ? state.promptsByAgent[state.currentPromptAgent].find(p=>p.id===editingId) : null;
  $('pf-title').textContent = editing ? '编辑提示词' : '新增提示词';
  $('pf-sub').textContent = `${agent.name} · 激活后写入 ${promptFile}`;
  $('pf-name').value = editing ? editing.name : '';
  $('pf-desc').value = editing ? (editing.desc||'') : '';
  $('pf-content').value = editing ? editing.content : '';
  $('modal-prompt-form').classList.add('open');
}
$('pf-cancel').addEventListener('click', ()=> $('modal-prompt-form').classList.remove('open'));
$('pf-save').addEventListener('click', async ()=>{
  const name = $('pf-name').value.trim();
  if(!name){ showToast('请填写提示词名称'); return; }
  const agentId = state.currentPromptAgent;
  const promptFile = resolvedOf(agentId);
  const editing = state.promptEditing;
  const item = editing
    ? {...state.promptsByAgent[agentId].find(x=>x.id===editing.id), name,
       desc: $('pf-desc').value.trim(), content: $('pf-content').value}
    : {id:'', name, desc: $('pf-desc').value.trim(), content: $('pf-content').value, enabled:false, updatedAt:0};
  try {
    state.promptsByAgent[agentId] = await window.hub.savePrompt(agentId, item);
  } catch (err) {
    showToast('操作失败：' + err.message);
    return;
  }
  $('modal-prompt-form').classList.remove('open');
  renderPrompts();
  renderDashboard();
  if(editing){
    // 后端保存已激活条目时立即写入指令文件（原型文案一致）
    showToast(item.enabled ? `已保存并写入 ${promptFile}` : '已保存（未激活，不影响指令文件）');
  } else {
    showToast(`已创建提示词「${name}」（未激活）`);
  }
});

/* ---- 复制到其他 harness（G3：走 copyPrompt，toast 列出实际复制成功的目标） ---- */
export async function openCopyModal(promptId){
  const agentId = state.currentPromptAgent;
  const source = (state.promptsByAgent[agentId]||[]).find(p=>p.id===promptId);
  if(!source) return;
  state.copySourcePrompt = source;
  const fromAgent = AGENT_BY(agentId);
  $('cp-sub').textContent = `将「${source.name}」（来自 ${fromAgent.name}）复制为以下 harness 提示词库中的新条目`;
  const targets = AGENTS.filter(a=>a.id!==agentId);
  // 目标库条数取真实数据（未加载的先补拉）
  for(const a of targets){ await ensurePromptLib(a.id); }
  $('cp-targets').innerHTML = targets.map(a=>{
    const n = state.promptsByAgent[a.id].length;
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
$('cp-confirm').addEventListener('click', async ()=>{
  const checked = [...document.querySelectorAll('#cp-targets input:checked')].map(c=>c.value);
  if(checked.length===0){ showToast('请至少选择一个目标 harness'); return; }
  const agentId = state.currentPromptAgent;
  try {
    const res = await window.hub.copyPrompt(agentId, state.copySourcePrompt.id, checked);
    if(res.copiedTo.length===0){ showToast('未复制到任何 harness'); return; }
    // 复制结果落库 -> 目标库重新拉取（本地缓存同步）
    for(const id of res.copiedTo){ state.promptsByAgent[id] = await window.hub.listPrompts(id); }
    $('modal-copy').classList.remove('open');
    const names = res.copiedTo.map(id=>AGENT_BY(id).short).join('、');
    showToast(`已复制到 ${names}（未激活，可在各自库中激活）`);
    renderPrompts();
    renderDashboard();
  } catch (err) {
    showToast('操作失败：' + err.message);
  }
});