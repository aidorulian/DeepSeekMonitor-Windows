; DeepSeek Monitor Windows 安装脚本
; 由 electron-builder 生成后手动定制

!include "MUI2.nsh"

Name "DeepSeek Monitor"
OutFile "DeepSeekMonitor-Setup.exe"
InstallDir "$PROGRAMFILES64\DeepSeek Monitor"
RequestExecutionLevel admin

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "..\dist\win-unpacked\*.*"

  CreateDirectory "$SMPROGRAMS\DeepSeek Monitor"
  CreateShortCut "$SMPROGRAMS\DeepSeek Monitor\DeepSeek Monitor.lnk" "$INSTDIR\DeepSeek Monitor.exe"
  CreateShortCut "$DESKTOP\DeepSeek Monitor.lnk" "$INSTDIR\DeepSeek Monitor.exe"
  CreateShortCut "$SMSTARTUP\DeepSeek Monitor.lnk" "$INSTDIR\DeepSeek Monitor.exe"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\DeepSeekMonitor" "DisplayName" "DeepSeek Monitor"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\DeepSeekMonitor" "UninstallString" "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$INSTDIR\*.*"
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\DeepSeek Monitor\DeepSeek Monitor.lnk"
  RMDir "$SMPROGRAMS\DeepSeek Monitor"
  Delete "$DESKTOP\DeepSeek Monitor.lnk"
  Delete "$SMSTARTUP\DeepSeek Monitor.lnk"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\DeepSeekMonitor"
SectionEnd
