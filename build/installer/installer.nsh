!macro customInstall
  DetailPrint "Preparing AIstudy runtime dependencies..."
  InitPluginsDir
  File /oname=$PLUGINSDIR\install-aistudy-mysql-runtime.ps1 "${BUILD_RESOURCES_DIR}\installer\install-aistudy-mysql-runtime.ps1"
  File /oname=$PLUGINSDIR\mysql-8.4.7-winx64.zip "${BUILD_RESOURCES_DIR}\installer\mysql-8.4.7-winx64.zip"
  File /oname=$PLUGINSDIR\vc_redist.x64.exe "${BUILD_RESOURCES_DIR}\installer\vc_redist.x64.exe"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\install-aistudy-mysql-runtime.ps1" -MysqlZipPath "$PLUGINSDIR\mysql-8.4.7-winx64.zip" -VcRedistPath "$PLUGINSDIR\vc_redist.x64.exe" -AistudyInstallDir "$INSTDIR"'
  Pop $0
  StrCmp $0 0 done
    MessageBox MB_ICONSTOP|MB_OK "AIstudy runtime dependency installation failed. Setup cannot continue. Please check C:\ProgramData\AIstudy\install-aistudy-public.log."
    Abort
  done:
!macroend
