import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { TextInput } from "@/components/tool/form";

export function PasswordInput({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  return (
    <div className="flex gap-2">
      <TextInput {...rest} type={shown ? "text" : "password"} className={className} />
      <IconButton
        icon={shown ? EyeOff : Eye}
        label={t(shown ? "password.hide" : "password.show")}
        onClick={() => setShown((state) => !state)}
        disabled={rest.disabled}
        className="shrink-0"
      />
    </div>
  );
}
