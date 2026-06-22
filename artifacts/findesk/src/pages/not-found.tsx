import { Link } from "wouter";
import { AlertCircle, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function NotFound() {
  return (
    <div className="flex-1 w-full flex items-center justify-center p-4 min-h-[60vh]">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-3 items-center">
            <AlertCircle className="h-8 w-8 text-caution" />
            <h1 className="text-2xl font-bold text-foreground">404 — Page not found</h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            The page you are looking for does not exist or has moved.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex items-center gap-2 text-sm text-primary hover:underline"
            data-testid="link-home"
          >
            <ArrowLeft className="w-4 h-4" /> Back to dashboard
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
