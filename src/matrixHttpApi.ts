/**
 * Matrix HTTP API module
 * Handles communication with Matrix homeserver via direct HTTP API calls.
 */

// --- Types ---

type WhoamiResponse = { user_id: string };

type MatrixEvent = {
	event_id?: string;
	type?: string;
	sender?: string;
	content?: {
		msgtype?: string;
		body?: string;
	};
};

type SyncResponse = {
	next_batch?: string;
	rooms?: {
		invite?: Record<string, unknown>;
		join?: Record<string, { timeline?: { events?: MatrixEvent[] } }>;
	};
};

export type MessageCallback = (message: string, sender: string) => void | Promise<void>;

export type ErrorCallback = (error: Error) => void;

export type ExitCallback = () => void | Promise<void>;

export type MatrixClientConfig = {
	homeserver: string;
	botAccessToken: string;
	roomId: string;
	humanUserId: string;
	onHumanMessage?: MessageCallback;
	onError?: ErrorCallback;
	onExit?: ExitCallback;
};

// --- Module State ---

const MAX_SEEN = 1000;

let config: MatrixClientConfig | null = null;
let since: string | undefined;
let messageCallback: MessageCallback | null = null;
let errorCallback: ErrorCallback | null = null;
let exitCallback: ExitCallback | null = null;
let botUserId: string | null = null;
let running = false;
const seen = new Set<string>();

const enc = encodeURIComponent;

// --- Internal Functions ---

const apiAsync = async (path: string, init: RequestInit = {}): Promise<unknown> => {
	if (!config) throw new Error("Matrix client not initialized");

	const url = `${config.homeserver}${path}`;
	const headers = new Headers(init.headers);
	headers.set("Authorization", `Bearer ${config.botAccessToken}`);
	const hasBody = init.body !== undefined && init.body !== null;
	const needsContentType = hasBody && !headers.has("Content-Type");
	if (needsContentType) {
		headers.set("Content-Type", "application/json");
	}

	const res = await fetch(url, { ...init, headers });
	const text = await res.text();

	if (!res.ok) {
		throw new Error(
			`HTTP ${res.status} ${res.statusText} for ${path}\n` + (text ? text.slice(0, 800) : "")
		);
	}

	return text ? JSON.parse(text) : null;
};

const whoamiAsync = async (): Promise<string> => {
	const data = (await apiAsync("/_matrix/client/v3/account/whoami")) as WhoamiResponse;
	return data.user_id;
};

const syncOnceAsync = async (sinceToken?: string, timeoutMs = 30000): Promise<SyncResponse> => {
	const filter = {
		room: { timeline: { types: ["m.room.message"], limit: 20 } },
	};

	const params = new URLSearchParams();
	if (sinceToken) params.set("since", sinceToken);
	params.set("timeout", String(timeoutMs));
	params.set("set_presence", "offline");
	params.set("filter", JSON.stringify(filter));

	return (await apiAsync(`/_matrix/client/v3/sync?${params.toString()}`)) as SyncResponse;
};

const joinRoomAsync = async (roomIdOrAlias: string): Promise<void> => {
	await apiAsync(`/_matrix/client/v3/join/${enc(roomIdOrAlias)}`, { method: "POST" });
};

/**
 * Stop the sync loop.
 */
export const stop = (): void => {
	running = false;
};

const shutdownAsync = async (): Promise<void> => {
	console.log("Shutdown signal received");
	if (exitCallback) {
		await exitCallback();
	}
	stop();
};

const handleExitAsync = async (): Promise<void> => {
	if (exitCallback) {
		await exitCallback();
	}
	stop();
};

const evictOldSeen = (): void => {
	if (seen.size > MAX_SEEN) {
		const toDelete = seen.size - MAX_SEEN;
		let count = 0;
		for (const id of seen) {
			if (count++ >= toDelete) break;
			seen.delete(id);
		}
	}
};

