#!/usr/bin/env python3
"""
Hardware Monitor Widget — Desktop hardware monitoring panel.
Displays real-time CPU, GPU, RAM, Disk, and Network metrics.
Built with psutil + tkinter + ctypes (zero heavy dependencies).

Author: AllanCheung282
Requires: psutil (`pip install psutil`)
"""

# ── Imports ───────────────────────────────────────────────────────────────
import ctypes
import ctypes.wintypes
import json
import os
import subprocess
import sys
import threading
import time
import tkinter as tk
from tkinter import ttk

import psutil

# ── DPI Awareness (before tkinter init) ────────────────────────────────────
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(1)  # PROCESS_SYSTEM_DPI_AWARE
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

# ── Constants ───────────────────────────────────────────────────────────────
APP_NAME = "Hardware Monitor"
UPDATE_INTERVAL_MS = 1000  # 1 second refresh
WINDOW_WIDTH = 338
WINDOW_HEIGHT = 510

# VRAM hardcoded (Windows WMI AdapterRAM bug: reports 4GB for >4GB cards)
GPU_VRAM_TOTAL_MB = 16384  # AMD Radeon RX 9070 GRE

# Color scheme — GitHub Dark inspired
C = {
    "bg_main": "#0d1117",
    "bg_card": "#161b22",
    "bg_card_header": "#1c2129",
    "border": "#30363d",
    "text": "#e6edf3",
    "text_secondary": "#8b949e",
    "text_dim": "#484f58",
    "bar_green": "#3fb950",
    "bar_yellow": "#d2991d",
    "bar_red": "#f85149",
    "bar_bg": "#21262d",
    "accent": "#58a6ff",
    "separator": "#21262d",
}

# Fonts (Chinese Windows: Microsoft YaHei UI; fallback: Segoe UI)
FONT_FAMILY = "Microsoft YaHei UI"
FONT_TITLE = (FONT_FAMILY, 10, "bold")
FONT_LABEL = (FONT_FAMILY, 9)
FONT_VALUE = (FONT_FAMILY, 9, "bold")
FONT_SMALL = (FONT_FAMILY, 8)
FONT_MONO = ("Cascadia Code", 9)


# ── Hardware Data Structures ──────────────────────────────────────────────
class DiskInfo:
    def __init__(self, device, total_gb, used_gb, percent):
        self.device = device
        self.total_gb = total_gb
        self.used_gb = used_gb
        self.percent = percent


class HardwareSnapshot:
    """Immutable snapshot of all hardware metrics at a point in time."""

    def __init__(self):
        self.cpu_name: str = ""
        self.cpu_cores: int = 0
        self.cpu_threads: int = 0
        self.cpu_max_clock_mhz: int = 0
        self.cpu_current_clock_mhz: int = 0
        self.cpu_percent: float = 0.0
        self.cpu_temp_c: float | None = None

        self.gpu_name: str = ""
        self.gpu_driver: str = ""
        self.gpu_vram_used_mb: int = 0
        self.gpu_util_percent: float | None = None
        self.gpu_temp_c: float | None = None
        self.gpu_resolution: str = ""
        self.gpu_refresh_hz: int = 0

        self.ram_total_gb: float = 0.0
        self.ram_used_gb: float = 0.0
        self.ram_percent: float = 0.0

        self.disks: list[DiskInfo] = []
        self.net_name: str = ""
        self.net_sent_kbps: float = 0.0
        self.net_recv_kbps: float = 0.0
        self.net_prev_sent: int = 0
        self.net_prev_recv: int = 0
        self.net_prev_time: float = 0.0


