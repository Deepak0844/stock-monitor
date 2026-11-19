import { Button } from "@/components/ui/button.js";

type Props = { count: number; canApprove: boolean; onApprove(): void; onReject(): void; onClear(): void; progress: { done: number; total: number } | null };

/** "3 selected · Approve 3 · Reject 3 · Clear selection", above the list on a wide screen and above the tabs on a phone. */
export function BulkBar({ count, canApprove, onApprove, onReject, onClear, progress }: Props) {
  return (
    <section
      aria-label="Selected proposals"
      className="z-20 mb-3 flex flex-wrap items-center gap-2 rounded-md bg-foreground px-3 py-2 text-sm text-background max-lg:fixed max-lg:inset-x-3 max-lg:bottom-20 lg:sticky lg:top-14"
    >
      <b className="mr-1">{count} selected</b>
      {progress ? (
        <span role="status">
          Approving {progress.done} of {progress.total}…
        </span>
      ) : (
        <>
          {canApprove && (
            <Button size="sm" className="border-background bg-background text-foreground" onClick={onApprove}>
              Approve {count}
            </Button>
          )}
          <Button size="sm" variant="outline" className="border-background/50 text-background hover:bg-background/10 hover:text-background" onClick={onReject}>
            Reject {count}
          </Button>
        </>
      )}
      <button type="button" onClick={onClear} className="ml-auto min-h-10 cursor-pointer underline underline-offset-3 lg:min-h-7">
        Clear selection
      </button>
    </section>
  );
}
