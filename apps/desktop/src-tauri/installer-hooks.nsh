!macro NSIS_HOOK_PREINSTALL
  RMDir /r "$INSTDIR\engine"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --forget-chain-secrets'
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\vivePDF.Document"
  DeleteRegValue HKCU "Software\Classes\.pdf\OpenWithProgids" "vivePDF.Document"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\vivePDF"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.docx\shell\vivePDF"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.doc\shell\vivePDF"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.xlsx\shell\vivePDF"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.xls\shell\vivePDF"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pptx\shell\vivePDF"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.ppt\shell\vivePDF"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.odt\shell\vivePDF"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.ods\shell\vivePDF"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.odp\shell\vivePDF"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.rtf\shell\vivePDF"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.txt\shell\vivePDF"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.md\shell\vivePDF"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.html\shell\vivePDF"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.htm\shell\vivePDF"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.jpg\shell\vivePDF"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.jpeg\shell\vivePDF"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.png\shell\vivePDF"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.webp\shell\vivePDF"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.bmp\shell\vivePDF"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.gif\shell\vivePDF"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.tif\shell\vivePDF"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.tiff\shell\vivePDF"
  DeleteRegKey HKCU "Software\Classes\Applications\vivePDF.exe"
  DeleteRegKey HKCU "Software\vivePDF"
  DeleteRegValue HKCU "Software\RegisteredApplications" "vivePDF"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "vivePDF"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "vivePDF"
  Delete "$SENDTO\vivePDF.lnk"
  RMDir /r "$INSTDIR\engine"
!macroend
