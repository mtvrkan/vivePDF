import { rpc, type RpcCallOptions } from "./client";
import type { PasswordBreachParams, PasswordBreachResult } from "@/types";

export const checkPasswordBreach = (params: PasswordBreachParams, options?: RpcCallOptions) =>
  rpc<PasswordBreachResult>("security.password_breach", params, options);
