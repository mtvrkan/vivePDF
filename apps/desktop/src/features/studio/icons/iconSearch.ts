export const ICON_CATEGORIES = ["arrows", "shapes", "communication", "people", "media", "nature", "business", "travel", "files", "devices", "food"] as const;
export type IconCategory = (typeof ICON_CATEGORIES)[number];

export const ICON_CONCEPTS = [
  "heart",
  "star",
  "arrow",
  "home",
  "user",
  "mail",
  "phone",
  "calendar",
  "clock",
  "check",
  "close",
  "plus",
  "search",
  "settings",
  "camera",
  "music",
  "location",
  "lock",
  "cart",
  "money",
  "gift",
  "sun",
  "moon",
  "weather",
  "plant",
  "book",
  "pen",
  "award",
  "flag",
  "bell",
  "globe",
  "car",
  "plane",
  "chart",
  "document",
  "food",
  "warning",
  "info",
  "idea",
  "face",
] as const;
export type IconConcept = (typeof ICON_CONCEPTS)[number];

export type IconEntry = { name: string; label: string; slug: string; words: string[]; categories: IconCategory[] };

export type LocalTerms = Partial<Record<IconConcept | IconCategory, string[]>>;

export type IconSearchOptions = { category?: IconCategory | null; local?: LocalTerms };

const CATEGORY_WORDS: Record<Exclude<IconCategory, "shapes">, readonly string[]> = {
  arrows: ["arrow", "arrows", "chevron", "chevrons", "move", "corner", "undo", "redo", "refresh", "rotate", "repeat", "shuffle", "iteration", "merge", "split", "forward", "reply", "redo"],
  communication: ["mail", "mails", "message", "messages", "phone", "send", "inbox", "at", "voicemail", "megaphone", "bell", "contact", "speech", "rss", "podcast", "reply"],
  people: ["user", "users", "person", "baby", "contact", "smile", "frown", "laugh", "meh", "angry", "annoyed", "hand", "accessibility", "handshake", "footprints", "venus", "mars", "ear", "brain", "heart"],
  media: ["play", "pause", "music", "video", "camera", "image", "images", "film", "clapperboard", "mic", "volume", "headphones", "radio", "tv", "disc", "podcast", "speaker", "cast", "aperture", "audio", "guitar", "piano", "drum"],
  nature: ["sun", "moon", "cloud", "cloudy", "snowflake", "wind", "umbrella", "leaf", "leafy", "tree", "trees", "flower", "sprout", "droplet", "droplets", "flame", "mountain", "rainbow", "thermometer", "zap", "sunrise", "sunset", "tornado", "waves", "clover", "shell", "bird", "cat", "dog", "fish", "rabbit", "squirrel", "turtle", "bug", "feather", "snail", "rat", "worm", "paw", "bone", "flower2", "palmtree", "trees", "earth"],
  business: ["chart", "briefcase", "wallet", "credit", "dollar", "euro", "pound", "banknote", "coins", "receipt", "piggy", "landmark", "building", "trending", "percent", "calculator", "shopping", "store", "presentation", "handshake", "gauge", "target", "badge", "scale", "bitcoin", "currency"],
  travel: ["car", "bus", "plane", "train", "ship", "sailboat", "bike", "bicycle", "map", "compass", "globe", "earth", "house", "home", "hotel", "luggage", "tent", "caravan", "fuel", "navigation", "signpost", "route", "tram", "truck", "rocket", "ticket", "anchor", "castle", "church", "hospital", "school", "pin", "plane", "tickets"],
  files: ["file", "files", "folder", "folders", "clipboard", "archive", "paperclip", "book", "notebook", "sticky", "notepad", "scroll", "newspaper", "library", "bookmark", "copy", "save", "text"],
  devices: ["laptop", "monitor", "smartphone", "tablet", "cpu", "wifi", "bluetooth", "battery", "database", "server", "hard", "keyboard", "mouse", "printer", "plug", "usb", "cable", "router", "webcam", "watch", "gamepad", "joystick", "code", "terminal", "computer", "phone", "memory", "satellite"],
  food: ["coffee", "cup", "pizza", "apple", "cake", "utensils", "wine", "beer", "egg", "cookie", "ice", "soup", "salad", "sandwich", "croissant", "carrot", "cherry", "citrus", "grape", "banana", "candy", "popcorn", "milk", "beef", "ham", "drumstick", "cooking", "chef", "martini", "lollipop", "dessert", "donut", "hamburger", "vegan", "wheat", "bean", "nut", "cup", "glass", "bottle", "pot", "microwave", "refrigerator"],
};

const SHAPE_WORDS = new Set(["circle", "square", "triangle", "hexagon", "octagon", "pentagon", "diamond", "star", "heart", "cone", "cylinder", "torus", "pyramid", "squircle", "shapes", "dashed", "dot", "half", "right", "rectangle", "horizontal", "vertical", "spline", "blend", "box", "cuboid", "ellipse", "small", "large"]);

