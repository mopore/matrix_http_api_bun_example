const HS = process.env.MATRIX_HOMESERVER ?? "https://matrix.mopore.org";
const TOKEN = process.env.MATRIX_ACCESS_TOKEN ?? "";
const ROOM_ID = process.env.MATRIX_ROOM_ID ?? "";
const JNI = process.env.JNI_USER_ID ?? "@jni:matrix.mopore.org";
const STATE_FILE = process.env.MATRIX_STATE_FILE ?? "./matrix_state.json";

if (!TOKEN || !ROOM_ID) {
	throw new Error("Missing MATRIX_ACCESS_TOKEN or MATRIX_ROOM_ID");
}

type State = { since?: string };
type SyncResponse = {
	next_batch?: string;
	rooms?: {
		invite?: Record<string, unknown>;
		join?: Record<string, { timeline?: { events?: any[] } }>;
	};
};

const enc = encodeURIComponent;

async function api(path: string, init: RequestInit = {}) {
	const url = `${HS}${path}`;
	const headers = new Headers(init.headers);
	headers.set("Authorization", `Bearer ${TOKEN}`);
	if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

	const res = await fetch(url, { ...init, headers });
	const text = await res.text();

	if (!res.ok) {
		throw new Error(
			`HTTP ${res.status} ${res.statusText} for ${path}\n` + (text ? text.slice(0, 800) : "")
		);
	}

	return text ? JSON.parse(text) : null;
}

async function loadState(): Promise<State> {
	const f = Bun.file(STATE_FILE);
	if (!(await f.exists())) return {};
	try {
		return (await f.json()) as State;
	} catch {
		return {};
	}
}

async function saveState(state: State) {
	// Bun.write is the fast, idiomatic way to write files in Bun. :contentReference[oaicite:2]{index=2}
	await Bun.write(STATE_FILE, JSON.stringify(state, null, 2));
}

async function whoami(): Promise<string> {
	const data = (await api("/_matrix/client/v3/account/whoami")) as any;
	return data.user_id as string;
}

async function sendText(roomId: string, body: string) {
	const txnId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
	// IMPORTANT: This endpoint is PUT, not POST. :contentReference[oaicite:3]{index=3}
	await api(
		`/_matrix/client/v3/rooms/${enc(roomId)}/send/m.room.message/${enc(txnId)}`,
		{
			method: "PUT",
			body: JSON.stringify({ msgtype: "m.text", body }),
		}
	);
}

async function joinRoom(roomIdOrAlias: string) {
	await api(`/_matrix/client/v3/join/${enc(roomIdOrAlias)}`, { method: "POST" });
}

async function syncOnce(since?: string, timeoutMs = 30000): Promise<SyncResponse> {
	const filter = {
		room: { timeline: { types: ["m.room.message"], limit: 20 } },
	};

	const params = new URLSearchParams();
	if (since) params.set("since", since);
	params.set("timeout", String(timeoutMs));
	params.set("set_presence", "offline");
	params.set("filter", JSON.stringify(filter));

	return (await api(`/_matrix/client/v3/sync?${params.toString()}`)) as SyncResponse;
}

(async () => {
	const me = await whoami();
	console.log(`Logged in as ${me}`);

	const state = await loadState();

	// Bootstrap "since" without processing backlog.
	if (!state.since) {
		const boot = await syncOnce(undefined, 0);
		state.since = boot.next_batch;
		await saveState(state);
		console.log("Bootstrapped sync token.");
	}

	await sendText(ROOM_ID, "Bun fetch-bot online. Say something, jni.");

	const seen = new Set<string>();

	while (true) {
		try {
			const s = await syncOnce(state.since, 30000);

			if (s.next_batch) {
				state.since = s.next_batch;
				await saveState(state);
			}

			// Auto-join any invited rooms (optional)
			for (const rid of Object.keys(s.rooms?.invite ?? {})) {
				console.log(`Invited to ${rid}, joining...`);
				await joinRoom(rid);
			}

			const room = s.rooms?.join?.[ROOM_ID];
			const events = room?.timeline?.events ?? [];

			for (const ev of events) {
				const eventId = ev?.event_id as string | undefined;
				if (!eventId || seen.has(eventId)) continue;
				seen.add(eventId);

				if (ev?.type !== "m.room.message") continue;
				const content = ev?.content;
				if (content?.msgtype !== "m.text") continue;

				const sender = ev?.sender as string;
				const body = content?.body as string;

				if (sender === me) continue;

				console.log(`[${ROOM_ID}] ${sender}: ${body}`);

				if (sender === JNI) {
					await sendText(ROOM_ID, `Ack jni. You said: "${body}"`);
				}
			}
		} catch (err) {
			console.error("Loop error:", err);
			await new Promise((r) => setTimeout(r, 2000));
		}
	}
})();
