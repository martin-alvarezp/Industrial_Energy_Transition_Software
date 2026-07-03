' Envoltorio silencioso del lanzador: el acceso directo del Escritorio apunta
' aqui para que no aparezca ninguna consola.
Set sh = CreateObject("Wscript.Shell")
dir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & dir & "\IETO.ps1""", 0, False