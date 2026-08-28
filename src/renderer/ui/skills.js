/* ================= Skills：子视图切换 / 备份 / 导入 / 发现 / 仓库管理（迁移原型 1512-1751） ================= */
import { AGENTS, AGENT_BY, SKILLS_INSTALLED, SKILL_BACKUPS, UNMANAGED_SKILLS, SKILLS_DISCOVERY, SKILLS_SH, SKILL_REPOS } from '../data.js';
import { icon } from '../icons.js';
import { $, showToast, askConfirm } from './common.js';
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
  });
});

/* ---- 已安装视图动作 ---- */
$('btn-skill-check-updates').addEventListener('click', ()=>{
  const n = SKILLS_INSTALLED.filter(s=>s.hasUpdate).length;
  showToast(n>0 ? `发现 ${n} 个 Skill 可更新（列表中标「可更新」）` : '所有 Skill 均为最新版本');
});
$('btn-skill-zip').addEventListener('click', ()=>{
  showToast('（原型）选择 ZIP 文件后，其中的 Skills 将安装到中央库');
});
$('btn-skill-backups').addEventListener('click', ()=>{ renderBackups(); $('modal-backups').classList.add('open'); });
$('backups-close').addEventListener('click', ()=> $('modal-backups').classList.remove('open'));

function renderBackups(){
  $('backup-list').innerHTML = SKILL_BACKUPS.length===0
    ? `<div class="empty-box" style="padding:30px;"><h4>暂无备份</h4><p>卸载 Skill 时会自动在此保留副本</p></div>`
    : SKILL_BACKUPS.map(b=>`
    <div class="backup-item">
      <div class="b-top">
        <span><span class="b-name">${b.name}</span><span class="b-dir">${b.dir}</span></span>
        <span style="font-size:11px;color:var(--text-faint);">${b.createdAt}</span>
      </div>
      <div class="b-path">${b.path}</div>
      <div class="b-actions">
        <button class="btn btn-ghost btn-sm" data-restore="${b.backupId}">恢复</button>
        <button class="btn btn-danger btn-sm" data-delbk="${b.backupId}">删除备份</button>
      </div>
    </div>`).join('');

  $('backup-list').querySelectorAll('[data-restore]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const bk = SKILL_BACKUPS.find(b=>b.backupId===btn.dataset.restore);
      SKILLS_INSTALLED.push({dir:bk.dir, name:bk.name, desc:bk.desc, repo:null, hasUpdate:false,
        apps:{dsh:0,claude:0,codex:0,gemini:0,grok:0,opencode:0,hermes:0}});
      renderCountBar('skills-countbar', SKILLS_INSTALLED, 'skill');
      renderMatrix('skill');
      renderDashboard();
      $('modal-backups').classList.remove('open');
      showToast(`已恢复 Skill「${bk.name}」，默认未部署到任何 harness`);
    });
  });
  $('backup-list').querySelectorAll('[data-delbk]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const bk = SKILL_BACKUPS.find(b=>b.backupId===btn.dataset.delbk);
      askConfirm('删除备份', `彻底删除「${bk.name}」的备份？此操作不可恢复。`, ()=>{
        SKILL_BACKUPS.splice(SKILL_BACKUPS.indexOf(bk),1);
        renderBackups();
        showToast(`已删除「${bk.name}」的备份`);
      }, '删除');
    });
  });
}

/* ---- 从 harness 导入 ---- */
$('btn-skill-import').addEventListener('click', ()=>{
  renderUnmanaged();
  $('modal-import-skills').classList.add('open');
});
$('import-skills-close').addEventListener('click', ()=> $('modal-import-skills').classList.remove('open'));

