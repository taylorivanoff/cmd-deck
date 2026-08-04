!macro customInstall
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "CmdDeck" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --start-minimised'
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "CmdDeck"
!macroend
