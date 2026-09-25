# BORON CODE - v1.0.1 Stable Release 

![Python](https://img.shields.io/badge/python-3670A0?style=for-the-badge&logo=python&logoColor=ffdd54) ![Bash](https://img.shields.io/badge/Bash-1f425f?style=for-the-badge&logo=gnu-bash&logoColor=white) ![HTML5](https://img.shields.io/badge/html5-%23E34F26.svg?style=for-the-badge&logo=html5&logoColor=white) ![Git](https://img.shields.io/badge/git-%23F05033.svg?style=for-the-badge&logo=git&logoColor=white) ![GitHub](https://img.shields.io/badge/github-%23121011.svg?style=for-the-badge&logo=github&logoColor=white) ![Flask](https://img.shields.io/badge/flask-%23000.svg?style=for-the-badge&logo=flask&logoColor=white)
 
## WHAT'S NEW 🚀
![License](https://img.shields.io/badge/license-MIT-blue) ![Version](https://img.shields.io/badge/version-1.0.0-brightgreen)

✅ Implemented a native Chat Window to use AI locally or via an API* (Under testing)

✅ Implemented Monaco Editor as the IDE's formatter and code canvas, getting rid of the manual breakage-prone overhead 

✅ Added Anti-SQL Injection protocols on all input fields.


## Trademark and Copyright infringement prevention

This is not in any way a tutorial, or a copy of any other 'editor', 'brand' or 'product'. Any similarities are purely coincidental. The author will NOT be held responsible for any forks or copies of this software which may immitate any of the above mentioned items.


> ATTENTION: This is a brief introduction to this project, meant for onboarding and getting started. To see examples, details, project explainations and implementation, refer to [Here](workflowandcontext.md)

## FEATURES

1. Monaco Editor as the IDE's code canvas and formatter

1. Sidebar and toolbar similar to popular IDEs 

1. Very small size and RAM footprint

1. Custom indentation for each Language


## HIGHLIGHTS

1. A custom native window for chatting with AI, whether with a Local Model or via an API

1. Can be run on all devices, from old legacy devices to modern powerhorses

1. Can be used on Localhost, natively as a Webapp, or a full-pledged windows app

1. Data stays on your Drive (Your WIFI company may still get the metadata during localhost use)



## SHORTCUTS


| Shortcut | Action | Implementation |
| --- | --- | --- |
| `Ctrl + N` | New file in root/target directory | Triggers sidebar button or fallback prompt |
| `Ctrl + Shift + N` | Fresh window ("No file open") | Resets active file state and clears editor canvas |
| `Ctrl + `` | Open default Bash or CMD terminal | Calls `POST /open-terminal` |
| `Ctrl + S` | Save active file | Calls `POST /save-file` |
| `Ctrl + Z` | Undo inside editor | Executes `document.execCommand('undo')` |
| `Ctrl + Y` | Redo inside editor | Executes `document.execCommand('redo')` |
| `Ctrl + X` | Cut selected text | Executes `document.execCommand('cut')` |
| `Ctrl + C` | Copy selected text | Executes `document.execCommand('copy')` |
| `Ctrl + V` | Paste copied text | Standard native canvas paste |
| `Ctrl + K` -> `Ctrl + O` | Open directory picker | Triggers folder input picker |
| `Ctrl + O` | Open single file picker | Triggers file input picker |



## DEPENDENCIES


- Python 3.8+ (3.13+ recommended)

- Flask (Non-Negotiable)

- Pywebview (For PWA)

- Pyinstaller (For Windows Application)

- Bash (required for Linux / Mac, highly recommended for Windows)



## INSTALL DEPENDENCIES

```

pip install -r requirements.txt

```


## HOW TO USE


### 1. Windows Application (Recommended for all windows users)

1. Download the latest release from [here](https://github.com/BoronSoftware/Boron-code/releases)


(comming soon...)



### 2. Progressive Webapp (Recommended for Linux / Mac users)

1. Download the codebase.

2. Run Bash or Cmd in root directory of the codebase.

3. install the dependencies

4. run 'launcher.py' to launch the PWA (entire codebase should be downloaded to prevent any errors)


```

cd path/to/root/directory

python launcher.py

```
