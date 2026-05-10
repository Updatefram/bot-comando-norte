Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$basePath = Split-Path -Parent $MyInvocation.MyCommand.Path
$global:botProcess = $null

function Stop-BotProcessesInFolder {
    param([string]$FolderPath)

    try {
        $escaped = [Regex]::Escape($FolderPath)
        $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
        foreach ($p in ($procs | Where-Object { $_.CommandLine -match $escaped -and $_.CommandLine -match "index\.js" })) {
            try {
                Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
            } catch {}
        }
    } catch {}
}

function Start-Bot {

    Stop-Bot

    $logPath = Join-Path $basePath "bot-runtime.log"
    $errPath = Join-Path $basePath "bot-runtime.err.log"
    try {
        "Node: $(node -v) | Iniciado: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Out-File -FilePath $logPath -Encoding UTF8
        "" | Out-File -FilePath $errPath -Encoding UTF8
    } catch {}

    $nodeExe = $null
    try {
        $nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
    } catch {
        $notifyIcon.ShowBalloonTip(
            5000,
            "Bot Discord",
            "node.exe não encontrado no PATH.",
            [System.Windows.Forms.ToolTipIcon]::Error
        )
        return
    }

    try {
        $global:botProcess = Start-Process `
            -FilePath $nodeExe `
            -ArgumentList @("index.js") `
            -WorkingDirectory $basePath `
            -WindowStyle Hidden `
            -RedirectStandardOutput $logPath `
            -RedirectStandardError $errPath `
            -PassThru
    } catch {
        try {
            $_ | Out-File -FilePath $errPath -Append -Encoding UTF8
        } catch {}
        $notifyIcon.ShowBalloonTip(
            5000,
            "Bot Discord",
            "Falha ao iniciar. Abra o log.",
            [System.Windows.Forms.ToolTipIcon]::Error
        )
        return
    }

    $notifyIcon.ShowBalloonTip(
        3000,
        "Bot Discord",
        "Bot iniciado com sucesso.",
        [System.Windows.Forms.ToolTipIcon]::Info
    )
}

function Stop-Bot {

    Stop-BotProcessesInFolder -FolderPath $basePath
    if ($global:botProcess -ne $null) {
        try {
            if (-not $global:botProcess.HasExited) {
                Stop-Process -Id $global:botProcess.Id -Force -ErrorAction SilentlyContinue
                Wait-Process -Id $global:botProcess.Id -Timeout 5 -ErrorAction SilentlyContinue
            }
        } catch {}
    }
    $global:botProcess = $null

    $notifyIcon.ShowBalloonTip(
        3000,
        "Bot Discord",
        "Bot parado.",
        [System.Windows.Forms.ToolTipIcon]::Warning
    )
}

function Restart-Bot {

    Stop-Bot
    Start-Sleep -Seconds 2
    Start-Bot
}

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
$notifyIcon.Text = "Bot Discord - Cargo Manager"
$notifyIcon.Visible = $true

$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip

$startItem = $contextMenu.Items.Add("[+] Iniciar")
$stopItem = $contextMenu.Items.Add("[-] Parar")
$restartItem = $contextMenu.Items.Add("[R] Reiniciar")
$logItem = $contextMenu.Items.Add("[L] Abrir log")
$exitItem = $contextMenu.Items.Add("[X] Sair")

$startItem.Add_Click({
    Start-Bot
})

$stopItem.Add_Click({
    Stop-Bot
})

$restartItem.Add_Click({
    Restart-Bot
})

$logItem.Add_Click({
    $logPath = Join-Path $basePath "bot-runtime.log"
    $errPath = Join-Path $basePath "bot-runtime.err.log"
    if (Test-Path $logPath) {
        Start-Process notepad.exe $logPath | Out-Null
        if (Test-Path $errPath) {
            try {
                $errContent = Get-Content $errPath -ErrorAction SilentlyContinue
                if ($errContent -and $errContent.Count -gt 0) {
                    Start-Process notepad.exe $errPath | Out-Null
                }
            } catch {}
        }
    } else {
        $notifyIcon.ShowBalloonTip(
            3000,
            "Bot Discord",
            "Ainda não existe bot-runtime.log. Inicie o bot primeiro.",
            [System.Windows.Forms.ToolTipIcon]::Info
        )
    }
})

$exitItem.Add_Click({

    Stop-Bot

    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()

    [System.Windows.Forms.Application]::Exit()
})

$notifyIcon.ContextMenuStrip = $contextMenu

Start-Bot

[System.Windows.Forms.Application]::Run()
