/* ================= Skills：子视图切换 / 备份 / 导入 / 发现 / 仓库管理（G2：全部接真实后端） ================= */
import { SKILL_TARGETS, SKILL_TARGET_BY } from '../data.js';
import { icon } from '../icons.js';
import { $, showToast, askConfirm, errMsg } from './common.js';
import { importDeployHint, importConfirmMessage } from './import-notice.js';
import { state } from '../state.js';
import { renderCountBar, renderMatrix } from './matrix.js';
import { renderDashboard } from './dashboard.js';

/* ---- 子视图切换 ---- */
document.querySelectorAll('[data-skills-tab]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    state.skillsTab = btn.dataset.skillsTab;
    document.querySelectorAll('[data-skills-tab]').forEach(b=>b.classList.toggle('active', b===btn));
    $('skills-installed-wrap').style.display = state.skillsTab==='installed' ? 'block' : 'none';
    $('skills-discovery-wrap').style.display = state.skillsTab==='discovery' ? 'block' : 'none';
    $('skills-installed-actions').style.display = state.skillsTab==='installed' ? 'flex' : 'none';
    $('skills-discovery-actions').style.display = state.skillsTab==='discovery' ? 'flex' : 'none';
    if(state.skillsTab==='discovery') renderDiscovery(true);   // 切到发现页才拉网络（懒加载）
  });
});

/* ---- 已安装视图动作 ---- */
$('btn-skill-check-updates').addEventListener('click', async ()=>{
  const btn = $('btn-skill-check-updates');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '检查中…';
  try {
    state.skillsItems = await window.hub.checkSkillUpdates();
    const n = state.skillsItems.filter(s=>s.hasUpdate).length;
    renderCountBar('skills-countbar', state.skillsItems, 'skill');
    renderMatrix('skill');
    renderDashboard();
    showToast(n>0 ? `发现 ${n} 个 Skill 可更新（列表中标「可更新」）` : '所有 Skill 均为最新版本');
  } catch (err) {
    showToast('操作失败：' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
});
$('btn-skill-zip').addEventListener('click', async ()=>{
  const btn = $('btn-skill-zip');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '选择 ZIP…';
  try {
    const list = await window.hub.installSkillZip();   // 主进程 dialog 选 zip；取消返回空列表
    const oldDirs = new Set(state.skillsItems.map(i=>i.dir));
    const added = list.filter(i=>!oldDirs.has(i.dir));
    if(added.length===0) return;   // 用户取消：安静处理
    state.skillsItems = list;
    renderCountBar('skills-countbar', state.skillsItems, 'skill');
    renderMatrix('skill');
    renderDashboard();
    showToast(`已从 ZIP 安装 ${added.length} 个 Skill：${added.map(i=>i.name).join('、')}`);
  } catch (err) {
    showToast('操作失败：' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
});
$('btn-skill-backups').addEventListener('click', async ()=>{
  $('modal-backups').classList.add('open');
  await loadBackups();
});
$('backups-close').addEventListener('click', ()=> $('modal-backups').classList.remove('open'));

async function loadBackups(){
  $('backup-list').innerHTML = `<div class="empty-box" style="padding:30px;"><p>加载中…</p></div>`;
  try {
    state.skillBackups = await window.hub.listSkillBackups();
  } catch (err) {
    $('backup-list').innerHTML = `<div class="empty-box" style="padding:30px;"><h4>加载失败</h4><p>${errMsg(err)}</p></div>`;
    showToast('操作失败：' + err.message);
    return;
  }
  renderBackups();
}

function renderBackups(){
  $('backup-list').innerHTML = state.skillBackups.length===0
    ? `<div class="empty-box" style="padding:30px;"><h4>暂无备份</h4><p>卸载 Skill 时会自动在此保留副本</p></div>`
    : state.skillBackups.map(b=>`
    <div class="backup-item">
      <div class="b-top">
        <span><span class="b-name">${b.name}</span><span class="b-dir">${b.dir}</span></span>
        <span style="font-size:11px;color:var(--text-faint);">${new Date(b.createdAt).toLocaleString('zh-CN',{hour12:false})}</span>
      </div>
      <div class="b-path">${b.path}</div>
      <div class="b-actions">
        <button class="btn btn-ghost btn-sm" data-restore="${b.backupId}">恢复</button>
        <button class="btn btn-danger btn-sm" data-delbk="${b.backupId}">删除备份</button>
      </div>
    </div>`).join('');

  $('backup-list').querySelectorAll('[data-restore]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const bk = state.skillBackups.find(b=>b.backupId===btn.dataset.restore);
      if(!bk) return;
      btn.disabled = true; btn.textContent = '恢复中…';
      try {
        await window.hub.restoreSkillBackup(bk.backupId, false);   // 默认恢复不部署
        state.skillsItems = await window.hub.listSkills();
        renderCountBar('skills-countbar', state.skillsItems, 'skill');
        renderMatrix('skill');
        renderDashboard();
        $('modal-backups').classList.remove('open');
        showToast(`已恢复 Skill「${bk.name}」，默认未部署到任何 harness`);
      } catch (err) {
        showToast('操作失败：' + err.message);
      }
    });
  });
  $('backup-list').querySelectorAll('[data-delbk]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const bk = state.skillBackups.find(b=>b.backupId===btn.dataset.delbk);
      if(!bk) return;
      askConfirm('删除备份', `彻底删除「${bk.name}」的备份？此操作不可恢复。`, async ()=>{
        try {
          state.skillBackups = await window.hub.deleteSkillBackup(bk.backupId);
          renderBackups();
          showToast(`已删除「${bk.name}」的备份`);
        } catch (err) {
          showToast('操作失败：' + err.message);
        }
      }, '删除');
    });
  });
}

