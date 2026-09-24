#!/usr/bin/env python3
"""Repack the published ZCode AppImage so the SHA-256 matches byte for byte.

The published file is an AppImageKit runtime (appimage-12.0.1, 188392 bytes)
followed by a gzip squashfs (mksquashfs 4.3, block size 128KiB, no fragments,
no xattrs, all-root) and an electron-builder blockmap trailer (raw deflate of
the rabin/blake2b-18 chunk map, then a big-endian compressed length).

unsquashfs applies the process umask, so files that were 0666/0777 inside the
image come out as 0644/0755. mksquashfs then writes different inode metadata and
the image shrinks by 38 bytes. Restoring those modes, freezing mkfs time at the
original superblock timestamp, and appending a freshly built blockmap reproduces
the published bytes.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

EXPECTED_SHA256 = "66fabd76d12be24cc3b83060be66e09cad10745edd9f2d17e6d67eeea3de3832"
APPIMAGE_URL = "https://github.com/AgentMystia/A/releases/download/ss/reverseme.AppImage"
TOOLS_URL = (
    "https://github.com/electron-userland/electron-builder-binaries/releases/download/"
    "appimage-12.0.1/appimage-12.0.1.7z"
)
RUNTIME_OFFSET = 188392
MKFS_TIME = "2026-09-20 07:41:58"
PREFIX_LENGTH = 203788264

GO_MOD = """module blockmap

go 1.22

require (
    github.com/aclements/go-rabin v0.0.0-20170911142644-d0b643ea1a4c
    github.com/json-iterator/go v1.1.12
    github.com/minio/blake2b-simd v0.0.0-20160723061019-3f5f724cb5b1
)
"""

GO_MAIN = r"""package main

import (
	"bytes"
	"compress/flate"
	"encoding/base64"
	"encoding/binary"
	"io"
	"os"

	"github.com/aclements/go-rabin/rabin"
	jsoniter "github.com/json-iterator/go"
	"github.com/minio/blake2b-simd"
)

type BlockMap struct {
	Version string         `json:"version"`
	Files   []BlockMapFile `json:"files"`
}

type BlockMapFile struct {
	Name      string   `json:"name"`
	Offset    uint64   `json:"offset"`
	Checksums []string `json:"checksums"`
	Sizes     []int    `json:"sizes"`
}

