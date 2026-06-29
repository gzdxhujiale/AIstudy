!macro customInstall
  DetailPrint "Preparing AIstudy runtime dependencies..."
  InitPluginsDir
  File /oname=$PLUGINSDIR\install-aistudy-mysql-runtime.ps1 "${BUILD_RESOURCES_DIR}\installer\install-aistudy-mysql-runtime.ps1"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\install-aistudy-mysql-runtime.ps1" -AllowDownload -AistudyInstallDir "$INSTDIR"'
  Pop $0
  StrCmp $0 0 done
    MessageBox MB_ICONEXCLAMATION|MB_OK "AIstudy is installed, but runtime dependency setup did not complete. You can open AIstudy now; database sync can be repaired later from C:\ProgramData\AIstudy\install-aistudy-public.log."
  done:
!macroend