function renderUnmanaged(){
  $('unmanaged-list').innerHTML = UNMANAGED_SKILLS.map((s,i)=>`
    <div class="unmanaged-item">
      <input type="checkbox" checked data-um="${i}">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:13px;">${s.name}</div>
        <div style="font-size:11.5px;color:var(--text-dim);margin-top:2px;">${s.desc}</div>
        <div style="font-family:var(--font-mono);font-size:10.5px;color:var(--text-faint);margin-top:3px;">${s.path} · 发现于 ${s.foundIn.map(f=>AGENT_BY(f)?AGENT_BY(f).short:f).join('、')}</div>
        <div class="mini-toggles">
          ${AGENTS.map(a=>`<button class="mini-toggle ${s.foundIn.includes(a.id)?'on':''}" data-um-app="${i}" data-app="${a.id}" title="${a.name}">${icon(a.id,15,a.name)}</button>`).join('')}
        </div>
      </div>
    </div>`).join('');

  $('unmanaged-list').querySelectorAll('[data-um-app]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      btn.classList.toggle('on');
    });
  });
}
$('import-skills-confirm').addEventListener('click', ()=>{
  const selected = [...document.querySelectorAll('#unmanaged-list input[data-um]:checked')].map(c=>parseInt(c.dataset.um,10));
  if(selected.length===0){ showToast('请至少选择一个 Skill'); return; }
  selected.forEach(i=>{
    const s = UNMANAGED_SKILLS[i];
    const apps = {};
    document.querySelectorAll(`#unmanaged-list [data-um-app="${i}"]`).forEach(btn=>{
      apps[btn.dataset.app] = btn.classList.contains('on') ? 1 : 0;
    });
    SKILLS_INSTALLED.push({dir:s.dir, name:s.name, desc:s.desc, repo:null, hasUpdate:false, apps});
  });
  UNMANAGED_SKILLS.splice(0);
  renderCountBar('skills-countbar', SKILLS_INSTALLED, 'skill');
  renderMatrix('skill');
  renderDashboard();
  $('modal-import-skills').classList.remove('open');
  showToast(`已导入 ${selected.length} 个 Skill 到中央库`);
});

/* ---- 发现页 ---- */
$('btn-skill-refresh').addEventListener('click', ()=> showToast('已刷新仓库发现结果'));
document.querySelectorAll('[data-disc-source]').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    state.discSource = btn.dataset.discSource;
    document.querySelectorAll('[data-disc-source]').forEach(b=>b.classList.toggle('active', b===btn));
    renderDiscovery();
  });
});
$('disc-search-input').addEventListener('input', e=>{ state.discQuery = e.target.value.trim().toLowerCase(); renderDiscovery(); });
$('disc-repo-filter').addEventListener('change', e=>{ state.discRepo = e.target.value; renderDiscovery(); });
$('disc-status-filter').addEventListener('change', e=>{ state.discStatus = e.target.value; renderDiscovery(); });

