import { io } from "socket.io-client";

const socket = io("http://127.0.0.1:3000");

socket.on("connect", () => {
    console.log("Connected to server");
    socket.emit("create_room", { username: "Tester", gameType: "quiz" }, (res) => {
        if (res.success) {
            console.log("Room created:", res.roomCode);
            socket.emit("start_game", res.roomCode);
        } else {
            console.error("Failed to create room", res.error);
        }
    });
});

socket.on("room_update", (room) => {
    console.log("Room updated:", room.state);
    if (room.state === "playing") {
        console.log("Game started successfully!");
        process.exit(0);
    }
});

socket.on("disconnect", () => {
    console.log("Disconnected from server");
    process.exit(1);
});
