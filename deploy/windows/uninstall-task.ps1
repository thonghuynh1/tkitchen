[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)][string]$TaskName = "tkitchen"
)

$ErrorActionPreference = 'Stop'

$task = $null
try {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
} catch {
    if ($_.Exception.Message -match 'No MSFT_ScheduledTask objects found') {
        exit 0
    }
    throw
}
if ($task) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
}
exit 0
