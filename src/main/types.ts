// src/main/types.ts —— 全项目共用
export type AgentId = 'dsh'|'claude'|'codex'|'gemini'|'grok'|'opencode'|'hermes';
/** Skills 部署目标：7 个 harness，或 Agent Skills 共享目录（~/.agents/skills） */
export type SkillTargetId = AgentId | 'shared';
export type McpFormat = 'yaml-patch'|'json'|'toml'|'yaml';

export interface McpSpec {
  type: 'stdio'|'http'|'sse';
  command?: string; args?: string[]; env?: Record<string,string>;   // stdio
  url?: string; headers?: Record<string,string>;                    // http/sse
}
export interface McpItem {
  id: string; name: string; desc?: string; tag?: string;
  homepage?: string; docs?: string;
  spec: McpSpec;
  apps: Partial<Record<AgentId, boolean>>;   // 缺省 = false
}
export interface AgentInfo {
  id: AgentId; name: string; short: string; dir: string;
  mcpPath: string; mcpFormat: McpFormat;
  skillsDir: string; promptFile: string;     // 展示用默认值；实际路径经 resolveAgentPaths 计算
}
export interface SkillInstalled {
  dir: string; name: string; desc: string;
  repo: string | null;          // 'owner/repo' 或本地 null
  hasUpdate: boolean;
  apps: Partial<Record<SkillTargetId, boolean>>;
}
export interface PromptItem {
  id: string; name: string; desc?: string;
  content: string; createdAt: number; updatedAt: number;   // epoch ms
}

export interface PromptLive {
  agentId: AgentId;
  path: string;
  exists: boolean;
  content: string;
  mtime: number | null;       // epoch ms
  matchedIds: string[];        // 与 saved content 完全相等的记录
}

export interface PromptSnapshot {
  prompts: PromptItem[];
  live: PromptLive;
}
export interface RepoConfig { owner: string; name: string; branch: string; }
export interface SkillBackup {
  backupId: string; name: string; dir: string; desc: string;
  createdAt: number; path: string;
}
export interface UnmanagedSkill {
  dir: string; name: string; desc: string;
  foundIn: SkillTargetId[]; path: string;
}
export interface AppSettings {
  dirOverrides: Partial<Record<AgentId, string>>;
  syncMethod: 'auto'|'symlink'|'copy';
  backupBeforeWrite: boolean; skillUninstallBackup: boolean;
}
