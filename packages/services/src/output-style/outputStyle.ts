import { ServiceChannels, type OutputStyleConfig, type OutputStyleInfo } from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface IOutputStyleService {
  listStyles(): Promise<{ styles: OutputStyleInfo[] }>;
  addStyle(request: { config: OutputStyleConfig }): Promise<void>;
  updateStyle(request: { id: string; config: OutputStyleConfig }): Promise<void>;
  deleteStyle(request: { id: string }): Promise<void>;
  getUserStylesDirectory(): Promise<{ path: string }>;
  setActiveStyle(request: { styleId: string | null }): Promise<void>;
  getActiveStyle(): Promise<{ styleId: string | null }>;
}

export const IOutputStyleService = createServiceDescriptor<IOutputStyleService>(
  ServiceChannels.OutputStyle,
);
