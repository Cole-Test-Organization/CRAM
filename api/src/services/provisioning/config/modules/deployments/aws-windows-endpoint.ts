import type { DeploymentModule } from "../types.js";

const deployment = {
  "name": "aws-windows-endpoint",
  "providerProfile": "aws-lab",
  "provider": {
    "projectName": "windows-endpoint-lab",
    "vpcCidr": "10.110.0.0/16"
  },
  "inputs": [
    {
      "name": "windowsAppProfile",
      "label": "Windows app profile",
      "description": "Optional software baseline to install during Windows bootstrap.",
      "type": "string",
      "default": "",
      "appProfileGroup": "windows",
      "options": [
        {
          "label": "No extra apps",
          "value": ""
        },
        {
          "label": "Developer workstation",
          "value": "developer"
        }
      ]
    }
  ],
  "resources": [
    {
      "kind": "windows-endpoint",
      "name": "hcwilk-broker-test",
      "hostname": "hcwilk-broker-test",
      "vm": {
        "instanceType": "m5.2xlarge"
      },
      "bootstrap": {
        "adminUsername": "hcwilk-broker",
        "adminPasswordEnv": "WINDOWS_ENDPOINT_ADMIN_PASSWORD",
        "installSsmAgent": true,
        "installPython": true,
        "pythonInstallUrl": "https://www.python.org/ftp/python/3.14.5/python-3.14.5-amd64.exe"
      },
      "koi": {
        "scriptPath": "local-artifacts/windows/koi.py",
        "arguments": [],
        "environment": {}
      },
      "placement": {
        "provider": "aws",
        "availabilityZoneIndex": 0,
        "allowedSourceCidrs": [
          "74.51.2.242/32",
          "98.101.148.0/24"
        ],
        "subnetCidr": "10.110.30.0/24",
        "rootVolumeGb": 128,
        "associatePublicIp": true,
        "enableWinrm": false,
        "enableSsm": true,
        "bootstrapMethod": "ssm",
        "bootstrapTimeoutSeconds": 1800
      }
    }
  ]
} satisfies DeploymentModule;

export default deployment;
