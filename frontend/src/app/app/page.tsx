"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";

// ─────────────────────────────────────────────────────────────────────────
// Curriculate Student — download landing page (/app)
//
// Single canonical download link used by in-app nudges and report emails.
// Detects the visitor's device and highlights the matching store, but always
// shows both. The store URLs live ONLY here, so nudges/emails just point to
// curriculate.net/app and never need updating when a store link changes.
//
// To activate the App Store badge once the iOS app is approved, set
// APP_STORE_ID to the app's numeric Apple ID (App Store Connect → App
// Information → "Apple ID"). Until then the iOS button shows "Coming soon".
// ─────────────────────────────────────────────────────────────────────────

const PLAY_URL =
  "https://play.google.com/store/apps/details?id=net.curriculate.student";

// Numeric Apple ID (e.g. "6501234567"). Empty string ⇒ "Coming soon".
const APP_STORE_ID = "";
const APP_STORE_URL = APP_STORE_ID
  ? `https://apps.apple.com/app/id${APP_STORE_ID}`
  : "";

type Platform = "ios" | "android" | "other";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  // iPadOS 13+ reports as Mac; disambiguate by touch support
  if (/Macintosh/i.test(ua) && "ontouchend" in document) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "other";
}

function GooglePlayLogo() {
  return (
    <svg width="22" height="22" viewBox="0 0 512 512" aria-hidden="true">
      <path fill="#00D3FF" d="M47 24 300 256 47 488c-9-5-15-15-15-27V51c0-12 6-22 15-27z" />
      <path fill="#00F076" d="M47 24c7-4 16-4 24 1l278 160-49 71z" />
      <path fill="#FFCE00" d="M373 185l60 34c20 12 20 42 0 54l-60 34-49-59z" />
      <path fill="#FF3A44" d="M47 488l253-161 49 59-278 160c-8 5-17 5-24 1z" />
    </svg>
  );
}

function AppleLogo() {
  return (
    <svg width="22" height="22" viewBox="0 0 384 512" aria-hidden="true">
      <path
        fill="currentColor"
        d="M318 268c-1-58 47-86 49-88-27-39-68-45-83-45-35-4-69 21-87 21s-45-20-75-20c-38 1-74 22-93 57-40 69-10 171 28 227 19 27 41 58 70 57 28-1 39-18 73-18s43 18 73 17c30 0 49-28 67-55 21-31 30-61 30-63-1-1-58-22-58-90zM262 84c15-19 26-45 23-71-22 1-49 15-65 34-14 16-27 43-24 68 25 2 50-13 66-31z"
      />
    </svg>
  );
}

export default function AppDownloadPage() {
  const [platform, setPlatform] = useState<Platform>("other");
  useEffect(() => setPlatform(detectPlatform()), []);

  const playFirst = platform !== "ios";

  const PlayButton = (
    <a
      href={PLAY_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-center gap-3 rounded-2xl bg-neutral-900 px-6 py-4 text-white shadow-lg ring-1 ring-white/10 transition hover:bg-neutral-800 hover:shadow-xl"
    >
      <GooglePlayLogo />
      <span className="text-left leading-tight">
        <span className="block text-[11px] uppercase tracking-wide opacity-80">
          Get it on
        </span>
        <span className="block text-lg font-semibold">Google Play</span>
      </span>
    </a>
  );

  const AppStoreButton = APP_STORE_URL ? (
    <a
      href={APP_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-center gap-3 rounded-2xl bg-neutral-900 px-6 py-4 text-white shadow-lg ring-1 ring-white/10 transition hover:bg-neutral-800 hover:shadow-xl"
    >
      <AppleLogo />
      <span className="text-left leading-tight">
        <span className="block text-[11px] uppercase tracking-wide opacity-80">
          Download on the
        </span>
        <span className="block text-lg font-semibold">App Store</span>
      </span>
    </a>
  ) : (
    <div
      className="flex cursor-default items-center justify-center gap-3 rounded-2xl bg-neutral-200 px-6 py-4 text-neutral-500 ring-1 ring-black/5"
      aria-disabled="true"
    >
      <AppleLogo />
      <span className="text-left leading-tight">
        <span className="block text-[11px] uppercase tracking-wide opacity-80">
          Coming soon to the
        </span>
        <span className="block text-lg font-semibold">App Store</span>
      </span>
    </div>
  );

  return (
    <main className="relative overflow-hidden">
      {/* Crue-orange background */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-orange-400 via-orange-500 to-orange-600" />

      <div className="mx-auto flex min-h-[70vh] max-w-2xl flex-col items-center justify-center px-6 py-16 text-center">
        <Image
          src="/images/curriculate-app-icon.png"
          alt="Curriculate Student app icon"
          width={128}
          height={128}
          priority
          className="rounded-[28px] shadow-2xl ring-1 ring-black/5"
        />

        <h1 className="mt-8 text-4xl font-extrabold tracking-tight text-white sm:text-5xl">
          Get the Curriculate app
        </h1>
        <p className="mt-4 max-w-md text-lg text-white/90">
          Join your class&rsquo;s live games with a room code — play interactive
          task stations on iPhone, iPad, and Android. No account needed.
        </p>

        <div className="mt-10 flex w-full max-w-sm flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center">
          {playFirst ? (
            <>
              {PlayButton}
              {AppStoreButton}
            </>
          ) : (
            <>
              {AppStoreButton}
              {PlayButton}
            </>
          )}
        </div>

        <p className="mt-8 text-sm text-white/80">
          Prefer your browser?{" "}
          <a
            href="https://play.curriculate.net"
            className="font-semibold text-white underline underline-offset-2 hover:opacity-90"
          >
            Play at play.curriculate.net
          </a>
        </p>
      </div>
    </main>
  );
}
