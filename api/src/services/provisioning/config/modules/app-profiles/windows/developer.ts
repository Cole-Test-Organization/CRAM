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
      "method": "msi",
      "url": "https://nodejs.org/dist/latest-v24.x/node-v24.17.0-x64.msi",
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
      "command": "$InstallerDir = 'C:\\ProgramData\\panw-broker\\installers'\nNew-Item -ItemType Directory -Force -Path $InstallerDir | Out-Null\n$InstallerPath = Join-Path $InstallerDir 'Codex Installer.exe'\nInvoke-WebRequest -UseBasicParsing -Uri 'https://get.microsoft.com/installer/download/9PLM9XGG6VKS?cid=website_cta_psi' -OutFile $InstallerPath\n$Process = Start-Process -FilePath $InstallerPath -ArgumentList @('/Silent', '/AllUsers') -Wait -PassThru\nWrite-Host \"Codex desktop installer exit code: $($Process.ExitCode)\"\n$Package = Get-AppxPackage -AllUsers | Where-Object { $_.Name -like '*Codex*' -or $_.PackageFullName -like '*Codex*' } | Select-Object -First 1\nif ($Package) {\n  Write-Host \"Codex desktop package detected: $($Package.PackageFullName)\"\n} else {\n  $LauncherPath = 'C:\\Users\\Public\\Desktop\\Install OpenAI Codex Desktop.cmd'\n  $LauncherContent = '@echo off' + [Environment]::NewLine + '\"' + $InstallerPath + '\"'\n  $LauncherContent | Set-Content -Path $LauncherPath -Encoding ASCII\n  Write-Host \"Codex desktop package was not visible after silent install; staged installer at $InstallerPath and launcher at $LauncherPath.\"\n}\n",
      "verify": {
        "command": "if ((Get-AppxPackage -AllUsers | Where-Object { $_.Name -like '*Codex*' -or $_.PackageFullName -like '*Codex*' }) -or (Test-Path 'C:\\Users\\Public\\Desktop\\Install OpenAI Codex Desktop.cmd')) { exit 0 } else { exit 1 }"
      }
    },
    {
      "id": "claude-code",
      "name": "Claude Code",
      "method": "powershell",
      "command": "New-Item -ItemType Directory -Force -Path 'C:\\ProgramData\\npm' | Out-Null\nnpm config set prefix 'C:\\ProgramData\\npm'\n$MachinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')\nif ($MachinePath -notlike '*C:\\ProgramData\\npm*') {\n  [Environment]::SetEnvironmentVariable('Path', ($MachinePath + ';C:\\ProgramData\\npm'), 'Machine')\n}\n$env:Path = ([Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User'))\nnpm install -g @anthropic-ai/claude-code@latest\n",
      "verify": {
        "command": "if (Get-Command claude -ErrorAction SilentlyContinue) { claude --version; exit 0 } else { exit 1 }"
      }
    }
  ]
} satisfies AppProfileModule;

export default appProfile;
