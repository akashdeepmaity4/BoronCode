# Offline editor assets

- `codejar/codejar.js` is CodeJar 4.3.0, loaded only after Monaco has failed from all configured CDNs.
- `prism/prism-fallback.min.js` is a Prism 1.30.0 bundle containing the grammars and dependencies mapped in `prism/monaco-prism-map.json`.
- Language IDs without a direct Prism grammar use plain text. The fallback editor has fixed colors; the theme and syntax-color controls apply to Monaco only.
- License files are included beside each library.
