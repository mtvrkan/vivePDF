import { Children, isValidElement, useId, type ChangeEvent, type InputHTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Check } from "lucide-react";
import { Select, type SelectOption } from "@/components/shared/Select";
import { FieldDescriptionContext, useControlLabel, useFieldDescription } from "@/components/tool/fieldDescription";
import { useRovingRadios } from "@/shared/hooks/useRovingRadios";
import { cn } from "@/shared/lib/cn";
import { fieldClass } from "@/shared/lib/fieldClass";

export const inputClass =
  "field h-row w-full rounded-lg px-3 text-base disabled:opacity-50";

export function Field({ label, hint, note, children, className }: { label: string; hint?: string; note?: ReactNode; children: ReactNode; className?: string }) {
  const hintId = useId();
  const noteId = useId();
  const describedBy = [note ? noteId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("block", className)}>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-foreground/80">{label}</span>
        <FieldDescriptionContext value={describedBy}>{children}</FieldDescriptionContext>
      </label>
      {note ? <div id={noteId}>{note}</div> : null}
      {hint ? <p id={hintId} className="mt-1.5 block text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  const describedBy = useFieldDescription();
  return <input aria-describedby={describedBy} {...rest} className={fieldClass(inputClass, className)} />;
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: Ref<HTMLTextAreaElement> }) {
  const describedBy = useFieldDescription();
  return <textarea aria-describedby={describedBy} {...rest} className={fieldClass("field w-full rounded-lg px-3 py-2 text-base disabled:opacity-50", className)} />;
}

function optionsOf(children: ReactNode): SelectOption[] {
  const options: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child) || child.type !== "option") return;
    const label = typeof child.props.children === "string" || typeof child.props.children === "number" ? String(child.props.children) : Children.toArray(child.props.children).join("");
    options.push({ value: String(child.props.value ?? label), label, disabled: child.props.disabled });
  });
  return options;
}

export function SelectInput({ className, children, value, onChange, disabled, id, "aria-label": ariaLabel }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Select
      id={id}
      ariaLabel={ariaLabel}
      value={String(value ?? "")}
      options={optionsOf(children)}
      disabled={disabled}
      className={className}
      onChange={(next) => onChange?.({ target: { value: next } } as unknown as ChangeEvent<HTMLSelectElement>)}
    />
  );
}

export function Checkbox({ label, hint, checked, onChange, disabled, nowrap, ariaLabel, value }: { label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; nowrap?: boolean; ariaLabel?: string; value?: string }) {
  const hintId = useId();
  const rowLabelId = useControlLabel();
  const ownName = ariaLabel ?? (label || undefined);
  return (
    <label className={cn("flex items-start gap-3 text-sm", hint ? "py-1" : "h-8", disabled && "opacity-50")}>
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          aria-label={ownName}
          aria-labelledby={ownName ? undefined : rowLabelId}
          aria-describedby={hint ? hintId : undefined}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className="block h-[22px] w-[38px] rounded-full bg-muted-foreground/35 transition-colors duration-(--transition-fast) peer-checked:bg-success peer-focus-visible:ring-4 peer-focus-visible:ring-ring/25"
        />
        <span
          aria-hidden
          className="absolute left-0.5 top-0.5 size-[18px] rounded-full bg-white shadow-[0_1px_2px_hsl(0_0%_0%/0.25)] transition-transform duration-(--transition-fast) peer-checked:translate-x-4"
        />
      </span>
      {label || hint ? (
        <span className="min-w-0 flex-1">
          {label ? <span className={cn("block", nowrap && "whitespace-nowrap")}>{label}</span> : null}
          {hint ? <span id={hintId} className="mt-0.5 block text-xs text-muted-foreground">{hint}</span> : null}
        </span>
      ) : null}
      {value ? <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{value}</span> : null}
    </label>
  );
}

