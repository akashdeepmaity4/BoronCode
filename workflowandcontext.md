# Boron Code: Workflow and Technical Context

This document is the working source of truth for the Boron Code project. It describes the runtime architecture, operational flow, and the engineering assumptions behind the app rather than a marketing overview.

## Screenshots - Homepage, while in use, and AI Integration

### Homepage - Default

![landing](assets/dark-mode-default.png)

### Homepage - Light Mode

![landing-alt](assets/light-mode.png)

### WhiLe Working - editing code

![while-in-use](assets/while-working.png)

### AI Integration - Native Support for API as well as Local Models 

![ai](assets/ai-hub-api-local.png)

### AI - Multi-Provider Support

![multi](assets/multiple-selections.png)

---

## 1. Project purpose

Boron Code is a lightweight local IDE/workspace environment that combines:
- workspace browsing and file management
- code execution for local scripts
- shell access via the operating system terminal
- AI assistant integration through either cloud providers or custom gateways
- safe path handling for files and model locations

The application is implemented primarily as a Flask backend with a browser-based frontend and optional pywebview shell wrapper.

---

## 2. Runtime structure

### Primary backend
- `app/app.py` contains the Flask server, endpoint handlers, path validation helpers, AI provider adapters, terminal resolution logic, and file execution logic.

### UI layer
- `templates/index.html` and `templates/apiform.html` provide the main workspace and API configuration surfaces.
- `static/js/main.js` handles the interactive editor behavior, workspace tree updates, and UI event wiring.
- `static/css/style.css` defines the IDE-style design tokens and dark/light theme patterns.

### Launch wrapper
- `launcher.py` starts the application in a desktop-style shell using pywebview when a native desktop experience is desired.

### Supporting files
- `formatting.py` is used for formatting logic and code cleanup helpers.
- `requirements.txt` defines the runtime dependencies.
- `tests/` contains regression checks for gateway handling and terminal resolution.

---

## 3. Core execution flow

### Browser / UI request flow
1. The browser loads the main UI from the Flask app.
2. User interactions trigger AJAX requests to endpoints in `app/app.py`.
3. The server validates payloads, resolves workspace paths, and restricts access outside the project root.
4. Results are returned as JSON payloads for the frontend to update the UI.

### File workflow
- `read-file` loads workspace content from disk.
- `save-file` writes sanitized UTF-8 content back to the project file.
- `create-folder` ensures the destination remains inside the workspace root.
- `run-file` executes safe script targets only after validation.

### AI workflow
- `verify-external-api` validates the selected provider and gateway input.
- `ai-chat` routes requests based on provider choice and API presence.
- `call_external_ai_api()` handles provider normalization and HTTP requests.
- `call_local_ai_model()` attempts to contact common local gateways such as localhost ports used by Ollama or similar services.

---

## 4. Security model

The backend is intentionally defensive.

### Path restrictions
- `resolve_workspace_path()` prevents traversal outside the workspace root.
- `is_git_restricted()` blocks any path that touches `.git` directories.
- `is_safe_relative_path()` rejects suspicious shell metacharacters and unsafe file names.

### Input sanitization
- `sanitize_str()` strips control characters and escapes user-controlled strings before display.
- Provider names are constrained to a safe allowlist and normalized before outbound API calls.
- Gateway URLs are normalized to avoid mismatches from trailing slashes or common path patterns.

### Execution restrictions
- `run-file` accepts only a small set of file extensions and executes via `subprocess.run(..., shell=False)`.
- No shell interpretation is used with user file paths.

---

## 5. Gateway and provider normalization

Custom gateway support is implemented in a way that handles common endpoint variants.

### URL normalization rules
- Missing scheme is auto-filled with `http://`.
- Trailing slashes are stripped.
- `/chat/completions`, `/api/generate`, and `/v1` suffixes are normalized to a base gateway root.
- The final OpenAI-compatible endpoint is constructed as `/v1/chat/completions` when needed.

This lets requests work across gateway shapes such as:
- `localhost:1234/v1/`
- `https://example.com/base/`
- `https://api.example.com/chat/completions`

