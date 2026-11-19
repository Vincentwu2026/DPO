export function LoginPage({ onSignIn }: { onSignIn: () => void }) {
  return (
    <main className="login">
      <h1>Eye Contact Coach</h1>
      <p>Sign in with your work account to see your speaking-time eye-contact history.</p>
      <button type="button" onClick={onSignIn}>
        Sign in with Microsoft
      </button>
    </main>
  )
}
