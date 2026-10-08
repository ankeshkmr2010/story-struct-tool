$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$statePath = Join-Path $root '.storytool-share.local'
$webPath = Join-Path $root 'web'
$port = 5174

if (Test-Path -LiteralPath $statePath) {
    throw 'A StoryTool share is already recorded. Run scripts/stop-share.ps1 first.'
}

try {
    $config = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/auth/config' -TimeoutSec 5
    if (-not $config.google_client_id) {
        throw 'Set STORYTOOL_GOOGLE_CLIENT_ID in api/.env and restart the API before sharing.'
    }
    try {
        $stories = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/stories' -UseBasicParsing -TimeoutSec 5
        throw "The API exposed stories without sign-in (HTTP $($stories.StatusCode)). Restart the updated API before sharing."
    } catch {
        if ($_.Exception.Response.StatusCode -ne 401) { throw }
    }
} catch {
    throw "The API is not ready for private sharing: $($_.Exception.Message)"
}

$ngrokLog = Join-Path $env:TEMP "storytool-ngrok-$PID.log"
$viteLog = Join-Path $env:TEMP "storytool-vite-$PID.log"
$ngrok = $null
$vite = $null
try {
    $ngrok = Start-Process -FilePath (Get-Command ngrok).Source `
        -ArgumentList @('http', "$port") `
        -WindowStyle Hidden -PassThru -RedirectStandardError $ngrokLog

    $publicUrl = $null
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Seconds 1
        if ($ngrok.HasExited) { throw "ngrok exited. Check $ngrokLog" }
        try {
            $tunnels = Invoke-RestMethod -Uri 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 2
            $publicUrl = @($tunnels.tunnels | Where-Object { $_.public_url -like 'https://*' -and $_.config.addr -match ":$port$" })[0].public_url
            if ($publicUrl) { break }
        } catch { }
    }
    if (-not $publicUrl) { throw "ngrok did not provide a URL. Check $ngrokLog" }

    $hostName = ([uri]$publicUrl).Host
    $localVite = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    $nodeExecutable = if ($localVite) {
        (Get-CimInstance Win32_Process -Filter "ProcessId = $($localVite.OwningProcess)").ExecutablePath
    } else {
        (Get-Command node).Source
    }
    if (-not $nodeExecutable) { throw 'Could not locate Node.js for the shared frontend.' }
    $oldAllowedHosts = $env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS
    $env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = $hostName
    try {
        $vite = Start-Process -FilePath $nodeExecutable `
            -ArgumentList @('node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', "$port", '--strictPort') `
            -WorkingDirectory $webPath -WindowStyle Hidden -PassThru -RedirectStandardError $viteLog
    } finally {
        $env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = $oldAllowedHosts
    }

    $ready = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Seconds 1
        if ($vite.HasExited) { throw "Vite exited. Check $viteLog" }
        try {
            $page = Invoke-WebRequest -Uri "http://127.0.0.1:$port/" -Headers @{ Host = $hostName } -UseBasicParsing -TimeoutSec 2
            $api = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/auth/config" -Headers @{ Host = $hostName } -TimeoutSec 2
            if ($page.StatusCode -eq 200 -and $api.google_client_id -eq $config.google_client_id) { $ready = $true; break }
        } catch { }
    }
    if (-not $ready) { throw "The shared frontend or API proxy did not become ready. Check $viteLog" }

    @{ ngrok_pid = $ngrok.Id; vite_pid = $vite.Id; url = $publicUrl } |
        ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8

    Write-Host "Shared URL: $publicUrl"
    Write-Host 'Google sign-in is required in the app. Each account sees its own stories.'
    Write-Host 'Run scripts/stop-share.ps1 to close the public URL.'
} catch {
    if ($vite) { Stop-Process -Id $vite.Id -Force -ErrorAction SilentlyContinue }
    if ($ngrok) { Stop-Process -Id $ngrok.Id -Force -ErrorAction SilentlyContinue }
    throw
}
