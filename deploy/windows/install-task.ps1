[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)][string]$Export,
    [Parameter(Mandatory = $false)][string]$TaskName = "tkitchen"
)

$ErrorActionPreference = 'Stop'

$repo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$user = "$env:USERDOMAIN\$env:USERNAME"
$node = (Get-Command node).Source
$script = Join-Path $repo 'src\cli\tkitchen.ts'
$arguments = '"' + $script + '" serve'

function Escape-Xml([string]$value) {
    return [System.Security.SecurityElement]::Escape($value)
}

$xml = @"
<?xml version="1.0"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>tkitchen serve at sign-in</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$(Escape-Xml $user)</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$(Escape-Xml $user)</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$(Escape-Xml $node)</Command>
      <Arguments>$(Escape-Xml $arguments)</Arguments>
      <WorkingDirectory>$(Escape-Xml $repo)</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

if ($Export) {
    $exportPath = [System.IO.Path]::GetFullPath($Export)
    $exportDir = Split-Path -Path $exportPath -Parent
    if ($exportDir -and (-not (Test-Path $exportDir))) {
        New-Item -ItemType Directory -Path $exportDir -Force | Out-Null
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($exportPath, ($xml.Trim() + "`n"), $utf8NoBom)
    Write-Host "Exported task definition to $exportPath"
    exit 0
}

Register-ScheduledTask -TaskName $TaskName -Xml ($xml.Trim() + "`n") -Force -ErrorAction Stop | Out-Null
Write-Host "Registered task $TaskName"
