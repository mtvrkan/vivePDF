import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button } from "./Button";
import { ErrorState } from "./ErrorState";
import { exitImmersive } from "@/features/viewer/immersive";
import * as logger from "@/shared/lib/logger";
import { useReportStore } from "@/shared/store/reportStore";
import { useUiStore } from "@/shared/store/uiStore";

type ErrorBoundaryProps = { children: ReactNode; fallback: (error: Error, reset: () => void) => ReactNode };
type ErrorBoundaryState = { error: Error | null };

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error("react", `${error.message}\n${info.componentStack ?? ""}`);
    if (useUiStore.getState().immersive) void exitImmersive();
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) return this.props.fallback(this.state.error, this.reset);
    return this.props.children;
  }
}

function CrashFallback({ error, reset }: { error: Error; reset: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const openDialog = useReportStore((state) => state.openDialog);
  const [stillFullscreen, setStillFullscreen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getCurrentWindow()
      .isFullscreen()
      .then((value) => {
        if (!cancelled) setStillFullscreen(value);
      })
      .catch(() => void 0);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <ErrorState title={t("app.crashTitle")} message={t("app.crashMessage", { message: error.message })} onRetry={reset} />
      <div className="flex justify-center gap-2 pb-8">
        {stillFullscreen ? (
          <Button variant="primary" size="sm" onClick={() => void exitImmersive()}>
            {t("viewer.exitFullscreen")}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            reset();
            void navigate("/");
          }}
        >
          {t("nav.home")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => openDialog({ category: "crash", description: error.message })}
        >
          {t("app.reportCrash")}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void invoke("open_log_dir")}>
          {t("app.openLogDir")}
        </Button>
      </div>
    </div>
  );
}

export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <ErrorBoundary key={location.pathname} fallback={(error, reset) => <CrashFallback error={error} reset={reset} />}>
      {children}
    </ErrorBoundary>
  );
}
