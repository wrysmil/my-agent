# my-agent 服务管理脚本 (Windows PowerShell)
# 用法: .\manage.ps1 {start|stop|restart|status|logs|dev-*|all-*}
#
# 后端通过 Start-Process 脱离当前终端启动，前端同理。
# 以端口为唯一运行状态源。

param(
    [Parameter(Position = 0)]
    [ValidateSet("start", "stop", "restart", "status", "logs",
                 "dev-start", "dev-stop", "dev-restart", "dev-status", "dev-logs",
                 "all-start", "all-stop", "all-restart", "all-status")]
    [string]$Command = "status"
)

$ErrorActionPreference = "Stop"
$ProjectDir = $PSScriptRoot
$PidFile = "$env:TEMP\my-agent.pid"
$LogFile = "$ProjectDir\.server.log"
$BackendPort = 4321
$FrontendPort = 5173
$WebDir = "$ProjectDir\web"
$DevLog = "$env:TEMP\vite-dev.log"

$StopTimeout = 10
$StartTimeout = 15

# ============================================================
# 工具函数
# ============================================================

function Get-PortProcess {
    param([int]$Port)
    $conn = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue `
        | Where-Object { $_.State -eq "Listen" } `
        | Select-Object -First 1
    if ($conn) { return $conn.OwningProcess }
    # 兜底: netstat
    $line = netstat -ano 2>$null | Select-String ":$Port " | Select-String "LISTENING" | Select-Object -First 1
    if ($line) {
        $parts = $line.ToString().Trim() -split '\s+'
        $procId = [int]$parts[-1]
        if ($procId -gt 0) { return $procId }
    }
    return $null
}

function Test-PortBusy {
    param([int]$Port)
    return (Get-PortProcess -Port $Port) -ne $null
}

function Get-ChildProcesses {
    param([int]$ParentPid)
    $children = @()
    try {
        $wmi = Get-CimInstance Win32_Process -Filter "ParentProcessId=$ParentPid" -ErrorAction SilentlyContinue
        if ($wmi) { $children += $wmi.ProcessId }
    } catch { }
    return $children
}

function Kill-Tree {
    param([int[]]$Pids)
    $all = @($Pids)
    # 递归收集子进程
    $toCheck = [Collections.Generic.Queue[int]]::new()
    foreach ($p in $all) { $toCheck.Enqueue($p) }
    while ($toCheck.Count -gt 0) {
        $parent = $toCheck.Dequeue()
        $kids = Get-ChildProcesses -ParentPid $parent
        foreach ($k in $kids) {
            if ($k -notin $all -and $k -gt 0) {
                $all += $k
                $toCheck.Enqueue($k)
            }
        }
    }
    # SIGTERM → wait → SIGKILL
    foreach ($procId in $all) {
        try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } catch { }
    }
    Start-Sleep -Seconds 2
}

function Wait-PortFree {
    param([int]$Port, [int]$Timeout)
    $waited = 0
    while (Test-PortBusy -Port $Port) {
        if ($waited -ge $Timeout) { return $false }
        Start-Sleep -Seconds 1
        $waited++
    }
    return $true
}

function Wait-PortReady {
    param([int]$Port, [int]$Timeout)
    $waited = 0
    while (-not (Test-PortBusy -Port $Port)) {
        if ($waited -ge $Timeout) { return $false }
        Start-Sleep -Seconds 1
        $waited++
    }
    return $true
}

function Get-FrontendPids {
    $procIds = @()
    $portPid = Get-PortProcess -Port $FrontendPort
    if ($portPid) { $procIds += $portPid }
    # npm/node 进程
    Get-Process -Name "node" -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine ?? ""
            if ($cmd -match "vite|npm.*dev") { $procIds += $_.Id }
        } catch { }
    }
    return ($procIds | Sort-Object -Unique)
}

# ============================================================
# 前端构建
# ============================================================

