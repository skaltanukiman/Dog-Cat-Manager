# このスクリプトがあるフォルダへ移動
Set-Location -LiteralPath $PSScriptRoot

# Docker Desktop 起動
$dockerDesktopPath = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"

if (Test-Path $dockerDesktopPath) {
    Write-Host "Docker Desktop を起動します..."
    Start-Process $dockerDesktopPath
} else {
    throw "Docker Desktop が見つかりませんでした。インストール先を確認してください: $dockerDesktopPath"
}

Write-Host "Docker の起動完了を待機しています..."

$maxRetry = 30

# dockerの起動を60秒間一定間隔でチェックする
for ($i = 1; $i -le $maxRetry; $i++) {
    docker info *> $null

    if ($LASTEXITCODE -eq 0) {
        Write-Host "Docker が起動しました。"
        break
    }

    Write-Host "Docker の起動待機中... $i / $maxRetry"
    Start-Sleep -Seconds 2
}

if ($LASTEXITCODE -ne 0) {
    throw "Docker が起動しませんでした。Docker Desktop の状態を確認してください。"
}

# 環境変数を設定
$env:ENV_FILE=".env.development"

Write-Host "設定ファイルをセットしました。"

# Docker コンテナ起動
Write-Host "Docker コンテナを起動します..."

docker compose up -d app

if ($LASTEXITCODE -ne 0) {
    throw "Docker コンテナの起動に失敗しました。docker compose.yml や Docker Desktop の状態を確認してください。"
}

Write-Host "Docker コンテナを起動しました。"

# ブラウザで localhost を開く
Start-Process "http://localhost:3002"

Write-Host ""
Write-Host "準備が完了しました。"
Write-Host ""
