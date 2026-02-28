; RawRequest Windows Installer
; Built with NSIS (Nullsoft Scriptable Install System)

!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "WordFunc.nsh"

; --------------------------------
; General Configuration
; --------------------------------

!define PRODUCT_NAME "RawRequest"
!define PRODUCT_PUBLISHER "portablesheep"
!define PRODUCT_WEB_SITE "https://github.com/portablesheep/RawRequest"
!define PRODUCT_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"
!define PRODUCT_UNINST_ROOT_KEY "HKLM"

; Version will be passed in via command line: makensis -DVERSION=1.0.0 installer.nsi
!ifndef VERSION
  !define VERSION "1.0.0"
!endif

; Paths can be overridden via command line: makensis -DSTAGING_DIR=path\to\staging
; Default paths are relative to repo root (where makensis is invoked from)
!ifndef STAGING_DIR
  !define STAGING_DIR "dist\releases\installer-staging"
!endif

!ifndef OUT_DIR
  !define OUT_DIR "dist\releases"
!endif

Name "${PRODUCT_NAME} ${VERSION}"
OutFile "${OUT_DIR}\${PRODUCT_NAME}-${VERSION}-windows-setup.exe"
InstallDir "$PROGRAMFILES64\${PRODUCT_NAME}"
InstallDirRegKey HKLM "${PRODUCT_UNINST_KEY}" "InstallLocation"
ShowInstDetails show
ShowUnInstDetails show
RequestExecutionLevel admin

; --------------------------------
; Variables
; --------------------------------

Var AddToPath

; --------------------------------
; Modern UI Configuration
; --------------------------------

!define MUI_ABORTWARNING
; Icon paths are relative to the .nsi file location
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"

; Welcome page
!insertmacro MUI_PAGE_WELCOME

; Directory page
!insertmacro MUI_PAGE_DIRECTORY

; Components page (for PATH option)
!insertmacro MUI_PAGE_COMPONENTS

; Instfiles page
!insertmacro MUI_PAGE_INSTFILES

; Finish page
!define MUI_FINISHPAGE_RUN "$INSTDIR\${PRODUCT_NAME}.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${PRODUCT_NAME}"
!insertmacro MUI_PAGE_FINISH

; Uninstaller pages
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; Language
!insertmacro MUI_LANGUAGE "English"

; --------------------------------
; Installer Sections
; --------------------------------

Section "RawRequest (required)" SEC_MAIN
  SectionIn RO
  SetOutPath "$INSTDIR"
  SetOverwrite on

  ; Main application
  File "${STAGING_DIR}\${PRODUCT_NAME}.exe"

  ; Updater helper (required for auto-updates)
  File "${STAGING_DIR}\rawrequest-updater.exe"

  ; CLI alias (lowercase for terminal usage)
  CopyFiles /SILENT "$INSTDIR\${PRODUCT_NAME}.exe" "$INSTDIR\rawrequest.exe"

  ; Service launcher command
  FileOpen $0 "$INSTDIR\rawrequest-service.cmd" w
  FileWrite $0 '@echo off$\r$\n"$INSTDIR\rawrequest.exe" service %*$\r$\n'
  FileClose $0

  ; Create shortcuts
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_NAME}.exe"
  CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall.lnk" "$INSTDIR\uninstall.exe"
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_NAME}.exe"

  ; Write uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Write registry keys for Add/Remove Programs
  WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "URLInfoAbout" "${PRODUCT_WEB_SITE}"
  WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegDWORD ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "NoModify" 1
  WriteRegDWORD ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "NoRepair" 1

  ; Get installed size
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "EstimatedSize" "$0"
SectionEnd

Section "Add to PATH (enables rawrequest CLI & MCP)" SEC_PATH
  ; Record that PATH was modified so uninstaller can remove it
  WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "AddedToPath" "1"

  ; Read current system PATH
  ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"

  ; Check if already present
  ${WordFind} "$0" "$INSTDIR" "E+1{" $1
  IfErrors 0 path_already_set
    ; Append install dir to system PATH
    WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "$0;$INSTDIR"
    ; Broadcast WM_SETTINGCHANGE so running shells pick up the change
    SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
  path_already_set:
SectionEnd

; Section descriptions
!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_MAIN} "Install RawRequest application and auto-updater."
  !insertmacro MUI_DESCRIPTION_TEXT ${SEC_PATH} "Add RawRequest to the system PATH so you can use 'rawrequest mcp', 'rawrequest service', and 'rawrequest run' from any terminal."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; --------------------------------
; Uninstaller Section
; --------------------------------

Section "Uninstall"
  ; Kill running instance if any
  nsExec::ExecToLog 'taskkill /f /im ${PRODUCT_NAME}.exe'

  ; Remove files
  Delete "$INSTDIR\${PRODUCT_NAME}.exe"
  Delete "$INSTDIR\rawrequest.exe"
  Delete "$INSTDIR\rawrequest-updater.exe"
  Delete "$INSTDIR\rawrequest-service.cmd"
  Delete "$INSTDIR\uninstall.exe"

  ; Remove shortcuts
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall.lnk"
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  RMDir "$SMPROGRAMS\${PRODUCT_NAME}"

  ; Remove from PATH if we added it
  ReadRegStr $0 ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "AddedToPath"
  StrCmp $0 "1" 0 skip_path_removal
    ReadRegStr $1 HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path"
    ; Remove our entry (;$INSTDIR or $INSTDIR; patterns)
    ${WordReplace} "$1" ";$INSTDIR" "" "+" $2
    ${WordReplace} "$2" "$INSTDIR;" "" "+" $2
    ${WordReplace} "$2" "$INSTDIR" "" "+" $2
    WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "$2"
    SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
  skip_path_removal:

  ; Remove install directory (only if empty)
  RMDir "$INSTDIR"

  ; Remove registry keys
  DeleteRegKey ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}"

  SetAutoClose true
SectionEnd

; --------------------------------
; Version Information
; --------------------------------

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey "CompanyName" "${PRODUCT_PUBLISHER}"
VIAddVersionKey "LegalCopyright" "© ${PRODUCT_PUBLISHER}"
VIAddVersionKey "FileDescription" "${PRODUCT_NAME} Installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
