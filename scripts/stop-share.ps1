$statePath = Join-Path (Split-Path -Parent $PSScriptRoot) '.storytool-share.local'
if (-not (Test-Path -LiteralPath $statePath)) {
    Write-Host 'No StoryTool share is recorded.'
    exit 0
}

$share = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
Stop-Process -Id $share.ngrok_pid -Force -ErrorAction SilentlyContinue
Stop-Process -Id $share.vite_pid -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $statePath
Write-Host 'StoryTool public URL closed.'
