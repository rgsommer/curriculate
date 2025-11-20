import React, { useEffect, useState } from "react";
import { io } from "socket.io-client";

export default function PlaySession({
  server = "http://localhost:4000",
  code,
  teamId,
}) {
  const [socket, setSocket] = useState(null);
  const [task, setTask] = useState(null);
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState("Waiting for task...");

  useEffect(() => {
    const s = io(server, { transports: ["websocket"] });
    setSocket(s);

    s.on("connect", () => {
      s.emit("joinRoom", { code, role: "student", teamId });
    });

    s.on("task:started", (payload) => {
      setTask(payload.task);
      setAnswer("");
      setStatus("Task started");
    });

    s.on("submission:received", (payload) => {
      setStatus(payload.isCorrect ? "Correct!" : "Submitted");
    });

    s.on("room:error", (e) => setStatus(`Error: ${e.message}`));

    return () => s.disconnect();
  }, [server, code, teamId]);

  function submit() {
    if (!socket || !task) return;
    setStatus("Submitting...");
    socket.emit("student:submitAnswer", {
      code,
      teamId,
      taskIndex: task.index ?? 0,
      answer,
      responseTimeMs: 0,
    });
  }

  return (
    <div style={styles.container}>
      <h1 style={styles.teamHeader}>Team {teamId}</h1>

      <div style={styles.card}>
        <h2 style={styles.taskHeader}>Current Task</h2>

        {task ? (
          <>
            <p style={styles.prompt}>{task.title || task.prompt}</p>
            <input
              style={styles.input}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Enter answer"
            />
            <button style={styles.button} onClick={submit}>
              Submit
            </button>
          </>
        ) : (
          <p style={styles.prompt}>Waiting for task...</p>
        )}

        <div style={styles.status}>{status}</div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: "100vh",
    background: "#f0f5ff",
    padding: "20px",
    fontFamily: "Arial, sans-serif",
  },
  teamHeader: {
    textAlign: "center",
    marginBottom: "20px",
    fontSize: "28px",
  },
  card: {
    maxWidth: "600px",
    margin: "0 auto",
    background: "#fff",
    padding: "20px",
    borderRadius: "12px",
    boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
  },
  taskHeader: {
    textAlign: "center",
  },
  prompt: {
    fontSize: "20px",
    marginBottom: "20px",
  },
  input: {
    width: "100%",
    padding: "12px",
    marginBottom: "20px",
    borderRadius: "8px",
    border: "1px solid #ccc",
    fontSize: "18px",
  },
  button: {
    width: "100%",
    padding: "14px",
    background: "#1e88e5",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    fontSize: "18px",
    cursor: "pointer",
    marginBottom: "20px",
  },
  status: {
    textAlign: "center",
    fontSize: "18px",
    color: "#555",
  },
};
