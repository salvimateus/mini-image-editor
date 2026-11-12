/** Algorithm constants of the export feature: the encoder settings and the limits of the slow work. */
export const EXPORT_PARAMS = {
  /** oxipng effort, 0..6; 2 is the balance of time and size that the oxipng CLI uses by default. */
  oxipngLevel: 2,
  /** WebP lossless effort (libwebp method 0..6, quality 0..100) of the plain file: the fastest. */
  webpPlain: { method: 0, quality: 0 },
  /** The optimized file: the strongest effort up to `webpStrongestMaxPixels`. It costs about 10 s for each megapixel. */
  webpOptimized: { method: 6, quality: 100 },
  webpStrongestMaxPixels: 150_000,
  /** Above that area: libwebp lossless preset 7, about 1% larger and 15 times faster than the strongest. */
  webpOptimizedLarge: { method: 4, quality: 90 },
  /** From this JPEG quality up, the chroma keeps full resolution (4:4:4); below it, 4:2:0. */
  jpegFullChromaFrom: 90,
  /** The plain JPEG size re-codes the coefficients in memory; above this area it is the size of the MozJPEG baseline file. */
  jpegPlainSizeMaxPixels: 25_000_000,
  /** ICO entry sides that the format permits. */
  icoMinSide: 16,
  icoMaxSide: 256,
  /** The entries of an exported ICO file: the sizes that Windows reads for files, taskbar and tabs. */
  icoSizes: [16, 24, 32, 48, 64, 128, 256],
  /** Above this area the live estimate encodes only the plain file, and reports its size as both numbers. */
  estimateFullMaxPixels: 4_000_000,
} as const;
