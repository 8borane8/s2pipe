use std::net::UdpSocket;
use std::time::Duration;

/// IPv4 of the interface used to reach the internet, which is the LAN address
/// other devices on the same network should use.
pub fn local_ip() -> Result<String, String> {
    let socket =
        UdpSocket::bind("0.0.0.0:0").map_err(|e| format!("Unable to detect LAN IP: {e}"))?;
    socket
        .connect("1.1.1.1:80")
        .map_err(|e| format!("Unable to detect LAN IP: {e}"))?;
    match socket
        .local_addr()
        .map_err(|e| format!("Unable to detect LAN IP: {e}"))?
    {
        std::net::SocketAddr::V4(addr) => Ok(addr.ip().to_string()),
        std::net::SocketAddr::V6(_) => Err("Unable to detect an IPv4 LAN address".into()),
    }
}

pub async fn public_ip() -> Result<String, String> {
    let fetch = async {
        let response = reqwest::get("https://api.ipify.org")
            .await
            .map_err(|e| format!("Unable to detect public IP: {e}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "Unable to detect public IP (HTTP {})",
                response.status()
            ));
        }
        let ip = response
            .text()
            .await
            .map_err(|e| format!("Unable to detect public IP: {e}"))?;
        let ip = ip.trim();
        if ip.is_empty() {
            return Err("Unable to detect public IP".into());
        }
        Ok(ip.to_string())
    };

    tokio::time::timeout(Duration::from_secs(5), fetch)
        .await
        .map_err(|_| "Timed out detecting public IP".to_string())?
}
