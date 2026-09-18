# USB and device-layer observation for a Mercado Pago Point terminal

- Date: 2026-09-16.
- Scope: the local USB observation tools, a read-only capture procedure, the safety
  limits, and the public prior art for host-side terminal integration.
- Host: Pop!_OS 24.04 LTS, kernel 6.17.9-76061709-generic, x86_64. User `jc`, uid 1000.
- Method: primary sources first. Every claim carries a label. Every command in this file
  ran on the host, unless the text says otherwise.
- Related files: `01-*` (hardware identification), `03-prior-art-terminal-integration.md`
  (vendor SDK matrix), `04-mercadopago-point-integration-surface.md` (Mercado Pago
  specifics).

## Verdict

1. The host can already identify a plugged terminal without root, and in full detail.
   `usb-devices` reads sysfs and prints every descriptor and string.
2. Full bus capture needs root, because `usbmon` needs `modprobe` and debugfs access.
3. The host is missing four tools that the procedure uses: `tshark`, `evtest`,
   `libinput-tools`, and `socat`. All four are in the Ubuntu archive.
4. The user `jc` is not in the `plugdev`, `dialout`, `input`, or `wireshark` groups.
   No udev rule for a payment terminal exists on the host.
5. The safest first step is passive: enumerate the device, watch the kernel log, and read
   the descriptors. Send nothing to the terminal.
6. A vendor-specific USB interface is the expected outcome for a payment terminal. That
   interface tells us the transport, not the protocol.
7. Mercado Pago publishes no USB, serial, or Bluetooth protocol for the Point. Its
   SmartApp rules forbid "Use of the USB port for information transmission".
8. Only a Mercado Pago development terminal has the USB port enabled. Mercado Pago issues
   that unit through its business team.
9. The supported Mercado Pago route is the cloud Orders API. The POS never opens a channel
   to the device.
10. The host can still learn a lot from the first plug-in, so the exploration keeps its
    value: model, OEM, boot mode, and the state of the port.

## Step 0. Tool selection

| Question                              | Answer                                                                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Does a proven tool already do this?   | Yes. `usb-devices`, `lsusb`, `udevadm`, and `usbmon` cover the whole job.                                                               |
| Is it installed here?                 | Mostly. `usb-devices`, `lsusb`, `udevadm`, `usbhid-dump`, `adb` are present. `tshark`, `evtest`, `libinput-tools`, `socat` are missing. |
| Can an agent drive it with no prompt? | Yes for all of the above. `dmesg` needs root, so use `journalctl -k`.                                                                   |
| What does adoption cost?              | One `apt-get install` for the four missing tools. No service changes.                                                                   |
| What is the fallback?                 | `xxd` on the raw sysfs descriptor file, plus the raw `usbmon` text stream.                                                              |

## Part A. Local tooling inventory

All rows were tested on the host on 2026-09-16.

### A.1 Tools that are present

| Tool             | Version              | Exact command                                               | Root needed |
| ---------------- | -------------------- | ----------------------------------------------------------- | ----------- |
| `lsusb`          | usbutils 017         | `lsusb`; `lsusb -t`; `lsusb -d VVVV:PPPP`                   | No          |
| `lsusb -v`       | usbutils 017         | `lsusb -v -d VVVV:PPPP`                                     | **Yes**     |
| `usb-devices`    | usbutils 017 (shell) | `usb-devices`                                               | No          |
| `usbhid-dump`    | usbutils 017         | `usbhid-dump -d VVVV:PPPP -e descriptor`                    | **Yes**     |
| `udevadm`        | 255                  | `udevadm info -q all -p /sys/bus/usb/devices/B-D`           | No          |
| `udevadm` watch  | 255                  | `udevadm monitor --kernel --property --subsystem-match=usb` | No          |
| `journalctl`     | systemd              | `journalctl -k -f`                                          | No          |
| `dmesg`          | util-linux           | `dmesg -w`                                                  | **Yes**     |
| `usbmon` module  | kernel 6.17.9        | `lsmod` (look for `usbmon`); `sudo modprobe usbmon`         | **Yes**     |
| `bluetoothctl`   | bluez 5.72           | `bluetoothctl list`; `bluetoothctl scan on`                 | No          |
| `hcitool`        | bluez 5.72           | `hcitool dev`                                               | No          |
| `mmcli`          | ModemManager         | `mmcli -L`                                                  | No          |
| `adb`            | 1.0.41 (37.0.1)      | `adb devices -l`                                            | No          |
| `usb-modeswitch` | 2.6.1-3ubuntu3       | automatic, via `/lib/udev/rules.d/40-usb_modeswitch.rules`  | No          |
| `rfkill`         | util-linux           | `rfkill list`                                               | No          |
| `nmcli`          | NetworkManager       | `nmcli device status`                                       | No          |
| `xxd`            | vim-common           | `xxd /sys/bus/usb/devices/B-D/descriptors`                  | No          |
| `lsof`           | lsof                 | `lsof /dev/ttyACM0`                                         | No          |

Notes on the present tools.

- Documented fact. `usb-devices` printed the full tree with strings on the host as
  non-root. It showed `Vendor`, `ProdID`, `Rev`, `Manufacturer`, `Product`,
  `SerialNumber`, `#Ifs`, `Cls`, `Sub`, `Prot`, `Driver`, every endpoint, and `Spd`.
- Documented fact. `lsusb -v` as non-root printed
  `Couldn't open device, some information will be missing`. `lsusb` opens the usbfs node
  read-write. The kernel denies that for a non-root user, even though the node mode is
  `crw-rw-r--`.
- Documented fact. `usbhid-dump` as non-root failed with the reason in plain words:
  `libusb: error [get_usbfs_fd] libusb requires write access to USB device nodes`, then
  `Failed to find and open the devices: Access denied (insufficient permissions)`. Any
  libusb tool needs write access to the usbfs node, so any libusb tool needs root or a udev
  rule on this host.
