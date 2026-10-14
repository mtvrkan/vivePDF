import { rpc, type RpcCallOptions } from "./client";

export type OfficeStatusResult = {
  installed: boolean;
  source: "managed" | "system" | null;
  path: string | null;
  directory: string;
  sizeBytes: number;
  supported: boolean;
  bundled: boolean;
  isolation: "landlock" | "none" | null;
};

export const officeStatus = (options?: RpcCallOptions) => rpc<OfficeStatusResult>("system.office_status", {}, options);
export const officeInstall = (options?: RpcCallOptions) => rpc<OfficeStatusResult>("system.office_install", {}, options);
export const officeRemove = (options?: RpcCallOptions) => rpc<OfficeStatusResult>("system.office_remove", {}, options);
