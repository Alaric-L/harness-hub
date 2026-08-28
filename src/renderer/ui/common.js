/* ================= 通用工具 ================= */
import { state } from '../state.js';

export const $ = id => document.getElementById(id);

/* ================= Toast ================= */
export function showToast(msg){
  const toast = $('toast');
  $('toast-text').textContent = msg;
  toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(()=> toast.classList.remove('show'), 2800);
}

/* ================= 通用确认框 ================= */
export function askConfirm(title, msg, onConfirm, confirmText){
  $('cf-title').textContent = title;
  $('cf-msg').textContent = msg;
  $('cf-ok').textContent = confirmText || '确认';
  state.confirmCb = onConfirm;
  $('modal-confirm').classList.add('open');
}
$('cf-cancel').addEventListener('click', ()=>{ state.confirmCb = null; $('modal-confirm').classList.remove('open'); });
$('cf-ok').addEventListener('click', ()=>{
  const cb = state.confirmCb; state.confirmCb = null;
  $('modal-confirm').classList.remove('open');
  if(cb) cb();
});

/* ================= HTML 转义 ================= */
export function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }