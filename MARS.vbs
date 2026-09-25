' Quick launch with no console window flash — double-click this to play.
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
exe  = here & "\node_modules\electron\dist\electron.exe"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = here
If fso.FileExists(exe) Then
    ' style 1 (normal) so the game window gets foreground activation / keyboard
    ' focus; electron.exe has no console so there is no flash either way
    sh.Run """" & exe & """ """ & here & """", 1, False
Else
    ' dependencies not installed yet — run the .bat so the install is visible
    sh.Run """" & here & "\MARS.bat""", 1, False
End If