function Ensure-FrontendBuilt {
    $distHtml = "$WebDir\dist\index.html"

    # node_modules 缺失 → install
    if (-not (Test-Path "$WebDir\node_modules")) {
        Write-Host "[install] 安装 web 依赖..." -ForegroundColor Cyan
        Push-Location $WebDir
        try {
            npm install
            if ($LASTEXITCODE -ne 0) { throw "npm install 失败" }
        } finally { Pop-Location }
    }

    # dist 缺失 → build
    if (-not (Test-Path $distHtml)) {
        Write-Host "[build] dist 缺失，构建前端..." -ForegroundColor Cyan
        Push-Location $WebDir
        try {
            npm run build
            if ($LASTEXITCODE -ne 0) { throw "npm run build 失败" }
        } finally { Pop-Location }
        Write-Host "[build] 前端构建完成" -ForegroundColor Green
        return
    }

    # src 比 dist 新 → rebuild
    $newestSrc = Get-ChildItem "$WebDir\src" -Recurse -File -ErrorAction SilentlyContinue `
        | Sort-Object LastWriteTime -Descending `
        | Select-Object -First 1
    $distTime = (Get-Item $distHtml).LastWriteTime
    if ($newestSrc -and $newestSrc.LastWriteTime -gt $distTime) {
        Write-Host "[build] 前端源码比 dist 新，重新构建..." -ForegroundColor Cyan
        Push-Location $WebDir
        try {
            npm run build
            if ($LASTEXITCODE -ne 0) { throw "npm run build 失败" }
        } finally { Pop-Location }
        Write-Host "[build] 前端构建完成" -ForegroundColor Green
    }
}

# ============================================================
# 后端命令
# ============================================================

function Start-Backend {
    if (Test-PortBusy -Port $BackendPort) {
        Write-Host "[ERROR] 后端已在运行（端口 $BackendPort 被占用）" -ForegroundColor Red
        Write-Host "         如需重启请用: .\manage.ps1 restart"
        exit 1
    }

    Ensure-FrontendBuilt
    if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit 1 }

    Write-Host "[start] 启动后端..." -ForegroundColor Cyan

    Remove-Item $PidFile -ErrorAction SilentlyContinue

    $ok = Start-ProcDetached -Label "backend" -LogFile $LogFile -WorkDir $ProjectDir `
        -ShellCommand "npm run web" -Port $BackendPort
    if (-not $ok) {
        Remove-Item $PidFile -ErrorAction SilentlyContinue
        exit 1
    }

    $realPid = Get-PortProcess -Port $BackendPort
    if ($realPid) { $realPid | Out-File -FilePath $PidFile }

    Write-Host "[ OK ] 后端已启动: http://127.0.0.1:$BackendPort" -ForegroundColor Green
    Write-Host "        PID: $realPid"
    Write-Host "        日志: $LogFile"
}

function Stop-Backend {
    $procIds = @()
    $portPid = Get-PortProcess -Port $BackendPort
    if ($portPid) { $procIds += $portPid }

    # 如果端口没占用，从 PID 文件读
    if ($procIds.Count -eq 0 -and (Test-Path $PidFile)) {
        try {
            $saved = [int](Get-Content $PidFile -Raw).Trim()
            try { $null = Get-Process -Id $saved -ErrorAction Stop; $procIds += $saved } catch { }
        } catch { }
    }

    if ($procIds.Count -eq 0) {
        Write-Host "[info] 后端未运行" -ForegroundColor Yellow
        Remove-Item $PidFile -ErrorAction SilentlyContinue
        return
    }

    Write-Host "[stop] 停止后端..." -ForegroundColor Cyan
    Kill-Tree -Pids $procIds

    if (-not (Wait-PortFree -Port $BackendPort -Timeout $StopTimeout)) {
        Write-Host "[ERROR] 端口 $BackendPort 仍被占用" -ForegroundColor Red
        exit 1
    }

    Remove-Item $PidFile -ErrorAction SilentlyContinue
    Write-Host "[ OK ] 后端已停止" -ForegroundColor Green
}

function Restart-Backend {
    Write-Host "[restart] 重启后端..." -ForegroundColor Cyan

    # 1) 杀旧进程
    if (Test-PortBusy -Port $BackendPort) {
        Write-Host "         1) 杀死旧进程..."
        $portPid = Get-PortProcess -Port $BackendPort
        if ($portPid) { Kill-Tree -Pids @($portPid) }
        if (-not (Wait-PortFree -Port $BackendPort -Timeout $StopTimeout)) {
            Write-Host "[ERROR] 端口 $BackendPort 释放超时" -ForegroundColor Red
            exit 1
        }
    } else {
        Write-Host "         1) 无残留进程"
    }

    Start-Sleep -Seconds 1

    # 2) 启动
    Write-Host "         2) 启动新进程..."

    if (Test-PortBusy -Port $BackendPort) {
        Write-Host "[ERROR] 端口 $BackendPort 仍被占用" -ForegroundColor Red
        exit 1
    }

    Ensure-FrontendBuilt

    Remove-Item $PidFile -ErrorAction SilentlyContinue

    $ok = Start-ProcDetached -Label "backend" -LogFile $LogFile -WorkDir $ProjectDir `
        -ShellCommand "npm run web" -Port $BackendPort
    if (-not $ok) {
        Remove-Item $PidFile -ErrorAction SilentlyContinue
        exit 1
    }

    $realPid = Get-PortProcess -Port $BackendPort
    if ($realPid) { $realPid | Out-File -FilePath $PidFile }

    Write-Host "[ OK ] 重启完成: http://127.0.0.1:$BackendPort (PID: $realPid)" -ForegroundColor Green
}

