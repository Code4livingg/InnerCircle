param(
  [string]$Network = "testnet",
  [string]$Endpoint = "https://api.explorer.provable.com/v1",
  [string[]]$Programs = @()
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$envFile = Join-Path $root ".env"

if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match "^\s*#" -or $_ -match "^\s*$") { return }
    $kv = $_.Split("=", 2)
    if ($kv.Count -eq 2) {
      [Environment]::SetEnvironmentVariable($kv[0], $kv[1])
    }
  }
}

if (-not $env:PRIVATE_KEY) {
  throw "PRIVATE_KEY missing in aleo-contracts/.env"
}

$programArgs = if ($Programs.Count -gt 0) {
  ($Programs | ForEach-Object { "'$_'" }) -join " "
} else {
  ""
}

$wslRoot = (wsl wslpath -a $root).Trim()
wsl bash -lc "cd '$wslRoot' && NETWORK=$Network ENDPOINT=$Endpoint PRIVATE_KEY=$env:PRIVATE_KEY bash deploy.sh $programArgs"
