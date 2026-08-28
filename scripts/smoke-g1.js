/* ================= G1 MCP 页接线冒烟驱动（在渲染进程执行，主进程 HUB_SMOKE 钩子加载） =================
 * 用法：pnpm dev 前设 HUB_SMOKE=1；HUB_SMOKE_STAGE=1|2 选择阶段。
 * stage1：新增 smoke-test（dsh+claude+codex）-> 开关 dsh/claude 往返 -> 详情预览（dsH tab）。
 *        结束态：三个 harness 均启用（供 fixture 断言文件内容）。
 * stage2：删除 smoke-test（确认弹窗）-> 断言列表消失 -> 从各 harness 导入 -> 解析结果。
 * 返回 JSON：{stage, toasts, listAfterAdd, listAfterDelete, importResult, previewSnippet}。
 */
;(async () => {
  const STAGE = window.__HUB_SMOKE_STAGE__ || '1'
  const MCP_ID = 'smoke-test'
  const toasts = []
  let lastToast = null

  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  async function waitFor(fn, what, timeout = 15000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      try { const v = fn(); if (v) return v } catch (e) { /* retry */ }
      await wait(100)
    }
    throw new Error('timeout waiting for ' + what)
  }
  // 轮询捕获 toast 文案变化（showToast 覆盖式更新 #toast-text）
  setInterval(() => {
    const el = document.getElementById('toast-text')
    if (!el) return
    const t = el.textContent
    if (lastToast === null) { lastToast = t; return }
    if (t !== lastToast) { lastToast = t; toasts.push(t) }
  }, 100)

  const rowOf = (id) => [...document.querySelectorAll('#mcp-table tbody tr')]
    .find((r) => r.querySelector(`input[data-toggle="${id}"]`))
  const agentCb = (id, agent) => rowOf(id) &&
    rowOf(id).querySelector(`input[data-toggle="${id}"][data-agent="${agent}"]`)
  const listIds = async () => (await window.hub.listMcp()).map((i) => i.id)

  /* ---------- 公共：等 window.hub 与页面初始化渲染 ---------- */
  await waitFor(() => window.hub && window.hub.listMcp, 'window.hub')
  await waitFor(() => document.querySelector('#mcp-countbar .count-total'), 'mcp countbar render')

  if (STAGE === '1') {
    /* ---------- 1. 打开表单并填写 ---------- */
    document.getElementById('btn-add-mcp').click()
    await waitFor(() => document.getElementById('modal-mcp-form').classList.contains('open'), 'mcp form open')
    document.getElementById('mf-id').value = MCP_ID
    document.getElementById('mf-name').value = 'Smoke Test MCP'
    document.getElementById('mf-json').value = JSON.stringify({
      type: 'stdio', command: 'npx', args: ['-y', '@smoke/test-mcp@latest']
    }, null, 2)
    // 勾选 dsh + claude + codex（dsh 默认已勾选）
    const wantApps = ['dsh', 'claude', 'codex']
    document.querySelectorAll('#mf-apps input[data-app]').forEach((cb) => {
      cb.checked = wantApps.includes(cb.dataset.app)
    })
    /* ---------- 2. 保存 -> 断言列表出现 ---------- */
    document.getElementById('mf-save').click()
    await wait(700)
    const listAfterAdd = await listIds()
    const domRowAfterAdd = !!rowOf(MCP_ID)

    /* ---------- 3. dsh 开关往返（关 -> 开），失败回滚场景不在此触发 ---------- */
    const dshBefore = agentCb(MCP_ID, 'dsh').checked
    agentCb(MCP_ID, 'dsh').click()
    await wait(500)
    const dshAfterOff = agentCb(MCP_ID, 'dsh').checked
    agentCb(MCP_ID, 'dsh').click()
    await wait(500)
    const dshAfterOn = agentCb(MCP_ID, 'dsh').checked

    /* ---------- 4. claude 开关往返 ---------- */
    const claudeBefore = agentCb(MCP_ID, 'claude').checked
    agentCb(MCP_ID, 'claude').click()
    await wait(500)
    const claudeAfterOff = agentCb(MCP_ID, 'claude').checked
    agentCb(MCP_ID, 'claude').click()
    await wait(500)
    const claudeAfterOn = agentCb(MCP_ID, 'claude').checked

    /* ---------- 5. 详情 -> dsh tab 读真实预览文本 ---------- */
    rowOf(MCP_ID).querySelector('[data-detail]').click()
    await waitFor(() => {
      const el = document.getElementById('detail-preview')
      return el && el.textContent && el.textContent !== '加载中…'
    }, 'detail preview loaded')
    const previewSnippet = document.getElementById('detail-preview').textContent
    document.getElementById('detail-close').click()

    return {
      stage: STAGE,
      toasts,
      listAfterAdd,
      domRowAfterAdd,
      previewSnippet,
      toggleChecks: { dshBefore, dshAfterOff, dshAfterOn, claudeBefore, claudeAfterOff, claudeAfterOn }
    }
  }

  /* ---------- STAGE 2 ---------- */
  const listBeforeDelete = await listIds()
  if (!listBeforeDelete.includes(MCP_ID)) throw new Error('stage2 precondition: smoke-test must exist in store')

  /* ---------- 1. 删除 + 确认 ---------- */
  rowOf(MCP_ID).querySelector('[data-del]').click()
  await waitFor(() => document.getElementById('modal-confirm').classList.contains('open'), 'confirm modal open')
  document.getElementById('cf-ok').click()
  await wait(700)
  const listAfterDelete = await listIds()
  const domRowAfterDelete = !!rowOf(MCP_ID)

  /* ---------- 2. 从各 harness 导入 ---------- */
  document.getElementById('btn-import-mcp').click()
  await wait(1200)
  const importToast = lastToast || toasts[toasts.length - 1] || ''
  const m = /导入\s*(\d+)\s*个新 MCP/.exec(importToast)
  const marked = /（(\d+)\s*个已存在/.exec(importToast)
  const importResult = {
    toast: importToast,
    added: m ? parseInt(m[1], 10) : -1,
    marked: marked ? parseInt(marked[1], 10) : 0
  }
  const listAfterImport = await listIds()

  return {
    stage: STAGE,
    toasts,
    listBeforeDelete,
    listAfterDelete,
    listAfterImport,
    domRowAfterDelete,
    importResult
  }
})()