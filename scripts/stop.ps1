$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$recordPath = Join-Path $projectRoot 'data/dev-process.json'
if (-not (Test-Path -LiteralPath $recordPath)) {
    Write-Output 'Photo Studio is not running.'
    return
}
$record = Get-Content -LiteralPath $recordPath -Raw -Encoding utf8 | ConvertFrom-Json
if ($record.root -ne $projectRoot) { throw 'Process record does not belong to this workspace.' }
$driver = Get-CimInstance Win32_Process -Filter "ProcessId = $($record.pid)"
if (-not $driver) {
    Remove-Item -LiteralPath $recordPath
    Write-Output 'Removed stale process record.'
    return
}
if ($driver.Name -ne 'node.exe' -or $driver.CommandLine -notmatch 'scripts[\\/]dev\.mjs') {
    throw 'Recorded process is not the Photo Studio launcher; refusing to stop it.'
}
if ([Math]::Abs(([DateTimeOffset]$driver.CreationDate).ToUnixTimeMilliseconds() - $record.startedAt) -gt 3000) {
    throw 'Recorded process identity has changed; refusing to stop it.'
}
# 仅停止启动器的后代进程；先停止启动器，避免子进程退出触发启动器重复清理。
$processes = @(Get-CimInstance Win32_Process)
$targets = [System.Collections.Generic.List[int]]::new()
$targets.Add([int]$record.pid)
for ($index = 0; $index -lt $targets.Count; $index++) {
    foreach ($child in $processes | Where-Object ParentProcessId -eq $targets[$index]) {
        $targets.Add([int]$child.ProcessId)
    }
}
foreach ($targetId in $targets) { Stop-Process -Id $targetId -Force -ErrorAction SilentlyContinue }
Remove-Item -LiteralPath $recordPath -ErrorAction SilentlyContinue
Write-Output 'Photo Studio stopped.'
