# MediaSteru Companion (Android)

A tiny Android app that adds **"Send to PC"** to the Android Share sheet. Share any video link from YouTube, TikTok, or a browser — it's forwarded over your Wi-Fi to the desktop MediaSteru app, which downloads it on the PC.

## How it works

```
Phone (Share → Send to PC)  --Wi-Fi POST :8765/add-->  Desktop MediaSteru
```

The desktop app (v1.0.3+) listens on port 8765 on the local network. Its diagnostic log records the reachable LAN address at startup, e.g.:

```
[Companion] Phone companion can reach this PC at: http://192.168.1.10:8765
```

## Setup

1. Build & install the APK (see below), or grab it from Releases.
2. Open the app once → enter the PC's LAN IP (instructions below) → **Save & Test**.
3. From now on, just use the Share button in any app → **Send to PC**.

Requirements: phone and PC on the same Wi-Fi, desktop app running. On the first connection, the firewall may ask to allow MediaSteru, Java, or Electron — accept access on private networks.

---

## How to find your PC's IP address

Your phone needs to know your computer's local IP address on the Wi-Fi network. Use the method for your operating system:

**On Windows:**

1. Press **Win + R**, type `cmd` and press **Enter**.
2. Run:
   ```cmd
   ipconfig
   ```
3. Look for your active adapter (**"Wireless LAN adapter Wi-Fi"** or **"Ethernet adapter"**) and find the **IPv4 Address**:
   ```
   IPv4 Address. . . . . . . . . . . : 192.168.1.10
   ```
4. Enter that IP into the companion app and tap **Save & Test**.

**On macOS:**

1. Open **System Settings → Wi-Fi** → click **Details** next to your connected network → find **IP Address**.
2. Or in Terminal, run: `ipconfig getifaddr en0`

**On Linux:**

1. In Terminal, run: `hostname -I` or `ip addr show` and look for the `inet` address under your active interface (`wlan0`, `eth0`, etc.).

As a diagnostic fallback, the Swing client exposes the startup line under **Show details**. The Electron client keeps it in the bounded application log instead of displaying a developer console in the main interface.

### Important Notes

- Local IP addresses may **change when restarting your router or reconnecting Wi-Fi**. If the phone app fails to connect later, re-check your IP.
- The phone and PC must be connected to the **same Wi-Fi network**.
- If connection fails, check if **Windows Firewall** or another firewall is blocking Java port `8765`.

## Build

Open this folder in Android Studio, or:

```bash
gradle assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```
