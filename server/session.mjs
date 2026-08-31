export function clearExpiredAccessSessions(accessSessions, now = Date.now()) {
  if (!(accessSessions instanceof Map)) return 0;
  let removed = 0;
  accessSessions.forEach((session, hash) => {
    if (!session || Number(session.expiresAt) <= now) {
      accessSessions.delete(hash);
      removed += 1;
    }
  });
  return removed;
}
