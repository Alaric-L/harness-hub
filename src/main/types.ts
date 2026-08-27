// src/main/types.ts —— 全项目共用
export type AgentId = 'dsh'|'claude'|'codex'|'gemini'|'grok'|'opencode'|'hermes';
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
  apps: Partial<Record<AgentId, boolean>>;
}
export interface PromptItem {
  id: string; name: string; desc?: string;
  content: string; enabled: boolean; updatedAt: number;   // epoch ms
}
export interface RepoConfig { owner: string; name: string; branch: string; }
export interface SkillBackup {
  backupId: string; name: string; dir: string; desc: string;
  createdAt: number; path: string;
}
export interface UnmanagedSkill {
  dir: string; name: string; desc: string;
  foundIn: AgentId[]; path: string;
}
export interface AppSettings {
  dirOverrides: Partial<Record<AgentId, string>>;
  syncMethod: 'auto'|'symlink'|'copy';
  backupBeforeWrite: boolean; skillUninstallBackup: boolean;
}
