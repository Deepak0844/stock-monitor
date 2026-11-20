import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Facts, Panel } from "../../components/Panel.js";
import { useTitle } from "../../useTitle.js";

export function AccountPage({ email, onSignOut }: { email: string; onSignOut(): void }) {
  useTitle("Account settings");
  return (
    <Panel id="account-heading" title="Account" description="The owner account you are signed in with.">
      <Facts items={[["Signed in as", email]]} />
      <div>
        <Button variant="outline" onClick={onSignOut}>
          <LogOut aria-hidden="true" />
          Sign out
        </Button>
      </div>
    </Panel>
  );
}
