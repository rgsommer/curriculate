"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/campfire/AuthProvider";
import {
  useEngagement,
  useRealtimeEngagement,
  useCreateEngagement,
} from "@/lib/campfire/hooks";
import { ENGAGEMENT_TYPES, resolveTitle, engagementIcon, parseCareQuestions, formatMoney, GIFT_CURRENCIES, localeGiftCurrency } from "@/lib/campfire/types";
import type { CampfireGift } from "@/lib/campfire/types";
import { supabase } from "@/lib/campfire/supabase";
import { hasProfanity } from "@/lib/campfire/profanity";

// ── Canvas helpers for the shareable results card ──
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const words = text.split(/\s+/);
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      y += lineHeight;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) {
    ctx.fillText(line, x, y);
    y += lineHeight;
  }
  return y;
}

export default function EngagementDetailPage() {
  const params = useParams();
  const groupId = params.id as string;
  const engagementId = params.engId as string;
  const router = useRouter();
  const { user, session } = useAuth();

  const {
    engagement,
    responses,
    reactions,
    comments,
    ratings,
    myResponse,
    responseCount,
    lieGuesses,
    lieAnswers,
    revealAnswer,
    views,
    careAnswers: careAnswerRows,
    loading,
    submitResponse,
    submitCareAnswers,
    submitTwoTruths,
    submitLieGuess,
    submitAuthorGuess,
    revealLiesNow,
    setRevealAnswer,
    addReaction,
    addRating,
    addComment,
    sendNudge,
    revealNow,
    unrevealEngagement,
    setPaused,
    setHoldUntilDeadline,
    setWaitForAllInvited,
    launchEngagement,
    deleteEngagement,
    removeResponse,
    reportResponse,
    refresh,
  } = useEngagement(engagementId);

  // Real-time: refresh quietly (no loading flash) when anything changes. The
  // realtime hook already debounces bursts into a single call.
  const handleRealtimeUpdate = useCallback(() => {
    refresh({ silent: true });
  }, [refresh]);
  useRealtimeEngagement(engagementId, handleRealtimeUpdate);

  // For the "Duplicate" action — create a copy in this same group.
  const { create: createEngagement } = useCreateEngagement(groupId);
  const [duplicating, setDuplicating] = useState(false);
  const [pausing, setPausing] = useState(false);

  // Invite context for a truer progress picture (host-only — RLS limits reads
  // to the group admin, so non-admins simply get zeros and see nothing extra).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("campfire_invitations")
        .select("email, name, status")
        .eq("group_id", groupId)
        // Whole-group invites (engagement_id null) + this card's own guest invites.
        .or(`engagement_id.is.null,engagement_id.eq.${engagementId}`);
      // Member-safe pending count (works for everyone, returns a number only).
      const { data: pc } = await supabase.rpc("pending_invite_count", { _gid: groupId });
      // Group name + code for the per-engagement invite link (members can read).
      const { data: g } = await supabase
        .from("groups")
        .select("name, invite_code")
        .eq("id", groupId)
        .maybeSingle();
      if (!cancelled) {
        if (data) {
          setInviteStats({
            joined: data.filter((r) => r.status === "joined").length,
            pending: data.filter((r) => r.status === "pending").length,
          });
          setPendingInvitees(
            data
              .filter((r) => r.status === "pending")
              .map((r) => ({ email: r.email as string, name: (r.name as string) ?? null }))
          );
          setAllInvitees(
            data
              .filter((r) => r.status !== "revoked")
              .map((r) => ({
                email: r.email as string,
                name: (r.name as string) ?? null,
                joined: r.status === "joined",
              }))
          );
        }
        setPendingCount((pc as number) ?? 0);
        if (g) setGroupInfo(g as { name: string; invite_code: string });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId, responseCount]);

  // Local UI state
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [textInput, setTextInput] = useState("");
  // Open-ended poll: free-text answer per question (keyed by question index).
  const [openPollAnswers, setOpenPollAnswers] = useState<Record<number, string>>({});
  // Truth or Dare: which one the responder picked + an optional photo (proof).
  const [todMode, setTodMode] = useState<"truth" | "dare" | null>(null);
  const [todPhoto, setTodPhoto] = useState<string | null>(null);
  const [todUploading, setTodUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Bumped after we confirm a returning Stripe contribution, to refetch totals.
  const [confirmTick, setConfirmTick] = useState(0);
  // On return from Stripe checkout (?cs=<session>), confirm the payment directly so
  // the contribution flips to paid even if the webhook isn't set up.
  useEffect(() => {
    if (typeof window === "undefined" || !engagementId) return;
    const qs = new URLSearchParams(window.location.search);
    const cs = qs.get("cs");
    if (!cs) return;
    (async () => {
      try {
        await fetch("/api/campfire/gift/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: cs }),
        });
      } catch {
        /* webhook may still confirm it */
      }
      qs.delete("cs");
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (qs.toString() ? `?${qs}` : "")
      );
      setConfirmTick((t) => t + 1);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagementId]);
  // Group gift: running total + chip-in state.
  const [giftSummary, setGiftSummary] = useState<{
    total_cents: number;
    contributors: number;
  } | null>(null);
  const [chippingIn, setChippingIn] = useState(false);
  // Member-initiated gift on a Sign-up: start a chip-in for one guest.
  const [showStartGift, setShowStartGift] = useState(false);
  const [startGiftName, setStartGiftName] = useState("");
  const [startGiftEmail, setStartGiftEmail] = useState("");
  const [startGiftCurrency, setStartGiftCurrency] = useState("usd");
  const [startGiftSurpriseUid, setStartGiftSurpriseUid] = useState(""); // hide from this member
  const [startingGift, setStartingGift] = useState(false);
  const [sendingGift, setSendingGift] = useState(false);
  useEffect(() => setStartGiftCurrency(localeGiftCurrency()), []);
  const [signupBusy, setSignupBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [extraInput, setExtraInput] = useState(""); // member "I'm bringing…" text
  const [hostSlotLabel, setHostSlotLabel] = useState(""); // host: type a new list item
  const [hostSlotCount, setHostSlotCount] = useState(1);
  useEffect(() => {
    if (!engagement?.gift_enabled || !engagementId) {
      setGiftSummary(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.rpc("gift_contribution_summary", {
        _eid: engagementId,
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (!cancelled && row)
        setGiftSummary({
          total_cents: row.total_cents ?? 0,
          contributors: row.contributors ?? 0,
        });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engagement?.gift_enabled, engagementId, responses.length, confirmTick]);

  // Sign-up chip-ins: a list of gifts on this engagement + each one's paid total.
  const [gifts, setGifts] = useState<CampfireGift[]>([]);
  const [giftTotals, setGiftTotals] = useState<
    Record<string, { total_cents: number; contributors: number }>
  >({});
  const isSignup = engagement?.type === "signup";
  const refreshGifts = useCallback(async () => {
    if (!isSignup || !engagementId) {
      setGifts([]);
      setGiftTotals({});
      return;
    }
    const { data: rows } = await supabase
      .from("campfire_gifts")
      .select("*")
      .eq("engagement_id", engagementId)
      .order("created_at", { ascending: true });
    setGifts((rows as CampfireGift[]) ?? []);
    const { data: sums } = await supabase.rpc("gift_summaries_for_engagement", {
      _eid: engagementId,
    });
    const map: Record<string, { total_cents: number; contributors: number }> = {};
    (Array.isArray(sums) ? sums : []).forEach(
      (s: { gift_id: string; total_cents: number; contributors: number }) => {
        map[s.gift_id] = {
          total_cents: s.total_cents ?? 0,
          contributors: s.contributors ?? 0,
        };
      }
    );
    setGiftTotals(map);
  }, [isSignup, engagementId]);
  useEffect(() => {
    refreshGifts();
  }, [refreshGifts, responses.length, confirmTick]);

  // Gift exchange (Secret Santa): each buyer can read only their OWN assignment.
  const [myGiftexAssignment, setMyGiftexAssignment] = useState<{
    recipient_user_id?: string | null;
    buy_for_gender?: string | null;
  } | null>(null);
  const [giftexBusy, setGiftexBusy] = useState(false);
  const giftexCfg = (engagement?.config?.giftex ?? null) as {
    on?: boolean;
    byGender?: boolean;
    assign?: "self" | "person" | "gender";
  } | null;
  const giftexOn = !!giftexCfg?.on;
  const refreshMyAssignment = useCallback(async () => {
    if (!giftexOn || !engagementId || !user) {
      setMyGiftexAssignment(null);
      return;
    }
    const { data } = await supabase
      .from("campfire_giftex_assignments")
      .select("recipient_user_id, buy_for_gender")
      .eq("engagement_id", engagementId)
      .eq("buyer_user_id", user.id)
      .maybeSingle();
    setMyGiftexAssignment(data ?? null);
  }, [giftexOn, engagementId, user]);
  useEffect(() => {
    refreshMyAssignment();
  }, [refreshMyAssignment, responses.length]);

  // Card read-receipt: when the recipient opens their revealed card, record it once
  // so the host can see it landed. (Hooks live above the early returns — use plain
  // optional chaining, not the derived isRecipient/isRevealed below.)
  const [thanksSending, setThanksSending] = useState(false);
  const [thanksMsg, setThanksMsg] = useState("");
  const [showThanks, setShowThanks] = useState(false);
  useEffect(() => {
    if (
      session &&
      user &&
      engagementId &&
      engagement?.type === "birthday" &&
      engagement?.status === "revealed" &&
      ((engagement?.excluded_user_ids as string[] | undefined) ?? []).includes(
        user.id
      ) &&
      !(engagement?.config as { cardViewedAt?: string } | null)?.cardViewedAt
    ) {
      fetch("/api/campfire/card/viewed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ engagementId }),
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    engagement?.status,
    engagement?.type,
    engagementId,
    user,
    session,
  ]);

  // Editing an already-submitted answer (before the reveal).
  const [editingResponse, setEditingResponse] = useState(false);
  // Host view: user_ids that have responded so far (names resolved below).
  const [responders, setResponders] = useState<string[]>([]);
  // Two Truths & a Lie entry state
  const [ttStatements, setTtStatements] = useState(["", "", ""]);
  const [ttLie, setTtLie] = useState<number | null>(null);
  // "Most Likely To…" — the group roster (candidates) and this user's votes
  const [roster, setRoster] = useState<{ user_id: string; name: string }[]>([]);
  const [mlVotes, setMlVotes] = useState<Record<number, string>>({});
  // Accountability: 1–5 self-rating per question + an optional note to the group
  const [acRatings, setAcRatings] = useState<Record<number, number>>({});
  const [acNote, setAcNote] = useState("");
  // Scavenger Hunt: per-item { text, photo } + which item is uploading
  const [shItems, setShItems] = useState<Record<number, { text?: string; photo?: string }>>({});
  const [shUploading, setShUploading] = useState<number | null>(null);
  // Care Check-in: free text / star per section (fill any/all)
  const [careAnswers, setCareAnswers] = useState<Record<number, string | number>>({});
  // Care Check-in: per-question visibility — each prompt is host-only / shared / anon.
  // Empty until the person picks; a question with no entry follows the host default.
  type CareVis = "host" | "group" | "anon";
  const [careVis, setCareVis] = useState<Record<number, CareVis>>({});
  // Group roster with per-group names ("Dad" / "Mr. Sommer") — used as the
  // Most Likely candidate list AND to resolve everyone's name on this page.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("group_members")
        .select("user_id, display_name, profile:profiles(display_name)")
        .eq("group_id", groupId);
      if (!cancelled && data) {
        const list = (
          data as {
            user_id: string;
            display_name: string | null;
            profile: { display_name: string } | { display_name: string }[] | null;
          }[]
        ).map((m) => {
          const p = Array.isArray(m.profile) ? m.profile[0] : m.profile;
          return { user_id: m.user_id, name: m.display_name || p?.display_name || "Someone" };
        });
        setRoster(list);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId]);
  const [commentText, setCommentText] = useState("");
  const [commentAnon, setCommentAnon] = useState(false);
  const [showRevealAnimation, setShowRevealAnimation] = useState(false);
  const [justRevealed, setJustRevealed] = useState(false);
  const prevStatusRef = useRef<string | null>(null);

  // Media upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // Photo challenge: up to 3 photos/videos per response.
  const [mediaItems, setMediaItems] = useState<{ url: string; type: string }[]>([]);
  const [resendingReveal, setResendingReveal] = useState(false);

  // Creator edit state
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editRecurrence, setEditRecurrence] = useState<"none" | "daily" | "weekly" | "monthly">("none");
  const [editDeadline, setEditDeadline] = useState(""); // YYYY-MM-DD (birthday date)
  const [editBirthYear, setEditBirthYear] = useState("");
  const [editDeadlineTime, setEditDeadlineTime] = useState(""); // datetime-local (reveal/deadline)
  const [editCareQuestions, setEditCareQuestions] = useState<
    { prompt: string; kind: "text" | "star" }[]
  >([]);
  // Truth or Dare prompts (host-defined).
  const [editTruthPrompt, setEditTruthPrompt] = useState("");
  const [editDarePrompt, setEditDarePrompt] = useState("");
  // Poll: editable format + options (lets a host convert an options poll to open).
  const [editPollFormat, setEditPollFormat] = useState<
    "multiple" | "yes_no" | "open"
  >("multiple");
  const [editPollOptions, setEditPollOptions] = useState<string[]>([]);
  // Group gift — enable/disable + recipient on an existing engagement.
  const [editGiftEnabled, setEditGiftEnabled] = useState(false);
  const [editGiftShowTotal, setEditGiftShowTotal] = useState(true); // total to all?
  const [editGiftRecipientEmail, setEditGiftRecipientEmail] = useState("");
  const [editGiftRecipientName, setEditGiftRecipientName] = useState("");
  const [editGiftCurrency, setEditGiftCurrency] = useState("usd");
  const [editLeadDays, setEditLeadDays] = useState(14); // how many days before it opens
  const [editAllowMemberInvites, setEditAllowMemberInvites] = useState(false);
  const [editExcludedIds, setEditExcludedIds] = useState<string[]>([]);
  const [editExcludedEmails, setEditExcludedEmails] = useState<string[]>([]);
  const [addRecipEmail, setAddRecipEmail] = useState(""); // add a recipient by email
  const [pendingInvitees, setPendingInvitees] = useState<{ email: string; name: string | null }[]>([]);
  // All non-revoked invitees (pending OR joined) — the card recipient picker shows
  // these so an email-invited person is selectable even if they're not in the roster.
  const [allInvitees, setAllInvitees] = useState<
    { email: string; name: string | null; joined: boolean }[]
  >([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [justLaunched, setJustLaunched] = useState(false);
  const [justLaunchedQuiet, setJustLaunchedQuiet] = useState(false);
  // Invite context for the host: how many were invited but haven't joined yet.
  // (RLS lets only the group admin read invitations, so non-admins just get 0.)
  const [inviteStats, setInviteStats] = useState({ joined: 0, pending: 0 });
  const [pendingCount, setPendingCount] = useState(0);
  const [groupInfo, setGroupInfo] = useState<{ name: string; invite_code: string } | null>(null);
  const [sharedEng, setSharedEng] = useState(false);
  const [nudgeMsg, setNudgeMsg] = useState<string | null>(null);
  // Is the viewer a full member of this group, or just a guest of this one card?
  // null = still checking (treat as member to avoid flashing guest UI to members).
  const [isMember, setIsMember] = useState<boolean | null>(null);
  const [isGroupAdmin, setIsGroupAdmin] = useState(false);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    supabase
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) {
          setIsMember(!!data);
          setIsGroupAdmin(data?.role === "admin");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user, groupId]);
  const isGuest = isMember === false;

  // Guests on THIS card (host-only) + the ability to bring one into the group.
  const [engagementGuests, setEngagementGuests] = useState<
    { user_id: string; name: string }[]
  >([]);
  const loadGuests = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("engagement_guests")
      .select("user_id, profile:profiles(display_name)")
      .eq("engagement_id", engagementId);
    if (!data) return;
    setEngagementGuests(
      (
        data as {
          user_id: string;
          profile: { display_name: string } | { display_name: string }[] | null;
        }[]
      ).map((g) => {
        const p = Array.isArray(g.profile) ? g.profile[0] : g.profile;
        return { user_id: g.user_id, name: p?.display_name || "Guest" };
      })
    );
  }, [user, engagementId]);
  useEffect(() => {
    loadGuests();
  }, [loadGuests, responseCount]);

  // Host view: who has responded so far (user_ids only — sealed content stays
  // hidden). Loaded only for the creator / a group admin.
  useEffect(() => {
    if (!user) return;
    const isHost = engagement?.creator_id === user.id || isGroupAdmin;
    if (!isHost) {
      setResponders([]);
      return;
    }
    let cancelled = false;
    supabase
      .rpc("engagement_responders", { _eid: engagementId })
      .then(({ data }) => {
        if (!cancelled) setResponders((data as string[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [user, engagement?.creator_id, isGroupAdmin, engagementId, responseCount]);

  const [promotingGuest, setPromotingGuest] = useState<string | null>(null);
  const promoteGuest = async (uid: string) => {
    setPromotingGuest(uid);
    const { error } = await supabase.rpc("promote_guest_to_member", {
      _eid: engagementId,
      _uid: uid,
    });
    if (error) {
      alert("Couldn't add to the group: " + error.message);
    } else {
      await loadGuests();
      refresh();
    }
    setPromotingGuest(null);
  };
  // "Guess who" game for blind engagements: responseId -> guessed name
  const [guesses, setGuesses] = useState<Record<string, string>>({});
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());

  // Detect reveal transition for animation
  useEffect(() => {
    if (prevStatusRef.current === "active" && engagement?.status === "revealed") {
      setShowRevealAnimation(true);
      setJustRevealed(true);
      setTimeout(() => setShowRevealAnimation(false), 3000);
      // Email the results to members who have an email (guests have none, so
      // they're skipped). Idempotent server-side, so multiple viewers firing
      // this only sends once.
      if (session) {
        fetch("/api/campfire/engagement/notify-reveal", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ engagementId, origin: window.location.origin }),
        }).catch(() => {});
      }
    }
    prevStatusRef.current = engagement?.status ?? null;
  }, [engagement?.status, session, engagementId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-slate-400 animate-pulse">Loading engagement...</div>
      </div>
    );
  }

  if (!engagement) {
    return (
      <div className="text-center py-20">
        <p className="text-slate-500">Engagement not found.</p>
        <Link href={`/campfirelive/group/${groupId}`} className="text-orange-600 underline text-sm mt-2 inline-block">
          Back to group
        </Link>
      </div>
    );
  }

  const meta = ENGAGEMENT_TYPES[engagement.type];
  const isSealed = engagement.reveal === "sealed" && engagement.status === "active";
  // A Sign-up is a live list, not a reveal — it never has a "revealed" phase (the
  // host's un-reveal/re-seal controls, late-response tagging, etc. don't apply).
  const isRevealed =
    engagement.status === "revealed" && engagement.type !== "signup";
  // Live modes show responses as they arrive; all_at_once waits for the creator.
  const liveMode =
    engagement.reveal === "as_they_come" || engagement.reveal === "instant";
  const showResults = isRevealed || liveMode;
  const awaitingCreatorReveal =
    engagement.reveal === "all_at_once" && engagement.status === "active";
  const hasResponded = !!myResponse;
  // The count the reveal actually waits on. With "wait for all invited" the bar
  // includes people invited but not yet joined (they must join + respond too).
  const waitAll = !!engagement.wait_for_all_invited;
  const displayExpected = engagement.total_expected + (waitAll ? pendingCount : 0);
  const allIn = responseCount >= displayExpected;
  const isCreator = engagement.creator_id === user?.id;
  const isDraft = !engagement.launched_at;
  // Resolve a member's per-group name (falls back to their global/profile name).
  const memberNameOf = (userId: string | null | undefined, fallback?: string | null) =>
    roster.find((m) => m.user_id === userId)?.name || fallback || "Someone";
  const pollOptions = (engagement.config?.options as string[]) ?? [];
  // An open-ended poll has no preset options — people type free-text answers to one
  // or more open questions (stored in config.questions).
  const isOpenPoll =
    engagement.type === "poll" &&
    (engagement.config?.format === "open" || pollOptions.length === 0);
  // After a sealed reveal, latecomers may still add their answer — but NOT to a
  // guessing game (they'd see the answers first) or a tally poll (they'd be swayed).
  // Cards, care, shares, open-ended polls, etc. are fine.
  const lateResponseAllowed =
    isRevealed &&
    !["two_truths", "most_likely", "baby_reveal"].includes(engagement.type) &&
    !(engagement.type === "poll" && !isOpenPoll);
  const pollOpenQuestions: string[] = (() => {
    if (engagement.type !== "poll") return [];
    const qs =
      (engagement.config?.questions as string[] | undefined)?.filter(Boolean) ?? [];
    if (qs.length) return qs;
    // Legacy/simple open poll with no explicit questions → the title is the question.
    return isOpenPoll ? [engagement.title] : [];
  })();
  // Cards stay editable after reveal so the host can fix who it's addressed to
  // (the "All Except" recipient list) and re-send.
  const canEdit =
    isCreator &&
    (engagement.status === "active" ||
      (engagement.type === "birthday" && engagement.status === "revealed"));

  // Birthday card = private to the recipient. Each wish is seen only by its author
  // and the recipient — never the rest of the group, even after the reveal. The same
  // card type is reused for other celebrations (Retirement, Mother's Day, …) via
  // config.occasion, so the copy adapts: a real birthday vs. a generic celebration.
  const isBirthdayCard = engagement.type === "birthday";
  const cardOccasion =
    (engagement.config?.occasion as string | undefined)?.trim() || undefined;
  const isCelebrationCard = isBirthdayCard && !!cardOccasion;
  // Emoji for the card: 🎂 for a real birthday, the preset/🎉 for a celebration.
  const cardEmoji = engagementIcon(engagement);
  // What to call the recipient when nobody's named: avoid "birthday" for celebrations.
  const recipientNoun =
    cardOccasion === "Wedding"
      ? "the happy couple"
      : isCelebrationCard
      ? "the guest of honor"
      : "the birthday person";
  // The anchor-year field: only a real birthday is a "Birth year". Celebrations get an
  // optional "Start year" (e.g. start of employment → years of service); preset holidays
  // (Mother's/Father's Day) don't use a year at all.
  const isRealBirthday = isBirthdayCard && !cardOccasion;
  const isPresetHolidayCard =
    cardOccasion === "Mother's Day" || cardOccasion === "Father's Day";
  const showYearField = isBirthdayCard && !isPresetHolidayCard;
  const yearFieldLabel = isRealBirthday ? "Birth year" : "Start year";
  const yearFieldHint = isRealBirthday
    ? "(for the age)"
    : "(optional — e.g. start of employment)";
  const recipientLabel =
    [
      ...(engagement.excluded_user_ids ?? []).map((uid) =>
        memberNameOf(uid, "the recipient")
      ),
      ...(engagement.excluded_emails ?? []).map(
        (email) => pendingInvitees.find((p) => p.email === email)?.name || email
      ),
    ].join(", ") || recipientNoun;
  const isRecipient =
    !!user && (engagement.excluded_user_ids ?? []).includes(user.id);
  // Hide the chip-in from the gift recipient so it stays a surprise — either the
  // whole-engagement surprise target, or a Sign-up recipient flagged gift-only.
  const isGiftHidden =
    isRecipient ||
    (!!user && (engagement.gift_hidden_from ?? []).includes(user.id));
  // Who sees the running total. Default: everyone who can see the gift card (which
  // already excludes the recipient via isGiftHidden). The host can restrict it to
  // just themselves + the initiator via config.giftShowTotal === false.
  const giftShowTotal = engagement.config?.giftShowTotal !== false;
  const canSeeGiftTotal =
    giftShowTotal ||
    isCreator ||
    (!!user && engagement.gift_initiated_by === user.id);

  // Chip in toward the group gift — opens Stripe Checkout for the chosen amount.
  const chipIn = async (amountCents: number, giftId?: string) => {
    if (chippingIn || !engagementId) return;
    setChippingIn(true);
    try {
      const res = await fetch("/api/campfire/gift/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engagementId,
          giftId: giftId ?? undefined,
          amountCents,
          contributorName: memberNameOf(user?.id) || null,
          userId: user?.id ?? null,
          email: user?.email ?? undefined,
          origin: window.location.origin,
        }),
      });
      const data = await res.json();
      if (data?.url) {
        window.location.href = data.url as string;
      } else {
        alert(data?.error || "Couldn't start checkout.");
        setChippingIn(false);
      }
    } catch {
      alert("Couldn't start checkout.");
      setChippingIn(false);
    }
  };

  // Any group member can start a group chip-in (gift) for one guest on this engagement.
  const startGift = async () => {
    if (startingGift) return;
    if (!startGiftEmail.trim()) {
      alert("Add the recipient's email — that's where the gift card is sent.");
      return;
    }
    setStartingGift(true);
    const { error } = await supabase.rpc("campfire_start_gift", {
      _eid: engagementId,
      _email: startGiftEmail.trim(),
      _name: startGiftName.trim() || null,
      _currency: startGiftCurrency,
      _surprise_uid: startGiftSurpriseUid || null,
    });
    setStartingGift(false);
    if (error) {
      alert("Couldn't start the chip-in: " + error.message);
      return;
    }
    // Reset the form for the next one and reveal the new chip-in.
    setShowStartGift(false);
    setStartGiftName("");
    setStartGiftEmail("");
    setStartGiftSurpriseUid("");
    refreshGifts();
  };

  // Host or initiator sends a pooled chip-in now (a Sign-up never auto-reveals).
  const sendGift = async (giftId: string) => {
    if (sendingGift || !session) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm("Send the gift card to the recipient now for the amount raised?")
    )
      return;
    setSendingGift(true);
    try {
      const res = await fetch("/api/campfire/gift/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ giftId }),
      });
      const data = await res.json();
      if (!res.ok) alert(data?.error || "Couldn't send the gift.");
      else refreshGifts();
    } catch {
      alert("Couldn't send the gift.");
    }
    setSendingGift(false);
  };

  // Human description of WHEN this will reveal — keeps the waiting copy honest.
  const deadlineStr = engagement.deadline
    ? new Date(engagement.deadline).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  const revealRule = engagement.hold_until_deadline && deadlineStr
    ? `Sealed until the deadline (${deadlineStr}) — it won't open early even if everyone answers.`
    : waitAll
    ? "Reveals once everyone invited has joined and responded."
    : "Reveals the moment everyone who's joined has responded.";

  // ── Ratings / winner (non-poll, after reveal) ──
  const ratingFor = (responseId: string) => {
    const scores = ratings.filter((rt) => rt.response_id === responseId);
    return {
      avg: scores.length ? scores.reduce((a, b) => a + b.score, 0) / scores.length : 0,
      count: scores.length,
    };
  };
  const myRatingFor = (responseId: string) =>
    ratings.find((rt) => rt.response_id === responseId && rt.rater_id === user?.id)?.score ?? 0;
  // Winner = highest average rating (needs ≥1 rating); ties → earliest response.
  let winnerResponseId: string | null = null;
  let bestAvg = -1;
  for (const r of responses) {
    const { avg, count } = ratingFor(r.id);
    if (count > 0 && avg > bestAvg) {
      bestAvg = avg;
      winnerResponseId = r.id;
    }
  }
  const winnerUserId = winnerResponseId
    ? responses.find((r) => r.id === winnerResponseId)?.user_id ?? null
    : null;
  const iWon = isRevealed && !!winnerUserId && winnerUserId === user?.id;

  // ── Creator: edit the prompt ──

  const startEdit = () => {
    setEditTitle(engagement.title);
    setEditDesc(engagement.description ?? "");
    setEditRecurrence(
      (engagement.recurrence_rule as "daily" | "weekly" | "monthly" | null) ?? "none"
    );
    setEditAllowMemberInvites(!!engagement.allow_member_invites);
    setEditExcludedIds(engagement.excluded_user_ids ?? []);
    setEditExcludedEmails(engagement.excluded_emails ?? []);
    setEditCareQuestions(parseCareQuestions(engagement.config));
    setEditGiftEnabled(!!engagement.gift_enabled);
    setEditGiftShowTotal(engagement.config?.giftShowTotal !== false);
    setEditGiftRecipientEmail(engagement.gift_recipient_email ?? "");
    setEditGiftRecipientName(engagement.gift_recipient_name ?? "");
    setEditGiftCurrency(engagement.gift_currency ?? "usd");
    {
      const cfg = (engagement.config ?? {}) as {
        truthPrompt?: string;
        darePrompt?: string;
        format?: "multiple" | "yes_no" | "open";
        questions?: string[];
      };
      setEditTruthPrompt(cfg.truthPrompt ?? "");
      setEditDarePrompt(cfg.darePrompt ?? "");
      // Infer the format for polls created before the format field existed.
      const opts = pollOptions;
      const inferred: "multiple" | "yes_no" | "open" =
        cfg.format ??
        (opts.length === 0
          ? "open"
          : opts.length === 2 &&
            opts.map((o) => o.toLowerCase()).join(",") === "yes,no"
          ? "yes_no"
          : "multiple");
      setEditPollFormat(inferred);
      // The editable list is the questions for an open poll, else the options. A
      // multiple→open switch keeps whatever's typed, turning options into questions.
      const list = inferred === "open" ? cfg.questions ?? [] : opts;
      setEditPollOptions(list.length ? list : ["", ""]);
    }
    setEditLeadDays(engagement.lead_days ?? 14);
    // Birthday: the deadline IS the birthday (the day it reveals). Pre-fill the
    // date in LOCAL time so the day doesn't shift across time zones.
    if (engagement.deadline) {
      const d = new Date(engagement.deadline);
      const p = (n: number) => String(n).padStart(2, "0");
      setEditDeadline(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
      // Full local datetime for the non-birthday reveal/deadline editor.
      setEditDeadlineTime(
        `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(
          d.getMinutes()
        )}`
      );
    } else {
      setEditDeadline("");
      setEditDeadlineTime("");
    }
    setEditBirthYear(engagement.birth_year ? String(engagement.birth_year) : "");
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!editTitle.trim()) return;
    setSavingEdit(true);
    const isBirthday = engagement.type === "birthday";
    // Birthday: let the host fix the date / birth year. The deadline is the
    // birthday (reveal day); re-derive the auto-open date from it + the lead time.
    const birthdayFields: Record<string, unknown> = {};
    if (isBirthday) {
      const leadN = Math.max(0, editLeadDays || 14);
      birthdayFields.lead_days = leadN;
      if (editDeadlineTime) {
        const nd = new Date(editDeadlineTime); // full local date & time
        birthdayFields.deadline = nd.toISOString();
        birthdayFields.scheduled_open_at = new Date(
          nd.getTime() - leadN * 86400000
        ).toISOString();
      }
      birthdayFields.birth_year = editBirthYear.trim()
        ? parseInt(editBirthYear, 10)
        : null;
    } else {
      // Non-birthday: let the host change the reveal/deadline date & time (or clear it).
      birthdayFields.deadline = editDeadlineTime
        ? new Date(editDeadlineTime).toISOString()
        : null;
    }
    // Care Check-in: persist the edited question list (prompt + response type).
    const careFields: Record<string, unknown> = {};
    if (engagement.type === "care") {
      const cqs = editCareQuestions
        .map((q) => ({ prompt: q.prompt.trim(), kind: q.kind }))
        .filter((q) => q.prompt);
      if (cqs.length < 1) {
        alert("Keep at least one question.");
        setSavingEdit(false);
        return;
      }
      careFields.config = { ...(engagement.config ?? {}), questions: cqs };
    }
    // Truth or Dare: persist the edited prompts.
    if (engagement.type === "truth_or_dare") {
      const tp = editTruthPrompt.trim();
      const dp = editDarePrompt.trim();
      if (!tp || !dp) {
        alert("Keep both a Truth prompt and a Dare prompt.");
        setSavingEdit(false);
        return;
      }
      careFields.config = {
        ...(engagement.config ?? {}),
        truthPrompt: tp,
        darePrompt: dp,
      };
    }
    // Poll: persist the (possibly changed) format. For an open poll the editable
    // list IS the questions (so switching multiple→open turns options into questions).
    if (engagement.type === "poll") {
      const base = { ...(engagement.config ?? {}) } as Record<string, unknown>;
      if (editPollFormat === "open") {
        const qs = editPollOptions.map((o) => o.trim()).filter(Boolean);
        if (qs.length < 1) {
          alert("Add at least one open question.");
          setSavingEdit(false);
          return;
        }
        careFields.config = { ...base, format: "open", questions: qs, options: [] };
      } else if (editPollFormat === "yes_no") {
        careFields.config = { ...base, format: "yes_no", options: ["Yes", "No"], questions: [] };
      } else {
        const options = editPollOptions.map((o) => o.trim()).filter(Boolean);
        if (options.length < 2) {
          alert("A multiple-choice poll needs at least 2 options.");
          setSavingEdit(false);
          return;
        }
        careFields.config = { ...base, format: "multiple", options, questions: [] };
      }
    }
    // Group gift: validate, and if the host is turning it OFF after people chipped
    // in, refund those contributions first.
    if (editGiftEnabled && !editGiftRecipientEmail.trim()) {
      alert("Add the recipient's email — that's where the gift card is sent.");
      setSavingEdit(false);
      return;
    }
    const turningGiftOff = engagement.gift_enabled && !editGiftEnabled;
    if (
      turningGiftOff &&
      !engagement.gift_issued_at &&
      (giftSummary?.contributors ?? 0) > 0 &&
      session
    ) {
      if (
        typeof window !== "undefined" &&
        !window.confirm(
          "Turning off the gift will refund everyone who chipped in. Continue?"
        )
      ) {
        setSavingEdit(false);
        return;
      }
      try {
        await fetch("/api/campfire/gift/refund", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ engagementId }),
        });
      } catch {
        alert("Couldn't refund the contributions — try again.");
        setSavingEdit(false);
        return;
      }
    }
    const { error } = await supabase
      .from("engagements")
      .update({
        title: editTitle.trim(),
        description: editDesc.trim() || null,
        recurrence_rule: isBirthday
          ? engagement.recurrence_rule
          : editRecurrence === "none"
          ? null
          : editRecurrence,
        allow_member_invites: editAllowMemberInvites,
        excluded_user_ids: editExcludedIds,
        excluded_emails: editExcludedEmails,
        gift_enabled: editGiftEnabled,
        gift_recipient_email: editGiftEnabled
          ? editGiftRecipientEmail.trim() || null
          : null,
        gift_recipient_name: editGiftEnabled
          ? editGiftRecipientName.trim() || null
          : null,
        gift_currency: editGiftCurrency,
        config: { ...(engagement.config ?? {}), giftShowTotal: editGiftShowTotal },
        ...birthdayFields,
        ...careFields,
      })
      .eq("id", engagementId);
    setSavingEdit(false);
    if (error) {
      alert("Couldn't save your changes: " + error.message);
      return;
    }
    setEditing(false);
    refresh();
  };

  // Email a reminder to everyone who hasn't responded yet.
  const nudgeStragglers = async () => {
    if (!session) return;
    setNudgeMsg("Sending…");
    try {
      const res = await fetch("/api/campfire/engagement/nudge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ engagementId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setNudgeMsg(data.error || "Couldn't send nudges.");
      else
        setNudgeMsg(
          data.nudged > 0
            ? `✓ Nudged ${data.nudged} ${data.nudged === 1 ? "person" : "people"} (members + anyone invited who hasn't joined)`
            : "No one left to nudge — everyone's responded or isn't invited yet."
        );
    } catch {
      setNudgeMsg("Couldn't send nudges.");
    }
  };

  // Build & download a shareable PNG of the revealed results.
  const shareResults = () => {
    const W = 1080;
    const H = 1350;
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#f97316");
    g.addColorStop(1, "#e11d48");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "bold 46px system-ui, -apple-system, sans-serif";
    ctx.fillText("🔥 Campfire", 80, 80);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 66px system-ui, -apple-system, sans-serif";
    let y = wrapText(ctx, engagement.title, 80, 190, W - 160, 80) + 40;

    if (engagement.type === "poll") {
      const votes: Record<string, number> = {};
      pollOptions.forEach((o) => (votes[o] = 0));
      responses.forEach((r) => {
        const o = (r.content as Record<string, unknown>)?.option as string;
        if (o) votes[o] = (votes[o] ?? 0) + 1;
      });
      const total = responses.length || 1;
      pollOptions.forEach((o) => {
        const pct = Math.round(((votes[o] ?? 0) / total) * 100);
        ctx.font = "bold 42px system-ui, -apple-system, sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "left";
        ctx.fillText(o.length > 24 ? o.slice(0, 23) + "…" : o, 80, y);
        ctx.textAlign = "right";
        ctx.fillText(`${pct}%`, W - 80, y);
        ctx.textAlign = "left";
        y += 60;
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        roundRectPath(ctx, 80, y, W - 160, 36, 18);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        roundRectPath(ctx, 80, y, (W - 160) * (pct / 100), 36, 18);
        ctx.fill();
        y += 84;
      });
    } else {
      ctx.font = "bold 50px system-ui, -apple-system, sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(`${responses.length} responses revealed`, 80, y);
      y += 84;
      if (winnerUserId) {
        const wn = responses.find((r) => r.user_id === winnerUserId)?.profile?.display_name;
        if (wn) ctx.fillText(`🏆 ${engagement.is_blind ? "Anonymous" : wn}`, 80, y);
      }
    }

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "36px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("curriculate.net/campfire", 80, H - 90);

    c.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `campfire-${engagementId.slice(0, 8)}.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  };

  // Creator launches the draft — makes it live for the group, then (optionally) emails.
  // Copy an invite that's about THIS engagement, with a join link that drops the
  // person straight into it after they join the group.
  const shareEngagement = async () => {
    if (!engagement || !groupInfo) return;
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://www.curriculate.net";
    // Prefer the short, friendly link (/c/<code>); fall back to the full join URL
    // for any older engagement that doesn't have a share code yet.
    const url = engagement.share_code
      ? `${origin}/c/${engagement.share_code}`
      : `${origin}/campfirelive/join/${groupInfo.invite_code}?e=${engagement.id}`;
    const blurb = engagement.description?.trim() || meta?.hook || "";
    const title = resolveTitle(engagement.title, engagement.birth_year, engagement.deadline);
    // The "birthday" type is really a card (birthday, anniversary, retirement, …),
    // so call it "a group card" rather than "a group birthday".
    const what =
      engagement.type === "birthday"
        ? "a group card"
        : meta?.label
        ? `a group ${meta.label.toLowerCase()}`
        : "a group activity";
    // A clear date line so the recipient knows what they're opening and by when.
    const dateLine = engagement.deadline
      ? engagement.hold_until_deadline
        ? `🎉 It opens ${new Date(engagement.deadline).toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })} at ${new Date(engagement.deadline).toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
          })}.`
        : `⏰ Add yours by ${new Date(engagement.deadline).toLocaleString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}.`
      : "";
    const msg = `You're invited to "${title}" — ${what} on Campfire 🔥${
      blurb ? `\n\n${blurb}` : ""
    }${dateLine ? `\n\n${dateLine}` : ""}\n\n👉 Tap to add yours — no app or account needed, just your name:\n${url}\n\n(Already on Campfire? Use code ${groupInfo.invite_code}.)`;
    try {
      await navigator.clipboard.writeText(msg);
      setSharedEng(true);
      setTimeout(() => setSharedEng(false), 2500);
    } catch {
      alert(msg); // clipboard blocked — show it so they can copy manually
    }
  };

  // notify=true emails the group; notify=false opens it quietly (no email — e.g.
  // you want next year's card available to sign now without a notification yet).
  const launch = async (notify = true) => {
    if (launching) return;
    setLaunching(true);
    const { error } = await launchEngagement();
    if (error) {
      alert("Couldn't launch: " + error);
      setLaunching(false);
      return;
    }
    setJustLaunched(true);
    setJustLaunchedQuiet(!notify);
    if (notify && session) {
      try {
        await fetch("/api/campfire/engagement/notify-new", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            engagementId: engagement.id,
            origin: window.location.origin,
          }),
        });
      } catch {
        /* non-fatal: the engagement is live regardless */
      }
    }
    setLaunching(false);
  };

  // Creator cancels (deletes) the engagement — it vanishes for everyone (live).
  const cancelEngagement = async () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        engagement.gift_enabled && !engagement.gift_issued_at
          ? "Cancel this card? Everyone's gift contributions will be refunded, and it'll be removed for everyone — this can't be undone."
          : "Cancel this engagement? It will be removed for everyone — this can't be undone."
      )
    )
      return;
    // Refund gift contributions BEFORE deleting (delete cascades the rows away).
    if (engagement.gift_enabled && !engagement.gift_issued_at && session) {
      try {
        await fetch("/api/campfire/gift/refund", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ engagementId }),
        });
      } catch {
        alert("Couldn't refund contributions — cancel paused. Try again.");
        return;
      }
    }
    const { error } = await deleteEngagement();
    if (error) {
      alert("Couldn't cancel: " + error);
      return;
    }
    router.push(`/campfirelive/group/${groupId}`);
  };

  // Duplicate this engagement into a fresh DRAFT, reusing its config + uploaded
  // images so the host doesn't re-do that work (great for repeat birthday cards).
  // Person/date-specific bits are cleared so the copy is a clean template.
  const duplicateEngagement = async () => {
    if (!engagement || duplicating) return;
    setDuplicating(true);
    const e = engagement;
    const { error, engagement: copy } = await createEngagement({
      groupId,
      type: e.type,
      title: `${e.title} (copy)`,
      description: e.description ?? undefined,
      config: JSON.parse(JSON.stringify(e.config ?? {})),
      reveal: e.reveal,
      is_blind: e.is_blind,
      recurrence_rule: e.recurrence_rule ?? undefined,
      lead_days: e.lead_days,
      private_to_host: e.private_to_host,
      allow_anon_replies: e.allow_anon_replies,
      allow_member_invites: e.allow_member_invites,
      // Reuse the uploaded image pool verbatim — no re-upload needed.
      cover_image_urls: e.cover_image_urls ?? [],
      cover_image_url: e.cover_image_url ?? undefined,
      // Cleared on purpose — the copy is for a new recipient / date:
      deadline: undefined,
      scheduled_open_at: null,
      birth_year: null,
      excluded_user_ids: [],
      excluded_emails: [],
    });
    setDuplicating(false);
    if (error || !copy) {
      alert("Couldn't duplicate: " + (error ?? "unknown error"));
      return;
    }
    router.push(`/campfirelive/group/${groupId}/engagement/${copy.id}`);
  };

  const togglePause = async () => {
    if (pausing) return;
    setPausing(true);
    const { error } = await setPaused(!engagement.paused);
    setPausing(false);
    if (error) alert("Couldn't update: " + error);
  };

  // Host: re-send the reveal email (e.g. if a first send went out with a bad link).
  const resendReveal = async () => {
    if (resendingReveal || !session) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm("Re-send the reveal email to everyone in the group?")
    )
      return;
    setResendingReveal(true);
    try {
      const res = await fetch("/api/campfire/engagement/notify-reveal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          engagementId,
          origin: window.location.origin,
          force: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.sendError) {
        alert(data?.error || data?.sendError || "Couldn't re-send.");
      } else {
        const reached: string[] = data?.recipientsReached ?? [];
        const noEmail = data?.noEmailCount ?? 0;
        const lines = [`Reveal email re-sent to ${data?.sent ?? 0} people.`];
        lines.push(
          reached.length
            ? `🎉 Recipient(s) emailed: ${reached.join(", ")}`
            : "⚠️ No surprise recipient was emailed (see below)."
        );
        if (noEmail > 0)
          lines.push(
            `⚠️ ${noEmail} recipient(s) have no email on file (guest accounts) — they'll see the card when they open Campfire, but can't be emailed.`
          );
        alert(lines.join("\n\n"));
      }
    } catch {
      alert("Couldn't re-send.");
    }
    setResendingReveal(false);
  };

  // Recipient: thank everyone who signed the card (emails the group, once).
  const sendThanks = async () => {
    if (thanksSending || !session) return;
    setThanksSending(true);
    try {
      const res = await fetch("/api/campfire/card/thanks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ engagementId, message: thanksMsg.trim() }),
      });
      const data = await res.json();
      if (!res.ok) alert(data?.error || "Couldn't send thanks.");
      else {
        setShowThanks(false);
        refresh();
      }
    } catch {
      alert("Couldn't send thanks.");
    }
    setThanksSending(false);
  };

  // Play the "Happy Birthday" melody (public-domain tune) via Web Audio — no audio
  // file needed, works on any device. Triggered on a revealed birthday card.
  const playHappyBirthday = () => {
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const beat = 0.34;
      // [frequency Hz, length in beats] — Happy Birthday to You.
      const G4 = 392.0,
        A4 = 440.0,
        B4 = 493.88,
        C5 = 523.25,
        D5 = 587.33,
        E5 = 659.25,
        F5 = 698.46,
        G5 = 783.99;
      const seq: [number, number][] = [
        [G4, 0.75], [G4, 0.25], [A4, 1], [G4, 1], [C5, 1], [B4, 2],
        [G4, 0.75], [G4, 0.25], [A4, 1], [G4, 1], [D5, 1], [C5, 2],
        [G4, 0.75], [G4, 0.25], [G5, 1], [E5, 1], [C5, 1], [B4, 1], [A4, 2],
        [F5, 0.75], [F5, 0.25], [E5, 1], [C5, 1], [D5, 1], [C5, 2],
      ];
      let t = ctx.currentTime + 0.06;
      for (const [freq, beats] of seq) {
        const dur = beats * beat;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.92);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + dur);
        t += dur;
      }
      window.setTimeout(() => ctx.close().catch(() => {}), (t - ctx.currentTime + 0.4) * 1000);
    } catch {
      /* audio not available — no-op */
    }
  };

  // ── Submit handlers ──

  // Save a response (first time or an edit) and close edit mode on success.
  const saveResponse = async (
    content: Record<string, unknown>,
    extra?: Record<string, unknown>
  ) => {
    // Tag responses added after a sealed reveal so the results can flag them.
    const c =
      lateResponseAllowed && !hasResponded ? { ...content, _late: true } : content;
    const r = await submitResponse(c, extra);
    if (!r?.error) setEditingResponse(false);
    return r;
  };

  // Sign-up: a member's response holds their claimed slot indices, any free-text
  // items they're bringing ("extras"), and their RSVP ("attending").
  const myContent = () =>
    (myResponse?.content as Record<string, unknown> | undefined) ?? {};
  const myClaims = () => ((myContent().claims as number[]) ?? []).slice();
  const myExtras = () => ((myContent().extras as string[]) ?? []).slice();
  const myAttending = () => myContent().attending as string | undefined;
  // Save a patch without dropping the other sign-up fields.
  const saveSignup = (patch: Record<string, unknown>) => {
    const att = myAttending();
    return saveResponse({
      claims: myClaims(),
      extras: myExtras(),
      ...(att ? { attending: att } : {}),
      ...patch,
    });
  };

  // Claim or release a predefined slot.
  const toggleClaim = async (slotIndex: number) => {
    if (signupBusy) return;
    setSignupBusy(true);
    const cur = myClaims();
    const next = cur.includes(slotIndex)
      ? cur.filter((x) => x !== slotIndex)
      : [...cur, slotIndex];
    await saveSignup({ claims: next });
    setSignupBusy(false);
  };

  // RSVP — will I be there? (going / maybe / can't)
  const setAttending = async (value: "yes" | "maybe" | "no") => {
    if (signupBusy) return;
    setSignupBusy(true);
    await saveSignup({ attending: myAttending() === value ? null : value });
    setSignupBusy(false);
  };

  // Host: turn the RSVP ("who's coming") question on/off (default on for sign-ups).
  const toggleRsvp = async () => {
    const next = engagement.config?.rsvp === false; // off → on, otherwise → off

    const { error } = await supabase
      .from("engagements")
      .update({ config: { ...(engagement.config ?? {}), rsvp: next } })
      .eq("id", engagementId);
    if (error) {
      alert("Couldn't update: " + error.message);
      return;
    }
    refresh();
  };

  // Participant: my gender (for a by-gender exchange) and who I'm shopping for
  // (self-pick mode). Both live in my sign-up response.
  const setMyGender = async (g: "male" | "female") => {
    if (signupBusy) return;
    setSignupBusy(true);
    await saveSignup({ gender: myContent().gender === g ? null : g });
    setSignupBusy(false);
  };
  const setGiftFor = async (g: "male" | "female" | "either") => {
    if (signupBusy) return;
    setSignupBusy(true);
    await saveSignup({ giftFor: myContent().giftFor === g ? null : g });
    setSignupBusy(false);
  };

  // Host: enable/configure the gift exchange (stored on the engagement config).
  const setGiftexConfig = async (patch: Record<string, unknown>) => {
    const giftex = { ...(giftexCfg ?? {}), ...patch };
    const { error } = await supabase
      .from("engagements")
      .update({ config: { ...(engagement.config ?? {}), giftex } })
      .eq("id", engagementId);
    if (error) {
      alert("Couldn't update: " + error.message);
      return;
    }
    refresh();
  };

  // Host: roll the random assignments (Secret Santa / by-gender), then reveal all.
  const runGiftexAssign = async (mode: "person" | "gender") => {
    if (giftexBusy) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Randomly assign everyone who RSVP'd yes? This replaces any existing assignments."
      )
    )
      return;
    setGiftexBusy(true);
    const { data, error } = await supabase.rpc("campfire_giftex_assign", {
      _eid: engagementId,
      _mode: mode,
    });
    setGiftexBusy(false);
    if (error) {
      alert("Couldn't assign: " + error.message);
      return;
    }
    alert(`Assigned ${data} people. Each can now see only their own.`);
    refreshMyAssignment();
    refresh();
  };
  const runGiftexReveal = async () => {
    if (giftexBusy) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm("Reveal who bought for whom to everyone? This can't be undone.")
    )
      return;
    setGiftexBusy(true);
    const { error } = await supabase.rpc("campfire_giftex_reveal", {
      _eid: engagementId,
    });
    setGiftexBusy(false);
    if (error) {
      alert("Couldn't reveal: " + error.message);
      return;
    }
    refresh();
  };

  // Add / remove a free-text item I'm bringing that isn't a predefined slot.
  const addExtra = async (label: string) => {
    const clean = label.trim();
    if (!clean || signupBusy) return;
    const cur = myExtras();
    if (cur.some((x) => x.toLowerCase() === clean.toLowerCase())) {
      setExtraInput("");
      return;
    }
    setSignupBusy(true);
    await saveSignup({ extras: [...cur, clean].slice(0, 20) });
    setExtraInput("");
    setSignupBusy(false);
  };

  const removeExtra = async (label: string) => {
    if (signupBusy) return;
    setSignupBusy(true);
    await saveSignup({ extras: myExtras().filter((x) => x !== label) });
    setSignupBusy(false);
  };

  // Host: let AI plan a BALANCED list for the headcount — set a target (need) and a
  // sensible hard cap (capacity) on each item, and fill missing essentials. Applied
  // in place (existing items keep their index, so claims stay valid).
  const aiBalance = async () => {
    if (suggesting || !session) return;
    setSuggesting(true);
    try {
      const res = await fetch("/api/campfire/signup/suggest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ engagementId }),
      });
      const data = await res.json();
      const plan = (data?.plan ?? []) as { label: string; need: number; max: number }[];
      if (!res.ok || plan.length === 0) {
        alert(data?.error || "Couldn't get a plan right now.");
        setSuggesting(false);
        return;
      }
      const cur = (
        (engagement.config?.slots as {
          label: string;
          capacity: number;
          need?: number;
        }[]) ?? []
      ).slice();
      let added = 0;
      let adjusted = 0;
      for (const p of plan) {
        const idx = cur.findIndex(
          (s) => s.label.trim().toLowerCase() === p.label.trim().toLowerCase()
        );
        if (idx >= 0) {
          cur[idx] = { ...cur[idx], capacity: p.max, need: p.need };
          adjusted++;
        } else {
          cur.push({ label: p.label, capacity: p.max, need: p.need });
          added++;
        }
      }
      const { error } = await supabase
        .from("engagements")
        .update({ config: { ...(engagement.config ?? {}), slots: cur } })
        .eq("id", engagementId);
      if (error) alert("Couldn't apply: " + error.message);
      else {
        alert(`AI balanced the list — ${added} added, ${adjusted} adjusted.`);
        refresh();
      }
    } catch {
      alert("Couldn't get a plan right now.");
    }
    setSuggesting(false);
  };

  // Host: append a single item to the list (manual add).
  const addSignupSlot = async (label: string, capacity: number) => {
    const slots =
      ((engagement.config?.slots as { label: string; capacity: number }[]) ?? []).slice();
    slots.push({ label, capacity });
    const { error } = await supabase
      .from("engagements")
      .update({ config: { ...(engagement.config ?? {}), slots } })
      .eq("id", engagementId);
    if (error) {
      alert("Couldn't add: " + error.message);
      return;
    }
    refresh();
  };

  // Editing isn't wired for Two Truths (its hidden lie + others' guesses make an
  // in-place edit messy); every other type re-opens its form pre-filled.
  const canEditResponse = engagement.type !== "two_truths";

  // Re-open the response form pre-filled with the current answer.
  const startEditResponse = () => {
    const c = (myResponse?.content ?? {}) as Record<string, unknown>;
    if (typeof c.option === "string") setSelectedOption(c.option);
    if (typeof c.text === "string") setTextInput(c.text);
    if (typeof c.caption === "string") setTextInput(c.caption);
    if (engagement.type === "poll" && isOpenPoll) {
      const ans = (c.answers ?? {}) as Record<string, string>;
      const init: Record<number, string> = {};
      pollOpenQuestions.forEach((_, i) => {
        init[i] =
          ans[String(i)] ?? (i === 0 && typeof c.text === "string" ? c.text : "");
      });
      setOpenPollAnswers(init);
    }
    if (c.mode === "truth" || c.mode === "dare") setTodMode(c.mode);
    setTodPhoto(typeof c.photo === "string" ? c.photo : null);
    if (engagement.type === "photo_pose") {
      const items = Array.isArray(c.media_items)
        ? (c.media_items as { url: string; type: string }[])
        : typeof c.media_url === "string" && c.media_url
        ? [{ url: c.media_url, type: (c.media_type as string) ?? "photo" }]
        : [];
      setMediaItems(items);
    }
    if (engagement.type === "most_likely" && c.answers)
      setMlVotes(c.answers as Record<number, string>);
    if (engagement.type === "accountability" && c.answers) {
      setAcRatings(c.answers as Record<number, number>);
      setAcNote(typeof c.note === "string" ? c.note : "");
    }
    if (engagement.type === "scavenger_hunt" && c.answers)
      setShItems(c.answers as Record<number, { text?: string; photo?: string }>);
    if (engagement.type === "care") {
      // Pre-fill from this person's saved per-question answer rows.
      const mine = careAnswerRows.filter((a) => a.user_id === user?.id);
      const qs = parseCareQuestions(engagement.config);
      const vals: Record<number, string | number> = {};
      const vis: Record<number, "host" | "group" | "anon"> = {};
      for (const a of mine) {
        vals[a.q_index] =
          qs[a.q_index]?.kind === "star" ? Number(a.value) : a.value;
        vis[a.q_index] = a.anonymous
          ? "anon"
          : a.share_to_group === false
          ? "host"
          : a.share_to_group === true
          ? "group"
          : engagement.private_to_host
          ? "host"
          : "group";
      }
      setCareAnswers(vals);
      setCareVis(vis);
    }
    setEditingResponse(true);
  };

  const handlePollSubmit = async () => {
    if (!selectedOption) return;
    setSubmitting(true);
    await saveResponse({ option: selectedOption });
    setSubmitting(false);
  };

  // Open-ended poll: one free-text answer per question.
  const handleOpenPollSubmit = async () => {
    const answers: Record<number, string> = {};
    pollOpenQuestions.forEach((_, i) => {
      const v = (openPollAnswers[i] ?? "").trim();
      if (v) answers[i] = v;
    });
    if (Object.keys(answers).length === 0) {
      alert("Answer at least one question.");
      return;
    }
    for (const v of Object.values(answers)) {
      if (hasProfanity(v)) {
        alert("Let's keep it kind — please reword.");
        return;
      }
    }
    setSubmitting(true);
    await saveResponse({ answers });
    setSubmitting(false);
  };

  const handleTextSubmit = async () => {
    if (!textInput.trim()) return;
    if (hasProfanity(textInput)) {
      alert("Let's keep it kind — please reword your response.");
      return;
    }
    setSubmitting(true);
    await saveResponse({ text: textInput.trim() });
    setSubmitting(false);
    setTextInput("");
  };

  // Truth or Dare: upload an optional proof photo for the answer.
  const handleTodPhotoUpload = async (file: File | undefined) => {
    if (!file || !user) return;
    setTodUploading(true);
    const ext = file.name.split(".").pop();
    const path = `${user.id}/${engagementId}/tod-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("campfire-media")
      .upload(path, file);
    if (upErr) {
      alert("Upload failed: " + upErr.message);
      setTodUploading(false);
      return;
    }
    const { data } = supabase.storage.from("campfire-media").getPublicUrl(path);
    setTodPhoto(data.publicUrl);
    setTodUploading(false);
  };

  // Truth or Dare: store which one they picked + their answer (text and/or photo).
  const handleTruthOrDareSubmit = async () => {
    if (!todMode) {
      alert("Pick Truth or Dare first.");
      return;
    }
    const text = textInput.trim();
    if (!text && !todPhoto) {
      alert("Add an answer or a photo.");
      return;
    }
    if (text && hasProfanity(text)) {
      alert("Let's keep it kind — please reword your response.");
      return;
    }
    setSubmitting(true);
    await saveResponse({ mode: todMode, text, photo: todPhoto ?? undefined });
    setSubmitting(false);
    setTextInput("");
  };

  const handleTwoTruthsSubmit = async () => {
    const cleaned = ttStatements.map((s) => s.trim());
    if (cleaned.some((s) => !s)) {
      alert("Fill in all three statements.");
      return;
    }
    if (ttLie === null) {
      alert("Tap the circle next to the statement that's the lie.");
      return;
    }
    if (cleaned.some((s) => hasProfanity(s))) {
      alert("Let's keep it kind — please reword.");
      return;
    }
    setSubmitting(true);
    const { error: ttErr } = await submitTwoTruths(cleaned, ttLie);
    setSubmitting(false);
    if (ttErr) alert("Couldn't submit: " + ttErr);
  };

  const handleMostLikelySubmit = async () => {
    const anyVote = Object.values(mlVotes).some(Boolean);
    if (!anyVote) {
      alert("Vote for at least one award.");
      return;
    }
    // Drop any blank picks before saving.
    const answers: Record<string, string> = {};
    Object.entries(mlVotes).forEach(([k, v]) => {
      if (v && v.trim()) answers[k] = v.trim();
    });
    setSubmitting(true);
    const { error: mlErr } = await saveResponse({ answers });
    setSubmitting(false);
    if (mlErr) alert("Couldn't submit: " + mlErr);
  };

  const handleAccountabilitySubmit = async () => {
    const qs = (engagement.config?.questions as string[]) ?? [];
    if (qs.some((_, i) => !acRatings[i])) {
      alert("Give each question a rating (1–5).");
      return;
    }
    const note = acNote.trim();
    if (note && hasProfanity(note)) {
      alert("Let's keep it kind — please reword your note.");
      return;
    }
    const answers: Record<string, number> = {};
    qs.forEach((_, i) => {
      answers[i] = acRatings[i];
    });
    setSubmitting(true);
    const { error: acErr } = await saveResponse({ answers, note: note || undefined });
    setSubmitting(false);
    if (acErr) alert("Couldn't submit: " + acErr);
  };

  const handleScavengerUpload = async (i: number, file: File | undefined) => {
    if (!file || !user) return;
    setShUploading(i);
    const ext = file.name.split(".").pop();
    const path = `${user.id}/${engagementId}/${i}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("campfire-media").upload(path, file);
    if (upErr) {
      alert("Upload failed: " + upErr.message);
      setShUploading(null);
      return;
    }
    const { data } = supabase.storage.from("campfire-media").getPublicUrl(path);
    setShItems((prev) => ({ ...prev, [i]: { ...prev[i], photo: data.publicUrl } }));
    setShUploading(null);
  };

  const handleScavengerSubmit = async () => {
    const items = (engagement.config?.questions as string[]) ?? [];
    const answers: Record<string, { text?: string; photo?: string }> = {};
    for (let i = 0; i < items.length; i++) {
      const it = shItems[i];
      const text = it?.text?.trim();
      if (text && hasProfanity(text)) {
        alert("Let's keep it kind — please reword.");
        return;
      }
      if (text || it?.photo) {
        answers[i] = { ...(text ? { text } : {}), ...(it?.photo ? { photo: it.photo } : {}) };
      }
    }
    if (Object.keys(answers).length === 0) {
      alert("Answer at least one item (a photo or some text).");
      return;
    }
    setSubmitting(true);
    const { error: shErr } = await saveResponse({ answers });
    setSubmitting(false);
    if (shErr) alert("Couldn't submit: " + shErr);
  };

  const handleCareSubmit = async () => {
    const qs = parseCareQuestions(engagement.config);
    const defVis: "host" | "group" | "anon" = engagement.private_to_host
      ? "host"
      : "group";
    // One row per answered question, each carrying its own visibility.
    const rows: {
      q_index: number;
      value: string;
      share_to_group: boolean;
      anonymous: boolean;
    }[] = [];
    for (let i = 0; i < qs.length; i++) {
      const v = careAnswers[i];
      let value = "";
      if (qs[i].kind === "star") {
        if (typeof v === "number" && v >= 1) value = String(v);
      } else {
        const text = typeof v === "string" ? v.trim() : "";
        if (text && hasProfanity(text)) {
          alert("Let's keep it kind — please reword.");
          return;
        }
        value = text;
      }
      if (!value) continue;
      const mode = careVis[i] ?? defVis;
      rows.push({
        q_index: i,
        value,
        share_to_group: mode !== "host",
        anonymous: mode === "anon",
      });
    }
    if (rows.length === 0) {
      alert("Fill in at least one question.");
      return;
    }
    setSubmitting(true);
    const { error: cErr } = await submitCareAnswers(
      rows,
      lateResponseAllowed && !hasResponded
    );
    setSubmitting(false);
    if (cErr) {
      alert("Couldn't submit: " + cErr);
    } else {
      setEditingResponse(false);
    }
  };

  // Photo challenge: add up to 3 photos/videos (uploaded but not submitted yet).
  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length || !user) return;
    const room = Math.max(0, 3 - mediaItems.length);
    if (room === 0) {
      alert("You can add up to 3.");
      e.target.value = "";
      return;
    }
    setUploading(true);
    const added: { url: string; type: string }[] = [];
    let idx = 0;
    for (const file of files.slice(0, room)) {
      const fileExt = file.name.split(".").pop();
      const filePath = `${user.id}/${engagementId}/${Date.now()}-${idx++}.${fileExt}`;
      const { error: uploadError } = await supabase.storage
        .from("campfire-media")
        .upload(filePath, file);
      if (uploadError) {
        alert("Upload failed: " + uploadError.message);
        continue;
      }
      const { data: urlData } = supabase.storage
        .from("campfire-media")
        .getPublicUrl(filePath);
      added.push({
        url: urlData.publicUrl,
        type: file.type.startsWith("video") ? "video" : "photo",
      });
    }
    setMediaItems((prev) => [...prev, ...added].slice(0, 3));
    setUploading(false);
    e.target.value = ""; // let the same file be re-picked
  };

  // Submit the photo-challenge response (the collected photos + optional caption).
  const submitPhotos = async () => {
    if (mediaItems.length === 0 && !textInput.trim()) {
      alert("Add a photo (or a caption).");
      return;
    }
    setSubmitting(true);
    await saveResponse({
      media_items: mediaItems,
      // Keep the single fields for back-compat with older readers.
      media_url: mediaItems[0]?.url,
      media_type: mediaItems[0]?.type,
      caption: textInput.trim() || undefined,
    });
    setSubmitting(false);
    setTextInput("");
    setMediaItems([]);
  };

  const handleCommentSubmit = async () => {
    if (!commentText.trim()) return;
    if (hasProfanity(commentText)) {
      alert("Let's keep it kind — please reword your comment.");
      return;
    }
    await addComment(commentText.trim(), undefined, engagement.allow_anon_replies && commentAnon);
    setCommentText("");
  };

  // ── Render helpers ──

  const renderResponseForm = () => {
    if (hasResponded && !editingResponse) return null;

    switch (engagement.type) {
      case "scavenger_hunt": {
        const items = (engagement.config?.questions as string[]) ?? [];
        return (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Answer each with a photo or a typed answer — any order. Lock in when you&apos;re
              done.
            </p>
            {items.map((item, i) => (
              <div key={i} className="rounded-xl border border-slate-200 p-3">
                <div className="text-sm font-medium text-slate-700 mb-1.5">
                  {i + 1}. {item}
                </div>
                <textarea
                  value={shItems[i]?.text ?? ""}
                  onChange={(e) =>
                    setShItems({ ...shItems, [i]: { ...shItems[i], text: e.target.value } })
                  }
                  rows={2}
                  placeholder="Type your answer…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-lime-500 outline-none resize-none"
                />
                <div className="mt-1.5 flex items-center gap-2">
                  <label className="cursor-pointer rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
                    {shUploading === i
                      ? "Uploading…"
                      : shItems[i]?.photo
                      ? "📷 Replace photo"
                      : "📷 Add photo"}
                    <input
                      type="file"
                      accept="image/*,video/*"
                      className="hidden"
                      onChange={(e) => handleScavengerUpload(i, e.target.files?.[0])}
                    />
                  </label>
                  {shItems[i]?.photo && (
                    <button
                      type="button"
                      onClick={() =>
                        setShItems((prev) => ({ ...prev, [i]: { ...prev[i], photo: undefined } }))
                      }
                      className="text-xs text-slate-400 hover:text-red-500"
                    >
                      remove
                    </button>
                  )}
                </div>
                {shItems[i]?.photo && (
                  <img
                    src={shItems[i].photo}
                    alt=""
                    className="mt-2 max-h-32 rounded-lg object-cover"
                  />
                )}
              </div>
            ))}
            <button
              onClick={handleScavengerSubmit}
              disabled={submitting || shUploading !== null}
              className="w-full rounded-xl bg-gradient-to-r from-lime-500 to-green-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "🔒 Lock In My Hunt"}
            </button>
          </div>
        );
      }

      case "accountability": {
        const qs = (engagement.config?.questions as string[]) ?? [];
        return (
          <div className="space-y-4">
            <p className="text-xs text-slate-500">
              Rate yourself honestly, 1 (struggled) to 5 (strong).
            </p>
            {qs.map((q, i) => (
              <div key={i}>
                <div className="text-sm font-medium text-slate-700 mb-1.5">
                  🙏 {q}
                </div>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setAcRatings({ ...acRatings, [i]: n })}
                      className={`flex-1 rounded-lg border py-2 text-sm font-semibold transition ${
                        acRatings[i] === n
                          ? "border-violet-500 bg-violet-500 text-white"
                          : "border-slate-200 bg-white text-slate-600 hover:border-violet-300"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Share with the group{" "}
                <span className="text-slate-400">(optional)</span>
              </label>
              <textarea
                value={acNote}
                onChange={(e) => setAcNote(e.target.value)}
                rows={3}
                placeholder="An encouragement, a verse, a prayer request… shown to everyone at the reveal."
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-violet-500 outline-none resize-none"
              />
            </div>
            <button
              onClick={handleAccountabilitySubmit}
              disabled={submitting}
              className="w-full rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "🔒 Lock In My Check-in"}
            </button>
          </div>
        );
      }

      case "care": {
        const qs = parseCareQuestions(engagement.config);
        const defVis: CareVis = engagement.private_to_host ? "host" : "group";
        const visOf = (i: number): CareVis => careVis[i] ?? defVis;
        const setVis = (i: number, m: CareVis) =>
          setCareVis((v) => ({ ...v, [i]: m }));
        const VIS: { m: CareVis; icon: string; label: string }[] = [
          { m: "host", icon: "🔒", label: "Only the host sees this" },
          { m: "group", icon: "👥", label: "Share with the group" },
          { m: "anon", icon: "🙈", label: "Share with the group, anonymously" },
        ];
        return (
          <div className="space-y-4">
            <p className="text-xs text-slate-500">
              Fill in any or all. On each, tap who sees it — 🔒 just the host · 👥 the
              group · 🙈 the group, but not your name.
            </p>
            {qs.map((q, i) => (
              <div key={i}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="text-sm font-medium text-slate-700">
                    {q.prompt}
                  </label>
                  <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-slate-200 bg-white p-0.5">
                    {VIS.map((o) => (
                      <button
                        key={o.m}
                        type="button"
                        title={o.label}
                        aria-label={o.label}
                        onClick={() => setVis(i, o.m)}
                        className={`rounded-full px-1.5 py-0.5 text-xs leading-none transition ${
                          visOf(i) === o.m
                            ? "bg-teal-500/15 ring-1 ring-teal-400"
                            : "opacity-35 hover:opacity-90"
                        }`}
                      >
                        {o.icon}
                      </button>
                    ))}
                  </div>
                </div>
                {q.kind === "star" ? (
                  <div className="flex gap-1.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setCareAnswers({ ...careAnswers, [i]: n })}
                        className={`flex-1 rounded-lg border py-2 text-sm font-semibold transition ${
                          careAnswers[i] === n
                            ? "border-teal-500 bg-teal-500 text-white"
                            : "border-slate-200 bg-white text-slate-600 hover:border-teal-300"
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                ) : (
                  <textarea
                    value={typeof careAnswers[i] === "string" ? (careAnswers[i] as string) : ""}
                    onChange={(e) => setCareAnswers({ ...careAnswers, [i]: e.target.value })}
                    rows={3}
                    placeholder="(optional)"
                    className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-teal-500 outline-none resize-y"
                  />
                )}
              </div>
            ))}
            <button
              onClick={handleCareSubmit}
              disabled={submitting}
              className="w-full rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Send my check-in"}
            </button>
          </div>
        );
      }

      case "most_likely": {
        const qs = (engagement.config?.questions as string[]) ?? [];
        return (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Vote a group-mate for each award. Sealed until the reveal.
            </p>
            {qs.map((q, i) => (
              <div key={i}>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  🏆 {q}
                </label>
                <input
                  type="text"
                  list={`roster-${i}`}
                  value={mlVotes[i] ?? ""}
                  onChange={(e) => setMlVotes({ ...mlVotes, [i]: e.target.value })}
                  placeholder="Type a name…"
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm bg-white focus:border-orange-500 outline-none"
                />
                <datalist id={`roster-${i}`}>
                  {roster.map((m) => (
                    <option key={m.user_id} value={m.name} />
                  ))}
                </datalist>
              </div>
            ))}
            <button
              onClick={handleMostLikelySubmit}
              disabled={submitting}
              className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "🔒 Lock In My Votes"}
            </button>
          </div>
        );
      }

      case "baby_reveal":
        return (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">
              Lock in your guess — it stays sealed until the reveal date.
            </p>
            {pollOptions.map((opt) => (
              <button
                key={opt}
                onClick={() => setSelectedOption(opt)}
                className={`w-full text-left rounded-xl border p-3 text-sm transition ${
                  selectedOption === opt
                    ? "border-sky-500 bg-sky-50 font-semibold"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                {opt}
              </button>
            ))}
            <button
              onClick={handlePollSubmit}
              disabled={!selectedOption || submitting}
              className="w-full rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "🍼 Lock In My Guess"}
            </button>
          </div>
        );

      case "two_truths":
        return (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              Write three statements about yourself — two true, one a lie. Tap the
              circle on the one that&apos;s the lie. Everyone guesses it later.
            </p>
            {ttStatements.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTtLie(i)}
                  title="Mark this one as the lie"
                  className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs ${
                    ttLie === i
                      ? "border-rose-500 bg-rose-500 text-white"
                      : "border-slate-300 text-transparent hover:border-rose-300"
                  }`}
                >
                  {ttLie === i ? "🤥" : ""}
                </button>
                <input
                  type="text"
                  value={s}
                  onChange={(e) => {
                    const next = [...ttStatements];
                    next[i] = e.target.value;
                    setTtStatements(next);
                  }}
                  placeholder={`Statement ${i + 1}`}
                  className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 outline-none"
                />
              </div>
            ))}
            <p className="text-xs text-slate-400">
              {ttLie === null ? "Tap a circle to mark your lie 🤥" : `Statement ${ttLie + 1} is your lie.`}
            </p>
            <button
              onClick={handleTwoTruthsSubmit}
              disabled={submitting}
              className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "🔒 Lock In My Three"}
            </button>
          </div>
        );

      case "poll":
        // Open-ended poll: free-text answer to each open question.
        if (isOpenPoll) {
          return (
            <div className="space-y-4">
              {pollOpenQuestions.map((q, i) => (
                <div key={i}>
                  {pollOpenQuestions.length > 1 && (
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {q}
                    </label>
                  )}
                  <textarea
                    value={openPollAnswers[i] ?? ""}
                    onChange={(e) =>
                      setOpenPollAnswers({ ...openPollAnswers, [i]: e.target.value })
                    }
                    placeholder="Type your answer…"
                    rows={3}
                    className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 outline-none resize-none"
                  />
                </div>
              ))}
              <button
                onClick={handleOpenPollSubmit}
                disabled={submitting}
                className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
              >
                {submitting ? "Submitting..." : "🔒 Submit My Answer"}
              </button>
            </div>
          );
        }
        return (
          <div className="space-y-2">
            {pollOptions.map((opt) => (
              <button
                key={opt}
                onClick={() => setSelectedOption(opt)}
                className={`w-full text-left rounded-xl border p-3 text-sm transition ${
                  selectedOption === opt
                    ? "border-orange-500 bg-orange-50 font-semibold"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                {opt}
              </button>
            ))}
            <button
              onClick={handlePollSubmit}
              disabled={!selectedOption || submitting}
              className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "🔒 Lock In My Vote"}
            </button>
          </div>
        );

      case "challenge":
      case "photo_pose":
        return (
          <div className="space-y-3">
            <textarea
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Add a caption, recipe, or details (optional)"
              rows={3}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 outline-none resize-none"
            />
            {mediaItems.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {mediaItems.map((m, i) => (
                  <div key={i} className="relative overflow-hidden rounded-lg">
                    {m.type === "video" ? (
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      <video src={m.url} className="h-24 w-full object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.url} alt="" className="h-24 w-full object-cover" />
                    )}
                    <button
                      onClick={() =>
                        setMediaItems((prev) => prev.filter((_, j) => j !== i))
                      }
                      aria-label="Remove"
                      className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-xs text-white"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={handleMediaUpload}
              className="hidden"
            />
            {mediaItems.length < 3 && (
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full rounded-xl border-2 border-dashed border-orange-300 bg-orange-50 px-4 py-3 text-sm font-bold text-orange-700 disabled:opacity-50"
              >
                {uploading
                  ? "Uploading…"
                  : mediaItems.length === 0
                  ? "📸 Add Photos or Video (up to 3)"
                  : `📸 Add more (${mediaItems.length}/3)`}
              </button>
            )}
            <button
              onClick={submitPhotos}
              disabled={submitting || uploading || (mediaItems.length === 0 && !textInput.trim())}
              className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit"}
            </button>
          </div>
        );

      case "voice_response":
        return (
          <div className="text-center py-6">
            <div className="text-4xl mb-3">🎤</div>
            <p className="text-sm text-slate-500 mb-3">
              Voice recording requires native app. For now, submit a text response.
            </p>
            <textarea
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Type your response..."
              rows={3}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 outline-none resize-none mb-3"
            />
            <button
              onClick={handleTextSubmit}
              disabled={!textInput.trim() || submitting}
              className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Submit Response"}
            </button>
          </div>
        );

      case "truth_or_dare": {
        const todCfg = engagement.config as {
          truthPrompt?: string;
          darePrompt?: string;
        };
        const todPromptFor = (m: "truth" | "dare") =>
          (m === "truth" ? todCfg.truthPrompt : todCfg.darePrompt)?.trim() ||
          (m === "truth" ? "Tell us a truth." : "Do a dare — then describe it.");

        // Blind commit: no prompts shown until you pick. No takebacks.
        if (!todMode) {
          return (
            <div className="space-y-3">
              <p className="text-center text-xs text-slate-500">
                Pick one — you won&apos;t see the prompt until you commit.{" "}
                <span className="font-semibold">No takebacks!</span>
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setTodMode("truth")}
                  className="rounded-2xl border-2 border-sky-200 bg-sky-50 px-3 py-6 text-center font-extrabold text-sky-700 hover:border-sky-400 hover:bg-sky-100 transition"
                >
                  <div className="text-3xl">🤐</div>
                  <div className="mt-1 text-base">Truth</div>
                </button>
                <button
                  type="button"
                  onClick={() => setTodMode("dare")}
                  className="rounded-2xl border-2 border-rose-200 bg-rose-50 px-3 py-6 text-center font-extrabold text-rose-700 hover:border-rose-400 hover:bg-rose-100 transition"
                >
                  <div className="text-3xl">🔥</div>
                  <div className="mt-1 text-base">Dare</div>
                </button>
              </div>
            </div>
          );
        }

        // Committed — reveal the prompt and let them answer (mode is locked).
        const isTruth = todMode === "truth";
        return (
          <div className="space-y-3">
            <div
              className={`rounded-xl border p-3 ${
                isTruth
                  ? "border-sky-200 bg-sky-50"
                  : "border-rose-200 bg-rose-50"
              }`}
            >
              <div
                className={`text-[11px] font-bold uppercase tracking-wide ${
                  isTruth ? "text-sky-700" : "text-rose-700"
                }`}
              >
                {isTruth ? "🤐 Truth" : "🔥 Dare"} · you&apos;re locked in
              </div>
              <p className="mt-1 text-sm font-medium text-slate-800">
                {todPromptFor(todMode)}
              </p>
            </div>
            <textarea
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder={isTruth ? "Your answer…" : "How did it go? (proof welcome)"}
              rows={4}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 outline-none resize-none"
            />
            {/* Optional proof photo — handy when the dare needs it */}
            {todPhoto ? (
              <div className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={todPhoto}
                  alt="Your proof"
                  className="max-h-48 rounded-xl border border-slate-200 object-cover"
                />
                <button
                  type="button"
                  onClick={() => setTodPhoto(null)}
                  className="absolute -top-2 -right-2 h-6 w-6 rounded-full border border-slate-300 bg-white text-xs text-slate-500 shadow hover:text-red-600"
                  aria-label="Remove photo"
                >
                  ✕
                </button>
              </div>
            ) : (
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                {todUploading ? "Uploading…" : "📷 Add a photo (optional)"}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={todUploading}
                  onChange={(e) => handleTodPhotoUpload(e.target.files?.[0])}
                />
              </label>
            )}
            <button
              onClick={handleTruthOrDareSubmit}
              disabled={(!textInput.trim() && !todPhoto) || submitting || todUploading}
              className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "🔒 Lock in my answer"}
            </button>
          </div>
        );
      }

      default:
        // Generic text response (share, accountability, advice, etc.)
        return (
          <div className="space-y-3">
            <textarea
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Type your response..."
              rows={4}
              className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-orange-500 outline-none resize-none"
            />
            <button
              onClick={handleTextSubmit}
              disabled={!textInput.trim() || submitting}
              className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "🔒 Submit Response"}
            </button>
          </div>
        );
    }
  };

  const renderPollResults = () => {
    // Open-ended polls have no bars — their text answers render below instead.
    if (!showResults || engagement.type !== "poll" || isOpenPoll) return null;

    const votes: Record<string, number> = {};
    pollOptions.forEach((o) => (votes[o] = 0));
    responses.forEach((r) => {
      const opt = r.content?.option as string;
      if (opt) votes[opt] = (votes[opt] ?? 0) + 1;
    });
    const total = responses.length || 1;

    return (
      <div className="space-y-2">
        {pollOptions.map((opt) => {
          const count = votes[opt] ?? 0;
          const pct = Math.round((count / total) * 100);
          return (
            <div key={opt} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="relative px-4 py-3">
                <div
                  className="absolute inset-0 bg-gradient-to-r from-orange-100 to-rose-100 transition-all"
                  style={{ width: `${pct}%` }}
                />
                <div className="relative flex justify-between items-center">
                  <span className="text-sm font-medium text-slate-900">{opt}</span>
                  <span className="text-sm font-bold text-slate-700">{pct}% ({count})</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Open-ended poll: each open question with everyone's free-text answers.
  // Sign-up: the live claimable list (claim/release slots, see who's got what).
  const renderSignup = () => {
    if (engagement.type !== "signup") return null;
    const slots =
      (engagement.config?.slots as {
        label: string;
        capacity: number;
        need?: number;
      }[]) ?? [];
    const myClaimSet =
      (myResponse?.content as { claims?: number[] })?.claims ?? [];
    const claimantsOf = (i: number) =>
      responses.filter((r) =>
        ((r.content as { claims?: number[] })?.claims ?? []).includes(i)
      );
    // capacity 0 = "any number" (unlimited) — excluded from the filled ratio.
    const isUnlimited = (s: { capacity: number }) => s.capacity === 0;
    const totalCap = slots.reduce(
      (a, s) => a + (isUnlimited(s) ? 0 : Math.max(1, s.capacity)),
      0
    );
    const totalClaimed = slots.reduce(
      (a, s, i) => a + (isUnlimited(s) ? 0 : claimantsOf(i).length),
      0
    );
    // A Sign-up stays live (claimable) — it doesn't lock on a reveal.
    const open = engagement.status === "active" || engagement.status === "revealed";
    const partyWhen = (engagement.config?.partyWhen as string | undefined)?.trim();
    const partyWhere = (engagement.config?.partyWhere as string | undefined)?.trim();
    // RSVP — who's coming. Gated on a host flag (config.rsvp).
    // RSVP is part of the sign-up by default — people answer it when they respond,
    // not as a separate ask. A host can opt out (config.rsvp === false).
    const rsvpOn = engagement.config?.rsvp !== false;
    const rsvpOf = (v: string) =>
      responses
        .filter((r) => (r.content as { attending?: string })?.attending === v)
        .map((r) => memberNameOf(r.user_id, r.profile?.display_name));
    const goingNames = rsvpOf("yes");
    const maybeNames = rsvpOf("maybe");
    const cantCount = rsvpOf("no").length;
    const myRsvp = (myResponse?.content as { attending?: string })?.attending;

    // ── Gift exchange ──
    const gx = giftexCfg;
    const gxByGender = !!gx?.byGender;
    const gxAssign = gx?.assign ?? "person";
    const goingResponses = responses.filter(
      (r) => (r.content as { attending?: string })?.attending === "yes"
    );
    const genderOf = (r: (typeof responses)[number]) =>
      (r.content as { gender?: string })?.gender;
    const maleRecip = goingResponses.filter((r) => genderOf(r) === "male").length;
    const femaleRecip = goingResponses.filter((r) => genderOf(r) === "female").length;
    const pickedMale = responses.filter(
      (r) => (r.content as { giftFor?: string })?.giftFor === "male"
    ).length;
    const pickedFemale = responses.filter(
      (r) => (r.content as { giftFor?: string })?.giftFor === "female"
    ).length;
    const maleLeft = Math.max(0, maleRecip - pickedMale);
    const femaleLeft = Math.max(0, femaleRecip - pickedFemale);
    const myGender = myContent().gender as string | undefined;
    const myGiftFor = myContent().giftFor as string | undefined;
    const gxRevealedAt = engagement.config?.giftexRevealedAt as string | undefined;
    const gxRevealList = (engagement.config?.giftexReveal ?? []) as Array<{
      buyer: string;
      recipient: string | null;
      gender: string | null;
    }>;

    // Free-text items members said they're bringing (not tied to a slot).
    const extraItems: { label: string; member: string; mine: boolean }[] = [];
    responses.forEach((r) => {
      const ex = (r.content as { extras?: string[] })?.extras ?? [];
      ex.forEach((label) =>
        extraItems.push({
          label,
          member: memberNameOf(r.user_id, r.profile?.display_name),
          mine: !!user && r.user_id === user.id,
        })
      );
    });

    // Two columns: what's COMMITTED (claimed slots + free-text brings) and what's
    // STILL NEEDED (slots with open capacity).
    const committedRows: {
      key: string;
      label: string;
      who: string;
      mine: boolean;
      slotIndex?: number;
      extra?: string;
    }[] = [];
    slots.forEach((s, i) => {
      claimantsOf(i).forEach((c) => {
        committedRows.push({
          key: `s${i}-${c.user_id}`,
          label: s.label,
          who: memberNameOf(c.user_id, c.profile?.display_name),
          mine: !!user && c.user_id === user.id,
          slotIndex: i,
        });
      });
    });
    extraItems.forEach((it, i) =>
      committedRows.push({
        key: `e${i}`,
        label: it.label,
        who: it.member,
        mine: it.mine,
        extra: it.label,
      })
    );
    // Each slot has a soft target (need) and a hard cap (capacity; 0 = unlimited):
    //   n < need            → "needed"  (amber, Claim)
    //   need ≤ n < capacity  → "covered" (green, more welcome)
    //   n ≥ capacity         → full (drops out — type it below to insist)
    const neededRows = slots
      .map((s, i) => {
        const unlimited = isUnlimited(s);
        const cap = unlimited ? Infinity : Math.max(1, s.capacity);
        const n = claimantsOf(i).length;
        const need = s.need && s.need > 0 ? s.need : unlimited ? null : cap;
        const full = n >= cap;
        const state: "needed" | "covered" | "welcome" =
          need == null ? "welcome" : n < need ? "needed" : "covered";
        return {
          key: `n${i}`,
          label: s.label,
          i,
          unlimited,
          left: need != null ? Math.max(0, need - n) : 0,
          state,
          full,
          mine: myClaimSet.includes(i),
        };
      })
      .filter((x) => !x.full);
    // Anything still short of its target?
    const finiteStillNeeded = neededRows.some((x) => x.state === "needed");

    // Curated bring-ideas to prompt attendees — essentials (drinks, and tableware
    // if disposables are wanted) plus crowd-pleasers — minus anything already on
    // the list or being brought.
    const covered = new Set(
      [
        ...slots.map((s) => s.label),
        ...extraItems.map((e) => e.label),
      ].map((l) => l.trim().toLowerCase())
    );
    const disposables = !!engagement.config?.disposables;
    const essentials = [
      "Drinks / juice",
      "Water",
      "Ice",
      ...(disposables ? ["Cups", "Plates", "Napkins", "Cutlery"] : []),
    ];
    const niceToHave = [
      "Chips & dip",
      "Veggie tray",
      "Fruit platter",
      "Cheese & crackers",
      "Cookies / dessert",
      "Popcorn",
      "Decorations",
      "Music playlist",
      "A game / activity",
      "Serving spoons",
      "Trash bags",
    ];
    const ideaFresh = (l: string) => !covered.has(l.trim().toLowerCase());
    const essentialIdeas = essentials.filter(ideaFresh);
    const niceIdeas = niceToHave.filter(ideaFresh);

    return (
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold text-slate-900">📋 Sign-up</h2>
          <span className="text-xs text-slate-500">
            {totalClaimed}/{totalCap} filled
          </span>
        </div>
        {(partyWhen || partyWhere) && (
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {partyWhen && (
              <span className="inline-flex items-center gap-1.5">
                📅 <span className="font-medium">{partyWhen}</span>
              </span>
            )}
            {partyWhere && (
              <span className="inline-flex items-center gap-1.5">
                📍 <span className="font-medium">{partyWhere}</span>
              </span>
            )}
          </div>
        )}

        {/* RSVP — will you be there? + who's coming */}
        {rsvpOn && (
          <div className="mb-4">
            {open && (
              <div className="mb-2">
                <div className="mb-1 text-sm font-medium text-slate-700">
                  Will you be there?
                </div>
                <div className="flex gap-2">
                  {([
                    ["yes", "✅ Going"],
                    ["maybe", "🤔 Maybe"],
                    ["no", "❌ Can't"],
                  ] as const).map(([v, label]) => (
                    <button
                      key={v}
                      onClick={() => setAttending(v)}
                      disabled={signupBusy}
                      className={`rounded-full px-3 py-1.5 text-xs font-bold transition disabled:opacity-60 ${
                        myRsvp === v
                          ? "bg-emerald-500 text-white hover:opacity-90"
                          : "border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {giftexOn && gxByGender && myRsvp === "yes" && (
                  <div className="mt-2">
                    <div className="mb-1 text-xs text-slate-500">
                      You are (for the gift exchange):
                    </div>
                    <div className="flex gap-2">
                      {(["male", "female"] as const).map((g) => (
                        <button
                          key={g}
                          onClick={() => setMyGender(g)}
                          disabled={signupBusy}
                          className={`rounded-full px-3 py-1.5 text-xs font-bold transition disabled:opacity-60 ${
                            myGender === g
                              ? "bg-violet-500 text-white hover:opacity-90"
                              : "border border-violet-300 bg-white text-violet-700 hover:bg-violet-50"
                          }`}
                        >
                          {g === "male" ? "👦 Boy / Man" : "👧 Girl / Woman"}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {(goingNames.length > 0 || maybeNames.length > 0 || cantCount > 0) && (
              <div className="rounded-xl bg-emerald-50 px-3 py-2">
                <div className="text-sm font-semibold text-emerald-800">
                  🎉 Coming ({goingNames.length})
                </div>
                {goingNames.length > 0 && (
                  <div className="text-xs text-slate-600">{goingNames.join(", ")}</div>
                )}
                {maybeNames.length > 0 && (
                  <div className="mt-1 text-xs text-slate-500">
                    Maybe ({maybeNames.length}): {maybeNames.join(", ")}
                  </div>
                )}
                {cantCount > 0 && (
                  <div className="mt-1 text-xs text-slate-400">
                    Can&apos;t make it: {cantCount}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Host opt-out — RSVP is on by default (no separate ask) */}
        {isCreator && open && (
          <button
            onClick={toggleRsvp}
            className="mb-3 text-[11px] font-medium text-slate-400 hover:text-slate-600"
          >
            {rsvpOn ? "Don't ask who's coming" : "+ Ask who's coming (RSVP)"}
          </button>
        )}

        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          {/* Committed — claimed slots + free-text brings */}
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
              ✅ Committed ({committedRows.length})
            </div>
            <div className="space-y-1.5">
              {committedRows.length === 0 && (
                <div className="text-xs text-slate-400">Nothing yet — be the first!</div>
              )}
              {committedRows.map((row) => (
                <div
                  key={row.key}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">
                      {row.label}
                    </div>
                    <div className="truncate text-xs text-slate-500">{row.who}</div>
                  </div>
                  {row.mine && open && (
                    <button
                      onClick={() =>
                        row.extra !== undefined
                          ? removeExtra(row.extra)
                          : toggleClaim(row.slotIndex as number)
                      }
                      disabled={signupBusy}
                      title="Remove"
                      className="flex-shrink-0 text-slate-400 hover:text-rose-500 disabled:opacity-50"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* To bring — still-needed (amber), covered-but-welcome (green), any-number */}
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
              📝 To bring ({neededRows.length})
            </div>
            <div className="space-y-1.5">
              {neededRows.length === 0 && (
                <div className="text-xs font-medium text-emerald-700">
                  ✅ Everything&apos;s covered — thank you!
                </div>
              )}
              {neededRows.length > 0 && !finiteStillNeeded && (
                <div className="mb-1 text-xs font-medium text-emerald-700">
                  ✅ The essentials are covered — anything below is a bonus.
                </div>
              )}
              {neededRows.map((row) => {
                const covered = row.state === "covered";
                const welcome = row.state === "welcome";
                return (
                  <div
                    key={row.key}
                    className={`flex items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2 ${
                      covered
                        ? "border-emerald-300 bg-emerald-50/50"
                        : welcome
                        ? "border-cyan-200 bg-cyan-50/40"
                        : "border-amber-300 bg-amber-50/40"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900">
                        {row.label}
                      </div>
                      <div
                        className={`text-xs ${
                          covered ? "text-emerald-600" : "text-slate-500"
                        }`}
                      >
                        {covered
                          ? "Got enough — extra welcome"
                          : welcome
                          ? "Any number welcome"
                          : row.left > 1
                          ? `${row.left} more needed`
                          : "Needed"}
                      </div>
                    </div>
                    <button
                      onClick={() => toggleClaim(row.i)}
                      disabled={!open || signupBusy || row.mine}
                      className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
                        row.mine
                          ? "bg-cyan-500 text-white"
                          : covered
                          ? "border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50"
                          : "border border-cyan-300 bg-white text-cyan-700 hover:bg-cyan-50"
                      }`}
                    >
                      {row.mine
                        ? "✓ You"
                        : covered
                        ? "Bring more?"
                        : welcome
                        ? "+ Bring"
                        : "Claim"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bring-ideas to prompt attendees — tap to add what you'll bring */}
        {open && (essentialIdeas.length > 0 || niceIdeas.length > 0) && (
          <div className="mt-3 rounded-xl border border-cyan-100 bg-cyan-50/50 p-3">
            <div className="mb-1.5 text-xs font-medium text-slate-600">
              💡 Need ideas? Tap to add what you&apos;ll bring:
            </div>
            {essentialIdeas.length > 0 && (
              <div className="mb-2">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-rose-500">
                  Essentials
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {essentialIdeas.map((label) => (
                    <button
                      key={label}
                      onClick={() => addExtra(label)}
                      disabled={signupBusy}
                      className="rounded-full border border-rose-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                    >
                      + {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {niceIdeas.length > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Nice to have
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {niceIdeas.map((label) => (
                    <button
                      key={label}
                      onClick={() => addExtra(label)}
                      disabled={signupBusy}
                      className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-cyan-50 disabled:opacity-50"
                    >
                      + {label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Anyone can add what they're bringing, even if it's not a listed slot */}
        {open && (
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={extraInput}
              onChange={(e) => setExtraInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addExtra(extraInput);
                }
              }}
              placeholder="Bringing something else? Add it…"
              className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan-500"
            />
            <button
              onClick={() => addExtra(extraInput)}
              disabled={signupBusy || !extraInput.trim()}
              className="flex-shrink-0 rounded-full bg-cyan-500 px-4 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-40"
            >
              Add
            </button>
          </div>
        )}

        {/* Host: AI balances the list (targets + caps) for the headcount */}
        {isCreator && open && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <button
              onClick={aiBalance}
              disabled={suggesting}
              className="rounded-full border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50"
            >
              {suggesting ? "Planning…" : "✨ AI: balance the list"}
            </button>
            <p className="mt-1 text-[11px] text-slate-400">
              Sets a target and a sensible limit on each item for your headcount, and
              fills any gaps — so a dinner doesn&apos;t end up all salads.
            </p>
            {/* Host can also type their own item onto the claimable list */}
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={hostSlotLabel}
                onChange={(e) => setHostSlotLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && hostSlotLabel.trim()) {
                    e.preventDefault();
                    addSignupSlot(
                      hostSlotLabel.trim(),
                      hostSlotCount === 0 ? 0 : Math.max(1, hostSlotCount)
                    );
                    setHostSlotLabel("");
                    setHostSlotCount(1);
                  }
                }}
                placeholder="Or add your own — e.g. Napkins"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-cyan-500"
              />
              {hostSlotCount === 0 ? (
                <span className="w-10 rounded-lg border border-cyan-300 bg-cyan-50 py-1.5 text-center text-sm font-semibold text-cyan-700">
                  ∞
                </span>
              ) : (
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={hostSlotCount}
                  onChange={(e) => setHostSlotCount(parseInt(e.target.value || "1", 10))}
                  title="How many people can bring this"
                  className="w-10 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-center outline-none focus:border-cyan-500"
                />
              )}
              <button
                type="button"
                onClick={() => setHostSlotCount(hostSlotCount === 0 ? 1 : 0)}
                title={hostSlotCount === 0 ? "Set a number" : "Any number can bring this"}
                className="px-1 text-sm font-bold text-slate-400 hover:text-cyan-600"
              >
                {hostSlotCount === 0 ? "#" : "∞"}
              </button>
              <button
                onClick={() => {
                  const l = hostSlotLabel.trim();
                  if (!l) return;
                  addSignupSlot(l, hostSlotCount === 0 ? 0 : Math.max(1, hostSlotCount));
                  setHostSlotLabel("");
                  setHostSlotCount(1);
                }}
                disabled={!hostSlotLabel.trim()}
                className="flex-shrink-0 rounded-full bg-cyan-500 px-4 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>
        )}

        {/* Group chip-ins — an engagement can have several (one per guest). Each
            member starts at most one; the host can start more. */}
        {(gifts.length > 0 || open) && (
          <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
            {gifts.map((g) => {
              const t = giftTotals[g.id] ?? { total_cents: 0, contributors: 0 };
              const canSee =
                giftShowTotal || isCreator || g.initiated_by === user?.id;
              const who = g.recipient_name || "the recipient";
              return (
                <div
                  key={g.id}
                  className="rounded-xl border border-orange-200 bg-gradient-to-br from-orange-50 to-rose-50 p-4"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="text-sm font-bold text-slate-900">
                      🎁 Gift for {who}
                    </div>
                    {t.contributors > 0 && canSee && (
                      <span className="text-sm font-bold text-orange-700">
                        {formatMoney(t.total_cents, g.currency)} · {t.contributors}{" "}
                        {t.contributors === 1 ? "person" : "people"}
                      </span>
                    )}
                  </div>
                  {g.issued_at ? (
                    <p className="text-sm text-slate-600">
                      ✅ The gift card was sent to {who}. Thank you!
                    </p>
                  ) : (
                    <>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {[500, 1000, 2000].map((cents) => (
                          <button
                            key={cents}
                            onClick={() => chipIn(cents, g.id)}
                            disabled={chippingIn}
                            className="rounded-full border border-orange-300 bg-white px-3.5 py-1.5 text-sm font-bold text-orange-700 hover:bg-orange-100 disabled:opacity-50"
                          >
                            {formatMoney(cents, g.currency)}
                          </button>
                        ))}
                        <button
                          onClick={() => {
                            const cur = (g.currency || "usd").toUpperCase();
                            const v = window.prompt(`Chip in how much? (${cur})`);
                            const n = v ? Math.round(parseFloat(v) * 100) : 0;
                            if (n >= 100) chipIn(n, g.id);
                            else if (v) alert("Minimum is 1.");
                          }}
                          disabled={chippingIn}
                          className="rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Other…
                        </button>
                      </div>
                      {(isCreator || g.initiated_by === user?.id) &&
                        t.total_cents > 0 && (
                          <button
                            onClick={() => sendGift(g.id)}
                            disabled={sendingGift}
                            className="mt-3 w-full rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                          >
                            {sendingGift
                              ? "Sending…"
                              : `Send the gift now (${formatMoney(
                                  t.total_cents,
                                  g.currency
                                )}) →`}
                          </button>
                        )}
                      <p className="mt-2 text-[11px] text-slate-400">
                        Fees are added on top so {who} gets the full amount.
                      </p>
                    </>
                  )}
                </div>
              );
            })}

            {/* Start a chip-in — host can start several; others, one each. */}
            {open && (isCreator || !gifts.some((g) => g.initiated_by === user?.id)) && (
              showStartGift ? (
              <div className="space-y-2 rounded-xl border border-orange-200 bg-orange-50/50 p-3">
                <div className="text-xs font-medium text-slate-700">
                  🎁 Chip in for a gift — who&apos;s it for?
                </div>
                <input
                  type="email"
                  value={startGiftEmail}
                  onChange={(e) => setStartGiftEmail(e.target.value)}
                  placeholder="Recipient's email (where the gift card is sent)"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-500"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={startGiftName}
                    onChange={(e) => setStartGiftName(e.target.value)}
                    placeholder="Their name (optional)"
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-500"
                  />
                  <select
                    value={startGiftCurrency}
                    onChange={(e) => setStartGiftCurrency(e.target.value)}
                    className="rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-orange-500"
                  >
                    {GIFT_CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                {/* "All except" — keep it a surprise for a group member */}
                {roster.filter((m) => m.user_id !== user?.id).length > 0 && (
                  <div>
                    <select
                      value={startGiftSurpriseUid}
                      onChange={(e) => {
                        const uid = e.target.value;
                        setStartGiftSurpriseUid(uid);
                        // Prefill the name from the chosen member if it's empty.
                        const m = roster.find((r) => r.user_id === uid);
                        if (m && !startGiftName.trim()) setStartGiftName(m.name);
                      }}
                      className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-orange-500"
                    >
                      <option value="">Surprise a group member? (optional)</option>
                      {roster
                        .filter((m) => m.user_id !== user?.id)
                        .map((m) => (
                          <option key={m.user_id} value={m.user_id}>
                            Everyone except {m.name}
                          </option>
                        ))}
                    </select>
                    {startGiftSurpriseUid && (
                      <p className="mt-1 text-[11px] text-orange-700">
                        🤫 They won&apos;t see the chip-in — but can still join the
                        sign-up.
                      </p>
                    )}
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={startGift}
                    disabled={startingGift}
                    className="rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {startingGift ? "Starting…" : "Start chip-in"}
                  </button>
                  <button
                    onClick={() => setShowStartGift(false)}
                    className="text-xs font-medium text-slate-500 hover:text-slate-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowStartGift(true)}
                className="rounded-full border border-orange-300 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-700 hover:bg-orange-100"
              >
                🎁 Start a group chip-in for someone
              </button>
            )
            )}
          </div>
        )}

        {/* ── 🎁 Gift exchange (Secret Santa) ── */}
        {(giftexOn || (isCreator && open)) && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            {/* Host setup */}
            {isCreator && open && (
              <div className="mb-3 space-y-2 rounded-xl border border-violet-200 bg-violet-50/50 p-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={giftexOn}
                    onChange={(e) => setGiftexConfig({ on: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-violet-500 focus:ring-violet-500"
                  />
                  🎁 Gift exchange (Secret Santa)
                </label>
                {giftexOn && (
                  <>
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={gxByGender}
                        onChange={(e) => setGiftexConfig({ byGender: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-300 text-violet-500 focus:ring-violet-500"
                      />
                      Match by gender (everyone picks Boy/Girl when they RSVP)
                    </label>
                    <div>
                      <div className="mb-1 text-xs text-slate-500">How are buyers matched?</div>
                      <div className="flex flex-wrap gap-1.5">
                        {([
                          ["self", "Let people pick"],
                          ["person", "Random Secret Santa"],
                          ["gender", "Random by gender"],
                        ] as const).map(([v, label]) => {
                          const needsGender = v === "self" || v === "gender";
                          const disabled = needsGender && !gxByGender;
                          return (
                            <button
                              key={v}
                              onClick={() => setGiftexConfig({ assign: v })}
                              disabled={disabled}
                              title={disabled ? "Turn on 'Match by gender' first" : ""}
                              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition disabled:opacity-40 ${
                                gxAssign === v
                                  ? "border-violet-500 bg-violet-500 text-white"
                                  : "border-slate-200 bg-white text-slate-600 hover:border-violet-300"
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {(gxAssign === "person" || gxAssign === "gender") && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          onClick={() =>
                            runGiftexAssign(gxAssign === "gender" ? "gender" : "person")
                          }
                          disabled={giftexBusy}
                          className="rounded-full bg-violet-500 px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
                        >
                          🎲 {gxRevealedAt ? "Re-assign" : "Assign now"}
                        </button>
                        {!gxRevealedAt && (
                          <button
                            onClick={runGiftexReveal}
                            disabled={giftexBusy}
                            className="rounded-full border border-violet-300 bg-white px-3 py-1.5 text-xs font-bold text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                          >
                            👀 Reveal to everyone
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Participant: pick who you're buying for (by-gender, self-pick) */}
            {giftexOn && gxAssign === "self" && gxByGender && open && (
              <div className="mb-3">
                <div className="mb-1 text-sm font-medium text-slate-700">
                  Who are you buying a gift for?
                </div>
                <div className="flex flex-wrap gap-2">
                  {([
                    ["male", `👦 A boy${maleLeft > 0 ? ` · ${maleLeft} left` : ""}`, maleLeft <= 0 && myGiftFor !== "male"],
                    ["female", `👧 A girl${femaleLeft > 0 ? ` · ${femaleLeft} left` : ""}`, femaleLeft <= 0 && myGiftFor !== "female"],
                    ["either", "🎁 Either", false],
                  ] as const).map(([v, label, capFull]) => (
                    <button
                      key={v}
                      onClick={() => setGiftFor(v)}
                      disabled={signupBusy || capFull}
                      className={`rounded-full px-3 py-1.5 text-xs font-bold transition disabled:opacity-40 ${
                        myGiftFor === v
                          ? "bg-violet-500 text-white hover:opacity-90"
                          : "border border-violet-300 bg-white text-violet-700 hover:bg-violet-50"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Participant: my secret assignment (random modes) — only I can see this */}
            {giftexOn &&
              (gxAssign === "person" || gxAssign === "gender") &&
              myGiftexAssignment && (
                <div className="mb-3 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-violet-600">
                    🤫 Your secret assignment
                  </div>
                  <div className="text-sm font-bold text-slate-900">
                    {myGiftexAssignment.recipient_user_id
                      ? `🎁 Buy a gift for ${memberNameOf(
                          myGiftexAssignment.recipient_user_id
                        )}`
                      : `🎁 Buy a gift for a ${
                          myGiftexAssignment.buy_for_gender === "male"
                            ? "boy"
                            : myGiftexAssignment.buy_for_gender === "female"
                            ? "girl"
                            : "anyone"
                        }`}
                  </div>
                  <div className="text-[11px] text-slate-400">Only you can see this.</div>
                </div>
              )}

            {/* Everyone: the full reveal (after the host reveals) */}
            {giftexOn && gxRevealedAt && gxRevealList.length > 0 && (
              <div className="rounded-xl bg-violet-50 px-3 py-2">
                <div className="mb-1 text-sm font-semibold text-violet-800">
                  🎉 Who bought for whom
                </div>
                <div className="space-y-0.5">
                  {gxRevealList.map((a, i) => (
                    <div key={i} className="text-xs text-slate-600">
                      <span className="font-medium text-slate-800">
                        {memberNameOf(a.buyer)}
                      </span>{" "}
                      →{" "}
                      {a.recipient
                        ? memberNameOf(a.recipient)
                        : `a ${
                            a.gender === "male"
                              ? "boy"
                              : a.gender === "female"
                              ? "girl"
                              : "anyone"
                          }`}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderOpenPollResults = () => {
    if (!showResults || engagement.type !== "poll" || !isOpenPoll) return null;
    return (
      <div className="space-y-3">
        {pollOpenQuestions.map((q, i) => {
          const rows = responses
            .map((r) => {
              const c = r.content as {
                answers?: Record<string, string>;
                text?: string;
              };
              const v = c.answers?.[String(i)] ?? (i === 0 ? c.text : undefined);
              return { r, v };
            })
            .filter((x) => typeof x.v === "string" && x.v.trim());
          return (
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-2 text-sm font-semibold text-slate-800">
                {q}{" "}
                <span className="text-xs font-normal text-slate-400">
                  ({rows.length})
                </span>
              </div>
              {rows.length === 0 ? (
                <p className="text-xs text-slate-400">No answers yet.</p>
              ) : (
                <div className="space-y-2.5">
                  {rows.map(({ r, v }) => (
                    <div key={r.id} className="border-l-2 border-orange-200 pl-3">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-orange-700">
                        {engagement.is_blind
                          ? "Anonymous"
                          : memberNameOf(r.user_id, r.profile?.display_name)}
                        {(r.content as { _late?: boolean })._late && (
                          <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                            ✚ after reveal
                          </span>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-slate-700">
                        {String(v)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderScavengerResults = () => {
    if (!showResults || engagement.type !== "scavenger_hunt") return null;
    const items = (engagement.config?.questions as string[]) ?? [];
    return (
      <div className="space-y-3">
        {items.map((item, i) => {
          const ans = responses
            .map((r) => ({
              r,
              a: (r.content as { answers?: Record<string, { text?: string; photo?: string }> })
                ?.answers?.[String(i)],
            }))
            .filter((x) => x.a);
          return (
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-sm font-semibold text-slate-800 mb-2">
                {i + 1}. {item}{" "}
                <span className="text-xs font-normal text-slate-400">({ans.length})</span>
              </div>
              <div className="space-y-2.5">
                {ans.map(({ r, a }) => (
                  <div key={r.id} className="border-l-2 border-lime-200 pl-3">
                    <div className="text-xs font-semibold text-lime-700">
                      {memberNameOf(r.user_id, r.profile?.display_name)}
                    </div>
                    {a?.text && (
                      <p className="text-sm text-slate-700 whitespace-pre-wrap">{a.text}</p>
                    )}
                    {a?.photo && (
                      <img
                        src={a.photo}
                        alt=""
                        className="mt-1 max-h-48 rounded-lg object-cover"
                      />
                    )}
                  </div>
                ))}
                {ans.length === 0 && (
                  <span className="text-xs text-slate-400">Nobody got this one.</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // A response is host-only when, given the host default, this person didn't share
  // to the group (private default + not opted-in, or group default + opted-out).
  const careHostOnly = (r: { share_to_group?: boolean | null }) =>
    engagement.private_to_host ? r.share_to_group !== true : r.share_to_group === false;

  // An anonymous share is masked for other group members, but NOT for the author
  // themselves or the host (who follows up pastorally).
  const careMasked = (r: { anonymous?: boolean | null; user_id: string }) =>
    !!r.anonymous && !isCreator && r.user_id !== user?.id;
  const careAuthorName = (r: {
    anonymous?: boolean | null;
    user_id: string;
    profile?: { display_name?: string };
  }) =>
    careMasked(r)
      ? "🙈 Anonymous"
      : memberNameOf(r.user_id, r.profile?.display_name);
  // A care answer is "late" if that person's check-in was added after the reveal.
  const careIsLate = (userId: string) =>
    !!(
      responses.find((x) => x.user_id === userId)?.content as {
        _late?: boolean;
      }
    )?._late;
  const lateTag = (
    <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
      ✚ after reveal
    </span>
  );

  const renderCareResults = () => {
    if (!showResults || engagement.type !== "care") return null;
    const qs = parseCareQuestions(engagement.config);
    // New model: one row per (person, question) with its own visibility (RLS-filtered
    // server-side). Legacy fallback: pre-048 engagements still have answers inline on
    // the response content, with no per-question rows.
    const usingRows = careAnswerRows.length > 0;
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-teal-200 bg-teal-50/60 px-4 py-2.5 text-xs text-teal-800">
          🔒 {isCreator
            ? "Each person chose who sees each answer. As the host you see everyone's — 🔒 marks answers kept private to you."
            : "Each answer has its own visibility — 🔒 just the host, 👥 the group, or 🙈 the group without a name."}
        </div>
        {qs.map((q, i) => {
          const rows: {
            key: string;
            r: {
              user_id: string;
              anonymous?: boolean | null;
              share_to_group?: boolean | null;
              profile?: { display_name?: string };
            };
            v: string | number;
          }[] = usingRows
            ? careAnswerRows
                .filter((a) => a.q_index === i && a.value !== "")
                .map((a) => ({ key: a.id, r: a, v: a.value }))
            : responses
                .map((r) => ({
                  key: r.id,
                  r,
                  v: (r.content as { answers?: Record<string, string | number> })
                    ?.answers?.[String(i)] as string | number,
                }))
                .filter((x) => x.v !== undefined && x.v !== null && x.v !== "");
          if (rows.length === 0) return null;
          const stars = q.kind === "star";
          const avg = stars
            ? rows.reduce((a, b) => a + Number(b.v), 0) / rows.length
            : 0;
          return (
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-sm font-semibold text-slate-800">
                  {q.prompt}{" "}
                  <span className="text-xs font-normal text-slate-400">({rows.length})</span>
                </div>
                {stars && (
                  <span className="text-xs font-bold text-teal-700">{avg.toFixed(1)} avg</span>
                )}
              </div>
              {stars ? (
                <div className="flex flex-wrap gap-1.5">
                  {rows.map(({ key, r, v }) => (
                    <span
                      key={key}
                      className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-white px-2 py-0.5 text-[11px] text-slate-700"
                    >
                      {careAuthorName(r)}
                      {isCreator && careHostOnly(r) && <span title="Private to you">🔒</span>}
                      {isCreator && r.anonymous && <span title="Shared anonymously to the group">🙈</span>}
                      {careIsLate(r.user_id) && lateTag}
                      <span className="font-bold text-teal-700">{Number(v)}/5</span>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="space-y-2.5">
                  {rows.map(({ key, r, v }) => (
                    <div key={key} className="border-l-2 border-teal-200 pl-3">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-teal-700">
                        {careAuthorName(r)}
                        {isCreator && careHostOnly(r) && (
                          <span title="Private to you">🔒</span>
                        )}
                        {isCreator && r.anonymous && (
                          <span title="Shared anonymously to the group">🙈</span>
                        )}
                        {careIsLate(r.user_id) && lateTag}
                      </div>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap">{String(v)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderAccountabilityResults = () => {
    if (!showResults || engagement.type !== "accountability") return null;
    const qs = (engagement.config?.questions as string[]) ?? [];
    const notes = responses
      .map((r) => ({ r, note: (r.content as { note?: string })?.note }))
      .filter((x) => x.note && x.note.trim());
    return (
      <div className="space-y-3">
        {qs.map((q, i) => {
          const rows = responses
            .map((r) => ({
              r,
              val: (r.content as { answers?: Record<string, number> })?.answers?.[String(i)],
            }))
            .filter((x) => typeof x.val === "number");
          const avg = rows.length
            ? rows.reduce((a, b) => a + (b.val as number), 0) / rows.length
            : 0;
          return (
            <div key={i} className="rounded-xl border border-violet-200 bg-violet-50/50 p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-sm font-semibold text-slate-700">🙏 {q}</div>
                {rows.length > 0 && (
                  <span className="text-xs font-bold text-violet-700">
                    {avg.toFixed(1)} avg
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {rows.map(({ r, val }) => (
                  <span
                    key={r.id}
                    className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-white px-2 py-0.5 text-[11px] text-slate-700"
                  >
                    {engagement.is_blind
                      ? "Anonymous"
                      : memberNameOf(r.user_id, r.profile?.display_name)}
                    <span className="font-bold text-violet-700">{val}/5</span>
                  </span>
                ))}
                {rows.length === 0 && (
                  <span className="text-xs text-slate-400">No answers.</span>
                )}
              </div>
            </div>
          );
        })}

        {/* Notes shared with the group (encouragements, verses, requests) */}
        {notes.length > 0 && (
          <div className="rounded-xl border border-violet-200 bg-white p-4">
            <div className="text-sm font-semibold text-slate-700 mb-2">
              💬 Shared with the group
            </div>
            <div className="space-y-2.5">
              {notes.map(({ r, note }) => (
                <div key={r.id} className="border-l-2 border-violet-200 pl-3">
                  <div className="text-xs font-semibold text-violet-700">
                    {engagement.is_blind
                      ? "Anonymous"
                      : memberNameOf(r.user_id, r.profile?.display_name)}
                  </div>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{note}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderMostLikelyResults = () => {
    if (!showResults || engagement.type !== "most_likely") return null;
    const qs = (engagement.config?.questions as string[]) ?? [];

    return (
      <div className="space-y-3">
        {qs.map((q, i) => {
          // Tally by normalized name so "Alex" and "alex " merge; keep a nice label.
          const counts: Record<string, { label: string; n: number }> = {};
          responses.forEach((r) => {
            const raw = (r.content as { answers?: Record<string, string> })?.answers?.[
              String(i)
            ];
            const name = (raw ?? "").trim();
            if (!name) return;
            const key = name.toLowerCase();
            if (!counts[key]) counts[key] = { label: name, n: 0 };
            counts[key].n++;
          });
          const entries = Object.values(counts).sort((a, b) => b.n - a.n);
          const top = entries.length ? entries[0].n : 0;
          const winners = entries.filter((e) => e.n === top && top > 0);
          const runnersUp = entries.filter((e) => e.n < top);
          return (
            <div key={i} className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
              <div className="text-sm font-semibold text-slate-700 mb-1">🏆 {q}</div>
              {winners.length ? (
                <div className="text-lg font-extrabold text-amber-700">
                  {winners.map((w) => w.label).join(" & ")}{" "}
                  <span className="text-xs font-normal text-slate-500">
                    ({top} {top === 1 ? "vote" : "votes"})
                  </span>
                </div>
              ) : (
                <div className="text-sm text-slate-400">No votes for this one.</div>
              )}
              {runnersUp.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {runnersUp.slice(0, 5).map((e) => (
                    <span
                      key={e.label}
                      className="text-[11px] rounded-full bg-white border border-slate-200 text-slate-600 px-2 py-0.5"
                    >
                      {e.label} · {e.n}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderBabyRevealResults = () => {
    if (!showResults || engagement.type !== "baby_reveal") return null;
    const answer = revealAnswer?.answer ?? null;
    const tally: Record<string, number> = {};
    pollOptions.forEach((o) => (tally[o] = 0));
    responses.forEach((r) => {
      const opt = (r.content as { option?: string })?.option;
      if (opt) tally[opt] = (tally[opt] ?? 0) + 1;
    });
    const total = responses.length || 1;
    const winners = answer
      ? responses.filter((r) => (r.content as { option?: string })?.option === answer)
      : [];

    return (
      <div className="space-y-3">
        {answer ? (
          <div className="rounded-2xl border-2 border-sky-300 bg-gradient-to-br from-sky-50 to-indigo-50 p-5 text-center">
            <div className="text-4xl mb-1">🎉</div>
            <div className="text-xl font-extrabold text-slate-900">It&apos;s {answer}!</div>
            <p className="mt-1 text-sm text-slate-600">
              {winners.length === 0
                ? "Nobody guessed it!"
                : `${winners.length} guessed right: ${winners
                    .map((w) => memberNameOf(w.user_id, w.profile?.display_name))
                    .join(", ")}`}
            </p>
          </div>
        ) : (
          <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
            Guesses are in — waiting for the host to set the real answer.
          </div>
        )}

        {pollOptions.map((opt) => {
          const count = tally[opt] ?? 0;
          const pct = Math.round((count / total) * 100);
          const isAnswer = answer === opt;
          return (
            <div
              key={opt}
              className={`rounded-xl border p-3 ${
                isAnswer ? "border-sky-400 bg-sky-50" : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium text-slate-800">
                  {opt} {isAnswer && <span className="text-sky-600">✓ the answer</span>}
                </span>
                <span className="text-slate-500">
                  {count} {count === 1 ? "guess" : "guesses"} · {pct}%
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    isAnswer
                      ? "bg-gradient-to-r from-sky-400 to-indigo-500"
                      : "bg-slate-300"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {/* Who guessed this (names visible post-reveal) */}
              <div className="mt-1.5 flex flex-wrap gap-1">
                {responses
                  .filter((r) => (r.content as { option?: string })?.option === opt)
                  .map((r) => (
                    <span
                      key={r.id}
                      className={`text-[11px] rounded-full px-2 py-0.5 ${
                        isAnswer
                          ? "bg-sky-100 text-sky-800 font-medium"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {memberNameOf(r.user_id, r.profile?.display_name)}
                      {r.user_id === user?.id ? " (you)" : ""}
                    </span>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderTwoTruthsResults = () => {
    if (!showResults || engagement.type !== "two_truths") return null;
    const liesRevealed = !!engagement.lies_revealed_at;
    const R = responses.length;
    // Anonymous mode: candidate players (user_id + name) for "who wrote this?".
    const ttCandidates = responses.map((x) => ({
      user_id: x.user_id,
      name: memberNameOf(x.user_id, x.profile?.display_name),
    }));

    const answerFor = (rid: string) =>
      lieAnswers.find((a) => a.response_id === rid)?.lie_index;
    const myGuessFor = (rid: string) =>
      lieGuesses.find((g) => g.response_id === rid && g.guesser_id === user?.id)?.guess_index;
    const myAuthorGuessFor = (rid: string) =>
      lieGuesses.find((g) => g.response_id === rid && g.guesser_id === user?.id)?.author_guess ??
      null;

    // How many players have finished guessing everyone else.
    const completed = responses.filter(
      (r) => lieGuesses.filter((g) => g.guesser_id === r.user_id && g.guess_index != null).length >= R - 1
    ).length;

    // My score (after reveal).
    let myCorrect = 0;
    let myTotal = 0;
    if (liesRevealed) {
      responses.forEach((r) => {
        if (r.user_id === user?.id) return;
        const ans = answerFor(r.id);
        const mg = myGuessFor(r.id);
        if (ans !== undefined && mg != null) {
          myTotal++;
          if (mg === ans) myCorrect++;
        }
      });
    }

    // Winners (at the reveal): the Best Liar (fooled the most on the lie) and the
    // Most Carefully Concealed (whose authorship was guessed wrong the most).
    let bestLiar: { name: string; fooled: number } | null = null;
    let mostConcealed: { name: string; missed: number } | null = null;
    if (liesRevealed && R > 1) {
      for (const r of responses) {
        const ans = answerFor(r.id);
        const lieRows = lieGuesses.filter((g) => g.response_id === r.id && g.guess_index != null);
        const fooled = ans === undefined ? 0 : lieRows.filter((g) => g.guess_index !== ans).length;
        if (!bestLiar || fooled > bestLiar.fooled) {
          bestLiar = { name: memberNameOf(r.user_id, r.profile?.display_name), fooled };
        }
        if (engagement.is_blind) {
          const authRows = lieGuesses.filter((g) => g.response_id === r.id && g.author_guess);
          const missed = authRows.filter((g) => g.author_guess !== r.user_id).length;
          if (!mostConcealed || missed > mostConcealed.missed) {
            mostConcealed = { name: memberNameOf(r.user_id, r.profile?.display_name), missed };
          }
        }
      }
      if (bestLiar && bestLiar.fooled === 0) bestLiar = null;
      if (mostConcealed && mostConcealed.missed === 0) mostConcealed = null;
    }

    return (
      <div className="space-y-3">
        {!liesRevealed ? (
          <div className="rounded-xl bg-purple-50 border border-purple-200 p-3 text-sm text-purple-800">
            🕵️ Guessing phase — tap the statement you think is the lie on each entry.{" "}
            <span className="font-semibold">
              {completed} of {R}
            </span>{" "}
            {completed === 1 ? "player has" : "players have"} finished. The lies reveal
            once everyone&apos;s guessed.
          </div>
        ) : (
          <div className="rounded-xl bg-green-50 border border-green-200 p-3 text-sm text-green-800">
            🎉 Lies revealed! You spotted{" "}
            <span className="font-bold">
              {myCorrect} of {myTotal}
            </span>{" "}
            {myTotal === 1 ? "lie" : "lies"}.
          </div>
        )}

        {/* Winners — proclaimed once the lies (and any who-guesses) are revealed */}
        {liesRevealed && (bestLiar || mostConcealed) && (
          <div className="rounded-2xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50 p-4">
            <div className="text-sm font-extrabold text-amber-900 mb-2">🏆 And the winners are…</div>
            <div className="space-y-2">
              {bestLiar && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-xl">🤥</span>
                  <div>
                    <span className="font-bold text-slate-900">Best Liar: {bestLiar.name}</span>
                    <div className="text-xs text-slate-600">
                      Fooled {bestLiar.fooled} {bestLiar.fooled === 1 ? "person" : "people"} with their lie.
                    </div>
                  </div>
                </div>
              )}
              {mostConcealed && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-xl">🥷</span>
                  <div>
                    <span className="font-bold text-slate-900">
                      Most Carefully Concealed: {mostConcealed.name}
                    </span>
                    <div className="text-xs text-slate-600">
                      {mostConcealed.missed} {mostConcealed.missed === 1 ? "person" : "people"} guessed the wrong author.
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {responses.map((r) => {
          const statements = ((r.content as { statements?: string[] })?.statements) ?? [];
          const isMine = r.user_id === user?.id;
          const ans = answerFor(r.id);
          const mg = myGuessFor(r.id);
          const name =
            engagement.is_blind && !liesRevealed
              ? "Anonymous"
              : memberNameOf(r.user_id, r.profile?.display_name);
          const guessesForR = lieGuesses.filter((g) => g.response_id === r.id);
          const correctCount =
            ans !== undefined ? guessesForR.filter((g) => g.guess_index === ans).length : 0;

          return (
            <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-200 to-rose-200 flex items-center justify-center text-xs font-bold text-slate-700">
                  {name[0]?.toUpperCase() ?? "?"}
                </div>
                <span className="text-sm font-medium text-slate-900">
                  {name}
                  {isMine ? " (you)" : ""}
                </span>
                {liesRevealed && !isMine && mg != null && (
                  <span
                    className={`ml-auto text-xs font-semibold ${
                      mg === ans ? "text-green-600" : "text-rose-600"
                    }`}
                  >
                    {mg === ans ? "✓ You nailed it" : "✗ Fooled you"}
                  </span>
                )}
              </div>

              {/* Anonymous mode: guess WHO wrote this (before names are revealed) */}
              {engagement.is_blind &&
                !isMine &&
                hasResponded &&
                ttCandidates.length > 1 &&
                (() => {
                  const myAuth = myAuthorGuessFor(r.id); // a user_id
                  const myAuthName = myAuth
                    ? memberNameOf(myAuth, undefined)
                    : null;
                  return (
                    <div className="mb-2 text-xs">
                      {!liesRevealed ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-slate-500">🕵️ Who wrote this?</span>
                          {ttCandidates.map((c) => (
                            <button
                              key={c.user_id}
                              onClick={() => submitAuthorGuess(r.id, c.user_id)}
                              className={`rounded-full border px-2 py-0.5 ${
                                myAuth === c.user_id
                                  ? "border-purple-400 bg-purple-50 text-purple-700 font-semibold"
                                  : "border-slate-200 text-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              {c.name}
                            </button>
                          ))}
                        </div>
                      ) : myAuth ? (
                        myAuth === r.user_id ? (
                          <span className="font-medium text-green-600">
                            ✓ Right — {memberNameOf(r.user_id, r.profile?.display_name)} wrote it!
                          </span>
                        ) : (
                          <span className="text-slate-600">
                            You guessed {myAuthName} — it was{" "}
                            <b>{memberNameOf(r.user_id, r.profile?.display_name)}</b>.
                          </span>
                        )
                      ) : null}
                    </div>
                  );
                })()}

              <div className="space-y-1.5">
                {statements.map((s, i) => {
                  const isLie = liesRevealed && ans === i;
                  const iGuessed = mg === i;
                  const canGuess = !liesRevealed && !isMine && hasResponded;
                  let cls =
                    "w-full text-left rounded-lg border px-3 py-2 text-sm transition ";
                  if (isLie) cls += "border-rose-400 bg-rose-50 text-rose-900 font-semibold";
                  else if (iGuessed) cls += "border-purple-400 bg-purple-50";
                  else
                    cls +=
                      "border-slate-200 bg-white" +
                      (canGuess ? " hover:border-purple-300 cursor-pointer" : "");
                  return (
                    <button
                      key={i}
                      type="button"
                      disabled={!canGuess}
                      onClick={() => canGuess && submitLieGuess(r.id, i)}
                      className={cls}
                    >
                      {s}
                      {isLie && <span className="ml-2 text-xs">🤥 the lie</span>}
                      {isMine && !liesRevealed && ans === i && (
                        <span className="ml-2 text-xs text-rose-500">(your lie)</span>
                      )}
                      {iGuessed && !liesRevealed && (
                        <span className="ml-2 text-xs text-purple-600">← your guess</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {!liesRevealed && !isMine && hasResponded && mg == null && (
                <p className="mt-1.5 text-xs text-slate-400">Tap the one you think is the lie.</p>
              )}
              {liesRevealed && (
                <p className="mt-2 text-xs text-slate-500">
                  {correctCount} of {guessesForR.length} guessed right
                  {guessesForR.length > 0 && correctCount === 0
                    ? " — you fooled everyone! 😏"
                    : ""}
                </p>
              )}
            </div>
          );
        })}

        {!liesRevealed && !hasResponded && (
          <p className="text-xs text-slate-400">Only players who submitted can guess.</p>
        )}
        {!liesRevealed && isCreator && (
          <button
            onClick={revealLiesNow}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            🎬 Reveal the lies now (don&apos;t wait for stragglers)
          </button>
        )}
      </div>
    );
  };

  const renderRevealedResponses = () => {
    if (
      !showResults ||
      engagement.type === "poll" || // polls (bars or open Q&A) have their own renderers
      engagement.type === "two_truths" ||
      engagement.type === "baby_reveal" ||
      engagement.type === "most_likely" ||
      engagement.type === "accountability" ||
      engagement.type === "scavenger_hunt" ||
      engagement.type === "care" ||
      engagement.type === "signup"
    )
      return null;

    // "Guess who" candidates = everyone who responded.
    const responderNames = Array.from(
      new Set(responses.map((x) => memberNameOf(x.user_id, x.profile?.display_name)).filter(Boolean))
    ) as string[];

    return (
      <div className="space-y-3">
        {responses.map((r) => {
          const responseReactions = reactions.filter((rc) => rc.response_id === r.id);
          const content = r.content as Record<string, unknown>;

          return (
            <div
              key={r.id}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              {/* Author */}
              <div className="flex items-center gap-2 mb-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-orange-200 to-rose-200 flex items-center justify-center text-xs font-bold text-slate-700">
                  {engagement.is_blind ? "?" : memberNameOf(r.user_id, r.profile?.display_name)[0]?.toUpperCase() ?? "?"}
                </div>
                <span className="text-sm font-medium text-slate-900">
                  {engagement.is_blind ? "Anonymous" : memberNameOf(r.user_id, r.profile?.display_name)}
                </span>
                {engagement.type === "truth_or_dare" && (content.mode === "truth" || content.mode === "dare") && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${
                      content.mode === "truth"
                        ? "bg-sky-100 text-sky-700"
                        : "bg-rose-100 text-rose-700"
                    }`}
                  >
                    {content.mode === "truth" ? "🤐 Truth" : "🔥 Dare"}
                  </span>
                )}
                {r.id === winnerResponseId && (
                  <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
                    🏆 Winner
                  </span>
                )}
                {(content as { _late?: boolean })._late && (
                  <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                    ✚ after reveal
                  </span>
                )}
              </div>

              {/* Guess who (blind engagements only, not your own response) */}
              {isRevealed && engagement.is_blind && r.user_id !== user?.id && responderNames.length > 1 && (
                <div className="mb-2 text-xs">
                  {guesses[r.id] ? (
                    guesses[r.id] === memberNameOf(r.user_id, r.profile?.display_name) ? (
                      <span className="font-medium text-green-600">
                        ✓ Nailed it — it was {memberNameOf(r.user_id, r.profile?.display_name)}!
                      </span>
                    ) : (
                      <span className="text-slate-600">
                        It was <b>{memberNameOf(r.user_id, r.profile?.display_name)}</b> — you
                        guessed {guesses[r.id]}.
                      </span>
                    )
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-slate-500">🕵️ Guess who:</span>
                      {responderNames.map((n) => (
                        <button
                          key={n}
                          onClick={() => setGuesses((g) => ({ ...g, [r.id]: n }))}
                          className="rounded-full border border-slate-200 px-2 py-0.5 text-slate-700 hover:bg-slate-50"
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Content */}
              {engagement.type === "truth_or_dare" &&
                (content.mode === "truth" || content.mode === "dare") && (
                  <p className="mb-1 text-xs italic text-slate-500">
                    {(
                      (engagement.config as {
                        truthPrompt?: string;
                        darePrompt?: string;
                      })[content.mode === "truth" ? "truthPrompt" : "darePrompt"] || ""
                    ).trim() ||
                      (content.mode === "truth"
                        ? "Truth"
                        : "Dare")}
                  </p>
                )}
              {content.text && (
                <p className="text-sm text-slate-700">{content.text as string}</p>
              )}
              {typeof content.photo === "string" && content.photo && (
                <div className="mt-2 overflow-hidden rounded-lg">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={content.photo as string}
                    alt="Proof"
                    className="max-h-64 w-full object-cover"
                  />
                </div>
              )}
              {content.option && (
                <p className="text-sm text-slate-700 font-medium">Voted: {content.option as string}</p>
              )}
              {Array.isArray(content.media_items) &&
              (content.media_items as unknown[]).length > 0 ? (
                <div className="mt-2">
                  <div
                    className={`grid gap-1 ${
                      (content.media_items as unknown[]).length === 1
                        ? "grid-cols-1"
                        : (content.media_items as unknown[]).length === 2
                        ? "grid-cols-2"
                        : "grid-cols-3"
                    }`}
                  >
                    {(content.media_items as { url: string; type: string }[]).map(
                      (m, i) =>
                        m.type === "video" ? (
                          <video
                            key={i}
                            src={m.url}
                            controls
                            className="max-h-64 w-full rounded-lg object-cover"
                          />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={i}
                            src={m.url}
                            alt="Response"
                            className="max-h-64 w-full rounded-lg object-cover"
                          />
                        )
                    )}
                  </div>
                  {content.caption ? (
                    <p className="mt-1 text-sm text-slate-600">
                      {content.caption as string}
                    </p>
                  ) : null}
                </div>
              ) : content.media_url ? (
                <div className="mt-2 rounded-lg overflow-hidden">
                  {(content.media_type as string) === "video" ? (
                    <video
                      src={content.media_url as string}
                      controls
                      className="w-full max-h-64 object-cover"
                    />
                  ) : (
                    <img
                      src={content.media_url as string}
                      alt="Response"
                      className="w-full max-h-64 object-cover"
                    />
                  )}
                  {content.caption && (
                    <p className="text-sm text-slate-600 mt-1">{content.caption as string}</p>
                  )}
                </div>
              ) : null}

              {/* Reactions & rating only after a true reveal */}
              {isRevealed && (
              <>
              <div className="flex items-center gap-1 mt-3 flex-wrap">
                {["👍", "😂", "❤️", "🔥", "👏", "😮"].map((emoji) => {
                  const count = responseReactions.filter((rc) => rc.emoji === emoji).length;
                  const myReaction = responseReactions.find(
                    (rc) => rc.emoji === emoji && rc.user_id === user?.id
                  );
                  return (
                    <button
                      key={emoji}
                      onClick={() => addReaction(r.id, emoji)}
                      className={`rounded-full px-2 py-0.5 text-xs border transition ${
                        myReaction
                          ? "border-orange-300 bg-orange-50"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      {emoji} {count > 0 && count}
                    </button>
                  );
                })}
              </div>

              {/* Rating */}
              <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-2">
                {r.user_id === user?.id ? (
                  <span className="text-xs text-slate-400">Your entry — others rate it</span>
                ) : (
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        onClick={() => addRating(r.id, n)}
                        title={`Rate ${n} star${n === 1 ? "" : "s"}`}
                        className="text-base leading-none hover:scale-110 transition"
                      >
                        {n <= myRatingFor(r.id) ? "⭐" : "☆"}
                      </button>
                    ))}
                  </div>
                )}
                {(() => {
                  const { avg, count } = ratingFor(r.id);
                  return count > 0 ? (
                    <span className="text-xs font-medium text-slate-600">
                      {avg.toFixed(1)} ★ ({count})
                    </span>
                  ) : (
                    <span className="text-xs text-slate-300">no ratings yet</span>
                  );
                })()}
              </div>
              <div className="mt-2 flex items-center gap-3 text-[11px]">
                {r.user_id !== user?.id &&
                  (reportedIds.has(r.id) ? (
                    <span className="text-slate-400">Reported ✓</span>
                  ) : (
                    <button
                      onClick={() => {
                        reportResponse(r.id);
                        setReportedIds((prev) => new Set(prev).add(r.id));
                      }}
                      className="text-slate-400 hover:text-amber-600"
                    >
                      Report
                    </button>
                  ))}
                {isCreator && (
                  <button
                    onClick={() => {
                      if (confirm("Remove this response from the group?")) removeResponse(r.id);
                    }}
                    className="text-slate-400 hover:text-red-600"
                  >
                    Remove
                  </button>
                )}
              </div>
              </>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div>
      {isGuest ? (
        // A card guest isn't a group member — no group to go "back" to. Give them
        // a gentle bit of context instead of a dead-end link into a group they
        // can't see.
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700">
          🔥 You&apos;re invited to this {meta?.label?.toLowerCase() || "card"} — just sign below.
        </div>
      ) : (
        <Link
          href={`/campfirelive/group/${groupId}`}
          className="text-sm text-slate-500 hover:text-slate-700 mb-4 inline-block"
        >
          ← Back to group
        </Link>
      )}

      {/* ── PAUSED: host froze it to make changes — nothing goes out until resumed ── */}
      {engagement.paused && isCreator && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
          <div className="text-sm text-amber-900">
            ⏸️ <span className="font-bold">Paused.</span> No emails are going out and
            the schedule is on hold — add or hide people freely, then resume. (Anyone
            you add now won&apos;t be emailed until you resume.)
          </div>
          <button
            onClick={togglePause}
            disabled={pausing}
            className="shrink-0 rounded-full bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {pausing ? "Saving…" : "▶️ Resume"}
          </button>
        </div>
      )}

      {/* ── DRAFT: not live yet — only the creator can see it until launch ── */}
      {(isDraft || justLaunched) && isCreator && (
        <div
          className={`mb-6 rounded-2xl border-2 p-5 ${
            justLaunched
              ? "border-green-300 bg-green-50"
              : "border-dashed border-orange-300 bg-orange-50"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              {justLaunched ? (
                <>
                  <div className="flex items-center gap-2 text-sm font-bold text-green-900">
                    <span className="rounded-full bg-green-200 px-2 py-0.5 text-[11px] uppercase tracking-wide">
                      Live
                    </span>
                    {justLaunchedQuiet
                      ? "It's live — opened quietly, no email sent"
                      : "It's launched — the group can see it now"}
                  </div>
                  <p className="mt-1 text-xs text-green-800/80">
                    {justLaunchedQuiet
                      ? "No notification went out. Share the link or nudge the group whenever you're ready."
                      : "We emailed everyone in the group and any pending invitees to respond."}
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-sm font-bold text-orange-900">
                    <span className="rounded-full bg-orange-200 px-2 py-0.5 text-[11px] uppercase tracking-wide">
                      Draft
                    </span>
                    Only you can see this right now
                  </div>
                  <p className="mt-1 text-xs text-orange-800/80">
                    {engagement.scheduled_open_at ? (
                      <>
                        🎂 This auto-opens on{" "}
                        {new Date(engagement.scheduled_open_at).toLocaleDateString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        })}{" "}
                        and reveals on the special day — runs every year. You can also hit
                        Launch now to open it early.
                      </>
                    ) : (
                      <>
                        Review the prompt below. When you hit launch, it goes live for the
                        group and everyone (members + pending invitees) gets an email to
                        respond.
                      </>
                    )}
                  </p>
                </>
              )}
            </div>
            <div className="flex flex-col items-end gap-1">
              <button
                onClick={() => launch(true)}
                disabled={launching || justLaunched}
                className={`rounded-full px-6 py-2.5 text-sm font-bold text-white shadow-sm disabled:opacity-100 ${
                  justLaunched
                    ? "bg-green-600"
                    : "bg-gradient-to-r from-orange-500 to-rose-500 hover:opacity-90 disabled:opacity-50"
                }`}
              >
                {justLaunched
                  ? "✓ Launched"
                  : launching
                  ? "Launching…"
                  : engagement.scheduled_open_at
                  ? "🚀 Open early & notify now"
                  : "🚀 Launch to the group"}
              </button>
              {!justLaunched && (
                <button
                  onClick={() => launch(false)}
                  disabled={launching}
                  className="text-xs font-medium text-slate-500 underline hover:text-slate-700 disabled:opacity-50"
                >
                  Open quietly — no email
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Reveal Animation ── */}
      {showRevealAnimation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="text-center animate-bounce">
            <div className="text-8xl mb-4">🔓</div>
            <h2 className="text-3xl font-extrabold text-white mb-2">Results Revealed!</h2>
            <p className="text-white/80">Everyone is in — see what happened!</p>
          </div>
        </div>
      )}

      {/* ── Engagement Header ── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm mb-6 overflow-hidden">
        {engagement.cover_image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={engagement.cover_image_url}
            alt=""
            className={
              isBirthdayCard && isRevealed
                ? // A revealed card reads like a card — ~60% wide, centered.
                  "mx-auto block w-full max-h-96 bg-white object-contain py-3 sm:w-3/5"
                : "w-full h-40 sm:h-52 object-contain bg-slate-100"
            }
          />
        )}
        <div className="p-4 sm:p-6">
        {editing ? (
          <div className="flex items-start gap-3 mb-3">
            <span className="text-2xl sm:text-3xl flex-shrink-0">{engagementIcon(engagement)}</span>
            <div className="flex-1 min-w-0 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Prompt / question
                </label>
                <textarea
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Prompt / question"
                  rows={2}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-lg font-semibold leading-snug text-slate-900 focus:border-orange-500 outline-none resize-y"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Details <span className="text-slate-400">(optional)</span>
                </label>
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  placeholder="Add more detail (optional)"
                  rows={5}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base leading-relaxed text-slate-700 focus:border-orange-500 outline-none resize-y"
                />
              </div>

              {/* Care Check-in: edit prompts + response type, add/remove questions */}
              {engagement.type === "poll" && (
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-500">
                    Answer format
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { v: "multiple", label: "Multiple choice" },
                        { v: "yes_no", label: "Yes / No" },
                        { v: "open", label: "Open-ended" },
                      ] as const
                    ).map((o) => {
                      const on = editPollFormat === o.v;
                      return (
                        <button
                          key={o.v}
                          type="button"
                          onClick={() => setEditPollFormat(o.v)}
                          className={`rounded-lg border px-2 py-1.5 text-center text-xs font-medium transition ${
                            on
                              ? "border-orange-500 bg-orange-50 text-slate-900"
                              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                          }`}
                        >
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                  {editPollFormat === "yes_no" ? (
                    <p className="text-xs text-slate-500">Answers are Yes or No.</p>
                  ) : (
                    (() => {
                      const isOpen = editPollFormat === "open";
                      const minKeep = isOpen ? 1 : 2;
                      return (
                        <div className="space-y-2">
                          {isOpen && (
                            <p className="text-xs text-slate-500">
                              People type an answer to each question.
                              {pollOptions.length > 0 && (
                                <span className="text-slate-600">
                                  {" "}
                                  Your options below become the open questions.
                                </span>
                              )}
                            </p>
                          )}
                          {editPollOptions.map((opt, i) => (
                            <div key={i} className="flex gap-2">
                              <input
                                type="text"
                                value={opt}
                                onChange={(e) => {
                                  const next = [...editPollOptions];
                                  next[i] = e.target.value;
                                  setEditPollOptions(next);
                                }}
                                placeholder={`${isOpen ? "Question" : "Option"} ${i + 1}`}
                                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-orange-500 outline-none"
                              />
                              {editPollOptions.length > minKeep && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditPollOptions(
                                      editPollOptions.filter((_, j) => j !== i)
                                    )
                                  }
                                  className="px-2 text-slate-400 hover:text-red-500"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          ))}
                          {editPollOptions.length < 12 && (
                            <button
                              type="button"
                              onClick={() =>
                                setEditPollOptions([...editPollOptions, ""])
                              }
                              className="text-sm font-medium text-orange-600"
                            >
                              {isOpen ? "+ Add question" : "+ Add option"}
                            </button>
                          )}
                        </div>
                      );
                    })()
                  )}
                </div>
              )}

              {engagement.type === "truth_or_dare" && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      🤐 Truth prompt
                    </label>
                    <textarea
                      value={editTruthPrompt}
                      onChange={(e) => setEditTruthPrompt(e.target.value)}
                      rows={2}
                      placeholder="The truth question they'll answer"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-orange-500 outline-none resize-y"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      🔥 Dare prompt
                    </label>
                    <textarea
                      value={editDarePrompt}
                      onChange={(e) => setEditDarePrompt(e.target.value)}
                      rows={2}
                      placeholder="The dare they'll take on"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-orange-500 outline-none resize-y"
                    />
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Players commit to one before seeing it — keep them spicy but kind.
                  </p>
                </div>
              )}

              {engagement.type === "care" && (
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    Questions
                  </label>
                  {editCareQuestions.map((q, i) => (
                    <div key={i} className="mb-2 rounded-lg border border-slate-200 p-2.5">
                      <div className="flex gap-2 items-start">
                        <span className="text-slate-400 text-sm pt-2">{i + 1}.</span>
                        <input
                          type="text"
                          value={q.prompt}
                          onChange={(e) => {
                            const next = [...editCareQuestions];
                            next[i] = { ...next[i], prompt: e.target.value };
                            setEditCareQuestions(next);
                          }}
                          placeholder="Your question / prompt…"
                          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-orange-500 outline-none"
                        />
                        {editCareQuestions.length > 1 && (
                          <button
                            onClick={() =>
                              setEditCareQuestions(editCareQuestions.filter((_, j) => j !== i))
                            }
                            className="text-slate-400 hover:text-red-500 px-1 pt-1.5"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      <div className="mt-2 ml-5 flex gap-1.5">
                        {(
                          [
                            { k: "text", label: "Aa Text box" },
                            { k: "star", label: "⭐ Stars (1–5)" },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.k}
                            type="button"
                            onClick={() => {
                              const next = [...editCareQuestions];
                              next[i] = { ...next[i], kind: opt.k };
                              setEditCareQuestions(next);
                            }}
                            className={`rounded-full border px-3 py-1 text-xs font-medium ${
                              q.kind === opt.k
                                ? "border-teal-500 bg-teal-50 text-teal-700"
                                : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {editCareQuestions.length < 20 && (
                    <button
                      onClick={() =>
                        setEditCareQuestions([
                          ...editCareQuestions,
                          { prompt: "", kind: "text" },
                        ])
                      }
                      className="text-sm text-orange-600 font-medium"
                    >
                      + Add question
                    </button>
                  )}
                </div>
              )}

              {engagement.type === "birthday" ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Reveals on (date &amp; time)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="date"
                        value={editDeadlineTime.split("T")[0] || ""}
                        onChange={(e) => {
                          const t = editDeadlineTime.split("T")[1] || "08:00";
                          setEditDeadlineTime(e.target.value ? `${e.target.value}T${t}` : "");
                        }}
                        className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-orange-500 outline-none"
                      />
                      <input
                        type="time"
                        value={editDeadlineTime.split("T")[1] || ""}
                        onChange={(e) => {
                          const d = editDeadlineTime.split("T")[0];
                          if (d) setEditDeadlineTime(`${d}T${e.target.value || "08:00"}`);
                        }}
                        className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-orange-500 outline-none"
                      />
                    </div>
                  </div>
                  {showYearField && (
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">
                        {yearFieldLabel}{" "}
                        <span className="text-slate-400">{yearFieldHint}</span>
                      </label>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={editBirthYear}
                        onChange={(e) => setEditBirthYear(e.target.value)}
                        placeholder={isRealBirthday ? "e.g. 1998" : "e.g. 2005"}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-orange-500 outline-none"
                      />
                    </div>
                  )}
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Opens this many days before (auto-emails the group then)
                    </label>
                    <div className="flex items-center gap-2 text-sm">
                      <input
                        type="number"
                        min={0}
                        max={120}
                        value={editLeadDays}
                        onChange={(e) => setEditLeadDays(parseInt(e.target.value || "14", 10))}
                        className="w-20 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-orange-500 outline-none"
                      />
                      <span className="text-slate-500">
                        days before — opens &amp; sends the &ldquo;it&apos;s open&rdquo; email then.
                      </span>
                    </div>
                  </div>
                  {editDeadlineTime && (
                    <p className="col-span-2 text-xs text-slate-500">
                      Shows as:{" "}
                      <span className="font-medium text-slate-700">
                        {resolveTitle(
                          editTitle,
                          editBirthYear.trim() ? parseInt(editBirthYear, 10) : null,
                          new Date(editDeadlineTime).toISOString()
                        )}
                      </span>{" "}
                      · opens ~{editLeadDays || 14} days before (
                      {new Date(
                        new Date(editDeadlineTime).getTime() -
                          (editLeadDays || 14) * 86400000
                      ).toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                      ), reveals on the day, runs yearly.
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      {engagement.hold_until_deadline ? "Reveal date & time" : "Deadline"}{" "}
                      <span className="text-slate-400">(optional)</span>
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="date"
                        value={editDeadlineTime.split("T")[0] || ""}
                        onChange={(e) => {
                          const t = editDeadlineTime.split("T")[1] || "08:00";
                          setEditDeadlineTime(e.target.value ? `${e.target.value}T${t}` : "");
                        }}
                        className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-orange-500 outline-none"
                      />
                      <input
                        type="time"
                        value={editDeadlineTime.split("T")[1] || ""}
                        onChange={(e) => {
                          const d = editDeadlineTime.split("T")[0];
                          if (d) setEditDeadlineTime(`${d}T${e.target.value || "08:00"}`);
                        }}
                        className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-orange-500 outline-none"
                      />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {engagement.hold_until_deadline
                        ? "It stays sealed and reveals at this moment. Leave blank to remove the date."
                        : "Responses close and the reveal fires after this. Leave blank for no deadline."}
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                      Repeat
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {([
                        { value: "none", label: "Once" },
                        { value: "daily", label: "🔁 Daily" },
                        { value: "weekly", label: "🔁 Weekly" },
                        { value: "monthly", label: "🔁 Monthly" },
                      ] as const).map((r) => (
                        <button
                          key={r.value}
                          type="button"
                          onClick={() => setEditRecurrence(r.value)}
                          className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                            editRecurrence === r.value
                              ? "border-orange-500 bg-orange-50 text-slate-900"
                              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                          }`}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                    {editRecurrence !== "none" && (
                      <p className="mt-1 text-xs text-slate-500">
                        A fresh copy auto-posts every{" "}
                        {editRecurrence === "daily"
                          ? "day"
                          : editRecurrence === "weekly"
                          ? "week"
                          : "month"}{" "}
                        after this one wraps.
                      </p>
                    )}
                  </div>
                </div>
              )}
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editAllowMemberInvites}
                  onChange={(e) => setEditAllowMemberInvites(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                />
                <div>
                  <div className="text-sm font-medium text-slate-700">
                    👥 Let members invite others to this
                  </div>
                  <div className="text-xs text-slate-500">
                    Anyone in the group can invite people to this engagement (not just you).
                  </div>
                </div>
              </label>

              {/* Group gift — enable/disable + recipient */}
              <div>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editGiftEnabled}
                    onChange={(e) => setEditGiftEnabled(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                  />
                  <div>
                    <div className="text-sm font-medium text-slate-700">
                      🎁 Collect a group gift
                    </div>
                    <div className="text-xs text-slate-500">
                      People chip in when they sign; a gift card for the total is emailed
                      to the recipient on reveal.
                    </div>
                  </div>
                </label>
                {editGiftEnabled && (
                  <div className="mt-2 ml-7 space-y-2 rounded-xl border border-orange-200 bg-orange-50/50 p-3">
                    <input
                      type="email"
                      value={editGiftRecipientEmail}
                      onChange={(e) => setEditGiftRecipientEmail(e.target.value)}
                      placeholder="Recipient's email (where the gift card is sent)"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-500"
                    />
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={editGiftShowTotal}
                        onChange={(e) => setEditGiftShowTotal(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                      />
                      Show the running total to everyone (the recipient never sees it).
                      Off = only you + whoever started it.
                    </label>
                    <input
                      type="text"
                      value={editGiftRecipientName}
                      onChange={(e) => setEditGiftRecipientName(e.target.value)}
                      placeholder="Recipient's name (optional)"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-500"
                    />
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-slate-600">Currency</label>
                      <select
                        value={editGiftCurrency}
                        onChange={(e) => setEditGiftCurrency(e.target.value)}
                        className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-orange-500"
                      >
                        {GIFT_CURRENCIES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
                {engagement.gift_enabled &&
                  !editGiftEnabled &&
                  (giftSummary?.contributors ?? 0) > 0 && (
                    <p className="mt-1 ml-7 text-[11px] text-amber-600">
                      ⚠️ Turning this off will refund everyone who chipped in.
                    </p>
                  )}
              </div>

              {/* Surprise: hide from (members + everyone on the invited-email list) */}
              {(roster.filter((m) => m.user_id !== user?.id).length > 0 ||
                allInvitees.length > 0) && (
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    {isRevealed
                      ? "🎁 Who the card is for — the reveal email addresses them (re-send after editing)"
                      : "🎁 Hide from (surprise) — they don't see it until the reveal"}
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {roster
                      .filter((m) => m.user_id !== user?.id)
                      .map((m) => {
                        const on = editExcludedIds.includes(m.user_id);
                        return (
                          <button
                            key={m.user_id}
                            type="button"
                            onClick={() =>
                              setEditExcludedIds((prev) =>
                                on
                                  ? prev.filter((id) => id !== m.user_id)
                                  : [...prev, m.user_id]
                              )
                            }
                            className={`rounded-full border px-3 py-1 text-xs font-medium ${
                              on
                                ? "border-rose-500 bg-rose-500 text-white"
                                : "border-slate-300 bg-white text-slate-700 hover:border-rose-300"
                            }`}
                          >
                            {on ? "🙈 " : ""}
                            {m.name}
                          </button>
                        );
                      })}
                    {allInvitees.map((p) => {
                      const on = editExcludedEmails.includes(p.email);
                      return (
                        <button
                          key={p.email}
                          type="button"
                          onClick={() =>
                            setEditExcludedEmails((prev) =>
                              on ? prev.filter((e) => e !== p.email) : [...prev, p.email]
                            )
                          }
                          title={p.email}
                          className={`rounded-full border px-3 py-1 text-xs font-medium ${
                            on
                              ? "border-rose-500 bg-rose-500 text-white"
                              : "border-slate-200 bg-slate-50 text-slate-600 hover:border-rose-300"
                          }`}
                        >
                          {on ? "🙈 " : ""}
                          {p.name || p.email}{" "}
                          <span className={on ? "text-rose-100" : "text-slate-400"}>
                            · {p.joined ? "by email" : "not joined"}
                          </span>
                        </button>
                      );
                    })}
                    {/* Emails added directly (not on the invited list) */}
                    {editExcludedEmails
                      .filter((e) => !allInvitees.some((p) => p.email === e))
                      .map((e) => (
                        <button
                          key={e}
                          type="button"
                          onClick={() =>
                            setEditExcludedEmails((prev) => prev.filter((x) => x !== e))
                          }
                          className="rounded-full border border-rose-500 bg-rose-500 px-3 py-1 text-xs font-medium text-white"
                        >
                          🙈 {e}{" "}
                          <span className="text-rose-100">· by email ✕</span>
                        </button>
                      ))}
                  </div>
                  {/* Add a recipient by email — for someone not in the list above
                      (e.g. they joined under a guest account) */}
                  <div className="mt-2 flex gap-2">
                    <input
                      type="email"
                      value={addRecipEmail}
                      onChange={(e) => setAddRecipEmail(e.target.value)}
                      placeholder="Add a recipient by email…"
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-rose-400"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const em = addRecipEmail.trim().toLowerCase();
                        if (
                          /\S+@\S+\.\S+/.test(em) &&
                          !editExcludedEmails.includes(em)
                        ) {
                          setEditExcludedEmails((prev) => [...prev, em]);
                          setAddRecipEmail("");
                        }
                      }}
                      disabled={!addRecipEmail.trim()}
                      className="flex-shrink-0 rounded-full bg-rose-500 px-4 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-40"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}

              {responseCount > 0 && (
                <p className="text-xs text-amber-700">
                  ⚠️ {responseCount}{" "}
                  {responseCount === 1 ? "person has" : "people have"} already
                  responded — editing changes the prompt they answered.
                </p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={saveEdit}
                  disabled={!editTitle.trim() || savingEdit}
                  className="rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {savingEdit ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="rounded-full border border-slate-300 bg-white px-4 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="mb-3">
            {/* Eyebrow + status badge on one row so the title gets full width */}
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <p className="min-w-0 truncate text-xs font-semibold text-orange-600">
                {(engagement.config?.occasion as string) ||
                  `${
                    isCreator
                      ? "Your"
                      : `${memberNameOf(
                          engagement.creator_id,
                          engagement.creator?.display_name
                        )}'s`
                  } ${meta?.label ?? engagement.type}`}
              </p>
              <div className="flex-shrink-0">
                {isSealed && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-800">
                    🔒 Sealed
                  </span>
                )}
                {isRevealed && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-3 py-1.5 text-xs font-semibold text-green-700">
                    ✓ Revealed
                  </span>
                )}
              </div>
            </div>
            {/* Icon + title (no badge competing → wraps normally) */}
            <div className="flex items-start gap-3">
              <span className="text-2xl sm:text-3xl flex-shrink-0">{engagementIcon(engagement)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <h1 className="min-w-0 flex-1 text-xl font-extrabold leading-tight text-slate-900 break-words">
                    {resolveTitle(engagement.title, engagement.birth_year, engagement.deadline)}
                  </h1>
                  {canEdit && (
                    <button
                      onClick={startEdit}
                      title="Edit prompt"
                      className="mt-0.5 flex-shrink-0 rounded-full border border-slate-200 px-2 py-0.5 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                    >
                      ✏️ Edit
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Created {new Date(engagement.created_at).toLocaleDateString()}
                  {engagement.is_blind && " · 🙈 Blind mode"}
                </p>
              </div>
            </div>
          </div>
        )}

        {!editing && (engagement.description?.trim() || meta?.hook) && (
          <p className="text-sm text-slate-600 mb-4">
            {engagement.description?.trim() || meta?.hook}
          </p>
        )}

        {/* Progress */}
        <div className="mb-2">
          <div className="flex justify-between text-xs text-slate-500 mb-1">
            <span>
              {responseCount} of {displayExpected}{" "}
              {displayExpected === 1 ? "person" : "people"} responded
              {waitAll ? " (all invited)" : ""}
            </span>
            <span>
              {displayExpected > 0
                ? Math.round((responseCount / displayExpected) * 100)
                : 0}
              %
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isRevealed
                  ? "bg-gradient-to-r from-green-400 to-emerald-500"
                  : "bg-gradient-to-r from-orange-400 to-rose-400"
              }`}
              style={{
                width: `${
                  displayExpected > 0
                    ? Math.round((responseCount / displayExpected) * 100)
                    : 0
                }%`,
              }}
            />
          </div>
          {/* Host-only context: invited-but-not-joined don't count toward the
              reveal (only members who've joined can respond). */}
          {inviteStats.pending > 0 && (
            <p className="mt-1.5 text-xs text-slate-500">
              {engagement.total_expected}{" "}
              {engagement.total_expected === 1 ? "person has" : "people have"} joined
              and can respond ·{" "}
              <span className="text-amber-700">
                {inviteStats.pending} invited{" "}
                {inviteStats.pending === 1 ? "person hasn't" : "people haven't"} joined
                yet
              </span>
              . The reveal waits only on those who&apos;ve joined — nudge the rest to
              pull them in before it unlocks.
            </p>
          )}
        </div>

        {/* When the card opened (became visible to sign). For a recurring birthday
            it re-opens automatically a set time before each birthday. */}
        {(engagement.scheduled_open_at || engagement.launched_at) &&
          engagement.status === "active" &&
          (() => {
            const openTs = new Date(
              (engagement.scheduled_open_at || engagement.launched_at) as string
            ).getTime();
            const future = openTs > Date.now();
            const dateStr = new Date(openTs).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            });
            const lead = engagement.lead_days ?? 14;
            const recurringNote =
              engagement.recurrence_rule === "yearly"
                ? ` · re-opens ~${lead} day${lead === 1 ? "" : "s"} before each ${
                    isCelebrationCard ? cardOccasion : "birthday"
                  }`
                : "";
            return (
              <p className="text-xs text-slate-400 mt-2">
                👁️ {future ? "Opens for signing" : "Open to sign since"}: {dateStr}
                {recurringNote}
              </p>
            );
          })()}

        {/* Deadline */}
        {engagement.deadline && engagement.status === "active" && (
          <p className="text-xs text-slate-400 mt-2">
            {engagement.hold_until_deadline ? "⏳ Reveals" : "Deadline"}:{" "}
            {new Date(engagement.deadline).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
            {engagement.hold_until_deadline &&
              " — held until then, even if everyone responds early."}
          </p>
        )}
        {/* Group-gift running total (in the engagement header too) */}
        {engagement.gift_enabled &&
          !isGiftHidden &&
          canSeeGiftTotal &&
          giftSummary &&
          giftSummary.contributors > 0 && (
            <p className="mt-2 text-xs font-semibold text-orange-700">
              🎁 {formatMoney(giftSummary.total_cents, engagement.gift_currency)} chipped
              in from {giftSummary.contributors}{" "}
              {giftSummary.contributors === 1 ? "person" : "people"}
            </p>
          )}
        </div>
      </div>

      {/* ── Sign-up: the live claimable list takes the place of a response form ── */}
      {renderSignup()}

      {/* ── It's your turn: make the action obvious the instant you land (a kid
            tapping an email invite shouldn't have to scroll and figure it out). ── */}
      {engagement.type !== "signup" &&
        (engagement.status === "active" || lateResponseAllowed) &&
        !hasResponded &&
        !isDraft &&
        !(user && (engagement.excluded_user_ids ?? []).includes(user.id)) && (
          <a
            href="#respond"
            onClick={(e) => {
              e.preventDefault();
              document
                .getElementById("respond")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="mb-6 flex items-center justify-between gap-3 rounded-2xl border-2 border-sky-300 bg-gradient-to-br from-sky-50 to-cyan-50 px-5 py-4 shadow-sm transition hover:border-sky-400"
          >
            <div className="min-w-0">
              <div className="text-base font-extrabold text-slate-900">
                ✍️ Respond to this
              </div>
              <div className="truncate text-xs text-slate-600">
                {lateResponseAllowed
                  ? "Results are in — you can still add yours"
                  : `${meta?.label ?? "Activity"} · add your response below`}
              </div>
            </div>
            <span className="flex-shrink-0 rounded-full bg-sky-600 px-4 py-2 text-sm font-bold text-white">
              ✍️ Respond
            </span>
          </a>
        )}

      {/* ── Surprise: who it's hidden from until the reveal ── */}
      {((engagement.excluded_user_ids?.length ?? 0) > 0 ||
        (engagement.excluded_emails?.length ?? 0) > 0) &&
        !isRevealed && (
          <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50/60 px-4 py-3 text-xs text-rose-800">
            🎁 <span className="font-semibold">Surprise</span> — hidden from{" "}
            <span className="font-semibold">
              {[
                ...(engagement.excluded_user_ids ?? []).map((uid) =>
                  memberNameOf(uid, "someone")
                ),
                ...(engagement.excluded_emails ?? []).map((email) => {
                  const inv = pendingInvitees.find((p) => p.email === email);
                  return inv?.name || email;
                }),
              ].join(", ")}
            </span>{" "}
            until the reveal. Keep it under wraps! They&apos;ll get it the moment you reveal.
          </div>
        )}

      {/* ── Share a link that drops people straight into THIS engagement ──
          Recipients become guests of just this card — they do NOT join the group.
          (To email people, use the group's invite form — one place for emails.) */}
      {!isDraft && groupInfo && !isGuest && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs text-slate-500">
            <span className="font-semibold text-slate-700">Invite to just this card.</span>{" "}
            Drops them straight in to sign — they get access to <em>only</em> this
            engagement and won&apos;t join {groupInfo.name || "your group"}.
          </p>
          <button
            onClick={shareEngagement}
            title="Invite to just this card — they can sign it without joining your group"
            className="flex-shrink-0 rounded-full border border-orange-300 bg-orange-50 px-4 py-1.5 text-sm font-semibold text-orange-700 hover:bg-orange-100"
          >
            {sharedEng ? "✓ Copied — paste it anywhere!" : "📨 Copy invite"}
          </button>
        </div>
      )}

      {/* ── Guests on this card (host/admin only): people invited to just this
          engagement, with the option to bring them into the whole group. ── */}
      {(isCreator || isGroupAdmin) && engagementGuests.length > 0 && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/50 px-4 py-3">
          <div className="text-xs font-semibold text-slate-600 mb-2">
            🎟️ Guests on this card ({engagementGuests.length}) — here for just this
            one, not in {groupInfo?.name || "the group"}.
          </div>
          <div className="grid gap-1.5">
            {engagementGuests.map((g) => (
              <div
                key={g.user_id}
                className="flex items-center justify-between gap-2 rounded-lg bg-white/70 px-2.5 py-1.5 text-xs"
              >
                <span className="min-w-0 truncate font-medium text-slate-800">
                  {g.name}
                </span>
                <button
                  onClick={() => promoteGuest(g.user_id)}
                  disabled={promotingGuest === g.user_id}
                  title={`Add ${g.name} to ${groupInfo?.name || "the group"} as a full member`}
                  className="flex-shrink-0 rounded-full border border-orange-300 bg-orange-50 px-3 py-1 font-semibold text-orange-700 hover:bg-orange-100 disabled:opacity-50"
                >
                  {promotingGuest === g.user_id ? "Adding…" : "+ Add to group"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── BABY REVEAL: host sets the secret answer (hidden until reveal) ── */}
      {isCreator && engagement.type === "baby_reveal" && (
        <div className="mb-6 rounded-2xl border border-sky-200 bg-sky-50/60 p-4">
          <div className="text-sm font-bold text-slate-900">
            🤫 The real answer
            {revealAnswer ? " — set, kept secret until the reveal" : " (only you can set this)"}
          </div>
          <p className="text-xs text-slate-500 mt-0.5 mb-2">
            Pick the true answer. It stays hidden from everyone until
            {deadlineStr ? ` ${deadlineStr}` : " the reveal"} — then winners light up.
          </p>
          <div className="flex flex-wrap gap-2">
            {pollOptions.map((opt) => (
              <button
                key={opt}
                onClick={() => setRevealAnswer(opt)}
                className={`rounded-full border px-4 py-1.5 text-sm font-medium ${
                  revealAnswer?.answer === opt
                    ? "border-sky-500 bg-sky-500 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:border-sky-400"
                }`}
              >
                {opt}
                {revealAnswer?.answer === opt ? " ✓" : ""}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── CREATOR CONTROL: force the reveal / end the engagement anytime ── */}
      {isCreator && engagement.status === "active" && (
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-slate-900">
                You started this — you control the reveal
              </div>
              <p className="text-xs text-slate-500">
                {responseCount} of {engagement.total_expected} responded.
                {engagement.reveal === "all_at_once"
                  ? " Reveal whenever you're ready."
                  : " Nudged everyone and some won't respond? End it early and reveal."}
              </p>
            </div>
            <button
              onClick={revealNow}
              className="rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-5 py-2 text-sm font-semibold text-white hover:opacity-90"
            >
              🎬 Reveal now
            </button>
          </div>

          {engagement.reveal === "sealed" && (
            <div className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-400">
              When does it open?
            </div>
          )}

          {/* Option 1: reveal ON the date, regardless of who's responded */}
          {engagement.reveal === "sealed" && engagement.deadline && (
            <label className="mt-2 flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={!!engagement.hold_until_deadline}
                onChange={(e) => {
                  setHoldUntilDeadline(e.target.checked);
                  // Revealing on the date overrides "wait for everyone".
                  if (e.target.checked && waitAll) setWaitForAllInvited(false);
                }}
                className="mt-0.5 w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
              />
              <div>
                <div className="text-sm font-medium text-slate-700">
                  ⏳ Reveal on the date — no matter who&apos;s responded (surprise mode)
                </div>
                <div className="text-xs text-slate-500">
                  Opens{" "}
                  {new Date(engagement.deadline).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}{" "}
                  regardless — like a gift on the day. Off = reveals as soon as everyone
                  who&apos;s in has responded.
                </div>
              </div>
            </label>
          )}

          {/* Option 2: only matters when NOT revealing on the date */}
          {engagement.reveal === "sealed" && (
            <label
              className={`mt-2 flex items-start gap-3 ${
                engagement.hold_until_deadline ? "opacity-50" : "cursor-pointer"
              }`}
            >
              <input
                type="checkbox"
                checked={waitAll && !engagement.hold_until_deadline}
                disabled={!!engagement.hold_until_deadline}
                onChange={(e) => setWaitForAllInvited(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
              />
              <div>
                <div className="text-sm font-medium text-slate-700">
                  ✉️ Wait until everyone invited has joined &amp; responded
                </div>
                <div className="text-xs text-slate-500">
                  {engagement.hold_until_deadline
                    ? "Not used — it opens on the date regardless (uncheck the date option to use this)."
                    : "Don't reveal just because the joined members answered — hold until invited people join and respond too."}
                  {!engagement.hold_until_deadline && pendingCount > 0
                    ? ` ${pendingCount} invited ${
                        pendingCount === 1 ? "person hasn't" : "people haven't"
                      } joined yet.`
                    : ""}
                  {!engagement.hold_until_deadline && engagement.deadline
                    ? " (The deadline still acts as a backstop.)"
                    : ""}
                </div>
              </div>
            </label>
          )}
        </div>
      )}

      {/* ── CREATOR CONTROL: un-reveal (e.g. it revealed earlier than wanted) ── */}
      {isCreator && isRevealed && (
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-slate-900">
                Revealed too early? Put it back.
              </div>
              <p className="text-xs text-slate-500">
                Re-seals it for everyone. Existing responses are kept — turn on
                &ldquo;wait until the deadline&rdquo; next so it holds for the surprise.
              </p>
            </div>
            <button
              onClick={async () => {
                const { error: unErr } = await unrevealEngagement();
                if (unErr) {
                  alert("Couldn't un-reveal: " + unErr);
                  return;
                }
                // If there's a future deadline, offer to hold it until then.
                if (
                  engagement.deadline &&
                  new Date(engagement.deadline).getTime() > Date.now() &&
                  typeof window !== "undefined" &&
                  window.confirm("Hold it sealed until the deadline so it can't re-reveal early?")
                ) {
                  await setHoldUntilDeadline(true);
                }
              }}
              className="rounded-full border border-slate-300 bg-white px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              ↩️ Un-reveal (re-seal)
            </button>
          </div>
          <div className="mt-3 border-t border-slate-100 pt-3">
            <button
              onClick={resendReveal}
              disabled={resendingReveal}
              className="text-xs font-medium text-sky-600 underline hover:text-sky-700 disabled:opacity-50"
            >
              {resendingReveal ? "Sending…" : "📨 Re-send the reveal email to everyone"}
            </button>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Use this if an earlier email went out with a broken link.
            </p>
          </div>
          {isBirthdayCard && (
            <div className="mt-3 border-t border-slate-100 pt-3 text-xs">
              {engagement.config?.cardViewedAt ? (
                <div className="font-medium text-emerald-700">
                  👀 {recipientLabel} opened the card on{" "}
                  {new Date(
                    engagement.config.cardViewedAt as string
                  ).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </div>
              ) : (
                <div className="text-slate-500">
                  ⏳ {recipientLabel} hasn&apos;t opened the card yet.
                </div>
              )}
              {!!engagement.config?.thanksSentAt && (
                <div className="mt-0.5 font-medium text-rose-600">
                  💛 They sent a thank-you to everyone.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── SEALED STATE: Waiting for everyone ── */}
      {isSealed && hasResponded && !allIn && (
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/60 p-6 mb-6">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-3xl">🔒</span>
            <div>
              <h2 className="font-bold text-amber-900">Results are sealed</h2>
              <p className="text-sm text-amber-700">
                {responseCount} of {displayExpected} have responded. {revealRule}
              </p>
            </div>
          </div>

          {/* Waiting animation */}
          <div className="flex items-center gap-2 mb-4">
            <div className="flex gap-1">
              {Array.from({ length: Math.max(displayExpected, 1) }).map((_, i) => (
                <div
                  key={i}
                  className={`w-3 h-3 rounded-full transition-all ${
                    i < responseCount
                      ? "bg-orange-500"
                      : "bg-slate-200 animate-pulse"
                  }`}
                  style={{
                    animationDelay: i < responseCount ? "0s" : `${(i - responseCount) * 0.3}s`,
                  }}
                />
              ))}
            </div>
            <span className="text-xs text-amber-700">
              {engagement.hold_until_deadline && deadlineStr
                ? `Sealed until ${deadlineStr}`
                : `Waiting for ${Math.max(displayExpected - responseCount, 0)} more...`}
            </span>
          </div>

          {/* Your response confirmation */}
          <div className="rounded-xl bg-white/60 border border-amber-200 p-3 mb-3">
            <div className="flex items-center gap-2 text-sm text-amber-900">
              <span>✓</span>
              <span className="font-medium">
                Your response is in{!isRevealed ? " — you can still change it until the reveal" : ""}
              </span>
            </div>
            {myResponse?.content && (
              <p className="text-xs text-amber-700 mt-1">
                {(myResponse.content as Record<string, unknown>).option
                  ? `You voted: ${(myResponse.content as Record<string, unknown>).option}`
                  : (myResponse.content as Record<string, unknown>).text
                  ? "Text response submitted"
                  : "Response submitted"}
              </p>
            )}
          </div>

          {/* Nudge button — emails everyone who hasn't responded */}
          <div className="flex items-center gap-3">
            <button
              onClick={nudgeStragglers}
              disabled={nudgeMsg === "Sending…"}
              className="rounded-full border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50"
            >
              👋 Nudge Stragglers
            </button>
            {nudgeMsg && nudgeMsg !== "Sending…" && (
              <span className="text-xs font-medium text-amber-700">{nudgeMsg}</span>
            )}
          </div>
        </div>
      )}

      {/* ── ALL-AT-ONCE: non-creators wait for the creator (creator has the control above) ── */}
      {awaitingCreatorReveal && hasResponded && !isCreator && (
        <div className="rounded-2xl border-2 border-amber-200 bg-amber-50/60 p-6 mb-6">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🎬</span>
            <div>
              <h2 className="font-bold text-amber-900">Waiting for the reveal</h2>
              <p className="text-sm text-amber-700">
                {responseCount} of {engagement.total_expected} responded. The creator
                will reveal the results.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Host view: who's responded so far (names only, content stays sealed),
          broken out into Members and Guests so the host sees both groups. ── */}
      {(isCreator || isGroupAdmin) &&
        engagement.status === "active" &&
        (() => {
          const respondedSet = new Set(responders);
          const excludedSet = new Set(engagement.excluded_user_ids ?? []);
          const members = roster
            .filter((m) => !excludedSet.has(m.user_id))
            .map((m) => ({ ...m, responded: respondedSet.has(m.user_id) }))
            .sort((a, b) => Number(b.responded) - Number(a.responded));
          const guests = engagementGuests
            .map((g) => ({ ...g, responded: respondedSet.has(g.user_id) }))
            .sort((a, b) => Number(b.responded) - Number(a.responded));
          const Person = ({ name, responded }: { name: string; responded: boolean }) => (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                responded
                  ? "bg-green-50 text-green-700"
                  : "bg-slate-50 text-slate-500"
              }`}
            >
              {responded ? "✓" : "⏳"} {name}
            </span>
          );
          return (
            <div className="mb-6 rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-xs font-semibold text-slate-600 mb-2">
                👀 Who&apos;s responded ({responders.length}/{displayExpected})
              </div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Members ({members.filter((m) => m.responded).length}/{members.length})
              </div>
              {members.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {members.map((m) => (
                    <Person key={m.user_id} name={m.name} responded={m.responded} />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400">No members yet.</p>
              )}
              {guests.length > 0 && (
                <>
                  <div className="mt-3 mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                    Guests ({guests.filter((g) => g.responded).length}/{guests.length})
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {guests.map((g) => (
                      <Person key={g.user_id} name={g.name} responded={g.responded} />
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })()}

      {/* ── GROUP GIFT: chip in toward a gift card for the recipient (hidden from
            the recipient to keep it a surprise) ── */}
      {engagement.gift_enabled && !isGiftHidden && (
        <div className="mb-6 rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 to-rose-50 p-5 shadow-sm">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h2 className="font-bold text-slate-900">🎁 Group gift</h2>
            {giftSummary && giftSummary.contributors > 0 && canSeeGiftTotal && (
              <span className="text-sm font-bold text-orange-700">
                {formatMoney(giftSummary.total_cents, engagement.gift_currency)} from{" "}
                {giftSummary.contributors}{" "}
                {giftSummary.contributors === 1 ? "person" : "people"}
              </span>
            )}
          </div>
          {engagement.gift_issued_at ? (
            <p className="text-sm text-slate-600">
              ✅ The gift card was sent to{" "}
              {engagement.gift_recipient_name || "the recipient"}. Thank you!
            </p>
          ) : (
            <>
              <p className="text-xs text-slate-600 mb-3">
                Chip in toward a gift card for{" "}
                {engagement.gift_recipient_name || "the recipient"} — it&apos;s emailed
                to them when the card opens.
              </p>
              <div className="flex flex-wrap gap-2">
                {[500, 1000, 2000].map((cents) => (
                  <button
                    key={cents}
                    onClick={() => chipIn(cents)}
                    disabled={chippingIn}
                    className="rounded-full bg-white border border-orange-300 px-4 py-2 text-sm font-bold text-orange-700 hover:bg-orange-100 disabled:opacity-50"
                  >
                    {formatMoney(cents, engagement.gift_currency)}
                  </button>
                ))}
                <button
                  onClick={() => {
                    const cur = (engagement.gift_currency || "usd").toUpperCase();
                    const v = window.prompt(`Chip in how much? (${cur})`);
                    const n = v ? Math.round(parseFloat(v) * 100) : 0;
                    if (n >= 100) chipIn(n);
                    else if (v) alert("Minimum is 1.");
                  }}
                  disabled={chippingIn}
                  className="rounded-full bg-white border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  Other…
                </button>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                {chippingIn
                  ? "Opening secure checkout…"
                  : "A small card-processing fee is added on top so the recipient gets the full amount. Charged now; refunded if the card is canceled before it opens."}
              </p>
            </>
          )}
        </div>
      )}

      {/* ── RESPONSE FORM (not yet responded, or editing before the reveal) ── */}
      {engagement.type !== "signup" &&
        ((engagement.status === "active" && (!hasResponded || editingResponse)) ||
          (lateResponseAllowed && !hasResponded)) && (
        <div
          id="respond"
          className="scroll-mt-4 rounded-2xl border-2 border-sky-200 bg-sky-50/40 p-6 shadow-sm mb-6"
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-sky-900">
              ✍️ {editingResponse ? "Edit your response" : "Your response"}
            </h2>
            {editingResponse && (
              <button
                onClick={() => setEditingResponse(false)}
                className="text-xs font-medium text-slate-400 hover:text-slate-600"
              >
                Cancel
              </button>
            )}
          </div>
          {lateResponseAllowed && (
            <div className="flex items-start gap-2 rounded-xl bg-sky-50 border border-sky-200 px-3 py-2 mb-4">
              <span>⏰</span>
              <p className="text-xs text-sky-800">
                The results are already in, but you can still add yours — it&apos;ll be
                marked as added after the reveal.
              </p>
            </div>
          )}
          {isBirthdayCard ? (
            <div className="flex items-start gap-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 mb-4">
              <span>🔒</span>
              <p className="text-xs text-rose-800">
                Just between you and{" "}
                <span className="font-semibold">{recipientLabel}</span> —{" "}
                <span className="font-semibold">only they</span> will ever see your
                message, even after the card opens. The rest of the group never sees
                it. Write freely! 💛
              </p>
            </div>
          ) : (
            engagement.reveal === "sealed" && (
              <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 mb-4">
                <span>🔒</span>
                <p className="text-xs text-amber-800">
                  Results are sealed. Nobody will see your response until everyone has responded.
                </p>
              </div>
            )
          )}
          {engagement.is_blind && (
            <div className="flex items-center gap-2 rounded-xl bg-violet-50 border border-violet-200 px-3 py-2 mb-4">
              <span>🙈</span>
              <p className="text-xs text-violet-800">
                This is anonymous — your answer won&apos;t show who you are. Answer freely
                and honestly.
              </p>
            </div>
          )}
          {renderResponseForm()}
        </div>
      )}

      {/* ── Edit my answer (responded, still active, not already editing) ── */}
      {engagement.type !== "signup" &&
        engagement.status === "active" &&
        hasResponded &&
        !editingResponse &&
        canEditResponse && (
          <div className="mb-6 -mt-2 text-center">
            <button
              onClick={startEditResponse}
              className="text-xs font-medium text-sky-600 underline hover:text-sky-700"
            >
              ✏️ Edit my answer{!isRevealed ? " — you can still change it until the reveal" : ""}
            </button>
          </div>
        )}

      {/* ── RESULTS (revealed, or live as-they-come / instant) ── */}
      {showResults && (
        <div className="mb-6">
          {/* Birthday card: it's private to the recipient. The recipient sees all
              the wishes; a signer only ever sees their own. */}
          {isBirthdayCard && isRevealed && (
            <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50/60 px-4 py-3 text-xs text-rose-800">
              {isRecipient ? (
                <>{cardEmoji} <span className="font-semibold">Your card!</span> Here are the {responseCount} {responseCount === 1 ? "wish" : "wishes"} everyone wrote just for you — nobody else can see them.</>
              ) : (
                <>
                  🎉 <span className="font-semibold">{recipientLabel} received the card</span> with {responseCount} {responseCount === 1 ? "wish" : "wishes"}! Each message is private to them — below is just your own. 💛
                </>
              )}
            </div>
          )}
          {isRealBirthday && isRevealed && (
            <button
              onClick={playHappyBirthday}
              className="mb-4 w-full rounded-2xl bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:opacity-90"
            >
              🎵 Play Happy Birthday 🎂
            </button>
          )}

          {/* Recipient: thank everyone who signed */}
          {isBirthdayCard && isRevealed && isRecipient &&
            (engagement.config?.thanksSentAt ? (
              <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
                💛 Thanks sent to everyone who signed!
              </div>
            ) : showThanks ? (
              <div className="mb-4 space-y-2 rounded-2xl border border-rose-200 bg-rose-50/60 p-4">
                <div className="text-sm font-semibold text-rose-800">
                  Send a thank-you to everyone 💛
                </div>
                <textarea
                  value={thanksMsg}
                  onChange={(e) => setThanksMsg(e.target.value)}
                  rows={2}
                  maxLength={280}
                  placeholder="Add a note (optional) — e.g. Thank you all so much, I loved it!"
                  className="w-full rounded-xl border border-rose-200 px-3 py-2 text-sm outline-none focus:border-rose-400"
                />
                <div className="flex items-center gap-3">
                  <button
                    onClick={sendThanks}
                    disabled={thanksSending}
                    className="rounded-full bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {thanksSending ? "Sending…" : "Send thanks 💛"}
                  </button>
                  <button
                    onClick={() => setShowThanks(false)}
                    className="text-xs font-medium text-slate-500 hover:text-slate-700"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowThanks(true)}
                className="mb-4 w-full rounded-2xl border-2 border-rose-300 bg-white px-4 py-3 text-sm font-bold text-rose-600 transition hover:bg-rose-50"
              >
                💛 Thank everyone!
              </button>
            ))}

          {/* Everyone else: the recipient's thank-you */}
          {isBirthdayCard &&
            isRevealed &&
            !isRecipient &&
            !!engagement.config?.thanksSentAt && (
              <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                💛 <span className="font-semibold">{recipientLabel} said thank you!</span>
                {!!engagement.config?.thanksMessage && (
                  <div className="mt-1 italic text-rose-700">
                    &ldquo;{engagement.config.thanksMessage as string}&rdquo;
                  </div>
                )}
              </div>
            )}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-slate-900">
              {isBirthdayCard
                ? isRecipient
                  ? `${cardEmoji} Your wishes`
                  : "Your wish"
                : justRevealed
                ? "🎉 Results Are In!"
                : isRevealed
                ? "Results"
                : "Live results"}
            </h2>
            {isRevealed && (
              <button
                onClick={shareResults}
                className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                📤 Share
              </button>
            )}
          </div>
          {!isRevealed && liveMode && (
            <p className="-mt-2 mb-4 text-xs text-slate-500">
              {engagement.reveal === "instant"
                ? "Instant mode — responses appear the moment they're in."
                : "As-they-come — responses show up live."}
            </p>
          )}

          {/* Read receipts — host sees who's looked at the results */}
          {isCreator && isRevealed && (
            <p className="-mt-2 mb-4 text-xs text-slate-500">
              👀 Seen by {views.length} of {roster.length || views.length}
              {views.length > 0 && (
                <span className="text-slate-400">
                  {" "}
                  ·{" "}
                  {views
                    .map((v) => memberNameOf(v.user_id, "Someone"))
                    .slice(0, 8)
                    .join(", ")}
                  {views.length > 8 ? "…" : ""}
                </span>
              )}
            </p>
          )}

          {/* Poll results */}
          {renderPollResults()}
          {renderOpenPollResults()}

          {/* Two Truths & a Lie — guess-the-lie + scored reveal */}
          {renderTwoTruthsResults()}

          {/* Baby Reveal — tally + winners */}
          {renderBabyRevealResults()}

          {/* Most Likely To… — winner per award */}
          {renderMostLikelyResults()}

          {/* Accountability — per-question ratings */}
          {renderAccountabilityResults()}

          {/* Scavenger Hunt — per-item answers */}
          {renderScavengerResults()}

          {/* Care Check-in — per-section responses */}
          {renderCareResults()}

          {/* Other response types */}
          {renderRevealedResponses()}

          {/* Comments / replies — on release; not for host-private engagements */}
          {(isRevealed || (engagement.type === "care" && showResults)) &&
            !engagement.private_to_host && (
          <div className="mt-6">
            <h3 className="font-bold text-slate-900 mb-3">
              {engagement.type === "care" ? "Replies" : "Comments"} ({comments.length})
            </h3>

            {comments.map((c) => (
              <div key={c.id} className="flex gap-2 mb-3">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-orange-200 to-rose-200 flex items-center justify-center text-xs font-bold text-slate-700 flex-shrink-0">
                  {c.anonymous ? "🕊️" : (c.profile?.display_name?.[0]?.toUpperCase() ?? "?")}
                </div>
                <div>
                  <span className="text-xs font-medium text-slate-700">
                    {c.anonymous
                      ? "Anonymous"
                      : memberNameOf(c.user_id, c.profile?.display_name)}
                  </span>
                  <p className="text-sm text-slate-600">{c.content}</p>
                </div>
              </div>
            ))}

            <div className="flex gap-2 mt-3">
              <input
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCommentSubmit()}
                placeholder={
                  engagement.allow_anon_replies && commentAnon
                    ? "Add an anonymous reply…"
                    : "Add a reply…"
                }
                className="flex-1 rounded-xl border border-slate-300 px-4 py-2 text-sm focus:border-orange-500 outline-none"
              />
              <button
                onClick={handleCommentSubmit}
                disabled={!commentText.trim()}
                className="rounded-xl bg-gradient-to-r from-orange-500 to-rose-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Send
              </button>
            </div>
            {engagement.allow_anon_replies && (
              <label className="mt-2 flex items-center gap-2 text-xs text-slate-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={commentAnon}
                  onChange={(e) => setCommentAnon(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                />
                🕊️ Post this reply anonymously
              </label>
            )}
          </div>
          )}
        </div>
      )}

      {/* Already responded but engagement is instant/as-they-come reveal */}
      {hasResponded && engagement.status === "active" && engagement.reveal !== "sealed" && (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-4 mb-6">
          <div className="flex items-center gap-2 text-sm text-green-800">
            <span>✓</span>
            <span className="font-medium">Response submitted!</span>
          </div>
        </div>
      )}

      {/* ── Start a NEW activity (distinct from responding to THIS one) ── */}
      {(hasResponded || isRevealed) && (
        <Link
          href={`/campfirelive/group/${groupId}/engagement/new`}
          className={`block rounded-2xl border-2 border-dashed p-5 text-center transition mb-6 ${
            iWon
              ? "border-amber-400 bg-amber-50 hover:bg-amber-100"
              : "border-indigo-300 bg-indigo-50/60 hover:bg-indigo-50"
          }`}
        >
          <div className="mb-1 text-2xl">{iWon ? "🏆" : "✨"}</div>
          <div className="font-bold text-slate-900">
            {iWon ? "You won! Start a new activity" : "Start a new activity"}
          </div>
          <p className="mt-0.5 text-sm text-slate-600">
            {iWon
              ? "Winner's privilege — pose the next one for the group. 🎉"
              : "A different poll, card, sign-up, or challenge — separate from this one."}
          </p>
          <span
            className={`mt-3 inline-block rounded-full px-5 py-2 text-sm font-semibold text-white ${
              iWon
                ? "bg-gradient-to-r from-amber-500 to-orange-500"
                : "bg-indigo-600"
            }`}
          >
            + New activity
          </span>
        </Link>
      )}

      {/* Creator: pause, duplicate, or cancel the engagement */}
      {isCreator && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-4">
          {!isRevealed && (
            <>
              <button
                onClick={togglePause}
                disabled={pausing}
                title={
                  engagement.paused
                    ? "Resume — emails and the schedule start working again"
                    : "Pause — stops all emails & the schedule so you can make changes safely"
                }
                className="text-xs font-medium text-slate-500 underline hover:text-orange-600 disabled:opacity-50"
              >
                {pausing
                  ? "Saving…"
                  : engagement.paused
                  ? "▶️ Resume"
                  : "⏸️ Pause"}
              </button>
              <span className="text-slate-300">·</span>
            </>
          )}
          <button
            onClick={duplicateEngagement}
            disabled={duplicating}
            title="Make a copy — reuses the questions, settings, and uploaded images"
            className="text-xs font-medium text-slate-500 underline hover:text-orange-600 disabled:opacity-50"
          >
            {duplicating ? "Duplicating…" : "📄 Duplicate"}
          </button>
          <span className="text-slate-300">·</span>
          <button
            onClick={cancelEngagement}
            className="text-xs text-slate-400 underline hover:text-red-600"
          >
            Cancel this engagement
          </button>
        </div>
      )}
    </div>
  );
}
