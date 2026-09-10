use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialPortInfo {
    pub path: String,
    pub label: String,
}

pub fn list_serial_ports() -> Result<Vec<SerialPortInfo>, String> {
    serialport::available_ports()
        .map_err(|e| e.to_string())
        .map(|ports| {
            ports
                .into_iter()
                .map(|port| SerialPortInfo {
                    label: port.port_name.clone(),
                    path: port.port_name,
                })
                .collect()
        })
}
