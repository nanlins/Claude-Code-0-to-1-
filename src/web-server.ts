/**
 * Web UI —— 浏览器端访问小锤 (Anvil)。
 *
 * 零依赖：Node 内置 http 模块 + SSE 流式输出。
 * 启动：npm run web  →  http://localhost:5173
 *
 * 结构：
 *   GET  /            → 前端页面（内联 HTML/CSS/JS，美化版）
 *   POST /api/chat    → 发送消息，SSE 流式返回（text/tool_use/system 事件）
 *   GET  /api/tools   → 工具列表（侧边栏展示）
 *   GET  /api/config  → 配置摘要
 *   GET  /api/usage   → token 用量
 */
import http from 'node:http';
import type { Harness } from './main.js';
import { createHarness } from './main.js';

const PORT = Number(process.env.WEB_PORT ?? 5173);

/** 用数组拼接 HTML，避免模板字符串反引号转义问题。 */
function page(): string {
  const h: string[] = [];
  h.push('<!DOCTYPE html>');
  h.push('<html lang="zh-CN">');
  h.push('<head><meta charset="UTF-8"><title>小锤 Anvil — 手搓 Agent</title><style>');
  h.push('*{box-sizing:border-box;margin:0;padding:0}');
  h.push(':root{--bg:#1e1e2e;--bg2:#181825;--border:#313244;--text:#cdd6f4;--text2:#7f849c;--accent:#89b4fa;--green:#a6e3a1;--yellow:#f9e2af;--red:#f38ba8;--user-bg:#45475a;--assistant-bg:#26273a;--code-bg:#11111b;--tool-bg:#1e2030;--hover:#313244;--shadow:0 4px 16px rgba(0,0,0,.3)}');
  h.push('body.light{--bg:#eff1f5;--bg2:#e6e9ef;--border:#ccd0da;--text:#4c4f69;--text2:#8c8fa1;--accent:#1e66f5;--green:#40a02b;--yellow:#df8e1d;--red:#d20f39;--user-bg:#dce0e8;--assistant-bg:#e6e9ef;--code-bg:#dce0e8;--tool-bg:#e6e9ef;--hover:#ccd0da;--shadow:0 4px 16px rgba(0,0,0,.1)}');
  h.push('body{font-family:"Segoe UI","Microsoft YaHei",sans-serif;display:flex;height:100vh;background:var(--bg);color:var(--text);transition:background .3s,color .3s}');
  h.push('::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px}');
  h.push('#sidebar{width:270px;background:var(--bg2);border-right:1px solid var(--border);display:flex;flex-direction:column;font-size:13px;flex-shrink:0}');
  h.push('#sidebar-head{padding:18px 16px;border-bottom:1px solid var(--border)}');
  h.push('#sidebar-head h1{font-size:19px;color:var(--accent);display:flex;align-items:center;gap:8px}');
  h.push('#sidebar-head .sub{color:var(--text2);font-size:12px;margin-top:4px}');
  h.push('#cfg{margin-top:12px;padding:8px 10px;background:var(--tool-bg);border-radius:8px;color:var(--text);font-size:12px;line-height:1.6}');
  h.push('#usage{margin-top:8px;padding:8px 10px;background:var(--tool-bg);border-radius:8px;color:var(--yellow);font-size:12px;line-height:1.6}');
  h.push('#sidebar-body{flex:1;overflow-y:auto;padding:12px}');
  h.push('#sidebar-body h3{color:var(--text2);margin:8px 0;font-size:12px;text-transform:uppercase;letter-spacing:.5px}');
  h.push('#tools{list-style:none;display:flex;flex-wrap:wrap;gap:6px}');
  h.push('#tools li{padding:4px 8px;border-radius:6px;color:var(--green);background:var(--tool-bg);font-family:Consolas,monospace;font-size:11px;border:1px solid var(--border);cursor:pointer;transition:all .15s}');
  h.push('#tools li:hover{background:var(--hover);transform:translateY(-1px)}');
  h.push('#main{flex:1;display:flex;flex-direction:column;min-width:0}');
  h.push('#messages{flex:1;overflow-y:auto;padding:24px 28px;scroll-behavior:smooth}');
  h.push('#empty-state{text-align:center;color:var(--text2);margin-top:15vh;font-size:14px}');
  h.push('#empty-state .icon{font-size:48px;margin-bottom:12px}');
  h.push('.msg-row{display:flex;margin-bottom:16px}');
  h.push('.msg-row.user{justify-content:flex-end}');
  h.push('.msg-bubble{max-width:82%;padding:12px 16px;border-radius:14px;line-height:1.6;font-size:14px;word-break:break-word}');
  h.push('.msg-row.user .msg-bubble{background:var(--accent);color:#1e1e2e;border-bottom-right-radius:4px}');
  h.push('.msg-row.assistant .msg-bubble{background:var(--assistant-bg);border:1px solid var(--border);border-bottom-left-radius:4px}');
  h.push('.msg-bubble pre{background:var(--code-bg);border-radius:8px;padding:12px;overflow-x:auto;margin:8px 0;border:1px solid var(--border)}');
  h.push('.msg-bubble pre code{font-family:Consolas,monospace;font-size:12.5px;color:var(--green)}');
  h.push('.msg-bubble code{font-family:Consolas,monospace;font-size:12.5px;background:var(--code-bg);padding:2px 5px;border-radius:4px}');
  h.push('.msg-bubble table{border-collapse:collapse;margin:8px 0}');
  h.push('.msg-bubble th,.msg-bubble td{border:1px solid var(--border);padding:6px 10px;font-size:13px}');
  h.push('.msg-bubble th{background:var(--tool-bg)}');
  h.push('.msg-bubble h1,.msg-bubble h2,.msg-bubble h3{margin:12px 0 8px;color:var(--accent)}');
  h.push('.msg-bubble h1{font-size:18px}.msg-bubble h2{font-size:16px}.msg-bubble h3{font-size:14px}');
  h.push('.msg-bubble ul,.msg-bubble ol{padding-left:22px;margin:6px 0}');
  h.push('.msg-bubble a{color:var(--accent)}');
  h.push('.cursor{display:inline-block;width:8px;height:16px;background:var(--accent);margin-left:2px;animation:blink .8s infinite;vertical-align:text-bottom}');
  h.push('@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}');
  h.push('.tool-card{background:var(--tool-bg);border:1px solid var(--border);border-radius:10px;margin:10px 0;overflow:hidden;font-size:13px}');
  h.push('.tool-card summary{padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:8px;user-select:none;transition:background .15s}');
  h.push('.tool-card summary:hover{background:var(--hover)}');
  h.push('.tool-card summary .t-icon{width:22px;height:22px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0}');
  h.push('.tool-card.summary .t-icon{background:var(--green);color:#1e1e2e}');
  h.push('.tool-card.exec .t-icon{background:var(--yellow);color:#1e1e2e}');
  h.push('.tool-card.error .t-icon{background:var(--red);color:#1e1e2e}');
  h.push('.tool-card .t-name{font-family:Consolas,monospace;font-weight:600;color:var(--accent)}');
  h.push('.tool-card .t-body{padding:10px 14px;border-top:1px solid var(--border);color:var(--text2);font-size:12px;max-height:300px;overflow-y:auto}');
  h.push('.tool-card .t-body pre{white-space:pre-wrap;word-break:break-word;font-family:Consolas,monospace;font-size:11.5px}');
  h.push('#statusbar{padding:8px 28px;border-top:1px solid var(--border);background:var(--bg2);color:var(--text2);font-size:12px;min-height:34px;display:flex;align-items:center;gap:8px}');
  h.push('#statusbar .spinner{width:12px;height:12px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite;display:none}');
  h.push('#statusbar.busy .spinner{display:inline-block}');
  h.push('@keyframes spin{to{transform:rotate(360deg)}}');
  h.push('#inputbar{display:flex;padding:14px 28px;gap:10px;border-top:1px solid var(--border);background:var(--bg2)}');
  h.push('#input{flex:1;background:var(--assistant-bg);border:1px solid var(--border);color:var(--text);border-radius:10px;padding:12px 16px;font-size:14px;outline:none;transition:border-color .2s}');
  h.push('#input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(137,180,250,.2)}');
  h.push('#send{background:var(--accent);color:#1e1e2e;border:none;border-radius:10px;padding:0 24px;font-size:14px;font-weight:600;cursor:pointer;transition:all .2s}');
  h.push('#send:hover:not(:disabled){transform:translateY(-1px);box-shadow:var(--shadow)}');
  h.push('#send:disabled{opacity:.5;cursor:not-allowed}');
  h.push('#theme-toggle{background:var(--tool-bg);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:6px 10px;cursor:pointer;font-size:12px;transition:all .15s}');
  h.push('#theme-toggle:hover{background:var(--hover)}');
  h.push('</style></head><body>');
  h.push('<div id="sidebar"><div id="sidebar-head">');
  h.push('<h1>🔨 小锤 Anvil</h1><div class="sub">手搓 Agent Harness · 机制很多，循环一个</div>');
  h.push('<div id="cfg">加载中...</div><div id="usage">Token: -</div>');
  h.push('</div><div id="sidebar-body">');
  h.push('<h3>可用工具 (<span id="toolCount">0</span>)</h3><ul id="tools"></ul>');
  h.push('</div></div>');
  h.push('<div id="main">');
  h.push('<div id="messages"><div id="empty-state"><div class="icon">🔨</div><div>我是小锤(Anvil)——从零手搓的 AI 编程助手<br>输入任务开始，或查看左侧能力清单</div></div></div>');
  h.push('<div id="statusbar"><div class="spinner"></div><span id="status"></span></div>');
  h.push('<div id="inputbar">');
  h.push('<button id="theme-toggle" onclick="toggleTheme()">🌙 深色</button>');
  h.push('<input id="input" placeholder="输入任务，如：重构 src/core/agent.ts 并运行测试" autofocus>');
  h.push('<button id="send">发送 ⏎</button>');
  h.push('</div></div>');
  h.push('<script>');
  h.push('const $msg=document.getElementById("messages"),$input=document.getElementById("input"),$send=document.getElementById("send"),$status=document.getElementById("status"),$statusbar=document.getElementById("statusbar");');
  h.push('function esc(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}');
  h.push('function renderMd(t){let h=esc(t);h=h.replace(/```(\\w+)?\\n([\\s\\S]*?)```/g,(m,l,c)=>"<pre><code>"+c+"</code></pre>");h=h.replace(/`([^`]+)`/g,"<code>$1</code>");h=h.replace(/^### (.*)$/gm,"<h3>$1</h3>").replace(/^## (.*)$/gm,"<h2>$1</h2>").replace(/^# (.*)$/gm,"<h1>$1</h1>");h=h.replace(/\\*\\*([^*]+)\\*\\*/g,"<b>$1</b>");h=h.replace(/^[-*] (.*)$/gm,"<li>$1</li>");h=h.replace(/(<li>[^<]*?<\\/li>)+/g,(m)=>m.includes("<ul>")?m:"<ul>"+m+"</ul>");h=h.replace(/<\\/ul><ul>/g,"");h=h.replace(/\\n/g,"<br>");return h}');
  h.push('function scrollB(){$msg.scrollTop=$msg.scrollHeight}');
  h.push('function appendUser(t){$msg.querySelector("#empty-state")?.remove();const r=document.createElement("div");r.className="msg-row user";r.innerHTML="<div class=\\"msg-bubble\\">"+esc(t).replace(/\\n/g,"<br>")+"</div>";$msg.appendChild(r);scrollB()}');
  h.push('function appendAssistant(){$msg.querySelector("#empty-state")?.remove();const r=document.createElement("div");r.className="msg-row assistant";r.innerHTML="<div class=\\"msg-bubble\\"></div>";$msg.appendChild(r);scrollB();return r.querySelector(".msg-bubble")}');
  h.push('let lastTool=null');
  h.push('function appendTool(st,name,args){const c=document.createElement("details");c.className="tool-card "+st;c.innerHTML="<summary><span class=\\"t-icon\\">"+(st==="error"?"✕":st==="exec"?"⚙":"✓")+"</span><span class=\\"t-name\\">"+esc(name)+"</span></summary><div class=\\"t-body\\"><pre>"+esc(JSON.stringify(args,null,1)).slice(0,400)+"</pre></div>";$msg.appendChild(c);scrollB();return c}');
  h.push('async function loadSidebar(){const[cfg,tools,usage]=await Promise.all([fetch("/api/config").then(r=>r.json()),fetch("/api/tools").then(r=>r.json()),fetch("/api/usage").then(r=>r.json())]);document.getElementById("cfg").innerHTML="模型: <b>"+cfg.model+"</b>"+(cfg.mock?" (MOCK)":"")+"<br>权限: "+cfg.permissionMode;document.getElementById("usage").textContent="Token: 入 "+usage.totalInput+" / 出 "+usage.totalOutput+" / "+usage.calls+" 次";const l=document.getElementById("tools");document.getElementById("toolCount").textContent=tools.length;tools.forEach(t=>{const li=document.createElement("li");li.textContent=t;li.title=t;l.appendChild(li)})}');
  h.push('async function send(){const text=$input.value.trim();if(!text)return;$input.value="";$send.disabled=true;$statusbar.classList.add("busy");appendUser(text);const box=appendAssistant();box.innerHTML="<span class=\\"cursor\\"></span>";setStatus("思考中...");const resp=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:text})});const reader=resp.body.getReader();const dec=new TextDecoder();let buf="",md="";while(true){const{done,value}=await reader.read();if(done)break;buf+=dec.decode(value,{stream:true});const lines=buf.split("\\n");buf=lines.pop()??"";for(const line of lines){if(!line.startsWith("data: "))continue;let evt;try{evt=JSON.parse(line.slice(6))}catch{continue}if(evt.type==="text"){md+=evt.text;box.innerHTML=esc(md).replace(/\\n/g,"<br>")+"<span class=\\"cursor\\"></span>";scrollB()}else if(evt.type==="tool_use"){lastTool=appendTool("exec",evt.name,evt.args||{});setStatus("正在执行: "+evt.name)}else if(evt.type==="tool_result"){if(lastTool){lastTool.className="tool-card summary";lastTool.open=false}lastTool=null;setStatus("")}else if(evt.type==="system"){setStatus(evt.message)}else if(evt.type==="done"){setStatus("")}}}box.innerHTML=renderMd(md);scrollB();$statusbar.classList.remove("busy");$send.disabled=false;$input.focus();loadSidebar()}');
  h.push('function setStatus(t){$status.textContent=t}');
  h.push('$send.onclick=send;$input.onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}};loadSidebar()');
  h.push('function toggleTheme(){document.body.classList.toggle("light");const is=document.body.classList.contains("light");document.getElementById("theme-toggle").textContent=is?"☀️ 浅色":"🌙 深色";localStorage.setItem("theme",is?"light":"dark")}');
  h.push('if(localStorage.getItem("theme")==="light"){document.body.classList.add("light");document.getElementById("theme-toggle").textContent="☀️ 浅色"}');
  h.push('</script></body></html>');
  return h.join('\n');
}

