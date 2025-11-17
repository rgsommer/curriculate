// backend/scripts/socket_test.js
import { io } from "socket.io-client";

const SERVER = process.env.SERVER_URL || "http://localhost:4000";

async function run() {
  console.log("Socket test connecting to", SERVER);

  const socket = io(SERVER, {
    transports: ["websocket"],
    reconnectionAttempts: 2,
    timeout: 5000,
  });

  socket.on("connect", () => {
    console.log("connected", socket.id);
    // Try joining a room that likely doesn't exist to exercise error handling
    socket.emit("joinRoom", { code: "TESTCODE", role: "student", teamId: null });
  });

  socket.on("disconnect", (reason) => {
    console.log("disconnected:", reason);
  });

  socket.on("room:error", (payload) => {
    console.log("room:error ->", payload);
    socket.close();
  });

  socket.on("room:participantJoined", (payload) => {
    console.log("room:participantJoined ->", payload);
    socket.close();
  });

  socket.on("connect_error", (err) => {
    console.error("connect_error:", err.message || err);
    socket.close();
  });

  // Fallback timeout
  setTimeout(() => {
    if (socket.connected) {
      console.log("Test timeout — closing socket");
      socket.close();
    }
  }, 8000);
}

run().catch((err) => {
  console.error("Socket test failed:", err);
  process.exit(1);
});
