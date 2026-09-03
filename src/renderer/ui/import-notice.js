/* ================= Skills 导入：部署提示/确认文案（纯函数） ================= */
/* 三种部署方式的文案各自独立成套，清楚说明对 harness 内已有文件的影响；
 * auto 虽已从设置页收敛掉，文案保留备用（设置恢复 auto 时直接可用）。 */

const HINTS = {
  symlink: '部署方式：符号链接——在 harness 的 skills 目录创建指向中央库的链接（不复制文件，中央库改动实时生效）；已存在同名目录的位置会被删除并替换为链接，原始文件仅保留在中央库一份。',
  copy: '部署方式：复制——向 harness 的 skills 目录写入中央库的完整副本；已存在同名目录的位置会被整体替换为副本（内容与导入时一致），此后 harness 中的副本与中央库互不联动。',
  auto: [
    '部署方式：自动——按目标位置现状二选一：',
    '- 位置为空 → 创建符号链接：harness 内仅放一个指向中央库的链接，原始文件只保留在中央库一份，中央库改动实时生效；',
    '- 已有同名目录 → 复制替换：原目录被删除并替换为中央库副本（内容与导入时一致），此后与中央库互不联动。',
    '来源 harness 已存在原目录，将按“复制替换”处理。'
  ].join('\n')
}

const CONFIRM = {
  symlink: (n, t) => `将以符号链接方式部署 ${n} 个 Skill 到 ${t}。已存在同名目录的位置将被删除并替换为链接，原始文件仅保留在中央库。是否继续？`,
  copy: (n, t) => `将以复制方式部署 ${n} 个 Skill 到 ${t}。已存在同名目录的位置将被整体替换为副本（内容与导入时一致），此后与中央库互不联动。是否继续？`,
  auto: (n, t) => `将以自动方式部署 ${n} 个 Skill 到 ${t}：已有同名目录的位置将复制替换为副本（原目录删除），其余位置将创建符号链接。是否继续？`
}

function assertMethod(method) {
  if (!Object.hasOwn(HINTS, method)) throw new Error(`未知的部署方式：${method}`)
}

/** 弹窗内提示文案（\n 换行，展示端配合 white-space: pre-line） */
export function importDeployHint(method) {
  assertMethod(method)
  return HINTS[method]
}

/** 执行前二级确认文案；targets 为 harness 短名列表，为空表示只入库、不部署（不涉及 harness 文件修改） */
export function importConfirmMessage(method, count, targets) {
  assertMethod(method)
  const list = (targets ?? []).join('、')
  if (!list) return `将导入 ${count} 个 Skill 到中央库（只入库、不部署到任何 harness，不会修改 harness 内文件）。是否继续？`
  return CONFIRM[method](count, list)
}
