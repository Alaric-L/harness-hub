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

/* ---- 提示词库：已改为 IPC 拉取（state.promptsByAgent，G3 起不再内置 mock） ---- */