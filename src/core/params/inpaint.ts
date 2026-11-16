/** Algorithm constants of the inpaint feature: the content-aware fill and the spot healing brush (PatchMatch). */
export const INPAINT_PARAMS = {
  /** Patch radius in px at each pyramid level; the patch side is 2 * radius + 1. */
  patchRadius: 3,
  /** A pixel with at least this coverage (0..255) is a hole pixel; a lower coverage keeps its pixel as a source. */
  holeMinCoverage: 8,
  /** Coverage fraction (0..1) at and above which the fill replaces the pixel fully; below it the fill fades out. */
  blendFullCoverage: 0.5,
  /** The source area around a hole is this many times the larger hole side, on each side. */
  contextRatio: 1.5,
  /** Smallest source margin around a hole, in image px. */
  minContextPx: 48,
  /** Largest source area in px. The context margin shrinks to it; a larger crop (a huge hole) works at a reduced scale. */
  maxContextPixels: 20_000_000,
  /** Largest level in px that gets the full search. The finer levels only refine the match field up to full resolution. */
  maxWorkPixels: 6_000_000,
  /** The coarsest level is the one where the hole inradius is about this many px. */
  coarseHoleRadiusPx: 16,
  /** The short side of a reduced level never goes below this, in px. */
  minLevelPx: 64,
  /** EM iterations at the coarsest and at the finest level; the levels between interpolate. */
  iterations: { coarse: 10, fine: 3 },
  /** EM iterations of each level finer than `maxWorkPixels`: propagation and vote only. */
  refineIterations: 2,
  /**
   * The two texture channels (local |dL/dx| and |dL/dy|, see `computeTexture`): the finest pyramid level that compares
   * them (or the work level, when coarser), the window radius in px of that level, the gain from mean luma gradient to
   * the 0..255 channel, and the weight of each channel in the patch distance against one color channel.
   */
  texture: { level: 4, radius: 2, gain: 4, weight: 2 },
  /** Weight of a known pixel against a hole pixel in the patch distance, so a patch at the hole edge agrees with it. */
  knownWeight: 4,
  /** Patch radius of the coarsest fill, in px of that level. */
  fillPatchRadius: 3,
  /** Random sources that each patch of the coarsest fill tries, when the search is not exhaustive. */
  fillSamples: 64,
  /** Random sources near each patch that the coarsest fill also tries, when the search is not exhaustive. */
  fillLocalSamples: 64,
  /** Range of those near sources on each axis, in px of the coarsest level. */
  fillLocalPx: 48,
  /** The coarsest fill tries every source when (sources * fill steps) is at most this. */
  fillExhaustiveBudget: 20_000_000,
  /** Floor of the data term of the coarsest fill order, so flat areas fill in confidence order. */
  fillDataFloor: 0.001,
  /** Each random search step multiplies the search radius by this. */
  searchShrink: 0.5,
  /** Largest random search radius on the levels finer than the coarsest, around the current match, in px. */
  fineSearchPx: 24,
  /** A level with more target patches than this does only propagation and vote, with no random search. */
  searchMaxTargets: 500_000,
  /**
   * Vote weight is exp(-d / (2 * sigma2)), with sigma2 = mean patch distance * this factor. It runs from `fine` at full
   * resolution to `coarse` at level `levels` and above: a sharp vote keeps the structure of a large hole coherent, a
   * soft one blends gradients and keeps a thin hole (few levels) free of stray patches.
   */
  voteSigma: { coarse: 0.1, fine: 1, levels: 4 },
  /**
   * Border color correction after the fill (see `matchBorder`): the cell side in px of its grid (0 turns it off), the
   * largest error per channel of one border pixel, and the relaxation sweeps and factor of the membrane.
   */
  seam: { cellPx: 8, clamp: 48, iterations: 200, relax: 1.8 },
  /** The sigma factor of the last vote of the finest level; smaller keeps more texture. */
  finalSigma: 0.5,
  /** Seed of the random generator, so the same input always gives the same result. */
  seed: 0x1a7c4,
} as const;
