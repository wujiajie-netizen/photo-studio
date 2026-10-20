$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$deploymentRoot = Join-Path $projectRoot 'data/deployment'
$recordPath = Join-Path $deploymentRoot 'online-process.json'
if (-not (Test-Path -LiteralPath $recordPath)) { Write-Output 'Online service is not running.'; return }
$record = Get-Content -LiteralPath $recordPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($record.root -ne $projectRoot) { throw 'Process record does not belong to this workspace.' }
$driver = Get-CimInstance Win32_Process -Filter "ProcessId = $($record.pid)"
if (-not $driver) { Remove-Item -LiteralPath $recordPath; Write-Output 'Removed stale process record.'; return }
if ($driver.Name -ne 'node.exe' -or $driver.CommandLine -notmatch 'scripts[\\/]online\.mjs' -or [Math]::Abs(([DateTimeOffset]$driver.CreationDate).ToUnixTimeMilliseconds() - $record.startedAt) -gt 3000) { throw 'Recorded process identity has changed; refusing to stop it.' }
# 通过停止标记让服务先关闭 SSE、任务与数据库；超时才清理已核验进程的后代。
[System.IO.File]::WriteAllText((Join-Path $deploymentRoot 'online.stop'), 'stop')
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Seconds 1
    if (-not (Get-Process -Id $record.pid -ErrorAction SilentlyContinue)) { Write-Output 'Online service stopped.'; return }
}
$processes = @(Get-CimInstance Win32_Process)
$targets = [System.Collections.Generic.List[int]]::new()
$targets.Add([int]$record.pid)
for ($index = 0; $index -lt $targets.Count; $index++) { foreach ($child in $processes | Where-Object ParentProcessId -eq $targets[$index]) { $targets.Add([int]$child.ProcessId) } }
foreach ($targetId in $targets) { Stop-Process -Id $targetId -Force -ErrorAction SilentlyContinue }
Remove-Item -LiteralPath $recordPath -ErrorAction SilentlyContinue
Write-Output 'Online service stopped.'
