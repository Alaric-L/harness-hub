/* ================= 数据模型（mock，后续 G 块替换为 IPC 拉取） ================= */
export const AGENTS = [
  {id:'dsh',      name:'DeepSeek Harness', short:'DSH',      dir:'~/.dsh',
   mcpPath:'~/.dsh/profiles/web/cordis.patch.yml', mcpFormat:'yaml-patch',
   skillsDir:'~/.dsh/skills', promptFile:'~/.dsh/AGENTS.md'},
  {id:'claude',   name:'Claude Code',       short:'Claude',   dir:'~/.claude',
   mcpPath:'~/.claude.json', mcpFormat:'json',
   skillsDir:'~/.claude/skills', promptFile:'~/.claude/CLAUDE.md'},
  {id:'codex',    name:'Codex',             short:'Codex',    dir:'~/.codex',
   mcpPath:'~/.codex/config.toml', mcpFormat:'toml',
   skillsDir:'~/.codex/skills', promptFile:'~/.codex/AGENTS.md'},
  {id:'gemini',   name:'Gemini CLI',        short:'Gemini',   dir:'~/.gemini',
   mcpPath:'~/.gemini/settings.json', mcpFormat:'json',
   skillsDir:'~/.gemini/skills', promptFile:'~/.gemini/GEMINI.md'},
  {id:'grok',     name:'Grok Build',        short:'Grok',     dir:'~/.grok',
   mcpPath:'~/.grok/config.toml', mcpFormat:'toml',
   skillsDir:'~/.grok/skills', promptFile:'~/.grok/AGENTS.md'},
  {id:'opencode', name:'OpenCode',          short:'OpenCode', dir:'~/.config/opencode',
   mcpPath:'~/.config/opencode/opencode.json', mcpFormat:'json',
   skillsDir:'~/.config/opencode/skills', promptFile:'~/.config/opencode/AGENTS.md'},
  {id:'hermes',   name:'Hermes',            short:'Hermes',   dir:'~/.hermes',
   mcpPath:'~/.hermes/config.yaml', mcpFormat:'yaml',
   skillsDir:'~/.hermes/skills', promptFile:'~/.hermes/SOUL.md'},
];
export function AGENT_BY(id){ return AGENTS.find(a=>a.id===id); }

/* ---- MCP 统一库：数据改为 IPC 拉取（state.mcpItems），不再内置 mock ---- */
export const MCP_PRESETS = [
  {id:'playwright', name:'playwright', desc:'浏览器自动化与网页操作', tag:'自动化',
   homepage:'https://playwright.dev', docs:'https://github.com/microsoft/playwright-mcp',
   spec:{type:'stdio', command:'npx', args:['-y','@playwright/mcp@latest']}},
  {id:'fetch', name:'fetch', desc:'网页抓取与 Markdown 格式化输出', tag:'网络',
   homepage:'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
   spec:{type:'stdio', command:'uvx', args:['mcp-server-fetch']}},
  {id:'context7', name:'context7', desc:'为代码生成注入最新版库文档', tag:'代码',
   homepage:'https://context7.com',
   spec:{type:'http', url:'https://mcp.context7.com/mcp'}},
  {id:'tavily', name:'tavily', desc:'联网搜索能力（Tavily API）', tag:'搜索',
   homepage:'https://tavily.com', docs:'https://docs.tavily.com/documentation/api-reference/mcp',
   spec:{type:'http', url:'https://mcp.tavily.com/mcp/?tavilyApiKey=YOUR_KEY'}},
  {id:'dbx', name:'dbx', desc:'数据库连接、查询与表结构管理', tag:'数据库',
   homepage:'https://github.com/dbx-app/mcp-server',
   spec:{type:'stdio', command:'npx', args:['-y','@dbx-app/mcp-server@latest']}},
  {id:'filesystem', name:'filesystem', desc:'本地文件读写访问', tag:'文件系统',
   homepage:'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
   spec:{type:'stdio', command:'npx', args:['-y','@modelcontextprotocol/server-filesystem','/path/to/allowed/dir']}},
  {id:'github', name:'github', desc:'仓库、Issue、PR 与代码评审操作', tag:'代码',
   homepage:'https://github.com/github/github-mcp-server', docs:'https://github.com/github/github-mcp-server#readme',
   spec:{type:'http', url:'https://api.githubcopilot.com/mcp/'}},
  {id:'sequential-thinking', name:'sequential-thinking', desc:'结构化多步推理与思维链', tag:'思考',
   homepage:'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
   spec:{type:'stdio', command:'npx', args:['-y','@modelcontextprotocol/server-sequential-thinking']}},
];

