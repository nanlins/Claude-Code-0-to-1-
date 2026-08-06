// 极简 MCP 服务器示例 —— stdio JSON-RPC（initialize / tools/list / tools/call）。
// 用法：在 .mcp/servers.json 配置 { "echo": { "command": "node", "args": ["examples/mcp-echo-server.mjs"] } }
import readline from 'node:readline';

const tools = [
  {
    name: 'echo',
    description: '把输入文本原样回显。',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
    },
  },
  {
    name: 'docs_search',
    description: '在手搓 Claude Code 文档中搜索关键词。',
    inputSchema: {
      type: 'object',
      properties: { keyword: { type: 'string' } },
      required: ['keyword'],
    },
  },
];

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined) return; // notification
  const reply = { jsonrpc: '2.0', id: msg.id };
  try {
    switch (msg.method) {
      case 'initialize':
        reply.result = {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'echo-server', version: '1.0.0' },
        };
        break;
      case 'tools/list':
        reply.result = { tools };
        break;
      case 'tools/call': {
        const { name, arguments: args } = msg.params ?? {};
        if (name === 'echo') {
          reply.result = { content: [{ type: 'text', text: `echo: ${args?.text ?? ''}` }] };
        } else if (name === 'docs_search') {
          reply.result = {
            content: [{ type: 'text', text: `docs results for '${args?.keyword ?? ''}': see docs/architecture.md` }],
          };
        } else {
          throw new Error(`Unknown tool ${name}`);
        }
        break;
      }
      default:
        reply.error = { code: -32601, message: `Method not found: ${msg.method}` };
    }
  } catch (err) {
    reply.error = { code: -32000, message: err instanceof Error ? err.message : String(err) };
  }
  process.stdout.write(JSON.stringify(reply) + '\n');
});