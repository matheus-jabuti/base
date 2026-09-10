# Aponta "disparo.porto" para o 127.0.0.1 no arquivo hosts do Windows, pra abrir
# a tela em http://disparo.porto em vez de http://127.0.0.1:8000.
#
# Rode uma vez:   powershell -ExecutionPolicy Bypass -File tools\registrar-host.ps1
# (o script pede elevacao sozinho — o hosts so pode ser alterado como administrador)
#
# Depois disso, suba o servidor na porta 80 pra tirar a porta do endereco:
#   $env:PORT = 80 ; python -m app.server
# (ou deixe PORT vazio: o servidor usa a 80 se estiver livre, senao a 8000)

$ErrorActionPreference = 'Stop'

$hosts = "$env:SystemRoot\System32\drivers\etc\hosts"
$nome  = 'disparo.porto'
$linha = "127.0.0.1`t$nome"

if (Select-String -Path $hosts -Pattern "\b$([regex]::Escape($nome))\b" -Quiet) {
    Write-Host "'$nome' ja esta no hosts. Nada a fazer." -ForegroundColor Green
    return
}

$souAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $souAdmin) {
    Write-Host "Preciso de administrador pra editar o hosts. Abrindo o prompt de elevacao..."
    Start-Process powershell -Verb RunAs -ArgumentList @(
        '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`""
    )
    return
}

Add-Content -Path $hosts -Value "`r`n$linha"
ipconfig /flushdns | Out-Null
Write-Host "Pronto. 'http://$nome' agora aponta pra esta maquina." -ForegroundColor Green
Write-Host "Suba o servidor com a porta 80 pra abrir sem a porta no endereco." -ForegroundColor Green
