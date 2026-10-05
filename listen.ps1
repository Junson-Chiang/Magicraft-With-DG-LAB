param([int]$Port = 17891)
$ErrorActionPreference = 'Stop'
$udp = [System.Net.Sockets.UdpClient]::new([System.Net.IPEndPoint]::new([System.Net.IPAddress]::Loopback, $Port))
$udp.Client.ReceiveTimeout = 1000
Write-Host "Listening on 127.0.0.1:$Port. Ctrl+C to stop."
try {
    while ($true) {
        $remote = [System.Net.IPEndPoint]::new([System.Net.IPAddress]::Any, 0)
        try { $bytes = $udp.Receive([ref]$remote); [System.Text.Encoding]::UTF8.GetString($bytes) }
        catch [System.Net.Sockets.SocketException] { if ($_.Exception.SocketErrorCode -ne 'TimedOut') { throw } }
    }
} finally { $udp.Dispose() }
