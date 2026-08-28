/* ================= G2 Skills 页接线冒烟驱动（在渲染进程执行，主进程 HUB_SMOKE 临时钩子加载） =================
 * 用法：pnpm build 后设 HUB_SMOKE=1 / HUB_SMOKE_STAGE=1|2|3，驱动脚本并在结束后将 JSON 写入 HUB_SMOKE_OUT。
 * stage1：空态 -> 从 harness 导入 2 个 skill（勾选 dsh+claude 部署）-> 列表出现 -> 开关 dsh 部署。
 *        结束态：dsh 已部署 alpha（供 fixture 断言 <fx>/.dsh/skills/alpha/SKILL.md 存在）。
 * stage2：卸载 alpha（确认弹窗）-> 备份列表出现 -> 恢复（不部署）-> 列表复原且 apps 为空。
 *        结束态：SSOT 已恢复 alpha（供 fixture 断言），备份目录含 skill/ + meta.json。
 * stage3：发现页仓库模式（addRepo obra/superpowers 后真实列出，网络失败则记录）-> 移除仓库 ->
 *        检查更新（无 repo 安装 → 均为最新）。
 * 返回 JSON：{stage, toasts, ...} 每阶段自包含断言字段。
 */
;(async () => {
  const STAGE = window.__HUB_SMOKE_STAGE__ || '1'
  const toasts = []
  let lastToast = null

  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  async function waitFor(fn, what, timeout = 20000) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      try { const v = fn(); if (v) return v } catch (e) { /* retry */ }
      await wait(120)
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

  const skillRow = (dir) => [...document.querySelectorAll('#skills-table tbody tr')]
    .find((r) => r.querySelector(`input[data-toggle="${dir}"]`))
  const skillCb = (dir, agent) => skillRow(dir) &&
    skillRow(dir).querySelector(`input[data-toggle="${dir}"][data-agent="${agent}"]`)

  /* ---------- 公共：等 window.hub 与页面初始化渲染 ---------- */
  await waitFor(() => window.hub && window.hub.listSkills, 'window.hub')
  await waitFor(() => document.querySelector('#skills-countbar .count-total'), 'skills countbar render')

  if (STAGE === '1') {
    /* ---------- 1. 空态断言 ---------- */
    const list0 = await window.hub.listSkills()
    const list0Count = list0.length
    const emptyTable = document.querySelectorAll('#skills-table tbody tr').length

    /* ---------- 2. 打开导入弹窗（扫描 fixture harness skills 目录） ---------- */
    document.getElementById('btn-skill-import').click()
    await waitFor(() => document.getElementById('modal-import-skills').classList.contains('open'), 'import modal open')
    await waitFor(() => document.querySelectorAll('#unmanaged-list .unmanaged-item').length >= 2, 'unmanaged list render')
    const unmanagedNames = [...document.querySelectorAll('#unmanaged-list .unmanaged-item [style*="font-weight:600"]')]
      .map((e) => e.textContent)
    const unmanagedCount = document.querySelectorAll('#unmanaged-list .unmanaged-item').length

    /* ---------- 3. mini-toggles：勾选 dsh + claude（两个条目） ---------- */
    document.querySelectorAll('#unmanaged-list [data-um-app][data-app="dsh"]').forEach((b) => {
      if (!b.classList.contains('on')) b.click()
    })
    document.querySelectorAll('#unmanaged-list [data-um-app][data-app="claude"]').forEach((b) => {
      if (!b.classList.contains('on')) b.click()
    })
    const dshTogglesOn = document.querySelectorAll('#unmanaged-list [data-um-app][data-app="dsh"].on').length
    const claudeTogglesOn = document.querySelectorAll('#unmanaged-list [data-um-app][data-app="claude"].on').length

    /* ---------- 4. 确认导入 -> 列表出现 ---------- */
    document.getElementById('import-skills-confirm').click()
    await wait(900)
    const listAfterImport = await window.hub.listSkills()
    const domRowsAfterImport = document.querySelectorAll('#skills-table tbody tr').length
    const countbarAfterImport = document.getElementById('skills-countbar').textContent

    /* ---------- 5. 开关 dsh 部署往返（导入时已开 dsh+claude -> 关 -> 开，最终保持部署） ---------- */
    const target = listAfterImport[0].dir
    const dshCheckedBefore = skillCb(target, 'dsh').checked
    skillCb(target, 'dsh').click()   // true -> false：移除部署
    await wait(700)
    const dshAfterOff = !!(await window.hub.listSkills()).find((i) => i.dir === target).apps['dsh']
    skillCb(target, 'dsh').click()   // false -> true：重新部署
    await wait(900)
    const listAfterToggle = await window.hub.listSkills()
    const dshOn = !!listAfterToggle.find((i) => i.dir === target).apps['dsh']

    return {
      stage: STAGE,
      list0Count,
      emptyTable,
      unmanagedCount,
      unmanagedNames,
      dshTogglesOn,
      claudeTogglesOn,
      listAfterImport: listAfterImport.map((i) => i.dir),
      domRowsAfterImport,
      countbarAfterImport,
      target,
      dshCheckedBefore,
      dshAfterOff,
      dshOn,
      toasts
    }
  }

  if (STAGE === '2') {
    /* ---------- 前置：列表非空且取首个（alpha，dsh 已部署） ---------- */
    const before = await window.hub.listSkills()
    if (before.length === 0) throw new Error('stage2 precondition: skills list empty')
    const target = before[0].dir

    /* ---------- 1. 卸载（确认弹窗） ---------- */
    skillRow(target).querySelector(`[data-uninst="${target}"]`).click()
    await waitFor(() => document.getElementById('modal-confirm').classList.contains('open'), 'confirm modal open')
    document.getElementById('cf-ok').click()
    await wait(1000)
    const listAfterUninstall = await window.hub.listSkills()
    const rowGone = !skillRow(target)
    const countbarAfterUninstall = document.getElementById('skills-countbar').textContent

    /* ---------- 2. 备份列表出现 ---------- */
    document.getElementById('btn-skill-backups').click()
    await waitFor(() => document.querySelectorAll('#backup-list .backup-item').length >= 1, 'backups render')
    const backupNames = [...document.querySelectorAll('#backup-list .backup-item .b-name')].map((e) => e.textContent)
    const backupDirs = [...document.querySelectorAll('#backup-list .backup-item .b-dir')].map((e) => e.textContent)
    const backupCount = document.querySelectorAll('#backup-list .backup-item').length

    /* ---------- 3. 恢复（不部署） ---------- */
    document.querySelector('#backup-list [data-restore]').click()
    await wait(1000)
    const listAfterRestore = await window.hub.listSkills()
    const restored = listAfterRestore.some((i) => i.dir === target)
    const restoredApps = listAfterRestore.find((i) => i.dir === target)
      ? Object.keys(listAfterRestore.find((i) => i.dir === target).apps || {}).length
      : -1

    return {
      stage: STAGE,
      before: before.map((i) => i.dir),
      target,
      listAfterUninstall: listAfterUninstall.map((i) => i.dir),
      rowGone,
      countbarAfterUninstall,
      backupCount,
      backupNames,
      backupDirs,
      restored,
      restoredApps,   // 恢复默认不部署 -> 0
      toasts
    }
  }

  /* ---------- STAGE 3：发现页 / 仓库管理 / 更新 ---------- */
  const initialRepos = await window.hub.listRepos()

  /* ---------- 1. 仓库管理：添加 obra/superpowers（本地流程，纯 store 写入） ---------- */
  document.getElementById('btn-repo-manager').click()
  await waitFor(() => document.getElementById('modal-repo').classList.contains('open'), 'repo modal open')
  await waitFor(() => document.querySelectorAll('#repo-list .repo-item').length >= 0, 'repo list render')
  document.getElementById('repo-url').value = 'https://github.com/obra/superpowers'
  document.getElementById('repo-branch').value = 'main'
  document.getElementById('repo-add').click()
  await wait(700)
  const reposAfterAdd = await window.hub.listRepos()
  const addedRepo = reposAfterAdd.some((r) => r.owner === 'obra' && r.name === 'superpowers')
  const repoListTextAfterAdd = document.getElementById('repo-list').textContent

  /* ---------- 2. 发现页仓库模式：真实列出（网络不可用则记录错误，可接受） ---------- */
  document.getElementById('repo-close').click()
  document.querySelector('[data-skills-tab="discovery"]').click()
  await wait(300)
  document.getElementById('btn-skill-refresh').click()
  await waitFor(
    () => document.getElementById('skill-grid').querySelector('.skill-card')
      || document.getElementById('skill-grid').textContent.includes('没有匹配')
      || document.getElementById('skill-grid').textContent.includes('加载失败'),
    'discovery grid settle',
    70000
  )
  const gridText = document.getElementById('skill-grid').textContent
  const cards = document.querySelectorAll('#skill-grid .skill-card').length
  const discoveryRepoFilter = document.getElementById('disc-repo-filter').value

  /* ---------- 3. 仓库管理：移除 obra（确认弹窗） -> 列表复原 ---------- */
  document.getElementById('btn-repo-manager').click()
  await waitFor(() => document.getElementById('modal-repo').classList.contains('open'), 'repo modal open')
  const delBtn = [...document.querySelectorAll('#repo-list [data-repo-del]')].find((b) =>
    b.closest('.repo-item').textContent.includes('obra/superpowers'))
  if (delBtn) {
    delBtn.click()
    await waitFor(() => document.getElementById('modal-confirm').classList.contains('open'), 'confirm modal open')
    document.getElementById('cf-ok').click()
    await wait(700)
  }
  const reposAfterRemove = await window.hub.listRepos()
  document.getElementById('repo-close').click()

  /* ---------- 4. 检查更新（无 repo 安装 -> 立即返回「均为最新」，不依赖网络） ---------- */
  document.querySelector('[data-skills-tab="installed"]').click()
  await wait(200)
  document.getElementById('btn-skill-check-updates').click()
  await waitFor(() => /可更新|最新版本/.test(document.getElementById('toast-text').textContent || '') || toasts.some((t) => /可更新|最新版本/.test(t)), 'check updates toast', 8000)
  await wait(300)
  const checkToast = lastToast || toasts[toasts.length - 1] || ''
  const updatesResult = await window.hub.listSkills()

  return {
    stage: STAGE,
    initialRepos,
    reposAfterAdd,
    addedRepo,
    repoListTextAfterAdd,
    discoveryCards: cards,
    discoveryGridText: gridText.slice(0, 200),
    discoveryRepoFilter,
    reposAfterRemove,
    removedRepo: !reposAfterRemove.some((r) => r.owner === 'obra'),
    checkToast,
    updatesResult: updatesResult.map((i) => i.dir),
    toasts
  }
})()