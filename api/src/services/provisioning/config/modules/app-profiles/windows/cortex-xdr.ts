import type { AppProfileModule } from "../../types.js";

const appProfile = {
  "name": "cortex-xdr",
  "description": "Cortex XDR agent for Windows endpoint simulations.",
  "apps": [
    {
      "id": "cortex-xdr-agent",
      "name": "Cortex XDR Agent",
      "method": "msi",
      "sourcePath": "local-artifacts/windows/Windows-Proxmox_x64.msi",
      "args": [
        "REBOOT=ReallySuppress"
      ],
      "verify": {
        "command": "$Names = @('Cortex', 'XDR', 'Palo Alto', 'Traps')\n$UninstallPaths = @(\n  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',\n  'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'\n)\n$Installed = Get-ItemProperty -Path $UninstallPaths -ErrorAction SilentlyContinue |\n  Where-Object {\n    $DisplayName = [string] $_.DisplayName\n    $Names | Where-Object { $DisplayName -like \"*$_*\" }\n  } |\n  Select-Object -First 1\n$Service = Get-Service -ErrorAction SilentlyContinue |\n  Where-Object {\n    $ServiceName = \"$($_.Name) $($_.DisplayName)\"\n    $Names | Where-Object { $ServiceName -like \"*$_*\" }\n  } |\n  Select-Object -First 1\nif ($Installed -or $Service) { exit 0 } else { exit 1 }\n"
      }
    }
  ]
} satisfies AppProfileModule;

export default appProfile;
