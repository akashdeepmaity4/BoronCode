/* =========================================================================
   Boron Code — frontend logic
   Monaco-only editor. No contentEditable text canvas.
   ========================================================================= */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  // --------------------------------------------------------------------- //
  // Global active-file state (the single source of truth for the open file)
  // --------------------------------------------------------------------- //
  const activeFile = {
    path: null,        // absolute disk path once saved/loaded from disk; null = unsaved
    handle: null,      // FileSystemFileHandle (browser File System Access API), else null
    name: 'untitled.py',
    ext: 'py',
    dirty: false,
  };

  let monacoEditor = null;
  let isMonacoReady = false;
  let currentRootDir = null;   // opened folder name (browser) or absolute path (pywebview)

  // --------------------------------------------------------------------- //
  // DOM references
  // --------------------------------------------------------------------- //
  const el = (id) => document.getElementById(id);
  const monacoContainer = el('monacoContainer');
  const activeFileNameEl = el('activeFileName');
  const saveFileBtn = el('saveFileBtn');
  const runFileBtn = el('runFileBtn');
  const filePicker = el('filePicker');
  const folderPicker = el('folderPicker');
  const treeView = el('treeView');

  const fileMenuBtn = el('file-menu-btn');
  const fileDropdown = el('file-dropdown');
  const editMenuBtn = el('edit-menu-btn');
  const editDropdown = el('edit-dropdown');
  const viewMenuBtn = el('view-menu-btn');
  const viewDropdown = el('view-dropdown');
  const settingsMenuBtn = el('settings-menu-btn');
  const settingsDropdown = el('settings-dropdown');
  const helpMenuBtn = el('help-menu-btn');
  const helpDropdown = el('help-dropdown');

  const themeStatusText = el('theme-status-text');
  const linesStatusText = el('lines-status-text');
  const fontSettingsToggle = el('font-settings-toggle');
  const fontSettingsPanel = el('font-settings-panel');
  const fontSizeInput = el('fontSizeInput');
  const applyFontSizeBtn = el('applyFontSizeBtn');
  const boldToggle = el('boldToggle');
  const italicToggle = el('italicToggle');

  const sidebar = el('sidebar');
  const notesToggleBtn = el('notesToggleBtn');
  const logoBtn = el('logoBtn');
  const actionNewFileBtn = el('actionNewFileBtn');
  const actionOpenFolderBtn = el('actionOpenFolderBtn');

  const GITHUB_REPO_URL = 'https://github.com/akashdeepmaity4/BoronCode/blob/main';

  // --------------------------------------------------------------------- //
  // Utilities
  // --------------------------------------------------------------------- //
  function normalizePath(p) { return p ? p.replace(/\\/g, '/') : null; }

  function extOf(name) {
    if (!name) return 'py';
    const i = name.lastIndexOf('.');
    return i >= 0 ? name.slice(i + 1).toLowerCase() : 'py';
  }

  async function handleJsonResponse(res) {
    const ct = res ? res.headers.get('content-type') || '' : '';
    if (ct.includes('application/json')) {
      try { return await res.json(); }
      catch (e) { return { status: 'error', message: 'Invalid JSON response from server.' }; }
    }
    const text = res ? await res.text() : '';
    return { status: 'error', message: `Server returned non-JSON (HTTP ${res ? res.status : 'unknown'}): ${text.slice(0, 120)}` };
  }

  function sanitizeInput(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;').replace(/`/g, '&#x60;').trim();
  }

  // Visible, persistent status toast so save/open/new results are observable.
  let toastTimer = null;
  function showStatus(message, kind) {
    let toast = el('vc-status-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'vc-status-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.background = kind === 'error' ? 'var(--danger)'
      : kind === 'warn' ? 'var(--warn)' : 'var(--success)';
    toast.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 2800);
  }

  function flashSaveBtn() {
    if (!saveFileBtn) return;
    const orig = saveFileBtn.style.color;
    saveFileBtn.style.color = 'var(--success)';
    setTimeout(() => { saveFileBtn.style.color = orig; }, 600);
  }

  // Monaco language mapping
  function getMonacoLanguage(ext) {
    const map = {
      js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
      py: 'python', pyw: 'python', html: 'html', htm: 'html', css: 'css',
      scss: 'scss', less: 'less', json: 'json', md: 'markdown', markdown: 'markdown',
      c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', java: 'java',
      sh: 'shell', bash: 'shell', zsh: 'shell', yml: 'yaml', yaml: 'yaml',
      xml: 'xml', sql: 'sql', php: 'php', rb: 'ruby', go: 'go', rs: 'rust',
      cs: 'csharp', bat: 'bat', ps1: 'powershell', ini: 'ini',
      dockerfile: 'dockerfile', txt: 'plaintext'
    };
    return map[(ext || '').toLowerCase().replace(/^\./, '')] || 'plaintext';
  }

  // --------------------------------------------------------------------- //
  // Monaco editor
  // --------------------------------------------------------------------- //
  // CDN candidates for Monaco's AMD loader, tried in order. The first one whose
  // loader.js actually loaded (exposing a working `require`) wins.
  const MONACO_VERSION = '0.45.0';
  const MONACO_CDNS = [
    'https://cdn.jsdelivr.net/npm/monaco-editor@' + MONACO_VERSION + '/min/vs',
    'https://unpkg.com/monaco-editor@' + MONACO_VERSION + '/min/vs',
    'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/' + MONACO_VERSION + '/min/vs'
  ];

  // The active CDN base that successfully provided the loader. index.html's
  // loader-fallback script sets window.__monacoVsPath to whichever CDN won;
  // fall back to the first candidate if it didn't run.
  let monacoVsPath = (window.__monacoVsPath) || MONACO_CDNS[0];

  // Monaco spawns language/web workers. When loaded from a CDN via the AMD
  // loader, cross-origin worker scripts are blocked by the browser, which is
  // the real cause of "Monaco editor failed to load. Check your connection."
  // We proxy every worker through a same-origin blob URL that importScripts
  // the real worker from the CDN. This must be set BEFORE require.config().
  window.MonacoEnvironment = {
    getWorkerUrl: function () {
      const workerProbe = monacoVsPath + '/base/worker/workerMain.js';
      const shim =
        "self.MonacoEnvironment={baseUrl:'" + monacoVsPath + "'};" +
        "importScripts('" + workerProbe + "');";
      const blob = new Blob([shim], { type: 'application/javascript' });
      return URL.createObjectURL(blob);
    }
  };

  // The loader.js script is injected asynchronously by index.html's CDN-
  // fallback IIFE, so `require` is NOT guaranteed to exist yet when
  // DOMContentLoaded fires. initMonaco() must wait for the loader to finish
  // downloading before calling require.config(). We poll for it; if it never
  // appears (all CDNs down), we surface the original error after a timeout.
  function initMonaco() {
    const loaderReady = () => typeof require !== 'undefined' && !!require.config;
    if (loaderReady()) { startMonaco(); return; }

    const deadline = Date.now() + 15000; // 15s for the loader to load from a CDN
    const poll = setInterval(() => {
      if (loaderReady()) {
        clearInterval(poll);
        startMonaco();
      } else if (Date.now() > deadline) {
        clearInterval(poll);
        console.error('BoronCode: Monaco loader (require) not found. CDN blocked?');
        showStatus('Monaco editor failed to load (CDN blocked?).', 'error');
      }
    }, 50);
  }

  function startMonaco() {
    require.config({ paths: { vs: monacoVsPath } });
    require(['vs/editor/editor.main'], function () {
      if (!monacoContainer) return;
      const isLight = document.body.classList.contains('theme-light');

      monacoEditor = monaco.editor.create(monacoContainer, {
        value: '',
        language: 'python',
        theme: isLight ? 'vs' : 'vs-dark',
        automaticLayout: true,
        fontSize: 14,
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        renderWhitespace: 'selection',
        lineNumbers: 'on',
        tabSize: 4,
        insertSpaces: true,
        fontFamily: "'Consolas', 'Courier New', monospace"
      });
      isMonacoReady = true;
      console.log('BoronCode: Monaco editor ready.');

      monacoEditor.onDidChangeModelContent(() => { activeFile.dirty = true; });

      // In-editor keyboard shortcuts
      monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveCurrentFile());
      monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS, () => saveAsFile());
      monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyN, () => newBlankFile());
      monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyO, () => openFilePicker());
    }, function (err) {
      console.error('BoronCode: Monaco failed to load:', err);
      showStatus('Monaco editor failed to load. Check your connection.', 'error');
    });
  }

  function setEditorContent(content, name) {
    activeFile.name = name || activeFile.name;
    activeFile.ext = extOf(activeFile.name);
    if (monacoEditor && isMonacoReady) {
      monacoEditor.setValue(content || '');
      const model = monacoEditor.getModel();
      if (model) monaco.editor.setModelLanguage(model, getMonacoLanguage(activeFile.ext));
    }
    if (activeFileNameEl) activeFileNameEl.textContent = activeFile.name;
  }

  function getEditorContent() {
    return (monacoEditor && isMonacoReady) ? monacoEditor.getValue() : '';
  }

  function focusEditor() {
    if (monacoEditor && isMonacoReady) monacoEditor.focus();
  }

  initMonaco();

  // --------------------------------------------------------------------- //
  // File menu handlers
  // --------------------------------------------------------------------- //

  // new-file (Ctrl+N): clear editor to an unsaved blank file. No prompt, no disk write.
  function newBlankFile() {
    activeFile.path = null;
    activeFile.handle = null;
    activeFile.name = 'untitled.py';
    activeFile.ext = 'py';
    activeFile.dirty = false;
    setEditorContent('', 'untitled.py');
    focusEditor();
    showStatus('New blank file (unsaved)');
  }

  // open-file (Ctrl+O): trigger the OS file picker and load the chosen file.
  function openFilePicker() {
    if (filePicker) filePicker.click();
  }

  if (filePicker) {
    filePicker.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        // Browsers don't expose absolute disk paths; file.path is undefined
        // outside pywebview/Electron. Keep path null so Ctrl+S prompts Save As.
        activeFile.path = file.path ? normalizePath(file.path) : null;
        activeFile.handle = null;
        activeFile.name = file.name;
        activeFile.ext = extOf(file.name);
        activeFile.dirty = false;
        setEditorContent(ev.target.result, file.name);
        showStatus(activeFile.path ? ('Opened: ' + activeFile.path) : ('Opened: ' + file.name + ' (unsaved — Save As to write to disk)'));
      };
      reader.readAsText(file);
      filePicker.value = '';
    });
  }

  // save (Ctrl+S): overwrite the active file in place if it has a path/handle.
  // Bypass the prompt unless the file is untitled (then fall through to Save As).
  async function saveCurrentFile() {
    const content = getEditorContent();

    // 1. File System Access API handle (browser mode with granted handle)
    if (activeFile.handle) {
      try {
        const writable = await activeFile.handle.createWritable();
        await writable.write(content);
        await writable.close();
        activeFile.dirty = false;
        flashSaveBtn();
        showStatus('Saved: ' + activeFile.name);
        return;
      } catch (err) {
        console.error('Save via handle failed:', err);
        showStatus('Save failed: ' + err, 'error');
        return;
      }
    }

    // 2. Backend save by absolute path (pywebview or localhost server)
    if (activeFile.path) {
      try {
        const res = await fetch('/save-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: activeFile.path, content })
        });
        const data = await handleJsonResponse(res);
        if (data.status === 'success') {
          if (data.path) activeFile.path = data.path; // backend may anchor/normalize
          activeFile.dirty = false;
          flashSaveBtn();
          showStatus('Saved: ' + activeFile.path);
        } else {
          showStatus('Save failed: ' + data.message, 'error');
        }
      } catch (err) {
        console.error('Save failed:', err);
        showStatus('Save failed: ' + err, 'error');
      }
      return;
    }

    // 3. Untitled: prompt for a name via Save As
    saveAsFile();
  }

  // save-as (Ctrl+Shift+S): prompt() for a filename, save directly to the
  // workspace root directory without nested paths.
  async function saveAsFile() {
    const content = getEditorContent();
    const defaultName = (activeFile.name && activeFile.name !== 'No file open')
      ? activeFile.name : 'untitled.' + activeFile.ext;

    let namePrompt = null;
    try { namePrompt = prompt('Save file as:', defaultName); }
    catch (e) { console.error('prompt() threw:', e); }

    if (namePrompt === null) { showStatus('Save As cancelled (prompt blocked or dismissed).', 'warn'); return }
    if (!namePrompt.trim()) return;

    // Flatten: strip any directory separators so the name is root-level only.
    const cleanName = namePrompt.trim().replace(/[\\/]+/g, '');
    if (!cleanName) { showStatus('Invalid file name.', 'error'); return; }

    // Send a bare name; the backend anchors it to the workspace root. If a
    // folder is open (currentRootDir), prefer that as the root.
    const targetPath = currentRootDir ? normalizePath(currentRootDir + '/' + cleanName) : cleanName;

    try {
      const res = await fetch('/save-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath, content })
      });
      const data = await handleJsonResponse(res);
      if (data.status === 'success') {
        activeFile.path = data.path || targetPath;   // store absolute path for later Ctrl+S
        activeFile.handle = null;
        activeFile.name = cleanName;
        activeFile.ext = extOf(cleanName);
        activeFile.dirty = false;
        if (activeFileNameEl) activeFileNameEl.textContent = cleanName;
        flashSaveBtn();
        showStatus('Saved: ' + activeFile.path);
      } else {
        showStatus('Save failed: ' + data.message, 'error');
      }
    } catch (err) {
      console.error('Save As failed:', err);
      showStatus('Save failed: ' + err, 'error');
    }
  }

  // save-copy-as (Alt+Shift+S): save a copy without changing the active file.
  async function saveCopyAsFile() {
    const content = getEditorContent();
    const defaultName = 'copy_' + (activeFile.name || 'untitled.' + activeFile.ext);
    let namePrompt = null;
    try { namePrompt = prompt('Save copy as:', defaultName); } catch (e) { }
    if (!namePrompt || !namePrompt.trim()) return;
    const cleanName = namePrompt.trim().replace(/[\\/]+/g, '');
    if (!cleanName) { showStatus('Invalid file name.', 'error'); return; }
    const targetPath = currentRootDir ? normalizePath(currentRootDir + '/' + cleanName) : cleanName;
    try {
      const res = await fetch('/save-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath, content })
      });
      const data = await handleJsonResponse(res);
      if (data.status === 'success') showStatus('Copy saved: ' + (data.path || targetPath));
      else showStatus('Save copy failed: ' + data.message, 'error');
    } catch (err) {
      showStatus('Save copy failed: ' + err, 'error');
    }
  }

  // --------------------------------------------------------------------- //
  // Dropdown menus
  // --------------------------------------------------------------------- //
  function closeAllDropdowns() {
    document.querySelectorAll('.app-dropdown-menu').forEach(m => m.classList.add('hidden'));
    document.querySelectorAll('.menu-dropdown-container').forEach(c => c.classList.remove('active'));
    if (fontSettingsPanel) fontSettingsPanel.classList.add('hidden');
  }

  function bindMenuToggle(btn, dropdown) {
    if (!btn || !dropdown) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasHidden = dropdown.classList.contains('hidden');
      closeAllDropdowns();
      if (wasHidden) {
        dropdown.classList.remove('hidden');
        btn.closest('.menu-dropdown-container')?.classList.add('active');
      }
    });
  }

  bindMenuToggle(fileMenuBtn, fileDropdown);
  bindMenuToggle(editMenuBtn, editDropdown);
  bindMenuToggle(viewMenuBtn, viewDropdown);
  bindMenuToggle(settingsMenuBtn, settingsDropdown);
  bindMenuToggle(helpMenuBtn, helpDropdown);
  document.addEventListener('click', () => closeAllDropdowns());

  // File dropdown router
  if (fileDropdown) {
    fileDropdown.addEventListener('click', (e) => {
      const item = e.target.closest('.dropdown-item');
      if (!item || item.classList.contains('disabled')) return;
      const action = item.dataset.action;
      closeAllDropdowns();
      switch (action) {
        case 'new-file': newBlankFile(); break;
        case 'open-file': openFilePicker(); break;
        case 'save': saveCurrentFile(); break;
        case 'save-as': saveAsFile(); break;
        case 'save-copy-as': saveCopyAsFile(); break;
        case 'print-window': window.print(); break;
        case 'close-window': newBlankFile(); break;
        case 'exit-app':
          if (window.pywebview && window.pywebview.api && window.pywebview.api.close) window.pywebview.api.close();
          else window.close();
          break;
      }
    });
  }

  // Edit dropdown router
  if (editDropdown) {
    editDropdown.addEventListener('click', async (e) => {
      const item = e.target.closest('.dropdown-item');
      if (!item || item.classList.contains('disabled')) return;
      const action = item.dataset.action;
      closeAllDropdowns();
      focusEditor();
      if (!monacoEditor || !isMonacoReady) return;
      switch (action) {
        case 'undo': monacoEditor.trigger('menu', 'undo', null); break;
        case 'redo': monacoEditor.trigger('menu', 'redo', null); break;
        case 'cut': document.execCommand('cut'); break;
        case 'copy': document.execCommand('copy'); break;
        case 'paste':
          try {
            const text = await navigator.clipboard.readText();
            const sel = monacoEditor.getSelection();
            monacoEditor.executeEdits('paste', [{ range: sel, text, forceMoveMarkers: true }]);
          } catch (err) { document.execCommand('paste'); }
          break;
        case 'select-all':
          const model = monacoEditor.getModel();
          if (model) monacoEditor.setSelection(model.getFullModelRange());
          break;
      }
    });
  }

  // View dropdown router
  if (viewDropdown) {
    viewDropdown.addEventListener('click', (e) => {
      const item = e.target.closest('.dropdown-item');
      if (!item || item.classList.contains('disabled')) return;
      const action = item.dataset.action;
      closeAllDropdowns();
      switch (action) {
        case 'toggle-theme':
          const isLight = document.body.classList.toggle('theme-light');
          document.body.classList.toggle('theme-dark', !isLight);
          if (themeStatusText) themeStatusText.textContent = isLight ? 'Enable Dark Mode' : 'Enable Light Mode';
          if (monacoEditor && isMonacoReady) monaco.editor.setTheme(isLight ? 'vs' : 'vs-dark');
          break;
        case 'toggle-line-numbers':
          if (monacoEditor && isMonacoReady) {
            const opt = monacoEditor.getOption(monaco.editor.EditorOption.lineNumbers);
            const isOff = opt.renderType === 0;
            const next = isOff ? 'on' : 'off';
            monacoEditor.updateOptions({ lineNumbers: next });
            if (linesStatusText) linesStatusText.textContent = next === 'on' ? 'Hide Line Numbers' : 'Show Line Numbers';
          }
          break;
      }
    });
  }

  // Help dropdown router
  if (helpDropdown) {
    helpDropdown.addEventListener('click', (e) => {
      const item = e.target.closest('.dropdown-item');
      if (!item || item.classList.contains('disabled')) return;
      const action = item.dataset.action;
      closeAllDropdowns();
      const urls = {
        'setup-usage': GITHUB_REPO_URL + '/setupandusage.md',
        'license': GITHUB_REPO_URL + '/LICENSE',
        'faqs': GITHUB_REPO_URL + '/FAQs.md'
      };
      const url = urls[action];
      if (!url) return;
      if (window.pywebview && window.pywebview.api && window.pywebview.api.open_external_url) window.pywebview.api.open_external_url(url);
      else window.open(url, '_blank', 'noopener,noreferrer');
    });
  }

  // Settings subpanel
  if (fontSettingsPanel) fontSettingsPanel.addEventListener('click', (e) => e.stopPropagation());
  if (fontSettingsToggle && fontSettingsPanel) {
    fontSettingsToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      fontSettingsPanel.classList.toggle('hidden');
    });
  }
  if (applyFontSizeBtn && fontSizeInput) {
    applyFontSizeBtn.addEventListener('click', () => {
      const size = parseInt(fontSizeInput.value, 10);
      if (size >= 8 && size <= 72 && monacoEditor && isMonacoReady) monacoEditor.updateOptions({ fontSize: size });
    });
  }
  if (boldToggle) boldToggle.addEventListener('change', (e) => {
    if (monacoEditor && isMonacoReady) monacoEditor.updateOptions({ fontWeight: e.target.checked ? 'bold' : 'normal' });
  });

  // --------------------------------------------------------------------- //
  // Keyboard shortcuts (document-level; also fire when focus is outside Monaco)
  // --------------------------------------------------------------------- //
  document.addEventListener('keydown', (e) => {
    const isCtrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (e.altKey && e.shiftKey && key === 's') { e.preventDefault(); saveCopyAsFile(); return; }
    if (isCtrl && key === 'p') { e.preventDefault(); window.print(); return; }
    if (isCtrl && e.shiftKey && key === 's') { e.preventDefault(); saveAsFile(); return; }
    if (isCtrl && !e.shiftKey && key === 's') { e.preventDefault(); saveCurrentFile(); return; }
    if (isCtrl && !e.shiftKey && key === 'n') { e.preventDefault(); newBlankFile(); return; }
    if (isCtrl && key === 'o') { e.preventDefault(); openFilePicker(); return; }
    if (isCtrl && (e.key === '`' || e.code === 'Backquote')) {
      e.preventDefault();
      fetch('/open-terminal', { method: 'POST' }).then(handleJsonResponse)
        .then(d => { if (d.status !== 'success') showStatus('Terminal error: ' + d.message, 'error'); })
        .catch(err => showStatus('Terminal error: ' + err, 'error'));
      return;
    }
  });

  // --------------------------------------------------------------------- //
  // Toolbar buttons
  // --------------------------------------------------------------------- //
  if (saveFileBtn) saveFileBtn.addEventListener('click', () => saveCurrentFile());

  if (runFileBtn) {
    runFileBtn.addEventListener('click', () => {
      if (!activeFile.path) { showStatus('No saved disk file active to run.', 'warn'); return; }
      fetch('/run-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: activeFile.path })
      })
        .then(handleJsonResponse)
        .then(data => {
          if (data.status === 'error') showStatus('Execution error: ' + data.message, 'error');
          else alert(data.stdout || data.stderr || 'Execution completed with no output.');
        })
        .catch(err => showStatus('Run failed: ' + err, 'error'));
    });
  }

  // --------------------------------------------------------------------- //
  // Sidebar
  // --------------------------------------------------------------------- //
  if (notesToggleBtn) notesToggleBtn.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
  if (logoBtn) logoBtn.addEventListener('click', () => sidebar.classList.remove('collapsed'));
  if (actionNewFileBtn) actionNewFileBtn.addEventListener('click', () => newBlankFile());
  if (actionOpenFolderBtn) actionOpenFolderBtn.addEventListener('click', () => { if (folderPicker) folderPicker.click(); });

  // Folder picker -> build tree
  if (folderPicker) {
    folderPicker.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      const rootName = normalizePath(files[0].webkitRelativePath).split('/')[0];
      currentRootDir = rootName;
      const tree = {};
      files.forEach(file => {
        const rel = normalizePath(file.webkitRelativePath);
        if (rel.includes('/.git/') || rel.startsWith('.git/')) return;
        const parts = rel.split('/'); parts.shift();
        let cur = tree;
        parts.forEach((part, i) => {
          if (i === parts.length - 1) cur[part] = { __type__: 'file', fileObj: file };
          else { if (!cur[part]) cur[part] = { __type__: 'dir', children: {} }; cur = cur[part].children; }
        });
      });
      renderTree(rootName, tree);
      folderPicker.value = '';
    });
  }

  function renderTree(rootName, treeData) {
    if (!treeView) return;
    treeView.replaceChildren();
    const root = document.createElement('button');
    root.className = 'tree-folder';
    root.textContent = '^ ' + rootName;
    treeView.appendChild(root);
    treeView.appendChild(buildTreeNodes(treeData));
  }

  function buildTreeNodes(nodeObj) {
    const container = document.createElement('div');
    Object.keys(nodeObj).forEach(key => {
      const node = nodeObj[key];
      if (node.__type__ === 'file') {
        const btn = document.createElement('button');
        btn.className = 'tree-file';
        btn.textContent = '\u{1F4C4} ' + key;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const reader = new FileReader();
          reader.onload = (ev) => {
            const pathVal = node.fileObj ? (node.fileObj.path || node.fileObj.webkitRelativePath) : null;
            activeFile.path = pathVal ? normalizePath(pathVal) : null;
            activeFile.handle = null;
            activeFile.name = key;
            activeFile.ext = extOf(key);
            activeFile.dirty = false;
            setEditorContent(ev.target.result, key);
            showStatus('Opened: ' + (activeFile.path || key));
          };
          reader.readAsText(node.fileObj);
        });
        container.appendChild(btn);
      } else if (node.__type__ === 'dir') {
        const fb = document.createElement('button');
        fb.className = 'tree-folder';
        fb.textContent = '^ ' + key;
        const kids = buildTreeNodes(node.children);
        kids.style.display = 'block';
        fb.addEventListener('click', (e) => {
          e.stopPropagation();
          const hidden = kids.style.display === 'none';
          kids.style.display = hidden ? 'block' : 'none';
          fb.textContent = (hidden ? '^' : 'v') + ' ' + key;
        });
        container.appendChild(fb);
        container.appendChild(kids);
      }
    });
    return container;
  }

  // --------------------------------------------------------------------- //
  // AI Hub (apiform.html) & floating popup
  // --------------------------------------------------------------------- //
  const aiModalBtn = el('aiModalBtn');
  const apiformOverlay = el('apiformOverlay');
  const apiFormCloseBtn = el('apiFormCloseBtn');
  const btnExternalApi = el('btnExternalApi');
  const btnLocalModel = el('btnLocalModel');
  const sectionExternalApi = el('sectionExternalApi');
  const sectionLocalModel = el('sectionLocalModel');
  const apiProviderSelect = el('apiProviderSelect');
  const apiKeyInput = el('apiKeyInput');
  const toggleApiKeyVisBtn = el('toggleApiKeyVisBtn');
  const btnConnectApi = el('btnConnectApi');
  const localModelPathInput = el('localModelPathInput');
  const btnBrowseLocalModel = el('btnBrowseLocalModel');
  const btnLoadLocalModel = el('btnLoadLocalModel');
  const btnEnlightenMe = el('btnEnlightenMe');
  const folderPickerLocal = el('folderPickerLocal');
  const enlightenResultsArea = el('enlightenResultsArea');
  const foundModelsSelect = el('foundModelsSelect');
  const btnUseFoundModel = el('btnUseFoundModel');
  const apiFormStatus = el('apiFormStatus');

  const aiFloatingPopup = el('aiFloatingPopup');
  const aiPopupHeader = el('aiPopupHeader');
  const aiPopupTitle = el('aiPopupTitle');
  const aiPopupCloseBtn = el('aiPopupCloseBtn');
  const aiPopupConfigBtn = el('aiPopupConfigBtn');
  const aiPopupBody = el('aiPopupBody');
  const aiPopupInput = el('aiPopupInput');
  const aiPopupSendBtn = el('aiPopupSendBtn');

  let isAiConfigured = false;
  let activeAiProvider = 'AI Assistant';
  let activeAiKey = '';
  let activeModelPath = '';

  if (aiModalBtn) {
    aiModalBtn.addEventListener('click', (e) => {
      if (e.shiftKey) { if (apiformOverlay) apiformOverlay.classList.remove('hidden'); return; }
      if (isAiConfigured && aiFloatingPopup) {
        if (aiFloatingPopup.classList.contains('hidden')) aiFloatingPopup.classList.remove('hidden');
        else if (apiformOverlay) apiformOverlay.classList.remove('hidden');
      } else if (apiformOverlay) {
        apiformOverlay.classList.remove('hidden');
      }
    });
  }
  if (apiFormCloseBtn && apiformOverlay) apiFormCloseBtn.addEventListener('click', () => apiformOverlay.classList.add('hidden'));
  if (aiPopupConfigBtn && apiformOverlay) aiPopupConfigBtn.addEventListener('click', () => apiformOverlay.classList.remove('hidden'));
  if (aiPopupCloseBtn && aiFloatingPopup) aiPopupCloseBtn.addEventListener('click', () => aiFloatingPopup.classList.add('hidden'));

  if (btnExternalApi && btnLocalModel) {
    btnExternalApi.addEventListener('click', () => {
      btnExternalApi.classList.add('active'); btnLocalModel.classList.remove('active');
      if (sectionExternalApi) sectionExternalApi.classList.remove('hidden');
      if (sectionLocalModel) sectionLocalModel.classList.add('hidden');
    });
    btnLocalModel.addEventListener('click', () => {
      btnLocalModel.classList.add('active'); btnExternalApi.classList.remove('active');
      if (sectionLocalModel) sectionLocalModel.classList.remove('hidden');
      if (sectionExternalApi) sectionExternalApi.classList.add('hidden');
    });
  }

  if (toggleApiKeyVisBtn && apiKeyInput) {
    toggleApiKeyVisBtn.addEventListener('click', () => {
      if (apiKeyInput.type === 'password') { apiKeyInput.type = 'text'; toggleApiKeyVisBtn.textContent = 'Hide'; }
      else { apiKeyInput.type = 'password'; toggleApiKeyVisBtn.textContent = 'Show'; }
    });
  }

  if (btnConnectApi) {
    btnConnectApi.addEventListener('click', () => {
      const provider = sanitizeInput(apiProviderSelect ? apiProviderSelect.value : '');
      const apiKey = sanitizeInput(apiKeyInput ? apiKeyInput.value : '');
      if (!provider || !apiKey) {
        if (apiFormStatus) { apiFormStatus.className = 'apiform-status error'; apiFormStatus.textContent = 'Please select a provider and enter your API key.'; }
        return;
      }
      fetch('/api/verify-external-api', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey })
      })
        .then(handleJsonResponse)
        .then(data => {
          if (data.status === 'success') {
            isAiConfigured = true; activeAiProvider = provider; activeAiKey = apiKey;
            if (apiFormStatus) { apiFormStatus.className = 'apiform-status success'; apiFormStatus.textContent = data.message; }
            setTimeout(() => {
              if (apiformOverlay) apiformOverlay.classList.add('hidden');
              openAiPopup('\u{1F916} AI Assistant (' + provider + ')', 'Connected to ' + provider + ' API successfully!');
            }, 400);
          } else if (apiFormStatus) {
            apiFormStatus.className = 'apiform-status error'; apiFormStatus.textContent = data.message || 'API connection failed.';
          }
        })
        .catch(err => { if (apiFormStatus) { apiFormStatus.className = 'apiform-status error'; apiFormStatus.textContent = 'Connection error: ' + err; } });
    });
  }

  if (btnBrowseLocalModel && localModelPathInput) {
    btnBrowseLocalModel.addEventListener('click', () => {
      const p = prompt('Enter or paste local model file path:');
      if (p) localModelPathInput.value = sanitizeInput(p);
    });
  }

  if (btnLoadLocalModel) {
    btnLoadLocalModel.addEventListener('click', () => {
      const modelPath = sanitizeInput(localModelPathInput ? localModelPathInput.value : '');
      if (!modelPath) {
        if (apiFormStatus) { apiFormStatus.className = 'apiform-status error'; apiFormStatus.textContent = 'Please enter a local model file path.'; }
        return;
      }
      fetch('/api/verify-local-model', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelPath })
      })
        .then(handleJsonResponse)
        .then(data => {
          if (data.status === 'success' || data.status === 'warning') {
            isAiConfigured = true; activeAiProvider = 'Local (' + data.modelName + ')'; activeModelPath = data.modelPath;
            if (apiFormStatus) { apiFormStatus.className = 'apiform-status success'; apiFormStatus.textContent = data.message; }
            setTimeout(() => {
              if (apiformOverlay) apiformOverlay.classList.add('hidden');
              openAiPopup('\u{1F916} Local Model (' + data.modelName + ')', 'Loaded local model: ' + data.modelPath);
            }, 400);
          } else if (apiFormStatus) {
            apiFormStatus.className = 'apiform-status error'; apiFormStatus.textContent = data.message || 'Model loading failed.';
          }
        })
        .catch(err => { if (apiFormStatus) { apiFormStatus.className = 'apiform-status error'; apiFormStatus.textContent = 'Model verification error: ' + err; } });
    });
  }

  if (btnEnlightenMe && folderPickerLocal) {
    btnEnlightenMe.addEventListener('click', () => {
      alert('Enlighten Me: select folder(s) to search for local AI model files (.gguf, .bin, .safetensors, .onnx, .pth, .pt).');
      folderPickerLocal.click();
    });
    folderPickerLocal.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      const filePaths = files.map(f => f.webkitRelativePath || f.name);
      fetch('/api/search-local-models', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: filePaths })
      })
        .then(handleJsonResponse)
        .then(data => {
          if (data.status === 'success' && data.models && data.models.length) {
            if (foundModelsSelect) {
              foundModelsSelect.innerHTML = '';
              data.models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m; opt.textContent = m;
                foundModelsSelect.appendChild(opt);
              });
            }
            if (enlightenResultsArea) enlightenResultsArea.classList.remove('hidden');
            if (apiFormStatus) { apiFormStatus.className = 'apiform-status success'; apiFormStatus.textContent = 'Found ' + data.models.length + ' model file(s)!'; }
          } else {
            if (apiFormStatus) { apiFormStatus.className = 'apiform-status error'; apiFormStatus.textContent = 'No local model files found in selected folders.'; }
          }
        });
    });
  }

  if (btnUseFoundModel && foundModelsSelect && localModelPathInput) {
    btnUseFoundModel.addEventListener('click', () => {
      const m = foundModelsSelect.value;
      if (m) { localModelPathInput.value = sanitizeInput(m); if (btnLoadLocalModel) btnLoadLocalModel.click(); }
    });
  }

  function openAiPopup(title, sysMsg) {
    if (!aiFloatingPopup) return;
    if (aiPopupTitle) aiPopupTitle.textContent = title;
    if (aiPopupBody) aiPopupBody.innerHTML = '<div class="ai-popup-msg system">' + sanitizeInput(sysMsg) + '</div>';
    aiFloatingPopup.classList.remove('hidden');
  }

  // Drag the floating popup
  if (aiPopupHeader && aiFloatingPopup) {
    let dragging = false, ox = 0, oy = 0;
    aiPopupHeader.addEventListener('mousedown', (e) => {
      dragging = true; ox = e.clientX - aiFloatingPopup.offsetLeft; oy = e.clientY - aiFloatingPopup.offsetTop;
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      aiFloatingPopup.style.left = (e.clientX - ox) + 'px';
      aiFloatingPopup.style.top = (e.clientY - oy) + 'px';
      aiFloatingPopup.style.bottom = 'auto'; aiFloatingPopup.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => { dragging = false; });
  }

  function sendAiPrompt() {
    if (!aiPopupInput) return;
    const prompt = sanitizeInput(aiPopupInput.value);
    if (!prompt) return;
    aiPopupInput.value = '';
    if (aiPopupBody) {
      const m = document.createElement('div');
      m.className = 'ai-popup-msg user'; m.textContent = prompt;
      aiPopupBody.appendChild(m); aiPopupBody.scrollTop = aiPopupBody.scrollHeight;
    }
    fetch('/api/ai-chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, provider: activeAiProvider, apiKey: activeAiKey, modelPath: activeModelPath, codeContext: getEditorContent() })
    })
      .then(handleJsonResponse)
      .then(data => {
        if (aiPopupBody) {
          const m = document.createElement('div');
          m.className = 'ai-popup-msg assistant'; m.textContent = data.reply || 'Request completed.';
          aiPopupBody.appendChild(m); aiPopupBody.scrollTop = aiPopupBody.scrollHeight;
        }
      })
      .catch(err => {
        if (aiPopupBody) {
          const m = document.createElement('div');
          m.className = 'ai-popup-msg system'; m.textContent = 'Error: ' + err;
          aiPopupBody.appendChild(m); aiPopupBody.scrollTop = aiPopupBody.scrollHeight;
        }
      });
  }

  if (aiPopupSendBtn) aiPopupSendBtn.addEventListener('click', sendAiPrompt);
  if (aiPopupInput) aiPopupInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendAiPrompt(); }
  });

  // Set default view-menu labels
  if (themeStatusText) themeStatusText.textContent = 'Enable Light Mode';
  if (linesStatusText) linesStatusText.textContent = 'Hide Line Numbers';

  console.log('BoronCode: UI initialized. File menu handlers bound.');
});
