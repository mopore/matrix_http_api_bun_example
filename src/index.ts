import * as matrixApi from "./matrixHttpApi.ts";

const mainAsync = async (): Promise<void> => {
	const SERVER_URL = process.env.MATRIX_HOMESERVER ?? "https://matrix.mopore.org";
	const ROOM_ID = process.env.MATRIX_ROOM_ID ?? "";
	const HUMAN_ID = process.env.MATRIX_USER_ID ?? "@jni:matrix.mopore.org";
	const BOT_TOKEN = process.env.MATRIX_BOT_ACCESS_TOKEN ?? "";

	if (!BOT_TOKEN || !ROOM_ID) {
		throw new Error("Missing MATRIX_BOT_ACCESS_TOKEN or MATRIX_ROOM_ID");
	}

	const state = {
		stayAlive: true,
	}

	await matrixApi.initAsync({
		homeserver: SERVER_URL,
		botAccessToken: BOT_TOKEN,
		roomId: ROOM_ID,
		humanUserId: HUMAN_ID,
		onHumanMessage: async (message, sender) => {
			console.log(`[message] ${sender}: ${message}`);
			await matrixApi.sendMessageAsync(`Ack: "${message}"`);
		},
		onExit: async () => {
			console.log("'exit' received from user");
			await matrixApi.sendMessageAsync("Received your 'exit'");
			state.stayAlive = false;
		},
		onError: (error) => {
			console.error("Matrix error:", error);
		},
	});
	await matrixApi.sendMessageAsync("Matrix Bot is online. Say something, jni.");

	let i = 0;
	while (state.stayAlive) {
		console.log(`Example count: ${++i}`);
		await new Promise((r) => setTimeout(r, 1000));
	}
	console.log("End of main loop");
}

void mainAsync()
