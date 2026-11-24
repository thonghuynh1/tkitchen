[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)][string]$TaskName = "tkitchen"
)

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
exit 0
