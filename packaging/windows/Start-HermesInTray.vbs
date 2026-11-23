' Start Hermes Desktop in the tray, without a console window.
'
' The Startup folder runs this through wscript.exe; the work is in Start-HermesInTray.ps1 beside it,
' started hidden and not waited for. Windows hides it, so this only starts the script and returns.

Set fso = CreateObject("Scripting.FileSystemObject")
ps1 = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "Start-HermesInTray.ps1")
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """", 0, False