- Documented fact. A read-only open of a usbfs node works as non-root. The test
  `head -c 18 /dev/bus/usb/001/002` returned the 18-byte device descriptor.
- Documented fact. `/sys/kernel/debug/usb/usbmon` returned `Permission denied` as
  non-root. `debugfs` is mounted read-write at `/sys/kernel/debug`.
- Documented fact. `kernel.dmesg_restrict = 1` on the host. `dmesg` as non-root returned
  `read kernel buffer failed: Operation not permitted`. `journalctl -k` worked.
- Documented fact. The `usbmon` kernel module file exists at
  `/lib/modules/6.17.9-76061709-generic/kernel/drivers/usb/mon/usbmon.ko.zst`. The module
  was not loaded.
- Documented fact. `usb-devices` is a POSIX shell script. It is part of `usbutils`, the
  same package as `lsusb`.

### A.2 Tools that are missing

| Tool            | Ubuntu package   | Candidate version  | Root needed                        |
| --------------- | ---------------- | ------------------ | ---------------------------------- |
| `tshark`        | `tshark`         | 4.2.2-1.1build3    | Yes to capture on `usbmon`         |
| `dumpcap`       | `tshark`         | 4.2.2-1.1build3    | See below                          |
| `wireshark` GUI | `wireshark`      | 4.2.2-1.1build3    | Yes to capture                     |
| `evtest`        | `evtest`         | 1:1.35-1           | Yes, unless the node grants access |
| `libinput`      | `libinput-tools` | 1.25.0-1ubuntu3.7  | No                                 |
| `socat`         | `socat`          | 1.8.0.0-4ubuntu0.1 | No                                 |
| `pyserial`      | `python3-serial` | 3.5-2              | No                                 |
| `pyusb`         | `python3-usb`    | 1.2.1-2            | Depends on the node                |
| `screen`        | `screen`         | 4.9.1-1ubuntu1     | No                                 |
| `minicom`       | `minicom`        | UNVERIFIED         | No                                 |
| `tio`           | `tio`            | UNVERIFIED         | No                                 |
| `usbip`         | `usbip`          | UNVERIFIED         | Yes                                |
| `usbguard`      | `usbguard`       | UNVERIFIED         | Yes                                |
| `gphoto2`       | `gphoto2`        | UNVERIFIED         | No                                 |

- Documented fact. `apt-cache policy` listed `Installed: (none)` for `tshark`,
  `evtest`, `libinput-tools`, `socat`, `python3-serial`, `python3-usb`, `bluez-tools`, and
  `usbguard`.
- Documented fact. `apt-get -s install socat` resolved to
  `socat (1.8.0.0-4ubuntu0.1 Ubuntu:24.04/noble-security, Ubuntu:24.04/noble-updates)`.
  The host can reach the Ubuntu archive.

Install command for the four tools the procedure needs:

```bash
sudo apt-get install -y evtest libinput-tools socat
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y tshark
sudo usermod -aG wireshark "$USER"
```

- Documented fact. The `tshark` package post-install asks a debconf question about
  non-root capture. `DEBIAN_FRONTEND=noninteractive` skips the question.
- Inference. The `wireshark` group exists only after `dpkg-reconfigure wireshark-common`
  answers Yes. The `usermod` line is useless before that step. `getent group wireshark`
  returned nothing on the host today.
- Inference. `apt-get install` needs a password on this host. The test `sudo -n true`
  returned `sudo: a password is required`. Every `sudo` command in this procedure needs
  the user at the keyboard.

Python packages, given PEP 668:

```bash
# The host marks /usr/lib/python3.12/EXTERNALLY-MANAGED, so pip refuses a system install.
uv venv .venv-usb && uv pip install --python .venv-usb/bin/python pyserial pyusb
```

- Documented fact. `/usr/lib/python3.12/EXTERNALLY-MANAGED` exists. `pip 24.0` is
  installed. `uv 0.12.7` is installed at `/home/jc/.local/bin/uv`.
- Documented fact. `python3 -c "import serial"` and `python3 -c "import usb"` both failed
  with `ModuleNotFoundError`.
- Documented fact. `libusb-1.0.so.0` is present at `/lib/x86_64-linux-gnu/`. `pyusb` can
  use it after install.

### A.3 Group membership and device node permissions

- Documented fact. `id` returned `uid=1000(jc) gid=1000(jc)
groups=1000(jc),4(adm),27(sudo),108(lpadmin),127(docker)`.
- Documented fact. `jc` is **not** a member of `plugdev`, `dialout`, `input`, or
  `wireshark`.
- Documented fact. The groups exist but are empty. `getent group plugdev` returned
  `plugdev:x:46:` and `getent group dialout` returned `dialout:x:20:`. `getent group input`
  returned `input:x:995:`.
- Documented fact. `/dev/hidraw0` through `/dev/hidraw10` exist with mode
  `crw------- root root`. A non-root user cannot read them.
- Documented fact. `/dev/input/event0` has mode `crw-rw---- root input`. `jc` is not in
  `input`, and the node has no ACL. A non-root user cannot read it.
- Documented fact. `/dev/bus/usb/001/*` nodes have mode `crw-rw-r-- root root`. A
  read-only open succeeds as non-root.
- Documented fact. `/dev/ttyACM*` and `/dev/ttyUSB*` do not exist today. No serial device
  is attached.

### A.4 Existing udev rules

- Documented fact. `/etc/udev/rules.d/` is empty. The host has no local rule.
- Documented fact. No rule anywhere in `/etc/udev/rules.d/` or `/lib/udev/rules.d/`
  matches Mercado Pago, Ingenico, Verifone, Newland, or Castles. The search matched only
  `/lib/udev/rules.d/90-console-setup.rules` on the word `terminal`, in the sense of a
  terminal console.
