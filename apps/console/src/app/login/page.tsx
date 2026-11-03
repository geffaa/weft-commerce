import LoginForm from "./LoginForm";
export default async function Login({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="login">
      <div className="panel">
        <h1 style={{ fontSize: 22, marginBottom: 4 }}>Weft console</h1>
        <p className="muted" style={{ marginBottom: 16 }}>Sign in to operate orders, stock and accounting.</p>
        {sp.expired && <div className="banner bad" role="alert">Your session expired. Sign in again.</div>}
        <LoginForm />
      </div>
    </main>
  );
}
