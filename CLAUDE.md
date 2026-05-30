# CLAUDE.md

> This file provides context to Claude Code about the user, their environment, and working preferences.
> Last updated: 2026-05-30

---

## 👤 User Profile

- **Name**: AllanCheung282
- **GitHub**: [AllanCheung282](https://github.com/AllanCheung282)
- **Email**: horron.cheung@gmail.com
- **Language**: Chinese (zh-CN) — communicate in Chinese; code in English
- **Level**: Beginner in AI-assisted development, experienced PC user and gamer

## 🖥️ Hardware & System

| Component | Spec |
|-----------|------|
| CPU | AMD Ryzen 7 9700X (Zen 5, 8C/8T) |
| GPU | AMD Radeon RX 9070 GRE (16 GB) |
| RAM | 32 GB DDR5 |
| Motherboard | Gigabyte B650M AORUS ELITE AX |
| OS | Windows 11 Pro for Workstations (zh-CN) |
| Shell | PowerShell 5.1 |
| Disk | 300 GB NVMe SSD (C:), ~196 GB free |

## 🛠️ Development Environment

- **Primary IDE**: Trae CN (Beijing Yinli Catapult Technology)
- **AI Assistant**: Claude Code (Anthropic) — installed as Trae extension
- **Terminal**: PowerShell 5.1 (NOT PowerShell Core 7+)
- **Node.js**: v24.16.0
- **npm**: v11.13.0
- **Git**: v2.54.0 (SSH key configured for GitHub)
- **GitHub CLI**: v2.93.0
- **Python**: 3.13.13 (Microsoft Store, venv at `venv/`)
- **Package Manager**: npm (no pnpm/yarn yet)

## 📁 Project Structure

```
~/Documents/trae_projects/
├── test/          ← Current project (this repo)
│   ├── .claude/   ← Claude Code settings & memory
│   └── claude/    ← (empty, reserved)
└── claude/        ← (empty, reserved)
```

## 🎮 Key Installed Software

- **Gaming**: CS2, Apex Legends, The Last of Us Part II, Battlefield 6, Forza Horizon 5
- **Game Tools**: 雷神加速器 (Leishen Game Accelerator), FLiNG Trainer, AntiCheatExpert
- **Office**: WPS Office (Chinese Office Suite)
- **Cloud**: 夸克网盘 (Quark Cloud), WPSDrive
- **Communication**: KOOK (voice chat), Tencent QQ
- **Security**: 火绒安全 (Huorong Security)
- **Utilities**: Everything (voidtools), Bandizip, PotPlayer

## ⚙️ PowerShell Constraints (IMPORTANT)

This is Windows PowerShell 5.1 — NOT PowerShell Core:

- ❌ No `&&` / `||` chain operators → use `; if ($?) { ... }`
- ❌ No ternary (`?:`), null-coalescing (`??`), null-conditional (`?.`)
- ❌ File encoding defaults to UTF-16 LE → use `-Encoding UTF8` explicitly
- ❌ `ConvertFrom-Json` returns PSCustomObject, not hashtable
- ❌ No `-AsHashtable` flag
- ❌ `2>&1` on native exe wraps stderr in ErrorRecord → do not redirect stderr
- ❌ `New-Item -Force` on files TRUNCATES → use `Test-Path` check first
- ✅ Use `$env:VAR` for env vars, `$null` for null checks
- ✅ Use `@'...'@` (single-quoted) here-strings for literal content

## 🎯 Current Goals

1. ✅ Install Git + configure GitHub SSH
2. ✅ Create CLAUDE.md (this file)
3. ✅ Organize Documents folder (deleted MAXON/Cinebench, created 学习/)
4. ✅ Build hardware monitor widget (`hardware_monitor.py`)
5. ⬜ Set up a web project (React/Next.js or Node.js CLI)
6. ✅ Install Python for scripting/automation

## 🖥️ Projects

### `hardware_monitor.py` — Desktop Hardware Monitor
- Real-time CPU, GPU, RAM, disk, network monitoring
- Dark theme, always-on-top, minimizes to system tray
- `psutil` + PowerShell perf counters for GPU data
- Run: `python hardware_monitor.py`

## 📝 Working Conventions

- **Commit style**: Emoji-prefixed commits (`🎉`, `📝`, `✨`, `🐛`, etc.)
- **Branch**: `main` (default)
- **Code style**: To be established — follow existing patterns in any scaffolded project
- **Documentation**: Chinese for explanations; English for code identifiers
- **Testing**: Not yet set up — add when first project starts

## 🚫 Don't Do These

- Don't suggest Mac/Linux-only tools without Windows alternatives
- Don't use `bash` syntax — use PowerShell syntax
- Don't install global npm packages without asking
- Don't modify game files, trainer files, or anything in game-related folders
- Don't touch `Tencent Files/`, `KOOK/`, `HiSuite/` — these are app-managed data

## 🟢 Preferred Approaches

- Use `winget` for Windows package installation
- Use `gh` CLI for GitHub operations (already authenticated)
- Ask before deleting or moving files
- Provide Chinese explanations with English code
- Suggest, don't dictate — present options when multiple approaches exist