### Provider routing logic
- Custom and gateway provider labels are treated as a single route category.
- Non-custom providers still require a valid API key.
- The external API adapter supports OpenAI-compatible and vendor-specific payload formats, including Gemini and Anthropic style endpoints.

---

## 6. Terminal resolution strategy

Terminal selection is intentionally layered and deterministic.

### Resolution order
1. `bash` from `PATH`
2. Common Git for Windows install paths, including `Git\bin\bash.exe`
3. Git Bash shortcut under the Windows Start Menu
4. `cmd.exe` fallback on Windows
5. OS default terminal fallback for other platforms

This logic is implemented in `resolve_terminal_command()` and is intentionally resilient against missing environment setup.

---

## 7. Local AI detection behavior

`call_local_ai_model()` probes candidate gateway URLs and attempts a POST against common OpenAI-compatible local endpoints. It checks a small list of localhost ports and supports:
- `api/generate`
- `v1/chat/completions`
- `chat/completions`

If a direct local model file path exists but no live server is reachable, the function returns a structured warning instead of crashing.

---

## 8. Testing approach

The repo includes focused tests for the highest-risk integration points:
- custom gateway URL normalization
- OpenAI-compatible URL construction
- API verification for custom gateways
- AI chat route routing for keyless gateway requests
- terminal resolution fallback logic

The key regression test pattern is to validate actual behavior with mocked network calls rather than pure mock-only assertions.

---

## 9. Operational notes for contributors

When changing backend logic:
- keep provider names normalized before routing
- preserve workspace containment checks
- validate URLs before making outbound HTTP calls
- ensure all route handlers return JSON with explicit status codes

When changing frontend logic:
- update the endpoint contract in the frontend and backend together
- keep UI actions aligned with server-side sanitization rules
- test custom gateway use cases, not only default cloud providers

---

## 10. Known design constraints

- The app assumes a local workspace root and does not allow arbitrary filesystem access.
- Custom gateways must use OpenAI-compatible conventions or equivalent response parsing logic.
- The terminal startup path is intentionally conservative and does not silently execute user-provided commands.
- AI provider execution is not intended to be open-ended; it uses an allowlist and explicit fallback logic.

This keeps the app predictable, secure, and easy to maintain in a local-development environment.

---

## 11. Checkout inventory and observed behavior (reviewed 2026-11-16)

This section records the current checkout because earlier sections describe some behavior and files more generally. The repository currently has no `tests/` directory; test references above describe intended/focused coverage from prior context, not files present in this checkout. `git status` showed a pre-existing modification to `.gitignore`; it was not made as part of this review.

### Paths and their roles

- `app/__init__.py` is empty; `app/app.py` owns the Flask app and all HTTP routes.
- `templates/index.html` defines the main editor shell, menus, sidebar, file tree mount, editor mount, AI configuration overlay, and AI chat popup. It includes `templates/apiform.html` and loads `static/js/main.js` plus `static/css/style.css`.
- `templates/apiform.html` is the AI Hub form fragment for external APIs, custom gateways, and local model gateway settings/search.
- `static/js/main.js` initializes on `DOMContentLoaded`; it owns client-side file state, editor loading, file/folder pickers, tree rendering, menus, keyboard shortcuts, theme/editor settings, terminal/run/save actions, AI setup, and chat.
- `static/css/style.css` defines the visual system, editor layout, menus, overlays, themes, and responsive presentation. The stylesheet is UI-only and is not part of backend routing.
- `launcher.py` imports `app.app:app`, opens a pywebview window, and exposes `DesktopFileApi` for files selected by native dialogs. The bridge tracks authorized absolute paths in a lock-protected set; it offers open-file, open-folder, save-as, read, write, and delete operations. Folder enumeration omits `.git` directories.
- `formatting.py` contains `format_code` and `clean_html_to_raw_text`; repository search found no imports/callers in the current tracked source, so it appears disconnected from the Monaco editor path.
- `PowerShell/Find-DeadCSS.ps1` and `PowerShell/Test-MonacoCDN.ps1` are maintenance scripts for stylesheet and CDN checks; they are not runtime pipeline steps.
- `assets/` contains five README/workflow screenshots: default dark, light mode, active editing, AI API/local, and provider selection.
- Root documentation/configuration: `readme.md` covers install/use/features/shortcuts; `FAQs.md` is user FAQ; `workflowandcontext.md` is this architecture record; `requirements.txt` declares Flask, pywebview, and PyInstaller; `LICENSE` is MIT; `.gitignore` excludes environments, binaries, caches, and local artifacts. `temp.md` is the requested Ponytail prompt and is ignored by Git.
- `.venv/` is a local environment and not application source. Generated `__pycache__` files were present during inspection and are ignored.

