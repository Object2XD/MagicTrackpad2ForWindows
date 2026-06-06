# AmtPtpControlBridge

Small .NET Framework 4.7.2 command bridge for the Electron control panel. The
process prints one JSON object to stdout and uses non-zero exit codes for
structured failures.

## Commands

```powershell
AmtPtpControlBridge.exe read-settings
AmtPtpControlBridge.exe write-settings "{""settings"":{""clickMode"":""macos"",""feedbackLevel"":1,""silentClicking"":false,""stopMode"":""pressure"",""stopPressure"":0,""ignoreButtonFinger"":true,""ignoreNearFingers"":true,""palmRejection"":true}}"
AmtPtpControlBridge.exe apply-settings "{""settings"":{""clickMode"":""maximum-feedback"",""stopMode"":""do-nothing""}}"
AmtPtpControlBridge.exe get-battery
AmtPtpControlBridge.exe open-touchpad-settings
```

`write-settings` and `apply-settings` also accept the JSON payload from stdin if
the second command-line argument is omitted.

## Settings schema

`clickMode` is one of `macos`, `disable-feedback`, or `maximum-feedback`.
`feedbackLevel` is `0`, `1`, or `2` and matches the original WinForms slider.
`silentClicking` only affects `macos` click mode. `stopMode` is one of
`do-nothing`, `pressure`, or `size`; `stopPressure` and `stopSize` must be
greater than or equal to zero when their mode is selected.