export function renderDiscovery(){
  // 仓库下拉选项（仅仓库模式使用）
  const repoSel = $('disc-repo-filter');
  if(state.discSource==='repos'){
    const repos = ['all', ...new Set(SKILLS_DISCOVERY.map(s=>s.repo))];
    if(repoSel.options.length !== repos.length){
      repoSel.innerHTML = repos.map(r=>`<option value="${r}">${r==='all'?'全部仓库':r}</option>`).join('');
      repoSel.value = state.discRepo;
    }
    repoSel.style.display = '';
    $('disc-status-filter').style.display = '';
  } else {
    repoSel.style.display = 'none';
    $('disc-status-filter').style.display = 'none';
  }

  const isSh = state.discSource==='skillssh';
  const source = isSh ? SKILLS_SH : SKILLS_DISCOVERY;
  let list = source.filter(s=>{
    const installed = SKILLS_INSTALLED.some(i=>i.dir===s.name);
    if(isSh) return true;
    if(state.discRepo!=='all' && s.repo!==state.discRepo) return false;
    if(state.discStatus==='installed' && !installed) return false;
    if(state.discStatus==='uninstalled' && installed) return false;
    return true;
  });
  if(state.discQuery){
    list = list.filter(s=> s.name.toLowerCase().includes(state.discQuery) || (s.repo||'').toLowerCase().includes(state.discQuery));
  }

  if(list.length===0){
    $('skill-grid').innerHTML = `<div class="empty-box" style="grid-column:1/-1;"><h4>没有匹配的 Skills</h4><p>尝试更换关键词，或添加新的 Skill 仓库</p></div>`;
    return;
  }

  $('skill-grid').innerHTML = list.map(s=>{
    const installed = SKILLS_INSTALLED.some(i=>i.dir===s.name);
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
      <div class="sc-desc">${s.desc}</div>
      <div class="sc-foot">
        <button class="btn btn-ghost btn-sm" data-view-skill="${s.name}" style="flex:1;">查看文档</button>
        ${installed
          ? '<button class="btn btn-ghost btn-sm" style="flex:1;" disabled>已安装</button>'
          : `<button class="btn btn-primary btn-sm" style="flex:1;" data-install="${s.name}" data-repo="${s.repo}">安装</button>`}
      </div>
    </div>`;
  }).join('');

  $('skill-grid').querySelectorAll('[data-install]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const name = btn.dataset.install;
      SKILLS_INSTALLED.push({dir:name, name, desc:'（来自 '+btn.dataset.repo+'）', repo:btn.dataset.repo, hasUpdate:false,
        apps:{dsh:0,claude:0,codex:0,gemini:0,grok:0,opencode:0,hermes:0}});
      renderDiscovery();
      renderCountBar('skills-countbar', SKILLS_INSTALLED, 'skill');
      renderMatrix('skill');
      renderDashboard();
      showToast(`已安装 Skill「${name}」，可在「已安装」中为各 harness 开启`);
    });
  });
  $('skill-grid').querySelectorAll('[data-view-skill]').forEach(btn=>{
    btn.addEventListener('click', ()=> showToast('（原型）在浏览器中打开该 Skill 的 README'));
  });
}

/* ---- 仓库管理 ---- */
$('btn-repo-manager').addEventListener('click', ()=>{ renderRepoList(); $('modal-repo').classList.add('open'); });
$('repo-close').addEventListener('click', ()=> $('modal-repo').classList.remove('open'));
$('repo-add').addEventListener('click', ()=>{
  const url = $('repo-url').value.trim();
  const cleaned = url.replace(/^https?:\/\/github\.com\//,'').replace(/\.git$/,'');
  const parts = cleaned.split('/');
  if(parts.length!==2 || !parts[0] || !parts[1]){ showToast('仓库 URL 格式不正确'); return; }
  const branch = $('repo-branch').value.trim() || 'main';
  SKILL_REPOS.push({owner:parts[0], name:parts[1], branch});
  $('repo-url').value=''; $('repo-branch').value='';
  renderRepoList();
  showToast(`已添加仓库 ${parts[0]}/${parts[1]}，发现页已更新`);
});
function renderRepoList(){
  $('repo-list').innerHTML = SKILL_REPOS.length===0
    ? `<div class="empty-box" style="padding:26px;"><h4>暂无仓库</h4><p>添加 GitHub 仓库后即可发现其中的 Skills</p></div>`
    : SKILL_REPOS.map((r,i)=>{
      const count = SKILLS_DISCOVERY.filter(s=>s.repo===`${r.owner}/${r.name}`).length;
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
    btn.addEventListener('click', ()=> showToast('（原型）在浏览器中打开仓库页面'));
  });
  $('repo-list').querySelectorAll('[data-repo-del]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const r = SKILL_REPOS[parseInt(btn.dataset.repoDel,10)];
      askConfirm('移除仓库', `移除仓库 ${r.owner}/${r.name}？已安装的 Skills 不受影响，仅从发现页移除。`, ()=>{
        SKILL_REPOS.splice(SKILL_REPOS.indexOf(r),1);
        renderRepoList();
        showToast(`已移除仓库 ${r.owner}/${r.name}`);
      }, '移除');
    });
  });
}