declare module "sharp" {
  interface SharpPipeline {
    metadata(): Promise<{ width?: number; height?: number }>;
    composite(images: Array<{ input: Buffer; blend: "over" | "dest-in" }>): {
      png(): { toBuffer(): Promise<Buffer> };
    };
  }

  function sharp(input: Buffer): SharpPipeline;
  export default sharp;
}
