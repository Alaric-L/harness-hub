/* ================= 计数徽章行（AppCountBar） / 矩阵表格 / 过滤 ================= */
import { AGENTS, AGENT_BY, MCP_ITEMS, SKILLS_INSTALLED, SKILL_BACKUPS } from '../data.js';
import { icon } from '../icons.js';
import { $, showToast, askConfirm } from './common.js';
import { state } from '../state.js';
import { openDetail } from './detail.js';
import { openMcpForm } from './mcp-form.js';
import { renderDashboard } from './dashboard.js';

export function renderCountBar(containerId, items, kind){
  const el = $(containerId);
  const unit = kind==='mcp' ? 'MCP' : 'Skill';
  const badges = AGENTS.map(a=>{
    const n = items.filter(i=>i.apps[a.id]).length;
    const allOn = items.length>0 && n>=items.length;
    return `<button class="count-badge ${allOn?'all-on':''}" data-bulk="${a.id}" data-kind="${kind}"
      title="${a.name}：${n} 个已开启 · 点击${allOn?'全部关闭':'全部开启'}">
      ${icon(a.id, 15, a.name)}<b>${n}</b>
    </button>`;
  }).join('');
  el.innerHTML = `<div class="count-bar">
    <span class="count-total">${items.length} 个${unit}</span>
    <div class="count-badges">${badges}</div>
  </div>`;
  el.querySelectorAll('[data-bulk]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const agentId = btn.dataset.bulk;
      const agent = AGENT_BY(agentId);
      const allOn = items.length>0 && items.every(i=>i.apps[agentId]);
      const target = allOn ? 0 : 1;
      items.forEach(i=> i.apps[agentId] = target);
      showToast(`已在 ${agent.name} 中${target?'全部开启':'全部关闭'}${kind==='mcp'?' MCP':' Skills'}`);
      renderCountBar(containerId, items, kind);
      renderMatrix(kind);
    });
  });
}

