"""Filesystem anchors shared by every backend module.

Boron Code runs in two shapes:

* development: ``python app/app.py`` or ``python launcher.py`` from the checkout
* frozen: a PyInstaller one-file/one-folder build, where bundled data lives in
  ``sys._MEIPASS`` while the user's settings must live somewhere writable.

This module hides that difference behind a handful of constants so no other
module ever has to look at ``sys._MEIPASS`` directly.
"""

import os
import sys

APP_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(APP_DIR, '..'))

# The editor treats the directory it was started from as the workspace, which is
# also the default Git repository / terminal working directory.
WORKSPACE_ROOT = PROJECT_ROOT

#: Where bundled read-only payloads live (``resources/`` folder in a build).
RESOURCE_ROOT = getattr(sys, '_MEIPASS', None) or PROJECT_ROOT

#: Where ``resources/`` sits next to the executable in a one-folder build.
IN_PLACE_RESOURCE_ROOT = PROJECT_ROOT

#: Frozen builds may not write next to the launcher, so preferences go to the
#: user profile. Development keeps them in the checkout (already gitignored).
SETTINGS_DIR = os.path.join(PROJECT_ROOT, '.boron')