/* ---- Skills：中央库（SSOT） ---- */
export const SSOT_DIR = '~/.harness-hub/skills';
export const SKILLS_INSTALLED = [
  {dir:'brainstorming', name:'brainstorming', desc:'将想法打磨为设计与规格：分类请求、澄清问题、产出设计文档', repo:'obra/superpowers', hasUpdate:false,
   apps:{dsh:1,claude:1,codex:0,gemini:0,grok:0,opencode:0,hermes:0}},
  {dir:'writing-plans', name:'writing-plans', desc:'为多步任务编写含审查检查点的实施计划', repo:'obra/superpowers', hasUpdate:true,
   apps:{dsh:1,claude:1,codex:1,gemini:0,grok:0,opencode:0,hermes:0}},
  {dir:'test-driven-development', name:'test-driven-development', desc:'TDD：先写失败测试，再写实现代码', repo:'obra/superpowers', hasUpdate:false,
   apps:{dsh:1,claude:1,codex:0,gemini:0,grok:0,opencode:1,hermes:0}},
  {dir:'systematic-debugging', name:'systematic-debugging', desc:'系统化调试：先定位根因，再提出修复', repo:'obra/superpowers', hasUpdate:false,
   apps:{dsh:0,claude:1,codex:0,gemini:0,grok:0,opencode:0,hermes:0}},
  {dir:'verification-before-completion', name:'verification-before-completion', desc:'完成前验证：运行命令、拿到证据再下结论', repo:'obra/superpowers', hasUpdate:false,
   apps:{dsh:1,claude:1,codex:0,gemini:1,grok:0,opencode:0,hermes:0}},
  {dir:'commit-message', name:'commit-message', desc:'生成规范化提交信息', repo:null, hasUpdate:false,
   apps:{dsh:0,claude:1,codex:0,gemini:0,grok:0,opencode:0,hermes:0}},
];

export const SKILL_REPOS = [
  {owner:'obra', name:'superpowers', branch:'main'},
];

/* 发现页（仓库模式） */
export const SKILLS_DISCOVERY = [
  {key:'executing-plans', name:'executing-plans', desc:'在有审查检查点的独立会话中执行书面实施计划', repo:'obra/superpowers'},
  {key:'requesting-code-review', name:'requesting-code-review', desc:'完成任务后请求代码评审，验证工作满足需求', repo:'obra/superpowers'},
  {key:'receiving-code-review', name:'receiving-code-review', desc:'接收代码评审反馈：先验证再实施建议', repo:'obra/superpowers'},
  {key:'finishing-a-development-branch', name:'finishing-a-development-branch', desc:'实现完成后决定分支如何集成', repo:'obra/superpowers'},
  {key:'dispatching-parallel-agents', name:'dispatching-parallel-agents', desc:'将独立任务并行分派给子代理执行', repo:'obra/superpowers'},
  {key:'subagent-driven-development', name:'subagent-driven-development', desc:'在当前会话中用子代理执行实施计划', repo:'obra/superpowers'},
  {key:'writing-skills', name:'writing-skills', desc:'创建与编辑可复用的 skill 指令集', repo:'obra/superpowers'},
  {key:'using-git-worktrees', name:'using-git-worktrees', desc:'需要隔离工作区时使用 git worktree', repo:'obra/superpowers'},
];

