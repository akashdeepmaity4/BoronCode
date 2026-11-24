"""Discovery of the ``git`` and ``bash`` executables.

Resolution order (first hit wins), exactly as the Source Control panel expects:

1. BoronCode settings (``git_path`` / ``shell_path``), which also accept a Git
   installation *folder* rather than a binary path.
2. The system ``PATH`` plus the standard Windows Git-for-Windows locations.
3. Binaries bundled under ``<app_root>/resources/git/...`` (MinGit + PortableGit
   ``bash.exe`` hybrid shipped with a release build).
4. Nothing -- callers get ``{"available": False}`` and the UI disables Source
   Control with a "Download Git" prompt.

The module is deliberately pure (no Flask, no subprocess side effects) so the
terminal and the Git routes can share the exact same answers.
"""

import os
import shutil
import subprocess
import sys

from .paths import IN_PLACE_RESOURCE_ROOT, RESOURCE_ROOT
from .settings import get_setting

_NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0) if os.name == 'nt' else 0

GIT_DOWNLOAD_URL = 'https://git-scm.com/downloads'


def _candidate_roots():
    """Return every directory that may hold a bundled ``resources/`` payload."""
    roots = []
    for root in (RESOURCE_ROOT, IN_PLACE_RESOURCE_ROOT):
        if root and root not in roots:
            roots.append(root)
    return roots


def resource_path(*parts):
    """Resolve a read-only bundled asset for both development and frozen runs."""
    for root in _candidate_roots():
        candidate = os.path.join(root, *parts)
        if os.path.exists(candidate):
            return candidate
    return os.path.join(_candidate_roots()[0], *parts)


def _is_file(path):
    return bool(path) and os.path.isfile(path)


def _which(name):
    """``shutil.which`` that never picks up the WSL/Store ``bash.exe`` stub."""
    found = shutil.which(name)
    if not found:
        return None
    lowered = found.lower().replace('/', '\\')
    if os.name == 'nt' and name.lower() == 'bash' and (
        'windowsapps' in lowered or lowered.endswith('\\system32\\bash.exe')
    ):
        # These stubs launch WSL or open the Store instead of a usable shell.
        return None
    return found


def _windows_git_installations():
    """Yield ``(cmd_dir, bin_dir, usr_bin_dir)`` for each detected Git install."""
    user_root = os.environ.get('USERPROFILE') or os.path.expanduser('~')
    local_root = os.environ.get('LOCALAPPDATA') or os.path.join(user_root, 'AppData', 'Local')
    program_roots = [
        os.environ.get('ProgramW6432'),
        os.environ.get('ProgramFiles'),
        os.environ.get('ProgramFiles(x86)'),
        os.path.join(local_root, 'Programs'),
        r'C:\Program Files',
        r'C:\Program Files (x86)',
    ]
    seen = set()
    for root in program_roots:
        if not root:
            continue
        install = os.path.normpath(os.path.join(root, 'Git'))
        if install in seen:
            continue
        seen.add(install)
        yield (
            os.path.join(install, 'cmd'),
            os.path.join(install, 'bin'),
            os.path.join(install, 'usr', 'bin'),
        )


def _expand_install_dir(raw_path):
    """Turn a user-supplied file *or* folder into the matching binary path."""
    if not raw_path:
        return None
    cleaned = str(raw_path).strip().strip('"').strip("'")
    cleaned = ''.join(ch for ch in cleaned if ch not in '\x00\r\n')
    if not cleaned:
        return None
    cleaned = os.path.expandvars(os.path.expanduser(cleaned))
    if os.path.isdir(cleaned):
        for relative in (
            ('cmd', 'git.exe'),
            ('bin', 'git.exe'),
            ('usr', 'bin', 'git.exe'),
            ('bin', 'bash.exe'),
            ('usr', 'bin', 'bash.exe'),
            ('git.exe',),
            ('bash.exe',),
        ):
            candidate = os.path.join(cleaned, *relative)
            if _is_file(candidate):
                return candidate
        return None
    return cleaned if _is_file(cleaned) else None


def _default_shell_name():
    return 'bash.exe' if os.name == 'nt' else 'bash'


