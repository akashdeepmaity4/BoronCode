import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__" and len(sys.argv) == 3 and sys.argv[1] == '--boron-run-python':
    import runpy

    script_path = os.path.abspath(sys.argv[2])
    sys.argv = [script_path]
    sys.path.insert(0, os.path.dirname(script_path))
    runpy.run_path(script_path, run_name='__main__')
    sys.exit(0)

import threading
import webview

try:
    from app.app import app

    print("Successfully imported app and DesktopApi from app.app")
except ImportError as e:
    print(f"Import error: {e}")
    print("Files in current directory:", os.listdir("."))
    sys.exit(1)


class DesktopFileApi:
    """Expose file operations only for files explicitly selected by the user."""

    def __init__(self):
        self._authorized_files = set()
        self._lock = threading.Lock()

    @staticmethod
    def _normalize(path):
        return os.path.normcase(os.path.abspath(path))

    def _authorize(self, path):
        normalized = self._normalize(path)
        with self._lock:
            self._authorized_files.add(normalized)
        return normalized

    def _is_authorized(self, path):
        normalized = self._normalize(path)
        with self._lock:
            return normalized in self._authorized_files

    def open_file_dialog(self):
        selected = webview.windows[0].create_file_dialog(
            webview.OPEN_DIALOG,
            allow_multiple=False,
            file_types=('Text and source files (*.*)', 'All files (*.*)')
        )
        if not selected:
            return None
        path = self._authorize(selected[0])
        with open(path, 'r', encoding='utf-8') as source:
            return {'path': path, 'name': os.path.basename(path), 'content': source.read()}

    def open_folder_dialog(self):
        selected = webview.windows[0].create_file_dialog(webview.FOLDER_DIALOG)
        if not selected:
            return None
        root = os.path.abspath(selected[0])
        tree = {}
        for current, dirs, files in os.walk(root):
            dirs[:] = sorted(name for name in dirs if name != '.git')
            relative = os.path.relpath(current, root)
            node = tree
            if relative != '.':
                for part in relative.split(os.sep):
                    node = node.setdefault(part, {})
            for name in sorted(files):
                path = os.path.join(current, name)
                authorized = self._authorize(path)
                node[name] = {'__desktop_path__': authorized}
        return {'name': os.path.basename(root), 'tree': tree}

    def save_file_dialog(self, suggested_name='untitled.txt'):
        selected = webview.windows[0].create_file_dialog(
            webview.SAVE_DIALOG,
            save_filename=os.path.basename(suggested_name or 'untitled.txt'),
            file_types=('Text and source files (*.*)', 'All files (*.*)')
        )
        return self._authorize(selected[0]) if selected else None

    def write_file(self, path, content):
        if not isinstance(path, str) or not self._is_authorized(path):
            return {'status': 'error', 'message': 'Choose the destination through Save As first.'}
        if not isinstance(content, str):
            return {'status': 'error', 'message': 'File content must be text.'}
        try:
            with open(path, 'w', encoding='utf-8', newline='') as target:
                target.write(content)
            return {'status': 'success', 'path': path}
        except OSError as error:
            return {'status': 'error', 'message': str(error)}

    def delete_file(self, path):
        if not isinstance(path, str) or not self._is_authorized(path):
            return {'status': 'error', 'message': 'File was not selected by the user.'}
        try:
            os.remove(path)
            with self._lock:
                self._authorized_files.discard(self._normalize(path))
            return {'status': 'success'}
        except OSError as error:
            return {'status': 'error', 'message': str(error)}

    def read_file(self, path):
        if not isinstance(path, str) or not self._is_authorized(path):
            return {'status': 'error', 'message': 'File was not selected by the user.'}
        try:
            with open(path, 'r', encoding='utf-8') as source:
                return {'status': 'success', 'content': source.read()}
        except (OSError, UnicodeError) as error:
            return {'status': 'error', 'message': str(error)}

if __name__ == "__main__":
    webview.create_window(
        title="Boron Code",
        url=app,
        width=1920,
        height=1080,
        resizable=True,
        js_api=DesktopFileApi(),
    )
    webview.start()
