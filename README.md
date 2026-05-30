# test

Personal project workspace — built with Claude Code.

## 🖥️ Hardware Monitor

Real-time desktop hardware monitoring widget.

```powershell
.\venv\Scripts\Activate.ps1
pip install psutil
python hardware_monitor.py
```

**Features:**
- CPU / GPU / RAM / Disk / Network monitoring
- Dark theme, always-on-top, minimizes to system tray
- GPU utilization via Windows performance counters (AMD supported)

## 🛠️ Environment

| Tool | Version |
|------|---------|
| Windows | 11 Pro for Workstations |
| Python | 3.13.13 |
| Node.js | v24.16.0 |
| Git | 2.54.0 |

## 📂 Structure

```
test/
├── hardware_monitor.py   ← Desktop hardware monitor
├── venv/                 ← Python virtual environment
├── CLAUDE.md             ← Claude Code context file
├── .claude/              ← Claude Code settings
├── claude/               ← Reserved
└── README.md
```

## 👤 Author

[AllanCheung282](https://github.com/AllanCheung282)
