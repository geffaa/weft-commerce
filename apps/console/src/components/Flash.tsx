export function Flash({ error, ok }: { error?: string; ok?: string }) {
  if (error) return <div className="banner bad" role="alert">{error}</div>;
  if (ok) return <div className="banner ok" role="status">{ok}</div>;
  return null;
}
