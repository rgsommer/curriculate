// teacher-app/src/socket.js
import { io } from "socket.io-client";
import { API_BASE_URL } from "./config";

export const socket = io(API_BASE_URL, {
  withCredentials: true,
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});

export default socket;
