# Save your CollegeFootballData.com API key as the GitHub secret CFBD_API_KEY.
# The key is typed hidden and sent straight to GitHub; it is never stored in the code.
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
$repo = "$(gh repo view --json nameWithOwner --jq .nameWithOwner)".Trim()
Write-Host "Saving CFBD_API_KEY for $repo"
Write-Host 'Get a free key at https://collegefootballdata.com/key if you do not have one.'
Write-Host 'Paste the key and press Enter:'
gh secret set CFBD_API_KEY --repo $repo
if ($LASTEXITCODE -eq 0) { Write-Host 'Saved.' -ForegroundColor Green } else { Write-Host 'Not saved.' -ForegroundColor Red }
Read-Host 'Press Enter to close'
