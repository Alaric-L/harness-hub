/* ================= MCP 表单（迁移原型 1315-1449；mcpEditingId 经 state） ================= */
import { AGENTS, MCP_ITEMS, MCP_PRESETS } from '../data.js';
import { icon } from '../icons.js';
import { $, showToast } from './common.js';
import { state } from '../state.js';
import { renderCountBar, renderMatrix } from './matrix.js';
import { renderDashboard } from './dashboard.js';

export function openMcpForm(editingId){
  state.mcpEditingId = editingId || null;
  const editing = editingId ? MCP_ITEMS.find(i=>i.id===editingId) : null;

  $('mf-title').textContent = editing ? '编辑 MCP' : '新增 MCP';
  $('mf-presets-block').style.display = editing ? 'none' : 'block';
  $('mf-id').value = editing ? editing.id : '';
  $('mf-id').disabled = !!editing;
  $('mf-id-err').textContent = '';
  $('mf-name').value = editing ? (editing.name||'') : '';
  $('mf-desc').value = editing ? (editing.desc||'') : '';
  $('mf-tags').value = editing ? (editing.tag||'') : '';
  $('mf-homepage').value = editing ? (editing.homepage||'') : '';
  $('mf-docs').value = editing ? (editing.docs||'') : '';
  $('mf-json').value = editing ? JSON.stringify(editing.spec, null, 2) : '';
  updateJsonStatus();

  $('mf-meta').style.display = editing ? 'block' : 'none';
  $('mf-meta-toggle').textContent = (editing ? '▾' : '▸') + ' 附加信息（描述 / 标签 / 链接）';

  // 预设 chips
  const chips = ['<button class="chip active" data-preset="-1">自定义</button>']
    .concat(MCP_PRESETS.map((p,i)=>`<button class="chip" data-preset="${i}">${p.id}</button>`));
  $('mf-preset-chips').innerHTML = chips.join('');
  $('mf-preset-chips').querySelectorAll('.chip').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      $('mf-preset-chips').querySelectorAll('.chip').forEach(c=>c.classList.remove('active'));
      chip.classList.add('active');
      const idx = parseInt(chip.dataset.preset, 10);
      if(idx < 0){
        $('mf-id').value=''; $('mf-name').value=''; $('mf-desc').value=''; $('mf-tags').value='';
        $('mf-homepage').value=''; $('mf-docs').value=''; $('mf-json').value='';
        updateJsonStatus();
        return;
      }
      const p = MCP_PRESETS[idx];
      let id = p.id, n = 1;
      while(MCP_ITEMS.some(i=>i.id===id)) id = `${p.id}-${++n}`;
      $('mf-id').value = id;
      $('mf-name').value = p.id;
      $('mf-desc').value = p.desc;
      $('mf-tags').value = p.tag;
      $('mf-homepage').value = p.homepage || '';
      $('mf-docs').value = p.docs || '';
      $('mf-json').value = JSON.stringify(p.spec, null, 2);
      $('mf-id-err').textContent = '';
      updateJsonStatus();
    });
  });

  // 启用 harness 勾选
  $('mf-apps').innerHTML = AGENTS.map(a=>{
    const checked = editing ? !!editing.apps[a.id] : (a.id==='dsh');
    return `<label class="app-check">${icon(a.id,15,a.name)}<input type="checkbox" data-app="${a.id}" ${checked?'checked':''}>${a.short}</label>`;
  }).join('');

  $('modal-mcp-form').classList.add('open');
}

export function validateMcpJson(){
  const text = $('mf-json').value.trim();
  const st = $('mf-json-status');
  if(!text){ st.textContent = '必填：填写配置 JSON，或点击「使用向导生成」'; st.className='json-status err'; return {ok:false, spec:null}; }
  try{
    const v = JSON.parse(text);
    if(!v || typeof v!=='object' || Array.isArray(v)){ st.textContent='✗ 配置必须是 JSON 对象'; st.className='json-status err'; return {ok:false, spec:null}; }
    if(v.type==='stdio' && !(v.command||'').trim()){ st.textContent='✗ stdio 类型必须提供 command'; st.className='json-status err'; return {ok:false, spec:v}; }
    if((v.type==='http'||v.type==='sse') && !(v.url||'').trim()){ st.textContent=`✗ ${v.type} 类型必须提供 url`; st.className='json-status err'; return {ok:false, spec:v}; }
    st.textContent='✓ JSON 有效'; st.className='json-status ok'; return {ok:true, spec:v};
  }catch(e){
    st.textContent = '✗ JSON 语法错误：' + e.message; st.className='json-status err';
    return {ok:false, spec:null};
  }
}
export function updateJsonStatus(){ validateMcpJson(); }
$('mf-json').addEventListener('input', updateJsonStatus);

$('mf-id').addEventListener('input', ()=>{
  const v = $('mf-id').value.trim();
  $('mf-id-err').textContent = (!state.mcpEditingId && v && MCP_ITEMS.some(i=>i.id===v)) ? 'ID 已存在' : '';
});

$('mf-meta-toggle').addEventListener('click', ()=>{
  const el = $('mf-meta');
  const open = el.style.display!=='none';
  el.style.display = open ? 'none' : 'block';
  $('mf-meta-toggle').textContent = (open ? '▸' : '▾') + ' 附加信息（描述 / 标签 / 链接）';
});

$('btn-add-mcp').addEventListener('click', ()=> openMcpForm(null));
$('mf-cancel').addEventListener('click', ()=> $('modal-mcp-form').classList.remove('open'));

$('mf-save').addEventListener('click', ()=>{
  const id = $('mf-id').value.trim();
  if(!id){ $('mf-id-err').textContent='请填写 ID'; return; }
  if(!state.mcpEditingId && MCP_ITEMS.some(i=>i.id===id)){ $('mf-id-err').textContent='ID 已存在'; return; }
  const {ok, spec} = validateMcpJson();
  if(!ok || !spec){ showToast('请修正配置 JSON 后再保存'); return; }

  const apps = {};
  document.querySelectorAll('#mf-apps input[data-app]').forEach(cb=> apps[cb.dataset.app] = cb.checked ? 1 : 0);
  const homepage = $('mf-homepage').value.trim();
  const docs = $('mf-docs').value.trim();

  if(state.mcpEditingId){
    const item = MCP_ITEMS.find(i=>i.id===state.mcpEditingId);
    item.name = $('mf-name').value.trim() || id;
    item.desc = $('mf-desc').value.trim() || item.desc;
    item.tag = $('mf-tags').value.trim() || item.tag;
    item.homepage = homepage || undefined;
    item.docs = docs || undefined;
    item.spec = spec;
    item.apps = apps;
    showToast(`已保存 MCP「${id}」，变更已写入启用的 harness 配置`);
  } else {
    MCP_ITEMS.push({
      id, name: $('mf-name').value.trim() || id,
      desc: $('mf-desc').value.trim() || '（无描述）',
      tag: $('mf-tags').value.trim() || '自定义',
      homepage: homepage || undefined,
      docs: docs || undefined,
      spec, apps,
    });
    showToast(`已创建 MCP「${id}」并写入启用的 harness 配置`);
  }
  $('modal-mcp-form').classList.remove('open');
  renderCountBar('mcp-countbar', MCP_ITEMS, 'mcp');
  renderMatrix('mcp');
  renderDashboard();
});

$('btn-import-mcp').addEventListener('click', ()=>{
  showToast('已从各 harness 导入 2 个新 MCP（tavily 已存在，仅标记 DSH 启用）');
});