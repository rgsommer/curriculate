// Minimal client-side EXIF reader — pulls the "date taken" (DateTimeOriginal) out
// of a JPEG so we can flag scavenger/challenge photos that predate a contest start.
// No dependency. Best-effort: returns null when there's no EXIF (PNG, screenshots,
// stripped uploads), which the caller treats as "unverifiable", not "fake".

// EXIF stores dates as "YYYY:MM:DD HH:MM:SS" (local time, no zone). We parse it as a
// local timestamp — good enough for a "before the start date?" comparison.
function parseExifDate(s: string): number | null {
  const m = s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  const t = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(se)
  ).getTime();
  return Number.isFinite(t) ? t : null;
}

export async function readExifTakenAt(file: File): Promise<number | null> {
  try {
    // EXIF lives near the top of the file; 256 KB is plenty.
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const view = new DataView(buf);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null; // not JPEG

    let offset = 2;
    while (offset + 4 < view.byteLength) {
      if (view.getUint16(offset) !== 0xffe1) {
        // Not APP1 — skip this marker segment using its length.
        if (view.getUint8(offset) !== 0xff) return null;
        const size = view.getUint16(offset + 2);
        if (size < 2) return null;
        offset += 2 + size;
        continue;
      }
      // APP1: expect "Exif" then a TIFF header.
      const app1Start = offset + 4;
      if (view.getUint32(app1Start) !== 0x45786966) return null; // "Exif"
      const tiff = app1Start + 6;
      const little = view.getUint16(tiff) === 0x4949; // II = little-endian
      const u16 = (o: number) => view.getUint16(o, little);
      const u32 = (o: number) => view.getUint32(o, little);

      const ifd0 = tiff + u32(tiff + 4);
      const findInIfd = (ifd: number, tag: number): number | null => {
        const n = u16(ifd);
        for (let i = 0; i < n; i++) {
          const entry = ifd + 2 + i * 12;
          if (u16(entry) === tag) return entry;
        }
        return null;
      };
      const readAscii = (entry: number): string | null => {
        const count = u32(entry + 4);
        const valOff = count <= 4 ? entry + 8 : tiff + u32(entry + 8);
        let s = "";
        for (let i = 0; i < count - 1; i++) {
          const c = view.getUint8(valOff + i);
          if (c === 0) break;
          s += String.fromCharCode(c);
        }
        return s || null;
      };

      // ExifIFD pointer (0x8769) → DateTimeOriginal (0x9003); fall back to IFD0 DateTime (0x0132).
      const exifPtr = findInIfd(ifd0, 0x8769);
      if (exifPtr) {
        const exifIfd = tiff + u32(exifPtr + 8);
        const dto = findInIfd(exifIfd, 0x9003) || findInIfd(exifIfd, 0x9004);
        if (dto) {
          const s = readAscii(dto);
          if (s) return parseExifDate(s);
        }
      }
      const dt = findInIfd(ifd0, 0x0132);
      if (dt) {
        const s = readAscii(dt);
        if (s) return parseExifDate(s);
      }
      return null;
    }
    return null;
  } catch {
    return null;
  }
}
