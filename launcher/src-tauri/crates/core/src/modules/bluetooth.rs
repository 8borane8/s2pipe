use btleplug::api::{Central, CentralEvent, Manager as _, Peripheral, ScanFilter};
use btleplug::platform::Manager;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::time::timeout;

const NINTENDO_COMPANY_ID: u16 = 0x0553;
const NINTENDO_MAGIC: [u8; 5] = [0x01, 0x00, 0x03, 0x7E, 0x05];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WakeScanResult {
    pub switch_bt_mac: String,
    pub controller_bt_mac: String,
    pub controller_bt_pid: String,
}

struct ParsedAdvert {
    switch_mac: Option<[u8; 6]>,
    pid: u16,
}

fn parse_at(data: &[u8], offset: usize) -> Option<ParsedAdvert> {
    if offset + 11 > data.len() {
        return None;
    }

    let pid = (data[offset] as u16) | ((data[offset + 1] as u16) << 8);
    let rev = &data[offset + 5..offset + 11];
    let switch_mac = if rev.iter().all(|&b| b == 0) {
        None
    } else {
        let mut mac = [0u8; 6];
        for (i, b) in rev.iter().rev().enumerate() {
            mac[i] = *b;
        }
        Some(mac)
    };

    Some(ParsedAdvert { switch_mac, pid })
}

fn parse_nintendo(data: &[u8]) -> Option<ParsedAdvert> {
    let magic_len = NINTENDO_MAGIC.len();
    if data.len() < magic_len {
        return None;
    }
    let idx = (0..=data.len() - magic_len).find(|&i| data[i..i + magic_len] == NINTENDO_MAGIC)?;
    parse_at(data, idx + magic_len)
}

fn from_advert(mfg: &[u8]) -> Option<ParsedAdvert> {
    parse_nintendo(mfg).or_else(|| parse_at(mfg, 0))
}

fn mac_to_string(mac: &[u8; 6]) -> String {
    mac.iter()
        .map(|b| format!("{:02X}", b))
        .collect::<Vec<_>>()
        .join(":")
}

pub async fn scan_bluetooth_pad(timeout_ms: u64) -> Result<Option<WakeScanResult>, String> {
    let manager = Manager::new().await.map_err(|e| e.to_string())?;
    let adapters = manager.adapters().await.map_err(|e| e.to_string())?;
    let central = adapters
        .into_iter()
        .next()
        .ok_or_else(|| "No Bluetooth adapter found".to_string())?;

    let mut events = central.events().await.map_err(|e| e.to_string())?;
    central
        .start_scan(ScanFilter::default())
        .await
        .map_err(|e| e.to_string())?;

    let scan_future = async {
        while let Some(event) = events.next().await {
            let CentralEvent::ManufacturerDataAdvertisement {
                id,
                manufacturer_data,
            } = event
            else {
                continue;
            };

            let Some(mfg) = manufacturer_data.get(&NINTENDO_COMPANY_ID) else {
                continue;
            };
            let Some(parsed) = from_advert(mfg) else {
                continue;
            };

            let address = match central.peripheral(&id).await {
                Ok(peripheral) => peripheral.address().to_string(),
                Err(_) => id.to_string(),
            };

            return Some(WakeScanResult {
                switch_bt_mac: parsed
                    .switch_mac
                    .map(|m| mac_to_string(&m))
                    .unwrap_or_default(),
                controller_bt_mac: address,
                controller_bt_pid: format!("0x{:04X}", parsed.pid),
            });
        }
        None
    };

    let result = timeout(Duration::from_millis(timeout_ms), scan_future)
        .await
        .unwrap_or(None);
    let _ = central.stop_scan().await;
    Ok(result)
}
