#!/usr/bin/env python3
"""Assemble un .app macOS (KostoLabs AI Cockpit) à partir d'une distribution
Electron officielle, SANS extraire les symlinks sur le disque : les entrées du
zip source sont recopiées telles quelles (symlinks et permissions préservés),
seuls le renommage, le Info.plist, l'icône et le code applicatif changent.

Usage : python3 buildmac.py <electron-darwin.zip> <icns> <projet_src> <out.zip>
"""
import sys, os, stat, zipfile, plistlib

APP_NAME = "KostoLabs AI Cockpit"
BUNDLE_ID = "ai.kostolabs.cockpit"
APP_VERSION = "0.4.4"


def build(src_zip, icns_path, project_dir, out_zip):
    src_prefix = "Electron.app/"
    dst_prefix = APP_NAME + ".app/"
    zsrc = zipfile.ZipFile(src_zip)
    zout = zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=6)

    added_dirs = set()

    def add_bytes(name, data, mode=0o100644):
        parent = os.path.dirname(name)
        while parent and parent not in added_dirs and parent + "/" != name:
            if parent:
                di = zipfile.ZipInfo(parent + "/")
                di.external_attr = (0o40755 << 16) | 0x10
                zout.writestr(di, b"")
                added_dirs.add(parent)
            parent = os.path.dirname(parent)
        zi = zipfile.ZipInfo(name)
        zi.external_attr = (mode << 16)
        zout.writestr(zi, data)

    skip = (
        "Electron.app/Contents/Resources/default_app.asar",
        "Electron.app/Contents/Resources/electron.icns",
    )

    for info in zsrc.infolist():
        if info.filename in skip:
            continue
        if info.filename == "Electron.app/Contents/Info.plist":
            plist = plistlib.loads(zsrc.read(info.filename))
            plist["CFBundleName"] = APP_NAME
            plist["CFBundleDisplayName"] = APP_NAME
            plist["CFBundleIdentifier"] = BUNDLE_ID
            plist["CFBundleVersion"] = APP_VERSION
            plist["CFBundleShortVersionString"] = APP_VERSION
            plist["CFBundleIconFile"] = "AppIcon"
            data = plistlib.dumps(plist, fmt=plistlib.FMT_XML)
            add_bytes(dst_prefix + "Contents/Info.plist", data)
            added_dirs.add(dst_prefix.rstrip("/"))
            continue
        name = dst_prefix + info.filename[len(src_prefix):] \
            if info.filename.startswith(src_prefix) else info.filename
        zi = zipfile.ZipInfo(name, date_time=info.date_time)
        zi.external_attr = info.external_attr
        if info.compress_type == zipfile.ZIP_STORED and not (info.external_attr >> 16) & 0o111:
            zout.writestr(zi, zsrc.read(info.filename), compress_type=zipfile.ZIP_STORED)
        else:
            zout.writestr(zi, zsrc.read(info.filename))
        if name.endswith("/"):
            added_dirs.add(name.rstrip("/"))

    # code applicatif dans Contents/Resources/app/
    res_app = dst_prefix + "Contents/Resources/app/"
    for root, dirs, files in os.walk(project_dir):
        dirs[:] = [d for d in dirs if d not in ("__pycache__", "node_modules", ".git")]
        for f in files:
            full = os.path.join(root, f)
            rel = os.path.relpath(full, project_dir)
            arc = res_app + rel.replace(os.sep, "/")
            if rel == "package.json":
                import json
                pkg = json.load(open(full))
                pkg["version"] = APP_VERSION
                add_bytes(arc, json.dumps(pkg, indent=2, ensure_ascii=False).encode())
            else:
                add_bytes(arc, open(full, "rb").read())

    # icône
    with open(icns_path, "rb") as fh:
        add_bytes(dst_prefix + "Contents/Resources/AppIcon.icns", fh.read())

    zout.close()
    zsrc.close()
    print("OK:", out_zip, os.path.getsize(out_zip), "octets")


if __name__ == "__main__":
    build(*sys.argv[1:5])