export function startWebUi(harness: Harness): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page());
      return;
    }

    if (req.method === 'GET' && pathname === '/api/tools') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(harness.registry.list()));
      return;
    }

    if (req.method === 'GET' && pathname === '/api/config') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          model: harness.config.model,
          mock: harness.config.mock,
          permissionMode: harness.config.permissionMode,
          workspaceDir: harness.config.workspaceDir,
        }),
      );
      return;
    }

    if (req.method === 'GET' && pathname === '/api/usage') {
      const usage = harness.agent.usage.summary();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(usage));
      return;
    }

    if (req.method === 'POST' && pathname === '/api/chat') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', async () => {
        let message = '';
        try {
          message = JSON.parse(body).message ?? '';
        } catch {
          res.writeHead(400);
          res.end('bad json');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        const send = (evt: unknown) => res.write(`data: ${JSON.stringify(evt)}\n\n`);

        harness.agent.setOnEvent((e) => {
          if (e.type === 'text') send({ type: 'text', text: e.text });
          else if (e.type === 'tool_use') send({ type: 'tool_use', name: e.name, args: e.args });
          else if (e.type === 'tool_result') send({ type: 'tool_result', name: e.name });
          else if (e.type === 'system') send({ type: 'system', message: e.message });
        });
        try {
          await harness.agent.run(message);
        } catch (err) {
          send({ type: 'system', message: `错误: ${err instanceof Error ? err.message : String(err)}` });
        }
        send({ type: 'done' });
        res.end();
      });
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });

  server.listen(PORT, () => {
    console.log(`🔨 小锤 Anvil Web UI: http://localhost:${PORT}`);
  });
  return server;
}

/* CLI 入口：node --import tsx src/web-server.ts（开发） / node dist/web-server.js（构建/Docker） */
const isMain = process.argv[1]?.endsWith('web-server.ts') || process.argv[1]?.endsWith('web-server.js');
if (isMain) {
  const harness = createHarness();
  startWebUi(harness);
}
