# Evaluate JS inside the PACKAGED exe over CDP and print the result.
#
# Usage:
#   powershell -File scripts/probe-cdp.ps1 -Port 9223 -Expression "document.title"
#   powershell -File scripts/probe-cdp.ps1 -Port 9229 -TargetType node -Expression "1+1"
#
# -TargetType picks which debug target to attach to:
#   page (default) -- the renderer. Debug via --remote-debugging-port.
#   node           -- the MAIN process. Debug via --inspect=PORT (this is the only
#                     way to reach main-process objects such as Menu.getApplicationMenu()).
#
# WHY THIS FILE IS ASCII-ONLY (do not add Chinese comments here):
#   Windows PowerShell 5.1 decodes a .ps1 with no BOM using the ANSI codepage
#   (GBK on this machine), NOT UTF-8. UTF-8 Chinese comments therefore turn into
#   mojibake, and a mangled byte pair can decode to a quote or backtick that
#   swallows the rest of the script -- the script then "runs" but silently does
#   the wrong thing. This is the same root cause as the settings.json BOM bug
#   (see design.md D-9). Keep this file 7-bit.
#
# WHY POWERSHELL AND NOT node/curl: the Bash tool sandbox blocks HTTP to
#   localhost, so a failed connect there looks like "the app is dead" when it is
#   not. PowerShell is not subject to that sandbox.

param(
  [int]$Port = 9223,
  [ValidateSet('page', 'node')][string]$TargetType = 'page',
  [Parameter(Mandatory = $true)][string]$Expression
)

$ErrorActionPreference = 'Stop'

# Grab the requested debug target. A packaged app has exactly one of each.
$targets = @(Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 5)
$target = $targets | Where-Object { $_.type -eq $TargetType } | Select-Object -First 1
if ($null -eq $target) { Write-Output "NO_${TargetType}_TARGET"; exit 1 }

$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ct = [System.Threading.CancellationToken]::None
$ws.ConnectAsync([Uri]$target.webSocketDebuggerUrl, $ct).Wait()

$payload = @{
  id     = 1
  method = 'Runtime.evaluate'
  params = @{
    expression    = $Expression
    returnByValue = $true
    awaitPromise  = $true
  }
} | ConvertTo-Json -Depth 10 -Compress

$bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
$ws.SendAsync(
  [ArraySegment[byte]]::new($bytes),
  [System.Net.WebSockets.WebSocketMessageType]::Text,
  $true, $ct
).Wait()

# Read frames until the id=1 response arrives (event frames may come first).
$buffer = New-Object byte[] 1048576
$deadline = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $deadline) {
  $segment = [ArraySegment[byte]]::new($buffer)
  $result = $ws.ReceiveAsync($segment, $ct).Result
  $text = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)

  if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
    Write-Output 'SOCKET_CLOSED'; break
  }

  $msg = $text | ConvertFrom-Json
  if ($msg.id -eq 1) {
    if ($msg.result.exceptionDetails) {
      Write-Output "JS_ERROR: $($msg.result.exceptionDetails.text)"
    } else {
      $msg.result.result.value | ConvertTo-Json -Depth 10
    }
    break
  }
}

$ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', $ct).Wait()
