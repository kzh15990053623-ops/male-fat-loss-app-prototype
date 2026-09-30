const MAX_IMAGE_BYTES = 512 * 1024;

export function validateNutritionPhoto(value) {
  if (value === undefined || value === null || value === "") return null;
  const fail = () => {
    throw Object.assign(new Error("照片格式或大小无效，请重新选择照片（压缩后 JPEG、最长边 1280 像素、512 KB 以内）"), {
      status: 400,
      code: "AI_INVALID_IMAGE",
      retryable: false,
    });
  };
  if (typeof value !== "string" || value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 23) fail();
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) fail();
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.length < 4 || bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64") !== match[1] || bytes.readUInt16BE(0) !== 0xffd8)
    fail();
  // Inspect SOF dimensions before forwarding; do not fetch arbitrary image URLs.
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 0xff) fail();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (offset + 2 > bytes.length) fail();
    const size = bytes.readUInt16BE(offset);
    if (size < 2 || offset + size > bytes.length) fail();
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (size < 8) fail();
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      if (!width || !height || width > 1280 || height > 1280) fail();
      return value;
    }
    offset += size;
  }
  fail();
}

export function nutritionContext(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = {};
  for (const key of ["amount", "oilGrams"]) {
    if (source[key] !== undefined) {
      const number = Number(source[key]);
      result[key] = Number.isFinite(number) && number > 0 ? Math.min(number, key === "amount" ? 2000 : 80) : null;
    }
  }
  for (const key of ["unit", "cooking", "sauce"]) {
    if (source[key] !== undefined) result[key] = String(source[key]).slice(0, 20);
  }
  return result;
}