- Documented fact. `/lib/udev/rules.d/40-usb_modeswitch.rules` is present. A USB modem,
  including a cellular terminal, may switch mode automatically on plug-in.
- Documented fact. `/lib/udev/rules.d/70-uaccess.rules` line 14 reads
  `SUBSYSTEM=="usb", ENV{ID_USB_INTERFACES}=="*:060101:*", TAG+="uaccess"`. A USB device
  that exposes a still-image interface gets automatic access for the seat user.
- Documented fact. `/lib/udev/rules.d/70-uaccess.rules` line 89 grants `uaccess` to
  `hidraw` nodes only for AV production controllers. A payment terminal will not match.
- Inference. A vendor-specific `hidraw` interface on the terminal will stay root-only.
  Read it with `sudo`, or add a scoped udev rule later, after the team decides.

### A.5 Bluetooth state

- Documented fact. `bluetoothctl --version` returned `5.72`. The `bluetooth` systemd unit
  is active.
- Documented fact. `bluetoothctl list` returned one controller:
  `Controller A8:86:DD:A4:EC:58 pop-os [default]`.
- Documented fact. `rfkill list` shows `2: hci0: Bluetooth` with `Soft blocked: yes`. The
  Bluetooth radio is off until something unblocks it.
- Inference. `bluetoothctl scan on` will find nothing until the radio is unblocked.
  `rfkill unblock bluetooth` needs polkit authorization or root.

### A.6 What is observable without root

| Observation                        | Non-root? | Exact route                                    |
| ---------------------------------- | --------- | ---------------------------------------------- |
| New device appears, with VID:PID   | Yes       | `udevadm monitor`, `lsusb`, `journalctl -k -f` |
| Full descriptor tree, with strings | Yes       | `usb-devices`                                  |
| Raw descriptor bytes               | Yes       | `xxd /sys/bus/usb/devices/B-D/descriptors`     |
| Interface class, driver, and speed | Yes       | `lsusb -t`, `usb-devices`                      |
| Raw usbfs node, read-only          | Yes       | `head -c 18 /dev/bus/usb/BBB/DDD`              |
| Kernel messages about the device   | Yes       | `journalctl -k -f`                             |
| `lsusb -v` full verbose tree       | **No**    | Needs read-write open of the usbfs node        |
| `usbmon` bus capture               | **No**    | Needs `modprobe` and debugfs                   |
| `hidraw` report stream             | **No**    | Node mode is `0600 root:root`                  |
| `evdev` event stream               | **No**    | `jc` is not in the `input` group               |
| Mass-storage mount (USB mode 08)   | **No**    | Needs root or a desktop automount helper       |

- Documented fact. `/dev/input/by-id/` is readable as non-root. It names each input device,
  for example `usb-OBINS_OBINS_AnnePro2_...-event-if01`. Use it to spot a keyboard-wedge
  terminal by name.

## Part B. Read-only capture procedure

Run the steps in order. Stop at the first step that answers the question.

### B.0 Preparation, before the terminal arrives

1. Record the baseline. Save it, so the diff is trivial later.

```bash
mkdir -p ~/mp-point-usb
lsusb > ~/mp-point-usb/lsusb-before.txt
lsusb -t > ~/mp-point-usb/lsusb-tree-before.txt
```

2. Open two watch windows. Keep both open while you plug the terminal in.

```bash
# Window 1: kernel and udev events. No root.
udevadm monitor --kernel --property --subsystem-match=usb

# Window 2: kernel ring messages. No root.
journalctl -k -f
```

3. Decide the capture plan. Install the four missing tools first, if the team wants a bus
   capture on the first attempt. Step B.4c needs root.

### B.1 Identify the device

1. Plug the terminal into a port on bus 001 or bus 003. Both are xHCI root hubs with free
   ports.
2. Read the new device from the watch windows. Note the `BUSNUM`, `DEVNUM`, and the
   `devpath`, for example `1-3`.
3. List the new device.

```bash
lsusb | grep -i -E 'VVVV:PPPP|point|mercado'
lsusb -t
```

4. Read the full identity. This step needs no root.

```bash
usb-devices
udevadm info -q all -p /sys/bus/usb/devices/B-D
```

5. If a root shell is available, read the verbose tree. Use `-v` for descriptors, and
   `-vv` for the class-specific descriptors when needed.

```bash
sudo lsusb -v -d VVVV:PPPP > ~/mp-point-usb/descriptors.txt 2>&1
sudo usbhid-dump -d VVVV:PPPP -e descriptor > ~/mp-point-usb/hid-report-descriptor.txt
```

6. Record these fields for every attempt:

- `idVendor` and `idProduct`.
- `bcdDevice`: the device revision. This is the closest thing to a firmware version in
  the descriptor.
- `bDeviceClass`, `bDeviceSubClass`, `bDeviceProtocol`.
- `bNumConfigurations`.
- Per interface: `bInterfaceNumber`, `bInterfaceClass`, `bInterfaceSubClass`,
  `bInterfaceProtocol`, `bNumEndpoints`, and the bound `Driver`.
- Per endpoint: `bEndpointAddress`, `bmAttributes`, and `wMaxPacketSize`.
- `iManufacturer`, `iProduct`, and `iSerialNumber` strings.
- `bMaxPower` and `bmAttributes` (self-powered, remote wakeup).
- `Spd` from `usb-devices`, or the speed column from `lsusb -t`. A value of 12M means
  full speed, 480M means high speed, and 5000M means SuperSpeed.

- Inference. The `bcdDevice` value is a firmware hint only. A full firmware string usually
  needs a vendor command, and this procedure never sends one.

### B.2 Determine the boot mode

Read the interface class from `usb-devices`. Match it against this table.

