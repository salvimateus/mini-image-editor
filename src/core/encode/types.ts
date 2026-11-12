export interface EncodedFile {
  /** The file to save, or null when `optimize` is off and only the plain size was asked. */
  bytes: Uint8Array | null;
  /** The size of the same image with no optimization, for the "sem otimizar" number. */
  plainSize: number;
}
