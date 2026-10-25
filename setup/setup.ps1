# Podium one-time setup (Windows).
# Run it by double-clicking "1-SETUP.cmd" in the project folder.
#
# What it does, in order:
#   1. Installs Git and the GitHub CLI (gh) with winget, if they're missing
#   2. Signs you in to GitHub with "gh auth login" (you finish this in your browser)
#   3. Creates the public repository "podium" on your account and uploads the code
#   4. Turns on GitHub Pages so the app gets a web address
#   5. Optionally saves your CollegeFootballData API key as a repository secret
# A log is written to setup\setup-log.txt (it never contains passwords or keys).

$ErrorActionPreference = 'Continue'
$Repo = 'podium'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
Start-Transcript -Path (Join-Path $PSScriptRoot 'setup-log.txt') -Force | Out-Null

function Step($n, $text) {
  Write-Host ''
  Write-Host "[$n/5] $text" -ForegroundColor Cyan
}
function Info($text) { Write-Host "      $text" }
function Ok($text) { Write-Host "      OK: $text" -ForegroundColor Green }
function Fail($text) {
  Write-Host ''
  Write-Host "      PROBLEM: $text" -ForegroundColor Red
  Write-Host '      Tell Claude what this window says; nothing has been broken.' -ForegroundColor Yellow
  Stop-Transcript | Out-Null
  Read-Host 'Press Enter to close'
  exit 1
}
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

Write-Host '=========================================' -ForegroundColor White
Write-Host '  Podium setup' -ForegroundColor White
Write-Host '=========================================' -ForegroundColor White
Info "Project folder: $Root"

# ---------------------------------------------------------------- 1. Tools
Step 1 'Installing Git and the GitHub CLI (skipped if already installed)'
if (-not (Have winget)) {
  Fail 'winget (Windows Package Manager) is missing. Install "App Installer" from the Microsoft Store, then run setup again.'
}
Refresh-Path
if (-not (Have git)) {
  Info 'Installing Git... (if Windows asks for permission, click Yes; if asked to agree to source terms, type Y)'
  winget install --id Git.Git -e --source winget
  Refresh-Path
  if (-not (Have git)) { $env:Path += ';C:\Program Files\Git\cmd' }
}
if (-not (Have git)) { Fail 'Git did not install.' }
Ok (git --version)

if (-not (Have gh)) {
  Info 'Installing GitHub CLI...'
  winget install --id GitHub.cli -e --source winget
  Refresh-Path
  if (-not (Have gh)) { $env:Path += ';C:\Program Files\GitHub CLI' }
}
if (-not (Have gh)) { Fail 'GitHub CLI did not install.' }
Ok ((gh --version) | Select-Object -First 1)

# ---------------------------------------------------------------- 2. Sign in
Step 2 'Signing in to GitHub'
cmd /c "gh auth status --hostname github.com >nul 2>&1"
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host '      >>> BROWSER STEP <<<' -ForegroundColor Yellow
  Write-Host '      In a moment this window shows a ONE-TIME CODE (like ABCD-1234).' -ForegroundColor Yellow
  Write-Host '      Press Enter when asked; your browser opens github.com/login/device.' -ForegroundColor Yellow
  Write-Host '      Sign in to GitHub if needed, type the code, and click Authorize.' -ForegroundColor Yellow
  Write-Host '      Then come back to this window.' -ForegroundColor Yellow
  Write-Host ''
  gh auth login --hostname github.com --git-protocol https --web --scopes workflow
  if ($LASTEXITCODE -ne 0) { Fail 'GitHub sign-in did not finish.' }
}
gh auth setup-git | Out-Null
$login = "$(gh api user --jq .login)".Trim()
$uid = "$(gh api user --jq .id)".Trim()
if (-not $login) { Fail 'Could not read your GitHub username.' }
Ok "Signed in as $login"

