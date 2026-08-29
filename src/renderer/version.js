/* ================= 轻量 semver 比较（镜像 cc-switch src/lib/version.ts） =================
 * 用于 Dashboard「Harness 概览」判断「是否有可用更新」：
 * 版本号是偏序关系，"不相等"不等于"落后"——本地抢先/预发布通道（如 npm next tag）
 * 版本号反而高于 latest，字符串比较会误报需要更新。这里按 semver 严格比较。 */

/** 解析 "2.1.156" / "2.1.156-beta.1"；无法解析返回 null */
export function parseVersion(v){
  const m = String(v).trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if(!m) return null;
  return { core:[Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] };
}

/** 比较预发布段（遵循 semver：有预发布 < 无；数字段按数值、数字段 < 非数字段、非数字段按 ASCII） */
function comparePre(a, b){
  if(a.length===0 && b.length===0) return 0;
  if(a.length===0) return 1;
  if(b.length===0) return -1;
  const len = Math.min(a.length, b.length);
  for(let i=0;i<len;i++){
    const ai = a[i], bi = b[i];
    const aNum = /^\d+$/.test(ai), bNum = /^\d+$/.test(bi);
    if(aNum && bNum){
      const d = Number(ai) - Number(bi);
      if(d!==0) return d<0 ? -1 : 1;
    } else if(aNum){
      return -1;
    } else if(bNum){
      return 1;
    } else if(ai !== bi){
      return ai < bi ? -1 : 1;
    }
  }
  if(a.length === b.length) return 0;
  return a.length < b.length ? -1 : 1;
}

/** 比较两个版本号；>0 表示 a 比 b 新，<0 表示旧，0 表示相等或无法判定（保守不触发更新） */
export function compareVersions(a, b){
  const pa = parseVersion(a), pb = parseVersion(b);
  if(!pa || !pb) return 0;
  for(let i=0;i<3;i++){
    const d = pa.core[i] - pb.core[i];
    if(d!==0) return d<0 ? -1 : 1;
  }
  return comparePre(pa.pre, pb.pre);
}

/** 是否有可用更新：仅当 latest 严格高于 current 时为 true（本地 ≥ latest 一律 false） */
export function isUpdateAvailable(current, latest){
  if(!current || !latest) return false;
  return compareVersions(latest, current) > 0;
}
