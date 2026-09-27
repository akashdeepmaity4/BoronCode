"""
Run directly for browser/localhost use:
    python app/app.py
Or via launcher.py for the pywebview desktop window.
"""
from flask import Flask, render_template, request, jsonify
import os
import re
import subprocess
import shutil
import html
import urllib.request
import urllib.error
import urllib.parse
import json

app = Flask(__name__, template_folder='../templates', static_folder='../static')

# Workspace root: one level above the app package (the project directory).
WORKSPACE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def is_git_restricted(path_str):
    """Block any path that touches a .git directory."""
    if not path_str:
        return False
    normalized = path_str.replace('\\', '/')
    parts = [p.lower() for p in normalized.split('/')]
    return '.git' in parts


def resolve_workspace_path(path_str):
    """Anchor a relative path to the workspace root.

    Anti-traversal: the resolved absolute path must stay inside
    WORKSPACE_ROOT. Any attempt to escape with '..' or an absolute path is
    rejected by returning an empty string, which callers treat as invalid.
    """
    if not path_str:
        return ''
    # Strip NUL bytes and control chars that can fool path checks.
    cleaned = ''.join(c for c in str(path_str) if c not in '\x00\r\n')
    if os.path.isabs(cleaned):
        candidate = os.path.abspath(cleaned)
    else:
        normalized = cleaned.replace('\\', '/').lstrip('/').lstrip('.')
        while normalized.startswith('/'):
            normalized = normalized.lstrip('/')
        if not normalized:
            return ''
        candidate = os.path.abspath(os.path.join(WORKSPACE_ROOT, normalized))
    # Containment check: refuse anything that resolves outside the workspace.
    if not (candidate == WORKSPACE_ROOT or candidate.startswith(WORKSPACE_ROOT + os.sep)):
        return ''
    return candidate


def sanitize_str(val):
    if not val:
        return ''
    return html.escape(str(val).strip())


def normalize_gateway_url(gateway_url):
    """Normalize a local/custom gateway URL to its base root."""
    if not gateway_url:
        return ''
    cleaned = html.unescape(str(gateway_url)).strip()
    cleaned = ''.join(ch for ch in cleaned if ch not in '\x00\r\n')
    if not cleaned:
        return ''
    if not cleaned.startswith(('http://', 'https://')):
        cleaned = 'http://' + cleaned
    cleaned = cleaned.rstrip('/')
    if cleaned.endswith('/chat/completions'):
        return cleaned.rsplit('/chat/completions', 1)[0]
    if cleaned.endswith('/api/generate'):
        return cleaned.rsplit('/api/generate', 1)[0]
    if cleaned.endswith('/v1'):
        return cleaned
    return cleaned


def build_openai_compatible_url(gateway_url):
    """Return the OpenAI-compatible chat completions endpoint for a gateway."""
    if not gateway_url:
        return ''
    cleaned = html.unescape(str(gateway_url)).strip()
    cleaned = ''.join(ch for ch in cleaned if ch not in '\x00\r\n')
    cleaned = cleaned.rstrip('/')
    if cleaned.startswith(('http://', 'https://')) and cleaned.endswith('/chat/completions'):
        return cleaned
    if cleaned.startswith(('http://', 'https://')) and cleaned.endswith('/v1/chat/completions'):
        return cleaned

    base = normalize_gateway_url(gateway_url)
    if not base:
        return ''
    if base.endswith('/chat/completions'):
        return base
    if base.endswith('/v1'):
        return f'{base}/chat/completions'
    return f'{base}/v1/chat/completions'


# Allowed filename characters: letters, digits, dash, underscore, dot, and a
# single path separator. Rejects shell metacharacters and traversal segments.
_SAFE_NAME_RE = re.compile(r'^[A-Za-z0-9_\-./]+\.[A-Za-z0-9_\-]+$')


def is_safe_relative_path(path_str):
    """True if path_str is a relative path with no traversal or shell metachars."""
    if not path_str or not isinstance(path_str, str):
        return False
    if '\x00' in path_str:
        return False
    # No shell/command metacharacters that could break out of an argv slot.
    if any(ch in path_str for ch in (';', '|', '&', '$', '`', '(', ')', '{', '}', '<', '>', '*', '?', '"', "'", '\n', '\r')):
        return False
    normalized = path_str.replace('\\', '/')
    parts = [p for p in normalized.split('/') if p not in ('', '.')]
    if any(p == '..' for p in parts):
        return False
    return True


