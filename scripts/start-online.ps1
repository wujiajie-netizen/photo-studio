$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$deploymentRoot = Join-Path $projectRoot 'data/deployment'
New-Item -ItemType Directory -Force -Path $deploymentRoot | Out-Null
$recordPath = Join-Path $deploymentRoot 'online-process.json'
if (Test-Path -LiteralPath $recordPath) {
    $record = Get-Content -LiteralPath $recordPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (Get-Process -Id $record.pid -ErrorAction SilentlyContinue) { throw 'Online service is already running.' }
}
$nodePath = (Get-Command node.exe).Source
$process = Start-Process -FilePath $nodePath -ArgumentList ('"' + (Join-Path $PSScriptRoot 'online.mjs') + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $deploymentRoot 'online.stdout.log') -RedirectStandardError (Join-Path $deploymentRoot 'online.stderr.log') -PassThru
Start-Sleep -Seconds 2
if ($process.HasExited) { Get-Content -LiteralPath (Join-Path $deploymentRoot 'online.stderr.log'); throw 'Online startup failed.' }
Write-Output 'Starting online service. Read data/deployment/status.json for the HTTPS URL.'
