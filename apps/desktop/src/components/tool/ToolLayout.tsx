import type { ReactNode } from "react";
import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import type { LucideIcon } from "lucide-react";
import { toolGroupOfRoute, type ToolGroup } from "@/app/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { ToolGroupMenu } from "@/components/tool/ToolGroupMenu";

type ToolLayoutProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  group?: ToolGroup;
  form: ReactNode;
  result: ReactNode;
};

export function ToolLayout({ title, description, icon, actions, group: groupOverride, form, result }: ToolLayoutProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const group = groupOverride ?? toolGroupOfRoute(location.pathname, location.search);

  return (
    <div data-tone={group} className="flex h-full flex-col">
      <PageHeader title={title} description={description} icon={icon} tone={group} eyebrow={group ? <ToolGroupMenu group={group} /> : t("nav.tools")} actions={actions} />
      <div className="flex min-h-0 flex-1 flex-col overflow-auto *:shrink-0 md:grid md:grid-cols-[minmax(0,1fr)_var(--spacing-inspector)] md:overflow-visible">
        <div className="border-b p-6 md:min-h-0 md:overflow-auto md:border-e md:border-b-0">
          <div className="steps space-y-4">{form}</div>
        </div>
        {result}
      </div>
    </div>
  );
}
