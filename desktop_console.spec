# -*- mode: python ; coding: utf-8 -*-
# 信息平台桌面管理端 V1.11 打包配置
# 打包命令（不要用默认 dist 路径，会触发 safe-delete 拦截）：
#   pyinstaller --noconfirm --distpath dist-desktop --workpath build-desktop desktop_app.spec
# 产物：dist-desktop/信息平台.exe（单文件，拷到任何 Win10/11 双击即用）

a = Analysis(
    ['desktop_app.py'],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=['clr', 'System.Windows.Forms', 'System.Drawing'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='InfoPlatform',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    icon='icon.ico',
)
