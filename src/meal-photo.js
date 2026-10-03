// Re-encode in the browser: the server receives a bounded JPEG without EXIF/GPS.
// Original photos and data URLs live only in memory, never in app persistence.
export async function compressMealPhoto(file) {
  if (!file || !/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type)) {
    throw new Error("请选择 JPEG、PNG 或 WebP 照片；HEIC 需要浏览器支持。");
  }
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error("请选择 20 MB 以内的照片。");
  const url = URL.createObjectURL(file);
  const picture = new Image();
  let timer;
  try {
    picture.src = url;
    await Promise.race([
      picture.decode(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("照片读取超时，请换一张照片。")), 15000);
      }),
    ]);
    if (!picture.naturalWidth || !picture.naturalHeight || picture.naturalWidth * picture.naturalHeight > 50_000_000) {
      throw new Error("照片分辨率过大，请裁剪后重试。");
    }
    const scale = Math.min(1, 1280 / Math.max(picture.naturalWidth, picture.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法处理照片，请使用文字记录。");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(picture, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.65, 0.45, 0.3]) {
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (dataUrl.startsWith("data:image/jpeg;base64,") && (dataUrl.length - 23) * 0.75 <= 512 * 1024) {
        return { dataUrl, width: canvas.width, height: canvas.height };
      }
    }
    throw new Error("压缩后照片仍过大，请裁剪餐盘区域后重试。");
  } catch (error) {
    if (error.name === "EncodingError") throw new Error("无法读取这张照片，请转换为 JPEG 或重新拍照。", { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
    picture.src = "";
    URL.revokeObjectURL(url);
  }
}
