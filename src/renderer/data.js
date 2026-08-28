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
// Skills 列表 / 备份 / 未纳管 / 仓库配置均已改为 IPC 拉取（state.skillsItems/skillBackups/
// unmanagedSkills/skillRepos，G2 起不再内置 mock）；发现页数据由后端实时拉取。

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