# Name and email recorded on commits. Uses GitHub's private no-reply address so
# your real email never appears in the public repository.
if (-not (git config --global user.name)) { git config --global user.name $login }
if (-not (git config --global user.email)) { git config --global user.email "$uid+$login@users.noreply.github.com" }

# ---------------------------------------------------------------- 3. Repository
Step 3 "Creating the repository $login/$Repo and uploading the code"
if (-not (Test-Path (Join-Path $Root '.git'))) {
  git init -b main | Out-Null
}
git add -A
$msgFile = Join-Path $PSScriptRoot 'next-commit-message.txt'
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  if (Test-Path $msgFile) { git commit -q -F $msgFile; Remove-Item $msgFile } else { git commit -q -m 'Initial app shell' }
}

cmd /c "gh repo view $login/$Repo >nul 2>&1"
if ($LASTEXITCODE -ne 0) {
  gh repo create $Repo --public --source . --remote origin --description 'Podium: personal sports stats app (PWA)'
  if ($LASTEXITCODE -ne 0) { Fail 'Could not create the repository.' }
} else {
  Info 'Repository already exists; reusing it.'
  git remote get-url origin *> $null
  if ($LASTEXITCODE -ne 0) { git remote add origin "https://github.com/$login/$Repo.git" }
}
git push -u origin main
if ($LASTEXITCODE -ne 0) { Fail 'Uploading the code (git push) failed.' }
Ok "Code uploaded to https://github.com/$login/$Repo"

# ---------------------------------------------------------------- 4. Pages
Step 4 'Turning on GitHub Pages'
$pagesJson = Join-Path $env:TEMP 'podium-pages.json'
'{"source":{"branch":"main","path":"/"}}' | Set-Content -Path $pagesJson -Encoding ascii
gh api -X POST "repos/$login/$Repo/pages" --input $pagesJson *> $null
if ($LASTEXITCODE -ne 0) {
  gh api "repos/$login/$Repo/pages" *> $null
  if ($LASTEXITCODE -ne 0) { Fail 'Could not turn on GitHub Pages.' }
  Info 'Pages was already on.'
}
Remove-Item $pagesJson -ErrorAction SilentlyContinue
$url = "https://$($login.ToLower()).github.io/$Repo/"
Info 'Waiting for the first build (usually 1-2 minutes)...'
$built = $false
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 6
  $status = (cmd /c "gh api repos/$login/$Repo/pages/builds/latest --jq .status 2>nul")
  if ($status -eq 'built') { $built = $true; break }
  if ($status -eq 'errored') { break }
  Write-Host '.' -NoNewline
}
Write-Host ''
if ($built) { Ok "Your app is live at $url" } else { Info "The site is still building; it will appear at $url within a few minutes." }

# ---------------------------------------------------------------- 5. CFBD key
Step 5 'CollegeFootballData API key (optional now; needed for advanced college stats later)'
Info 'Get a free key at https://collegefootballdata.com/key (they email it to you).'
$answer = Read-Host '      Do you have the key ready to paste now? (y/n)'
if ($answer -match '^[Yy]') {
  Info 'Paste the key and press Enter (it stays hidden and goes straight to GitHub as a secret).'
  gh secret set CFBD_API_KEY --repo "$login/$Repo"
  if ($LASTEXITCODE -eq 0) { Ok 'Saved as the repository secret CFBD_API_KEY.' } else { Info 'Not saved. You can run add-cfbd-key.cmd later.' }
} else {
  Info 'Skipped. Double-click add-cfbd-key.cmd whenever you have it.'
}

Write-Host ''
Write-Host '=========================================' -ForegroundColor Green
Write-Host "  Done. App address: $url" -ForegroundColor Green
Write-Host '=========================================' -ForegroundColor Green
Write-Host "SETUP-RESULT login=$login repo=$login/$Repo url=$url built=$built"
Stop-Transcript | Out-Null
Start-Process $url
Read-Host 'Press Enter to close this window'