| Interface class (hex)       | Meaning            | What you see                                      | Check command                                  |
| --------------------------- | ------------------ | ------------------------------------------------- | ---------------------------------------------- |
| `03` HID                    | HID keyboard wedge | New `/dev/input/event*`, and a `usbhid` driver    | `ls /dev/input/by-id/`                         |
| `03` HID with subclass `00` | HID vendor-defined | `usbhid` binds, no standard input events          | `usbhid-dump -e stream`                        |
| `02/02/01` plus `0A/00/00`  | CDC-ACM serial     | New `/dev/ttyACM0`                                | `ls -l /dev/ttyACM*`                           |
| `0A/00/00` with `02/06/00`  | CDC-ECM network    | New `enx...` network interface                    | `nmcli device status`                          |
| `0A/00/00` with `02/0D/00`  | CDC-NCM network    | New network interface                             | `ip -brief link show`                          |
| `EF/04/01`                  | RNDIS              | New network interface, Windows-style gadget       | `ip -brief link show`                          |
| `08` MSC                    | Mass storage       | New `/dev/sdX`, visible to `lsblk`                | `lsblk -o NAME,SIZE,MODEL,SERIAL`              |
| `FF` vendor-specific        | Proprietary        | No standard driver, or a vendor driver            | `usb-devices`, driver column                   |
| `06` still image            | PTP camera-style   | Usually a "file access" mode                      | `gphoto2 --auto-detect` (`gphoto2` is missing) |
| `01` audio                  | Audio              | Not a payment path                                | `pactl list cards`                             |
| `18D1:0D00` or `18D1:D00D`  | Android bootloader | Fastboot mode, not Android. A flashing interface. | `lsusb` only. Run no `fastboot` command.       |

Android and ADB:

```bash
adb devices -l
```

- Documented fact. `adb` is installed at
  `/home/jc/.local/share/android-sdk/platform-tools/adb`, version 1.0.41 (37.0.1).
- Inference. An Android-based terminal normally shows a vendor-specific interface plus, in
  developer mode, an ADB interface. `adb devices` returns nothing when the terminal keeps
  developer mode off. Do not enable developer mode on a production terminal without the
  owner's written approval.

Fastboot mode:

- Community evidence. A reverse-engineering session on a Point Smart 2 (Newland N950) in
  fastboot mode reported vendor id : product id `0x18D1 : 0xD00D`, `bcdUSB` `0x0210`,
  interface `0xFF`/`0x42`/`0x03`, an interface string `fastboot`, and bulk endpoints
  `0x81` IN and `0x01` OUT at 512 bytes. Device strings were `Google`, `Android`,
  `ncd100037318`, and `fastboot`. No Sahara, Firehose, or Diag interface was present.
  Source: `n950-research/comandos-probados.md` in the `mercurioctrl/obsidian-hermess`
  repository (rung 5).
- Documented fact. `0x18D1` is Google. A `0x18D1` vendor id means the terminal booted its
  bootloader, not Android.
- Inference. Fastboot is a flashing and low-level control interface. Treat it as a
  hard stop. Never run `fastboot flash`, `fastboot erase`, `fastboot reboot`, or any other
  `fastboot` subcommand against a production terminal. A wrong write can brick the unit.
- Community evidence. The same knowledge base reports that the N950 disables the USB
  client at runtime. After Android boots, the port does not enumerate, so neither ADB nor
  fastboot is available. Label: community evidence, UNVERIFIED.
- Documented fact. A public GitHub issue on `mercadolibre/point-mainapp-demo-android`
  (issue 84, open since 2025-11-15) records that `adb` did not recognize a connected Point
  Smart 2. Source: https://github.com/mercadolibre/point-mainapp-demo-android/issues/84
  (rung 3).

Charging-only detection:

- Inference. A charging-only port shows no new USB device in `udevadm monitor`, or shows a
  device that disappears after a second. A power-only cable or a power-only port can give
  the same result. Test a second cable and a second port before you conclude anything.

Network-gadget detection:

```bash
nmcli device status
ip -brief address show
```

- Documented fact. `nmcli` and `ip` are installed.
- Inference. A terminal in RNDIS, ECM, or NCM mode creates a new network interface. Do not
  send traffic on that interface. Do not configure it. Observation only.

### B.3 Passive capture

Goal: record what the terminal and the host already say to each other, and send nothing
new.

Route A: event level. No root.

```bash
udevadm monitor --kernel --property --subsystem-match=usb | tee ~/mp-point-usb/udev-events.txt
journalctl -k -f | tee ~/mp-point-usb/kernel-log.txt
```

- Documented fact. Both commands ran on the host as non-root.
- Documented fact. `udevadm monitor` printed
  `monitor will print the received events for: KERNEL - the kernel uevent`.

Route B: bus level. Root needed.

```bash
# 1. Load the monitor module. Root needed, and it is not loaded today.
sudo modprobe usbmon
ls /sys/kernel/debug/usb/usbmon/

# 2. Capture with tshark, once tshark is installed.
sudo tshark -i usbmon1 -w ~/mp-point-usb/usbmon1.pcapng

# 3. Read the capture back with no root.
tshark -r ~/mp-point-usb/usbmon1.pcapng -V
```

- Documented fact. `lsusb -t` shows bus 001 at 480M and bus 003 at 5000M. Use the
  `usbmon` interface for the bus that carries the terminal, for example `usbmon1` for
  bus 001.
- Inference. `usbmon` names its interfaces `usbmon0` for all buses, then one per bus.
  Confirm the mapping with `ls /sys/kernel/debug/usb/usbmon/` after the `modprobe`.

Route C: bus level without `tshark`. No install needed, but root is.

```bash
sudo modprobe usbmon
sudo cat /sys/kernel/debug/usb/usbmon/1u | tee ~/mp-point-usb/usbmon-1u.txt
```

