export const YOUNG_BLOB_MS = 500;
export const REVOKE_GRACE_MS = 3000;

type UrlApi = Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;

export function installBlobUrlGuard(api: UrlApi = URL, now: () => number = () => performance.now()): () => void {
  const create = api.createObjectURL.bind(api);
  const revoke = api.revokeObjectURL.bind(api);
  const born = new Map<string, number>();

  api.createObjectURL = (object: Blob | MediaSource) => {
    const url = create(object);
    born.set(url, now());
    return url;
  };
  api.revokeObjectURL = (url: string) => {
    const created = born.get(url);
    born.delete(url);
    if (created !== undefined && now() - created < YOUNG_BLOB_MS) {
      setTimeout(() => revoke(url), REVOKE_GRACE_MS);
      return;
    }
    revoke(url);
  };
  return () => {
    api.createObjectURL = create;
    api.revokeObjectURL = revoke;
  };
}
