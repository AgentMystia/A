import { TriangleAlert } from "lucide-react";

import { Alert, AlertDescription } from "../components/ui/alert.js";
import { Button } from "../components/ui/button.js";
import { Dialog, DialogContent, DialogTitle } from "../components/ui/dialog.js";

export function MarketingFailureDialog({
  message,
  title,
  acknowledge,
  onClose,
}: {
  message: string;
  title: string;
  acknowledge: string;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-testid="marketing-failure-dialog"
        className="sm:max-w-sm"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <Alert className="min-w-0 border-0 bg-transparent p-0">
          <TriangleAlert aria-hidden className="size-4" />
          <AlertDescription
            data-slot="alert-description"
            className="min-w-0 max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-foreground"
          >
            {message}
          </AlertDescription>
        </Alert>
        <div className="flex justify-end">
          <Button onClick={onClose}>{acknowledge}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