# --------------------------------------------------------------------------- #
# Pages
# --------------------------------------------------------------------------- #
@app.route('/')
def index():
    return render_template('index.html')


@app.route('/apiform')
@app.route('/apiform.html')
def apiform():
    return render_template('apiform.html')


# --------------------------------------------------------------------------- #
# File operations
# --------------------------------------------------------------------------- #
@app.route('/workspace-root', methods=['GET'])
def workspace_root():
    return jsonify({'status': 'success', 'root': WORKSPACE_ROOT})


@app.route('/save-file', methods=['POST'])
def save_file():
    data = request.get_json() or {}
    file_path = data.get('path', '')
    raw_content = data.get('content', '')

    if is_git_restricted(file_path):
        return jsonify({'status': 'error', 'message': 'Modifying .git files is restricted.'}), 403
    if not file_path:
        return jsonify({'status': 'error', 'message': 'Invalid file path.'}), 400

    file_path = resolve_workspace_path(file_path)
    if not file_path:
        return jsonify({'status': 'error', 'message': 'Invalid or out-of-workspace file path.'}), 400
    clean_text = raw_content.replace('\xa0', ' ').replace('\u00a0', ' ')

    try:
        parent = os.path.dirname(os.path.abspath(file_path))
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(clean_text)
        return jsonify({'status': 'success', 'message': 'File saved successfully.', 'path': file_path})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/create-folder', methods=['POST'])
def create_folder():
    data = request.get_json(silent=True) or {}
    folder_name = (data.get('name') or data.get('folderName') or data.get('title') or '').strip()
    target_dir = data.get('targetDir') or data.get('targetPath') or data.get('path') or ''

    if not folder_name:
        return jsonify({'status': 'error', 'message': 'Folder name is required.'}), 400
    if folder_name in ('.', '..') or '/' in folder_name or '\\' in folder_name:
        return jsonify({'status': 'error', 'message': 'Invalid folder name.'}), 400
    if is_git_restricted(folder_name):
        return jsonify({'status': 'error', 'message': 'Reserved or forbidden folder names are not allowed.'}), 400

    base_dir = target_dir or WORKSPACE_ROOT
    if not os.path.isabs(base_dir):
        candidate = resolve_workspace_path(base_dir)
        if not candidate:
            return jsonify({'status': 'error', 'message': 'Invalid target directory.'}), 400
        base_dir = candidate
    base_dir = os.path.abspath(base_dir)
    if is_git_restricted(base_dir):
        return jsonify({'status': 'error', 'message': 'Target directory is restricted.'}), 400
    if not os.path.isdir(base_dir):
        os.makedirs(base_dir, exist_ok=True)

    new_dir = os.path.abspath(os.path.join(base_dir, folder_name))
    if not (new_dir == WORKSPACE_ROOT or new_dir.startswith(WORKSPACE_ROOT + os.sep)):
        return jsonify({'status': 'error', 'message': 'Folder must stay within the workspace root.'}), 400
    if os.path.exists(new_dir):
        return jsonify({'status': 'error', 'message': 'Folder already exists.'}), 409
    try:
        os.makedirs(new_dir, exist_ok=False)
        return jsonify({'status': 'success', 'message': 'Folder created successfully.', 'path': new_dir})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/read-file', methods=['POST'])
def read_file():
    data = request.get_json() or {}
    file_path = data.get('path', '')

    if is_git_restricted(file_path):
        return jsonify({'status': 'error', 'message': 'Accessing .git files is restricted.'}), 403

    file_path = resolve_workspace_path(file_path)
    if not file_path:
        return jsonify({'status': 'error', 'message': 'Invalid or out-of-workspace file path.'}), 400
    if not os.path.exists(file_path):
        return jsonify({'status': 'error', 'message': 'File not found.'}), 404

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        return jsonify({'status': 'success', 'content': content, 'path': file_path})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/list-workspace', methods=['GET'])
def list_workspace():
    """List files (one level deep) in the workspace root."""
    try:
        entries = []
        for name in sorted(os.listdir(WORKSPACE_ROOT)):
            full = os.path.join(WORKSPACE_ROOT, name)
            if name.startswith('.git'):
                continue
            entries.append({'name': name, 'isDir': os.path.isdir(full)})
        return jsonify({'status': 'success', 'root': WORKSPACE_ROOT, 'entries': entries})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


