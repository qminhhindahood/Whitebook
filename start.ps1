param(
    [switch]$NoBrowser,
    [switch]$SkipInstall,
    [switch]$SkipBuild,
    [string]$DataDir = (Join-Path $PSScriptRoot "data")
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw "Whitebook requires uv. Install uv, then run start.ps1 again."
}

if (-not $SkipInstall) {
    & uv sync --locked
    if ($LASTEXITCODE -ne 0) {
        throw "Whitebook's Python dependencies could not be prepared."
    }

    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw "Whitebook requires Node.js and npm. Install them, then run start.ps1 again."
    }

    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot "web\node_modules"))) {
        & npm --prefix web ci
        if ($LASTEXITCODE -ne 0) {
            throw "Whitebook's browser dependencies could not be prepared."
        }
    }
}

if (-not $SkipBuild) {
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        throw "Whitebook requires Node.js and npm. Install them, then run start.ps1 again."
    }

    & npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "Whitebook's browser interface could not be built."
    }
}

$launcherArguments = @("run", "whitebook", "--data-dir", $DataDir)
if ($NoBrowser) {
    $launcherArguments += "--no-browser"
}

& uv @launcherArguments
exit $LASTEXITCODE
