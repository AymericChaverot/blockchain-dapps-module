import { CompassIcon } from "lucide-react";
import { Link } from "react-router";

import { EmptyState } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="mx-auto mt-10 w-full max-w-lg">
      <EmptyState icon={<CompassIcon />} title="Page not found">
        <span className="flex flex-col items-center gap-3">
          This address does not match any SitePass page.
          <Button asChild>
            <Link to="/">Verify a credential</Link>
          </Button>
        </span>
      </EmptyState>
    </div>
  );
}
