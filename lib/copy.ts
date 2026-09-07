/**
 * Every human-facing string, in one place.
 *
 * The rule: plain words on the outside, precise words underneath. A visitor who
 * has never heard of WebMCP should understand the page in ten seconds, and a
 * reviewer who knows the spec should still see the real vocabulary — so most
 * headings carry a short technical subtitle rather than replacing it.
 *
 * No jargon in `title`. No hand-waving in `sub`.
 */

export const BRAND = {
  name: "LABE",
  /** One line. Benefit first, mechanism never. */
  tagline: "Let AI help without letting it break things.",
  /** The whole idea, in two sentences a non-engineer can follow. */
  standfirst:
    "An AI assistant can read everything on this page. It cannot change anything until you approve it — and your approval runs out on its own.",
  role: "a safety layer for AI assistants that use websites",
} as const;

/** The three-step explanation. Kept to one short sentence each. */
export const HOW_IT_WORKS = [
  {
    n: "1",
    title: "The AI gets safe tools only",
    body: "Looking at data, taking notes, suggesting a fix. Nothing here can break anything, so it needs no permission.",
  },
  {
    n: "2",
    title: "Anything risky, it has to ask you",
    body: "You see what it wants to do, to what, and why. You can give it less than it asked for.",
  },
  {
    n: "3",
    title: "Your approval expires",
    body: "One use, a few minutes. Then the ability disappears again, on its own.",
  },
] as const;

export const WHAT_WHY = {
  what: {
    title: "What this is",
    body: "A pretend control room for a website's servers, with an AI assistant plugged into it. Something has just broken. The assistant can see everything — but the buttons that could cause real damage were never handed to it.",
  },
  why: {
    title: "Why it matters",
    body: "AI assistants can now press buttons on web pages for you. That is useful, and risky: anything the AI reads can contain hidden instructions trying to trick it. Most apps let the AI try everything and refuse afterwards. If it has already been tricked, refusing is too late.",
  },
  how: {
    title: "How LABE is different",
    body: "The risky buttons are not refused. They are not there. They only get built when you say yes, they only fit the one thing you approved, and they fall apart when time runs out.",
  },
} as const;

/** Panel headings: plain title, technical subtitle. */
export const PANELS = {
  systems: { title: "Your systems", sub: "services and deploys" },
  incident: { title: "What is broken", sub: "incident" },
  approvals: { title: "Waiting for your OK", sub: "authority inbox" },
  surface: { title: "What the AI can do right now", sub: "registered tools" },
} as const;

export const SURFACE_GROUPS = {
  always: { title: "Always allowed", sub: "registered permanently" },
  granted: { title: "You approved these", sub: "registered while your grant lives" },
  withheld: { title: "Not available to it", sub: "never registered" },
  withheldNote:
    "The AI is not refused when it tries these. They simply are not in the list of things it can do, so it cannot try.",
  grantedEmpty:
    "You have not approved anything. Right now the AI cannot change a single thing here.",
} as const;

export const TABS = {
  agent: { title: "Try it", sub: "agent console" },
  ledger: { title: "History", sub: "audit ledger" },
  policy: { title: "Rules", sub: "standing policy" },
  quarantine: { title: "Blocked tricks", sub: "prompt injection" },
} as const;

/** Words for the three permission levels, for people rather than for docs. */
export const POLICY_WORDS = {
  auto: { label: "Always allowed", note: "The AI can do this whenever it likes." },
  grant: { label: "Needs your OK", note: "The AI has to ask. You decide, every time." },
  forbidden: { label: "Never allowed", note: "Only you can do this, by hand. No exceptions." },
} as const;

export const LABELS = {
  needsOk: "needs your OK",
  neverAllowed: "never allowed",
  ifThisRuns: "if this runs",
  approve: "Approve",
  deny: "No",
  revoke: "Take it back",
  suggestedFix: "The AI's suggested fix",
  usesLeft: "left",
  webmcpOn: "AI tools are live",
  webmcpOff: "Try it below",
} as const;

/**
 * Plain-English name for every operation.
 *
 * The hero panel leads with these and keeps the real identifier as a small
 * subtitle. A visitor should never have to parse `rollback_deploy` to
 * understand what is being withheld from the AI.
 */
export const TOOL_WORDS: Record<string, string> = {
  get_system_state: "Read the numbers",
  read_telemetry: "Read the logs",
  list_operations: "Check what it may do",
  request_authority: "Ask you for permission",
  check_authority: "Check if you said yes",
  annotate_incident: "Write a note",
  draft_remediation: "Suggest a fix",
  verify_ledger: "Prove what it did",
  rollback_deploy: "Undo the last release",
  set_feature_flag: "Switch a feature on or off",
  scale_service: "Add or remove servers",
  purge_cache: "Clear the cache",
  issue_refund: "Refund a customer",
  delete_service: "Delete a whole service",
  rotate_credentials: "Reset all the passwords",
};

export const words = (id: string): string => TOOL_WORDS[id] ?? id;

export const KEYRING = {
  title: "What this AI can do, right now",
  allowed: "It can",
  locked: "It cannot",
  approvedNow: "You approved",
  cta: "Run the demo",
  ctaRunning: "Running…",
  lockedNote: "Not blocked. Not handed over.",
  neverNote: "Never, by any approval",
} as const;

/**
 * Reading order for the "it can" column.
 *
 * Alphabetical put "Write a note" first and "Read the numbers" fifth, which
 * reads like a shuffled deck. This is the order the AI actually works in:
 * look, orient, write down, propose, ask, confirm, prove.
 */
export const ALLOWED_ORDER = [
  "get_system_state",
  "read_telemetry",
  "list_operations",
  "annotate_incident",
  "draft_remediation",
  "request_authority",
  "check_authority",
  "verify_ledger",
] as const;

export const allowedRank = (id: string): number => {
  const i = (ALLOWED_ORDER as readonly string[]).indexOf(id);
  return i === -1 ? ALLOWED_ORDER.length : i;
};
