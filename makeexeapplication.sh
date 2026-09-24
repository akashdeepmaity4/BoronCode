#DISCLAIMER
cd D:/projects/Boroncode
# Change this above path to your root directory

echo starting ...

pyinstaller --noconfirm --onedir --windowed --add-data "templates;templates" --add-data "static;static" launcher.py

echo cleaning dupes ...

mv dist/launcher/launcher.exe launcher.exe
mv launcher.exe BoronCode.exe
rm -rf dist build *.spec

echo Done!

echo starting the application ...

BoronCode.exe