export function renderMatrix(kind){
  const tableId = kind==='mcp' ? 'mcp-table' : 'skills-table';
  const table = $(tableId);
  const items = kind==='mcp' ? MCP_ITEMS : SKILLS_INSTALLED;

  const thead = `<thead><tr>
    <th class="col-name">名称 / 描述</th>
    ${AGENTS.map(a=>`<th class="col-agent"><span class="agent-col-ic" title="${a.name}">${icon(a.id, 24, a.name)}</span></th>`).join('')}
    <th style="width:150px;"></th>
  </tr></thead>`;

  const rows = items.map(item=>{
    const rowId = kind==='mcp' ? item.id : item.dir;
    const cells = AGENTS.map(a=>`
      <td class="col-agent">
        <label class="switch" title="${a.name}">
          <input type="checkbox" ${item.apps[a.id]?'checked':''} data-toggle="${rowId}" data-agent="${a.id}" data-kind="${kind}">
          <span class="slider"></span>
        </label>
      </td>`).join('');

    let titleExtras = '';
    if(kind==='skill'){
      titleExtras = (item.repo ? `<span class="repo-badge">${item.repo}</span>` : `<span class="repo-badge">本地</span>`)
        + (item.hasUpdate ? `<span class="upd-badge">可更新</span>` : '');
    } else {
      const link = item.docs || item.homepage;
      if(link) titleExtras += `<button class="title-link" data-open-link="${link}" title="${item.docs ? '打开文档' : '打开主页'}">↗</button>`;
    }

    let actions = '';
    if(kind==='mcp'){
      actions = `<span class="row-actions">
        <button class="btn btn-ghost btn-sm" data-detail="${item.id}" data-kind="mcp">详情</button>
        <button class="btn btn-ghost btn-sm" data-edit="${item.id}" data-kind="mcp">编辑</button>
        <button class="btn btn-ghost btn-sm" data-del="${item.id}" data-kind="mcp">删除</button>
      </span>`;
    } else {
      actions = `<span class="row-actions">
        <button class="btn btn-ghost btn-sm" data-detail="${item.dir}" data-kind="skill">详情</button>
        ${item.hasUpdate ? `<button class="btn btn-ghost btn-sm" data-upd="${item.dir}">更新</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-uninst="${item.dir}">卸载</button>
      </span>`;
    }

    const searchText = [
      item.name, item.desc, item.tag,
      item.spec && item.spec.command,
      item.spec && item.spec.url,
      item.spec && (item.spec.args||[]).join(' '),
      item.repo,
    ].filter(Boolean).join(' ').toLowerCase().replace(/"/g,'&quot;');

    return `<tr class="row" data-search="${searchText}">
      <td class="col-name">
        <div class="item-title">${item.name} <span class="type-badge ${kind}">${kind==='mcp'?'MCP':'SKILL'}</span>${titleExtras}</div>
        <div class="item-desc">${item.desc}</div>
      </td>
      ${cells}
      <td class="col-actions">${actions}</td>
    </tr>`;
  }).join('');

  table.innerHTML = thead + `<tbody>${rows}</tbody>`;

  // 开关
  table.querySelectorAll('input[type="checkbox"][data-toggle]').forEach(cb=>{
    cb.addEventListener('change', e=>{
      const rowId = e.target.dataset.toggle;
      const agent = e.target.dataset.agent;
      const k = e.target.dataset.kind;
      const it = (k==='mcp' ? MCP_ITEMS : SKILLS_INSTALLED).find(i=> (k==='mcp' ? i.id : i.dir) === rowId);
      if(!it) return;
      it.apps[agent] = e.target.checked ? 1 : 0;
      const agentObj = AGENT_BY(agent);
      if(k==='mcp'){
        showToast(e.target.checked
          ? `已在 ${agentObj.name} 中开启 ${rowId}（写入 ${agentObj.mcpPath}）`
          : `已在 ${agentObj.name} 中关闭 ${rowId}（从 ${agentObj.mcpPath} 移除）`);
        renderCountBar('mcp-countbar', MCP_ITEMS, 'mcp');
      } else {
        showToast(e.target.checked
          ? `已在 ${agentObj.name} 中开启 Skill ${rowId}（部署到 ${agentObj.skillsDir}）`
          : `已在 ${agentObj.name} 中关闭 Skill ${rowId}（移除部署）`);
        renderCountBar('skills-countbar', SKILLS_INSTALLED, 'skill');
      }
      applyMatrixFilters(k);
    });
  });

  // 详情 / 编辑 / 删除 / 更新 / 卸载 / 外链
  table.querySelectorAll('[data-detail]').forEach(btn=>{
    btn.addEventListener('click', ()=> openDetail(btn.dataset.detail, btn.dataset.kind));
  });
  table.querySelectorAll('[data-open-link]').forEach(btn=>{
    btn.addEventListener('click', e=>{
      e.stopPropagation();
      window.open(btn.dataset.openLink, '_blank');
    });
  });
  table.querySelectorAll('[data-edit]').forEach(btn=>{
    btn.addEventListener('click', ()=> openMcpForm(btn.dataset.edit));
  });
  table.querySelectorAll('[data-del]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const item = MCP_ITEMS.find(i=>i.id===btn.dataset.del);
      askConfirm('删除 MCP', `确定删除「${item.name}」吗？将从所有启用了它的 harness 配置文件中移除。`, ()=>{
        const idx = MCP_ITEMS.indexOf(item);
        MCP_ITEMS.splice(idx,1);
        renderCountBar('mcp-countbar', MCP_ITEMS, 'mcp');
        renderMatrix('mcp');
        renderDashboard();
        showToast(`已删除 MCP「${item.name}」，并从各 harness 配置中移除`);
      }, '删除');
    });
  });
  table.querySelectorAll('[data-upd]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const s = SKILLS_INSTALLED.find(i=>i.dir===btn.dataset.upd);
      s.hasUpdate = false;
      renderMatrix('skill');
      showToast(`已更新 Skill「${s.name}」到最新版本`);
    });
  });
  table.querySelectorAll('[data-uninst]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const s = SKILLS_INSTALLED.find(i=>i.dir===btn.dataset.uninst);
      askConfirm('卸载 Skill', `确定卸载「${s.name}」吗？将从所有 harness 的 skills 目录移除部署，并在备份列表保留一份副本。`, ()=>{
        const idx = SKILLS_INSTALLED.indexOf(s);
        SKILLS_INSTALLED.splice(idx,1);
        SKILL_BACKUPS.unshift({backupId:'bk-'+Date.now(), name:s.name, dir:s.dir, desc:s.desc,
          createdAt:'刚刚', path:`~/.harness-hub/skill-backups/${s.dir}-just-now`});
        renderCountBar('skills-countbar', SKILLS_INSTALLED, 'skill');
        renderMatrix('skill');
        renderDashboard();
        showToast(`已卸载 Skill「${s.name}」，备份保存在 ~/.harness-hub/skill-backups/`);
      }, '卸载');
    });
  });

  applyMatrixFilters(kind);
}

export function applyMatrixFilters(kind){
  const tableId = kind==='mcp' ? 'mcp-table' : 'skills-table';
  let visible = 0;
  document.querySelectorAll(`#${tableId} tbody tr`).forEach(row=>{
    const q = kind==='mcp' ? state.mcpQuery : state.skillQuery;
    const ok = !q || (row.dataset.search || '').includes(q);
    row.classList.toggle('dim', !ok);
    if(ok) visible++;
  });
  if(kind==='mcp'){
    const empty = visible===0;
    $('mcp-empty').style.display = empty ? 'block' : 'none';
    document.querySelector('#view-mcp .matrix-wrap').style.display = empty ? 'none' : 'block';
  }
}

/* ================= MCP 搜索（名称 / 描述 / 标签 / 命令） ================= */
$('mcp-search-input').addEventListener('input', e=>{
  state.mcpQuery = e.target.value.trim().toLowerCase();
  applyMatrixFilters('mcp');
});