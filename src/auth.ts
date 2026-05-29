export function parseAllowedUsers(raw: string | undefined): Set<string> {
  const users = new Set<string>();
  for (const item of (raw ?? "").split(",")) {
    const value = item.trim();
    if (value) users.add(value);
  }
  return users;
}

export function isAllowedUser(userId: string | number | undefined, allowedUsers: Set<string>): boolean {
  const normalized = String(userId ?? "").trim();
  if (!normalized) return false;
  if (allowedUsers.size === 0) return false;
  return allowedUsers.has("*") || allowedUsers.has(normalized);
}