- Documented fact. The `usbmon` kernel module writes a plain-text stream to the debugfs
  file. The `u` suffix selects the text format.
- Inference. The text stream is readable by eye and by a text filter. It is a workable
  fallback when the team does not want to install Wireshark.

Why passive matters for a payment device:

- Source-backed tradeoff. A passive capture reads a copy of the traffic. The capture
  itself sends no packet. An active probe writes URBs to a vendor-specific interface. The
  writes can change device state, and a payment terminal may log them as tampering.
- Documented fact. The host kernel itself is not passive during enumeration. The kernel
  sends `SET_ADDRESS`, `GET_DESCRIPTOR`, `SET_CONFIGURATION`, and, for HID, `SET_IDLE` and
  `GET_REPORT`. Those messages come from the Linux USB core, not from this procedure.
- Inference. Filter the capture by endpoint to separate the host core traffic from the
  terminal's own reports. Data on an interrupt-IN endpoint is terminal-to-host. Data on a
  bulk-OUT endpoint is host-to-terminal.

Capture hygiene:

```bash
chmod 600 ~/mp-point-usb/usbmon1.pcapng
sha256sum ~/mp-point-usb/*.pcapng > ~/mp-point-usb/SHA256SUMS
```

- Inference. A bus capture of a live terminal may hold sensitive data. Restrict the file
  mode, record a hash, and delete the capture when the analysis ends.

### B.4 What the USB layer can and cannot tell us

The USB layer can answer:

- Whether the terminal exposes a data interface at all, or only power.
- Which transport it offers: HID, CDC-ACM serial, network gadget, mass storage, ADB, or a
  vendor-specific interface.
- Which driver the Linux kernel bound, or that no driver bound.
- The vendor ID, the product ID, the device revision, and the descriptor strings.
- Whether the terminal is Android-based, from the presence of an ADB interface.
- Whether the port ran at full speed, high speed, or SuperSpeed.

The USB layer cannot answer:

- The meaning of any vendor message. Descriptors describe the pipe, not the protocol.
- Whether a certified host application is required to start a transaction.
- The key management. A point-to-point encrypted link yields ciphertext only.
- Card data. The capture must never contain a card number. If it ever does, stop, treat the
  file as cardholder data, and report it.

What a vendor-specific interface implies:

- Documented fact. Interface class `FF` means the vendor defines the protocol. No standard
  Linux driver matches it.
- Inference. A vendor-specific interface almost always means the vendor ships a host SDK, a
  vendor kernel driver, or an Android service. Without one of those, a POS cannot use the
  interface. See `03-prior-art-terminal-integration.md` and
  `04-mercadopago-point-integration-surface.md`.
- Inference. Reverse-engineering that interface is a technical step and a commercial and
  certification question at the same time. The answer to the commercial question decides
  whether the technical step is worth taking.

### B.5 Safety and compliance limits

Do not do these things with a live payment terminal:

1. Do not fuzz the device. Do not send random or crafted URBs to any interface.
2. Do not modify or replace firmware. Do not enter a download or recovery mode.
3. Do not inject, replay, or synthesize a transaction message.
4. Do not attempt to read, export, or overwrite keys.
5. Do not open the case. Do not probe the board.
6. Do not root, jailbreak, or sideload onto an Android terminal.
7. Do not change config menus, including PIN-protected menus such as the "Config" menu on
   comparable terminals.
8. Do not install a udev rule that makes the terminal world-readable during exploration.
9. Do not keep a capture that contains cardholder data.
10. Do not run any `fastboot` subcommand. See step B.2.
11. Do not treat the USB port of a production Point terminal as an integration path. See the
    quoted rule below.

The Mercado Pago rule, in its own words:

- Documented fact. The SmartApp restrictions page forbids "Use of the USB port for
  information transmission". Source:
  https://www.mercadopago.com.mx/developers/en/docs/smartapps/restrictions.md (rung 1).
- Documented fact. The same page forbids the permissions
  `android.permission.USB_PERMISSION` and `android.permission.USB_SET`, and every
  `android.permission.BLUETOOTH*` entry. Source: the same page (rung 1).
- Documented fact. The same page states that card reading, printing, Bluetooth, and the
  camera "must be invoked exclusively through the Mercado Pago SDK and not through direct
  use of permissions declared in the `AndroidManifest`". Source: the same page (rung 1).
- Documented fact. Only a development terminal has the USB port enabled. "Unlike
  production devices, development devices have the USB port enabled by default and
  debugging configuration activated." Source:
  https://www.mercadopago.com.mx/developers/en/docs/smartapps/overview.md (rung 1).
  Mercado Pago issues that unit through its business team only.
- Inference. A plan to read the USB channel of a production terminal for integration
  contradicts the published rules. Reading the bus for diagnosis is a different activity.
  Its legal position is UNVERIFIED.

Why these limits exist:

- Documented fact. PCI PTS approval covers the terminal, its key management, and its
  tamper response. A tamper event can permanently disable a device.
- Inference. A disabled or flagged terminal on a production merchant account costs real
  sales. The first tests must run on a spare or test terminal, not on the live one.
- Inference. The Mercado Pago terms of service govern direct device access. The team must
  read them before any active test. See `04-mercadopago-point-integration-surface.md`.
- Inference. Only the read path is safe without a written decision. Enumerate, watch, and
  read descriptors. Then stop and decide.

### B.6 Evidence to record for each attempt

Use one row per attempt, and one row per mode the terminal shows.

| Field                | Value                                         |
| -------------------- | --------------------------------------------- |
| Date and time        |                                               |
| Host and kernel      | Pop!_OS 24.04, kernel 6.17.9-76061709-generic |
| Cable and port       |                                               |
| Terminal model       |                                               |
| Terminal serial      |                                               |
| Attempt number       |                                               |
| `idVendor:idProduct` |                                               |
| `bcdDevice`          |                                               |
| Manufacturer string  |                                               |
| Product string       |                                               |
| Serial string        |                                               |
| Mode (from B.2)      |                                               |
| Interface classes    |                                               |
| Bound driver         |                                               |
| Speed                |                                               |
| Root used            | Yes or No                                     |
| Capture file         | Path and SHA-256                              |
| Result               |                                               |
| Next step            |                                               |

