import type { Api } from "../../api.js";
import { useTitle } from "../../useTitle.js";
import { ProposalSettingsCard } from "./ProposalSettingsCard.js";

export function SuggestionsPage({ api }: { api: Api }) {
  useTitle("Stock suggestion settings");
  return <ProposalSettingsCard api={api} />;
}
