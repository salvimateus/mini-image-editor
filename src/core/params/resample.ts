/** Algorithm constants of the resample feature. */
export const RESAMPLE_PARAMS = {
  /** Lobes of the Lanczos kernel of the 'sharp' method; the kernel radius in source px at scale 1. */
  lanczosLobes: 3,
  /** Mitchell-Netravali B and C of the 'smooth' method; 1/3 and 1/3 is the balance of blur and ringing that the paper recommends. */
  mitchellB: 1 / 3,
  mitchellC: 1 / 3,
  /** Radius of the Mitchell-Netravali kernel, in source px at scale 1. */
  mitchellRadius: 2,
  /** Number of progress events for one resize. */
  progressSteps: 32,
} as const;
