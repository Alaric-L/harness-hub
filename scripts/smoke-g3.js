/* ================= G3 提示词 / Dashboard / Harness 管理接线冒烟驱动（在渲染进程执行，主进程 HUB_SMOKE 临时钩子加载）
 * 用法：pnpm build 后设 HUB_SMOKE=scripts/smoke-g3.js / HUB_SMOKE_STAGE=1|2|3 / HUB_SMOKE_FX=<fixture 根> / HUB_SMOKE_OUT=<输出>。
 * 前置（fixture）：7 个假 harness 目录 + ~/.harness-hub/settings.json（dirOverrides 指向 fixture）+ data.json 已删除。
 * stage1：提示词全流程（新增->激活->停用->再激活->第二条->复制 claude+codex->目标库断言->禁用删除->停用后删除）。
 *        结束态：dsh 库=[第二条(未激活)]；dsh AGENTS.md 已被清空（供 fixture 断言）。
 * stage2（fixture 先写入外部内容到 dsh AGENTS.md）：激活第二条 -> 「原始提示词」备份条目=外部内容 -> Dashboard 统计断言。
 *        结束态：dsh AGENTS.md = 第二条内容（供 fixture 断言）。
 * stage3：Harness 管理 7 卡真实路径 -> claude 覆盖到 fixture 子目录 -> resolved 断言 + 文件写入走新路径 ->
 *        claude 重置恢复默认。
 * 返回 JSON：{stage, ...} 每阶段自包含断言字段；关键前置失败直接 throw（钩子写 fatal 并 exit 1）。
 */