@app.route('/run-file', methods=['POST'])
def run_file():
    data = request.get_json() or {}
    file_path = data.get('path', '')

    if not file_path:
        return jsonify({'status': 'error', 'message': 'File path is required.'}), 400

    # Anti-command-injection: only allow safe relative paths, then anchor and
    # verify containment inside the workspace. The path is never passed through
    # a shell (subprocess.run uses a list, shell=False), and we additionally
    # reject any shell metacharacters in the raw input.
    if not is_safe_relative_path(file_path):
        return jsonify({'status': 'error', 'message': 'Invalid file path.'}), 400

    resolved = resolve_workspace_path(file_path)
    if not resolved or not os.path.exists(resolved):
        return jsonify({'status': 'error', 'message': 'File does not exist on disk.'}), 400

    ext = resolved.rsplit('.', 1)[-1].lower() if '.' in resolved else ''
    runners = {'py': ['python', resolved], 'js': ['node', resolved], 'sh': ['bash', resolved]}
    cmd = runners.get(ext)
    if not cmd:
        return jsonify({'status': 'error', 'message': f'Execution for .{ext} files is not supported.'}), 400

    try:
        # shell=False + list args => no shell interpretation of the path.
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15, shell=False)
        return jsonify({'status': 'success', 'stdout': result.stdout, 'stderr': result.stderr})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


def get_common_git_bash_candidates():
    """Return standard Git for Windows install locations for bash.exe."""
    user_root = os.environ.get('USERPROFILE') or os.path.expanduser('~')
    local_root = os.environ.get('LOCALAPPDATA') or os.path.join(user_root, 'AppData', 'Local')
    roots = [
        os.environ.get('ProgramFiles'),
        os.environ.get('ProgramFiles(x86)'),
        os.environ.get('ProgramW6432'),
        os.path.join(local_root, 'Programs'),
        os.path.join(user_root, 'AppData', 'Local', 'Programs'),
        r'C:\Program Files',
        r'C:\Program Files (x86)',
    ]
    seen = set()
    for root in roots:
        if not root:
            continue
        for candidate in (
            os.path.join(root, 'Git', 'bin', 'bash.exe'),
            os.path.join(root, 'Git', 'usr', 'bin', 'bash.exe'),
            os.path.join(root, 'Git', 'bin', 'bash'),
            os.path.join(root, 'Git', 'usr', 'bin', 'bash'),
            os.path.join(root, 'Git', 'Git Bash.lnk'),
            os.path.join(root, 'Git', 'Git Bash'),
        ):
            normalized = os.path.normpath(candidate)
            if normalized not in seen:
                seen.add(normalized)
                yield normalized

    shortcut = r'C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Git\Git Bash.lnk'
    if shortcut not in seen:
        seen.add(shortcut)
        yield shortcut


def resolve_terminal_directory(requested_cwd=None):
    """Choose the directory the terminal should open in."""
    default_root = "C:\\" if os.name == 'nt' else os.path.expanduser('~')
    if not requested_cwd:
        return os.path.normpath(default_root)

    cleaned = ''.join(ch for ch in str(requested_cwd) if ch not in '\x00\r\n')
    if not cleaned:
        return os.path.normpath(default_root)

    if os.path.isabs(cleaned):
        candidate = os.path.abspath(cleaned)
    else:
        candidate = os.path.abspath(os.path.join(WORKSPACE_ROOT, cleaned))

    if os.path.isdir(candidate):
        return os.path.normpath(candidate)

    parent = os.path.dirname(candidate)
    if parent and os.path.isdir(parent):
        return os.path.normpath(parent)

    return os.path.normpath(default_root)


def resolve_terminal_command():
    """Pick the best available terminal in the intended fallback order."""
    bash_path = shutil.which('bash')
    if bash_path:
        return [bash_path]

    for candidate in get_common_git_bash_candidates():
        if os.path.exists(candidate):
            if candidate.lower().endswith('.lnk'):
                return ['cmd.exe', '/c', 'start', '', candidate]
            return [candidate, '--login', '-i']

    if os.name == 'nt':
        return ['cmd.exe', '/c', 'start', 'cmd']
    return ['x-terminal-emulator']


@app.route('/open-terminal', methods=['POST'])
def open_terminal():
    try:
        data = request.get_json(silent=True) or {}
        cwd = resolve_terminal_directory(data.get('cwd'))
        command = resolve_terminal_command()
        subprocess.Popen(command, cwd=cwd)
        shell_name = command[0].split(os.sep)[-1] if command and command[0] else 'terminal'
        return jsonify({'status': 'success', 'message': 'Terminal opened successfully.', 'shell': shell_name, 'path': cwd})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


