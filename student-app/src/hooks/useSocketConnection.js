// student-app/src/hooks/useSocketConnection.js
import { useState, useEffect } from "react";

/**
 * Hook for managing socket.io connection state
 * Takes a socket instance and returns connection status and message
 */
export function useSocketConnection(socket) {
  const [connected, setConnected] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    const handleConnect = () => {
      setConnected(true);
      setStatusMessage("");
    };

    const handleDisconnect = () => {
      setConnected(false);
      setStatusMessage("Disconnected from server. Trying to reconnect…");
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", (err) => {
      console.error("Socket connection error:", err);
      setStatusMessage("Error connecting. Retrying…");
    });

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error");
    };
  }, [socket]);

  return { connected, setConnected, statusMessage, setStatusMessage };
}
