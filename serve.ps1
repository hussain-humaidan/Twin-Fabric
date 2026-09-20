# Minimal static file server for Twinfabric.
#
# This machine has no Node.js, Python or other toolchain, and the app uses ES
# modules, which browsers refuse to load from file://. This serves the folder
# over HTTP using only .NET types that ship with Windows.
#
#   powershell -ExecutionPolicy Bypass -File serve.ps1
#   then open http://localhost:8123/
#
# Ctrl+C to stop.
#
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 reads .ps1 files as
# ANSI when there is no BOM, and some UTF-8 bytes decode to smart quotes, which
# the parser treats as string delimiters.

param(
  [int]$Port = 8123,
  [string]$Root = $PSScriptRoot
)

if (-not $Root) { $Root = (Get-Location).Path }

$prefix = "http://localhost:$Port/"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)

try {
  $listener.Start()
} catch {
  Write-Host ("Could not listen on " + $prefix + " - " + $_.Exception.Message) -ForegroundColor Red
  Write-Host "Try another port:  .\serve.ps1 -Port 8200"
  exit 1
}

$mime = @{
  '.html'  = 'text/html'
  '.js'    = 'text/javascript'
  '.mjs'   = 'text/javascript'
  '.css'   = 'text/css'
  '.json'  = 'application/json'
  '.md'    = 'text/markdown'
  '.svg'   = 'image/svg+xml'
  '.png'   = 'image/png'
  '.jpg'   = 'image/jpeg'
  '.ico'   = 'image/x-icon'
  '.woff2' = 'font/woff2'
}

Write-Host ""
Write-Host "  Twinfabric" -ForegroundColor Yellow
Write-Host ("  serving " + $Root)
Write-Host ("  open    " + $prefix) -ForegroundColor Cyan
Write-Host "  Ctrl+C to stop"
Write-Host ""

$fullRoot = [System.IO.Path]::GetFullPath($Root)

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $rawPath = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    if ($rawPath -eq '/') { $rawPath = '/index.html' }

    $relative = $rawPath.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    $file = Join-Path $fullRoot $relative

    $fullFile = ''
    try { $fullFile = [System.IO.Path]::GetFullPath($file) } catch { }

    if ($fullFile -and $fullFile.StartsWith($fullRoot) -and (Test-Path $fullFile -PathType Leaf)) {
      $ext = [System.IO.Path]::GetExtension($fullFile).ToLower()
      $ct = $mime[$ext]
      if (-not $ct) { $ct = 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($fullFile)
      $ctx.Response.StatusCode = 200
      $ctx.Response.ContentType = ($ct + '; charset=utf-8')
      $ctx.Response.Headers.Add('Cache-Control', 'no-cache')
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
      Write-Host ("  200  " + $rawPath)
    } else {
      $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: " + $rawPath)
      $ctx.Response.StatusCode = 404
      $ctx.Response.ContentType = 'text/plain; charset=utf-8'
      $ctx.Response.ContentLength64 = $body.Length
      $ctx.Response.OutputStream.Write($body, 0, $body.Length)
      Write-Host ("  404  " + $rawPath) -ForegroundColor DarkYellow
    }
    $ctx.Response.Close()
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