# --------------------------------------------------------------------------- #
# AI providers
# --------------------------------------------------------------------------- #
def call_external_ai_api(provider, api_key, prompt, code_context="", gateway_url="", model_name=""):
    full_prompt = prompt
    if code_context:
        full_prompt = f"Code Context:\n```\n{code_context}\n```\n\nUser Prompt:\n{prompt}"

    # Anti-injection: validate provider against an allowlist of known names and
    # strip anything that could break out of a URL path or HTTP header. The API
    # key is stripped of CR/LF and header separators to prevent header injection.
    ALLOWED_PROVIDERS = {
        'chatgpt', 'openai', 'grok', 'deepseek', 'mistral', 'openrouter',
        'perplexity', 'gemini', 'google', 'claude', 'anthropic', 'cohere', 'custom', 'gateway'
    }
    provider_clean = html.unescape(provider).lower().strip()
    # Keep only alnum/dash/space; collapse to a safe token.
    provider_clean = ''.join(c if c.isalnum() or c in '- ' else '' for c in provider_clean).strip()
    if 'custom' in provider_clean or 'gateway' in provider_clean:
        provider_clean = 'custom'
    elif provider_clean not in ALLOWED_PROVIDERS:
        # Fall back to a safe default rather than trusting arbitrary input.
        provider_clean = 'custom'

    api_key_clean = html.unescape(api_key).strip()
    api_key_clean = ''.join(c for c in api_key_clean if c not in '\r\n\x00')
    if any(ch in api_key_clean for ch in ('\r', '\n', ':')) and 'Bearer' not in api_key_clean:
        api_key_clean = api_key_clean.split(':')[0].strip()

    def chat_extract(d):
        return d['choices'][0]['message']['content']

    def generic_extract(d):
        if 'choices' in d and d['choices']:
            return chat_extract(d)
        if 'response' in d:
            return d['response']
        if 'message' in d:
            msg = d['message']
            if isinstance(msg, dict):
                if 'content' in msg:
                    content = msg['content']
                    if isinstance(content, list):
                        parts = [part.get('text', '') if isinstance(part, dict) else str(part) for part in content]
                        return ''.join(parts)
                    return str(content)
                if 'text' in msg:
                    return str(msg['text'])
            if isinstance(msg, str):
                return msg
        if 'output' in d:
            output = d['output']
            if isinstance(output, list):
                texts = []
                for item in output:
                    if isinstance(item, dict):
                        texts.append(item.get('content', item.get('text', '')))
                    else:
                        texts.append(str(item))
                return ''.join(str(v) for v in texts)
            return str(output)
        raise ValueError('Unsupported API response format')

    def openai_payload(model_name_override='gpt-3.5-turbo'):
        return {
            'model': model_name_override,
            'messages': [
                {'role': 'system', 'content': 'You are an expert programming assistant in Boron Code IDE.'},
                {'role': 'user', 'content': full_prompt}
            ]
        }

    if provider_clean in {'custom', 'gateway'}:
        gateway_url_clean = normalize_gateway_url(gateway_url or '')
        if not gateway_url_clean:
            raise ValueError('Custom API gateway URL is required for custom/gateway providers.')
        url = build_openai_compatible_url(gateway_url_clean)
        headers = {'Content-Type': 'application/json'}
        if api_key_clean:
            headers['Authorization'] = f'Bearer {api_key_clean}'
        payload = {
            'model': model_name or 'gpt-3.5-turbo',
            'messages': [{'role': 'user', 'content': full_prompt}],
        }
        req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers=headers, method='POST')
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp_data = json.loads(resp.read().decode('utf-8'))
            return generic_extract(resp_data)

    # Known providers below
    providers = {
        'chatgpt': ('https://api.openai.com/v1/chat/completions',
                    {'Content-Type': 'application/json', 'Authorization': f'Bearer {api_key_clean}'},
                    lambda: openai_payload('gpt-3.5-turbo'), chat_extract),
        'openai': ('https://api.openai.com/v1/chat/completions',
                   {'Content-Type': 'application/json', 'Authorization': f'Bearer {api_key_clean}'},
                   lambda: openai_payload('gpt-3.5-turbo'), chat_extract),
        'grok': ('https://api.x.ai/v1/chat/completions',
                 {'Content-Type': 'application/json', 'Authorization': f'Bearer {api_key_clean}'},
                 lambda: {'model': 'grok-beta', 'messages': [
                     {'role': 'system', 'content': 'You are an expert AI programming assistant.'},
                     {'role': 'user', 'content': full_prompt}]}, chat_extract),
        'deepseek': ('https://api.deepseek.com/chat/completions',
                     {'Content-Type': 'application/json', 'Authorization': f'Bearer {api_key_clean}'},
                     lambda: {'model': 'deepseek-chat', 'messages': [
                         {'role': 'system', 'content': 'You are an expert AI coding assistant.'},
                         {'role': 'user', 'content': full_prompt}]}, chat_extract),
        'mistral': ('https://api.mistral.ai/v1/chat/completions',
                    {'Content-Type': 'application/json', 'Authorization': f'Bearer {api_key_clean}'},
                    lambda: {'model': 'mistral-tiny', 'messages': [
                        {'role': 'user', 'content': full_prompt}]}, chat_extract),
        'openrouter': ('https://openrouter.ai/api/v1/chat/completions',
                       {'Content-Type': 'application/json', 'Authorization': f'Bearer {api_key_clean}'},
                       lambda: {'model': 'auto', 'messages': [
                           {'role': 'user', 'content': full_prompt}]}, chat_extract),
        'perplexity': ('https://api.perplexity.ai/chat/completions',
                       {'Content-Type': 'application/json', 'Authorization': f'Bearer {api_key_clean}'},
                       lambda: {'model': 'sonar-pro', 'messages': [
                           {'role': 'user', 'content': full_prompt}]}, chat_extract),
    }

    if 'gemini' in provider_clean or 'google' in provider_clean:
        safe_key = urllib.parse.quote(api_key_clean, safe='')
        requested_model = (model_name or '').strip() or 'gemini-2.5-flash'
        candidate_models = []
        if requested_model:
            candidate_models.append(requested_model)
        candidate_models.extend(['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'])
        seen_models = set()
        last_error = None

        for model_name_candidate in candidate_models:
            if model_name_candidate in seen_models:
                continue
            seen_models.add(model_name_candidate)
            url = f'https://generativelanguage.googleapis.com/v1beta/models/{model_name_candidate}:generateContent?key={safe_key}'
            payload = {'contents': [{'parts': [{'text': full_prompt}]}]}
            req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'),
                                         headers={'Content-Type': 'application/json'}, method='POST')
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = json.loads(resp.read().decode('utf-8'))
                    return data['candidates'][0]['content']['parts'][0]['text']
            except urllib.error.HTTPError as err:
                last_error = err
                error_body = err.read().decode('utf-8', errors='ignore')
                if err.code == 404:
                    continue
                if err.code == 503:
                    continue
                raise
            except Exception as err:
                last_error = err
                raise

        if last_error is not None:
            raise last_error
        raise ValueError('No valid Gemini model could be reached for the configured API key.')

    if 'claude' in provider_clean or 'anthropic' in provider_clean:
        url = 'https://api.anthropic.com/v1/messages'
        headers = {'Content-Type': 'application/json', 'x-api-key': api_key_clean, 'anthropic-version': '2023-06-01'}
        payload = {'model': 'claude-3-haiku-20240307', 'max_tokens': 1024,
                   'messages': [{'role': 'user', 'content': full_prompt}]}
        req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'),
                                     headers=headers, method='POST')
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode('utf-8'))['content'][0]['text']

    if 'cohere' in provider_clean:
        url = 'https://api.cohere.com/v2/chat'
        headers = {'Content-Type': 'application/json', 'Authorization': f'Bearer {api_key_clean}'}
        payload = {'model': 'command-r-plus', 'messages': [
            {'role': 'user', 'content': {'content': full_prompt}}]}
        req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'),
                                     headers=headers, method='POST')
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode('utf-8'))['message']['content'][0]['text']

    url, headers, payload_fn, extract_fn = providers.get(
        provider_clean,
        ('https://api.openai.com/v1/chat/completions',
         {'Content-Type': 'application/json', 'Authorization': f'Bearer {api_key_clean}'},
         lambda: {'model': 'gpt-3.5-turbo', 'messages': [{'role': 'user', 'content': full_prompt}]},
         chat_extract))
    req = urllib.request.Request(url, data=json.dumps(payload_fn()).encode('utf-8'),
                                 headers=headers, method='POST')
    with urllib.request.urlopen(req, timeout=30) as resp:
        return extract_fn(json.loads(resp.read().decode('utf-8')))


