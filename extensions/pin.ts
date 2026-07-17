/**
 * Pin Extension
 *
 * Pin assistant messages and recall them in a dismissible overlay viewer
 * (no permanent screen space taken).
 *
 * Commands:
 *   /pin [label]    Pin the last assistant message (optional label)
 *   /pin pick       Interactively pick a recent assistant message to pin
 *   /pin list       Browse all pins in the overlay viewer
 *   /pin show <n>   Open pin #n in the overlay viewer (↑↓/PgUp/PgDn, q/Esc closes)
 *   /pin show       Pick a pin interactively, then view it
 *   /pin rm <n>     Remove pin #n
 *   /pin clear      Remove all pins
 *   /pin help       Show help (in the overlay viewer)
 *
 * Pins are stored in the session via pi.appendEntry() — they survive
 * /reload, restarts, and /resume, and follow the session tree branch.
 */

import {	type ExtensionAPI,
	type ExtensionCommandContext,
	getMarkdownTheme,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { type Focusable, Markdown, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const STATE_TYPE = "pin-state";
const PICK_COUNT = 10;

interface Pin {
	id: number;
	label: string;
	text: string;
	pinnedAt: number;
}

interface SessionEntryLike {
	type: string;
	customType?: string;
	data?: unknown;
	message?: { role?: string; content?: unknown };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.filter((p): p is { type: string; text: string } =>
			Boolean(p && typeof p === "object" && (p as { type?: string }).type === "text"),
		)
		.map((p) => p.text)
		.join("\n")
		.trim();
}

function autoLabel(text: string): string {
	const firstLine = text.split("\n").find((l) => l.trim()) ?? "";
	const cleaned = firstLine.replace(/^[#*\-|>`\s]+/, "").trim();
	return cleaned.length > 42 ? `${cleaned.slice(0, 42)}…` : cleaned || "pin";
}

function preview(text: string, max = 60): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function fmtTime(ts: number): string {
	const d = new Date(ts);
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Overlay browser component (pin list + live content preview)
// ---------------------------------------------------------------------------

class PinBrowser implements Focusable {
	focused = false;
	private selected: number;
	private contentScroll = 0;
	private contentCount = 0;
	private mdCache = new Map<string, Markdown>();

	constructor(
		private theme: Theme,
		private pins: Pin[],
		initialIndex: number,
		private viewport: number,
		private done: () => void,
	) {
		this.selected = Math.max(0, Math.min(initialIndex, pins.length - 1));
	}

	private contentLines(pin: Pin, width: number): string[] {
		const key = `${pin.id}:${width}`;
		let md = this.mdCache.get(key);
		if (!md) {
			md = new Markdown(pin.text, 0, 0, getMarkdownTheme());
			this.mdCache.set(key, md);
		}
		return md.render(width);
	}

	private listRows(): number {
		return Math.max(1, Math.min(this.pins.length, 6, Math.floor(this.viewport / 3)));
	}

	private contentRows(): number {
		return Math.max(3, this.viewport - this.listRows());
	}

	private maxContentScroll(): number {
		return Math.max(0, this.contentCount - this.contentRows());
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "return") || data === "q") {
			this.done();
			return;
		}
		// ↑↓ scroll the content line by line; PgUp/PgDn switch pins
		if (matchesKey(data, "up")) {
			this.contentScroll = Math.max(0, this.contentScroll - 1);
		} else if (matchesKey(data, "down")) {
			this.contentScroll = Math.min(this.maxContentScroll(), this.contentScroll + 1);
		} else if (matchesKey(data, "pageUp")) {
			this.selected = Math.max(0, this.selected - 1);
			this.contentScroll = 0;
		} else if (matchesKey(data, "pageDown")) {
			this.selected = Math.min(this.pins.length - 1, this.selected + 1);
			this.contentScroll = 0;
		} else if (data === "g") {
			this.contentScroll = 0;
		} else if (data === "G") {
			this.contentScroll = this.maxContentScroll();
		}
	}

	render(width: number): string[] {
		const th = this.theme;
		const w = Math.max(30, Math.min(100, width - 2));
		const innerW = w - 2;
		const pad = (s: string) => s + " ".repeat(Math.max(0, innerW - visibleWidth(s)));
		const row = (c: string) =>
			th.fg("border", "│") + pad(truncateToWidth(c, innerW)) + th.fg("border", "│");
		const sep = th.fg("border", `├${"─".repeat(innerW)}┤`);

		const listRows = this.listRows();
		const contentRows = this.contentRows();

		const out: string[] = [th.fg("border", `╭${"─".repeat(innerW)}╮`)];
		out.push(row(th.fg("accent", `📌 ${this.pins.length} pin${this.pins.length === 1 ? "" : "s"}`)));
		out.push(sep);

		// Pin list, windowed around the selection
		const start = Math.max(
			0,
			Math.min(this.selected - Math.floor(listRows / 2), this.pins.length - listRows),
		);
		for (let i = start; i < start + listRows; i++) {
			const p = this.pins[i]!;
			const line = `${i === this.selected ? "❯" : " "} #${p.id} · ${p.label} · ${fmtTime(p.pinnedAt)}`;
			out.push(row(i === this.selected ? th.fg("accent", line) : th.fg("dim", line)));
		}
		out.push(sep);

		// Live content preview of the selected pin
		const pin = this.pins[this.selected]!;
		const lines = this.contentLines(pin, innerW);
		this.contentCount = lines.length;
		this.contentScroll = Math.min(this.contentScroll, this.maxContentScroll());
		const visible = lines.slice(this.contentScroll, this.contentScroll + contentRows);
		for (const l of visible) out.push(row(l));
		for (let i = visible.length; i < contentRows; i++) out.push(row(""));
		out.push(sep);

		const pos =
			lines.length <= contentRows
				? "all visible"
				: `${this.contentScroll + 1}–${Math.min(this.contentScroll + contentRows, lines.length)}/${lines.length}`;
		out.push(
			row(th.fg("dim", `↑↓ scroll · PgUp/PgDn pin · g/G · q/Esc close · #${pin.id} · ${pos}`)),
		);
		out.push(th.fg("border", `╰${"─".repeat(innerW)}╰`));
		return out;
	}
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	let pins: Pin[] = [];
	let nextId = 1;

	function persist(): void {
		pi.appendEntry(STATE_TYPE, { pins, nextId });
	}

	// Restore state from session (last pin-state entry in current branch wins)
	pi.on("session_start", async (_event, ctx) => {
		pins = [];
		nextId = 1;
		for (const entry of ctx.sessionManager.getBranch() as unknown as SessionEntryLike[]) {
			if (entry.type === "custom" && entry.customType === STATE_TYPE) {
				const d = (entry.data ?? {}) as { pins?: Pin[]; nextId?: number };
				pins = Array.isArray(d.pins) ? d.pins : [];
				nextId = typeof d.nextId === "number" ? d.nextId : pins.length + 1;
			}
		}
	});

	function recentAssistantMessages(ctx: ExtensionCommandContext): { text: string; ago: number }[] {
		const out: { text: string; ago: number }[] = [];
		const entries = ctx.sessionManager.getBranch() as unknown as SessionEntryLike[];
		let ago = 0;
		for (let i = entries.length - 1; i >= 0 && out.length < PICK_COUNT; i--) {
			const e = entries[i];
			if (e.type === "message" && e.message?.role === "assistant") {
				ago += 1;
				const text = extractText(e.message.content);
				if (text) out.push({ text, ago });
			}
		}
		return out;
	}

	function addPin(text: string, label: string | undefined, ctx: ExtensionCommandContext): void {
		const pin: Pin = {
			id: nextId++,
			label: label?.trim() || autoLabel(text),
			text,
			pinnedAt: Date.now(),
		};
		pins.push(pin);
		persist();
		ctx.ui.notify(`📌 Pinned as #${pin.id} "${pin.label}" — recall with /pin show ${pin.id}`, "info");
	}

	/** Open the interactive pin browser (list + live preview). */
	async function browse(ctx: ExtensionCommandContext, initialIndex: number): Promise<void> {
		if (!ctx.hasUI) return;
		if (pins.length === 0) {
			ctx.ui.notify("No pins yet — use /pin first", "warning");
			return;
		}
		await ctx.ui.custom<void>(
			(tui, theme, _kb, done) => {
				// Size from the real terminal height (visible-callback runs too late)
				const vp = Math.max(10, Math.floor(tui.terminal.rows * 0.8) - 6);
				return new PinBrowser(theme, pins, initialIndex, vp, () => done());
			},
			{
				overlay: true,
				overlayOptions: { width: "85%", maxHeight: "80%", anchor: "top-center", offsetY: 1 },
			},
		);
	}

	const HELP_LINES = [
		"pin commands:",
		"",
		"  /pin [label]   Pin the last assistant message (label = any free text)",
		"  /pin pick      Pick a recent message to pin",
		"  /pin show [n]  Browse pins (list + live preview), optionally at #n",
		"  /pin rm <n>    Remove pin #n",
		"  /pin clear     Remove all pins (IDs restart from 1)",
		"  /pin help      This help",
		"",
		"Browser keys: ↑↓ scroll content · PgUp/PgDn switch pin · g/G top/bottom · q/Esc close",
		"",
		"Pins persist in the session (survive /reload and restarts).",
	];

	const SUBCOMMANDS = [
		{ value: "pick", label: "pick", description: "Pick a recent message to pin" },
		{ value: "show", label: "show", description: "Browse pins (list + live preview)" },
		{ value: "rm", label: "rm", description: "Remove a pin" },
		{ value: "clear", label: "clear", description: "Remove all pins" },
		{ value: "help", label: "help", description: "Show help" },
	];

	pi.registerCommand("pin", {
		description: "Pin assistant messages and recall them in an overlay viewer (/pin help)",
		getArgumentCompletions: (prefix: string) => {
			const items = SUBCOMMANDS.filter((s) => s.value.startsWith(prefix));
			return items.length > 0 ? items : null;
		},
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const sub = parts[0]?.toLowerCase() ?? "";
			const rest = args.trim().slice(parts[0]?.length ?? 0).trim();

			// A first word matching a subcommand counts as one only when the
			// trailing args fit it; otherwise the whole input is a pin label.
			const SUBS_WITH_ARGS = new Set(["show", "rm"]);
			const isSub =
				SUBCOMMANDS.some((s) => s.value === sub) && (rest === "" || SUBS_WITH_ARGS.has(sub));

			if (isSub) {
				switch (sub) {
				case "help": {
					if (pins.length > 0) {
						await browse(ctx, 0);
					} else {
						ctx.ui.notify(HELP_LINES.join("\n"), "info");
					}
					return;
				}

				case "clear": {
					pins = [];
					nextId = 1;
					persist();
					ctx.ui.notify("All pins removed", "info");
					return;
				}

				case "rm": {
					const n = Number(rest);
					const pin = pins.find((p) => p.id === n);
					if (!pin) {
						ctx.ui.notify(rest ? `No pin #${rest}` : "Usage: /pin rm <n>", "error");
						return;
					}
					pins = pins.filter((p) => p.id !== n);
					persist();
					ctx.ui.notify(`Removed pin #${n} "${pin.label}"`, "info");
					return;
				}

				case "show": {
					let index = 0;
					if (rest) {
						index = pins.findIndex((p) => p.id === Number(rest));
						if (index < 0) {
							ctx.ui.notify(`No pin #${rest}`, "error");
							return;
						}
					}
					await browse(ctx, index);
					return;
				}

				case "pick": {
					const candidates = recentAssistantMessages(ctx);
					if (candidates.length === 0) {
						ctx.ui.notify("No assistant messages to pin", "warning");
						return;
					}
					const labelOf = (c: { text: string; ago: number }) =>
						`${c.ago === 1 ? "last" : `${c.ago} back`} · ${preview(c.text, 80)}`;
					const choice = await ctx.ui.select("Pin which message?", candidates.map(labelOf));
					if (!choice) return;
					const found = candidates.find((c) => labelOf(c) === choice);
					if (found) addPin(found.text, undefined, ctx);
					return;
				}

				}
				return;
			}

			// /pin [label] — pin the last assistant message. The label is free text
			// and may even start with subcommand words (e.g. "/pin list of plugins").
			const label = args.trim() || undefined;
			const last = recentAssistantMessages(ctx)[0];
			if (!last) {
				ctx.ui.notify("No assistant message to pin", "warning");
				return;
			}
			addPin(last.text, label, ctx);
		},
	});
}
