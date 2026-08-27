/* ================= 视图切换 ================= */
const $ = id => document.getElementById(id);

const viewMeta = {
  dashboard:{title:'Dashboard', sub:'7 个 harness 的配置总览', search:false},
  mcp:{title:'MCP 服务', sub:'统一管理 MCP 配置，按 harness 一键开关并写入各自配置文件', search:false},
  skills:{title:'Skills', sub:'中央库安装与分发，支持仓库发现、更新与备份', search:true},
  prompts:{title:'提示词', sub:'每个 harness 一套提示词库，单条激活写入指令文件', search:false},
  agents:{title:'Harness 管理', sub:'各 harness 的配置落点与目录覆盖', search:false},
  settings:{title:'设置', sub:'数据备份、导入导出与全局选项', search:false},
};

let currentView = 'dashboard';

document.querySelectorAll('.nav-item[data-view]').forEach(btn=>{
  btn.addEventListener('click', ()=> switchView(btn.dataset.view));
});
function switchView(v){
  currentView = v;
  document.querySelectorAll('.nav-item[data-view]').forEach(b=>b.classList.toggle('active', b.dataset.view===v));
  document.querySelectorAll('.view').forEach(el=>el.classList.remove('active'));
  $('view-'+v).classList.add('active');
  $('view-title').textContent = viewMeta[v].title;
  $('view-sub').textContent = viewMeta[v].sub;
  $('search-box').style.display = viewMeta[v].search ? 'flex' : 'none';
}
