/* ================= 写入内容预览（渲染端 mock 兜底；后续 G 块保留作 mock 兜底） ================= */
export function specPreview(agent, item){
  const s = item.spec || {type:'stdio', command:'', args:[]};
  if(agent.mcpFormat==='yaml-patch'){
    const lines = ['- insert:', `  - id: mcp-${item.id}`, `    name: '@deepseek-ai/dsh-mcp-client'`, '    config:', `      serverName: ${item.id}`];
    if(s.type==='stdio'){
      lines.push('      transport: stdio', `      command: ${s.command}`);
      if(s.args && s.args.length) lines.push(`      args: ['${s.args.join("', '")}']`);
      if(s.env) lines.push(`      env: ${JSON.stringify(s.env)}`);
    } else {
      lines.push('      transport: streamable-http', `      url: ${s.url}`);
      if(s.headers) lines.push(`      headers: ${JSON.stringify(s.headers)}`);
    }
    return lines.join('\n');
  }
  if(agent.mcpFormat==='toml'){
    const lines = [`[mcp_servers.${item.id}]`];
    if(s.type==='stdio'){
      lines.push(`command = "${s.command}"`);
      if(s.args && s.args.length) lines.push(`args = [${s.args.map(x=>`"${x}"`).join(', ')}]`);
    } else {
      lines.push(`type = "${s.type}"`, `url = "${s.url}"`);
    }
    return lines.join('\n');
  }
  if(agent.mcpFormat==='yaml'){
    const lines = ['mcp_servers:', `  ${item.id}:`];
    if(s.type==='stdio'){
      lines.push('    type: stdio', `    command: ${s.command}`);
      if(s.args && s.args.length) lines.push(`    args: [${s.args.map(x=>`'${x}'`).join(', ')}]`);
    } else {
      lines.push(`    type: ${s.type}`, `    url: ${s.url}`);
    }
    lines.push('    enabled: true');
    return lines.join('\n');
  }
  // json: claude/gemini 用 mcpServers，opencode 用 mcp
  const spec = JSON.parse(JSON.stringify(s));
  if(agent.id==='opencode') return JSON.stringify({mcp:{[item.id]:spec}}, null, 2);
  return JSON.stringify({mcpServers:{[item.id]:spec}}, null, 2);
}