/* 发现页（skills.sh 模式） */
export const SKILLS_SH = [
  {key:'pdf', name:'pdf', desc:'处理 PDF 文件：读取、编辑、搜索与格式转换', repo:'ananddtyagi/pdf-skill', installs:28435},
  {key:'docx', name:'docx', desc:'创建与编辑 Word 文档', repo:'ananddtyagi/office-skill', installs:21532},
  {key:'xlsx', name:'xlsx', desc:'Excel 电子表格读写与公式计算', repo:'ananddtyagi/office-skill', installs:19871},
  {key:'pptx', name:'pptx', desc:'PowerPoint 演示文稿生成', repo:'ananddtyagi/office-skill', installs:12044},
  {key:'browser-tools', name:'browser-tools', desc:'浏览器开发工具：控制台、网络与截图', repo:'AgentDeskAI/browser-tools-mcp', installs:9821},
  {key:'webapp-testing', name:'webapp-testing', desc:'Web 应用端到端测试与可访问性检查', repo:'vercel-labs/webapp-testing', installs:6430},
];

/* Skill 卸载备份 */
export const SKILL_BACKUPS = [
  {backupId:'bk-1', name:'code-review', dir:'code-review', desc:'代码评审规范与检查清单',
   createdAt:'2026-08-12 21:04', path:'~/.harness-hub/skill-backups/code-review-20260812'},
  {backupId:'bk-2', name:'sql-optimizer', dir:'sql-optimizer', desc:'SQL 查询优化建议',
   createdAt:'2026-08-02 10:37', path:'~/.harness-hub/skill-backups/sql-optimizer-20260802'},
];

/* 未纳管 Skill（导入用） */
export const UNMANAGED_SKILLS = [
  {dir:'pdf', name:'pdf', desc:'处理 PDF 文件：读取、编辑、搜索', foundIn:['claude','codex'], path:'~/.claude/skills/pdf'},
  {dir:'api-doc-writer', name:'api-doc-writer', desc:'生成 API 接口文档', foundIn:['claude'], path:'~/.claude/skills/api-doc-writer'},
  {dir:'changelog', name:'changelog', desc:'生成版本更新日志', foundIn:['opencode'], path:'~/.config/opencode/skills/changelog'},
];

/* ---- 提示词库（每 harness 一套，单条激活） ---- */
export const PROMPTS = {
  dsh: [
    {id:'dsh-1', name:'中文 · 全栈工程师', desc:'中文回复，先说明修改思路再动手', enabled:true,  updated:'2 小时前',
     content:'你是一名资深全栈工程师助手。使用中文回复。回答前先思考用户的真实意图，优先给出可运行的代码，并解释关键决策。涉及不可逆操作前必须先确认。'},
    {id:'dsh-2', name:'English · Minimal', desc:'Concise English answers, minimal diffs', enabled:false, updated:'3 天前',
     content:'You are a precise coding agent. Always run tests after edits. Prefer minimal diffs over large rewrites. Ask before deleting files.'},
  ],
  claude: [
    {id:'cl-1', name:'资深工程师助手', desc:'先思考真实意图，优先给可运行代码', enabled:true, updated:'昨天',
     content:'你是一名资深全栈工程师助手。回答前先思考用户的真实意图，优先给出可运行的代码，并解释关键决策。'},
    {id:'cl-2', name:'Code Review 模式', desc:'评审视角：只提问题、风险与改进建议', enabled:false, updated:'5 天前',
     content:'你是代码评审专家。逐项检查正确性、边界条件、可读性与测试覆盖，按严重程度排序输出问题清单。'},
  ],
  codex: [
    {id:'cx-1', name:'精确编码代理', desc:'英文、小步提交、测试先行', enabled:true, updated:'3 天前',
     content:'You are a precise coding agent. Always run tests after edits. Prefer minimal diffs over large rewrites.'},
  ],
  gemini: [
    {id:'gm-1', name:'全栈工程师助手', desc:'与 Claude 库同源的通用配置', enabled:true, updated:'昨天',
     content:'你是一名资深全栈工程师助手。回答前先思考用户的真实意图，优先给出可运行的代码。'},
  ],
  grok: [],
  opencode: [
    {id:'oc-1', name:'自主编码代理', desc:'小步可验证，记录每次文件变更', enabled:true, updated:'1 天前',
     content:'You are OpenCode, an autonomous coding agent. Work in small verifiable steps. Log every file change.'},
  ],
  hermes: [
    {id:'hm-1', name:'稳定执行者', desc:'聚焦任务执行与结果汇报', enabled:true, updated:'4 天前',
     content:'你是一名稳定可靠的执行代理。严格按指令执行任务，及时汇报进展与阻塞。'},
  ],
};