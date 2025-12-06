// frontend/src/lib/api.ts  (or wherever you make fetch calls)
const API_URL = process.env.NODE_ENV === "production" 
  ? "https://curriculate-api.onrender.com" 
  : "http://localhost:4000";