/* ---- 从 harness 导入 ---- */
$('btn-skill-import').addEventListener('click', async ()=>{
  const btn = $('btn-skill-import');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '扫描中…';
  try {
    state.unmanagedSkills = await window.hub.listUnmanagedSkills();
  } catch (err) {
    showToast('操作失败：' + err.message);
    btn.disabled = false; btn.textContent = orig;
    return;
  }
  btn.disabled = false; btn.textContent = orig;
  renderUnmanaged();
  $('import-deploy-hint').textContent = importDeployHint(state.settings?.syncMethod || 'copy');
  $('modal-import-skills').classList.add('open');
});
$('import-skills-close').addEventListener('click', ()=> $('modal-import-skills').classList.remove('open'));

function renderUnmanaged(){
  $('unmanaged-list').innerHTML = state.unmanagedSkills.map((s,i)=>`
    <div class="unmanaged-item">
      <input type="checkbox" checked data-um="${i}">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:13px;">${s.name}</div>
        <div style="font-size:11.5px;color:var(--text-dim);margin-top:2px;">${s.desc}</div>
        <div style="font-family:var(--font-mono);font-size:10.5px;color:var(--text-faint);margin-top:3px;">${s.path} · 发现于 ${s.foundIn.map(f=>SKILL_TARGET_BY(f)?.short||f).join('、')}</div>
        <div class="mini-toggles">
          ${SKILL_TARGETS.map(a=>`<button class="mini-toggle ${s.foundIn.includes(a.id)?'on':''}" data-um-app="${i}" data-app="${a.id}" title="${a.name}">${icon(a.id,15,a.name)}</button>`).join('')}
        </div>
      </div>
    </div>`).join('');

  $('unmanaged-list').querySelectorAll('[data-um-app]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      btn.classList.toggle('on');
    });
  });
  syncToggleAllLabel();
}