Also record:

- The full `usb-devices` output, one file per attempt.
- The `udevadm monitor` log and the `journalctl -k` log for the plug-in window.
- Every failed command, with its error text. A failed command is evidence.

## Part C. Prior art

The detailed research lives in two companion files. This section holds the answers that
matter for the USB decision.

| Question                                                         | Answer                                                                    | Label           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------- |
| Does Mercado Pago document a USB, serial, or Bluetooth protocol? | **NO.** No primary source describes a host protocol.                      | Documented fact |
| What is the supported Mercado Pago route?                        | The cloud Orders API. The terminal must be in `PDV` mode.                 | Documented fact |
| May a SmartApp transmit over USB?                                | **No.** The restrictions page forbids it, in those words.                 | Documented fact |
| Does any vendor publish a host-side USB or serial SDK?           | Yes. Verifone, PAX, Ingenico, Newland, and Stone publish one.             | Documented fact |
| Is any vendor SDK open or free to download?                      | Mostly no. Each sits behind registration, an NDA, or a partner program.   | Documented fact |
| Is any _open_ terminal protocol published?                       | Yes. ZVT / ECR-Interface. See below.                                      | Documented fact |
| Does a Linux POS have prior art for a local terminal link?       | Yes. ZVT implementations, and PagSeguro PlugPag 1.x for Bluetooth serial. | Documented fact |
| Which OEM built each Point model?                                | Point Smart 1 = PAX A910. Point Smart 2 = Newland N950.                   | Documented fact |

The supported Mercado Pago route, from the existing repo research
([Mexico payments and fiscal](2026-09-16-mexico-payments-and-fiscal.md)):

1. `GET https://api.mercadopago.com/terminals/v1/list` lists the terminals.
2. `PATCH https://api.mercadopago.com/terminals/v1/setup` sets
   `terminals[].operating_mode` to `PDV`.
3. `POST https://api.mercadopago.com/v1/orders` creates the order. The request needs the
   `X-Idempotency-Key` header.

- Documented fact. The `terminal_id` sample value is
  `NEWLAND_N950__N950NCB801293324`, from the Mercado Pago create-order reference.
- Documented fact. Mercado Pago uses the terminal type as a prefix in the identifier:
  `PAX_A910__...` and `NEWLAND_N950__...`.
- Inference. That route is a cloud route. The POS never opens a channel to the device. The
  USB port on a Point Smart 1 or 2 is therefore a service, charging, or accessory port.
  The first plug-in confirms or refutes this.

### C.1 The one open protocol: ZVT / ECR-Interface

This is the closest analogue to what a Linux POS would need, and it is free.

- Documented fact. The Verband der Terminalhersteller in Deutschland publishes the ZVT
  specification for free download at `https://www.terminalhersteller.de/downloads.aspx`.
  The listed revisions run from 13.07 to 13.13. The page calls it a vendor-independent
  protocol between payment terminals and electronic cash registers (rung 7).
- Documented fact. `https://github.com/EVerest/zvt` (24 stars, Apache-2.0, pushed
  2026-09-11) is a Rust implementation in production on Linux hosts, in Qwello charging
  stations (rung 3).
- Documented fact. `https://github.com/Portalum/Portalum.Zvt` (103 stars, MIT, pushed
  2026-04-22) is a .NET implementation. It supports TCP and a serial connection (rung 3).
- Documented fact. `https://github.com/mathiasfrey/ecrterm` (34 stars, LGPL-3.0, last push
  2021-03-24) is a Python implementation for a Linux host (rung 3).
- Source-backed tradeoff. The ZVT transport section assumes a byte stream. A Bluetooth
  serial port profile can carry a byte stream. No ZVT document found in this review names
  Bluetooth as a transport. That extension is an inference.
- Inference. ZVT is a real option for a European terminal, and it proves the model works:
  a POS host drives a certified terminal over a local link. It does not help with a
  Mercado Pago Point, because Mercado Pago does not implement ZVT on that device.

### C.2 Vendor host SDKs

Legend: [D] documented fact, [T] source-backed tradeoff, [I] inference. Full detail and
sources are in `03-prior-art-terminal-integration.md`.

| Vendor      | Host SDK                                   | Documented local transports                           | Access gate                           |
| ----------- | ------------------------------------------ | ----------------------------------------------------- | ------------------------------------- |
| Ingenico    | Developer Program SDK, legacy POSgate      | IP, Wi-Fi, Bluetooth, 4G, **USB, serial, Ethernet**   | Registration plus T&Cs                |
| Verifone    | PSDK, CAM-XPI, PSDK-SDI                    | RS232, **USB**, Wi-Fi, Ethernet, Bluetooth, WebSocket | Public doc index, detail behind login |
| PAX         | POSLink (`POSLink.dll`)                    | TCP-IP, **USB**, AIDL, serial                         | Registration with an NDA step         |
| Newland     | NPSC SDK Toolkit, NAPI / NSDK              | UNVERIFIED                                            | Partner tier                          |
| Castles     | Not found                                  | UNVERIFIED                                            | No public developer page              |
| Stone       | SDK Android, `BluetoothConnectionProvider` | Bluetooth pinpad                                      | Partnership required                  |
| PagSeguro   | PlugPag                                    | Bluetooth serial, **Linux and Raspberry build**       | Public GitHub                         |
| MercadoPago | None for a third party                     | None                                                  | Cloud API only                        |

