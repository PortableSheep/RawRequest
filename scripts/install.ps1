param(
    [string]$Version = "latest",
    [string]$InstallDir = "$env:LOCALAPPDATA\RawRequest"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Repo = "portablesheep/RawRequest"

if ($env:OS -ne "Windows_NT") {
    throw "This installer only supports Windows."
}

function Write-Info([string]$Message) {
    Write-Host "[INSTALL] $Message" -ForegroundColor Green
}

function Resolve-ReleaseVersion([string]$RequestedVersion) {
    if ($RequestedVersion -ne "latest") {
        return $RequestedVersion
    }

    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ "User-Agent" = "RawRequest-Installer" }
    $tag = [string]$release.tag_name
    if ([string]::IsNullOrWhiteSpace($tag)) {
        throw "Could not determine latest version from GitHub releases."
    }
    return $tag
}

function Ensure-PathContains([string]$TargetDir) {
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $segments = @()
    if (-not [string]::IsNullOrWhiteSpace($userPath)) {
        $segments = $userPath.Split(';') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    }

    $normalizedTarget = $TargetDir.TrimEnd('\')
    $exists = $segments | Where-Object { $_.TrimEnd('\') -ieq $normalizedTarget }
    if (-not $exists) {
        $newPath = if ([string]::IsNullOrWhiteSpace($userPath)) { $TargetDir } else { "$userPath;$TargetDir" }
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Write-Info "Added $TargetDir to user PATH."
    } else {
        Write-Info "PATH already includes $TargetDir."
    }

    $processSegments = $env:Path.Split(';') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    $processExists = $processSegments | Where-Object { $_.TrimEnd('\') -ieq $normalizedTarget }
    if (-not $processExists) {
        $env:Path = "$env:Path;$TargetDir"
    }
}

$resolvedVersion = Resolve-ReleaseVersion -RequestedVersion $Version
$artifactVersion = $resolvedVersion.TrimStart('v')
$zipName = "RawRequest-$artifactVersion-windows-portable.zip"
$candidateTags = @($resolvedVersion)
if ($resolvedVersion.StartsWith("v")) {
    $candidateTags += $resolvedVersion.TrimStart('v')
} else {
    $candidateTags += "v$resolvedVersion"
}
$candidateTags = $candidateTags | Select-Object -Unique

Write-Info "Installing RawRequest $resolvedVersion..."
Write-Info "Artifact: $zipName"

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("rawrequest-install-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

try {
    $zipPath = Join-Path $tempRoot "rawrequest.zip"
    $extractDir = Join-Path $tempRoot "extract"

    $downloaded = $false
    $lastError = $null
    foreach ($tag in $candidateTags) {
        $downloadUrl = "https://github.com/$Repo/releases/download/$tag/$zipName"
        Write-Info "Trying download URL: $downloadUrl"
        try {
            Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath
            $downloaded = $true
            break
        }
        catch {
            $lastError = $_
        }
    }
    if (-not $downloaded) {
        throw "Failed to download $zipName. Last error: $lastError"
    }

    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

    $exe = Get-ChildItem -Path $extractDir -Filter "RawRequest.exe" -Recurse -File | Select-Object -First 1
    if (-not $exe) {
        throw "RawRequest.exe not found in downloaded archive."
    }

    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Copy-Item -Path $exe.FullName -Destination (Join-Path $InstallDir "rawrequest.exe") -Force

    $updater = Get-ChildItem -Path $extractDir -Filter "rawrequest-updater.exe" -Recurse -File | Select-Object -First 1
    if ($updater) {
        Copy-Item -Path $updater.FullName -Destination (Join-Path $InstallDir "rawrequest-updater.exe") -Force
    }

    $setupCli = Get-ChildItem -Path $extractDir -Filter "setup-cli.bat" -Recurse -File | Select-Object -First 1
    if ($setupCli) {
        Copy-Item -Path $setupCli.FullName -Destination (Join-Path $InstallDir "setup-cli.bat") -Force
    }

    $serviceLauncherPath = Join-Path $InstallDir "rawrequest-service.cmd"
    Set-Content -Path $serviceLauncherPath -Value "@echo off`r`n`"%~dp0rawrequest.exe`" service %*`r`n" -Encoding Ascii

    Ensure-PathContains -TargetDir $InstallDir

    Write-Info "Done."
    Write-Host ""
    Write-Host "Open a NEW terminal and run:" -ForegroundColor Cyan
    Write-Host "  rawrequest --help"
    Write-Host "  rawrequest mcp"
    Write-Host "  rawrequest service"
    Write-Host "  rawrequest-service"
}
finally {
    Remove-Item -Path $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
