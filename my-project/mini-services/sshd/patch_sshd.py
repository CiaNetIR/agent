#!/usr/bin/env python3
"""Binary-patch OpenSSH 10.0 (Debian) sshd binaries so they run fully
userspace (no root): redirect hard-coded /usr/lib/openssh/* and /run/sshd
paths to short z-owned paths. Replacements are null-padded to the original
string length, so .rodata layout is untouched.
"""
import shutil
import sys

BIN_DIR = "/home/z/.opt/openssh/usr"
SHORT = "/home/z/s/"

# (file, [(orig, new), ...])
TARGETS = [
    (f"{BIN_DIR}/sbin/sshd", [
        (b"/usr/lib/openssh/sshd-session\x00", b"/home/z/s/sshd-session\x00"),
        (b"/usr/lib/openssh/sshd-auth\x00",     b"/home/z/s/sshd-auth\x00"),
        (b"/usr/lib/openssh/ssh-sk-helper\x00", b"/home/z/s/ssh-sk-helper\x00"),
        (b"/run/sshd\x00",                      b"/tmp/sshd\x00"),
    ]),
    (f"{BIN_DIR}/lib/openssh/sshd-session", [
        (b"/usr/lib/openssh/sshd-session\x00", b"/home/z/s/sshd-session\x00"),
        (b"/usr/lib/openssh/sshd-auth\x00",     b"/home/z/s/sshd-auth\x00"),
        (b"/usr/lib/openssh/ssh-sk-helper\x00", b"/home/z/s/ssh-sk-helper\x00"),
        (b"/run/sshd\x00",                      b"/tmp/sshd\x00"),
    ]),
    (f"{BIN_DIR}/lib/openssh/sshd-auth", [
        (b"/usr/lib/openssh/sshd-session\x00", b"/home/z/s/sshd-session\x00"),
        (b"/usr/lib/openssh/sshd-auth\x00",     b"/home/z/s/sshd-auth\x00"),
        (b"/usr/lib/openssh/ssh-sk-helper\x00", b"/home/z/s/ssh-sk-helper\x00"),
    ]),
]

ok = True
for path, subs in TARGETS:
    with open(path, "rb") as f:
        data = f.read()
    orig_len = len(data)
    for orig, new in subs:
        if len(new) > len(orig):
            print(f"FATAL: replacement longer than original: {new!r}")
            ok = False
            continue
        padded = new + b"\x00" * (len(orig) - len(new))
        count = data.count(orig)
        if count == 0:
            print(f"WARN  {path}: pattern not found: {orig!r}")
            continue
        data = data.replace(orig, padded)
        print(f"OK    {path.split('/')[-1]}: {orig.decode():45s} x{count} -> {new.decode()}")
    shutil.copy2(path, path + ".orig")
    with open(path, "wb") as f:
        f.write(data)
    assert len(data) == orig_len, "size changed!"
    print(f"SAVED {path} (backup: .orig)")

sys.exit(0 if ok else 1)
