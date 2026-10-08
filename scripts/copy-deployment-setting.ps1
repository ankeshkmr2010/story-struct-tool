param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('GoogleClientId', 'EncryptionKey', 'NeonDatabaseUrl')]
    [string]$Name
)

$ErrorActionPreference = 'Stop'
$storytoolApiRoot = Join-Path (Split-Path $PSScriptRoot -Parent) 'api'
$storytoolPython = Join-Path $storytoolApiRoot '.venv\Scripts\python.exe'
$storytoolField = if ($Name -eq 'GoogleClientId') { 'google_client_id' } else { 'ai_encryption_key' }
Push-Location $storytoolApiRoot
try {
    if ($Name -eq 'NeonDatabaseUrl') {
        $storytoolValue = & $storytoolPython -c "from dotenv import dotenv_values; from pathlib import Path; p=Path('../.env') if Path('../.env').is_file() else Path('../.env.local'); v=dotenv_values(p); print(v.get('DATABASE_URL_UNPOOLED') or v.get('DATABASE_URL') or '')"
    } else {
        $storytoolValue = & $storytoolPython -c "from storytool.config import get_settings; print(getattr(get_settings(), '$storytoolField') or '')"
    }
    if ($LASTEXITCODE -ne 0) { throw 'Unable to read the local setting.' }
    $storytoolValue = ($storytoolValue -join '').Trim()
    if (-not $storytoolValue) { throw "$Name is not configured in api/.env." }
    Set-Clipboard -Value $storytoolValue
    Write-Host "$Name copied to your clipboard. Paste it into Render's matching environment variable. The value was not displayed."
} finally {
    Pop-Location
}