const CONCEPTS: Record<IconConcept, { synonyms: readonly string[]; targets: readonly string[] }> = {
  heart: { synonyms: ["love", "like", "favourite", "favorite", "romance"], targets: ["heart"] },
  star: { synonyms: ["favourite", "favorite", "rating", "review"], targets: ["star", "sparkles"] },
  arrow: { synonyms: ["direction", "pointer", "next", "back"], targets: ["arrow", "chevron", "move"] },
  home: { synonyms: ["house", "start"], targets: ["house", "home"] },
  user: { synonyms: ["person", "profile", "account", "people", "team", "member", "avatar"], targets: ["user", "users", "contact"] },
  mail: { synonyms: ["email", "envelope", "letter", "post"], targets: ["mail", "inbox", "send"] },
  phone: { synonyms: ["call", "telephone", "mobile", "contact"], targets: ["phone", "smartphone"] },
  calendar: { synonyms: ["date", "event", "schedule", "day", "appointment"], targets: ["calendar"] },
  clock: { synonyms: ["time", "hour", "watch", "timer", "deadline"], targets: ["clock", "timer", "alarm", "hourglass", "watch"] },
  check: { synonyms: ["tick", "ok", "done", "success", "yes", "approved"], targets: ["check"] },
  close: { synonyms: ["cancel", "remove", "delete", "cross", "no", "wrong"], targets: ["x"] },
  plus: { synonyms: ["add", "new", "create"], targets: ["plus"] },
  search: { synonyms: ["find", "magnifier", "lookup", "zoom"], targets: ["search"] },
  settings: { synonyms: ["gear", "cog", "options", "preferences", "configure"], targets: ["settings", "cog", "sliders"] },
  camera: { synonyms: ["photo", "picture", "photography", "image", "gallery"], targets: ["camera", "image", "images"] },
  music: { synonyms: ["song", "audio", "sound", "note", "melody"], targets: ["music", "headphones", "volume"] },
  location: { synonyms: ["place", "pin", "map", "address", "marker", "venue"], targets: ["map", "pin", "navigation", "compass"] },
  lock: { synonyms: ["security", "password", "private", "secure", "safe"], targets: ["lock", "shield", "key"] },
  cart: { synonyms: ["shop", "shopping", "buy", "basket", "store", "sale"], targets: ["shopping", "store"] },
  money: { synonyms: ["cash", "payment", "price", "finance", "pay", "bank", "currency"], targets: ["banknote", "coins", "dollar", "euro", "wallet", "piggy", "credit", "receipt"] },
  gift: { synonyms: ["present", "birthday", "party", "celebration"], targets: ["gift", "party", "cake"] },
  sun: { synonyms: ["day", "summer", "bright", "sunny"], targets: ["sun"] },
  moon: { synonyms: ["night", "dark", "sleep"], targets: ["moon"] },
  weather: { synonyms: ["rain", "snow", "forecast", "storm"], targets: ["cloud", "umbrella", "snowflake", "wind", "thermometer"] },
  plant: { synonyms: ["nature", "garden", "flower", "green", "eco"], targets: ["flower", "leaf", "sprout", "tree", "clover", "trees"] },
  book: { synonyms: ["read", "reading", "library", "education", "study"], targets: ["book", "library", "notebook"] },
  pen: { synonyms: ["write", "edit", "pencil", "sign", "draw"], targets: ["pen", "pencil", "signature"] },
  award: { synonyms: ["prize", "winner", "medal", "trophy", "badge", "achievement"], targets: ["trophy", "award", "medal", "crown"] },
  flag: { synonyms: ["report", "country", "goal", "milestone"], targets: ["flag"] },
  bell: { synonyms: ["notification", "alert", "alarm", "reminder"], targets: ["bell"] },
  globe: { synonyms: ["world", "earth", "internet", "web", "international"], targets: ["globe", "earth"] },
  car: { synonyms: ["vehicle", "drive", "transport", "taxi", "traffic"], targets: ["car", "bus", "truck", "bike", "train"] },
  plane: { synonyms: ["travel", "flight", "airport", "trip", "holiday", "vacation"], targets: ["plane", "luggage", "ticket"] },
  chart: { synonyms: ["graph", "statistics", "report", "data", "analytics", "growth"], targets: ["chart", "trending", "gauge"] },
  document: { synonyms: ["file", "paper", "page", "folder", "paperwork"], targets: ["file", "files", "folder", "clipboard"] },
  food: { synonyms: ["eat", "meal", "restaurant", "drink", "dinner", "lunch", "breakfast"], targets: ["utensils", "pizza", "coffee", "cup", "apple", "sandwich", "soup", "cake", "wine", "beer", "salad"] },
  warning: { synonyms: ["alert", "danger", "caution", "error", "attention"], targets: ["alert", "siren"] },
  info: { synonyms: ["information", "help", "question", "faq", "support"], targets: ["info", "help", "question"] },
  idea: { synonyms: ["lamp", "bulb", "light", "creative", "tip"], targets: ["lightbulb", "lamp", "sparkles"] },
  face: { synonyms: ["happy", "emoji", "smiley", "mood", "sad"], targets: ["smile", "laugh", "frown", "meh", "annoyed", "angry"] },
};

