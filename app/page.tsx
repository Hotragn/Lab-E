import { Console } from "@/components/Console";

/**
 * The console is a client component: WebMCP tools are registered against
 * `document.modelContext`, which only exists in the browser, and grant expiry
 * runs on a wall clock. There is no server-rendered snapshot of a live tool
 * surface worth having.
 */
export default function Page() {
  return <Console />;
}