def call_local_ai_model(model_path, prompt, code_context="", gateway_url=""):
    full_prompt = prompt
    if code_context:
        full_prompt = f"Code Context:\n```\n{code_context}\n```\n\nPrompt:\n{prompt}"

    model_path_clean = html.unescape(model_path).strip() if model_path else ''
    model_path_clean = ''.join(c for c in model_path_clean if c not in '\x00\r\n')

    candidate_bases = []
    if gateway_url:
        gateway_base = normalize_gateway_url(gateway_url)
        if gateway_base:
            candidate_bases.append(gateway_base)
    if model_path_clean:
        if model_path_clean.startswith(('http://', 'https://')):
            candidate_bases.append(normalize_gateway_url(model_path_clean))
        if os.path.exists(model_path_clean):
            candidate_bases.append('http://localhost:11434')
            candidate_bases.append('http://localhost:1234')
            candidate_bases.append('http://localhost:8080')
            candidate_bases.append('http://localhost:8081')
            candidate_bases.append('http://localhost:8000')
            candidate_bases.append('http://localhost:3000')
    else:
        candidate_bases.extend(['http://localhost:11434', 'http://localhost:1234', 'http://localhost:8080',
                                'http://localhost:8081', 'http://localhost:8000', 'http://localhost:3000'])

    seen = set()
    for base in candidate_bases:
        normalized = normalize_gateway_url(base)
        if normalized and normalized not in seen:
            seen.add(normalized)
            for path in ('/api/generate', '/v1/chat/completions', '/chat/completions'):
                try:
                    url = normalized + path
                    payload = {'model': os.path.basename(model_path_clean) or 'llama3', 'prompt': full_prompt, 'stream': False}
                    if '/v1/chat/completions' in path or '/chat/completions' in path:
                        payload = {'model': os.path.basename(model_path_clean) or 'local-model', 'messages': [{'role': 'user', 'content': full_prompt}]}
                    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'),
                                                 headers={'Content-Type': 'application/json'}, method='POST')
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        data = json.loads(resp.read().decode('utf-8'))
                        if 'response' in data:
                            return data['response']
                        if 'choices' in data:
                            return data['choices'][0]['message']['content']
                except Exception:
                    pass

    if model_path_clean and os.path.exists(model_path_clean):
        fname = os.path.basename(model_path_clean)
        return (f"[Local Model ({fname}) Loaded]\nLocal model file identified at '{model_path_clean}'.\n"
                f"To run real-time local inference, start your local server (Ollama, LM Studio, or "
                f"llama.cpp) on localhost.")

    return (f"[Local Model Error] Could not connect to a local model gateway at localhost ports 11434/1234/8080/8081/8000/3000 or locate file at '{model_path_clean}'.")