function Show-BackendStatus {
    $procId = Get-PortProcess -Port $BackendPort
    if ($procId) {
        Write-Host "[status] 后端运行中" -ForegroundColor Green
        Write-Host "         端口: $BackendPort"
        Write-Host "         PID:  $procId"
        Write-Host "         日志: $LogFile"
    } else {
        Write-Host "[status] 后端未运行" -ForegroundColor Yellow
    }
}

function Show-BackendLogs {
    if (Test-Path $LogFile) {
        Get-Content $LogFile -Wait -Tail 30
    } else {
        Write-Host "[info] 暂无日志文件" -ForegroundColor Yellow
    }
}

# ============================================================
# 前端命令
# ============================================================

function Start-Frontend {
    if (Test-PortBusy -Port $FrontendPort) {
        Write-Host "[ERROR] 前端已在运行（端口 $FrontendPort 被占用）" -ForegroundColor Red
        exit 1
    }

    # 确保依赖
    if (-not (Test-Path "$WebDir\node_modules")) {
        Write-Host "[install] 安装 web 依赖..." -ForegroundColor Cyan
        Push-Location $WebDir
        try { npm install } finally { Pop-Location }
    }

    Write-Host "[start] 启动前端 Vite dev server..." -ForegroundColor Cyan

    $ok = Start-ProcDetached -Label "frontend" -LogFile $DevLog -WorkDir $WebDir `
        -ShellCommand "npm run dev" -Port $FrontendPort
    if (-not $ok) { exit 1 }

    Write-Host "[ OK ] 前端已启动: http://localhost:$FrontendPort" -ForegroundColor Green
}

function Stop-Frontend {
    if (-not (Test-PortBusy -Port $FrontendPort)) {
        Write-Host "[info] 前端未运行" -ForegroundColor Yellow
        return
    }

    Write-Host "[stop] 停止前端..." -ForegroundColor Cyan
    $procIds = Get-FrontendPids
    if ($procIds) { Kill-Tree -Pids $procIds }

    if (-not (Wait-PortFree -Port $FrontendPort -Timeout $StopTimeout)) {
        Write-Host "[ERROR] 端口 $FrontendPort 释放超时" -ForegroundColor Red
        exit 1
    }

    Write-Host "[ OK ] 前端已停止" -ForegroundColor Green
}

function Restart-Frontend {
    Write-Host "[restart] 重启前端..." -ForegroundColor Cyan
    if (Test-PortBusy -Port $FrontendPort) {
        Stop-Frontend
        Start-Sleep -Seconds 1
    }
    Start-Frontend
}

function Show-FrontendStatus {
    $procId = Get-PortProcess -Port $FrontendPort
    if ($procId) {
        Write-Host "[status] 前端运行中" -ForegroundColor Green
        Write-Host "         端口: $FrontendPort"
        Write-Host "         PID:  $procId"
        Write-Host "         URL:  http://localhost:$FrontendPort"
    } else {
        Write-Host "[status] 前端未运行" -ForegroundColor Yellow
    }
}

function Show-FrontendLogs {
    if (Test-Path $DevLog) {
        Get-Content $DevLog -Wait -Tail 30
    } else {
        Write-Host "[info] 暂无日志文件" -ForegroundColor Yellow
    }
}

# ============================================================
# 一键命令（前后端同时）
# ============================================================

function Start-ProcDetached {
    param(
        [string]$Label,
        [string]$LogFile,
        [string]$WorkDir,
        [string]$ShellCommand,
        [int]$Port,
        [switch]$NoBuild
    )
    # 先清旧日志，确保新进程从头写
    Remove-Item $LogFile -ErrorAction SilentlyContinue

    # 把启动命令写成临时脚本，避免 Start-Process -ArgumentList 里管道转义问题
    $tmpScript = "$env:TEMP\my-agent-${Label}-start.ps1"
    @"
`$ErrorActionPreference = 'Stop'
Set-Location '$WorkDir'
try {
    $ShellCommand *>&1 | Out-File -FilePath '$LogFile' -Encoding utf8
} catch {
    `$msg = `$_.Exception.Message
    "[FATAL] `$msg" | Out-File -FilePath '$LogFile' -Encoding utf8
}
"@ | Set-Content -Path $tmpScript -Encoding utf8

    Write-Host "         启动 ${Label} ..." -ForegroundColor DarkGray
    $proc = Start-Process pwsh `
        -ArgumentList "-File", $tmpScript `
        -WindowStyle Hidden `
        -PassThru

    if (-not (Wait-PortReady -Port $Port -Timeout $StartTimeout)) {
        Write-Host "[ERROR] ${Label}启动超时 (${StartTimeout}s)" -ForegroundColor Red
        Write-Host "        日志: $LogFile" -ForegroundColor DarkGray
        if (Test-Path $LogFile) {
            Get-Content $LogFile -Tail 10 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
        }
        try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch { }
        return $false
    }

    Write-Host "         ${Label}已启动 (pid: $($proc.Id))" -ForegroundColor Green
    return $true
}

function All-Start {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  一键启动前后端" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""

    # 后端
    $needBackend = -not (Test-PortBusy -Port $BackendPort)
    if ($needBackend) {
        Write-Host "[1/2] 后端 (port $BackendPort)" -ForegroundColor White
        Ensure-FrontendBuilt
        $ok = Start-ProcDetached -Label "backend" -LogFile $LogFile -WorkDir $ProjectDir `
            -ShellCommand "npm run web" -Port $BackendPort
        if (-not $ok) { return }
    } else {
        Write-Host "[1/2] 后端已在运行 (port $BackendPort)，跳过" -ForegroundColor DarkGray
    }

    # 前端
    $needFrontend = -not (Test-PortBusy -Port $FrontendPort)
    if ($needFrontend) {
        Write-Host "[2/2] 前端 (port $FrontendPort)" -ForegroundColor White
        $ok = Start-ProcDetached -Label "frontend" -LogFile $DevLog -WorkDir $WebDir `
            -ShellCommand "npm run dev" -Port $FrontendPort
        if (-not $ok) { return }
    } else {
        Write-Host "[2/2] 前端已在运行 (port $FrontendPort)，跳过" -ForegroundColor DarkGray
    }

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  后端: http://127.0.0.1:$BackendPort" -ForegroundColor Green
    Write-Host "  前端: http://localhost:$FrontendPort" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
}

function All-Stop {
    Write-Host "[all-stop] 停止前后端 ..." -ForegroundColor Cyan
    $b = Test-PortBusy -Port $BackendPort
    $f = Test-PortBusy -Port $FrontendPort
    if (-not $b -and -not $f) {
        Write-Host "         前后端均未运行" -ForegroundColor Yellow
        return
    }
    if ($b) {
        $procId = Get-PortProcess -Port $BackendPort
        if ($procId) { Kill-Tree -Pids @($procId) }
        $null = Wait-PortFree -Port $BackendPort -Timeout $StopTimeout
        Write-Host "         后端 已停止" -ForegroundColor Green
    }
    if ($f) {
        $procIds = Get-FrontendPids
        if ($procIds) { Kill-Tree -Pids $procIds }
        $null = Wait-PortFree -Port $FrontendPort -Timeout $StopTimeout
        Write-Host "         前端 已停止" -ForegroundColor Green
    }
    Write-Host "[ OK ] 全部停止" -ForegroundColor Green
}

function All-Restart {
    Write-Host "[all-restart] 重启前后端 ..." -ForegroundColor Cyan
    All-Stop
    Start-Sleep -Seconds 1
    All-Start
}

function All-Status {
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  服务状态" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    $b = Test-PortBusy -Port $BackendPort
    $f = Test-PortBusy -Port $FrontendPort
    Write-Host ""
    if ($b) {
        $procId = Get-PortProcess -Port $BackendPort
        Write-Host "  后端  ✅ 运行中  port: $BackendPort  pid: $procId" -ForegroundColor Green
        Write-Host "        http://127.0.0.1:$BackendPort" -ForegroundColor DarkGray
    } else {
        Write-Host "  后端  ❌ 未运行  port: $BackendPort" -ForegroundColor Red
    }
    Write-Host ""
    if ($f) {
        $procId = Get-PortProcess -Port $FrontendPort
        Write-Host "  前端  ✅ 运行中  port: $FrontendPort  pid: $procId" -ForegroundColor Green
        Write-Host "        http://localhost:$FrontendPort" -ForegroundColor DarkGray
    } else {
        Write-Host "  前端  ❌ 未运行  port: $FrontendPort" -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
}


# ============================================================
# 入口
# ============================================================

switch ($Command) {
    "start"       { Start-Backend }
    "stop"        { Stop-Backend }
    "restart"     { Restart-Backend }
    "status"      { Show-BackendStatus }
    "logs"        { Show-BackendLogs }
    "dev-start"   { Start-Frontend }
    "dev-stop"    { Stop-Frontend }
    "dev-restart" { Restart-Frontend }
    "dev-status"  { Show-FrontendStatus }
    "dev-logs"    { Show-FrontendLogs }
    "all-start"   { All-Start }
    "all-stop"    { All-Stop }
    "all-restart" { All-Restart }
    "all-status"  { All-Status }
    default {
        Write-Host "用法: .\manage.ps1 <命令>"
        Write-Host ""
        Write-Host "后端 (端口 $BackendPort):"
        Write-Host "  start        — 启动后端服务"
        Write-Host "  stop         — 停止后端服务"
        Write-Host "  restart      — 重启后端服务"
        Write-Host "  status       — 查看后端状态"
        Write-Host "  logs         — 查看后端实时日志"
        Write-Host ""
        Write-Host "前端 (端口 $FrontendPort):"
        Write-Host "  dev-start    — 启动前端 Vite dev server"
        Write-Host "  dev-stop     — 停止前端 Vite dev server"
        Write-Host "  dev-restart  — 重启前端 Vite dev server"
        Write-Host "  dev-status   — 查看前端状态"
        Write-Host "  dev-logs     — 查看前端实时日志"
        Write-Host ""
        Write-Host "一键 (前后端):"
        Write-Host "  all-start    — 同时启动前后端"
        Write-Host "  all-stop     — 同时停止前后端"
        Write-Host "  all-restart  — 同时重启前后端"
        Write-Host "  all-status   — 查看前后端状态"
    }
}
