import { Button } from "@/components/ui/button.js";
import { EmptyState } from "../components/EmptyState.js";
import { PageHeader } from "../components/PageHeader.js";
import { Link } from "../router.js";
import { useTitle } from "../useTitle.js";

export function NotFoundPage() {
  useTitle("Page not found");
  return (
    <>
      <PageHeader title="Page not found" />
      <EmptyState
        kind="not-found"
        title="That page does not exist."
        description="It may have moved, or the supplier or link it showed was deleted."
        action={
          <>
            <Button asChild>
              <Link to="/">Go to the dashboard</Link>
            </Button>
            <Button variant="outline" onClick={() => window.history.back()}>
              Back
            </Button>
          </>
        }
      />
    </>
  );
}
