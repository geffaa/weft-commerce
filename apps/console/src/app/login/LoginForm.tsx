"use client";
import { useActionState } from "react";
import { login } from "../actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action}>
      <label className="field"><span>Email</span><input className="input" name="email" type="email" autoComplete="username" required /></label>
      <label className="field"><span>Password</span><input className="input" name="password" type="password" autoComplete="current-password" required /></label>
      {state?.error && <div className="banner bad" role="alert">{state.error}</div>}
      <button className="btn primary" style={{ width: "100%", justifyContent: "center", height: 36 }} disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
