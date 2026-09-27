import os
import unittest
from unittest.mock import patch

from app.app import resolve_terminal_command, resolve_terminal_directory


class ResolveTerminalCommandTests(unittest.TestCase):
    def test_create_folder_route_creates_directory_inside_workspace(self):
        from app.app import app, WORKSPACE_ROOT
        client = app.test_client()
        resp = client.post('/create-folder', json={'name': 'qa-folder', 'targetDir': WORKSPACE_ROOT})
        self.assertEqual(resp.status_code, 200)
        payload = resp.get_json()
        self.assertEqual(payload['status'], 'success')
        self.assertTrue(os.path.isdir(payload['path']))
        os.rmdir(payload['path'])

    def test_open_terminal_returns_shell_and_path_metadata(self):
        from app.app import app
        client = app.test_client()
        with patch('app.app.subprocess.Popen') as popen_mock, \
             patch('app.app.resolve_terminal_directory', return_value='C:/workspace'), \
             patch('app.app.resolve_terminal_command', return_value=['cmd.exe', '/c', 'start', 'cmd']):
            resp = client.post('/open-terminal', json={'cwd': 'C:/workspace'})
        self.assertEqual(resp.status_code, 200)
        payload = resp.get_json()
        self.assertEqual(payload['status'], 'success')
        self.assertEqual(payload['shell'], 'cmd.exe')
        self.assertEqual(payload['path'], 'C:/workspace')

    def test_prefers_bash_when_available(self):
        with patch('app.app.shutil.which', return_value='C:\\msys64\\usr\\bin\\bash.exe'), \
             patch('app.app.os.path.exists', return_value=False), \
             patch('app.app.os.name', 'nt'):
            self.assertEqual(
                resolve_terminal_command(),
                ['C:\\msys64\\usr\\bin\\bash.exe'],
            )

    def test_prefers_git_bash_after_bash_is_missing(self):
        with patch('app.app.shutil.which', return_value=None), \
             patch('app.app.os.path.exists', side_effect=lambda path: path == r'C:\Program Files\Git\bin\bash.exe'), \
             patch('app.app.os.name', 'nt'):
            self.assertEqual(
                resolve_terminal_command(),
                [r'C:\Program Files\Git\bin\bash.exe', '--login', '-i'],
            )

    def test_uses_start_menu_shortcut_before_cmd(self):
        shortcut = r'C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Git\Git Bash.lnk'
        with patch('app.app.shutil.which', return_value=None), \
             patch('app.app.os.path.exists', side_effect=lambda path: path == shortcut), \
             patch('app.app.os.name', 'nt'):
            self.assertEqual(
                resolve_terminal_command(),
                ['cmd.exe', '/c', 'start', '', shortcut],
            )

    def test_defaults_to_c_drive_when_no_opened_directory_exists(self):
        with patch('app.app.os.name', 'nt'):
            self.assertEqual(resolve_terminal_directory(None), os.path.normpath('C:/'))

    def test_falls_back_to_cmd_when_no_bash_or_git_bash_exists(self):
        with patch('app.app.shutil.which', return_value=None), \
             patch('app.app.os.path.exists', return_value=False), \
             patch('app.app.os.name', 'nt'):
            self.assertEqual(
                resolve_terminal_command(),
                ['cmd.exe', '/c', 'start', 'cmd'],
            )


if __name__ == '__main__':
    unittest.main()