/* 全选/取消全选：单按钮动态文案（文案 = 点击后将执行的动作），随列表渲染与手动勾选实时同步 */
function syncToggleAllLabel(){
  const boxes = [...document.querySelectorAll('#unmanaged-list input[data-um]')];
  const all = boxes.length > 0 && boxes.every(b=>b.checked);
  $('import-skills-toggle-all').textContent = all ? '取消全选' : '全选';
}
$('import-skills-toggle-all').addEventListener('click', ()=>{
  const boxes = [...document.querySelectorAll('#unmanaged-list input[data-um]')];
  const all = boxes.length > 0 && boxes.every(b=>b.checked);
  boxes.forEach(b=>{ b.checked = !all; });
  syncToggleAllLabel();
});
$('unmanaged-list').addEventListener('change', e=>{
  if(e.target && e.target.matches && e.target.matches('input[data-um]')) syncToggleAllLabel();
});
$('import-skills-confirm').addEventListener('click', async ()=>{
  const selected = [...document.querySelectorAll('#unmanaged-list input[data-um]:checked')].map(c=>parseInt(c.dataset.um,10));
  if(selected.length===0){ showToast('请至少选择一个 Skill'); return; }
  const items = selected.map(i=>{
    const s = state.unmanagedSkills[i];
    const apps = {};
    document.querySelectorAll(`#unmanaged-list [data-um-app="${i}"]`).forEach(btn=>{
      apps[btn.dataset.app] = btn.classList.contains('on');
    });
    return {dir:s.dir, apps};
  });
  // 二级确认：按当前部署方式告知对 harness 内已有文件的影响（只入库不部署时无此影响）
  const method = state.settings?.syncMethod || 'copy';
  const targets = [...new Set(items.flatMap(it=>Object.entries(it.apps ?? {}).filter(([,on])=>on).map(([id])=>id)))]
    .map(id=>SKILL_TARGET_BY(id)?.short || id);
  const runImport = async ()=>{
    const btn = $('import-skills-confirm');
    const orig = btn.textContent;
    btn.disabled = true; btn.textContent = '导入中…';
    try {
      state.skillsItems = await window.hub.importSkills(items);
      state.unmanagedSkills = [];
      renderCountBar('skills-countbar', state.skillsItems, 'skill');
      renderMatrix('skill');
      renderDashboard();
      $('modal-import-skills').classList.remove('open');
      showToast(`已导入 ${items.length} 个 Skill 到中央库`);
    } catch (err) {
      showToast('操作失败：' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = orig;
    }
  };
  askConfirm('确认导入', importConfirmMessage(method, items.length, targets), runImport, '开始导入');
});

/* ---- 发现页 ---- */
$('btn-skill-refresh').addEventListener('click', ()=> renderDiscovery(true));
document.querySelectorAll('[data-disc-source]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    state.discSource = btn.dataset.discSource;
    document.querySelectorAll('[data-disc-source]').forEach(b=>b.classList.toggle('active', b===btn));
    renderDiscovery(true);
  });
});
let shSearchTimer = null;
$('disc-search-input').addEventListener('input', e=>{
  state.discQuery = e.target.value.trim();
  if(state.discSource==='skillssh'){
    clearTimeout(shSearchTimer);
    shSearchTimer = setTimeout(loadShDiscovery, 250);
  } else {
    renderDiscoveryGrid();
  }
});
$('disc-repo-filter').addEventListener('change', e=>{ state.discRepo = e.target.value; renderDiscoveryGrid(); });
$('disc-status-filter').addEventListener('change', e=>{ state.discStatus = e.target.value; renderDiscoveryGrid(); });

export function renderDiscovery(force){
  // 仓库下拉选项（仅仓库模式使用）
  const repoSel = $('disc-repo-filter');
  if(state.discSource==='repos'){
    repoSel.style.display = '';
    $('disc-status-filter').style.display = '';
  } else {
    repoSel.style.display = 'none';
    $('disc-status-filter').style.display = 'none';
  }
  if(state.discSource==='repos'){
    if(force || state.discoveredSkills===null) loadRepoDiscovery();
    else renderDiscoveryGrid();
  } else {
    loadShDiscovery();
  }
}

