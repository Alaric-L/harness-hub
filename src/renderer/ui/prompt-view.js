/* ================= 提示词 v2 纯渲染函数（无 DOM，可单测） ================= */

/** 根据运行时 live 状态与 saved 库计算状态徽章文案 */
export function liveStatusText(live, prompts){
  if(!live) return '未知';
  if(!live.exists) return '未找到指令文件';
  if(live.content === '') return '文件为空';
  const matched = prompts.filter(p => live.matchedIds.includes(p.id));
  if(matched.length === 0) return '自定义内容（未保存）';
  if(matched.length === 1) return `与「${matched[0].name}」一致`;
  return `与「${matched[0].name}」等 ${matched.length} 条一致`;
}

/** mtime epoch ms -> 本地可读时间；null/undefined -> 未知 */
export function formatPromptMtime(mtime){
  if(!mtime) return '未知';
  return new Date(mtime).toLocaleString('zh-CN', { hour12: false });
}

function splitLines(text){
  if(text === '') return [];
  return String(text).split(/\r\n|\r|\n/);
}

/** 小文本 line diff：保留共同行，`-` 为当前内容将被替换的行，`+` 为 saved 内容新增行 */
export function promptDiffText(current, saved){
  const a = splitLines(current);
  const b = splitLines(saved);
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for(let i = a.length - 1; i >= 0; i--){
    for(let j = b.length - 1; j >= 0; j--){
      dp[i][j] = a[i] === b[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const lines = [];
  let i = 0, j = 0;
  while(i < a.length && j < b.length){
    if(a[i] === b[j]){
      lines.push(`  ${a[i]}`); i++; j++;
    } else if(dp[i + 1][j] >= dp[i][j + 1]){
      lines.push(`- ${a[i]}`); i++;
    } else {
      lines.push(`+ ${b[j]}`); j++;
    }
  }
  while(i < a.length){ lines.push(`- ${a[i]}`); i++; }
  while(j < b.length){ lines.push(`+ ${b[j]}`); j++; }
  return lines.join('\n');
}

/** Dashboard 统计：saved 库总数（live 不参与计数） */
export function savedPromptCount(promptsByAgent){
  return Object.values(promptsByAgent || {}).reduce((n, list) => {
    return n + (Array.isArray(list) ? list.length : 0);
  }, 0);
}