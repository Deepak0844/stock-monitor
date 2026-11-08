type Props = { email: string; onSignOut: () => void };

export function HomePage({ email, onSignOut }: Props) {
  return (
    <>
      <header className="topbar">
        <h1>Stock Monitor</h1>
        <div className="topbar-user">
          <span>{email}</span>
          <button type="button" className="button secondary" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>
      <main className="page">
        <h2>Nothing to review yet</h2>
        <p className="muted">
          Supplier connections, product mapping and the approval inbox will appear here. No change
          is ever sent to Shopify without your approval.
        </p>
      </main>
    </>
  );
}
