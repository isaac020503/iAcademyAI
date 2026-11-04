/* iAcademy Workspace: editor, lecture generator and minimized AI assistant. */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const MONACO_BASE = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs';
  const STORE_KEY = 'iacademy-ws-v1';
  const CHAT_KEY = 'iacademy-ws-chat-v1';

  /* ---------- safe storage ---------- */
  const store = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* storage can be unavailable */ } },
    raw(k) { try { return localStorage.getItem(k) || ''; } catch (_) { return ''; } }
  };
  const token = () => store.raw('iacademy-token');

  /* ---------- markdown (marked + a strict allow-list sanitizer) ---------- */
  const BLOCKED = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'BASE', 'SVG', 'MATH']);
  function sanitize(html) {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    const walk = (node) => {
      for (const el of [...node.children]) {
        if (BLOCKED.has(el.tagName.toUpperCase())) { el.remove(); continue; }
        for (const attr of [...el.attributes]) {
          const n = attr.name.toLowerCase();
          const v = attr.value.trim().toLowerCase();
          const isUrl = n === 'href' || n === 'src' || n === 'xlink:href';
          if (n.startsWith('on') || n === 'style' || n === 'srcdoc' || (isUrl && !/^(https?:|mailto:|#|\/(?!\/))/.test(v))) el.removeAttribute(attr.name);
        }
        if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
        walk(el);
      }
    };
    walk(doc.body);
    return doc.body.innerHTML;
  }
  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function renderMarkdown(src) {
    try {
      if (window.marked) return sanitize(window.marked.parse(src, { gfm: true, breaks: false }));
    } catch (_) { /* fall through */ }
    return `<pre>${escapeHtml(src)}</pre>`;
  }

  /* ---------- workspace state ---------- */
  const WELCOME = `# Welcome to iAcademy

Your learning workspace.

- **Generate a lecture**: open the *Lecture generator* (screen icon on the left), or ask the assistant with \`/lecture <topic>\`.
- **Ask the assistant**: click the chat button in the bottom-right corner. It can see your open file when you tick *Share open file*.
- **Run JavaScript**: open \`lessons/hello.js\` and press **Run**.
`;
  const HELLO = `// Press Run (or Ctrl+Enter) to execute this file in your browser.
function greet(name) {
  return \`Hello, \${name}!\`;
}
console.log(greet('iAcademy'));
`;
  const defaults = () => ({ files: { 'README.md': WELCOME, 'lessons/hello.js': HELLO, 'notes.md': '# Notes\n\n' }, open: ['README.md'], active: 'README.md' });
  const ws = Object.assign(defaults(), store.get(STORE_KEY, {}));
  ws.open = ws.open.filter((p) => p in ws.files);
  if (!(ws.active in ws.files)) ws.active = ws.open[0] || null;
  let saveTimer = null;
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set(STORE_KEY, ws), 250); };

  const ui = { preview: false, generating: null, status: null };

  /* ---------- editor (Monaco from CDN, textarea fallback) ---------- */
  const LANG = { js: 'javascript', mjs: 'javascript', ts: 'typescript', py: 'python', html: 'html', css: 'css', json: 'json', md: 'markdown', sql: 'sql', java: 'java', c: 'c', cpp: 'cpp', cs: 'csharp', go: 'go', rs: 'rust', php: 'php', yml: 'yaml', yaml: 'yaml', sh: 'shell' };
  const langOf = (p) => LANG[(p.split('.').pop() || '').toLowerCase()] || 'plaintext';
  const isDark = () => document.documentElement.dataset.theme !== 'light';

  const editor = {
    kind: 'none', monaco: null, ed: null, ta: null, models: {}, changeCb: null, silent: false,
    async init() {
      try { await this.loadMonaco(); this.kind = 'monaco'; }
      catch (_) { this.mountFallback(); this.kind = 'textarea'; }
      this.mountReady = true;
    },
    loadMonaco() {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 8000);
        window.MonacoEnvironment = { getWorkerUrl: () => `data:text/javascript;charset=utf-8,${encodeURIComponent(`self.MonacoEnvironment={baseUrl:'${MONACO_BASE}/'};importScripts('${MONACO_BASE}/base/worker/workerMain.js');`)}` };
        const s = document.createElement('script');
        s.src = `${MONACO_BASE}/loader.js`;
        s.onerror = () => { clearTimeout(timer); reject(new Error('load failed')); };
        s.onload = () => {
          window.require.config({ paths: { vs: MONACO_BASE } });
          window.require(['vs/editor/editor.main'], () => {
            clearTimeout(timer);
            this.monaco = window.monaco;
            this.ed = this.monaco.editor.create($('editor-mount'), { automaticLayout: true, minimap: { enabled: false }, fontSize: 14, scrollBeyondLastLine: false, theme: isDark() ? 'vs-dark' : 'vs', tabSize: 2, wordWrap: 'on' });
            this.ed.onDidChangeModelContent(() => { if (!this.silent && this.changeCb) this.changeCb(this.ed.getValue()); });
            this.ed.addCommand(this.monaco.KeyMod.CtrlCmd | this.monaco.KeyCode.Enter, () => runActive());
            this.ed.addCommand(this.monaco.KeyMod.CtrlCmd | this.monaco.KeyCode.KeyS, () => flashSaved());
            resolve();
          }, reject);
        };
        document.head.appendChild(s);
      });
    },
    mountFallback() {
      const ta = document.createElement('textarea');
      ta.className = 'fallback-editor';
      ta.spellcheck = false;
      ta.setAttribute('aria-label', 'Editor');
      ta.addEventListener('input', () => { if (this.changeCb) this.changeCb(ta.value); });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') { e.preventDefault(); const { selectionStart: a, selectionEnd: b } = ta; ta.setRangeText('  ', a, b, 'end'); ta.dispatchEvent(new Event('input')); }
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runActive(); }
      });
      $('editor-mount').appendChild(ta);
      this.ta = ta;
    },
    show(path) {
      $('empty').classList.toggle('hidden', Boolean(path));
      $('editor-mount').classList.toggle('hidden', !path);
      if (!path) return;
      this.silent = true;
      if (this.kind === 'monaco') {
        let m = this.models[path];
        if (!m) m = this.models[path] = this.monaco.editor.createModel(ws.files[path], langOf(path));
        if (this.ed.getModel() !== m) this.ed.setModel(m);
      } else if (this.ta) {
        this.ta.value = ws.files[path];
      }
      this.silent = false;
    },
    setValue(path, text) {
      this.silent = true;
      if (this.kind === 'monaco' && this.models[path]) this.models[path].setValue(text);
      else if (this.ta && ws.active === path) this.ta.value = text;
      this.silent = false;
    },
    drop(path) { if (this.models[path]) { this.models[path].dispose(); delete this.models[path]; } },
    selection() {
      if (this.kind === 'monaco' && this.ed) { const sel = this.ed.getSelection(); return sel && !sel.isEmpty() ? this.ed.getModel().getValueInRange(sel) : ''; }
      if (this.ta) return this.ta.value.slice(this.ta.selectionStart, this.ta.selectionEnd);
      return '';
    },
    insert(text) {
      if (this.kind === 'monaco' && this.ed) { const sel = this.ed.getSelection(); this.ed.executeEdits('assistant', [{ range: sel, text, forceMoveMarkers: true }]); this.ed.focus(); }
      else if (this.ta) { this.ta.setRangeText(text, this.ta.selectionStart, this.ta.selectionEnd, 'end'); this.ta.dispatchEvent(new Event('input')); this.ta.focus(); }
    },
    applyTheme() { if (this.monaco) this.monaco.editor.setTheme(isDark() ? 'vs-dark' : 'vs'); }
  };

  /* ---------- files, tabs, tree ---------- */
  function openFile(path) {
    if (!(path in ws.files)) return;
    if (!ws.open.includes(path)) ws.open.push(path);
    ws.active = path;
    if (!path.endsWith('.md')) ui.preview = false;
    renderAll();
    save();
  }
  function closeFile(path) {
    if (ui.generating && ui.generating.path === path) return;
    const i = ws.open.indexOf(path);
    if (i < 0) return;
    ws.open.splice(i, 1);
    if (ws.active === path) ws.active = ws.open[Math.max(0, i - 1)] || null;
    renderAll();
    save();
  }
  function uniquePath(p) {
    if (!(p in ws.files)) return p;
    const dot = p.lastIndexOf('.');
    const base = dot > p.lastIndexOf('/') ? p.slice(0, dot) : p;
    const ext = dot > p.lastIndexOf('/') ? p.slice(dot) : '';
    let n = 2;
    while (`${base}-${n}${ext}` in ws.files) n++;
    return `${base}-${n}${ext}`;
  }
  const cleanPath = (p) => p.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.\.+\//g, '').replace(/\/{2,}/g, '/');
  function createFile(path, content = '') {
    path = cleanPath(path);
    if (!path || path.endsWith('/')) return null;
    path = uniquePath(path);
    ws.files[path] = content;
    openFile(path);
    return path;
  }
  function renameFile(from) {
    const to = cleanPath(prompt('Rename file', from) || '');
    if (!to || to === from) return;
    if (to in ws.files) { alert('A file with that name already exists.'); return; }
    ws.files[to] = ws.files[from];
    delete ws.files[from];
    editor.drop(from);
    ws.open = ws.open.map((p) => (p === from ? to : p));
    if (ws.active === from) ws.active = to;
    renderAll();
    save();
  }
  function deleteFile(path) {
    if (ui.generating && ui.generating.path === path) return;
    if (!confirm(`Delete ${path}? This cannot be undone.`)) return;
    delete ws.files[path];
    editor.drop(path);
    ws.open = ws.open.filter((p) => p !== path);
    if (ws.active === path) ws.active = ws.open[0] || null;
    renderAll();
    save();
  }

  function renderTree() {
    const tree = $('tree');
    tree.textContent = '';
    const groups = {};
    Object.keys(ws.files).sort().forEach((p) => { const i = p.lastIndexOf('/'); (groups[i < 0 ? '' : p.slice(0, i)] = groups[i < 0 ? '' : p.slice(0, i)] || []).push(p); });
    Object.keys(groups).sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b))).forEach((dir) => {
      if (dir) { const d = document.createElement('div'); d.className = 'tree-dir'; d.textContent = `▾ ${dir}`; tree.appendChild(d); }
      groups[dir].forEach((p) => {
        const row = document.createElement('div');
        row.className = `tree-item${p === ws.active ? ' active' : ''}`;
        row.setAttribute('role', 'treeitem');
        row.tabIndex = 0;
        if (!dir) row.style.paddingLeft = '12px';
        const name = document.createElement('span'); name.className = 'name'; name.textContent = p.slice(p.lastIndexOf('/') + 1);
        const ops = document.createElement('span'); ops.className = 'ops';
        const rn = document.createElement('button'); rn.textContent = '✎'; rn.title = 'Rename'; rn.setAttribute('aria-label', `Rename ${p}`);
        const del = document.createElement('button'); del.textContent = '🗑'; del.title = 'Delete'; del.setAttribute('aria-label', `Delete ${p}`);
        rn.onclick = (e) => { e.stopPropagation(); renameFile(p); };
        del.onclick = (e) => { e.stopPropagation(); deleteFile(p); };
        ops.append(rn, del);
        row.append(name, ops);
        row.onclick = () => openFile(p);
        row.onkeydown = (e) => { if (e.key === 'Enter') openFile(p); };
        tree.appendChild(row);
      });
    });
  }

  function renderTabs() {
    const tabs = $('tabs');
    tabs.textContent = '';
    ws.open.forEach((p) => {
      const t = document.createElement('div');
      t.className = `tab${p === ws.active ? ' active' : ''}`;
      t.setAttribute('role', 'tab');
      t.title = p;
      const n = document.createElement('span'); n.className = 't-name'; n.textContent = p.slice(p.lastIndexOf('/') + 1);
      const x = document.createElement('button'); x.className = 't-close'; x.textContent = '×'; x.setAttribute('aria-label', `Close ${p}`);
      x.onclick = (e) => { e.stopPropagation(); closeFile(p); };
      t.append(n, x);
      t.onclick = () => openFile(p);
      t.onauxclick = (e) => { if (e.button === 1) closeFile(p); };
      tabs.appendChild(t);
    });
  }

  function renderToolbar() {
    const p = ws.active;
    $('crumbs').textContent = p ? p.split('/').join('  ›  ') : '';
    $('st-file').textContent = p ? `${p} · ${langOf(p)}` : 'No file';
    const md = Boolean(p && p.endsWith('.md'));
    $('btn-preview').classList.toggle('hidden', !md);
    $('btn-preview').textContent = ui.preview ? 'Hide preview' : 'Preview';
    $('btn-run').classList.toggle('hidden', !(p && langOf(p) === 'javascript'));
    $('btn-stop-lecture').classList.toggle('hidden', !ui.generating);
    const showPreview = md && ui.preview;
    $('editor-split').classList.toggle('split', showPreview);
    $('preview-pane').classList.toggle('hidden', !showPreview);
    if (showPreview) $('preview').innerHTML = renderMarkdown(ws.files[p]);
  }

  function renderAll() {
    renderTree(); renderTabs(); renderToolbar();
    editor.show(ws.active);
  }

  let previewTimer = null;
  function onEdit(value) {
    if (!ws.active) return;
    ws.files[ws.active] = value;
    save();
    if (ui.preview && ws.active.endsWith('.md')) {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => { $('preview').innerHTML = renderMarkdown(ws.files[ws.active]); }, 150);
    }
  }
  editor.changeCb = onEdit;

  function flashSaved() { $('st-file').textContent = `${ws.active || ''} · saved`; setTimeout(renderToolbar, 1200); }

  /* ---------- bottom panel + running JS ---------- */
  const panels = { output: $('panel-output'), activity: $('panel-activity') };
  function logTo(name, text, cls) {
    const el = panels[name];
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = text;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }
  function showPanel(name) {
    document.querySelectorAll('.btab').forEach((b) => b.classList.toggle('active', b.dataset.panel === name));
    Object.entries(panels).forEach(([k, el]) => el.classList.toggle('hidden', k !== name));
  }
  document.querySelectorAll('.btab').forEach((b) => { b.onclick = () => showPanel(b.dataset.panel); });
  $('bottom-clear').onclick = () => { const active = document.querySelector('.btab.active').dataset.panel; panels[active].textContent = ''; };

  let worker = null;
  function runActive() {
    const p = ws.active;
    if (!p) return;
    showPanel('output');
    if (langOf(p) !== 'javascript') { logTo('output', `Running ${langOf(p)} needs a code sandbox, which is not configured yet. JavaScript runs in your browser.`, 'err'); return; }
    if (worker) worker.terminate();
    logTo('output', `> ${p}`);
    const src = `
      const fmt = (a) => a.map((x) => { try { return typeof x === 'string' ? x : JSON.stringify(x, null, 2) ?? String(x); } catch (_) { return String(x); } }).join(' ');
      console.log = (...a) => postMessage({ t: 'log', m: fmt(a) });
      console.error = console.warn = (...a) => postMessage({ t: 'err', m: fmt(a) });
      onmessage = async (e) => {
        try { await (0, eval)(e.data); postMessage({ t: 'done' }); }
        catch (err) { postMessage({ t: 'err', m: String(err && err.stack || err) }); postMessage({ t: 'done' }); }
      };`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    worker = new Worker(url);
    const timeout = setTimeout(() => { worker.terminate(); logTo('output', 'Stopped: the program ran longer than 5 seconds.', 'err'); }, 5000);
    worker.onmessage = (e) => {
      if (e.data.t === 'log') logTo('output', e.data.m);
      else if (e.data.t === 'err') logTo('output', e.data.m, 'err');
      else { clearTimeout(timeout); worker.terminate(); URL.revokeObjectURL(url); logTo('output', '(finished)'); }
    };
    worker.onerror = (e) => { clearTimeout(timeout); logTo('output', e.message || 'Worker error', 'err'); };
    worker.postMessage(ws.files[p]);
  }

  /* ---------- AI plumbing ---------- */
  const ai = { configured: false, signedIn: false, models: [], model: store.raw('iacademy-model').replace(/"/g, '') };

  async function* sse(path, body, signal) {
    const res = await fetch(path, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` }, body: JSON.stringify(body) });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      const err = new Error(j.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data:'));
        if (line) yield JSON.parse(line.slice(5));
      }
    }
  }

  function setUsage(u) {
    if (!u) return;
    const cost = u.estimatedCostUsd != null ? ` · ~$${u.estimatedCostUsd}` : '';
    $('st-usage').textContent = `Today: ${(u.totalTokens || 0).toLocaleString()} / ${u.dailyTokenLimit.toLocaleString()} tokens${cost}`;
  }

  async function loadStatus() {
    $('st-ai').textContent = 'AI: checking…';
    if (!token()) { ai.signedIn = false; $('st-ai').textContent = 'AI: sign in required'; return; }
    try {
      const res = await fetch('/api/ai/status', { headers: { Authorization: `Bearer ${token()}` } });
      if (res.status === 401) { ai.signedIn = false; $('st-ai').textContent = 'AI: sign in required'; return; }
      const s = await res.json();
      ai.signedIn = true; ai.configured = s.configured; ai.models = s.models;
      if (!s.models.some((m) => m.id === ai.model)) ai.model = s.defaultModel;
      const sel = $('model-select');
      sel.textContent = '';
      s.models.forEach((m) => sel.add(new Option(m.id, m.id, false, m.id === ai.model)));
      const modeSel = $('chat-mode');
      if (!modeSel.options.length) s.modes.forEach((m) => modeSel.add(new Option(m.label, m.id)));
      $('st-ai').textContent = s.configured ? `AI: ${s.provider} · ${ai.model}` : 'AI: not configured';
      setUsage(s.usage);
    } catch (_) { $('st-ai').textContent = 'AI: server unreachable'; }
  }
  $('model-select').onchange = (e) => { ai.model = e.target.value; try { localStorage.setItem('iacademy-model', ai.model); } catch (_) { /* ignore */ } $('st-ai').textContent = `AI: openai · ${ai.model}`; };

  /** Explains why the AI cannot be used right now; returns true if it can. */
  function aiReady(reportInChat = true) {
    let msg = '';
    if (!token() || !ai.signedIn) msg = 'Sign in to use the assistant.';
    else if (!ai.configured) msg = 'not-configured';
    if (!msg) return true;
    if (reportInChat) {
      if (msg === 'not-configured') addSystem('The OpenAI API key is not set on the server. Copy <code>.env.example</code> to <code>.env</code>, set <code>OPENAI_API_KEY</code>, and restart <code>npm start</code>. The key stays on the server and never reaches this page.');
      else addSystem('Please <a href="/">sign in on the dashboard</a>, then come back here.');
    }
    return false;
  }

  /* ---------- lecture generation ---------- */
  const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'lecture';

  async function generateLecture({ topic, level = 'beginner', depth = 'standard', focus = '' }) {
    if (ui.generating) { logTo('activity', 'A lecture is already being generated. Stop it first.', 'err'); showPanel('activity'); return; }
    if (!aiReady()) { openChat(); return; }
    const path = uniquePath(`lectures/${slug(topic)}.md`);
    ws.files[path] = '';
    ui.preview = true;
    openFile(path);
    const controller = new AbortController();
    ui.generating = { path, controller };
    $('lec-submit').disabled = true;
    setBusy(true);
    renderToolbar();
    logTo('activity', `Lecture started: "${topic}" (${level}, ${depth}) with ${ai.model}`);
    let text = '';
    let raf = 0;
    const flush = () => { raf = 0; ws.files[path] = text; editor.setValue(path, text); if (ws.active === path) $('preview').innerHTML = renderMarkdown(text); };
    try {
      for await (const evt of sse('/api/ai/lecture', { topic, level, depth, focus, model: ai.model }, controller.signal)) {
        if (evt.type === 'delta') { text += evt.text; if (!raf) raf = requestAnimationFrame(flush); }
        else if (evt.type === 'notice') logTo('activity', evt.text);
        else if (evt.type === 'error') throw new Error(evt.error);
        else if (evt.type === 'done') setUsage(evt.usage);
      }
      logTo('activity', `Lecture finished: ${path}`);
    } catch (err) {
      if (err.name === 'AbortError') logTo('activity', 'Lecture stopped. The partial text was kept.');
      else { logTo('activity', `Lecture failed: ${err.message}`, 'err'); addError(err.message); }
    } finally {
      if (raf) cancelAnimationFrame(raf);
      flush();
      ui.generating = null;
      $('lec-submit').disabled = false;
      setBusy(false);
      renderToolbar();
      save();
    }
  }
  $('btn-stop-lecture').onclick = () => ui.generating && ui.generating.controller.abort();
  $('lecture-form').onsubmit = (e) => {
    e.preventDefault();
    generateLecture({ topic: $('lec-topic').value.trim(), level: $('lec-level').value, depth: $('lec-depth').value, focus: $('lec-focus').value.trim() });
  };

  /* ---------- minimized chat assistant ---------- */
  const chat = { messages: store.get(CHAT_KEY, []), controller: null, busy: false };
  const saveChat = () => store.set(CHAT_KEY, chat.messages.slice(-30));

  function setBusy(b) { $('chat-dot').classList.toggle('hidden', !b); }
  function openChat() { $('chat').classList.remove('hidden'); $('chat-launcher').classList.add('hidden'); $('chat-input').focus(); scrollChat(); }
  function minimizeChat() { $('chat').classList.add('hidden'); $('chat-launcher').classList.remove('hidden'); }
  const scrollChat = () => { const b = $('chat-body'); b.scrollTop = b.scrollHeight; };

  function decorateCode(container) {
    container.querySelectorAll('pre').forEach((pre) => {
      if (pre.querySelector('.code-actions')) return;
      const code = pre.querySelector('code') ? pre.querySelector('code').textContent : pre.textContent;
      const bar = document.createElement('span');
      bar.className = 'code-actions';
      const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy';
      copy.onclick = () => { (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(() => { copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1200); }, () => { copy.textContent = 'Copy failed'; }); };
      const ins = document.createElement('button'); ins.type = 'button'; ins.textContent = 'Insert';
      ins.title = 'Insert at the cursor in the open file';
      ins.onclick = () => { if (!ws.active) { createFile('scratch.txt', code); } else editor.insert(code); };
      bar.append(copy, ins);
      pre.appendChild(bar);
    });
  }

  function addMsg(role, content) {
    const el = document.createElement('div');
    el.className = `msg ${role === 'user' ? 'user' : 'bot'}`;
    if (role === 'user') el.textContent = content;
    else { const a = document.createElement('div'); a.className = 'md'; a.innerHTML = renderMarkdown(content); el.appendChild(a); decorateCode(el); }
    $('chat-body').appendChild(el);
    scrollChat();
    return el;
  }
  function addSystem(html) { const el = document.createElement('div'); el.className = 'msg sys'; el.innerHTML = html; $('chat-body').appendChild(el); scrollChat(); }
  function addError(text) { const el = document.createElement('div'); el.className = 'msg err'; el.setAttribute('role', 'alert'); el.textContent = text; $('chat-body').appendChild(el); scrollChat(); }

  function buildContext() {
    if (!$('chat-ctx').checked || !ws.active) return '';
    const sel = editor.selection();
    const body = ws.files[ws.active].slice(0, 12000);
    return `Open file: ${ws.active} (${langOf(ws.active)})\n${sel ? `Selected text:\n${sel.slice(0, 4000)}\n\n` : ''}File content:\n${body}`;
  }

  function setChatBusy(b) {
    chat.busy = b;
    $('chat-send').textContent = b ? 'Stop' : 'Send';
    $('chat-send').type = b ? 'button' : 'submit';
    setBusy(b || Boolean(ui.generating));
  }

  async function sendChat(text) {
    text = text.trim();
    if (!text) return;
    const lec = text.match(/^\/lecture\s+(.+)/i);
    if (lec) { $('chat-input').value = ''; addMsg('user', text); generateLecture({ topic: lec[1].slice(0, 200) }); addSystem('Generating your lecture in the editor. I will keep chatting while it streams.'); return; }
    if (!aiReady()) return;
    addMsg('user', text);
    chat.messages.push({ role: 'user', content: text });
    $('chat-input').value = '';
    autosize();
    const bubble = addMsg('bot', '');
    const md = bubble.querySelector('.md');
    bubble.classList.add('cursor');
    const controller = (chat.controller = new AbortController());
    setChatBusy(true);
    let reply = '';
    let raf = 0;
    const paint = () => { raf = 0; md.innerHTML = renderMarkdown(reply); scrollChat(); };
    try {
      for await (const evt of sse('/api/ai/chat', { messages: chat.messages.slice(-20), mode: $('chat-mode').value, model: ai.model, context: buildContext() }, controller.signal)) {
        if (evt.type === 'delta') { reply += evt.text; if (!raf) raf = requestAnimationFrame(paint); }
        else if (evt.type === 'notice') reply += `\n\n_${evt.text}_`;
        else if (evt.type === 'error') throw new Error(evt.error);
        else if (evt.type === 'done') setUsage(evt.usage);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        if (!reply) bubble.remove();
        addError(err.message);
        logTo('activity', `Chat failed: ${err.message}`, 'err');
        if (err.status === 401) { ai.signedIn = false; $('st-ai').textContent = 'AI: sign in required'; }
        if (!reply) chat.messages.pop();
      }
    } finally {
      if (raf) cancelAnimationFrame(raf);
      bubble.classList.remove('cursor');
      if (reply) { md.innerHTML = renderMarkdown(reply); decorateCode(bubble); chat.messages.push({ role: 'assistant', content: reply }); }
      else if (bubble.isConnected) bubble.remove();
      saveChat();
      chat.controller = null;
      setChatBusy(false);
    }
  }

  function restoreChat() {
    $('chat-body').textContent = '';
    if (!chat.messages.length) addSystem('Hi! I am your AI professor. Ask about the file you have open, or type <code>/lecture &lt;topic&gt;</code> to generate a full lecture.');
    chat.messages.forEach((m) => addMsg(m.role, m.content));
  }

  const autosize = () => { const t = $('chat-input'); t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, 120)}px`; };
  $('chat-input').addEventListener('input', autosize);
  $('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!chat.busy) sendChat($('chat-input').value); } });
  $('chat-form').onsubmit = (e) => { e.preventDefault(); if (!chat.busy) sendChat($('chat-input').value); };
  $('chat-send').addEventListener('click', () => { if (chat.busy && chat.controller) chat.controller.abort(); });
  $('chat-launcher').onclick = openChat;
  $('act-chat').onclick = () => ($('chat').classList.contains('hidden') ? openChat() : minimizeChat());
  $('chat-min').onclick = minimizeChat;
  $('chat-clear').onclick = () => { if (chat.controller) chat.controller.abort(); chat.messages = []; saveChat(); restoreChat(); };
  $('chips').addEventListener('click', (e) => {
    const q = e.target.dataset && e.target.dataset.q;
    if (!q) return;
    if (q.startsWith('/lecture')) { $('chat-input').value = q; $('chat-input').focus(); return; }
    $('chat-ctx').checked = true;
    sendChat(q);
  });

  /* ---------- sidebar views, theme, palette ---------- */
  function showView(name) {
    document.querySelectorAll('.act[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    $('view-explorer').classList.toggle('hidden', name !== 'explorer');
    $('view-lectures').classList.toggle('hidden', name !== 'lectures');
    if (name === 'lectures') $('lec-topic').focus();
  }
  document.querySelectorAll('.act[data-view]').forEach((b) => {
    b.onclick = () => {
      const sb = $('sidebar');
      if (matchMedia('(max-width: 820px)').matches) sb.classList.toggle('open');
      showView(b.dataset.view);
    };
  });
  $('new-file').onclick = () => { const p = prompt('New file path (e.g. lessons/sorting.py)', 'untitled.md'); if (p) createFile(p); };
  $('btn-preview').onclick = () => { ui.preview = !ui.preview; renderToolbar(); };
  $('btn-run').onclick = runActive;

  function setTheme(t) { document.documentElement.dataset.theme = t; try { localStorage.setItem('iacademy-theme', t); } catch (_) { /* ignore */ } editor.applyTheme(); }
  $('theme-toggle').onclick = () => setTheme(isDark() ? 'light' : 'dark');
  try { const t = localStorage.getItem('iacademy-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (_) { /* ignore */ }

  const commands = () => [
    { label: 'New file', run: () => $('new-file').click() },
    { label: 'Generate lecture…', run: () => { showView('lectures'); $('sidebar').classList.add('open'); } },
    { label: 'Open AI assistant', run: openChat },
    { label: 'Minimize AI assistant', run: minimizeChat },
    { label: 'Toggle Markdown preview', run: () => $('btn-preview').click() },
    { label: 'Run current file', run: runActive },
    { label: 'Toggle light/dark theme', run: () => $('theme-toggle').click() },
    { label: 'Go to dashboard', run: () => { location.href = '/'; } },
    ...Object.keys(ws.files).map((p) => ({ label: p, hint: 'file', run: () => openFile(p) }))
  ];
  let palSel = 0; let palItems = [];
  function renderPalette() {
    const q = $('palette-input').value.toLowerCase();
    palItems = commands().filter((c) => c.label.toLowerCase().includes(q)).slice(0, 30);
    palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
    const ul = $('palette-list');
    ul.textContent = '';
    palItems.forEach((c, i) => {
      const li = document.createElement('li');
      li.className = i === palSel ? 'sel' : '';
      const a = document.createElement('span'); a.textContent = c.label;
      const b = document.createElement('span'); b.className = 'muted'; b.textContent = c.hint || '';
      li.append(a, b);
      li.onclick = () => runPalette(c);
      ul.appendChild(li);
    });
  }
  function runPalette(c) { closePalette(); c.run(); }
  function openPalette() { $('palette').classList.remove('hidden'); $('palette-input').value = ''; palSel = 0; renderPalette(); $('palette-input').focus(); }
  function closePalette() { $('palette').classList.add('hidden'); }
  $('palette-open').onclick = openPalette;
  $('palette').addEventListener('mousedown', (e) => { if (e.target === $('palette')) closePalette(); });
  $('palette-input').addEventListener('input', () => { palSel = 0; renderPalette(); });
  $('palette-input').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { palSel = Math.min(palSel + 1, palItems.length - 1); renderPalette(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { palSel = Math.max(palSel - 1, 0); renderPalette(); e.preventDefault(); }
    else if (e.key === 'Enter' && palItems[palSel]) runPalette(palItems[palSel]);
  });
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key.toLowerCase() === 'k' || (e.shiftKey && e.key.toLowerCase() === 'p'))) { e.preventDefault(); openPalette(); }
    else if (mod && e.key.toLowerCase() === 'j') { e.preventDefault(); $('act-chat').click(); }
    else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); flashSaved(); }
    else if (e.key === 'Escape') { if (!$('palette').classList.contains('hidden')) closePalette(); else if (!$('chat').classList.contains('hidden') && document.activeElement && $('chat').contains(document.activeElement)) minimizeChat(); }
  });

  /* ---------- boot ---------- */
  restoreChat();
  renderAll();
  editor.init().then(() => { editor.show(ws.active); }).catch(() => {});
  loadStatus();
})();
