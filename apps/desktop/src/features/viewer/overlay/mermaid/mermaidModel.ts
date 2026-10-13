export type MermaidTheme = "default" | "neutral" | "forest" | "base";

export type MermaidSettings = { code: string; theme: MermaidTheme };

export const MAX_MERMAID_CHARS = 20000;
export const MERMAID_POINTS_PER_UNIT = 0.75;
export const MAX_PLACED_SIZE = { width: 480, height: 680 };
export const MERMAID_THEMES: readonly MermaidTheme[] = ["default", "neutral", "forest", "base"];
export const DEFAULT_MERMAID_THEME: MermaidTheme = "default";

const TITLE_LINE = /(?:^|\s)title\s+(.+)$/i;

export const MERMAID_TEMPLATES = [
  { id: "flowchart", code: "flowchart TD\n    A[Start] --> B{Ready?}\n    B -- Yes --> C[Continue]\n    B -- No --> D[Fix it]\n    D --> B\n    C --> E[Done]" },
  { id: "sequence", code: "sequenceDiagram\n    participant U as User\n    participant S as Server\n    U->>S: Request\n    S-->>U: Response\n    U->>S: Thanks" },
  { id: "class", code: "classDiagram\n    class Animal {\n        +String name\n        +move()\n    }\n    class Dog {\n        +bark()\n    }\n    Animal <|-- Dog" },
  { id: "er", code: "erDiagram\n    CUSTOMER ||--o{ ORDER : places\n    ORDER ||--|{ ITEM : contains\n    CUSTOMER {\n        string name\n        string email\n    }" },
  { id: "state", code: "stateDiagram-v2\n    [*] --> Draft\n    Draft --> Review\n    Review --> Draft\n    Review --> Published\n    Published --> [*]" },
  { id: "gantt", code: "gantt\n    dateFormat YYYY-MM-DD\n    axisFormat %d.%m\n    title Project\n    section Plan\n    Research :a1, 2026-01-05, 7d\n    Design   :a2, after a1, 5d\n    section Build\n    Develop  :b1, after a2, 10d\n    Test     :b2, after b1, 4d" },
  { id: "pie", code: "pie title Share\n    \"A\" : 45\n    \"B\" : 30\n    \"C\" : 25" },
  { id: "mindmap", code: "mindmap\n  root((Topic))\n    Idea one\n      Detail\n    Idea two\n    Idea three" },
] as const;

export type MermaidTemplateId = (typeof MERMAID_TEMPLATES)[number]["id"];

export function cleanMermaid(code: string): string {
  return code.replace(/\r\n?/g, "\n").slice(0, MAX_MERMAID_CHARS).trim();
}

export function mermaidTheme(value: unknown): MermaidTheme {
  return MERMAID_THEMES.includes(value as MermaidTheme) ? (value as MermaidTheme) : DEFAULT_MERMAID_THEME;
}

export function mermaidTitle(code: string): string {
  const lines = cleanMermaid(code)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("%%"));
  const titled = lines.map((line) => TITLE_LINE.exec(line)?.[1]).find(Boolean);
  return (titled ?? lines[0] ?? "").replace(/["']/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

export function errorLine(message: string): number | null {
  const match = /line\s+(\d+)/i.exec(message);
  return match ? Number(match[1]) : null;
}

export function placedScale(width: number, height: number): number {
  return Math.min(MERMAID_POINTS_PER_UNIT, MAX_PLACED_SIZE.width / width, MAX_PLACED_SIZE.height / height);
}
