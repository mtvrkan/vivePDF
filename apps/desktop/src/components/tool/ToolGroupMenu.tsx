import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toolShortcuts, type ToolGroup } from "@/app/navigation";
import { HeaderMenu, MenuLink } from "@/components/layout/HeaderMenu";

export function ToolGroupMenu({ group }: { group: ToolGroup }) {
  const { t } = useTranslation();
  const [openId, setOpenId] = useState<string | null>(null);
  const label = t(`tools.grid.groups.${group}`);
  const items = toolShortcuts.filter((item) => item.group === group);
  if (items.length === 0) return label;

  return (
    <HeaderMenu
      id="tool-group"
      variant="eyebrow"
      label={label}
      menuLabel={label}
      active={false}
      openId={openId}
      onOpenChange={setOpenId}
      panelClassName="max-h-[70vh] w-72 overflow-y-auto"
    >
      <div data-tone={group} className="space-y-px">
        {items.map((item) => (
          <MenuLink key={item.id} icon={item.icon} label={t(item.labelKey)} route={item.route} tone={group} onSelect={() => setOpenId(null)} />
        ))}
      </div>
    </HeaderMenu>
  );
}
