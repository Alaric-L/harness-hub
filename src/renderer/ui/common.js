/* ================= 通用工具 ================= */
import { state } from '../state.js';

export const $ = id => document.getElementById(id);

/* ================= Toast ================= */
/* Electron 的 ipcMain.handle 抛错时，ipcRenderer.invoke 拒绝值会被包一层
 * 「Error invoking remote method 'hub:xxx': Error: <原文>」前缀，这里统一剥掉再展示 */
const IPC_ERR_WRAP = /Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/g;

/** 剥离 Electron IPC 错误包装前缀，返回可读错误文本（非 toast 场景也用它） */
export function errMsg(err){
  const m = (err && err.message) ? err.message : String(err || '未知错误');
  return m.replace(IPC_ERR_WRAP, '');
}

export function showToast(msg){
  const toast = $('toast');
  $('toast-text').textContent = String(msg).replace(IPC_ERR_WRAP, '');
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