import hashlib
import io
import stat
import struct
import unittest
from unittest.mock import patch
import zipfile

from PIL import Image, PngImagePlugin, features

import asset_import as assets


def image_bytes(image=None, fmt="PNG", **kwargs):
    image = image or Image.new("RGBA", (4, 4), (11, 42, 90, 78))
    buffer = io.BytesIO()
    image.save(buffer, format=fmt, **kwargs)
    return buffer.getvalue()


def archive_bytes(entries, compression=zipfile.ZIP_STORED):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=compression) as archive:
        for name, body in entries:
            archive.writestr(name, body)
    return buffer.getvalue()


def font_bytes(signature):
    return signature + struct.pack(">HHHH4sIII", 1, 0, 0, 0, b"name", 0, 28, 4) + b"data"


class AssetImportTests(unittest.TestCase):
    def test_exact_and_normalized_distinct_encodings(self):
        tags = PngImagePlugin.PngInfo()
        tags.add_text("Comment", "not retained")
        first, second = image_bytes(), image_bytes(pnginfo=tags)
        a, b, same = assets.parse_inputs([("a.png", first), ("b.png", second), ("copy.png", first)])
        self.assertEqual(a["file_hash"], hashlib.sha256(first).hexdigest())
        self.assertNotEqual(a["file_hash"], b["file_hash"])
        self.assertEqual(a["file_hash"], same["file_hash"])
        self.assertEqual(a["pixel_hash"], b["pixel_hash"])
        self.assertEqual(a["data"], b["data"])
        self.assertEqual((a["width"], a["height"], a["kind"], a["mime"]), (4, 4, "image", "image/png"))
        with Image.open(io.BytesIO(b["data"])) as canonical:
            self.assertEqual(canonical.mode, "RGBA")
            self.assertEqual(canonical.getpixel((0, 0)), (11, 42, 90, 78))
            self.assertEqual(canonical.info, {})

    def test_full_canvas_dimensions_and_hidden_rgba_are_not_merged(self):
        a = Image.new("RGBA", (1, 2), (11, 42, 90, 0))
        b = Image.new("RGBA", (2, 1), (11, 42, 90, 0))
        c = Image.new("RGBA", (1, 2), (11, 42, 91, 0))
        d = Image.new("RGBA", (1, 3), (11, 42, 90, 0))
        rows = assets.parse_inputs([(f"{i}.png", image_bytes(x)) for i, x in enumerate((a, b, c, d))])
        self.assertEqual(len({x["pixel_hash"] for x in rows}), 4)

    def test_jpeg_and_webp_are_canonical_png(self):
        rgb = Image.new("RGB", (3, 2), (0, 5, 21))
        files = [("PHOTO.JPG", image_bytes(rgb, "JPEG"))]
        if features.check("webp"):
            files.append(("photo.webp", image_bytes(rgb, "WEBP", lossless=True)))
        for row in assets.parse_inputs(files):
            self.assertEqual((row["mime"], row["width"], row["height"]), ("image/png", 3, 2))
            self.assertTrue(row["data"].startswith(b"\x89PNG\r\n\x1a\n"))

    def test_jpeg_exif_orientation_normalized(self):
        rgb = Image.new("RGB", (3, 2), (42, 22, 17))
        exif = rgb.getexif()
        exif[274] = 6
        row, = assets.parse_inputs([("photo.jpg", image_bytes(rgb, "JPEG", exif=exif))])
        self.assertEqual((row["width"], row["height"]), (2, 3))

    def test_valid_fonts_raw_and_corrupt_fonts_rejected(self):
        for suffix, signature, mime in [("ttf", b"\x00\x01\x00\x00", "font/ttf"), ("otf", b"OTTO", "font/otf")]:
            raw = font_bytes(signature)
            row, = assets.parse_inputs([(f"valid.{suffix}", raw)])
            self.assertEqual((row["kind"], row["mime"], row["width"], row["height"]), ("font", mime, 0, 0))
            self.assertEqual(row["data"], raw)
            self.assertEqual(row["file_hash"], row["pixel_hash"])
            with self.assertRaises(ValueError):
                assets.parse_inputs([(f"short.{suffix}", raw[:-1])])

    def test_zip_nested_directories_metadata_and_order(self):
        image = image_bytes()
        zip_data = archive_bytes([("slides/", b""), ("__MACOSX/._image.png", b"ignore"),
                                  ("slides/.DS_Store", b"ignore"), ("slides/插画.png", image),
                                  ("slides/fonts/first.otf", font_bytes(b"OTTO"))])
        rows = assets.parse_inputs([("sample.zip", zip_data), ("direct.png", image)])
        self.assertEqual([r["name"] for r in rows], ["插画.png", "first.otf", "direct.png"])
        self.assertEqual(rows[0]["file_hash"], rows[2]["file_hash"])

    def test_reject_unsafe_zip_paths_special_files_and_payloads(self):
        for path in ("../x.png", "/x.png", "x/../y.png", "x\\y.png", "C:/x.png", "x.exe", "x.zip", "x.svg"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                assets.parse_inputs([("input.zip", archive_bytes([(path, b"any")]))])
        symlink = zipfile.ZipInfo("link.png")
        symlink.create_system = 3
        symlink.external_attr = (stat.S_IFLNK | 0o777) << 16
        with self.assertRaises(ValueError):
            assets.parse_inputs([("input.zip", archive_bytes([(symlink, b"elsewhere")]))])

    def test_upload_expansion_and_ratio_limits(self):
        p = image_bytes()
        with patch.object(assets, "MAX_UPLOAD_BYTES", len(p) + 1), self.assertRaises(ValueError):
            assets.parse_inputs([("a.png", p), ("b.png", p)])
        z = archive_bytes([("a.png", p), ("b.png", p)])
        with patch.object(assets, "MAX_ZIP_BYTES", len(p) + 1), self.assertRaises(ValueError):
            assets.parse_inputs([("input.zip", z)])
        z = archive_bytes([("ratio.png", b"0" * 100_000)], zipfile.ZIP_DEFLATED)
        with self.assertRaisesRegex(ValueError, "压缩比"):
            assets.parse_inputs([("input.zip", z)])

    def test_corrupt_mismatched_multiframe_and_overlarge_images(self):
        p = image_bytes()
        for name, body in (("mismatch.jpg", p), ("corrupt.png", p[:32]), ("bad.zip", b"not a zip")):
            with self.subTest(name=name), self.assertRaises(ValueError):
                assets.parse_inputs([(name, body)])
        a = Image.new("RGBA", (2, 2), "red")
        b = Image.new("RGBA", (2, 2), "blue")
        with self.assertRaisesRegex(ValueError, "多帧"):
            assets.parse_inputs([("anim.png", image_bytes(a, save_all=True, append_images=[b]))])
        with patch.object(assets, "MAX_IMAGE_PIXELS", 2), self.assertRaisesRegex(ValueError, "尺寸"):
            assets.parse_inputs([("valid.png", p)])


if __name__ == "__main__":
    unittest.main()