export const FEATURED_ICONS = [
  "Heart",
  "Star",
  "Check",
  "Phone",
  "Mail",
  "MapPin",
  "Calendar",
  "Clock",
  "User",
  "House",
  "Globe",
  "ShoppingCart",
  "Gift",
  "Award",
  "Sun",
  "Camera",
  "Music",
  "Lightbulb",
  "Leaf",
  "Coffee",
  "Plane",
  "ThumbsUp",
  "Smile",
  "Sparkles",
] as const;

const featuredRank = new Map<string, number>(FEATURED_ICONS.map((name, index) => [name, index]));

export function normalizeTerm(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase().trim();
}

export function splitIconName(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([a-z]{2})(\d)/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function categoriesOf(words: string[]): IconCategory[] {
  const found: IconCategory[] = [];
  for (const category of ICON_CATEGORIES) {
    if (category === "shapes") {
      if (words.every((word) => SHAPE_WORDS.has(word)) && words.some((word) => SHAPE_WORDS.has(word) && word !== "dashed" && word !== "half" && word !== "right" && word !== "small" && word !== "large")) found.push(category);
    } else if (words.some((word) => CATEGORY_WORDS[category].includes(word))) {
      found.push(category);
    }
  }
  return found;
}

export function iconEntry(name: string): IconEntry {
  const words = splitIconName(name);
  const label = words.join(" ");
  return { name, label: label.charAt(0).toUpperCase() + label.slice(1), slug: words.join("-"), words, categories: categoriesOf(words) };
}

function directScore(entry: IconEntry, term: string): number {
  if (entry.slug === term || entry.words.join("") === term) return 100;
  const index = entry.words.indexOf(term);
  if (index >= 0) return index === 0 ? 70 : 60;
  const prefix = entry.words.findIndex((word) => word.startsWith(term));
  if (prefix >= 0) return prefix === 0 ? 45 : 40;
  return term.length >= 3 && entry.slug.includes(term) ? 15 : 0;
}

function matches(candidates: readonly string[], term: string): number {
  let best = 0;
  for (const candidate of candidates) {
    const normalized = normalizeTerm(candidate);
    if (!normalized) continue;
    if (normalized === term) return 2;
    if (term.length >= 2 && normalized.startsWith(term)) best = 1;
  }
  return best;
}

type TermPlan = { term: string; concepts: { targets: readonly string[]; score: number }[]; categories: { category: IconCategory; score: number }[] };

function plan(term: string, local: LocalTerms): TermPlan {
  const concepts = ICON_CONCEPTS.flatMap((concept) => {
    const strength = Math.max(matches([concept, ...CONCEPTS[concept].synonyms], term), matches(local[concept] ?? [], term));
    return strength ? [{ targets: CONCEPTS[concept].targets, score: strength === 2 ? 35 : 25 }] : [];
  });
  const categories = ICON_CATEGORIES.flatMap((category) => {
    const strength = Math.max(matches([category], term), matches(local[category] ?? [], term));
    return strength === 2 || (strength && term.length >= 3) ? [{ category, score: strength === 2 ? 12 : 8 }] : [];
  });
  return { term, concepts, categories };
}

function termScore(entry: IconEntry, step: TermPlan): number {
  let score = directScore(entry, step.term);
  for (const concept of step.concepts) if (concept.score > score && entry.words.some((word) => concept.targets.includes(word))) score = concept.score;
  for (const category of step.categories) if (category.score > score && entry.categories.includes(category.category)) score = category.score;
  return score;
}

function byDefaultOrder(left: IconEntry, right: IconEntry): number {
  const leftRank = featuredRank.get(left.name) ?? Number.POSITIVE_INFINITY;
  const rightRank = featuredRank.get(right.name) ?? Number.POSITIVE_INFINITY;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return left.label.localeCompare(right.label, "en");
}

export function searchIcons(entries: readonly IconEntry[], query: string, options: IconSearchOptions = {}): IconEntry[] {
  const pool = options.category ? entries.filter((entry) => entry.categories.includes(options.category as IconCategory)) : entries;
  const terms = normalizeTerm(query).split(/[\s,\-_]+/).filter(Boolean);
  if (!terms.length) return [...pool].sort(byDefaultOrder);
  const steps = terms.map((term) => plan(term, options.local ?? {}));
  const whole = terms.join("-");
  const scored: { entry: IconEntry; score: number }[] = [];
  for (const entry of pool) {
    let total = entry.slug === whole ? 100 : 0;
    let missing = false;
    for (const step of steps) {
      const score = termScore(entry, step);
      if (!score) {
        missing = true;
        break;
      }
      total += score;
    }
    if (!missing) scored.push({ entry, score: total });
  }
  return scored
    .sort((left, right) => right.score - left.score || left.entry.words.length - right.entry.words.length || left.entry.label.localeCompare(right.entry.label, "en"))
    .map((item) => item.entry);
}
