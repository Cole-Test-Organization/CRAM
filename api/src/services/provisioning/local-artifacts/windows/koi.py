import socket
import subprocess
import sys

import requests

XT_API_URL = ""
ENCRYPTED_PARAMS = ""

# --- Python Generated ENV ---
XT_API_URL="https://api.prod.koi.security/api"
ENCRYPTED_PARAMS="vXuU_YE0X7Xl3fPgGobpITxbUKtOk5JUvJaJoBVpfQKjOgh7olQZ8rw5OakOzRRbga6Mu7TSlDcIIJlLYApfPqWVPlrQtxC5V-fFpU07ZXlP2HikJOzpeXaD8dEKzgm6Yk1IJlcTj6-gPW9Rrkp48fEEirYuXac8mllsU0OjkWWTc9sRZXq2rfNDjJLK1juX"
# --- End Python Generated ENV ---

powershell_script = """
# --- Generated ENV ---
$XT_API_URL="https://api.prod.koi.security/api"
$ENCRYPTED_PARAMS="vXuU_YE0X7Xl3fPgGobpITxbUKtOk5JUvJaJoBVpfQKjOgh7olQZ8rw5OakOzRRbga6Mu7TSlDcIIJlLYApfPqWVPlrQtxC5V-fFpU07ZXlP2HikJOzpeXaD8dEKzgm6Yk1IJlcTj6-gPW9Rrkp48fEEirYuXac8mllsU0OjkWWTc9sRZXq2rfNDjJLK1juX"
# --- End Generated ENV ---

$PUBLIC_KEY = @"
<RSAKeyValue>
  <Modulus>uLDSm1wmh7HSVPSbrlXI9fzITiAVhmYL3sqxdcaHYMutHLnMPRz/j7VWsZKpUDsCeBycfEDl7H0mKJL/0+hcDP6qQB5jHV6BduGu9xajiUzWpZ9JzmYsDY85DxtFFtpREtrem83e17qmnMTemFRTyenTEh1LATwnFfBlP0NT9dEymLCKCOwBggCjGrqesRwavaAeTthPYn0KhER6/vtW4Rz3mBli2P/+mZtmGSTdn+X6C1+4QNH0/YaFo3iVy6FPRMtpTrDdlJ461T5fcI0igCIoigSHvracaqgCz6Fkxt/PODfsJwZKctYTXZcAfJEnejeosRmeBx6SAnSLk3ubIQ==</Modulus>
  <Exponent>AQAB</Exponent>
</RSAKeyValue>
"@

$SIGNATURE_BEGIN = "# --- Signature Begin ---"
$SIGNATURE_END = "# --- Signature End ---"

if (-not $ENCRYPTED_PARAMS) {
    Write-Error "Error: ENCRYPTED_PARAMS is not defined"
    exit 1
}

try {
    $scriptContent = Invoke-RestMethod -Uri "$XT_API_URL/clients/pre-signed-link/$ENCRYPTED_PARAMS"
}
catch {
    Write-Error "Error: Could not get script content: $_"
    exit 1
}

Write-Host "Extracting signature from script..."
$signature = [regex]::Match($scriptContent, "(?s)$SIGNATURE_BEGIN\r?\n#(.*?)\r?\n$SIGNATURE_END").Groups[1].Value

if (-not $signature) {
    Write-Error "Signature not found in script!"
    exit 1
}

$originalScript = $scriptContent -replace "(?s)$SIGNATURE_BEGIN.*?$SIGNATURE_END`r?`n", ""

Write-Host "Verifying script signature..."

try {
    $rsa = New-Object System.Security.Cryptography.RSACryptoServiceProvider
    $rsa.FromXmlString($PUBLIC_KEY)

    $scriptBytes = [System.Text.Encoding]::UTF8.GetBytes($originalScript)
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $hash = $sha256.ComputeHash($scriptBytes)

    $signatureBytes = [System.Convert]::FromBase64String($signature)
    $isValid = $rsa.VerifyHash($hash, [System.Security.Cryptography.CryptoConfig]::MapNameToOID("SHA256"), $signatureBytes)

    if ($isValid) {
        Write-Host "Signature is valid. Executing script..."
        [scriptblock]::Create($originalScript).Invoke()
        exit $LASTEXITCODE
    }
    else {
        Write-Error "Signature verification failed. Aborting."
        exit 1
    }
}
catch {
    Write-Error "Error during signature verification: $_"
    exit 1
} 
"""


def get_hostname():
    try:
        return socket.gethostname()
    except Exception:
        return "unknown"


def log_error(message: str, extra_data: str):
    try:
        requests.post(
            f"{XT_API_URL}/clients/managed-log",
            headers={"Content-Type": "application/json"},
            json={
                "message": message,
                "host": get_hostname(),
                "level": "error",
                "extraData": extra_data,
                "encryptedParams": ENCRYPTED_PARAMS,
            },
        )
    except Exception as e:
        print(f"Error sending log to API: {e}")


def run_powershell_script():
    try:
        process = subprocess.run(
            ["powershell", "-Command", powershell_script],
            capture_output=True,
            text=True,
        )

        if process.returncode != 0:
            error_message = "Script execution failed"
            print(error_message)
            print(process.stdout)
            print(process.stderr)
            log_error(
                error_message, f"stdout:\n{process.stdout}\nstderr:\n{process.stderr}"
            )
            return 1
        else:
            print("Script executed successfully!")
            print("Output:")
            print(process.stdout)
            return 0

    except Exception as e:
        error_message = "Error in python wrapper - powershell managed mdm script"
        print(str(e))
        print(error_message)
        log_error(error_message, str(e))
        return 1


if __name__ == "__main__":
    exit_code = run_powershell_script()
    sys.exit(exit_code)
