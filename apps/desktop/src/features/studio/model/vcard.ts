export const VCARD_FIELDS = ["firstName", "lastName", "organization", "title", "phone", "mobile", "email", "website", "address"] as const;

export type VCardField = (typeof VCARD_FIELDS)[number];

export type VCard = Record<VCardField, string>;

export const EMPTY_VCARD: VCard = { firstName: "", lastName: "", organization: "", title: "", phone: "", mobile: "", email: "", website: "", address: "" };

const LINE_BREAK = "\r\n";

export const QR_VALUE_LIMIT = 2000;

function escaped(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function unescaped(value: string): string {
  return value.replace(/\\([\\,;nN])/g, (_, char: string) => (char === "n" || char === "N" ? "\n" : char));
}

function splitComponents(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "\\" && index + 1 < value.length) {
      current += char + value[index + 1];
      index += 1;
    } else if (char === ";") {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.map(unescaped);
}

export function isVCard(value: string): boolean {
  return /^\s*BEGIN:VCARD/i.test(value);
}

export function buildVCard(card: VCard): string {
  const name = [card.firstName, card.lastName].map((part) => part.trim()).filter(Boolean).join(" ");
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${escaped(card.lastName)};${escaped(card.firstName)};;;`, `FN:${escaped(name || card.organization)}`];
  const optional: [string, string][] = [
    ["ORG", card.organization],
    ["TITLE", card.title],
    ["TEL;TYPE=WORK,VOICE", card.phone],
    ["TEL;TYPE=CELL", card.mobile],
    ["EMAIL;TYPE=INTERNET", card.email],
    ["URL", card.website],
  ];
  for (const [key, value] of optional) if (value.trim()) lines.push(`${key}:${escaped(value)}`);
  if (card.address.trim()) lines.push(`ADR;TYPE=WORK:;;${escaped(card.address)};;;;`);
  lines.push("END:VCARD");
  return lines.join(LINE_BREAK);
}

function unfolded(value: string): string[] {
  return value.replace(/\r\n|\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

export function parseVCard(value: string): VCard | null {
  if (!isVCard(value)) return null;
  const card: VCard = { ...EMPTY_VCARD };
  for (const line of unfolded(value)) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const [property, ...parameters] = line.slice(0, colon).toUpperCase().split(";");
    const content = line.slice(colon + 1);
    const types = parameters.join(";");
    switch (property) {
      case "N": {
        const [last = "", first = ""] = splitComponents(content);
        card.lastName = last;
        card.firstName = first;
        break;
      }
      case "ORG":
        card.organization = splitComponents(content)[0] ?? "";
        break;
      case "TITLE":
        card.title = unescaped(content);
        break;
      case "TEL":
        if (/CELL/.test(types)) card.mobile = unescaped(content);
        else card.phone = unescaped(content);
        break;
      case "EMAIL":
        card.email = unescaped(content);
        break;
      case "URL":
        card.website = unescaped(content);
        break;
      case "ADR":
        card.address = splitComponents(content)
          .filter((part) => part.trim())
          .join(", ");
        break;
    }
  }
  return card;
}