- [D] Verifone is the strongest public precedent.
  `https://docs.verifone.com/xpi/xpi-getting-started.md` states: "CAM-XPI lets your host
  application control Verifone PIN pads and payment devices." It publishes the transports:
  "XPI supports RS232, USB, WiFi, Ethernet, Bluetooth, and WebSocket." Defaults: port
  `12345` for IP and WebSocket, `8n1` at `115200` for serial. Framing uses STX, ETX, and
  LRC (rung 1).
- [D] `https://docs.verifone.com/psdk/readme.md` states that the semi-integrated PSDK
  covers "4 merchant platforms (Android, iOS, Windows, Linux)". Linux is a named target
  (rung 1).
- [D] `https://docs.verifone.com/llms.txt` is a public Markdown index of the whole
  documentation set. Any page is readable as Markdown by appending `.md` to the URL
  (rung 1).
- UNVERIFIED. The USB device class and the Bluetooth profile are not stated on any public
  page for any vendor in the table. That detail sits behind each vendor gate. It is the
  single largest gap in the public record.

### C.3 Bluetooth prior art from Linux

- Documented fact. `https://github.com/pagseguro/plugpag` (59 stars, pushed 2026-08-25) is
  public. The legacy 1.x line ships `1.x/linux/1.3.3/x64` and
  `1.x/raspberry/1.3.3/btserial-1.3.3.tar.gz`, plus a C demo whose makefile takes `COM0` as
  the port. This is a vendor C library that drives certified terminals over Bluetooth
  serial from Linux (rung 3).
- Source-backed tradeoff. PlugPag 1.x is the legacy line. The 4.x line is Android only. The
  1.x README ties itself to firmware 3.10.x, so compatibility with a 2026 terminal is
  UNVERIFIED.
- Inference. Outside PlugPag 1.x, Bluetooth prior art is almost entirely Android. GitHub
  searches returned no Linux host project that drives a payment terminal over RFCOMM or BLE.
- Documented fact. PCI PTS POI v6.1 Appendix B extends the interface rules to wireless
  links: "devices implementing open protocols, for example Bluetooth, Wi-Fi and TLS, must
  be validated against the requirements noted in Implements Open Protocols."

### C.4 Is a direct POS-to-PIN-pad link forbidden?

Short answer: no document found forbids the cable. The standards constrain the data and the
device.

- Documented fact. PCI PTS POI v6.1 requirement B23 states: "When operating in encrypting
  mode, there is no mechanism in the device that would allow the outputting of clear-text
  account data except as described in DTR B23."
- Documented fact. Requirement B23.1 states: "When operating in encrypting mode, the secure
  controller can only release clear-text account data to authenticated applications
  executing within the device."
- Documented fact. Requirement B22 requires encipherment under ISO 9564 when the
  PIN-encrypting device and the card reader are not in the same secure module.
- Documented fact. Requirement D2 forbids a device state that "could result in the device
  outputting the clear-text PIN or other sensitive data", from "unexpected command
  sequences, unknown commands, commands in a wrong device mode, and supplying wrong
  parameters or data".
- Documented fact. Requirement D1 requires the device vendor to declare every protocol and
  every interface in an "Open Protocols - Protocol Declaration Form".
- Source: `https://www.pcisecuritystandards.org/documents/PCI_PTS_POI_SRs_v6-1_Final.pdf`
  (HTTP 200, 891,621 bytes, March 2022, rung 7).
- Inference. B23.1 is the constraint that shapes a real integration. "Authenticated
  applications executing within the device" excludes the POS host. So a host link carries
  ciphertext, a transaction reference, and status messages. It does not carry the card
  number.
- Inference. D2 is the formal reason not to fuzz the terminal. An unknown command can drive
  the device into a bad state, and the requirement exists to stop exactly that.
- Inference. A "semi-integrated" design follows from B23.1. Verifone names that model
  explicitly: "The payment device contains a complete payment application which interfaces
  to an external ECR/POS system."
- Documented fact. PCI SSC placed SPoC and CPoC on sunset, ending 2026-10-31. The successor
  is MPoC (PCI Mobile Payments on COTS).
- Documented fact. Four rules follow for Umi. The terminal must stay a PTS-approved POI.
  The host must never receive the PAN or the PIN. The host must not change the PIN-entry
  surface. A Bluetooth link needs a validated open-protocol story from the terminal vendor.

### C.5 Hardware and OEM

| Terminal              | Likely OEM                  | FCC ID                       | What the host may see                              |
| --------------------- | --------------------------- | ---------------------------- | -------------------------------------------------- |
| Point Smart 1         | PAX A910                    | `V5PA910`                    | A PAX vendor id, or a Google id in fastboot mode.  |
| Point Smart 2         | Newland N950                | `2AM6U-NA950`                | A Newland vendor id, or `0x18D1` in fastboot mode. |
| Point Mini, Point Air | Mercado Libre in-house line | `2A5U9-MP1xx`, `2A5U9-MP3xx` | Unknown. No USB mode reported.                     |

