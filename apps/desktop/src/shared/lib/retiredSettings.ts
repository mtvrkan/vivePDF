const RETIRED_KEYS = new Set(["vivepdf.sidebarCollapsed", "vivepdf.sidebarGroups"]);
const RETIRED_PREFIXES = ["vivepdf.sponsor"];

export function isRetiredSettingKey(key: string): boolean {
  return RETIRED_KEYS.has(key) || RETIRED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function storedKeys(): string[] {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key !== null) keys.push(key);
  }
  return keys;
}

export function removeRetiredSettings(): string[] {
  try {
    const retired = storedKeys().filter(isRetiredSettingKey);
    retired.forEach((key) => localStorage.removeItem(key));
    return retired;
  } catch {
    return [];
  }
}

