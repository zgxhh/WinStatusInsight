param(
    [int]$IntervalSeconds = 2,
    [int]$Top = 40,
    [ValidateSet("Full", "Fast", "Metadata")]
    [string]$Mode = "Full"
)

$ErrorActionPreference = "SilentlyContinue"

function Get-ProcessSnapshot {
    param([switch]$IncludeNative)
    Get-Process | ForEach-Object {
        $row = [pscustomobject]@{
            pid = $_.Id
            name = $_.ProcessName
            cpuSeconds = [double]($_.CPU)
            workingSet = [double]($_.WorkingSet64)
            privateMemory = [double]($_.PrivateMemorySize64)
        }
        if ($IncludeNative) {
            $row | Add-Member -NotePropertyName nativeProcess -NotePropertyValue $_
        }
        $row
    }
}

function Normalize-Text {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return "" }
    return $Value.ToLowerInvariant()
}

if ($IntervalSeconds -lt 1) { $IntervalSeconds = 1 }
if ($Top -lt 10) { $Top = 10 }

function Get-StaticMetadata {
    $startup = Get-CimInstance Win32_StartupCommand | ForEach-Object {
        [pscustomobject]@{
            name = $_.Name
            command = $_.Command
            location = $_.Location
            user = $_.User
            normalized = Normalize-Text "$($_.Name) $($_.Command)"
        }
    }

    $services = Get-Service |
        Where-Object { $_.Status -eq "Running" } |
        ForEach-Object {
            [pscustomobject]@{
                name = $_.Name
                displayName = $_.DisplayName
                startMode = "$($_.StartType)"
                pathName = ""
                normalized = Normalize-Text "$($_.Name) $($_.DisplayName)"
            }
        }

    [pscustomobject]@{
        capturedAt = (Get-Date).ToString("o")
        startupItems = @($startup)
        services = @($services)
    }
}

if ($Mode -eq "Metadata") {
    Get-StaticMetadata | ConvertTo-Json -Depth 8 -Compress
    exit 0
}

$logicalCores = [Environment]::ProcessorCount
$beforeTime = Get-Date
$before = Get-ProcessSnapshot
Start-Sleep -Seconds $IntervalSeconds
$afterTime = Get-Date
$after = Get-ProcessSnapshot -IncludeNative
$elapsed = ($afterTime - $beforeTime).TotalSeconds

$beforeById = @{}
foreach ($p in $before) { $beforeById[$p.pid] = $p }

$allProcessRows = foreach ($p in $after) {
    $delta = 0
    if ($beforeById.ContainsKey($p.pid)) {
        $delta = $p.cpuSeconds - $beforeById[$p.pid].cpuSeconds
        if ($delta -lt 0) { $delta = 0 }
    }

    $cpuPercent = 0
    if ($elapsed -gt 0 -and $logicalCores -gt 0) {
        $cpuPercent = 100 * $delta / $elapsed / $logicalCores
    }

    [pscustomobject]@{
        pid = $p.pid
        name = $p.name
        cpuPercent = [math]::Round($cpuPercent, 2)
        cpuDeltaSeconds = [math]::Round($delta, 2)
        workingSet = [int64]$p.workingSet
        privateMemory = [int64]$p.privateMemory
        commandLine = $null
        parentProcessId = $null
        impactScore = [math]::Round(($cpuPercent * 2) + (($p.workingSet / 1GB) * 10), 3)
        nativeProcess = $p.nativeProcess
    }
}

$os = Get-CimInstance Win32_OperatingSystem
$cpuLoad = 0
if ($elapsed -gt 0 -and $logicalCores -gt 0) {
    $cpuLoad = ($allProcessRows | Measure-Object -Property cpuDeltaSeconds -Sum).Sum * 100 / $elapsed / $logicalCores
}

$topProcessRows = @($allProcessRows | Sort-Object -Property impactScore -Descending | Select-Object -First $Top)
$processRows = foreach ($p in $topProcessRows) {
    [pscustomobject]@{
        pid = $p.pid
        name = $p.name
        cpuPercent = $p.cpuPercent
        cpuDeltaSeconds = $p.cpuDeltaSeconds
        workingSet = [int64]$p.workingSet
        privateMemory = [int64]$p.privateMemory
        path = $p.nativeProcess.Path
        mainWindowTitle = $p.nativeProcess.MainWindowTitle
        commandLine = $null
        parentProcessId = $null
        impactScore = $p.impactScore
    }
}

$disks = Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk |
    Where-Object { $_.Name -ne "_Total" } |
    Sort-Object PercentDiskTime -Descending |
    ForEach-Object {
        [pscustomobject]@{
            name = $_.Name
            busyPercent = [int]$_.PercentDiskTime
            queueLength = [int]$_.CurrentDiskQueueLength
            readBytesPerSec = [int64]$_.DiskReadBytesPersec
            writeBytesPerSec = [int64]$_.DiskWriteBytesPersec
        }
    }

$metadata = $null
if ($Mode -eq "Full") {
    $metadata = Get-StaticMetadata
}

$totalMem = [int64]$os.TotalVisibleMemorySize * 1KB
$freeMem = [int64]$os.FreePhysicalMemory * 1KB
$usedMem = $totalMem - $freeMem
$memoryPercent = 0
if ($totalMem -gt 0) { $memoryPercent = [math]::Round(100 * $usedMem / $totalMem, 2) }

$startupItems = @()
$serviceItems = @()
if ($metadata) {
    $startupItems = @($metadata.startupItems)
    $serviceItems = @($metadata.services)
}

$payload = [pscustomobject]@{
    capturedAt = (Get-Date).ToString("o")
    computerName = $env:COMPUTERNAME
    intervalSeconds = $IntervalSeconds
    logicalCores = $logicalCores
    system = [pscustomobject]@{
        cpuPercent = [math]::Round([double]$cpuLoad, 2)
        memoryTotal = $totalMem
        memoryUsed = $usedMem
        memoryFree = $freeMem
        memoryPercent = $memoryPercent
        diskBusyPercent = [int](($disks | Select-Object -First 1).busyPercent)
    }
    disks = @($disks)
    processes = @($processRows)
    startupItems = $startupItems
    services = $serviceItems
}

$payload | ConvertTo-Json -Depth 8 -Compress