- Documented fact. The Point Smart 2 hardware is a Newland N950: Qualcomm QCM2290 SoC, and
  Android 12. The Point Smart 1 hardware is a PAX A910: Spreadtrum SC9832A SoC, and a
  USB-C port ([FCC filings](https://fccid.io/2AM6U-NA950), [FCC filings](https://fccid.io/V5PA910),
  rung 1 and rung 4).
- Documented fact. The on-device interface between a third-party app and the Mercado Pago
  payment services is an Android Content Provider, not an AIDL interface, and not a native
  library. The AAR holds the URIs
  `content://com.mercadopago.android.isp_smart_mediator.provider` and
  `content://com.mercadopago.smartpos.provider.integration`, and the packages
  `com.mercadopago.smartpos` and `com.mercadopago.android.isp_smart_mediator`. Source:
  `nativesdk-7.2.0.aar` in the public repository `mercadopago/point-smartapp-demo-android`
  (rung 3).
- Inference. The vendor id in the `lsusb` output is the fastest way to identify the user's
  model. A PAX id points to the A910. A Newland id points to the N950.
- Inference. The local IPC that exists lives inside the terminal, between an approved
  SmartApp and the Mercado Pago services. It is not reachable from a Linux POS over USB.

Third-party prior art worth reading:

- Documented fact. Odoo documents a Mercado Pago payment terminal integration in its Point
  of Sale payment methods
  ([Odoo 19 payment methods](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/payment_methods.html)).
  The same page lists Adyen, DPO Pay, Ingenico, Mollie, Pine Labs, QFPay, Razorpay, SIX,
  Stripe, Tyro, Viva.com, and Worldline.
- Inference. Odoo's Mercado Pago integration is a cloud integration, in the same shape as
  the Orders API flow. It is evidence that a third-party POS can drive a Point terminal
  through the API. It is not evidence of a local USB protocol.

### C.6 What the search did not find

| Item                                                 | Result                                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| USB HID mode on any Point model                      | Not found.                                                                          |
| USB CDC-ACM serial port on any Point model           | Not found.                                                                          |
| USB RNDIS or CDC-ECM network mode on any Point model | Not found.                                                                          |
| ADB on a production Point unit                       | Not found. One public report says ADB fails.                                        |
| A vendor USB protocol document for any Point model   | Not found.                                                                          |
| A Bluetooth serial protocol document for a Point     | Not found.                                                                          |
| "ECD", "SCO", "OTI", "OPEN-INTERFACE" specifications | Not found. Zero code-search results. The names may be a confusion with ECR and ZVT. |
| "NQuire" as a Newland payment SDK                    | Not found. NQuire is the Newland AIDC kiosk family.                                 |

- Documented fact. `ISO 7816` and `ISO 8583` are behind a paywall and a Cloudflare block
  from this workstation. `ISO 8583` is a network message format, not a USB transport.

## Open questions

1. Which Point model is the physical unit? The answer sets the vendor ID to expect.
2. Which USB mode does the terminal present on plug-in: charging-only, vendor-specific, or
   Android with ADB?
3. Is the Point Smart 1 or 2 USB port a data port at all?
4. Does the Point Smart 1 (PAX A910) expose ADB on a production unit, unlike the N950? Not
   verified.
5. Does Mercado Pago issue development terminals in Mexico? A public attempt in Brazil
   failed.
6. Are the Point SmartApps, which accept Flutter, available to Mexican accounts? Not
   verified.
7. The general Mercado Pago Developers terms of use could not be read, because the page is
   a JavaScript shell with no Wayback snapshot. The reverse-engineering clause is
   UNVERIFIED.
8. Does the team want to install `tshark`, or is the raw `usbmon` text stream enough?
9. Is a spare terminal available, so the live merchant terminal stays untouched?
10. Which question does the business actually need answered: a local integration, or a
    better cloud flow? The USB work pays off only for the first answer.

## Sources

Local, primary:

- Host tool output, 2026-09-16. Commands and results are quoted in Part A and Part B.
- `2026-09-16-mexico-payments-and-fiscal.md`, sections 2.1 and 2.2.
- `/lib/udev/rules.d/70-uaccess.rules`, lines 14 and 89.
- `/lib/udev/rules.d/40-usb_modeswitch.rules`.

External, primary:

- Mercado Pago Point overview: https://www.mercadopago.com.mx/developers/en/docs/mp-point/overview
- Mercado Pago payment processing:
  https://www.mercadopago.com.mx/developers/en/docs/mp-point/payment-processing
- Mercado Pago create order reference:
  https://www.mercadopago.com.mx/developers/en/reference/in-person-payments/point/orders/create-order/post
- Mercado Pago SmartApp restrictions:
  https://www.mercadopago.com.mx/developers/en/docs/smartapps/restrictions.md
- Mercado Pago SmartApps overview:
  https://www.mercadopago.com.mx/developers/en/docs/smartapps/overview.md
- Mercado Pago SmartApp deployment:
  https://www.mercadopago.com.mx/developers/en/docs/smartapps/deployment.md
- Verifone CAM-XPI getting started: https://docs.verifone.com/xpi/xpi-getting-started.md
- Verifone PSDK readme: https://docs.verifone.com/psdk/readme.md
- Verifone documentation index: https://docs.verifone.com/llms.txt
- ZVT specification download page: https://www.terminalhersteller.de/downloads.aspx
- PCI PTS POI security requirements v6.1:
  https://www.pcisecuritystandards.org/documents/PCI_PTS_POI_SRs_v6-1_Final.pdf
- PCI SSC standards index: https://www.pcisecuritystandards.org/standards/
- Odoo 19 Point of Sale payment methods:
  https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/payment_methods.html

Public repositories and filings:

- ZVT in Rust: https://github.com/EVerest/zvt
- ZVT in .NET: https://github.com/Portalum/Portalum.Zvt
- ZVT in Python: https://github.com/mathiasfrey/ecrterm
- PagSeguro PlugPag: https://github.com/pagseguro/plugpag
- Mercado Pago SmartApp demo: https://github.com/mercadopago/point-smartapp-demo-android
- Mercado Pago main-app demo: https://github.com/mercadolibre/point-mainapp-demo-android
- Point Smart 2 ADB report:
  https://github.com/mercadolibre/point-mainapp-demo-android/issues/84
- Newland N950 research: https://github.com/mercurioctrl/obsidian-hermess
- FCC filing, Point Smart 2: https://fccid.io/2AM6U-NA950
- FCC filing, Point Smart 1: https://fccid.io/V5PA910

Companion files:

- `01-official-integration-paths.md`
- `03-prior-art-terminal-integration.md`
- `04-mercadopago-point-integration-surface.md`