async function loadRepoDiscovery(){
  $('skill-grid').innerHTML = `<div class="empty-box" style="grid-column:1/-1;"><p>加载中…</p></div>`;
  const btn = $('btn-skill-refresh');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '刷新中…';
  try {
    const res = await window.hub.listDiscoveryRepos();
    state.discoveredSkills = res.skills || [];
    if(res.errors && res.errors.length) showToast('部分仓库加载失败：' + res.errors[0]);
    const repoSel = $('disc-repo-filter');
    const repos = ['all', ...new Set(state.discoveredSkills.map(s=>s.repo))];
    if(repoSel.options.length !== repos.length || [...repoSel.options].some((o,i)=>o.value!==repos[i])){
      repoSel.innerHTML = repos.map(r=>`<option value="${r}">${r==='all'?'全部仓库':r}</option>`).join('');
      repoSel.value = state.discRepo;
    }
    renderDiscoveryGrid();
  } catch (err) {
    $('skill-grid').innerHTML = `<div class="empty-box" style="grid-column:1/-1;"><h4>加载失败</h4><p>${errMsg(err)}</p></div>`;
    showToast('操作失败：' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
}

async function loadShDiscovery(){
  const q = state.discQuery;
  if(!q){
    $('skill-grid').innerHTML = `<div class="empty-box" style="grid-column:1/-1;"><h4>搜索 skills.sh</h4><p>输入关键词查询公共 Skill 目录，安装后自动进入中央库</p></div>`;
    return;
  }
  $('skill-grid').innerHTML = `<div class="empty-box" style="grid-column:1/-1;"><p>加载中…</p></div>`;
  let list;
  try {
    list = await window.hub.searchSkillsSh(q);
  } catch (err) {
    $('skill-grid').innerHTML = `<div class="empty-box" style="grid-column:1/-1;"><h4>搜索失败</h4><p>${errMsg(err)}</p></div>`;
    showToast('操作失败：' + err.message);
    return;
  }
  state.shSkills = list;
  renderDiscoveryGrid();
}

/** 各来源条目的安装目录名（按该名入 SSOT） */
function installedDirOf(s){
  return (s.directory || s.name).split('/').pop();
}

function renderDiscoveryGrid(){
  const isSh = state.discSource==='skillssh';
  const source = isSh ? state.shSkills : (state.discoveredSkills || []);
  // 尚未加载（初始占位）
  if(!isSh && state.discoveredSkills===null){
    $('skill-grid').innerHTML = `<div class="empty-box" style="grid-column:1/-1;"><p>加载中…</p></div>`;
    return;
  }
  let list = source.filter(s=>{
    const installed = state.skillsItems.some(i=>i.dir===installedDirOf(s));
    if(isSh) return true;
    if(state.discRepo!=='all' && s.repo!==state.discRepo) return false;
    if(state.discStatus==='installed' && !installed) return false;
    if(state.discStatus==='uninstalled' && installed) return false;
    return true;
  });
  if(state.discQuery){
    const q = state.discQuery.toLowerCase();
    list = list.filter(s=> s.name.toLowerCase().includes(q)
      || (s.repo||'').toLowerCase().includes(q)
      || (s.directory||'').toLowerCase().includes(q));
  }

  if(list.length===0){
    $('skill-grid').innerHTML = `<div class="empty-box" style="grid-column:1/-1;"><h4>没有匹配的 Skills</h4><p>尝试更换关键词，或添加新的 Skill 仓库</p></div>`;
    return;
  }

  $('skill-grid').innerHTML = list.map(s=>{
    const installed = state.skillsItems.some(i=>i.dir===installedDirOf(s));
    return `<div class="skill-card">
      <div class="sc-head">
        <div>
          <div class="sc-name">${s.name}</div>
          <div class="sc-badges">
            <span class="repo-badge">${s.repo}</span>
            ${s.installs ? `<span class="installs">↓ ${s.installs.toLocaleString()}</span>` : ''}
          </div>
        </div>
        ${installed ? '<span class="installed-badge">已安装</span>' : ''}
      </div>
      <div class="sc-desc">${s.desc || '包含 SKILL.md 的 Skill 目录'}</div>
      <div class="sc-foot">
        <button class="btn btn-ghost btn-sm" data-view-skill="${s.name}" style="flex:1;">查看文档</button>
        ${installed
          ? '<button class="btn btn-ghost btn-sm" style="flex:1;" disabled>已安装</button>'
          : `<button class="btn btn-primary btn-sm" style="flex:1;" data-install="${s.key}" data-repo="${s.repo}">安装</button>`}
      </div>
    </div>`;
  }).join('');

  $('skill-grid').querySelectorAll('[data-install]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const key = btn.dataset.install;
      const repo = btn.dataset.repo;
      const oldDirs = new Set(state.skillsItems.map(i=>i.dir));
      btn.disabled = true; btn.textContent = '安装中…';
      try {
        let list;
        if(state.discSource==='repos'){
          const [owner, name] = repo.split('/');
          const cfg = state.skillRepos.find(r=>r.owner===owner && r.name===name);
          const branch = (cfg && cfg.branch) || 'main';
          const item = state.discoveredSkills.find(s=>s.key===key);
          list = await window.hub.installSkillFromRepo(owner, name, branch, item ? item.directory : key);
        } else {
          list = await window.hub.installSkillFromSh(key, repo);
        }
        state.skillsItems = list;
        const added = list.filter(i=>!oldDirs.has(i.dir));
        renderCountBar('skills-countbar', state.skillsItems, 'skill');
        renderMatrix('skill');
        renderDashboard();
        renderDiscoveryGrid();
        showToast(`已安装 Skill「${added.length ? added[0].name : key}」，可在「已安装」中为各 harness 开启`);
      } catch (err) {
        showToast('操作失败：' + err.message);
      }
    });
  });
  $('skill-grid').querySelectorAll('[data-view-skill]').forEach(btn=>{
    btn.addEventListener('click', ()=> showToast('该 Skill 的 README 页面将在后续版本支持'));
  });
}

