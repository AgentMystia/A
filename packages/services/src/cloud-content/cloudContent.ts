import {
  ServiceChannels,
  type CloudContentBundle,
  type CloudContentPrepareResult,
  type MarketingAssetRef,
} from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface ICloudContentService {
  readPublishedMedia(request: { asset: MarketingAssetRef; kind: "image" | "video" }): Promise<string>;
  prepare(request: { bundle: CloudContentBundle }): Promise<CloudContentPrepareResult>;
  release(request: { leaseId: string }): Promise<void>;
  disposeAllAndWait(): Promise<void>;
}

export const ICloudContentService = createServiceDescriptor<ICloudContentService>(
  ServiceChannels.CloudContent,
);
