"""Decode supported imports locally. No archive extraction or filesystem writes."""
from __future__ import annotations

import hashlib
import io
from pathlib import PurePosixPath
import stat
import struct
import warnings
import zipfile
import zlib
from collections.abc import Sequence

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_UPLOAD_BYTES = 32 * 1024 * 1024
MAX_ZIP_BYTES = 64 * 1024 * 1024
MAX_ENTRY_BYTES = 16 * 1024 * 1024
MAX_RESULT_BYTES = 64 * 1024 * 1024
MAX_FILES = 256
MAX_ZIP_RATIO = 200
MAX_IMAGE_SIDE = 8192
MAX_IMAGE_PIXELS = 16_000_000

IMAGE_FORMATS = {".png": "PNG", ".jpg": "JPEG", ".jpeg": "JPEG", ".webp": "WEBP"}
FONT_FORMATS = {".ttf": (b"\x00\x01\x00\x00", "font/ttf"), ".otf": (b"OTTO", "font/otf")}


def _safe_name(name: str, *, directory: bool = False) -> tuple[str, ...]:
    if not isinstance(name, str) or not name or len(name) > 768 or "\\" in name or ":" in name:
        raise ValueError("文件名或 ZIP 路径不安全")
    if any(ord(c) < 32 or ord(c) == 127 for c in name):
        raise ValueError("文件名含控制字符")
    parts = name.removesuffix("/").split("/") if directory else name.split("/")
    if any(not part or part in (".", "..") or part.endswith((".", " ")) or len(part) > 255 for part in parts):
        raise ValueError("文件名或 ZIP 路径不安全")
    return tuple(parts)


def _is_mac_metadata(parts: tuple[str, ...]) -> bool:
    return "__MACOSX" in parts or any(part == ".DS_Store" or part.startswith("._") for part in parts)


def _zip_entries(data: bytes):
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_FILES:
                raise ValueError("ZIP 内文件或目录过多")
            total = 0
            for entry in entries:
                # orig_filename retains NULs that zipfile may strip from filename.
                parts = _safe_name(entry.orig_filename, directory=entry.is_dir())
                file_type = stat.S_IFMT(entry.external_attr >> 16) if entry.create_system == 3 else 0
                if file_type not in (0, stat.S_IFREG, stat.S_IFDIR) or (
                    file_type and (file_type == stat.S_IFDIR) != entry.is_dir()
                ):
                    raise ValueError("ZIP 不支持符号链接或特殊文件")
                if entry.flag_bits & 1:
                    raise ValueError("不支持加密 ZIP")
                if entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                    raise ValueError("ZIP 仅支持普通存储和 Deflate 压缩")
                if entry.file_size > MAX_ENTRY_BYTES or (
                    entry.file_size > MAX_ZIP_RATIO * max(1, entry.compress_size)
                ):
                    raise ValueError("ZIP 内存在超大文件或异常压缩比")
                total += entry.file_size
                if total > MAX_ZIP_BYTES:
                    raise ValueError("ZIP 解压后的总大小超限")
                if entry.is_dir() or _is_mac_metadata(parts):
                    continue
                name = parts[-1]
                if PurePosixPath(name).suffix.lower() not in IMAGE_FORMATS.keys() | FONT_FORMATS.keys():
                    raise ValueError(f"ZIP 含不支持的文件类型：{name}")
                with archive.open(entry) as file:
                    payload = file.read(MAX_ENTRY_BYTES + 1)
                if len(payload) != entry.file_size or len(payload) > MAX_ENTRY_BYTES:
                    raise ValueError("ZIP 文件的实际大小与目录不符")
                yield name, payload
    except (zipfile.BadZipFile, OSError, RuntimeError, NotImplementedError, EOFError, zlib.error) as error:
        raise ValueError("无法读取 ZIP 文件") from error


def _font_is_valid(data: bytes, signature: bytes) -> bool:
    if len(data) < 28 or not data.startswith(signature):
        return False
    table_count = int.from_bytes(data[4:6], "big")
    first_data = 12 + 16 * table_count
    if not 0 < table_count <= 256 or first_data > len(data):
        return False
    seen = set()
    for i in range(12, first_data, 16):
        tag, _, offset, length = struct.unpack_from(">4sIII", data, i)
        if tag in seen or offset < first_data or offset + length > len(data):
            return False
        seen.add(tag)
    return True


def _decode(name: str, data: bytes) -> dict:
    suffix = PurePosixPath(name).suffix.lower()
    file_hash = hashlib.sha256(data).hexdigest()
    common = {"name": name, "file_hash": file_hash}
    if suffix in FONT_FORMATS:
        signature, mime = FONT_FORMATS[suffix]
        if not _font_is_valid(data, signature):
            raise ValueError(f"字体头或表目录无效：{name}")
        return {**common, "mime": mime, "data": data, "width": 0, "height": 0,
                "pixel_hash": file_hash, "kind": "font"}
    if suffix not in IMAGE_FORMATS:
        raise ValueError(f"不支持的文件类型：{name}")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data), formats=[IMAGE_FORMATS[suffix]]) as original:
                width, height = original.size
                if max(width, height) > MAX_IMAGE_SIDE or width * height > MAX_IMAGE_PIXELS:
                    raise ValueError(f"图片尺寸超限：{name}")
                if getattr(original, "n_frames", 1) != 1:
                    raise ValueError(f"不支持多帧图片：{name}")
                original.verify()
            with Image.open(io.BytesIO(data), formats=[IMAGE_FORMATS[suffix]]) as original:
                original.load()
                # The normalized identity reflects displayed orientation, then full RGBA,
                # including the untrimmed canvas and hidden RGB under transparent pixels.
                rgba = ImageOps.exif_transpose(original).convert("RGBA")
                rgba.info.clear()
                width, height = rgba.size
                digest = hashlib.sha256(struct.pack(">II", width, height))
                digest.update(rgba.tobytes())
                png = io.BytesIO()
                rgba.save(png, format="PNG")
    except (UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning,
            OSError, SyntaxError, OverflowError, EOFError) as error:
        raise ValueError(f"图片格式不符或内容损坏：{name}") from error
    return {**common, "mime": "image/png", "data": png.getvalue(), "width": width, "height": height,
            "pixel_hash": digest.hexdigest(), "kind": "image"}


def parse_inputs(files: Sequence[tuple[str, bytes]]) -> list[dict]:
    """Return canonical records in input/archive order; never merges records."""
    if len(files) > MAX_FILES:
        raise ValueError("上传的文件过多")
    total = 0
    for _, data in files:
        if not isinstance(data, bytes):
            raise ValueError("上传内容必须为字节")
        total += len(data)
        if total > MAX_UPLOAD_BYTES:
            raise ValueError("上传总大小超限")

    result = []
    expanded = stored = 0
    for filename, data in files:
        parts = _safe_name(filename)
        if _is_mac_metadata(parts):
            continue
        name = parts[-1]
        members = _zip_entries(data) if PurePosixPath(name).suffix.lower() == ".zip" else ((name, data),)
        for leaf, payload in members:
            if len(result) >= MAX_FILES:
                raise ValueError("导入的有效文件过多")
            expanded += len(payload)
            if len(payload) > MAX_ENTRY_BYTES or expanded > MAX_ZIP_BYTES:
                raise ValueError("导入文件大小超限")
            record = _decode(leaf, payload)
            stored += len(record["data"])
            if stored > MAX_RESULT_BYTES:
                raise ValueError("转换后的素材总大小超限")
            result.append(record)
    return result
