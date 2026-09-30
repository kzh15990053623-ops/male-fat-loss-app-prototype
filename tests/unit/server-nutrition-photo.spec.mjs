import { describe, expect, it } from "vitest";
import { nutritionContext, validateNutritionPhoto } from "../../server/nutrition-photo.mjs";

const jpeg = (width = 1280, height = 960) =>
  Buffer.from([255, 216, 255, 192, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 17, 0, 255, 217]);
const data = (bytes) => `data:image/jpeg;base64,${bytes.toString("base64")}`;
describe("bounded photo and context input", () => {
  it("accepts bounded JPEG dimensions and optional input", () => {
    const photo = data(jpeg());
    expect(validateNutritionPhoto(photo)).toBe(photo);
    for (const empty of [undefined, null, ""]) expect(validateNutritionPhoto(empty)).toBeNull();
  });
  it.each([
    false,
    {},
    "https://example.com/image.jpg",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/jpeg;base64,AQ==",
    data(jpeg(1281)),
    data(jpeg(0)),
    data(Buffer.alloc(524289)),
    data(Buffer.from([255, 216, 255, 217])),
    data(Buffer.from([255, 216, 12, 0, 0, 0])),
    "data:image/jpeg;base64,////=",
  ])("rejects malformed, remote and oversized image: %#", (value) => {
    expect(() => validateNutritionPhoto(value)).toThrow(expect.objectContaining({ code: "AI_INVALID_IMAGE" }));
  });
  it("whitelists bounded context and preserves unknown quantities instead of inventing zero oil", () => {
    expect(nutritionContext({ amount: 4000, oilGrams: 0, unit: "x".repeat(500), password: "secret", cooking: "炒", sauce: "少" })).toEqual({
      amount: 2000,
      oilGrams: null,
      unit: "x".repeat(20),
      cooking: "炒",
      sauce: "少",
    });
    expect(nutritionContext({ amount: -1, oilGrams: "invalid" })).toEqual({ amount: null, oilGrams: null });
    for (const value of [null, [], "test"]) expect(nutritionContext(value)).toEqual({});
  });
});
