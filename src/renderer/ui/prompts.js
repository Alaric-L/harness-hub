/* ================= 提示词 v2：当前内容（live） + 已保存命名库（saved） ================= */
import { AGENTS, AGENT_BY } from '../data.js';
import { icon } from '../icons.js';
import { $, showToast, askConfirm, esc } from './common.js';
import { state } from '../state.js';
import { renderDashboard } from './dashboard.js';
import { formatPromptMtime, liveStatusText, promptDiffText } from './prompt-view.js';

function resolvedOf(agentId){
  const r = state.agentsDetailed && state.agentsDetailed.resolved[agentId];
  return (r && r.promptFile) ? r.promptFile : AGENT_BY(agentId).promptFile;
}

function fmtUpdated(ts){
  if(!ts) return '未知';
  const diff = Date.now() - ts;
  if(diff < 60e3) return '刚刚';
  if(diff < 3600e3) return `${Math.floor(diff/60e3)} 分钟前`;
  if(diff < 86400e3) return `${Math.floor(diff/3600e3)} 小时前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

function syncSnapshot(snapshot){
  const agentId = snapshot.live.agentId;
  state.promptSnapshots[agentId] = snapshot;
  state.promptsByAgent[agentId] = snapshot.prompts;
}

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

async function ensurePromptSnapshot(agentId, force = false){
  if(force || state.promptSnapshots[agentId] === undefined){
    const snapshot = await window.hub.getPromptSnapshot(agentId);
    syncSnapshot(snapshot);
  }
}

function snapshotOf(agentId){
  return state.promptSnapshots[agentId];
}

function statusClass(live, prompts){
  if(!live.exists) return 'missing';
  if(live.content === '') return 'missing';
  return live.matchedIds.length === 0 ? 'custom' : 'match';
}

function renderLiveCard(agentId, promptFile){
  const snapshot = snapshotOf(agentId);
  const live = snapshot.live;
  const status = liveStatusText(live, snapshot.prompts);
  $('prompt-live-card').innerHTML = `
    <div class="live-head">
      <span class="live-title">当前内容</span>
      <span class="live-status ${statusClass(live, snapshot.prompts)}">${esc(status)}</span>
      <span class="live-mtime">最后修改：${formatPromptMtime(live.mtime)}</span>
      <button class="btn btn-ghost btn-sm" id="btn-refresh-live">刷新</button>
    </div>
    <details class="live-preview">
      <summary>内容预览</summary>
      <pre>${esc(live.content)}</pre>
    </details>
    <div class="live-actions">
      <button class="btn btn-ghost btn-sm" id="btn-edit-live">编辑</button>
      <button class="btn btn-primary btn-sm" id="btn-save-live-as">另存为新提示词</button>
    </div>
    <div class="field-hint">指令文件路径：${esc(promptFile)}</div>
  `;

  $('btn-refresh-live').addEventListener('click', async ()=>{
    try {
      syncSnapshot(await window.hub.getPromptSnapshot(agentId));
      renderPrompts();
      showToast('已刷新当前内容');
    } catch (err) {
      showToast('操作失败：' + err.message);
    }
  });
  $('btn-edit-live').addEventListener('click', ()=>{
    $('live-form-sub').textContent = `保存将直接写回 ${promptFile}`;
    $('live-editor-content').value = snapshotOf(agentId).live.content;
    $('modal-live-form').classList.add('open');
  });
  $('btn-save-live-as').addEventListener('click', ()=>{
    openPromptForm(null, { content: snapshotOf(agentId).live.content });
  });
}

function renderSavedList(agentId){
  const list = state.promptsByAgent[agentId] || [];
  const hasList = list.length > 0;
  $('prompt-list').innerHTML = list.map(p=>`
    <div class="prompt-card">
      <div class="pc-main">
        <div class="pc-name">${esc(p.name)}</div>
        ${p.desc ? `<div class="pc-desc">${esc(p.desc)}</div>` : ''}
        <div class="pc-meta">更新于 ${fmtUpdated(p.updatedAt)}</div>
      </div>
      <div class="pc-actions">
        <button class="btn btn-primary btn-sm" data-pt-apply="${p.id}">应用</button>
        <button class="btn btn-ghost btn-sm" data-pt-compare="${p.id}">对比</button>
        <button class="btn btn-ghost btn-sm" data-pt-copy="${p.id}">复制到其他 harness</button>
        <button class="btn btn-ghost btn-sm" data-pt-edit="${p.id}">编辑</button>
        <button class="btn btn-ghost btn-sm" data-pt-del="${p.id}">删除</button>
      </div>
    </div>`).join('');
  $('prompt-saved-empty').classList.toggle('hidden', hasList);
  $('prompt-list').classList.toggle('hidden', !hasList);
}

async function applyPromptById(agentId, id, name){
  try {
    syncSnapshot(await window.hub.applyPrompt(agentId, id));
    await renderPrompts();
    showToast(`已应用「${name}」`);
  } catch (err) {
    showToast('操作失败：' + err.message);
  }
}

function openApplyConfirm(agentId, prompt){
  const live = snapshotOf(agentId).live;
  $('apply-prompt-message').textContent =
    `当前文件有未保存的内容，应用「${prompt.name}」将覆盖它。可以先保存当前内容为新提示词，或直接覆盖。`;
  $('modal-apply-prompt').classList.add('open');

  $('apply-cancel').onclick = ()=>{
    $('modal-apply-prompt').classList.remove('open');
  };
  $('apply-overwrite').onclick = async ()=>{
    $('modal-apply-prompt').classList.remove('open');
    await applyPromptById(agentId, prompt.id, prompt.name);
  };
  $('apply-save-first').onclick = ()=>{
    $('modal-apply-prompt').classList.remove('open');
    openPromptForm(null, { content: live.content, applyAfterSave: true });
  };
}

function attachSavedActions(agentId){
  const list = state.promptsByAgent[agentId] || [];
  const find = id => list.find(p=>p.id===id);

  $('prompt-list').querySelectorAll('[data-pt-apply]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const p = find(btn.dataset.ptApply);
      if(!p) return;
      const live = snapshotOf(agentId).live;
      const noContent = !live.exists || live.content === '';
      if(live.matchedIds.length === 0 && !noContent){
        openApplyConfirm(agentId, p);
        return;
      }
      await applyPromptById(agentId, p.id, p.name);
    });
  });

  $('prompt-list').querySelectorAll('[data-pt-compare]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const p = find(btn.dataset.ptCompare);
      if(!p) return;
      const snapshot = snapshotOf(agentId);
      $('prompt-compare-title').textContent = `对比「${p.name}」`;
      $('prompt-compare-sub').textContent = `当前文件：${snapshot.live.path}`;
      $('prompt-compare-diff').textContent = promptDiffText(snapshot.live.content, p.content);
      $('prompt-compare-apply').onclick = async ()=>{
        $('modal-prompt-compare').classList.remove('open');
        const live = snapshotOf(agentId).live;
        const noContent = !live.exists || live.content === '';
        if(live.matchedIds.length === 0 && !noContent){
          openApplyConfirm(agentId, p);
          return;
        }
        await applyPromptById(agentId, p.id, p.name);
      };
      $('modal-prompt-compare').classList.add('open');
    });
  });

  $('prompt-list').querySelectorAll('[data-pt-edit]').forEach(btn=>{
    btn.addEventListener('click', ()=> openPromptForm(btn.dataset.ptEdit));
  });

  $('prompt-list').querySelectorAll('[data-pt-del]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const p = find(btn.dataset.ptDel);
      if(!p) return;
      askConfirm('删除提示词', `确定删除「${p.name}」？删除不会修改当前指令文件。`, async ()=>{
        try {
          state.promptsByAgent[agentId] = await window.hub.deletePrompt(agentId, p.id);
          const snapshot = snapshotOf(agentId);
          snapshot.prompts = state.promptsByAgent[agentId];
          snapshot.live.matchedIds = snapshot.prompts
            .filter(item => item.content === snapshot.live.content)
            .map(item => item.id);
          renderPrompts();
          renderDashboard();
          showToast(`已删除提示词「${p.name}」`);
        } catch (err) {
          showToast('操作失败：' + err.message);
        }
      }, '删除');
    });
  });

  $('prompt-list').querySelectorAll('[data-pt-copy]').forEach(btn=>{
    btn.addEventListener('click', ()=> openCopyModal(btn.dataset.ptCopy));
  });
}

export async function renderPrompts(){
  $('prompt-tabs').innerHTML = AGENTS.map(a=>`
    <button class="prompt-tab ${a.id===state.currentPromptAgent?'active':''}" data-agent="${a.id}" title="${a.name}">
      ${icon(a.id, 15, a.name)}<span>${a.short}</span>
    </button>`).join('');
  $('prompt-tabs').querySelectorAll('.prompt-tab').forEach(t=>{
    t.addEventListener('click', async ()=>{
      state.currentPromptAgent = t.dataset.agent;
      await renderPrompts();
    });
  });

  const agentId = state.currentPromptAgent;
  await ensurePromptSnapshot(agentId, true);
  const promptFile = snapshotOf(agentId).live.path || resolvedOf(agentId);
  $('prompt-file').textContent = `指令文件 · ${promptFile}`;

  renderLiveCard(agentId, promptFile);
  renderSavedList(agentId);
  attachSavedActions(agentId);
}

$('btn-add-prompt').addEventListener('click', ()=> openPromptForm(null));
$('btn-add-prompt-empty').addEventListener('click', ()=> openPromptForm(null));

$('live-editor-cancel').addEventListener('click', ()=>{
  $('modal-live-form').classList.remove('open');
});
$('live-editor-save').addEventListener('click', async ()=>{
  const agentId = state.currentPromptAgent;
  try {
    syncSnapshot(await window.hub.saveLivePrompt(agentId, $('live-editor-content').value));
    $('modal-live-form').classList.remove('open');
    await renderPrompts();
    showToast('当前内容已保存');
  } catch (err) {
    showToast('操作失败：' + err.message);
  }
});
$('prompt-compare-close').addEventListener('click', ()=>{
  $('modal-prompt-compare').classList.remove('open');
});

export function openPromptForm(editingId, initial = null){
  state.promptEditing = editingId ? {agentId: state.currentPromptAgent, id: editingId} : null;
  state.promptFormIntent = initial?.applyAfterSave ? { applyAfterSave: true } : null;
  const agent = AGENT_BY(state.currentPromptAgent);
  const editing = editingId ? state.promptsByAgent[state.currentPromptAgent].find(p=>p.id===editingId) : null;
  $('pf-title').textContent = editing ? '编辑提示词' : '新增提示词';
  $('pf-sub').textContent = `${agent.name} · 保存后仅更新提示词库`;
  $('pf-name').value = editing ? editing.name : '';
  $('pf-desc').value = editing ? (editing.desc||'') : '';
  $('pf-content').value = editing ? editing.content : (initial?.content || '');
  $('modal-prompt-form').classList.add('open');
}

$('pf-cancel').addEventListener('click', ()=> $('modal-prompt-form').classList.remove('open'));
$('pf-save').addEventListener('click', async ()=>{
  const name = $('pf-name').value.trim();
  if(!name){ showToast('请填写提示词名称'); return; }
  const agentId = state.currentPromptAgent;
  const editing = state.promptEditing;
  const intent = state.promptFormIntent;
  const previousIds = new Set((state.promptsByAgent[agentId] || []).map(p=>p.id));
  const item = editing
    ? {
        ...state.promptsByAgent[agentId].find(p=>p.id===editing.id),
        name,
        desc: $('pf-desc').value.trim(),
        content: $('pf-content').value
      }
    : {
        id: '',
        name,
        desc: $('pf-desc').value.trim(),
        content: $('pf-content').value,
        createdAt: 0,
        updatedAt: 0
      };

  try {
    const list = await window.hub.savePrompt(agentId, item);
    state.promptsByAgent[agentId] = list;

    if(intent?.applyAfterSave){
      const saved = list.find(p=>!previousIds.has(p.id));
      if(!saved) throw new Error('未找到刚保存的提示词');
      syncSnapshot(await window.hub.applyPrompt(agentId, saved.id));
      state.promptFormIntent = null;
      $('modal-prompt-form').classList.remove('open');
      await renderPrompts();
      renderDashboard();
      showToast(`已保存「${name}」并应用到当前指令文件`);
      return;
    }

    state.promptFormIntent = null;
    $('modal-prompt-form').classList.remove('open');
    await renderPrompts();
    renderDashboard();
    showToast(editing ? `已保存提示词「${name}」` : `已创建提示词「${name}」`);
  } catch (err) {
    showToast('操作失败：' + err.message);
  }
});

export async function openCopyModal(promptId){
  const agentId = state.currentPromptAgent;
  const source = (state.promptsByAgent[agentId]||[]).find(p=>p.id===promptId);
  if(!source) return;
  state.copySourcePrompt = source;
  const fromAgent = AGENT_BY(agentId);
  $('cp-sub').textContent = `将「${source.name}」（来自 ${fromAgent.name}）复制为以下 harness 提示词库中的新条目`;
  const targets = AGENTS.filter(a=>a.id!==agentId);
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
    for(const id of res.copiedTo){ state.promptsByAgent[id] = await window.hub.listPrompts(id); }
    $('modal-copy').classList.remove('open');
    const names = res.copiedTo.map(id=>AGENT_BY(id).short).join('、');
    showToast(`已复制到 ${names}（可在各自库中应用）`);
    renderPrompts();
    renderDashboard();
  } catch (err) {
    showToast('操作失败：' + err.message);
  }
});
