/** Tracks object URLs created for local file previews so they can be revoked. */

export interface ObjectUrlRegistry {
  create(file: Blob): string;
  revoke(url: string): void;
  revokeAll(): void;
}

export function createObjectUrlRegistry(): ObjectUrlRegistry {
  const urls = new Set<string>();
  return {
    create(file: Blob) {
      const url = URL.createObjectURL(file);
      urls.add(url);
      return url;
    },
    revoke(url: string) {
      if (urls.delete(url)) URL.revokeObjectURL(url);
    },
    revokeAll() {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    },
  };
}