def _run_probe(command):
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=5,
            shell=False,
            creationflags=_NO_WINDOW,
        )
    except (OSError, subprocess.SubprocessError):
        return ''
    text = f'{result.stdout}\n{result.stderr}'.strip()
    return text.splitlines()[0].strip() if text else ''


def _build_result(git_path, source, bash_path=None):
    install_dirs = []
    candidates = []
    if git_path:
        cmd_dir = os.path.dirname(git_path)
        candidates.extend([cmd_dir, os.path.join(os.path.dirname(cmd_dir), 'bin')])
        candidates.append(os.path.join(os.path.dirname(cmd_dir), 'usr', 'bin'))
    if bash_path:
        bash_dir = os.path.dirname(bash_path)
        candidates.extend([bash_dir, os.path.dirname(bash_dir)])
    for directory in candidates:
        if directory and directory not in install_dirs:
            install_dirs.append(directory)

    if not bash_path:
        for directory in install_dirs:
            for name in ('bash.exe', 'bash'):
                candidate = os.path.join(directory, name)
                if _is_file(candidate):
                    bash_path = candidate
                    break
            if bash_path:
                break

    result = {
        'available': bool(git_path),
        'git_path': git_path,
        'git_version': _run_probe([git_path, '--version']) if git_path else '',
        'source': source or '',
        'git_dirs': install_dirs,
        'download_url': GIT_DOWNLOAD_URL if not git_path else '',
        'shell': {
            'available': bool(bash_path),
            'path': bash_path or '',
            'name': os.path.basename(bash_path) if bash_path else '',
        },
    }
    return result


def resolve_git():
    """Full resolution report consumed by ``/api/git/info`` and the terminal."""
    configured = _expand_install_dir(get_setting('git_path'))
    if configured:
        return _build_result(configured, 'settings')

    found = _which('git')
    if found:
        return _build_result(found, 'path')

    if os.name == 'nt':
        for cmd_dir, bin_dir, usr_bin_dir in _windows_git_installations():
            for candidate in (
                os.path.join(cmd_dir, 'git.exe'),
                os.path.join(bin_dir, 'git.exe'),
                os.path.join(usr_bin_dir, 'git.exe'),
            ):
                if _is_file(candidate):
                    return _build_result(candidate, 'system')

    for root in _candidate_roots():
        bundled = os.path.join(root, 'resources', 'git', 'cmd', 'git.exe')
        if _is_file(bundled):
            return _build_result(bundled, 'bundled')

    shell = resolve_shell()
    return _build_result(None, '', shell['path'])


def resolve_git_path():
    """Just the ``git`` executable path, or ``None`` when unavailable."""
    return resolve_git().get('git_path')


def resolve_shell():
    """Resolve ``bash`` -- the only shell BoronCode ships a terminal for."""
    configured = _expand_install_dir(get_setting('shell_path'))
    if configured:
        return {'available': True, 'path': configured, 'name': os.path.basename(configured), 'source': 'settings'}

    found = _which(_default_shell_name())
    if found:
        return {'available': True, 'path': found, 'name': os.path.basename(found), 'source': 'path'}

    if os.name == 'nt':
        for cmd_dir, bin_dir, usr_bin_dir in _windows_git_installations():
            for candidate in (
                os.path.join(bin_dir, 'bash.exe'),
                os.path.join(usr_bin_dir, 'bash.exe'),
            ):
                if _is_file(candidate):
                    return {'available': True, 'path': candidate, 'name': 'bash.exe', 'source': 'system'}

        for root in _candidate_roots():
            resources = os.path.join(root, 'resources', 'git')
            for candidate in (
                os.path.join(resources, 'usr', 'bin', 'bash.exe'),
                os.path.join(resources, 'bin', 'bash.exe'),
            ):
                if _is_file(candidate):
                    return {'available': True, 'path': candidate, 'name': 'bash.exe', 'source': 'bundled'}

    return {'available': False, 'path': '', 'name': '', 'source': ''}


def shell_search_paths():
    """Directories that must precede ``PATH`` so ``git``/``ssh``/``grep`` work."""
    report = resolve_git()
    paths = list(report.get('git_dirs') or [])
    shell = report.get('shell') or {}
    if shell.get('path'):
        shell_dir = os.path.dirname(shell['path'])
        if shell_dir not in paths:
            paths.append(shell_dir)
    return paths