/* ---- 仓库管理 ---- */
$('btn-repo-manager').addEventListener('click', async ()=>{
  const btn = $('btn-repo-manager');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '加载中…';
  try {
    state.skillRepos = await window.hub.listRepos();
  } catch (err) {
    showToast('操作失败：' + err.message);
    btn.disabled = false; btn.textContent = orig;
    return;
  }
  btn.disabled = false; btn.textContent = orig;
  renderRepoList();
  $('modal-repo').classList.add('open');
});
$('repo-close').addEventListener('click', ()=> $('modal-repo').classList.remove('open'));
$('repo-add').addEventListener('click', async ()=>{
  const url = $('repo-url').value.trim();
  if(!url){ showToast('请输入仓库 URL'); return; }
  const branch = $('repo-branch').value.trim() || 'main';   // URL 解析与坐标校验在后端
  const btn = $('repo-add');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '添加中…';
  try {
    state.skillRepos = await window.hub.addRepo(url, branch);
    $('repo-url').value=''; $('repo-branch').value='';
    renderRepoList();
    showToast('已添加仓库，发现页已更新');
  } catch (err) {
    showToast('操作失败：' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
});
function renderRepoList(){
  $('repo-list').innerHTML = state.skillRepos.length===0
    ? `<div class="empty-box" style="padding:26px;"><h4>暂无仓库</h4><p>添加 GitHub 仓库后即可发现其中的 Skills</p></div>`
    : state.skillRepos.map((r,i)=>{
      const count = (state.discoveredSkills||[]).filter(s=>s.repo===`${r.owner}/${r.name}`).length;
      return `<div class="repo-item">
        <div style="flex:1;min-width:0;">
          <div class="r-name">${r.owner}/${r.name}</div>
          <div class="r-meta">分支：${r.branch}</div>
        </div>
        <span class="r-count">${count} Skills</span>
        <button class="btn btn-ghost btn-sm" data-repo-open="${i}">查看</button>
        <button class="btn btn-danger btn-sm" data-repo-del="${i}">移除</button>
      </div>`;
    }).join('');
  $('repo-list').querySelectorAll('[data-repo-open]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const r = state.skillRepos[parseInt(btn.dataset.repoOpen,10)];
      window.open(`https://github.com/${r.owner}/${r.name}`, '_blank');
    });
  });
  $('repo-list').querySelectorAll('[data-repo-del]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const r = state.skillRepos[parseInt(btn.dataset.repoDel,10)];
      askConfirm('移除仓库', `移除仓库 ${r.owner}/${r.name}？已安装的 Skills 不受影响，仅从发现页移除。`, async ()=>{
        try {
          state.skillRepos = await window.hub.removeRepo(r.owner, r.name);
          if(state.discoveredSkills) state.discoveredSkills = state.discoveredSkills.filter(s=>s.repo!==`${r.owner}/${r.name}`);
          renderRepoList();
          showToast(`已移除仓库 ${r.owner}/${r.name}`);
        } catch (err) {
          showToast('操作失败：' + err.message);
        }
      }, '移除');
    });
  });
}