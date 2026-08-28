/* ================= MCP 配置向导（迁移原型 1450-1510；wizType 经 state） ================= */
import { $, showToast } from './common.js';
import { state } from '../state.js';
import { updateJsonStatus } from './mcp-form.js';

$('mf-wizard-btn').addEventListener('click', ()=>{
  state.wizType = 'stdio';
  $('wz-types').querySelectorAll('.type-card').forEach(c=>c.classList.toggle('active', c.dataset.type==='stdio'));
  $('wz-stdio-fields').style.display='block';
  $('wz-remote-fields').style.display='none';
  updateWizPreview();
  $('modal-mcp-wizard').classList.add('open');
});
$('wz-cancel').addEventListener('click', ()=> $('modal-mcp-wizard').classList.remove('open'));

$('wz-types').querySelectorAll('.type-card').forEach(card=>{
  card.addEventListener('click', ()=>{
    $('wz-types').querySelectorAll('.type-card').forEach(c=>c.classList.remove('active'));
    card.classList.add('active');
    state.wizType = card.dataset.type;
    $('wz-stdio-fields').style.display = state.wizType==='stdio' ? 'block' : 'none';
    $('wz-remote-fields').style.display = state.wizType==='stdio' ? 'none' : 'block';
    updateWizPreview();
  });
});
['wz-command','wz-args','wz-env','wz-url','wz-headers'].forEach(id=>{
  $(id).addEventListener('input', updateWizPreview);
});

function parseKv(text, sep){
  const out = {};
  text.split('\n').map(l=>l.trim()).filter(Boolean).forEach(l=>{
    const i = l.indexOf(sep);
    if(i>0) out[l.slice(0,i).trim()] = l.slice(i+1).trim();
  });
  return out;
}
function updateWizPreview(){
  const spec = {type: state.wizType};
  if(state.wizType==='stdio'){
    spec.command = $('wz-command').value.trim();
    const args = $('wz-args').value.split('\n').map(s=>s.trim()).filter(Boolean);
    if(args.length) spec.args = args;
    const env = parseKv($('wz-env').value, '=');
    if(Object.keys(env).length) spec.env = env;
  } else {
    spec.url = $('wz-url').value.trim();
    const headers = parseKv($('wz-headers').value, ':');
    if(Object.keys(headers).length) spec.headers = headers;
  }
  $('wz-preview').textContent = JSON.stringify(spec, null, 2);
}
$('wz-apply').addEventListener('click', ()=>{
  if(state.wizType==='stdio' && !$('wz-command').value.trim()){ showToast('请填写命令'); return; }
  if(state.wizType!=='stdio' && !$('wz-url').value.trim()){ showToast('请填写服务地址'); return; }
  if(!$('mf-id').value.trim()){
    const cmd = $('wz-command').value.trim();
    $('mf-id').value = cmd ? cmd.split(/[\\/]/).pop().replace(/\.(exe|cmd|bat)$/i,'') : '';
  }
  if(!$('mf-name').value.trim()) $('mf-name').value = $('mf-id').value;
  $('mf-json').value = $('wz-preview').textContent;
  updateJsonStatus();
  $('modal-mcp-wizard').classList.remove('open');
  showToast('已生成配置并回填到表单');
});