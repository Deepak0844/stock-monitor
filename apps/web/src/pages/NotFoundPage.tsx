import { Link } from "../router.js";
import { useTitle } from "../useTitle.js";

export function NotFoundPage() {
  useTitle("Page not found");
  return (
    <>
      <div className="page-header">
        <h1>Page not found</h1>
        <p className="muted">That page does not exist.</p>
      </div>
      <Link to="/" className="button primary inline">
        Go to the dashboard
      </Link>
    </>
  );
}
