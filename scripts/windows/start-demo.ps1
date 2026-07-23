$ErrorActionPreference = "Stop"
$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location -LiteralPath $ProjectDir

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js 24 is not installed. Install it first, then run this script again."
}

if (-not (Test-Path -LiteralPath "node_modules")) {
    Write-Host "Installing the free local dependencies..." -ForegroundColor Cyan
    npm ci
}

if (-not (Test-Path -LiteralPath ".env.local")) {
    Copy-Item -LiteralPath ".env.example" -Destination ".env.local"
    Write-Warning "Created .env.local. Change DEMO_PASSWORD before showing this outside your own PC."
}

Write-Host "Axora demo will open at http://localhost:3000" -ForegroundColor Green
Write-Host "Keep this terminal open. Press Ctrl+C to stop." -ForegroundColor Yellow
npm run dev