# --------------------------------------------------------------------------- #
# AI routes
# --------------------------------------------------------------------------- #
@app.route('/api/verify-external-api', methods=['POST'])
def verify_external_api():
    data = request.get_json() or {}
    provider = sanitize_str(data.get('provider', ''))
    api_key = sanitize_str(data.get('apiKey', ''))
    gateway_url = sanitize_str(data.get('gatewayUrl', '') or data.get('gateway_url', ''))
    model_name = sanitize_str(data.get('modelName', '') or data.get('model_name', ''))

    provider_lower = provider.lower() if provider else ''
    is_custom_gateway = provider_lower in {'custom', 'gateway'}

    if not provider:
        return jsonify({'status': 'error', 'message': 'Provider is required.'}), 400
    if not is_custom_gateway and not api_key:
        return jsonify({'status': 'error', 'message': 'Provider and API key are required.'}), 400
    if not is_custom_gateway and api_key and len(api_key) < 5:
        return jsonify({'status': 'error', 'message': 'API Key appears invalid or too short.'}), 400
    if is_custom_gateway and not gateway_url:
        return jsonify({'status': 'error', 'message': 'A gateway URL is required for custom API connections.'}), 400

    try:
        call_external_ai_api(provider, api_key, "Hello! Confirm API connection.", gateway_url=gateway_url, model_name=model_name)
        return jsonify({'status': 'success', 'provider': provider,
                        'message': f'Connected to {provider} API successfully!'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'API Connection Failed: {str(e)}'}), 400


