import { Button } from "@/components/ui/button.js";
import { PageHeader } from "../components/PageHeader.js";
import { Link } from "../router.js";
import { useTitle } from "../useTitle.js";

export function NotFoundPage() {
  useTitle("Page not found");
  return (
    <>
      <PageHeader title="Page not found" description="That page does not exist." />
      <Button asChild>
        <Link to="/">Go to the dashboard</Link>
      </Button>
    </>
  );
}
