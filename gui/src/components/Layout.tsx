import { A, useLocation } from "@solidjs/router";
import {
    createSignal,
    createEffect,
    onCleanup,
    type ParentProps,
} from "solid-js";
import { useNavHistory } from "../lib/navigation";

export default function Layout(props: ParentProps) {
    const location = useLocation();
    const [drawerOpen, setDrawerOpen] = createSignal(false);

    // Track in-app navigation so the per-page "← Back" links can return the
    // user to where they actually came from instead of a fixed list page.
    useNavHistory();

    const isActive = (path: string) => {
        if (path === "/") return location.pathname === "/";
        return location.pathname.startsWith(path);
    };

    const closeDrawer = () => setDrawerOpen(false);

    /* Lock body scroll when the drawer is open so the page beneath
     doesn't scroll under it on mobile. */
    createEffect(() => {
        if (drawerOpen()) {
            const prev = document.body.style.overflow;
            document.body.style.overflow = "hidden";
            onCleanup(() => {
                document.body.style.overflow = prev;
            });
        }
    });

    /* Escape closes the drawer — mirror Modal.tsx pattern. */
    createEffect(() => {
        if (!drawerOpen()) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") closeDrawer();
        };
        window.addEventListener("keydown", handler);
        onCleanup(() => window.removeEventListener("keydown", handler));
    });

    const link = (path: string, label: string) => {
        const active = isActive(path);
        return (
            <A
                href={path}
                end={path === "/"}
                activeClass=""
                class={`press-nav ${active ? "press-nav-active" : ""}`}
                onClick={closeDrawer}
            >
                {label}
            </A>
        );
    };

    return (
        <div class="flex flex-col md:flex-row min-h-screen">
            {/* Mobile top bar — hidden at md: and above. */}
            <header class="topbar md:hidden">
                <button
                    type="button"
                    aria-label="Open navigation"
                    aria-expanded={drawerOpen()}
                    onClick={() => setDrawerOpen(true)}
                    class="press press-ghost press-sm"
                    style="min-width: 44px;"
                >
                    <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                    >
                        <line x1="4" y1="6" x2="20" y2="6" />
                        <line x1="4" y1="12" x2="20" y2="12" />
                        <line x1="4" y1="18" x2="20" y2="18" />
                    </svg>
                </button>
                <div class="text-[28px] font-bold text-surf-300 font-[family-name:var(--font-display)] tracking-wider uppercase">
                    CRAM
                </div>
            </header>

            {/* Drawer overlay — only below md, only when open. */}
            {drawerOpen() && (
                <div
                    class="drawer-overlay md:hidden"
                    onClick={closeDrawer}
                    aria-hidden="true"
                />
            )}

            {/* Sidebar / drawer. Below md: fixed, off-canvas, translateX(-100%)
          by default, translateX(0) when open. At md+: behaves as before. */}
            <aside
                class={`w-sidebar bg-base-900 border-r-2 border-base-600 py-5 fixed top-0 bottom-0 overflow-y-auto z-50 transform transition-transform duration-200 ease-out
          ${drawerOpen() ? "translate-x-0" : "-translate-x-full"} md:translate-x-0`}
            >
                <div class="px-5 pb-5 mb-4 border-b-2 border-base-600 flex items-center justify-between">
                    <div>
                        <div class="text-[16px] font-bold text-surf-300 font-[family-name:var(--font-display)] tracking-wider uppercase">
                            CRAM
                        </div>
                        <div class="text-[10px] text-base-400 uppercase tracking-widest mt-1">
                            Customer Relationship Agentic Manager
                        </div>
                    </div>
                    {/* Close button for the drawer — only visible on mobile. */}
                    <button
                        type="button"
                        aria-label="Close navigation"
                        onClick={closeDrawer}
                        class="btn-x md:hidden"
                    >
                        &times;
                    </button>
                </div>
                <nav class="flex flex-col gap-2 px-3">
                    {link("/", "Dashboard")}
                    {link("/accounts", "Accounts")}
                    {link("/opportunities", "Opportunities")}
                    {link("/products", "Products")}
                    {link("/partners", "Partners")}
                    {link("/meetings", "Meetings")}
                    {link("/contacts", "Contacts")}
                    {link("/events", "Events")}
                    {link("/agent", "Agent")}
                    {link("/import-export", "Import / Export")}
                    {link("/import-notes", "Import Notes")}
                    {link("/settings", "Settings")}
                </nav>
            </aside>
            <main class="flex-1 py-5 px-4 md:ml-sidebar md:py-8 md:px-10">
                {props.children}
            </main>
        </div>
    );
}
