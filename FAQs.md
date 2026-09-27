# Developer FAQ

## 1. Where is the actual application logic implemented?
The backend logic lives in `app/app.py`. This file contains the Flask routes, path validation, AI provider adapters, terminal resolution logic, and local model probing.

## 2. How are workspace paths protected from traversal?
The app uses `resolve_workspace_path()` and `is_git_restricted()` to restrict access to the project root and prevent `.git` access or directory escapes outside the workspace.

## 3. What happens when a file is saved or read?
The `/read-file` and `/save-file` routes validate the path, reject invalid or out-of-workspace locations, then read or write the file using UTF-8 encoding. Path sanitization is applied before disk operations.

## 4. How does the app decide whether to use a local model or external API?
The `/api/ai-chat` route inspects the selected provider and API key state. If the provider is a custom gateway or an API key is present, it routes to `call_external_ai_api()`. Otherwise it falls back to `call_local_ai_model()`.

## 5. Why do custom gateway URLs need normalization?
Gateway endpoints often appear in shapes like `localhost:1234/v1/`, `https://proxy.example.com/base/`, or `https://example.com/chat/completions`. `normalize_gateway_url()` and `build_openai_compatible_url()` normalize these into a consistent base URL and final OpenAI-compatible path.

## 6. What is the safe provider strategy?
`call_external_ai_api()` sanitizes the provider name, restricts it to an allowlist, and collapses custom-like labels into a shared `custom` route. This prevents invalid provider strings from being used in outbound requests.

## 7. How is the terminal chosen on Windows?
`resolve_terminal_command()` checks, in order: `bash` in `PATH`, common Git Bash install locations, Git Bash Start Menu shortcut, then Windows `cmd.exe` as a fallback.

## 8. What local model ports are probed?
The app probes common local AI gateway ports such as 11434, 1234, 8080, 8081, 8000, and 3000, and tries common OpenAI-compatible paths such as `/api/generate`, `/v1/chat/completions`, and `/chat/completions`.

## 9. What security assumptions are enforced for execution?
`/run-file` supports only a specific set of safe script extensions and invokes subprocesses with `shell=False` and argument lists instead of a shell command string. The path is also validated before it is executed.

## 10. How should contributors validate changes?
Run the project’s test suite with `pytest -q` from the repo root. The repo includes regression tests for gateway normalization, custom AI route routing, and terminal fallback logic. If you modify gateway or path handling, add or update tests before relying on the change.

---

## Additional notes

- The workspace root is enforced using `WORKSPACE_ROOT` and path containment checks.
- API responses are structured as JSON with `status` and `message` fields for the frontend to consume consistently.
- `sanitize_str()` strips control characters and CR/LF sequences to prevent malformed HTTP payloads and unsafe render output.
