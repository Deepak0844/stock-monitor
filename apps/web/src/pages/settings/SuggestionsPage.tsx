import { useTitle } from "../../useTitle.js";
import { ProposalSettingsCard } from "./ProposalSettingsCard.js";

export function SuggestionsPage() {
  useTitle("Stock suggestion settings");
  return <ProposalSettingsCard />;
}
