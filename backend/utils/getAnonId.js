// utils/getAnonId.js
export function getAnonId() {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("curriculate_anonId");
  if (!id) {
    id =
      "a_" +
      Math.random().toString(36).slice(2, 10) +
      "_" +
      Date.now().toString(36);
    localStorage.setItem("curriculate_anonId", id);
  }
  return id;
}