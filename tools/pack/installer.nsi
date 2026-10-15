; Fairy-DSH-Fresh NSIS installer (built by tools/pack-shell.mjs).
; Defines passed on the command line:
;   /DAPPNAME=Fairy-DSH-Fresh
;   /DVERSION=0.3.8
;   /DSTAGING=<portable root dir>   (the payload; no spaces by design)
;   /DOUTFILE=<absolute output exe>
;
; Default install dir follows the user preference "D:\Program Files"; the
; directory page allows changing it. Admin rights are requested because the
; default target lives under Program Files; the app itself never writes next
; to the exe (its data goes to %LOCALAPPDATA%\Fairy-DSH-Fresh when the
; install dir is not writable).

Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma

!ifndef APPNAME
  !define APPNAME "Fairy-DSH-Fresh"
!endif
!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!define UNINSTKEY "Fairy-DSH-Fresh"

Name "${APPNAME} ${VERSION}"
OutFile "${OUTFILE}"
InstallDir "D:\Program Files\Fairy-DSH-Fresh"
RequestExecutionLevel admin
ShowInstDetails show
ShowUninstDetails show

!include "MUI2.nsh"
!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "${STAGING}\*.*"

  ; Shortcuts use the shipped Fairy eye icon, not the stock electron icon.
  CreateShortcut "$DESKTOP\Fairy-DSH-Fresh.lnk" \
    "$INSTDIR\Fairy-DSH-Fresh.exe" "" "$INSTDIR\resources\app\fairy-eye.ico" 0
  CreateDirectory "$SMPROGRAMS\Fairy-DSH-Fresh"
  CreateShortcut "$SMPROGRAMS\Fairy-DSH-Fresh\Fairy-DSH-Fresh.lnk" \
    "$INSTDIR\Fairy-DSH-Fresh.exe" "" "$INSTDIR\resources\app\fairy-eye.ico" 0
  CreateShortcut "$SMPROGRAMS\Fairy-DSH-Fresh\Uninstall Fairy-DSH-Fresh.lnk" \
    "$INSTDIR\uninstall.exe"

  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTKEY}" \
    "DisplayName" "${APPNAME} ${VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTKEY}" \
    "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTKEY}" \
    "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTKEY}" \
    "QuietUninstallString" "$\"$INSTDIR\uninstall.exe$\" /S"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTKEY}" \
    "DisplayIcon" "$INSTDIR\resources\app\fairy-eye.ico"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTKEY}" \
    "Publisher" "Fairy-DSH-Fresh"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTKEY}" \
    "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTKEY}" \
    "NoRepair" 1
SectionEnd

Section "Uninstall"
  ; Removes the whole install dir including any portable-mode data/ that may
  ; have been created inside it. Installed-mode data lives in %LOCALAPPDATA%
  ; and is intentionally left alone.
  RMDir /r "$INSTDIR"
  Delete "$DESKTOP\Fairy-DSH-Fresh.lnk"
  RMDir /r "$SMPROGRAMS\Fairy-DSH-Fresh"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${UNINSTKEY}"
SectionEnd
