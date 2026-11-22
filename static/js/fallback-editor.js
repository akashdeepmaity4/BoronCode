function loadPrismBundle(src) {
  if (window.Prism && window.Prism.highlightElement) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not load the local Prism bundle.'));
    document.head.appendChild(script);
  });
}

function makeEditorAdapter(element, jar, languageMap, initialLanguageId, highlighted) {
  let languageId = initialLanguageId || 'plaintext';

  function useLanguage() {
    const prismLanguage = languageMap[languageId] || null;
    element.className = 'codejar-editor' + (prismLanguage ? ' language-' + prismLanguage : '');
    return prismLanguage;
  }

  return {
    element,
    isHighlighted: highlighted,
    getValue: () => jar ? jar.toString() : element.innerText,
    setValue: (value) => jar ? jar.updateCode(value || '') : (element.textContent = value || ''),
    setLanguage: (nextLanguageId) => {
      languageId = nextLanguageId || 'plaintext';
      useLanguage();
      if (jar) jar.updateCode(jar.toString());
    },
    setOptions: ({ fontSize, fontWeight, fontStyle }) => {
      element.style.fontSize = fontSize + 'px';
      element.style.fontWeight = fontWeight;
      element.style.fontStyle = fontStyle;
    },
    focus: () => jar ? jar.focus() : element.focus(),
    selectAll: () => {
      element.focus();
      document.execCommand('selectAll');
    },
    dispose: () => { if (jar) jar.destroy(); },
  };
}

export async function createFallbackEditor(container, options) {
  const element = document.createElement('div');
  element.className = 'codejar-editor';
  element.setAttribute('role', 'textbox');
  element.setAttribute('aria-label', 'Code editor');
  element.setAttribute('aria-multiline', 'true');
  container.replaceChildren(element);

  let languageMap = {};
  let codeJar = null;
  let isHighlighted = false;

  try {
    const [codeJarModule, , loadedLanguageMap] = await Promise.all([
      import(options.codejarUrl),
      loadPrismBundle(options.prismUrl),
      fetch(options.languageMapUrl).then(response => {
        if (!response.ok) throw new Error('Could not load the local language map.');
        return response.json();
      })
    ]);
    languageMap = loadedLanguageMap;
    let currentLanguageId = options.languageId || 'plaintext';
    const prismLanguage = () => languageMap[currentLanguageId] || null;
    const setLanguageClass = () => {
      const language = prismLanguage();
      element.className = 'codejar-editor' + (language ? ' language-' + language : '');
      isHighlighted = Boolean(language && window.Prism.languages[language]);
    };

    setLanguageClass();
    codeJar = codeJarModule.CodeJar(element, (editor) => {
      const language = prismLanguage();
      if (language && window.Prism.languages[language]) window.Prism.highlightElement(editor);
    }, { tab: '    ' });
    codeJar.onUpdate(options.onUpdate || (() => {}));
    codeJar.updateCode(options.initialValue || '');

    const adapter = makeEditorAdapter(element, codeJar, languageMap, currentLanguageId, isHighlighted);
    adapter.setLanguage = (nextLanguageId) => {
      currentLanguageId = nextLanguageId || 'plaintext';
      setLanguageClass();
      codeJar.updateCode(codeJar.toString());
      adapter.isHighlighted = isHighlighted;
    };
    return adapter;
  } catch (err) {
    console.error('BoronCode: CodeJar/Prism setup failed; using plain text editor:', err);
    element.className = 'codejar-editor';
    element.setAttribute('contenteditable', 'plaintext-only');
    element.setAttribute('spellcheck', 'false');
    element.textContent = options.initialValue || '';
    element.addEventListener('input', () => {
      if (options.onUpdate) options.onUpdate(element.innerText);
    });
    return makeEditorAdapter(element, null, {}, 'plaintext', false);
  }
}