### Runtime and user flows

- Browser mode can run `python app/app.py`; desktop mode runs `python launcher.py`, which starts Flask through pywebview. The Flask app uses root `templates/` and `static/` directories, and `WORKSPACE_ROOT` is the repository root.
- On startup, `static/js/main.js` tries configured Monaco CDN URLs, waits up to 15 seconds for the loader, then initializes the editor. The editor has language selection based on file extension and dark/light theme synchronization.
- File/folder access differs by host: pywebview uses native dialogs and the authorized-path bridge; browsers use the File System Access API where available and standard file/folder inputs otherwise. The client builds and renders a collapsible tree, skips `.git`, reads file contents into Monaco, and saves through the available host mechanism.
- File operations include new blank files, folder creation, open file/folder, save, Save As (including moving/removing the old selected file where supported), save-copy-as, deletion for the move workflow, and auto-save. Root workspace operations go through Flask; selected external desktop files go through the pywebview bridge.
- Menus and keyboard bindings dispatch editor, file, view, help, print, and terminal actions. The view menu toggles theme and line numbers; settings adjust font size, bold, and italic. Run supports `.py`, `.js`, and `.sh` via the Flask `/run-file` route. The toolbar star action opens a terminal prepared with the active Python file name; the terminal shortcut opens a terminal at the active file's directory.
- AI setup is presented in an overlay. External-provider verification and chat use `/api/verify-external-api` and `/api/ai-chat`; a supplied gateway URL routes through the custom OpenAI-compatible adapter. Local model verification probes configured local AI gateways; model search accepts candidate paths from selected folders. The chat popup sends the current editor contents as code context.

### Current Flask routes and safeguards

- `GET /` renders the main workspace. `GET /apiform` and `/apiform.html` render the AI form directly. `GET /workspace-root` returns the workspace root. `GET /list-workspace` lists root entries while excluding `.git*` names.
- `POST /read-file` reads UTF-8 workspace files; `POST /save-file` writes UTF-8 text and can optionally remove a previous workspace file; `POST /delete-file` removes a workspace file; `POST /create-folder` creates a child folder. These paths use workspace containment checks and reject `.git` targets.
- `POST /run-file` allows only `.py`, `.js`, and `.sh`, validates relative paths, calls fixed executables with `shell=False`, captures output, and times out after 15 seconds.
- `POST /open-terminal` resolves a requested working directory, prefers `bash`/Git Bash and falls back to Windows CMD or the platform terminal. Its optional Windows clipboard/paste path accepts only a constrained `python "... .py"` command shape.
- `POST /api/verify-external-api` checks external provider/gateway configuration; `POST /api/verify-local-model` validates the supplied path or gateway shape and reports the model name (it does not probe a gateway); `POST /api/search-local-models` filters submitted path names or scans supplied folders for supported model extensions; `POST /api/ai-chat` routes chat to local or external provider handling. Local gateway probing happens inside the local chat adapter.
- Common helpers normalize workspace paths, reject `.git`, sanitize strings, normalize gateway URLs, construct OpenAI-compatible endpoints, validate executable relative paths, resolve terminal working directories/commands, and parse provider-specific responses. Flask has explicit 404, 405, and 500 JSON handlers.

### Refactor constraints from the current implementation

Preserve all template IDs/classes and rendered structure, CSS, route names and methods, JSON request/response shapes, status codes/messages, keyboard shortcuts, host-specific file workflows, provider routing, path restrictions, subprocess arguments/timeouts, and error handling. No dependency, wrapper, build pipeline, workflow, or technology changes are needed for a logic-only refactor.
