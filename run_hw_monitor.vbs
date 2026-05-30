' Hardware Monitor — silent launcher (no console window)
Set WshShell = CreateObject("WScript.Shell")
projectDir = WshShell.CurrentDirectory
cmd = "pythonw.exe """ & projectDir & "\hardware_monitor.py"""
WshShell.Run cmd, 0, False