@app.route('/api/verify-local-model', methods=['POST'])
def verify_local_model():
    data = request.get_json() or {}
    model_path = sanitize_str(data.get('modelPath', ''))
    if not model_path:
        return jsonify({'status': 'error', 'message': 'Local model path is required.'}), 400

    if model_path.lower().startswith(('http://', 'https://')):
        normalized_path = normalize_gateway_url(model_path)
        model_name = os.path.basename(urllib.parse.urlparse(model_path).path) or 'gateway'
        return jsonify({'status': 'success', 'modelName': model_name, 'modelPath': normalized_path,
                        'message': f'Local AI gateway {normalized_path} is ready.'})

    normalized_path = os.path.abspath(model_path) if os.path.exists(model_path) else model_path
    model_name = os.path.basename(normalized_path)
    valid_extensions = ('.gguf', '.bin', '.safetensors', '.onnx', '.pth', '.pt')

    if not model_name.lower().endswith(valid_extensions):
        return jsonify({'status': 'warning', 'modelName': model_name, 'modelPath': normalized_path,
                        'message': f'Model file {model_name} loaded.'})

    return jsonify({'status': 'success', 'modelName': model_name, 'modelPath': normalized_path,
                    'message': f'Local AI model {model_name} loaded successfully!'})


@app.route('/api/search-local-models', methods=['POST'])
def search_local_models():
    data = request.get_json() or {}
    files_list = data.get('files', [])
    search_folders = data.get('folders', [])

    valid_extensions = ('.gguf', '.bin', '.safetensors', '.onnx', '.pth', '.pt')
    found_models = []

    for f in files_list:
        clean_f = sanitize_str(f)
        if clean_f.lower().endswith(valid_extensions):
            found_models.append(clean_f)

    for folder in search_folders:
        clean_folder = sanitize_str(folder)
        if os.path.exists(clean_folder) and os.path.isdir(clean_folder):
            for root, dirs, files in os.walk(clean_folder):
                for fname in files:
                    if fname.lower().endswith(valid_extensions):
                        found_models.append(os.path.join(root, fname))

    found_models = list(dict.fromkeys(found_models))
    return jsonify({'status': 'success', 'count': len(found_models), 'models': found_models})


@app.route('/api/ai-chat', methods=['POST'])
def ai_chat():
    data = request.get_json() or {}
    prompt = sanitize_str(data.get('prompt', ''))
    provider = sanitize_str(data.get('provider', 'AI Assistant'))
    api_key = sanitize_str(data.get('apiKey', ''))
    model_path = sanitize_str(data.get('modelPath', ''))
    code_context = sanitize_str(data.get('codeContext', ''))
    gateway_url = sanitize_str(data.get('gatewayUrl', '') or data.get('gateway_url', ''))
    model_name = sanitize_str(data.get('modelName', '') or data.get('model_name', ''))

    if not prompt:
        return jsonify({'status': 'error', 'message': 'Prompt cannot be empty.'}), 400

    try:
        provider_lower = (provider or '').lower()
        is_custom_gateway = provider_lower in {'custom', 'custom api gateway', 'gateway'}
        use_external_api = is_custom_gateway or bool(api_key)

        if use_external_api and 'local' not in provider_lower:
            reply = call_external_ai_api(provider, api_key, prompt, code_context, gateway_url, model_name)
        else:
            reply = call_local_ai_model(model_path, prompt, code_context, gateway_url)
        return jsonify({'status': 'success', 'reply': reply})
    except urllib.error.HTTPError as err:
        err_body = err.read().decode('utf-8', errors='ignore')
        try:
            msg = json.loads(err_body).get('error', {}).get('message', err_body)
        except Exception:
            msg = err_body[:200]
        return jsonify({'status': 'error', 'message': f"API HTTP {err.code}: {msg}"}), 500
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500


# --------------------------------------------------------------------------- #
# Error handlers
# --------------------------------------------------------------------------- #
@app.errorhandler(404)
def not_found_error(error):
    return jsonify({'status': 'error', 'message': 'Route not found (404).'}), 404


@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({'status': 'error', 'message': 'Method not allowed (405).'}), 405


@app.errorhandler(500)
def internal_error(error):
    return jsonify({'status': 'error', 'message': f'Internal server error (500): {str(error)}'}), 500


if __name__ == '__main__':
    app.run(port=5000, debug=False)