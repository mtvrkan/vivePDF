export type TsField = { optional: boolean; nested: TsShape | null };
export type TsShape = { fields: Record<string, TsField> };
export type TsContract = { method: string; location: string; params: TsShape | null; result: TsShape | null };
export type OperationSchema = { params: Record<string, unknown>; result: Record<string, unknown> | null };

export function collectTsContracts(): TsContract[];
export function loadPythonSchemas(): Record<string, OperationSchema>;
export function compareContracts(contracts: TsContract[], schemas: Record<string, OperationSchema>): string[];
