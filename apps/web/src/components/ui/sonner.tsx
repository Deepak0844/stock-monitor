import { Toaster as Sonner, toast } from "sonner";

/** Short success messages. Problems the owner must act on stay on the page and in the bell, never in a toast. */
export function Toaster() {
  return <Sonner position="bottom-right" toastOptions={{ classNames: { toast: "!rounded-xl !border-border !bg-card !text-card-foreground" } }} />;
}
export { toast };