;(async () => {
  const STAGE = window.__HUB_SMOKE_STAGE__ || '1'
  const FX = window.__HUB_SMOKE_FX__ || ''
  const HOME = window.__HUB_SMOKE_HOME__ || ''
  const PT_DSH = `${FX}\\dsh\\AGENTS.md`
  const PT_CLAUDE = `${FX}\\claude\\CLAUDE.md`
  const P1_CONTENT = 'Smoke G3 prompt one content.'
  const P2_CONTENT = 'Smoke G3 prompt two content.'
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

  const toastText = () => lastToast || toasts[toasts.length - 1] || ''
  const hasToast = (re) => toasts.some((t) => re.test(t)) || re.test(toastText())
  const promptToggle = (id) => document.querySelector(`#prompt-list input[data-pt-toggle="${id}"]`)
  const promptDelBtn = (id) => document.querySelector(`#prompt-list button[data-pt-del="${id}"]`)
  const promptCopyBtn = (id) => document.querySelector(`#prompt-list button[data-pt-copy="${id}"]`)
  const cardText = (agentId) =>
    [...document.querySelectorAll('.agent-card')].find((c) => c.querySelector(`[data-dir-input="${agentId}"]`))

  /* ---------- 公共：等 window.hub 与页面初始化渲染 ---------- */
  await waitFor(() => window.hub && window.hub.getAgentsDetailed, 'window.hub')
  await waitFor(() => document.querySelectorAll('#prompt-tabs .prompt-tab').length === 7, 'prompt tabs render')
  await waitFor(() => document.getElementById('stat-agents').textContent === '7', 'dashboard stat render')

  if (STAGE === '1') {
    /* ---------- 1. 初始空库 ---------- */
    const lib0 = await window.hub.listPrompts('dsh')
    const lib0Count = lib0.length

    /* ---------- 2. 新增「测试提示词」 ---------- */
    document.getElementById('btn-add-prompt').click()
    await waitFor(() => document.getElementById('modal-prompt-form').classList.contains('open'), 'prompt form open')
    document.getElementById('pf-name').value = '测试提示词'
    document.getElementById('pf-content').value = P1_CONTENT
    document.getElementById('pf-save').click()
    await wait(700)
    const afterAdd = await window.hub.listPrompts('dsh')
    const id1 = afterAdd[0].id
    const addedNotEnabled = afterAdd.length === 1 && afterAdd[0].enabled === false && afterAdd[0].name === '测试提示词'

    /* ---------- 3. 激活 -> toast 含真实指令文件路径 ---------- */
    promptToggle(id1).click()
    await wait(900)
    const afterEnable = await window.hub.listPrompts('dsh')
    const enabled = afterEnable.find((p) => p.id === id1).enabled === true
    const enableToastHasRealPath = hasToast(new RegExp(`写入 ${PT_DSH.replace(/\\/g, '\\\\')}`))

    /* ---------- 4. 停用 -> 文件清空 toast ---------- */
    promptToggle(id1).click()
    await wait(900)
    const afterDisable = await window.hub.listPrompts('dsh')
    const disabled = afterDisable.find((p) => p.id === id1).enabled === false
    const disableToastCleared = hasToast(/已清空/)

    /* ---------- 5. 再激活 ---------- */
    promptToggle(id1).click()
    await wait(900)

    /* ---------- 6. 新建第二条 ---------- */
    document.getElementById('btn-add-prompt').click()
    await waitFor(() => document.getElementById('modal-prompt-form').classList.contains('open'), 'prompt form open 2')
    document.getElementById('pf-name').value = '第二条提示词'
    document.getElementById('pf-content').value = P2_CONTENT
    document.getElementById('pf-save').click()
    await wait(700)
    const afterAdd2 = await window.hub.listPrompts('dsh')
    const id2 = afterAdd2.find((p) => p.name === '第二条提示词').id
    const secondInactive = afterAdd2.find((p) => p.id === id2).enabled === false

    /* ---------- 7. 复制到 claude + codex ---------- */
    promptCopyBtn(id2).click()
    await waitFor(() => document.getElementById('modal-copy').classList.contains('open'), 'copy modal open')
    document.querySelector('#cp-targets input[value="claude"]').checked = true
    document.querySelector('#cp-targets input[value="codex"]').checked = true
    document.getElementById('cp-confirm').click()
    await wait(900)
    const copyToastOk = hasToast(/Claude/) && hasToast(/Codex/) && hasToast(/未激活/)

    /* ---------- 8. 切 claude tab：新增条目存在且未激活 ---------- */
    document.querySelector('.prompt-tab[data-agent="claude"]').click()
    await wait(800)
    const claudeLib = await window.hub.listPrompts('claude')
    const claudeCopy = claudeLib.find((p) => p.name === '第二条提示词')
    const claudeCopyInactive = !!claudeCopy && claudeCopy.enabled === false
    const claudeDomHas = !!promptToggle(claudeCopy.id)

    /* ---------- 9. 回 dsh：已激活条目删除按钮禁用 ---------- */
    document.querySelector('.prompt-tab[data-agent="dsh"]').click()
    await wait(800)
    const delDisabled = document.querySelector(`#prompt-list button[data-pt-del="${id1}"]`).disabled === true

    /* ---------- 10. 停用后删除成功（首次激活已按 F1 语义自动产生「原始提示词」备份条目，故终态 = 备份 + 第二条） ---------- */
    promptToggle(id1).click()
    await wait(900)
    promptDelBtn(id1).click()
    await waitFor(() => document.getElementById('modal-confirm').classList.contains('open'), 'confirm open')
    document.getElementById('cf-ok').click()
    await wait(900)
    const afterDelete = await window.hub.listPrompts('dsh')
    const deleted = !afterDelete.some((p) => p.id === id1) && afterDelete.some((p) => p.id === id2)

    return {
      stage: STAGE,
      fx: FX,
      lib0Count,
      afterAddIds: afterAdd.map((p) => p.id),
      addedNotEnabled,
      id1,
      enabled,
      enableToastHasRealPath,
      disableToastCleared,
      disabled,
      secondInactive,
      copyToastOk,
      claudeCopyInactive,
      claudeDomHas,
      delDisabled,
      deleted,
      afterDeleteNames: afterDelete.map((p) => p.name),
      toasts
    }
  }

  if (STAGE === '2') {
    const EXTERNAL = 'EXTERNAL GLOBAL PROTOCOL CONTENT\nfrom fixture.'
    /* ---------- 1. 前置：dsh 库含「第二条提示词」（未激活），AGENTS.md 已由 fixture 写入外部内容 ---------- */
    const before = await window.hub.listPrompts('dsh')
    const id2 = before.find((p) => p.name === '第二条提示词')
    if (!id2) throw new Error('stage2 precondition: 第二条提示词 must exist in dsh lib')

    /* ---------- 2. 激活第二条 -> live 外部内容应新产生「原始提示词」备份条目 ---------- */
    promptToggle(id2.id).click()
    await wait(1000)
    const after = await window.hub.listPrompts('dsh')
    const id2Enabled = after.find((p) => p.id === id2.id).enabled === true
    const backup = after.find(
      (p) => p.id !== id2.id && /^原始提示词 \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(p.name) && p.content === EXTERNAL
    )
    const backupEntryOk = !!backup && backup.enabled === false

    /* ---------- 3. Dashboard 统计与真实 state 一致 ---------- */
    document.querySelector('.nav-item[data-view="dashboard"]').click()
    await wait(400)
    const mcpLen = (await window.hub.listMcp()).length
    const skillLen = (await window.hub.listSkills()).length
    // 激活提示词 = 各库 enabled 计数（与渲染层 state.promptsByAgent 同源：data.json）
    const agentIds = ['dsh', 'claude', 'codex', 'gemini', 'grok', 'opencode', 'hermes']
    const libs = await Promise.all(agentIds.map((a) => window.hub.listPrompts(a)))
    const promptTotal = libs.reduce((n, l) => n + l.filter((p) => p.enabled).length, 0)
    const statAgents = document.getElementById('stat-agents').textContent
    const statMcp = document.getElementById('stat-mcp').textContent
    const statSkill = document.getElementById('stat-skill').textContent
    const statPrompt = document.getElementById('stat-prompt').textContent
    const dashOk = statAgents === '7' && statMcp === String(mcpLen) &&
      statSkill === String(skillLen) && statPrompt === String(promptTotal)
    // 概览网格首卡（dsh）计数同源
    const gridText = document.getElementById('dash-agent-grid').textContent
    const dshEnabled = libs[0].filter((p) => p.enabled).length
    const gridDshOk = gridText.includes(`MCP ${mcpLen} · Skills ${skillLen} · 提示词 ${dshEnabled}`)

    return {
      stage: STAGE,
      fx: FX,
      beforeIds: before.map((p) => p.id),
      id2Enabled,
      backupName: backup ? backup.name : null,
      backupContent: backup ? backup.content : null,
      backupEntryOk,
      mcpLen,
      skillLen,
      promptTotal,
      statAgents,
      statMcp,
      statSkill,
      statPrompt,
      dashOk,
      gridDshOk,
      toasts
    }
  }

  /* ---------- STAGE 3：Harness 管理 ---------- */
  document.querySelector('.nav-item[data-view="agents"]').click()
  await waitFor(() => document.querySelectorAll('#agent-cards .agent-card').length === 7, 'agent cards render')

  /* ---------- 1. 7 卡展示 resolved 真实路径（含 fixture 路径） ---------- */
  const cardCount = document.querySelectorAll('#agent-cards .agent-card').length
  const det0 = await window.hub.getAgentsDetailed()
  const dshCard = cardText('dsh')
  const codes = [...dshCard.querySelectorAll('code')].map((c) => c.textContent)
  const dshCardPaths = codes[0].includes(`${FX}\\dsh\\profiles\\web\\cordis.patch.yml`) &&
    codes[1].includes(`${FX}\\dsh\\skills`) &&
    codes[2].includes(`${FX}\\dsh\\AGENTS.md`)
  const claudeCard = cardText('claude')
  const claudeCodes = [...claudeCard.querySelectorAll('code')].map((c) => c.textContent)
  const claudeDefaultPrompt = claudeCodes[2] === PT_CLAUDE
  const claudeInputDefault = document.querySelector('[data-dir-input="claude"]').value === `${FX}\\claude`
  const resolvedDefault = det0.resolved.claude.mcpPath === `${FX}\\claude\\.claude.json`

  /* ---------- 2. claude 覆盖为 fixture 子目录（输入框填值 + change 保存） ---------- */
  const dirInput = document.querySelector('[data-dir-input="claude"]')
  dirInput.value = `${FX}\\claude-sub`
  dirInput.dispatchEvent(new Event('change'))
  await wait(1100)
  const det2 = await window.hub.getAgentsDetailed()
  const settings2 = await window.hub.getSettings()
  const overrideSaved = settings2.dirOverrides.claude === `${FX}\\claude-sub`
  const resolvedClaude = det2.resolved.claude
  const resolvedOk = resolvedClaude.mcpPath === `${FX}\\claude-sub\\.claude.json` &&
    resolvedClaude.skillsDir === `${FX}\\claude-sub\\skills` &&
    resolvedClaude.promptFile === `${FX}\\claude-sub\\CLAUDE.md`
  const claudeCardAfter = cardText('claude')
  const domAfter = [...claudeCardAfter.querySelectorAll('code')].map((c) => c.textContent)
  const domClaudePromptAfter = domAfter[2] === `${FX}\\claude-sub\\CLAUDE.md`

  /* ---------- 3. 覆盖后文件操作走新路径：claude 库新增并激活 ---------- */
  document.querySelector('.agent-row[data-agent="claude"]').click()
  await waitFor(() => document.querySelector('#prompt-file').textContent.includes(`${FX}\\claude-sub\\CLAUDE.md`), 'prompt header real path')
  const headerRealPath = document.getElementById('prompt-file').textContent.includes(`${FX}\\claude-sub\\CLAUDE.md`)
  document.getElementById('btn-add-prompt').click()
  await waitFor(() => document.getElementById('modal-prompt-form').classList.contains('open'), 'claude prompt form open')
  document.getElementById('pf-name').value = 'claude-smoke'
  document.getElementById('pf-content').value = 'Claude override write content.'
  document.getElementById('pf-save').click()
  await wait(700)
  const claudeLib = await window.hub.listPrompts('claude')
  const claudeSmoke = claudeLib.find((p) => p.name === 'claude-smoke')
  promptToggle(claudeSmoke.id).click()
  await wait(1000)
  const claudeLibAfter = await window.hub.listPrompts('claude')
  const claudeSmokeEnabled = claudeLibAfter.find((p) => p.id === claudeSmoke.id).enabled === true
  const writeToastRealPath = hasToast(new RegExp(`claude-sub\\\\CLAUDE.md`))

  /* ---------- 4. 重置 claude -> 恢复默认 ---------- */
  document.querySelector('.nav-item[data-view="agents"]').click()
  await waitFor(() => document.querySelectorAll('#agent-cards .agent-card').length === 7, 'agent cards re-render')
  document.querySelector('[data-dir-reset="claude"]').click()
  await wait(1100)
  const det3 = await window.hub.getAgentsDetailed()
  const settings3 = await window.hub.getSettings()
  // 重置 = 删覆盖 -> 恢复真实默认落点（claude 默认 MCP 落点 ~/.claude.json 在配置目录外，见全局约束第 10 条）
  const resetDefault = !settings3.dirOverrides.claude &&
    det3.resolved.claude.mcpPath === `${HOME}\\.claude.json` &&
    det3.resolved.claude.promptFile === `${HOME}\\.claude\\CLAUDE.md`
  const inputAfterReset = document.querySelector('[data-dir-input="claude"]').value === ''

  return {
    stage: STAGE,
    fx: FX,
    cardCount,
    dshCardPaths,
    claudeDefaultPrompt,
    claudeInputDefault,
    resolvedDefault,
    overrideSaved,
    resolvedOk,
    resolvedClaudeMCP: resolvedClaude.mcpPath,
    resolvedClaudePrompt: resolvedClaude.promptFile,
    domClaudePromptAfter,
    headerRealPath,
    claudeSmokeEnabled,
    writeToastRealPath,
    resetDefault,
    inputAfterReset,
    toasts
  }
})()