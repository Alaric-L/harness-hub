/* ================= G4 设置页 / 导入导出 / bulkToggleSkill 冒烟驱动（在渲染进程执行，主进程 HUB_SMOKE 临时钩子加载）
 * 用法：pnpm build 后设 USERPROFILE/HOME=<fixture home> / HUB_SMOKE=scripts/smoke-g4.js /
 *       HUB_SMOKE_STAGE=1 / HUB_SMOKE_FX=<fixture home> / HUB_SMOKE_OUT=<输出>，pnpm exec electron .
 * 前置（fixture，由驱动脚本预置）：
 *   <home>/.harness-hub/{data.json, settings.json, skills/g4skill/SKILL.md}
 *   <home>/backup-good.json（合法恢复备份：空 skills + 默认 settings）
 *   <home>/backup-bad.json（非法：version 2）
 * 阶段 1：
 *   1) 设置页初始填充断言（默认 backupBeforeWrite/skillUninstallBackup true、syncMethod auto）
 *   2) 备份开关切换持久化（改后 getSettings 校验 + toast「已保存」）
 *   3) 同步方式单选（symlink）持久化
 *   4) bulkToggleSkill：Skills countbar dsh 徽章点击 -> apps.dsh=true（部署由驱动外部断言文件）
 *   5) 导出核心逻辑：exportData(显式路径) -> 返回路径（内容由驱动外部断言 version/data/settings）
 *   6) 导入核心逻辑：importData(backup-good.json) -> 'ok' -> data/settings 覆盖回读校验
 *      （快照文件由驱动外部断言 <home>/.harness-hub/backups/*.preimport.bak）
 *   7) 导入校验失败：importData(backup-bad.json) 抛错且现有数据不被破坏
 * 返回 JSON：{stage, ...} 每段自包含断言字段；关键前置失败直接 throw（钩子写 fatal 并 exit 1）。
 * dialog 部分（showSaveDialog/showOpenDialog）无法自动化，留待安装包人工验证。
 */
;(async () => {
  const STAGE = window.__HUB_SMOKE_STAGE__ || '1'
  const FX = window.__HUB_SMOKE_FX__ || ''
  const HOME = window.__HUB_SMOKE_HOME__ || ''
  const toasts = []
  let lastToast = null

  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  async function waitFor(fn, what, timeout = 25000) {
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
  const hasToast = (re) => toasts.some((t) => re.test(t)) || re.test(lastToast || '')

  const dshSkillBadge = () =>
    document.querySelector('#skills-countbar .count-badge[data-bulk="dsh"][data-kind="skill"]')

  /* ---------- 公共：等 window.hub 与页面初始化渲染 ---------- */
  await waitFor(() => window.hub && window.hub.getSettings, 'window.hub')
  await waitFor(() => document.getElementById('set-backup-before-write'), 'settings toggles render')
  await waitFor(() => document.querySelector('#skills-countbar .count-total'), 'skills countbar render')

  if (STAGE === '1') {
    /* ---------- 1. 设置页初始填充（fixture settings.json = 默认值） ---------- */
    const s0 = await window.hub.getSettings()
    const initDefaults = s0.backupBeforeWrite === true && s0.skillUninstallBackup === true &&
      s0.syncMethod === 'auto'
    const domInit = document.getElementById('set-backup-before-write').checked === true &&
      document.getElementById('set-skill-uninstall-backup').checked === true &&
      document.querySelector('#sync-method-row .radio-pill.active').dataset.sync === 'auto'

    /* ---------- 2. 备份开关切换持久化 ---------- */
    document.getElementById('set-backup-before-write').click()
    await wait(700)
    const s1 = await window.hub.getSettings()
    const backupTogglePersist = s1.backupBeforeWrite === false
    const backupToastSaved = hasToast(/已保存/)

    document.getElementById('set-skill-uninstall-backup').click()
    await wait(700)
    const s2 = await window.hub.getSettings()
    const uninstallTogglePersist = s2.skillUninstallBackup === false

    /* ---------- 3. 同步方式单选（symlink）持久化 ---------- */
    document.querySelector('#sync-method-row .radio-pill[data-sync="symlink"]').click()
    await wait(700)
    const s3 = await window.hub.getSettings()
    const syncMethodPersist = s3.syncMethod === 'symlink'
    const syncPillActive = document.querySelector('#sync-method-row .radio-pill.active').dataset.sync === 'symlink'

    /* ---------- 4. bulkToggleSkill：dsh 全部开启 ---------- */
    const skillsBefore = await window.hub.listSkills()
    const skillsBeforeCount = skillsBefore.length
    dshSkillBadge().click()
    await wait(1200)
    const skillsAfter = await window.hub.listSkills()
    const g4 = skillsAfter.find((i) => i.dir === 'g4skill')
    const bulkOn = skillsAfter.length === skillsBeforeCount && !!g4 && g4.apps['dsh'] === true
    const bulkToast = hasToast(/已在 DeepSeek Harness 中全部开启 Skills/)
    const bulkResult = await window.hub.bulkToggleSkill('dsh', true) // 幂等：再次开启不报错
    const bulkIdempotent = bulkResult.errors.length === 0 && !!bulkResult.skills.find((i) => i.dir === 'g4skill').apps['dsh']

    /* ---------- 5. 导出核心逻辑（显式路径，绕过 dialog） ---------- */
    const exportPath = `${FX}\\export-g4.json`
    const exportReturned = await window.hub.exportData(exportPath)
    const exportOk = exportReturned === exportPath

    /* ---------- 6. 导入核心逻辑（backup-good.json：空 skills + 默认 settings） ---------- */
    const importGood = await window.hub.importData(`${FX}\\backup-good.json`)
    await wait(500)
    const afterImport = await window.hub.getSettings()
    const afterImportSkills = await window.hub.listSkills()
    const importOk = importGood === 'ok' &&
      afterImport.backupBeforeWrite === true && afterImport.skillUninstallBackup === true &&
      afterImport.syncMethod === 'auto' && afterImportSkills.length === 0

    /* ---------- 7. 导入校验失败：不破坏现有数据 ---------- */
    let badRejected = false
    let badMessage = ''
    try {
      await window.hub.importData(`${FX}\\backup-bad.json`)
    } catch (err) {
      badRejected = true
      badMessage = String(err.message)
    }
    await wait(300)
    const afterBad = await window.hub.getSettings()
    const dataIntact = afterBad.backupBeforeWrite === true && afterBad.syncMethod === 'auto'

    /* ---------- 8. 导入不存在的文件 -> 拒绝 ---------- */
    let missingRejected = false
    try {
      await window.hub.importData(`${FX}\\no-such-backup.json`)
    } catch (err) {
      missingRejected = true
    }

    return {
      stage: STAGE,
      fx: FX,
      home: HOME,
      s0,
      initDefaults,
      domInit,
      backupTogglePersist,
      backupToastSaved,
      uninstallTogglePersist,
      syncMethodPersist,
      syncPillActive,
      skillsBeforeCount,
      bulkOn,
      bulkToast,
      bulkIdempotent,
      exportPath,
      exportOk,
      importOk,
      badRejected,
      badMessage,
      dataIntact,
      missingRejected,
      toasts
    }
  }

  throw new Error('unknown HUB_SMOKE_STAGE: ' + STAGE)
})()
