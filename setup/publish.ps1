# Publish the latest changes to GitHub (double-click "2-PUBLISH-UPDATE.cmd").
# Commits everything in the project folder, merges any data the nightly Action
# committed meanwhile, uploads, and waits for GitHub Pages to rebuild.

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
Start-Transcript -Path (Join-Path $PSScriptRoot 'publish-log.txt') -Force | Out-Null
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

function Done($code) { Stop-Transcript | Out-Null; Read-Host 'Press Enter to close'; exit $code }

Write-Host 'Publishing Podium...' -ForegroundColor Cyan

# If any app file changed, give this release a new version number in sw.js, so phones
# with Podium on the home screen pick it up (the app reloads itself into new versions).
$appChanges = @(git status --porcelain | ForEach-Object { $_.Substring(3) } | Where-Object { $_ -notmatch '^(data|setup)/' })
if ($appChanges.Count -gt 0) {
  $sw = Join-Path $Root 'sw.js'
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $text = [System.IO.File]::ReadAllText($sw, $utf8)
  $stamp = 'v' + (Get-Date -Format 'yyyyMMdd-HHmmss')
  $text = [regex]::Replace($text, "const VERSION = '[^']*'", "const VERSION = '$stamp'")
  [System.IO.File]::WriteAllText($sw, $text, $utf8)
  Write-Host "App version $stamp"
}

git add -A
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  $msgFile = Join-Path $PSScriptRoot 'next-commit-message.txt'
  if (Test-Path $msgFile) { git commit -q -F $msgFile; Remove-Item $msgFile }
  else { git commit -q -m ("Update " + (Get-Date -Format 'yyyy-MM-dd HH:mm')) }
  Write-Host ('Committed: ' + (git log -1 --pretty=%s))
} else {
  Write-Host 'No new changes to commit.'
}

git pull --rebase --autostash origin main
if ($LASTEXITCODE -ne 0) { Write-Host 'PROBLEM: could not merge the latest changes from GitHub. Tell Claude.' -ForegroundColor Red; Done 1 }
git push origin main
if ($LASTEXITCODE -ne 0) { Write-Host 'PROBLEM: upload (git push) failed. Tell Claude.' -ForegroundColor Red; Done 1 }

$repo = "$(gh repo view --json nameWithOwner --jq .nameWithOwner)".Trim()
$owner = $repo.Split('/')[0].ToLower()
$name = $repo.Split('/')[1]
$url = "https://$owner.github.io/$name/"
Write-Host 'Uploaded. Waiting for GitHub Pages to rebuild...'
$built = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 6
  $status = (cmd /c "gh api repos/$repo/pages/builds/latest --jq .status 2>nul")
  if ($status -eq 'built') { $built = $true; break }
  if ($status -eq 'errored') { break }
  Write-Host '.' -NoNewline
}
Write-Host ''
if ($built) { Write-Host "Live: $url" -ForegroundColor Green } else { Write-Host "Still building; check $url in a few minutes." -ForegroundColor Yellow }
Write-Host "PUBLISH-RESULT commit=$(git rev-parse --short HEAD) built=$built url=$url"
Done 0