export function OptionCards<T extends string>({ value, options, onChange, ariaLabel, disabled }: {
  value: T;
  options: Array<{ value: T; title: string; description: string; preview?: ReactNode }>;
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const current = Math.max(0, options.findIndex((option) => option.value === value));
  const columns = options.length === 3 ? 3 : 2;
  const roving = useRovingRadios(options, current, (option) => onChange(option.value), options.length > columns ? columns : undefined);

  return (
    <div role="radiogroup" aria-label={ariaLabel} aria-disabled={disabled || undefined} className={cn("grid gap-3", options.length === 3 ? "grid-cols-3" : "grid-cols-2", disabled && "opacity-50")}>
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={roving.refOf(index)}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={roving.tabIndexOf(index)}
            disabled={disabled}
            onKeyDown={roving.onKeyDown}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative overflow-hidden rounded-xl px-4 py-3.5 text-start transition-[background-color,box-shadow,transform] duration-(--transition-fast)",
              selected ? "option-selected" : "nav-glass bg-white/[0.03] shadow-[inset_0_0_0_1px_var(--color-border)] hover:-translate-y-px",
            )}
          >
            {option.preview ? (
              <span aria-hidden className={cn("mb-3 block", selected ? "text-(--tone)" : "text-muted-foreground/55")}>{option.preview}</span>
            ) : null}
            <span className={cn("block pe-8 text-sm font-semibold", selected ? "text-(--tone)" : "text-foreground/90")}>{option.title}</span>
            <span className={cn("mt-0.5 block pe-8 text-xs leading-4", selected ? "text-foreground/80" : "text-muted-foreground")}>{option.description}</span>
            <span
              aria-hidden
              className={cn(
                "absolute end-3.5 top-3.5 flex size-5 items-center justify-center rounded-full transition-[background-color,box-shadow] duration-(--transition-fast)",
                selected ? "tone-tile" : "shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--color-foreground)_22%,transparent)]",
              )}
            >
              {selected ? <Check className="size-3" strokeWidth={3} /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function SliderField({ label, value, min, max, step = 1, onChange, format, hint, disabled, className }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  hint?: string;
  disabled?: boolean;
  className?: string;
}) {
  const formatted = (format ?? String)(value);
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 flex items-baseline justify-between gap-2 text-sm font-medium text-foreground/80">
        <span>{label}</span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatted}</span>
      </span>
      <span className="flex h-row w-full items-center">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-label={label}
          className="w-full accent-primary disabled:opacity-50"
        />
      </span>
      {hint ? <span className="mt-1.5 block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function SwitchField({ label, hint, checked, onChange, disabled, className }: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("card glass-tinted flex items-center justify-between gap-3 rounded-lg px-3.5 py-2.5", disabled && "opacity-50", className)}>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground/80">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <Checkbox label="" ariaLabel={label} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export function Segmented<T extends string | number>({ value, options, labelOf, onChange, ariaLabel, size = "md", className }: {
  value: T;
  options: readonly T[];
  labelOf: (option: T) => string;
  onChange: (option: T) => void;
  ariaLabel: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const current = Math.max(0, options.indexOf(value));
  const roving = useRovingRadios(options, current, onChange);

  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("glass inline-flex gap-0.5 rounded-lg p-0.5", className)}>
      {options.map((option, index) => (
        <button
          key={option}
          ref={roving.refOf(index)}
          type="button"
          role="radio"
          aria-checked={option === value}
          tabIndex={roving.tabIndexOf(index)}
          onKeyDown={roving.onKeyDown}
          onClick={() => onChange(option)}
          className={cn(
            "rounded-md transition-[background-color,box-shadow] duration-(--transition-fast)",
            size === "sm" ? "h-7 px-3 text-sm" : "h-8 px-4 text-sm",
            option === value ? "glass-chip font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {labelOf(option)}
        </button>
      ))}
    </div>
  );
}

export function PresetRow({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2.5", className)}>
      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function Fieldset({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  const headingId = useId();
  return (
    <div role="group" aria-labelledby={headingId} className={cn("space-y-3 rounded-xl border border-border bg-background/40 p-3.5", className)}>
      <p id={headingId} className="text-xs font-semibold uppercase tracking-[0.08em] text-foreground/70">{title}</p>
      {children}
    </div>
  );
}

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="card glass-tinted p-5">
      {title ? <h2 className="step-title mb-4 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h2> : null}
      <div className="space-y-3.5">{children}</div>
    </section>
  );
}