# ── Hardware Data Collector ────────────────────────────────────────────────
class HardwareCollector:
    """Gathers all hardware metrics. Static info (WMI) cached after first collection."""

    def __init__(self):
        self._snapshot = HardwareSnapshot()
        self._lock = threading.Lock()
        self._wmi_cache: dict | None = None
        self._gpu_data: dict | None = None
        self._gpu_fetching = False
        self._gpu_error_logged = False

    # ── Public API ──────────────────────────────────────────────────────
    def collect(self) -> HardwareSnapshot:
        """Collect all metrics. Returns the latest snapshot (may have stale GPU data)."""
        snap = HardwareSnapshot()

        # Fast psutil data (main thread)
        self._collect_cpu_psutil(snap)
        self._collect_ram(snap)
        self._collect_disks(snap)
        self._collect_network(snap)

        # Cached static WMI data
        if self._wmi_cache is None:
            self._wmi_cache = self._fetch_wmi_static()
        wmi = self._wmi_cache
        snap.cpu_name = wmi.get("cpu_name", "")
        snap.cpu_cores = wmi.get("cpu_cores", 0)
        snap.cpu_threads = wmi.get("cpu_threads", 0)
        snap.cpu_max_clock_mhz = wmi.get("cpu_max_clock_mhz", 0)
        snap.gpu_name = wmi.get("gpu_name", "")
        snap.gpu_driver = wmi.get("gpu_driver", "")
        snap.gpu_resolution = wmi.get("gpu_resolution", "")
        snap.gpu_refresh_hz = wmi.get("gpu_refresh_hz", 0)

        # GPU data (from background thread or cached)
        with self._lock:
            if self._gpu_data is not None:
                snap.gpu_util_percent = self._gpu_data.get("util")
                snap.gpu_vram_used_mb = self._gpu_data.get("vram_used_mb", 0)

        # CPU frequency
        snap.cpu_current_clock_mhz = self._get_cpu_freq(snap.cpu_max_clock_mhz)

        return snap

    def start_gpu_fetch(self):
        """Launch background thread to fetch GPU perf counters."""
        if self._gpu_fetching:
            return
        self._gpu_fetching = True
        t = threading.Thread(target=self._fetch_gpu_counters, daemon=True)
        t.start()

    def has_gpu_data(self) -> bool:
        with self._lock:
            return self._gpu_data is not None

    # ── CPU (psutil) ────────────────────────────────────────────────────
    def _collect_cpu_psutil(self, snap: HardwareSnapshot):
        snap.cpu_percent = psutil.cpu_percent(interval=None)

    def _get_cpu_freq(self, max_mhz: int) -> int:
        """Get current CPU frequency. Falls back to perf counter estimation."""
        try:
            freq = psutil.cpu_freq()
            if freq and freq.current > 0:
                return int(freq.current)
        except Exception:
            pass
        # Fallback: use % Processor Performance counter
        try:
            result = subprocess.run(
                [
                    "powershell",
                    "-NoProfile",
                    "-Command",
                    '(Get-Counter "\\Processor Information(_Total)\\% Processor Performance" -ErrorAction Stop).CounterSamples[0].CookedValue',
                ],
                capture_output=True,
                text=True,
                timeout=2,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            pct = float(result.stdout.strip())
            return int(max_mhz * pct / 100)
        except Exception:
            return max_mhz

    # ── RAM ─────────────────────────────────────────────────────────────
    def _collect_ram(self, snap: HardwareSnapshot):
        mem = psutil.virtual_memory()
        snap.ram_total_gb = round(mem.total / (1024**3), 1)
        snap.ram_used_gb = round(mem.used / (1024**3), 1)
        snap.ram_percent = mem.percent

    # ── Disks ───────────────────────────────────────────────────────────
    def _collect_disks(self, snap: HardwareSnapshot):
        drives = ["C:", "D:", "E:"]
        for d in drives:
            try:
                usage = psutil.disk_usage(d)
                snap.disks.append(
                    DiskInfo(
                        device=d,
                        total_gb=round(usage.total / (1024**3), 1),
                        used_gb=round(usage.used / (1024**3), 1),
                        percent=usage.percent,
                    )
                )
            except Exception:
                pass

    # ── Network ─────────────────────────────────────────────────────────
    def _collect_network(self, snap: HardwareSnapshot):
        try:
            net = psutil.net_io_counters()
            now = time.time()
            if snap.net_prev_time > 0:
                elapsed = now - snap.net_prev_time
                if elapsed > 0:
                    snap.net_sent_kbps = round(
                        (net.bytes_sent - snap.net_prev_sent) / elapsed / 1024, 1
                    )
                    snap.net_recv_kbps = round(
                        (net.bytes_recv - snap.net_prev_recv) / elapsed / 1024, 1
                    )
            snap.net_prev_sent = net.bytes_sent
            snap.net_prev_recv = net.bytes_recv
            snap.net_prev_time = now
        except Exception:
            pass

        try:
            addrs = psutil.net_if_addrs()
            stats = psutil.net_if_stats()
            # Pick the active Ethernet adapter with most traffic
            for name, stat in stats.items():
                if stat.isup and "Realtek" in name or "Ethernet" in name or "以太网" in name:
                    if stat.speed > 0:
                        snap.net_name = name
                        break
            if not snap.net_name:
                for name, stat in stats.items():
                    if stat.isup and stat.speed > 0 and "Loopback" not in name:
                        snap.net_name = name
                        break
        except Exception:
            snap.net_name = "Unknown"

    # ── WMI Static Info (cached) ────────────────────────────────────────
    def _fetch_wmi_static(self) -> dict:
        """One-time fetch of static hardware info via PowerShell + WMI."""
        wmi = {}
        try:
            # CPU info
            script = """
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
Write-Host "CPU_NAME:$($cpu.Name.Trim())"
Write-Host "CPU_CORES:$($cpu.NumberOfCores)"
Write-Host "CPU_THREADS:$($cpu.NumberOfLogicalProcessors)"
Write-Host "CPU_MAX_MHZ:$($cpu.MaxClockSpeed)"
"""
            result = self._run_ps(script)
            for line in result.strip().splitlines():
                line = line.strip()
                if line.startswith("CPU_NAME:"):
                    wmi["cpu_name"] = line[9:]
                elif line.startswith("CPU_CORES:"):
                    wmi["cpu_cores"] = int(line[10:])
                elif line.startswith("CPU_THREADS:"):
                    wmi["cpu_threads"] = int(line[12:])
                elif line.startswith("CPU_MAX_MHZ:"):
                    wmi["cpu_max_clock_mhz"] = int(line[12:])

            # GPU info
            script2 = """
$gpu = Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch 'Microsoft' } | Select-Object -First 1
Write-Host "GPU_NAME:$($gpu.Name.Trim())"
Write-Host "GPU_DRIVER:$($gpu.DriverVersion)"
Write-Host "GPU_RES:$($gpu.CurrentHorizontalResolution)x$($gpu.CurrentVerticalResolution)"
Write-Host "GPU_HZ:$($gpu.CurrentRefreshRate)"
"""
            result2 = self._run_ps(script2)
            for line in result2.strip().splitlines():
                line = line.strip()
                if line.startswith("GPU_NAME:"):
                    wmi["gpu_name"] = line[9:]
                elif line.startswith("GPU_DRIVER:"):
                    wmi["gpu_driver"] = line[11:]
                elif line.startswith("GPU_RES:"):
                    wmi["gpu_resolution"] = line[8:]
                elif line.startswith("GPU_HZ:"):
                    try:
                        wmi["gpu_refresh_hz"] = int(float(line[8:]))
                    except Exception:
                        wmi["gpu_refresh_hz"] = 0
        except Exception:
            pass
        return wmi

    # ── GPU Performance Counters (slow, runs in background thread) ──────
    def _fetch_gpu_counters(self):
        """Fetch GPU utilization and VRAM usage via PowerShell perf counters."""
        util = None
        vram_used_mb = 0
        try:
            # GPU 3D utilization
            util_script = """
$samples = Get-Counter "\\GPU Engine(*)\\Utilization Percentage" -ErrorAction Stop | Select-Object -ExpandProperty CounterSamples | Where-Object { $_.Path -like "*engtype_3d*" }
if ($samples) {
    $sum = ($samples | Measure-Object -Property CookedValue -Sum).Sum
    Write-Host $sum
} else {
    Write-Host "0"
}
"""
            result = self._run_ps(util_script)
            util = min(float(result.strip()), 100.0)

            # GPU VRAM usage
            vram_script = """
$samples = Get-Counter "\\GPU Adapter Memory(*)\\Dedicated Usage" -ErrorAction Stop | Select-Object -ExpandProperty CounterSamples | Where-Object { $_.CookedValue -gt 0 }
if ($samples) {
    $bytes = ($samples | Select-Object -First 1).CookedValue
    Write-Host ([math]::Round($bytes / 1MB))
} else {
    Write-Host "0"
}
"""
            result2 = self._run_ps(vram_script)
            vram_used_mb = int(result2.strip())
        except Exception as e:
            if not self._gpu_error_logged:
                self._gpu_error_logged = True

        with self._lock:
            self._gpu_data = {
                "util": util,
                "vram_used_mb": vram_used_mb,
            }
        self._gpu_fetching = False

    def _run_ps(self, script: str) -> str:
        """Run a PowerShell script and return stdout."""
        try:
            result = subprocess.run(
                ["powershell", "-NoProfile", "-Command", script],
                capture_output=True,
                text=True,
                timeout=5,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            return result.stdout
        except Exception:
            return ""


# ── UI: Progress Bar Widget ──────────────────────────────────────────────
class BarWidget(tk.Canvas):
    """A rounded progress bar with color thresholds."""

    def __init__(self, parent, height=14, **kwargs):
        super().__init__(
            parent, height=height, bg=C["bg_card"], highlightthickness=0, **kwargs
        )
        self._height = height
        self._value = 0

    def set(self, value: float):
        """Set bar fill percentage (0-100)."""
        self._value = max(0, min(100, value))
        self._draw()

    def _draw(self):
        self.delete("all")
        w = self.winfo_width()
        h = self._height
        r = h // 2

        if w < 20:
            return

        # Background track
        self._create_rounded_rect(0, 0, w, h, r, fill=C["bar_bg"])

        # Filled portion
        fill_w = max(r * 2, int(w * self._value / 100))
        color = C["bar_green"]
        if self._value >= 85:
            color = C["bar_red"]
        elif self._value >= 60:
            color = C["bar_yellow"]

        self._create_rounded_rect(0, 0, fill_w, h, r, fill=color)

    def _create_rounded_rect(self, x1, y1, x2, y2, r, **kwargs):
        """Draw a rounded rectangle on the canvas."""
        points = [
            x1 + r, y1,
            x2 - r, y1,
            x2, y1,
            x2, y1 + r,
            x2, y2 - r,
            x2, y2,
            x2 - r, y2,
            x1 + r, y2,
            x1, y2,
            x1, y2 - r,
            x1, y1 + r,
            x1, y1,
        ]
        self.create_polygon(points, smooth=True, **kwargs)


# ── Main Application Window ───────────────────────────────────────────────
class MainWindow:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title(APP_NAME)
        self.root.geometry(f"{WINDOW_WIDTH}x{WINDOW_HEIGHT}")
        self.root.configure(bg=C["bg_main"])
        self.root.resizable(True, True)
        self.root.minsize(300, 400)

        # Always on top + semi-transparent
        self.root.attributes("-topmost", True)
        self.root.attributes("-alpha", 0.90)

        # Window close → minimize to tray
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

        self.collector = HardwareCollector()
        self._tray = None
        self._update_id = None

        self._build_ui()
        self._start_update_loop()

    # ── Build UI ─────────────────────────────────────────────────────────
    def _build_ui(self):
        # Main scrollable frame
        main_frame = tk.Frame(self.root, bg=C["bg_main"])
        main_frame.pack(fill=tk.BOTH, expand=True, padx=8, pady=(6, 2))

        # Title bar
        title_frame = tk.Frame(main_frame, bg=C["bg_main"])
        title_frame.pack(fill=tk.X, pady=(0, 5))

        tk.Label(
            title_frame,
            text="🖥  Hardware Monitor",
            font=(FONT_FAMILY, 11, "bold"),
            fg=C["text"],
            bg=C["bg_main"],
        ).pack(side=tk.LEFT)

        self._refresh_label = tk.Label(
            title_frame,
            text="1s ↻",
            font=FONT_SMALL,
            fg=C["text_dim"],
            bg=C["bg_main"],
        )
        self._refresh_label.pack(side=tk.RIGHT)

        # ── CPU Card ──
        self._cpu_frame = self._create_card(main_frame, "CPU")
        self._cpu_name_label = tk.Label(
            self._cpu_frame, text="Detecting...", font=FONT_SMALL, fg=C["text_secondary"], bg=C["bg_card"], anchor="w"
        )
        self._cpu_name_label.pack(fill=tk.X, pady=(0, 2))
        self._cpu_bar = BarWidget(self._cpu_frame, height=14)
        self._cpu_bar.pack(fill=tk.X, pady=(0, 2))
        self._cpu_pct_label = tk.Label(
            self._cpu_frame, text="0%", font=FONT_VALUE, fg=C["text"], bg=C["bg_card"], anchor="e"
        )
        self._cpu_pct_label.pack(fill=tk.X)

        # ── GPU Card ──
        self._gpu_frame = self._create_card(main_frame, "GPU")
        self._gpu_name_label = tk.Label(
            self._gpu_frame, text="Detecting...", font=FONT_SMALL, fg=C["text_secondary"], bg=C["bg_card"], anchor="w"
        )
        self._gpu_name_label.pack(fill=tk.X, pady=(0, 2))
        self._gpu_bar = BarWidget(self._gpu_frame, height=14)
        self._gpu_bar.pack(fill=tk.X, pady=(0, 2))
        self._gpu_detail_label = tk.Label(
            self._gpu_frame, text="", font=FONT_SMALL, fg=C["text_secondary"], bg=C["bg_card"], anchor="w"
        )
        self._gpu_detail_label.pack(fill=tk.X)

        # ── RAM Card ──
        self._ram_frame = self._create_card(main_frame, "RAM")
        self._ram_bar = BarWidget(self._ram_frame, height=14)
        self._ram_bar.pack(fill=tk.X, pady=(0, 4))
        self._ram_detail_label = tk.Label(
            self._ram_frame, text="", font=FONT_SMALL, fg=C["text_secondary"], bg=C["bg_card"], anchor="w"
        )
        self._ram_detail_label.pack(fill=tk.X)

        # ── Disk Card ──
        self._disk_frame = self._create_card(main_frame, "DISKS")
        self._disk_bars: dict[str, tuple[tk.Label, BarWidget]] = {}

        # ── Network Card ──
        self._net_frame = self._create_card(main_frame, "NETWORK")
        self._net_name_label = tk.Label(
            self._net_frame, text="", font=FONT_SMALL, fg=C["text_secondary"], bg=C["bg_card"], anchor="w"
        )
        self._net_name_label.pack(fill=tk.X, pady=(0, 2))
        self._net_speed_label = tk.Label(
            self._net_frame, text="", font=FONT_VALUE, fg=C["text"], bg=C["bg_card"], anchor="w"
        )
        self._net_speed_label.pack(fill=tk.X)

        # ── Status bar (temperatures) ──
        status_frame = tk.Frame(main_frame, bg=C["bg_main"])
        status_frame.pack(fill=tk.X, pady=(4, 0))

        self._temp_label = tk.Label(
            status_frame,
            text="CPU: --°C  |  GPU: --°C",
            font=FONT_SMALL,
            fg=C["text_dim"],
            bg=C["bg_main"],
            anchor="w",
        )
        self._temp_label.pack(side=tk.LEFT)
        self._temp_label.bind("<Enter>", lambda e: self._show_temp_hint())
        self._temp_label.bind("<Leave>", lambda e: self._hide_temp_hint())

        self._hint_label = tk.Label(
            status_frame,
            text="",
            font=(FONT_FAMILY, 7),
            fg=C["text_dim"],
            bg=C["bg_main"],
            anchor="w",
        )
        self._hint_label.pack(side=tk.LEFT, padx=(8, 0))

    def _create_card(self, parent: tk.Frame, title: str) -> tk.Frame:
        """Create a bordered card with a title."""
        card = tk.Frame(parent, bg=C["bg_card"], highlightbackground=C["border"], highlightthickness=1)
        card.pack(fill=tk.X, pady=3)

        header = tk.Frame(card, bg=C["bg_card_header"])
        header.pack(fill=tk.X)
        tk.Label(
            header, text=f"  {title}", font=FONT_TITLE, fg=C["accent"], bg=C["bg_card_header"], anchor="w"
        ).pack(fill=tk.X, ipady=1)

        inner = tk.Frame(card, bg=C["bg_card"])
        inner.pack(fill=tk.X, padx=8, pady=(2, 6))
        return inner

    # ── Update Loop ──────────────────────────────────────────────────────
    def _start_update_loop(self):
        """Kick off the first collection and schedule updates."""
        # Do initial collection
        self._do_update()
        # Start GPU fetch in background
        self.collector.start_gpu_fetch()
        # Schedule periodic updates
        self._schedule_next()

    def _schedule_next(self):
        self._update_id = self.root.after(UPDATE_INTERVAL_MS, self._on_tick)

    def _on_tick(self):
        self._do_update()
        self.collector.start_gpu_fetch()
        self._schedule_next()

    def _do_update(self):
        """Collect data and refresh UI (called on main thread)."""
        try:
            snap = self.collector.collect()
            self._update_cpu(snap)
            self._update_gpu(snap)
            self._update_ram(snap)
            self._update_disks(snap)
            self._update_network(snap)
            self._update_status(snap)
        except Exception:
            pass

    # ── UI Update Methods ────────────────────────────────────────────────
    def _update_cpu(self, snap: HardwareSnapshot):
        label = f"{snap.cpu_name}  {snap.cpu_cores}C/{snap.cpu_threads}T  {snap.cpu_current_clock_mhz}MHz"
        self._cpu_name_label.config(text=label)
        self._cpu_bar.set(snap.cpu_percent)
        self._cpu_pct_label.config(text=f"{snap.cpu_percent:.0f}%")

    def _update_gpu(self, snap: HardwareSnapshot):
        # Short GPU name
        gpu_short = snap.gpu_name
        if "AMD Radeon" in gpu_short:
            gpu_short = gpu_short.replace("AMD Radeon", "").strip()
            if gpu_short.startswith("(TM) "):
                gpu_short = gpu_short[5:]

        driver_short = ""
        if snap.gpu_driver:
            parts = snap.gpu_driver.split(".")
            if len(parts) >= 4:
                driver_short = f"Driver {parts[0]}.{parts[1]}.{parts[2]}"

        label = f"{gpu_short}  {GPU_VRAM_TOTAL_MB // 1024}GB  {driver_short}"
        self._gpu_name_label.config(text=label)

        util = snap.gpu_util_percent
        if util is not None:
            self._gpu_bar.set(util)
        else:
            self._gpu_bar.set(0)

        vram_pct = (snap.gpu_vram_used_mb / GPU_VRAM_TOTAL_MB) * 100 if GPU_VRAM_TOTAL_MB else 0
        detail = f"VRAM: {snap.gpu_vram_used_mb / 1024:.1f} GB / {GPU_VRAM_TOTAL_MB / 1024:.0f} GB    {vram_pct:.0f}%"
        if util is not None:
            detail = f"GPU: {util:.0f}%    {detail}"
        else:
            detail = f"GPU: N/A    {detail}"
        self._gpu_detail_label.config(text=detail)

    def _update_ram(self, snap: HardwareSnapshot):
        self._ram_bar.set(snap.ram_percent)
        self._ram_detail_label.config(
            text=f"{snap.ram_used_gb:.1f} GB / {snap.ram_total_gb:.0f} GB    {snap.ram_percent:.0f}%"
        )

    def _update_disks(self, snap: HardwareSnapshot):
        # Remove disk rows for drives that disappeared
        for device in list(self._disk_bars.keys()):
            if not any(d.device == device for d in snap.disks):
                self._disk_bars[device][0].destroy()
                self._disk_bars[device][1].destroy()
                del self._disk_bars[device]

        for disk in snap.disks:
            if disk.device not in self._disk_bars:
                lbl = tk.Label(
                    self._disk_frame, text="", font=FONT_SMALL, fg=C["text"], bg=C["bg_card"], anchor="w"
                )
                lbl.pack(fill=tk.X, pady=(2, 0))
                bar = BarWidget(self._disk_frame, height=10)
                bar.pack(fill=tk.X, pady=(0, 1))
                self._disk_bars[disk.device] = (lbl, bar)
            lbl, bar = self._disk_bars[disk.device]
            lbl.config(
                text=f"{disk.device}  {disk.used_gb:.0f} / {disk.total_gb:.0f} GB"
            )
            bar.set(disk.percent)

    def _update_network(self, snap: HardwareSnapshot):
        self._net_name_label.config(text=snap.net_name or "Network")
        # Format speeds
        def fmt(kbps):
            if kbps < 1:
                return "0 KB/s"
            if kbps < 1024:
                return f"{kbps:.0f} KB/s"
            mbps = kbps / 1024
            if mbps < 1024:
                return f"{mbps:.1f} MB/s"
            return f"{mbps / 1024:.1f} GB/s"

        self._net_speed_label.config(
            text=f"↓ {fmt(snap.net_recv_kbps)}    ↑ {fmt(snap.net_sent_kbps)}"
        )

    def _update_status(self, snap: HardwareSnapshot):
        cpu_temp = f"{snap.cpu_temp_c:.0f}°C" if snap.cpu_temp_c is not None else "--°C"
        gpu_temp = f"{snap.gpu_temp_c:.0f}°C" if snap.gpu_temp_c is not None else "--°C"
        self._temp_label.config(text=f"CPU: {cpu_temp}  |  GPU: {gpu_temp}")

    # ── Temperature tooltip ──────────────────────────────────────────────
    def _show_temp_hint(self):
        self._hint_label.config(
            text="💡 Install LibreHardwareMonitor for live temps"
        )

    def _hide_temp_hint(self):
        self._hint_label.config(text="")

    # ── Window close → minimize to tray ──────────────────────────────────
    def _on_close(self):
        if self._tray and self._tray.is_visible():
            self.root.withdraw()
        else:
            self._quit()

    def set_tray(self, tray):
        self._tray = tray

    def _quit(self):
        if self._update_id:
            self.root.after_cancel(self._update_id)
        if self._tray:
            self._tray.remove()
        self.root.destroy()


# ── System Tray (ctypes Shell_NotifyIconW, zero dependencies) ─────────────
class SystemTray:
    """Windows system tray icon via ctypes."""

    WM_TASKBARCREATED = ctypes.wintypes.UINT(0)
    WM_USER_SHELLICON = 0x404  # Custom window message for tray icon
    NIM_ADD = 0
    NIM_DELETE = 2
    NIF_MESSAGE = 1
    NIF_ICON = 2
    NIF_TIP = 4
    NIF_INFO = 0x10
    NIIF_INFO = 1

    def __init__(self, root: tk.Tk, window: MainWindow):
        self.root = root
        self.window = window
        self._visible = True
        self._hwnd = None
        self._menu = None
        self._icon_handle = None

        # Get the tkinter window HWND
        self._hwnd = ctypes.windll.user32.GetParent(root.winfo_id())

        # Register for taskbar restart notification
        try:
            self.WM_TASKBARCREATED = ctypes.windll.user32.RegisterWindowMessageW("TaskbarCreated")
        except Exception:
            self.WM_TASKBARCREATED = 0

        # Hook into tkinter's event system for custom messages
        root.createcommand("tray_callback", self._on_tray_callback)
        # Poll for tray messages
        self._add_icon()
        self._poll_tray()

    def _add_icon(self):
        """Add tray icon via Shell_NotifyIconW."""
        # Load a default icon (use shell32.dll icon as fallback)
        if not self._icon_handle:
            self._icon_handle = ctypes.windll.user32.LoadIconW(0, 0x7F00)  # IDI_APPLICATION

        # Build NOTIFYICONDATAW struct
        class GUID(ctypes.Structure):
            _fields_ = [
                ("Data1", ctypes.c_ulong),
                ("Data2", ctypes.c_ushort),
                ("Data3", ctypes.c_ushort),
                ("Data4", ctypes.c_ubyte * 8),
            ]

        class NOTIFYICONDATAW(ctypes.Structure):
            _fields_ = [
                ("cbSize", ctypes.c_uint),
                ("hWnd", ctypes.c_void_p),
                ("uID", ctypes.c_uint),
                ("uFlags", ctypes.c_uint),
                ("uCallbackMessage", ctypes.c_uint),
                ("hIcon", ctypes.c_void_p),
                ("szTip", ctypes.c_wchar * 128),
                ("dwState", ctypes.c_uint),
                ("dwStateMask", ctypes.c_uint),
                ("szInfo", ctypes.c_wchar * 256),
                ("uVersion", ctypes.c_uint),
                ("szInfoTitle", ctypes.c_wchar * 64),
                ("dwInfoFlags", ctypes.c_uint),
                ("guidItem", GUID),
                ("hBalloonIcon", ctypes.c_void_p),
            ]

        nid = NOTIFYICONDATAW()
        nid.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
        nid.hWnd = self._hwnd
        nid.uID = 1
        nid.uFlags = self.NIF_MESSAGE | self.NIF_ICON | self.NIF_TIP
        nid.uCallbackMessage = self.WM_USER_SHELLICON
        nid.hIcon = self._icon_handle
        nid.szTip = APP_NAME

        ctypes.windll.shell32.Shell_NotifyIconW(self.NIM_ADD, ctypes.byref(nid))

    def _poll_tray(self):
        """Poll for Windows messages to the tray icon."""
        try:
            msg = ctypes.wintypes.MSG()
            while ctypes.windll.user32.PeekMessageW(
                ctypes.byref(msg), self._hwnd, self.WM_USER_SHELLICON, self.WM_USER_SHELLICON, 1
            ):
                if msg.message == self.WM_USER_SHELLICON:
                    if msg.lParam == 0x0205:  # WM_RBUTTONUP
                        self._show_menu()
                    elif msg.lParam == 0x0203:  # WM_LBUTTONDBLCLK
                        self._toggle_window()
                ctypes.windll.user32.DispatchMessageW(ctypes.byref(msg))
        except Exception:
            pass
        self.root.after(200, self._poll_tray)

    def _show_menu(self):
        """Show right-click context menu at cursor position."""
        if self._menu:
            self._menu.destroy()
        self._menu = tk.Menu(self.root, tearoff=0, bg=C["bg_card"], fg=C["text"], font=FONT_LABEL)
        state = "隐藏窗口" if self.window.root.state() != "withdrawn" else "显示窗口"
        self._menu.add_command(label=state, command=self._toggle_window)
        self._menu.add_separator()
        self._menu.add_command(label="退出", command=self.window._quit)
        try:
            self._menu.tk_popup(self.root.winfo_pointerx(), self.root.winfo_pointery())
        except Exception:
            pass
        finally:
            self._menu.grab_release()

    def _toggle_window(self):
        if self.window.root.state() == "withdrawn":
            self.window.root.deiconify()
            self.window.root.lift()
        else:
            self.window.root.withdraw()

    def _on_tray_callback(self):
        """Placeholder for tkinter command callback."""
        pass

    def is_visible(self) -> bool:
        return self._visible and self._icon_handle is not None

    def remove(self):
        """Remove tray icon."""
        if self._icon_handle:
            class NOTIFYICONDATAW(ctypes.Structure):
                _fields_ = [
                    ("cbSize", ctypes.c_uint),
                    ("hWnd", ctypes.c_void_p),
                    ("uID", ctypes.c_uint),
                ]
            nid = NOTIFYICONDATAW()
            nid.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
            nid.hWnd = self._hwnd
            nid.uID = 1
            ctypes.windll.shell32.Shell_NotifyIconW(self.NIM_DELETE, ctypes.byref(nid))
            self._icon_handle = None
        self._visible = False


# ── Entry Point ───────────────────────────────────────────────────────────
def main():
    root = tk.Tk()
    app = MainWindow(root)
    tray = SystemTray(root, app)
    app.set_tray(tray)
    root.mainloop()


if __name__ == "__main__":
    main()
