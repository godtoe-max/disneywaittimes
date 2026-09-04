Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
' Run start_updater.bat invisibly (window style 0 = hidden)
WshShell.Run "cmd /c python run.py", 0, False
Set WshShell = Nothing