func main() {
	inFile := os.Args[1]
	f, err := os.Open(inFile)
	if err != nil {
		panic(err)
	}
	defer f.Close()

	chunkHash, err := blake2b.New(&blake2b.Config{Size: 18})
	if err != nil {
		panic(err)
	}
	copyBuffer := new(bytes.Buffer)
	r := io.TeeReader(f, copyBuffer)
	c := rabin.NewChunker(rabin.NewTable(rabin.Poly64, 64), r, 8*1024, 16*1024, 32*1024)
	var checksums []string
	var sizes []int
	for {
		copyLength, err := c.Next()
		if err == io.EOF {
			break
		} else if err != nil {
			panic(err)
		}
		if _, err = io.Copy(chunkHash, io.LimitReader(copyBuffer, int64(copyLength))); err != nil {
			panic(err)
		}
		checksums = append(checksums, base64.StdEncoding.EncodeToString(chunkHash.Sum(nil)))
		sizes = append(sizes, copyLength)
		chunkHash.Reset()
	}
	serialized, err := jsoniter.ConfigFastest.Marshal(&BlockMap{
		Version: "2",
		Files: []BlockMapFile{{
			Name:      "file",
			Offset:    0,
			Checksums: checksums,
			Sizes:     sizes,
		}},
	})
	if err != nil {
		panic(err)
	}
	archiveBuffer := new(bytes.Buffer)
	zw, err := flate.NewWriter(archiveBuffer, flate.BestCompression)
	if err != nil {
		panic(err)
	}
	if _, err = zw.Write(serialized); err != nil {
		panic(err)
	}
	if err = zw.Close(); err != nil {
		panic(err)
	}
	sizeBytes := make([]byte, 4)
	binary.BigEndian.PutUint32(sizeBytes, uint32(archiveBuffer.Len()))
	if err = os.WriteFile(os.Args[2], append(archiveBuffer.Bytes(), sizeBytes...), 0o644); err != nil {
		panic(err)
	}
}
"""


def run(cmd: list[str], **kwargs) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True, **kwargs)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"download {url}", flush=True)
    urllib.request.urlretrieve(url, dest)


def ensure_tools(cache: Path) -> tuple[Path, Path]:
    tools = cache / "appimage-tools"
    mksquashfs = tools / "linux-x64" / "mksquashfs"
    runtime = tools / "runtime-x64"
    if mksquashfs.exists() and runtime.exists():
        return mksquashfs, runtime
    archive = cache / "appimage-12.0.1.7z"
    download(TOOLS_URL, archive)
    tools.mkdir(parents=True, exist_ok=True)
    if shutil.which("7z"):
        run(["7z", "x", "-y", f"-o{tools}", str(archive)])
    else:
        run(["bsdtar", "-xf", str(archive), "-C", str(tools)])
    mksquashfs.chmod(mksquashfs.stat().st_mode | stat.S_IEXEC)
    return mksquashfs, runtime


def mode_from_listing(text: str) -> int:
    bits = 0
    for index, char in enumerate(text):
        if char != "-":
            bits |= 1 << (8 - index)
    return bits


def restore_modes(image: Path, root: Path) -> None:
    listing = subprocess.check_output(
        ["unsquashfs", "-o", str(RUNTIME_OFFSET), "-lln", "-d", str(root), str(image)],
        text=True,
    )
    for line in listing.splitlines():
        if not line or line[0] not in "-d":
            continue
        mode_text, _, _, _, _, path = line.split(maxsplit=5)
        if " -> " in path:
            path = path.split(" -> ", 1)[0]
        target = Path(path)
        if not target.exists():
            continue
        bits = mode_from_listing(mode_text[1:])
        os.chmod(target, bits)


def faketime_env() -> dict[str, str]:
    lib = Path("/usr/lib/x86_64-linux-gnu/faketime/libfaketimeMT.so.1")
    if not lib.exists():
        lib = Path("/usr/lib/faketime/libfaketimeMT.so.1")
    if not lib.exists():
        raise SystemExit("libfaketimeMT is required so mksquashfs sees mkfs time 2026-09-20 07:41:58")
    env = os.environ.copy()
    env["LD_PRELOAD"] = str(lib)
    env["FAKETIME"] = MKFS_TIME
    # File mtimes must stay at the extracted values. Faketime would otherwise rewrite stat().
    env["NO_FAKE_STAT"] = "1"
    return env


def append_blockmap(prefix: Path, trailer: Path, work: Path) -> None:
    go_dir = work / "blockmap"
    go_dir.mkdir(parents=True, exist_ok=True)
    (go_dir / "go.mod").write_text(GO_MOD)
    (go_dir / "main.go").write_text(GO_MAIN)
    run(["go", "mod", "tidy"], cwd=go_dir)
    run(["go", "run", ".", str(prefix), str(trailer)], cwd=go_dir)
    with prefix.open("ab") as handle:
        handle.write(trailer.read_bytes())


def main() -> None:
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    output = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("reverseme.rebuilt.AppImage")
    cache = Path(sys.argv[3]) if len(sys.argv) > 3 else Path(tempfile.gettempdir()) / "reverseme-rebuild"
    cache.mkdir(parents=True, exist_ok=True)
    if source is None:
        source = cache / "reverseme.AppImage"
        download(APPIMAGE_URL, source)

    mksquashfs, runtime = ensure_tools(cache)
    if runtime.stat().st_size != RUNTIME_OFFSET:
        raise SystemExit(f"unexpected runtime length {runtime.stat().st_size}")

    work = cache / "work"
    if work.exists():
        shutil.rmtree(work)
    root = work / "root"
    root.parent.mkdir(parents=True, exist_ok=True)
    run(["unsquashfs", "-o", str(RUNTIME_OFFSET), "-d", str(root), "-f", str(source)])
    restore_modes(source, root)

    packed = work / "packed.AppImage"
    env = faketime_env()
    run(
        [
            str(mksquashfs),
            str(root),
            str(packed),
            "-offset",
            str(RUNTIME_OFFSET),
            "-all-root",
            "-noappend",
            "-no-progress",
            "-quiet",
            "-no-xattrs",
            "-no-fragments",
            "-processors",
            "1",
        ],
        env=env,
    )
    with packed.open("r+b") as handle:
        handle.seek(0)
        handle.write(runtime.read_bytes())
    if packed.stat().st_size != PREFIX_LENGTH:
        raise SystemExit(f"prefix length {packed.stat().st_size}, expected {PREFIX_LENGTH}")

    trailer = work / "trailer.bin"
    append_blockmap(packed, trailer, work)
    digest = sha256(packed)
    output.write_bytes(packed.read_bytes())
    print(f"{digest}  {output}")
    if digest != EXPECTED_SHA256:
        raise SystemExit("SHA-256 does not match the published AppImage")
    print("SHA-256 matches the published AppImage")


if __name__ == "__main__":
    main()
