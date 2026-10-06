$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location -LiteralPath $projectRoot
try {
    $nodeMajor = [int]((& node -p 'process.versions.node.split(".")[0]'))
    if ($LASTEXITCODE -ne 0 -or $nodeMajor -ne 24) { throw 'Node.js 24 LTS is required.' }
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    & npm.cmd run dev
    if ($LASTEXITCODE -ne 0) { throw 'Photo Studio failed to start.' }
} finally {
    Pop-Location
}