const processEventsAsync = async (events: MatrixEvent[]): Promise<void> => {
	if (!config || !botUserId) return;

	for (const ev of events) {
		const eventId = ev.event_id;
		if (!eventId || seen.has(eventId)) continue;
		seen.add(eventId);
		evictOldSeen();

		if (ev.type !== "m.room.message") continue;
		if (ev.content?.msgtype !== "m.text") continue;

		const sender = ev.sender;
		const body = ev.content.body;

		if (!sender || !body) continue;
		if (sender === botUserId) continue;

		// Only process messages from the configured human
		if (sender === config.humanUserId) {
			// Intercept "exit" command - do not trigger onHumanMessage
			if (body.toLowerCase() === "exit") {
				await handleExitAsync();
				return;
			}

			// Trigger callback for other messages
			if (messageCallback) {
				await messageCallback(body, sender);
			}
		}
	}
};

const syncLoopAsync = async (): Promise<void> => {
	if (!config) return;

	while (running) {
		try {
			const s = await syncOnceAsync(since, 30000);

			if (s.next_batch) {
				since = s.next_batch;
			}

			// Auto-join invited rooms
			for (const rid of Object.keys(s.rooms?.invite ?? {})) {
				console.log(`Invited to ${rid}, joining...`);
				await joinRoomAsync(rid);
			}

			const room = s.rooms?.join?.[config.roomId];
			const events = room?.timeline?.events ?? [];
			await processEventsAsync(events);
		} catch (err) {
			const error = err instanceof Error ? err : new Error(String(err));
			console.error("Sync loop error:", error);
			if (errorCallback) {
				errorCallback(error);
			}
			await new Promise((r) => setTimeout(r, 2000));
		}
	}
};

const loopInBackground = (): void => {
	if (running) return;
	running = true;
	// Fire and forget - runs concurrently via event loop
	void syncLoopAsync();
};

// --- Public API ---

/**
 * Initialize the Matrix client with configuration.
 * Automatically starts the sync loop in the background.
 */
export const initAsync = async (cfg: MatrixClientConfig): Promise<void> => {
	config = { ...cfg };

	// Register callbacks from config before starting loop
	if (cfg.onHumanMessage) {
		messageCallback = cfg.onHumanMessage;
	}
	if (cfg.onError) {
		errorCallback = cfg.onError;
	}
	if (cfg.onExit) {
		exitCallback = cfg.onExit;
	}

	botUserId = await whoamiAsync();
	console.log(`Logged in as ${botUserId}`);

	// Always bootstrap fresh on startup
	const boot = await syncOnceAsync(undefined, 0);
	since = boot.next_batch;
	console.log("Bootstrapped sync token.");

	// Register signal handlers for graceful shutdown
	process.on("SIGTERM", () => {
		void shutdownAsync();
	});
	process.on("SIGINT", () => {
		void shutdownAsync();
	});

	loopInBackground();
};

/**
 * Register a callback for messages from the configured human user.
 * Note: "exit" messages are intercepted and will not trigger this callback.
 */
export const onHumanMessage = (callback: MessageCallback): void => {
	messageCallback = callback;
};

/**
 * Register a callback for errors in the sync loop.
 */
export const onError = (callback: ErrorCallback): void => {
	errorCallback = callback;
};

/**
 * Register a callback that fires when the human sends "exit" or on SIGTERM/SIGINT.
 * After this callback completes, the sync loop will stop.
 */
export const onExit = (callback: ExitCallback): void => {
	exitCallback = callback;
};

/**
 * Send a text message to the configured room.
 */
export const sendMessageAsync = async (message: string): Promise<void> => {
	if (!config) throw new Error("Matrix client not initialized");

	const txnId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
	await apiAsync(
		`/_matrix/client/v3/rooms/${enc(config.roomId)}/send/m.room.message/${enc(txnId)}`,
		{
			method: "PUT",
			body: JSON.stringify({ msgtype: "m.text", body: message }),
		}
	);
};

/**
 * Get the bot's user ID.
 */
export const getBotUserId = (): string | null => botUserId;
