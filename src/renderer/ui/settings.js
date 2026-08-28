/* ================= 设置视图（迁移原型 1952-1961；导出文件名沿用产品更名后的 harness-hub） ================= */
import { $, showToast } from './common.js';

$('btn-import-data').addEventListener('click', ()=> showToast('（原型）选择导出的 JSON 备份文件后导入，导入前自动创建当前数据快照'));
$('btn-export-data').addEventListener('click', ()=> showToast('（原型）已导出全部配置到 harness-hub-backup.json'));
$('sync-method-row').querySelectorAll('.radio-pill').forEach(pill=>{
  pill.addEventListener('click', ()=>{
    $('sync-method-row').querySelectorAll('.radio-pill').forEach(p=>p.classList.remove('active'));
    pill.classList.add('active');
    pill.querySelector('input').checked = true;
  });
});