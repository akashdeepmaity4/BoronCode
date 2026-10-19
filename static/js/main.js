document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const activeFile = {
    path: null,
    handle: null,
    handleParent: null,
    name: 'untitled.py',
    ext: 'py',
    dirty: false,
  };

  let monacoEditor = null;
  let isMonacoReady = false;
  let isApplyingEditorContent = false;
  let autoSaveTimeout = null;
  let currentRootDir = null;
  let ctrlKPending = false;

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

  function normalizePath(p) { return p ? p.replace(/\\/g, '/') : null; }

  function setActiveDocument(path, handle, label, parentHandle = null) {
    if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
    autoSaveTimeout = null;
    activeFile.path = path || null;
    activeFile.handle = handle || null;
    activeFile.handleParent = parentHandle || null;
    if (label) {
      activeFile.name = label;
      activeFile.ext = extOf(label);
      if (activeFileNameEl) activeFileNameEl.textContent = label;
    }
    activeFile.dirty = false;
  }

  function triggerAutoSave() {
    if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
    if (!activeFile.path && !activeFile.handle) return;
    autoSaveTimeout = setTimeout(() => {
      autoSaveTimeout = null;
      saveCurrentFile(true);
    }, 1000);
  }

  function downloadText(content, filename) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

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

  function routeUIAction(action, options = {}) {
    if (!action) return;
    switch (action) {
      case 'new-file': handleNewFileShortcut(); break;
      case 'new-folder': newFolderAction(); break;
      case 'open-file': openFilePicker(); break;
      case 'open-folder': openFolderPicker(); break;
      case 'save': saveCurrentFile(); break;
      case 'save-as': triggerSaveAsFile(); break;
      case 'save-copy-as': triggerSaveCopyAsFile(); break;
      case 'run-file': runCurrentFile(); break;
      case 'open-terminal': openTerminalAtActiveTarget(); break;
      case 'toggle-theme': toggleTheme(); break;
      case 'toggle-line-numbers': toggleLineNumbers(); break;
      case 'toggle-preview': toggleMarkdownPreview(); break;
      case 'print-window': window.print(); break;
      case 'close-window': freshWindow(); break;
      case 'exit-app':
        if (window.pywebview && window.pywebview.api && window.pywebview.api.close) window.pywebview.api.close();
        else window.close();
        break;
      case 'undo': document.execCommand('undo'); break;
      case 'redo': document.execCommand('redo'); break;
      case 'cut': document.execCommand('cut'); break;
      case 'copy': document.execCommand('copy'); break;
      case 'paste': document.execCommand('paste'); break;
      case 'select-all':
        if (monacoEditor && isMonacoReady) {
          const model = monacoEditor.getModel();
          if (model) monacoEditor.setSelection(model.getFullModelRange());
        }
        break;
      default:
        if (options.onUnknown) options.onUnknown(action);
    }
  }

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
    const orig = saveFileBtn.style.backgroundColor;
    saveFileBtn.style.backgroundColor = 'var(--success)';
    setTimeout(() => { saveFileBtn.style.backgroundColor = orig; }, 600);
  }

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

  const MONACO_VERSION = '0.45.0';
  const MONACO_CDNS = [
    'https://cdn.jsdelivr.net/npm/monaco-editor@' + MONACO_VERSION + '/min/vs',
    'https://unpkg.com/monaco-editor@' + MONACO_VERSION + '/min/vs',
    'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/' + MONACO_VERSION + '/min/vs'
  ];

  let monacoVsPath = (window.__monacoVsPath) || MONACO_CDNS[0];

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

  function initMonaco() {
    const loaderReady = () => typeof require !== 'undefined' && !!require.config;
    if (loaderReady()) { startMonaco(); return; }

    const deadline = Date.now() + 15000;
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

      monacoEditor.onDidChangeModelContent(() => {
        if (isApplyingEditorContent) return;
        activeFile.dirty = true;
        triggerAutoSave();
      });

      monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveCurrentFile());
      monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS, () => triggerSaveAsFile());
      monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyN, () => handleNewFileShortcut());
      monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyN, () => freshWindow());
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
      isApplyingEditorContent = true;
      monacoEditor.setValue(content || '');
      isApplyingEditorContent = false;
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

  function handleNewFileShortcut() {
    if (actionNewFileBtn) {
      actionNewFileBtn.click();
    } else {
      newBlankFile();
    }
  }

  function newFolderAction() {
    const targetBase = currentRootDir || '.';
    const defaultName = 'new-folder';
    const rawName = window.prompt('Create folder:', defaultName);
    if (rawName === null) {
      showStatus('Folder creation cancelled.', 'warn');
      return;
    }
    const folderName = rawName.trim();
    if (!folderName || /[\\/]/.test(folderName)) {
      showStatus('Folder name is invalid.', 'error');
      return;
    }

    fetch('/create-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: folderName, targetDir: targetBase })
    })
      .then(handleJsonResponse)
      .then((data) => {
        if (data.status === 'success') {
          showStatus('Folder created: ' + data.path, 'success');
          if (window.__refreshWorkspaceTree) window.__refreshWorkspaceTree();
        } else {
          showStatus(data.message || 'Folder creation failed.', 'error');
        }
      })
      .catch((err) => showStatus('Folder creation failed: ' + err, 'error'));
  }

  function newBlankFile() {
    setActiveDocument(null, null, 'untitled.py');
    setEditorContent('', 'untitled.py');
    focusEditor();
    showStatus('New blank file (unsaved)');
  }

  function freshWindow() {
    setActiveDocument(null, null, 'No file open');
    setEditorContent('', 'No file open');
    showStatus('Fresh window initialized');
  }

  async function openFilePicker() {
    if (window.pywebview && window.pywebview.api && window.pywebview.api.open_file_dialog) {
      try {
        const result = await window.pywebview.api.open_file_dialog();
        if (!result) return;
        setActiveDocument(result.path, null, result.name);
        setEditorContent(result.content, result.name);
        showStatus('Opened: ' + result.path);
      } catch (err) { showStatus('Could not open file: ' + err, 'error'); }
      return;
    }
    if (typeof window.showOpenFilePicker === 'function') {
      try {
        const [handle] = await window.showOpenFilePicker({ multiple: false });
        if (!handle) return;
        const file = await handle.getFile();
        setActiveDocument(null, handle, file.name);
        setEditorContent(await file.text(), file.name);
        showStatus('Opened: ' + file.name);
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        console.error('Native file open failed:', err);
        showStatus('Could not open file: ' + err, 'error');
        return;
      }
    }
    if (filePicker) filePicker.click();
  }

  async function openFolderPicker() {
    if (window.pywebview && window.pywebview.api && window.pywebview.api.open_folder_dialog) {
      try {
        const result = await window.pywebview.api.open_folder_dialog();
        if (!result) return;
        currentRootDir = result.name;
        renderTree(result.name, buildDesktopTree(result.tree));
      } catch (err) { showStatus('Could not open folder: ' + err, 'error'); }
      return;
    }
    if (typeof window.showDirectoryPicker === 'function') {
      try {
        const directoryHandle = await window.showDirectoryPicker();
        currentRootDir = directoryHandle.name;
        renderTree(directoryHandle.name, await buildHandleTree(directoryHandle));
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        console.error('Native folder open failed:', err);
        showStatus('Could not open folder: ' + err, 'error');
      }
      return;
    }
    if (folderPicker) folderPicker.click();
  }

  function toggleTheme() {
    const isLight = document.body.classList.toggle('theme-light');
    document.body.classList.toggle('theme-dark', !isLight);
    if (themeStatusText) themeStatusText.textContent = isLight ? 'Enable Dark Mode' : 'Enable Light Mode';
    if (monacoEditor && isMonacoReady) monaco.editor.setTheme(isLight ? 'vs' : 'vs-dark');
  }

  function toggleLineNumbers() {
    if (monacoEditor && isMonacoReady) {
      const opt = monacoEditor.getOption(monaco.editor.EditorOption.lineNumbers);
      const isOff = opt.renderType === 0;
      const next = isOff ? 'on' : 'off';
      monacoEditor.updateOptions({ lineNumbers: next });
      if (linesStatusText) linesStatusText.textContent = next === 'on' ? 'Hide Line Numbers' : 'Show Line Numbers';
    }
  }

  function toggleMarkdownPreview() {
    if (!['md', 'markdown'].includes(extOf(activeFile.name))) {
      showStatus('Markdown preview is only available for Markdown files.', 'warn');
      return;
    }
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${sanitizeInput(activeFile.name)}</title><style>body{font-family:system-ui;padding:2rem;line-height:1.5;color:#111;background:#fff;}pre{background:#f5f5f5;padding:1rem;border-radius:6px;overflow:auto;}code{background:#f3f3f3;padding:0.1rem 0.3rem;border-radius:4px;}</style></head><body>${(getEditorContent() || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</body></html>`;
    const popup = window.open('', '_blank', 'noopener,noreferrer');
    if (!popup) {
      showStatus('Preview blocked by the browser. Allow popups and try again.', 'warn');
      return;
    }
    popup.document.write(html);
    popup.document.close();
  }

  function runCurrentFile() {
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
  }

  function openTerminalAtActiveTarget() {
    fetch('/open-terminal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: getTerminalTargetCwd() })
    })
      .then(res => res.json())
      .then(data => {
        if (data.status !== 'success') alert(`Terminal Error: ${data.message}`);
        else showStatus('Terminal opened with ' + (data.shell || 'default shell') + '.', 'success');
      })
      .catch(err => console.error('Terminal execution error:', err));
  }

  if (filePicker) {
    filePicker.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {

        setActiveDocument(file.path ? normalizePath(file.path) : null, null, file.name);
        setEditorContent(ev.target.result, file.name);
        showStatus(activeFile.path ? ('Opened: ' + activeFile.path) : ('Opened: ' + file.name + ' (unsaved — Save As to write to disk)'));
      };
      reader.readAsText(file);
      filePicker.value = '';
    });
  }

  async function saveCurrentFile(isAutoSave = false) {
    const content = getEditorContent();

    if (activeFile.path && window.pywebview && window.pywebview.api && window.pywebview.api.write_file) {
      try {
        const result = await window.pywebview.api.write_file(activeFile.path, content);
        if (result.status !== 'success') throw new Error(result.message || 'Save failed.');
        activeFile.dirty = false;
        if (!isAutoSave) flashSaveBtn();
        return;
      } catch (err) {
        console.error('Desktop save failed:', err);
        if (!isAutoSave) showStatus('Save failed: ' + err, 'error');
        return;
      }
    }

    if (activeFile.handle) {
      try {
        const writable = await activeFile.handle.createWritable();
        await writable.write(content);
        await writable.close();
        activeFile.dirty = false;
        if (!isAutoSave) flashSaveBtn();
        return;
      } catch (err) {
        console.error('Save via handle failed:', err);
        if (!activeFile.path) {
          if (!isAutoSave) showStatus('Save failed: ' + err, 'error');
          return;
        }
      }
    }

    if (activeFile.path) {
      try {
        const res = await fetch('/save-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: activeFile.path, content })
        });
        const data = await handleJsonResponse(res);
        if (data.status === 'success') {
          if (data.path) activeFile.path = data.path;
          activeFile.dirty = false;
          if (!isAutoSave) flashSaveBtn();
        } else {
          if (isAutoSave) console.error('Autosave failed:', data.message);
          else showStatus('Save failed: ' + data.message, 'error');
        }
      } catch (err) {
        console.error('Save failed:', err);
        if (!isAutoSave) showStatus('Save failed: ' + err, 'error');
      }
      return;
    }

    if (!isAutoSave) triggerSaveAsFile();
  }

  async function triggerSaveAsFile() {
    const previousPath = activeFile.path;
    const previousHandle = activeFile.handle;
    const previousParentHandle = activeFile.handleParent;
    const content = getEditorContent();
    const defaultName = (activeFile.name && activeFile.name !== 'No file open')
      ? activeFile.name : 'untitled.' + (activeFile.ext || 'py');

    if (window.pywebview && window.pywebview.api && window.pywebview.api.save_file_dialog) {
      const destination = await window.pywebview.api.save_file_dialog(defaultName);
      if (!destination) return;
      const result = await window.pywebview.api.write_file(destination, content);
      if (result.status !== 'success') {
        showStatus('Save As failed: ' + result.message, 'error');
        return;
      }
      if (previousPath && previousPath !== destination && window.pywebview.api.delete_file) {
        const removed = await window.pywebview.api.delete_file(previousPath);
        if (removed.status !== 'success') console.warn('Saved new file but could not remove old file:', removed.message);
      }
      setActiveDocument(destination, null, destination.split(/[\\/]/).pop());
      flashSaveBtn();
      showStatus('Saved: ' + destination);
      return;
    }
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: defaultName });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
        if (previousHandle && previousHandle !== handle) {
          try {
            if (typeof previousHandle.remove === 'function') await previousHandle.remove();
            else if (previousParentHandle && previousHandle.name) await previousParentHandle.removeEntry(previousHandle.name);
          } catch (removeErr) { console.warn('Saved new file but could not remove old file:', removeErr); }
        } else if (previousPath) {
          try {
            await fetch('/delete-file', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: previousPath })
            });
          } catch (removeErr) { console.warn('Saved new file but could not remove old file:', removeErr); }
        }
        setActiveDocument(null, handle, handle.name || defaultName);
        flashSaveBtn();
        showStatus('Saved: ' + activeFile.name);
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        console.error('Save As picker failed:', err);
        showStatus('Save picker unavailable; using fallback destination.', 'warn');
      }
    }

    let namePrompt = null;
    try { namePrompt = prompt('Save file as:', defaultName); }
    catch (e) { console.error('prompt() threw:', e); }

    if (namePrompt === null) { showStatus('Save As cancelled (prompt blocked or dismissed).', 'warn'); return }
    if (!namePrompt.trim()) return;

    const cleanName = namePrompt.trim().replace(/\\/g, '/');
    if (!cleanName || cleanName.startsWith('/') || /^[A-Za-z]:/.test(cleanName)
      || cleanName.split('/').some(part => !part || part === '.' || part === '..')) {
      showStatus('Invalid file path.', 'error');
      return;
    }

    const targetPath = currentRootDir ? normalizePath(currentRootDir + '/' + cleanName) : cleanName;

    try {
      const res = await fetch('/save-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath, content, old_path: previousPath })
      });
      const data = await handleJsonResponse(res);
      if (data.status === 'success') {
        let warning = data.warning || '';
        if (previousHandle) {
          try {
            if (typeof previousHandle.remove === 'function') await previousHandle.remove();
            else if (previousParentHandle && previousHandle.name) await previousParentHandle.removeEntry(previousHandle.name);
            else warning = warning || 'New file was saved, but the previous file could not be removed.';
          } catch (removeErr) {
            console.warn('Saved new file but could not remove old file:', removeErr);
            warning = warning || 'New file was saved, but the previous file could not be removed.';
          }
        }
        setActiveDocument(data.path || targetPath, null, cleanName);
        flashSaveBtn();
        if (warning) showStatus(warning, 'warn');
      } else {
        downloadText(content, cleanName);
        showStatus('Backend save failed; downloaded a copy instead: ' + data.message, 'warn');
      }
    } catch (err) {
      console.error('Save As failed:', err);
      showStatus('Save failed: ' + err, 'error');
    }
  }

  async function triggerSaveCopyAsFile() {
    const content = getEditorContent();
    if (window.pywebview && window.pywebview.api && window.pywebview.api.save_file_dialog) {
      const destination = await window.pywebview.api.save_file_dialog('copy_' + (activeFile.name || 'untitled.txt'));
      if (!destination) return;
      const result = await window.pywebview.api.write_file(destination, content);
      if (result.status === 'success') showStatus('Copy saved: ' + destination);
      else showStatus('Save copy failed: ' + result.message, 'error');
      return;
    }
    const defaultName = 'copy_' + (activeFile.name || 'untitled.' + (activeFile.ext || 'py'));
    let namePrompt = null;
    try { namePrompt = prompt('Save copy as:', defaultName); } catch (e) { }
    if (!namePrompt || !namePrompt.trim()) return;
    const cleanName = namePrompt.trim().replace(/[\\/]+/g, '');
    if (!cleanName) { showStatus('Invalid file name.', 'error'); return; }
    downloadText(content, cleanName);
    showStatus('Downloaded copy: ' + cleanName);
  }

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
      routeUIAction(action);
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
      routeUIAction(action);
    });
  }

  // View dropdown router
  if (viewDropdown) {
    viewDropdown.addEventListener('click', (e) => {
      const item = e.target.closest('.dropdown-item');
      if (!item || item.classList.contains('disabled')) return;
      const action = item.dataset.action;
      closeAllDropdowns();
      routeUIAction(action);
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

  function getTerminalTargetCwd() {
    if (activeFile && activeFile.path) {
      const dir = activeFile.path.replace(/\\/g, '/');
      const lastSlash = dir.lastIndexOf('/');
      if (lastSlash > 0) return dir.slice(0, lastSlash);
      return dir.includes(':') ? dir.split(':')[0] + ':' : 'C:/';
    }
    if (currentRootDir) return currentRootDir;
    return 'C:/';
  }

  document.addEventListener('keydown', (e) => {
    const isCtrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    // Ctrl + K chord handling (Ctrl+K -> Ctrl+O)
    if (isCtrl && key === 'k') {
      e.preventDefault();
      ctrlKPending = true;
      setTimeout(() => { ctrlKPending = false; }, 2000);
      return;
    }

    if (ctrlKPending && isCtrl && key === 'o') {
      e.preventDefault();
      ctrlKPending = false;
      openFolderPicker();
      return;
    }
    ctrlKPending = false;

    // Ctrl + Shift + N: New folder
    if (isCtrl && e.shiftKey && key === 'n') {
      e.preventDefault();
      newFolderAction();
      return;
    }

    // Ctrl + N: New file via sidebar button or fallback prompt
    if (isCtrl && !e.shiftKey && key === 'n') {
      e.preventDefault();
      handleNewFileShortcut();
      return;
    }

    // Ctrl + Shift + V: Markdown preview toggle when applicable
    if (isCtrl && e.shiftKey && key === 'v') {
      e.preventDefault();
      toggleMarkdownPreview();
      return;
    }

    // Ctrl + ` : Launch Terminal
    if (isCtrl && (e.key === '`' || e.code === 'Backquote')) {
      e.preventDefault();
      openTerminalAtActiveTarget();
      return;
    }

    // Ctrl + S: Save file
    if (isCtrl && !e.shiftKey && key === 's') {
      e.preventDefault();
      saveCurrentFile();
      return;
    }

    // Ctrl + Shift + S: Save As
    if (isCtrl && e.shiftKey && key === 's') {
      e.preventDefault();
      triggerSaveAsFile();
      return;
    }

    // Alt + Shift + S: Save copy as
    if (e.altKey && e.shiftKey && key === 's') {
      e.preventDefault();
      triggerSaveCopyAsFile();
      return;
    }

    // Ctrl + O: Open single file picker
    if (isCtrl && key === 'o') {
      e.preventDefault();
      openFilePicker();
      return;
    }

    // Ctrl + Z: Undo
    if (isCtrl && !e.shiftKey && key === 'z') {
      e.preventDefault();
      document.execCommand('undo');
      return;
    }

    // Ctrl + Y: Redo
    if (isCtrl && key === 'y') {
      e.preventDefault();
      document.execCommand('redo');
      return;
    }

    // Ctrl + X: Cut
    if (isCtrl && key === 'x') {
      e.preventDefault();
      document.execCommand('cut');
      return;
    }

    // Ctrl + C: Copy
    if (isCtrl && key === 'c') {
      e.preventDefault();
      document.execCommand('copy');
      return;
    }

    // Ctrl + V: Paste
    if (isCtrl && key === 'v') {
      // Standard native canvas paste handling allowed
      return;
    }

    // Ctrl + P: Print window
    if (isCtrl && key === 'p') {
      e.preventDefault();
      window.print();
      return;
    }
  });

  if (saveFileBtn) saveFileBtn.addEventListener('click', () => saveCurrentFile());

  if (runFileBtn) {
    runFileBtn.addEventListener('click', () => routeUIAction('run-file'));
  }

  if (notesToggleBtn) notesToggleBtn.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
  if (logoBtn) logoBtn.addEventListener('click', () => sidebar.classList.remove('collapsed'));
  if (actionNewFileBtn) actionNewFileBtn.addEventListener('click', () => routeUIAction('new-file'));
  if (actionOpenFolderBtn) actionOpenFolderBtn.addEventListener('click', () => routeUIAction('open-folder'));

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

  async function buildHandleTree(directoryHandle, parentHandle = null) {
    const tree = {};
    for await (const [name, handle] of directoryHandle.entries()) {
      if (name === '.git') continue;
      if (handle.kind === 'directory') {
        tree[name] = { __type__: 'dir', children: await buildHandleTree(handle, directoryHandle) };
      } else {
        tree[name] = { __type__: 'file', fileHandle: handle, parentHandle: directoryHandle || parentHandle };
      }
    }
    return tree;
  }

  function buildDesktopTree(source) {
    const tree = {};
    Object.keys(source || {}).forEach(name => {
      const value = source[name];
      if (value && value.__desktop_path__) {
        tree[name] = { __type__: 'file', desktopPath: value.__desktop_path__ };
      } else {
        tree[name] = { __type__: 'dir', children: buildDesktopTree(value) };
      }
    });
    return tree;
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
          if (node.fileHandle) {
            node.fileHandle.getFile().then(file => file.text()).then(content => {
              setActiveDocument(null, node.fileHandle, key, node.parentHandle);
              setEditorContent(content, key);
              showStatus('Opened: ' + key);
            }).catch(err => showStatus('Could not read file: ' + err, 'error'));
            return;
          }
          if (node.desktopPath && window.pywebview && window.pywebview.api && window.pywebview.api.read_file) {
            window.pywebview.api.read_file(node.desktopPath).then(result => {
              if (result.status !== 'success') throw new Error(result.message || 'Could not read file.');
              setActiveDocument(node.desktopPath, null, key);
              setEditorContent(result.content, key);
              showStatus('Opened: ' + node.desktopPath);
            }).catch(err => showStatus('Could not read file: ' + err, 'error'));
            return;
          }
          const reader = new FileReader();
          reader.onload = (ev) => {
            const pathVal = node.fileObj ? (node.fileObj.path || node.fileObj.webkitRelativePath) : null;
            setActiveDocument(pathVal ? normalizePath(pathVal) : null, null, key);
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




  const aiModalBtn = el('aiModalBtn');
  const apiformOverlay = el('apiformOverlay');
  const apiFormCloseBtn = el('apiFormCloseBtn');
  const btnExternalApi = el('btnExternalApi');
  const btnLocalModel = el('btnLocalModel');
  const sectionExternalApi = el('sectionExternalApi');
  const sectionLocalModel = el('sectionLocalModel');
  const apiProviderSelect = el('apiProviderSelect');
  const apiGatewayInput = el('apiGatewayInput');
  const apiModelInput = el('apiModelInput');
  const apiKeyInput = el('apiKeyInput');
  const toggleApiKeyVisBtn = el('toggleApiKeyVisBtn');
  const btnConnectApi = el('btnConnectApi');
  const localModelPathInput = el('localModelPathInput');
  const btnBrowseLocalModel = el('btnBrowseLocalModel');
  const btnLoadLocalModel = el('btnLoadLocalModel');
  const btnEnlightenMe = el('btnEnlightenMe');
  const localSetupToggle = el('localSetupToggle');
  const localSetupGuide = el('localSetupGuide');
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
      const gatewayUrl = sanitizeInput(apiGatewayInput ? apiGatewayInput.value : '');
      const modelName = sanitizeInput(apiModelInput ? apiModelInput.value : '');
      const effectiveProvider = gatewayUrl ? 'Custom' : provider;

      if (!effectiveProvider || (!apiKey && effectiveProvider !== 'Custom')) {
        if (apiFormStatus) { apiFormStatus.className = 'apiform-status error'; apiFormStatus.textContent = 'Please select a provider and enter your API key.'; }
        return;
      }
      if (effectiveProvider === 'Custom' && !gatewayUrl) {
        if (apiFormStatus) { apiFormStatus.className = 'apiform-status error'; apiFormStatus.textContent = 'Please enter a gateway URL for custom API connections.'; }
        return;
      }
      fetch('/api/verify-external-api', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: effectiveProvider, apiKey, gatewayUrl, modelName })
      })
        .then(handleJsonResponse)
        .then(data => {
          if (data.status === 'success') {
            isAiConfigured = true; activeAiProvider = effectiveProvider; activeAiKey = apiKey; activeModelPath = gatewayUrl;
            if (apiFormStatus) { apiFormStatus.className = 'apiform-status success'; apiFormStatus.textContent = data.message; }
            setTimeout(() => {
              if (apiformOverlay) apiformOverlay.classList.add('hidden');
              openAiPopup('\u{1F916} AI Assistant (' + effectiveProvider + ')', 'Connected to ' + effectiveProvider + ' API successfully!');
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

  if (localSetupToggle && localSetupGuide) {
    localSetupToggle.addEventListener('click', () => {
      const expanded = localSetupGuide.classList.toggle('hidden');
      localSetupToggle.setAttribute('aria-expanded', String(!expanded));
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
    const gatewayUrl = sanitizeInput(apiGatewayInput ? apiGatewayInput.value : '');
    const modelName = sanitizeInput(apiModelInput ? apiModelInput.value : '');
    const effectiveProvider = gatewayUrl ? 'Custom' : activeAiProvider;
    fetch('/api/ai-chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        provider: effectiveProvider,
        apiKey: activeAiKey,
        modelPath: activeModelPath,
        gatewayUrl,
        modelName,
        codeContext: getEditorContent()
      })
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

  if (themeStatusText) themeStatusText.textContent = 'Enable Light Mode';
  if (linesStatusText) linesStatusText.textContent = 'Hide Line Numbers';

  console.log('BoronCode: UI initialized. File menu handlers bound.');
});