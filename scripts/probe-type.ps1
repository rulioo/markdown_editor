# Type into the packaged app's editor over CDP and read back the result.
# ASCII-only: see the encoding note in probe-cdp.ps1.

param(
  [int]$Port = 9223,
  [Parameter(Mandatory = $true)][string]$Text,
  # Select-all + delete first, so a previous run's text cannot be mistaken for
  # a double-insert bug in this one.
  [switch]$Clear
)

$ErrorActionPreference = 'Stop'

$targets = @(Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 5)
$page = $targets | Where-Object { $_.type -eq 'page' } | Select-Object -First 1
if ($null -eq $page) { Write-Output 'NO_PAGE_TARGET'; exit 1 }

$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ct = [System.Threading.CancellationToken]::None
$ws.ConnectAsync([Uri]$page.webSocketDebuggerUrl, $ct).Wait()

function Send-Cdp($id, $method, $params) {
  $payload = @{ id = $id; method = $method; params = $params } |
    ConvertTo-Json -Depth 10 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
  $ws.SendAsync(
    [ArraySegment[byte]]::new($bytes),
    [System.Net.WebSockets.WebSocketMessageType]::Text,
    $true, $ct
  ).Wait()
}

function Read-Cdp($wantId) {
  $buffer = New-Object byte[] 1048576
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline) {
    $segment = [ArraySegment[byte]]::new($buffer)
    $result = $ws.ReceiveAsync($segment, $ct).Result
    $text = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)
    if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
      return $null
    }
    $msg = $text | ConvertFrom-Json
    if ($msg.id -eq $wantId) { return $msg }
  }
  return $null
}

# Focus the editor first, otherwise insertText goes nowhere.
Send-Cdp 1 'Runtime.evaluate' @{ expression = 'document.querySelector(".cm-content").focus()'; returnByValue = $true }
Read-Cdp 1 | Out-Null

if ($Clear) {
  # Ctrl+A then Delete, dispatched as real key events so CM6 handles them.
  foreach ($k in @(
      @{ key = 'a'; code = 'KeyA'; vk = 65; mods = 2 },
      @{ key = 'Delete'; code = 'Delete'; vk = 46; mods = 0 }
    )) {
    foreach ($phase in @('keyDown', 'keyUp')) {
      Send-Cdp 10 'Input.dispatchKeyEvent' @{
        type = $phase; key = $k.key; code = $k.code
        windowsVirtualKeyCode = $k.vk; nativeVirtualKeyCode = $k.vk
        modifiers = $k.mods
      }
      Read-Cdp 10 | Out-Null
    }
  }
  Start-Sleep -Milliseconds 300
}

# InsertText goes through the real input path, so CM6 handles it like a human typing.
Send-Cdp 2 'Input.insertText' @{ text = $Text }
Read-Cdp 2 | Out-Null

Start-Sleep -Milliseconds 800

# Read back what the document now holds plus the whole status bar.
# NOTE: no Chinese literals in here -- this file must stay 7-bit (see probe-cdp.ps1).
# The status bar text is returned whole and matched by the caller instead.
$probe = 'JSON.stringify({ doc: document.querySelector(".cm-content").innerText, lines: document.querySelectorAll(".cm-line").length, status: document.body.innerText })'
Send-Cdp 3 'Runtime.evaluate' @{ expression = $probe; returnByValue = $true }
$res = Read-Cdp 3
if ($null -eq $res) {
  Write-Output 'NO_RESPONSE'
} elseif ($res.result.exceptionDetails) {
  Write-Output "JS_ERROR: $($res.result.exceptionDetails.text)"
} else {
  $res.result.result.value
}

$ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', $ct).Wait()
