import type { AppProfileModule } from "../../types.js";

const appProfile = {
  "name": "developer",
  "description": "Developer workstation baseline for Windows endpoint simulations.",
  "apps": [
    {
      "id": "git",
      "name": "Git for Windows",
      "method": "exe",
      "url": "https://github.com/git-for-windows/git/releases/download/v2.54.0.windows.1/Git-2.54.0-64-bit.exe",
      "args": [
        "/VERYSILENT",
        "/NORESTART",
        "/NOCANCEL",
        "/SP-",
        "/CLOSEAPPLICATIONS",
        "/RESTARTAPPLICATIONS",
        "/COMPONENTS=icons,ext\\reg\\shellhere,assoc,assoc_sh"
      ],
      "verify": {
        "command": "if (Get-Command git.exe -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
      }
    },
    {
      "id": "nodejs-lts",
      "name": "Node.js LTS",
      "method": "powershell",
      "command": `$InstallerDir = 'C:\\ProgramData\\panw-broker\\installers'
New-Item -ItemType Directory -Force -Path $InstallerDir | Out-Null
$IndexUri = 'https://nodejs.org/dist/index.json'
$Releases = Invoke-RestMethod -UseBasicParsing -Uri $IndexUri
$Release = $Releases | Where-Object { $_.lts -and ($_.files -contains 'win-x64-msi') } | Select-Object -First 1
if (-not $Release) {
  throw "Could not find a Node.js LTS win-x64 MSI release in $IndexUri."
}

$Version = [string] $Release.version
$InstallerPath = Join-Path $InstallerDir "node-$Version-x64.msi"
$DownloadUri = "https://nodejs.org/dist/$Version/node-$Version-x64.msi"
Write-Host "Installing Node.js $Version from $DownloadUri"
Invoke-WebRequest -UseBasicParsing -Uri $DownloadUri -OutFile $InstallerPath -ErrorAction Stop

$MsiArgs = @('/i', ('"' + $InstallerPath + '"'), '/qn', '/norestart')
$Process = Start-Process -FilePath 'msiexec.exe' -ArgumentList $MsiArgs -Wait -PassThru
Write-Host "Node.js installer exit code: $($Process.ExitCode)"
if (@(0, 3010) -notcontains $Process.ExitCode) {
  throw "Node.js installer exited with code $($Process.ExitCode)."
}

$MachinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
$UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$env:Path = "$MachinePath;$UserPath"
node --version
npm --version
`,
      "verify": {
        "command": "if (Get-Command node.exe -ErrorAction SilentlyContinue) { node --version; exit 0 } else { exit 1 }"
      }
    },
    {
      "id": "python-requests",
      "name": "Python requests package",
      "method": "powershell",
      "command": "$env:Path = ([Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User'))\npython -m pip install --upgrade pip requests\n",
      "verify": {
        "command": "python -c 'import requests' 2>$null; if ($LASTEXITCODE -eq 0) { exit 0 } else { exit 1 }"
      }
    },
    {
      "id": "google-chrome",
      "name": "Google Chrome",
      "method": "msi",
      "url": "https://dl.google.com/dl/chrome/install/googlechromestandaloneenterprise64.msi",
      "verify": {
        "command": "if (Test-Path 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe') { exit 0 } else { exit 1 }"
      }
    },
    {
      "id": "vscode",
      "name": "Visual Studio Code",
      "method": "exe",
      "url": "https://update.code.visualstudio.com/latest/win32-x64/stable",
      "args": [
        "/VERYSILENT",
        "/NORESTART",
        "/MERGETASKS=!runcode,addcontextmenufiles,addcontextmenufolders,addtopath"
      ],
      "verify": {
        "command": "if (Test-Path 'C:\\Program Files\\Microsoft VS Code\\Code.exe') { exit 0 } else { exit 1 }"
      }
    },
    {
      "id": "cursor",
      "name": "Cursor",
      "method": "exe",
      "url": "https://api2.cursor.sh/updates/download/golden/win32-x64/cursor/3.7",
      "args": [
        "/SP-",
        "/VERYSILENT",
        "/SUPPRESSMSGBOXES",
        "/NORESTART",
        "/MERGETASKS=!runcode"
      ],
      "verify": {
        "command": "if (Test-Path 'C:\\Program Files\\Cursor\\Cursor.exe') { exit 0 } else { exit 1 }"
      }
    },
    {
      "id": "awscli",
      "name": "AWS CLI",
      "method": "msi",
      "url": "https://awscli.amazonaws.com/AWSCLIV2.msi",
      "verify": {
        "command": "if (Get-Command aws.exe -ErrorAction SilentlyContinue) { aws --version; exit 0 } else { exit 1 }"
      }
    },
    {
      "id": "7zip",
      "name": "7-Zip",
      "method": "msi",
      "url": "https://github.com/ip7z/7zip/releases/download/26.01/7z2601-x64.msi",
      "verify": {
        "command": "if (Test-Path 'C:\\Program Files\\7-Zip\\7z.exe') { exit 0 } else { exit 1 }"
      }
    },
    {
      "id": "openai-codex",
      "name": "OpenAI Codex CLI",
      "method": "powershell",
      "command": "New-Item -ItemType Directory -Force -Path 'C:\\ProgramData\\npm' | Out-Null\nnpm config set prefix 'C:\\ProgramData\\npm'\n$MachinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')\nif ($MachinePath -notlike '*C:\\ProgramData\\npm*') {\n  [Environment]::SetEnvironmentVariable('Path', ($MachinePath + ';C:\\ProgramData\\npm'), 'Machine')\n}\n$env:Path = ([Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User'))\nnpm install -g @openai/codex@latest\n",
      "verify": {
        "command": "if (Get-Command codex -ErrorAction SilentlyContinue) { codex --version; exit 0 } else { exit 1 }"
      }
    },
    {
      "id": "openai-codex-desktop",
      "name": "OpenAI Codex Desktop Installer",
      "method": "powershell",
      "command": `$InstallerDir = 'C:\\ProgramData\\panw-broker\\installers'
New-Item -ItemType Directory -Force -Path $InstallerDir | Out-Null
$InstallerPath = Join-Path $InstallerDir 'Codex Installer.exe'
$LauncherPath = 'C:\\Users\\Public\\Desktop\\Install OpenAI Codex Desktop.cmd'
$DownloadUri = 'https://get.microsoft.com/installer/download/9PLM9XGG6VKS?cid=website_cta_psi'
$DownloadSucceeded = $false

try {
  Invoke-WebRequest -UseBasicParsing -Uri $DownloadUri -OutFile $InstallerPath -ErrorAction Stop
  $DownloadSucceeded = $true
} catch {
  Write-Warning "Codex desktop installer download failed: $($_.Exception.Message). The Codex CLI remains installed; staging a desktop installer retry launcher."
}

if ($DownloadSucceeded -and (Test-Path $InstallerPath)) {
  $Process = Start-Process -FilePath $InstallerPath -ArgumentList @('/Silent', '/AllUsers') -Wait -PassThru
  Write-Host "Codex desktop installer exit code: $($Process.ExitCode)"
  if ($Process.ExitCode -ne 0) {
    Write-Warning "Codex desktop installer exited with $($Process.ExitCode); staging retry launcher."
  }
}

$Package = Get-AppxPackage -AllUsers | Where-Object { $_.Name -like '*Codex*' -or $_.PackageFullName -like '*Codex*' } | Select-Object -First 1
if ($Package) {
  Write-Host "Codex desktop package detected: $($Package.PackageFullName)"
} else {
  $LauncherContent = @'
@echo off
set INSTALLER=C:\\ProgramData\\panw-broker\\installers\\Codex Installer.exe
if exist "%INSTALLER%" (
  "%INSTALLER%"
) else (
  echo Codex Desktop installer was not downloaded during bootstrap.
  echo The OpenAI Codex CLI is installed and available as: codex
  echo Retrying the Microsoft installer download URL in your browser...
  start "" "https://get.microsoft.com/installer/download/9PLM9XGG6VKS?cid=website_cta_psi"
  pause
)
'@
  $LauncherContent | Set-Content -Path $LauncherPath -Encoding ASCII
  Write-Host "Codex desktop package was not visible after bootstrap; staged launcher at $LauncherPath."
}
`,
      "verify": {
        "command": "if ((Get-AppxPackage -AllUsers | Where-Object { $_.Name -like '*Codex*' -or $_.PackageFullName -like '*Codex*' }) -or (Test-Path 'C:\\Users\\Public\\Desktop\\Install OpenAI Codex Desktop.cmd')) { exit 0 } else { exit 1 }"
      }
    },
    {
      "id": "claude-code",
      "name": "Claude Code",
      "method": "powershell",
      "command": "New-Item -ItemType Directory -Force -Path 'C:\\ProgramData\\npm' | Out-Null\nnpm config set prefix 'C:\\ProgramData\\npm'\n$MachinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')\nif ($MachinePath -notlike '*C:\\ProgramData\\npm*') {\n  [Environment]::SetEnvironmentVariable('Path', ($MachinePath + ';C:\\ProgramData\\npm'), 'Machine')\n}\n$env:Path = ([Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User'))\nnpm install -g @anthropic-ai/claude-code@latest --include=optional --ignore-scripts=false --allow-scripts=@anthropic-ai/claude-code\n",
      "verify": {
        "command": "if (Get-Command claude -ErrorAction SilentlyContinue) { claude --version; exit 0 } else { exit 1 }"
      }
    }
  ]
} satisfies AppProfileModule;

export default appProfile;
